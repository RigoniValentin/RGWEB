import crypto from 'crypto';
import { getPool, sql } from '../database/connection.js';
import { config } from '../config/index.js';

type DbPool = Awaited<ReturnType<typeof getPool>>;

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVATION_TTL_MINUTES = 30;
const ACTIVATION_COOLDOWN_SECONDS = 120;
const MAX_ACTIVATION_ATTEMPTS = 5;

let schemaReady = false;

export type LicenseState = 'active' | 'warning' | 'expired' | 'missing' | 'date_invalid';

export interface LicenseStatus {
  canAccess: boolean;
  state: LicenseState;
  code: 'LICENSE_OK' | 'LICENSE_WARNING' | 'LICENSE_EXPIRED' | 'LICENSE_NOT_FOUND' | 'LICENSE_DATE_INVALID';
  message: string;
  daysRemaining: number | null;
  expiresAt: string | null;
}

export interface ActivationRequestResult {
  activationId: string;
  expiresAt: string;
  license: LicenseStatus;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatLocalDateTime(value: Date): string {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value);
}

function hashCode(activationId: string, code: string): string {
  return crypto
    .createHmac('sha256', config.jwt.secret)
    .update(`${activationId}:${code.trim()}`)
    .digest('hex');
}

async function ensureLicenseTables(pool: DbPool) {
  if (schemaReady) return;

  await pool.request().query(`
    IF OBJECT_ID(N'dbo.VENCIMIENTO', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.VENCIMIENTO (
        FECHA_VENCIMIENTO DATETIME NOT NULL
      );
    END;

    IF OBJECT_ID(N'dbo.REGISTRO_ACCESOS', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.REGISTRO_ACCESOS (
        REGISTRO_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        FECHA_ACCESO DATETIME NOT NULL
      );
    END;

    IF OBJECT_ID(N'dbo.LICENCIA_ACTIVACIONES', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.LICENCIA_ACTIVACIONES (
        ACTIVACION_ID UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
        USUARIO_ID INT NULL,
        CODIGO_HASH VARCHAR(64) NOT NULL,
        FECHA_SOLICITUD DATETIME2 NOT NULL CONSTRAINT DF_LIC_ACT_SOL DEFAULT SYSUTCDATETIME(),
        FECHA_EXPIRACION DATETIME2 NOT NULL,
        FECHA_USO DATETIME2 NULL,
        INTENTOS INT NOT NULL CONSTRAINT DF_LIC_ACT_INT DEFAULT 0,
        IP VARCHAR(45) NULL,
        USER_AGENT NVARCHAR(500) NULL
      );
    END;

    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_LICENCIA_ACTIVACIONES_USUARIO' AND object_id = OBJECT_ID(N'dbo.LICENCIA_ACTIVACIONES'))
    BEGIN
      CREATE INDEX IX_LICENCIA_ACTIVACIONES_USUARIO
      ON dbo.LICENCIA_ACTIVACIONES (USUARIO_ID, FECHA_SOLICITUD DESC);
    END;
  `);

  schemaReady = true;
}

async function sendWhatsApp(telefono: string, mensaje: string) {
  const ipWsp = config.integrations.ipWsp;
  if (!ipWsp) {
    throw Object.assign(new Error('WhatsApp no configurado (ipWsp)'), { name: 'ValidationError' });
  }
  if (!telefono) {
    throw Object.assign(new Error('Telefono de soporte no configurado'), { name: 'ValidationError' });
  }

  const response = await fetch(`${ipWsp}/send-message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: telefono, mensaje }),
  });

  if (!response.ok) {
    throw new Error(`Error al enviar WhatsApp: ${response.status}`);
  }
}

export const licenseService = {
  async validateAccess(pool: DbPool): Promise<LicenseStatus> {
    await ensureLicenseTables(pool);

    const result = await pool.request().query(`SELECT TOP 1 FECHA_VENCIMIENTO FROM dbo.VENCIMIENTO`);
    const row = result.recordset[0];
    if (!row?.FECHA_VENCIMIENTO) {
      return {
        canAccess: false,
        state: 'missing',
        code: 'LICENSE_NOT_FOUND',
        message: 'No se encontro una licencia valida para este equipo.',
        daysRemaining: null,
        expiresAt: null,
      };
    }

    const now = new Date();
    const expiration = new Date(row.FECHA_VENCIMIENTO);
    const modificationLimit = new Date(expiration.getTime() - 32 * DAY_MS);
    const daysRemaining = Math.floor((expiration.getTime() - now.getTime()) / DAY_MS);
    const expiresAt = toIso(expiration);

    if (now > expiration) {
      return {
        canAccess: false,
        state: 'expired',
        code: 'LICENSE_EXPIRED',
        message: 'La licencia se encuentra vencida.',
        daysRemaining,
        expiresAt,
      };
    }

    if (now < modificationLimit) {
      return {
        canAccess: false,
        state: 'date_invalid',
        code: 'LICENSE_DATE_INVALID',
        message: 'Se detecto una modificacion en la fecha y hora del equipo.',
        daysRemaining,
        expiresAt,
      };
    }

    const accessResult = await pool.request().query(`
      SELECT TOP 1 FECHA_ACCESO
      FROM dbo.REGISTRO_ACCESOS
      ORDER BY REGISTRO_ID DESC
    `);
    const lastAccess = accessResult.recordset[0]?.FECHA_ACCESO
      ? new Date(accessResult.recordset[0].FECHA_ACCESO)
      : null;

    if (lastAccess && now < lastAccess) {
      return {
        canAccess: false,
        state: 'date_invalid',
        code: 'LICENSE_DATE_INVALID',
        message: 'Se detecto una modificacion en la fecha y hora del equipo.',
        daysRemaining,
        expiresAt,
      };
    }

    if (daysRemaining <= 5) {
      return {
        canAccess: true,
        state: 'warning',
        code: 'LICENSE_WARNING',
        message: `La licencia vence en ${daysRemaining} dia${daysRemaining === 1 ? '' : 's'}.`,
        daysRemaining,
        expiresAt,
      };
    }

    return {
      canAccess: true,
      state: 'active',
      code: 'LICENSE_OK',
      message: 'Licencia activa.',
      daysRemaining,
      expiresAt,
    };
  },

  async recordAccess(pool: DbPool) {
    await ensureLicenseTables(pool);
    await pool.request().query(`INSERT INTO dbo.REGISTRO_ACCESOS (FECHA_ACCESO) VALUES (GETDATE())`);
  },

  async requestActivationCode(
    pool: DbPool,
    input: { userId: number; username: string; ip?: string; userAgent?: string },
  ): Promise<ActivationRequestResult> {
    await ensureLicenseTables(pool);

    const license = await this.validateAccess(pool);
    if (license.canAccess) {
      throw Object.assign(new Error('La licencia todavia se encuentra activa.'), { name: 'ValidationError' });
    }
    if (license.state === 'date_invalid') {
      throw Object.assign(new Error('Actualice la fecha y hora del equipo antes de solicitar una activacion.'), { name: 'ValidationError' });
    }

    const cooldown = await pool.request()
      .input('uid', sql.Int, input.userId)
      .query(`
        SELECT TOP 1 DATEDIFF(SECOND, FECHA_SOLICITUD, SYSUTCDATETIME()) AS SEGUNDOS
        FROM dbo.LICENCIA_ACTIVACIONES
        WHERE USUARIO_ID = @uid
          AND FECHA_USO IS NULL
          AND FECHA_EXPIRACION > SYSUTCDATETIME()
        ORDER BY FECHA_SOLICITUD DESC
      `);

    const elapsedSeconds = cooldown.recordset[0]?.SEGUNDOS as number | undefined;
    if (elapsedSeconds !== undefined && elapsedSeconds < ACTIVATION_COOLDOWN_SECONDS) {
      throw Object.assign(new Error('Ya se solicito un codigo recientemente.'), {
        name: 'CooldownError',
        retryAfterSeconds: ACTIVATION_COOLDOWN_SECONDS - elapsedSeconds,
      });
    }

    const activationId = crypto.randomUUID();
    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MINUTES * 60_000);
    const codeHash = hashCode(activationId, code);

    await pool.request()
      .input('id', sql.UniqueIdentifier, activationId)
      .input('uid', sql.Int, input.userId)
      .input('hash', sql.VarChar(64), codeHash)
      .input('expiresAt', sql.DateTime2, expiresAt)
      .input('ip', sql.VarChar(45), input.ip ?? null)
      .input('ua', sql.NVarChar(500), input.userAgent ?? null)
      .query(`
        INSERT INTO dbo.LICENCIA_ACTIVACIONES
          (ACTIVACION_ID, USUARIO_ID, CODIGO_HASH, FECHA_EXPIRACION, IP, USER_AGENT)
        VALUES (@id, @uid, @hash, @expiresAt, @ip, @ua)
      `);

    const mensaje =
      '*-------- SOPORTE RG --------*\n' +
      'Solicitud de activacion de licencia.\n\n' +
      `Razon Social: *${config.app.nombreFantasia || '-'}*.\n` +
      `Nombre: *${config.app.nombreCliente || '-'}*.\n` +
      `Telefono: *${config.app.telefonoCliente || '-'}*.\n` +
      `Usuario: *${input.username}*.\n` +
      `Estado: *${license.message}*.\n` +
      `Codigo: *${code}*.\n` +
      `Vence: *${formatLocalDateTime(expiresAt)}*.\n`;

    await sendWhatsApp(config.app.telefonoSoporte, mensaje);

    return {
      activationId,
      expiresAt: expiresAt.toISOString(),
      license,
    };
  },

  async activateWithCode(
    pool: DbPool,
    input: { activationId: string; code: string },
  ): Promise<{ license: LicenseStatus; userId: number | null }> {
    await ensureLicenseTables(pool);

    const tx = pool.transaction();
    await tx.begin();
    let committed = false;
    let userId: number | null = null;

    try {
      const activation = await tx.request()
        .input('id', sql.UniqueIdentifier, input.activationId)
        .query(`
          SELECT TOP 1 ACTIVACION_ID, USUARIO_ID, CODIGO_HASH, FECHA_EXPIRACION, FECHA_USO, INTENTOS
          FROM dbo.LICENCIA_ACTIVACIONES WITH (UPDLOCK, HOLDLOCK)
          WHERE ACTIVACION_ID = @id
        `);

      const row = activation.recordset[0];
      if (!row) {
        throw Object.assign(new Error('Codigo de activacion no encontrado.'), { name: 'ValidationError' });
      }
      if (row.FECHA_USO) {
        throw Object.assign(new Error('Este codigo ya fue utilizado.'), { name: 'ValidationError' });
      }
      if (new Date(row.FECHA_EXPIRACION) < new Date()) {
        throw Object.assign(new Error('El codigo de activacion vencio.'), { name: 'ValidationError' });
      }
      if ((row.INTENTOS ?? 0) >= MAX_ACTIVATION_ATTEMPTS) {
        throw Object.assign(new Error('Se supero el limite de intentos para este codigo.'), { name: 'ValidationError' });
      }

      const expectedHash = hashCode(input.activationId, input.code);
      if (expectedHash !== row.CODIGO_HASH) {
        await tx.request()
          .input('id', sql.UniqueIdentifier, input.activationId)
          .query(`UPDATE dbo.LICENCIA_ACTIVACIONES SET INTENTOS = INTENTOS + 1 WHERE ACTIVACION_ID = @id`);
        await tx.commit();
        committed = true;
        throw Object.assign(new Error('Codigo de activacion incorrecto.'), { name: 'ValidationError' });
      }

      const newExpiration = new Date(Date.now() + 31 * DAY_MS);
      await tx.request()
        .input('fecha', sql.DateTime, newExpiration)
        .query(`
          IF EXISTS (SELECT 1 FROM dbo.VENCIMIENTO)
            UPDATE dbo.VENCIMIENTO SET FECHA_VENCIMIENTO = @fecha;
          ELSE
            INSERT INTO dbo.VENCIMIENTO (FECHA_VENCIMIENTO) VALUES (@fecha);
        `);

      await tx.request()
        .input('id', sql.UniqueIdentifier, input.activationId)
        .query(`UPDATE dbo.LICENCIA_ACTIVACIONES SET FECHA_USO = SYSUTCDATETIME() WHERE ACTIVACION_ID = @id`);

      userId = row.USUARIO_ID ?? null;
      await tx.commit();
      committed = true;
    } catch (err) {
      if (!committed) {
        await tx.rollback();
      }
      throw err;
    }

    return {
      license: await licenseService.validateAccess(pool),
      userId,
    };
  },
};