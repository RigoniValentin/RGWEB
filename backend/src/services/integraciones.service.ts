import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getPool, sql } from '../database/connection.js';
import type {
  ApiKey,
  ApiKeyCreated,
  IntegracionesConfig,
  SyncLog,
  SyncDirection,
  SyncStatus,
  StockSyncItem,
  MobileDevice,
} from '../types/integraciones.js';

// ═══════════════════════════════════════════════════
//  Integraciones Service
//  - Gestión de API Keys (creación, listado, revocación)
//  - Lectura/escritura de configuración K/V
//  - Bitácora de sincronizaciones
//  - Helpers de stock para tienda online
// ═══════════════════════════════════════════════════

const KEY_PREFIX_LEN = 8;
const CONFIG_KEYS = [
  'webhook_url',
  'webhook_secret',
  'webhook_enabled',
  'webhook_max_retries',
  'orders_default_cliente_id',
  'orders_default_punto_venta_id',
] as const;

type ConfigKey = (typeof CONFIG_KEYS)[number];

/**
 * Comprueba/crea las tablas y la columna VENTA_WEB.
 * Idempotente — equivalente al .sql, ejecutado al arrancar el servidor
 * para que el módulo funcione aún si el DBA no corrió la migración.
 */
async function ensureTables(): Promise<void> {
  const pool = await getPool();
  await pool.request().batch(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[INTEGRACIONES_API_KEYS]') AND type IN (N'U'))
    BEGIN
      CREATE TABLE INTEGRACIONES_API_KEYS (
        API_KEY_ID     INT IDENTITY(1,1) PRIMARY KEY,
        NOMBRE         NVARCHAR(120)  NOT NULL,
        KEY_PREFIX     NVARCHAR(16)   NOT NULL,
        KEY_HASH       NVARCHAR(255)  NOT NULL,
        SCOPES         NVARCHAR(500)  NULL,
        ACTIVA         BIT            NOT NULL DEFAULT 1,
        CREATED_AT     DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),
        LAST_USED_AT   DATETIME2(0)   NULL,
        REVOKED_AT     DATETIME2(0)   NULL,
        CREATED_BY     INT            NULL,
        NOTAS          NVARCHAR(500)  NULL
      );
      CREATE INDEX IX_INTEGRACIONES_API_KEYS_ACTIVA ON INTEGRACIONES_API_KEYS(ACTIVA);
      CREATE INDEX IX_INTEGRACIONES_API_KEYS_PREFIX ON INTEGRACIONES_API_KEYS(KEY_PREFIX);
    END
  `);
  await pool.request().batch(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[INTEGRACIONES_CONFIG]') AND type IN (N'U'))
    BEGIN
      CREATE TABLE INTEGRACIONES_CONFIG (
        CLAVE       NVARCHAR(60)   NOT NULL PRIMARY KEY,
        VALOR       NVARCHAR(MAX)  NULL,
        UPDATED_AT  DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),
        UPDATED_BY  INT            NULL
      );
    END
  `);
  await pool.request().batch(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[INTEGRACIONES_SYNC_LOGS]') AND type IN (N'U'))
    BEGIN
      CREATE TABLE INTEGRACIONES_SYNC_LOGS (
        LOG_ID         INT IDENTITY(1,1) PRIMARY KEY,
        EVENT_TYPE     NVARCHAR(60)   NOT NULL,
        DIRECTION      NVARCHAR(10)   NOT NULL,
        STATUS         NVARCHAR(10)   NOT NULL,
        HTTP_STATUS    INT            NULL,
        TARGET_URL     NVARCHAR(500)  NULL,
        REQUEST_BODY   NVARCHAR(MAX)  NULL,
        RESPONSE_BODY  NVARCHAR(MAX)  NULL,
        ERROR_MESSAGE  NVARCHAR(MAX)  NULL,
        DURATION_MS    INT            NULL,
        API_KEY_ID     INT            NULL,
        CREATED_AT     DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME()
      );
      CREATE INDEX IX_INTEGRACIONES_SYNC_LOGS_CREATED ON INTEGRACIONES_SYNC_LOGS(CREATED_AT DESC);
    END
  `);
  await pool.request().batch(`
    IF COL_LENGTH('dbo.PRODUCTOS', 'VENTA_WEB') IS NULL
      ALTER TABLE PRODUCTOS ADD VENTA_WEB BIT NOT NULL CONSTRAINT DF_PRODUCTOS_VENTA_WEB DEFAULT 0;
  `);

  // EXPIRES_AT en API keys — usado para claves efímeras (mobile tunnel QR)
  await pool.request().batch(`
    IF COL_LENGTH('dbo.INTEGRACIONES_API_KEYS', 'EXPIRES_AT') IS NULL
      ALTER TABLE INTEGRACIONES_API_KEYS ADD EXPIRES_AT DATETIME2(0) NULL;
  `);

  // Dispositivos mobile registrados contra una API key
  await pool.request().batch(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[INTEGRACIONES_MOBILE_DEVICES]') AND type IN (N'U'))
    BEGIN
      CREATE TABLE INTEGRACIONES_MOBILE_DEVICES (
        DEVICE_ID      INT IDENTITY(1,1) PRIMARY KEY,
        API_KEY_ID     INT            NULL,
        DEVICE_NAME    NVARCHAR(120)  NOT NULL,
        DEVICE_UUID    NVARCHAR(100)  NOT NULL,
        REGISTERED_AT  DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),
        LAST_SEEN_AT   DATETIME2(0)   NULL,
        LAST_IP        NVARCHAR(50)   NULL,
        REVOKED_AT     DATETIME2(0)   NULL,
        CONSTRAINT UQ_MOBILE_DEVICES_UUID UNIQUE (DEVICE_UUID),
        CONSTRAINT FK_MOBILE_DEVICES_API_KEY FOREIGN KEY (API_KEY_ID) REFERENCES INTEGRACIONES_API_KEYS(API_KEY_ID) ON DELETE SET NULL
      );
      CREATE INDEX IX_MOBILE_DEVICES_KEY ON INTEGRACIONES_MOBILE_DEVICES(API_KEY_ID);
      CREATE INDEX IX_MOBILE_DEVICES_REGISTERED ON INTEGRACIONES_MOBILE_DEVICES(REGISTERED_AT DESC);
    END
    ELSE
    BEGIN
      -- Migración: API_KEY_ID pasa a NULLABLE con ON DELETE SET NULL
      -- para que eliminar una API key no rompa por FK y preserve historial.
      IF COL_LENGTH('dbo.INTEGRACIONES_MOBILE_DEVICES', 'API_KEY_ID') IS NOT NULL
        AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.INTEGRACIONES_MOBILE_DEVICES') AND name = 'API_KEY_ID' AND is_nullable = 0)
        ALTER TABLE INTEGRACIONES_MOBILE_DEVICES ALTER COLUMN API_KEY_ID INT NULL;

      -- Reemplazar el FK si existe sin la opción SET NULL
      IF EXISTS (
        SELECT 1 FROM sys.foreign_keys fk
        JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
        WHERE fk.name = 'FK_MOBILE_DEVICES_API_KEY'
          AND fk.delete_referential_action <> 2 -- 2 = SET NULL
      )
      BEGIN
        ALTER TABLE INTEGRACIONES_MOBILE_DEVICES DROP CONSTRAINT FK_MOBILE_DEVICES_API_KEY;
        ALTER TABLE INTEGRACIONES_MOBILE_DEVICES ADD CONSTRAINT FK_MOBILE_DEVICES_API_KEY
          FOREIGN KEY (API_KEY_ID) REFERENCES INTEGRACIONES_API_KEYS(API_KEY_ID) ON DELETE SET NULL;
      END
    END
  `);

  // Semilla de claves de configuración
  for (const k of CONFIG_KEYS) {
    const defaultValue = k === 'webhook_enabled' ? '0' : k === 'webhook_max_retries' ? '3' : null;
    await pool.request()
      .input('k', sql.NVarChar(60), k)
      .input('v', sql.NVarChar(sql.MAX), defaultValue)
      .query(`IF NOT EXISTS (SELECT 1 FROM INTEGRACIONES_CONFIG WHERE CLAVE = @k)
              INSERT INTO INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES (@k, @v)`);
  }
}

// ── API KEYS ───────────────────────────────────────────────────────

function rowToApiKey(r: any): ApiKey {
  return {
    API_KEY_ID: r.API_KEY_ID,
    NOMBRE: r.NOMBRE,
    KEY_PREFIX: r.KEY_PREFIX,
    SCOPES: r.SCOPES,
    ACTIVA: !!r.ACTIVA,
    CREATED_AT: r.CREATED_AT,
    LAST_USED_AT: r.LAST_USED_AT,
    REVOKED_AT: r.REVOKED_AT,
    CREATED_BY: r.CREATED_BY,
    NOTAS: r.NOTAS,
    EXPIRES_AT: r.EXPIRES_AT ?? null,
  };
}

async function listApiKeys(): Promise<ApiKey[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT API_KEY_ID, NOMBRE, KEY_PREFIX, SCOPES, ACTIVA,
           CREATED_AT, LAST_USED_AT, REVOKED_AT, CREATED_BY, NOTAS, EXPIRES_AT
    FROM INTEGRACIONES_API_KEYS
    ORDER BY API_KEY_ID DESC
  `);
  return r.recordset.map(rowToApiKey);
}

async function createApiKey(
  nombre: string,
  scopes: string | null,
  notas: string | null,
  createdBy: number | null,
  expiresAt: Date | null = null
): Promise<ApiKeyCreated> {
  if (!nombre || nombre.trim().length === 0) {
    const e: any = new Error('El nombre es obligatorio');
    e.name = 'ValidationError';
    throw e;
  }
  // 32 bytes -> 64 chars hex
  const rawKey = `rg_${crypto.randomBytes(32).toString('hex')}`;
  const prefix = rawKey.slice(0, KEY_PREFIX_LEN);
  const hash = await bcrypt.hash(rawKey, 10);

  const pool = await getPool();
  const r = await pool.request()
    .input('nombre', sql.NVarChar(120), nombre.trim())
    .input('prefix', sql.NVarChar(16), prefix)
    .input('hash', sql.NVarChar(255), hash)
    .input('scopes', sql.NVarChar(500), scopes)
    .input('notas', sql.NVarChar(500), notas)
    .input('createdBy', sql.Int, createdBy)
    .input('expiresAt', sql.DateTime2(0), expiresAt)
    .query(`
      INSERT INTO INTEGRACIONES_API_KEYS (NOMBRE, KEY_PREFIX, KEY_HASH, SCOPES, NOTAS, CREATED_BY, EXPIRES_AT)
      OUTPUT INSERTED.API_KEY_ID, INSERTED.NOMBRE, INSERTED.KEY_PREFIX, INSERTED.SCOPES,
             INSERTED.ACTIVA, INSERTED.CREATED_AT, INSERTED.LAST_USED_AT, INSERTED.REVOKED_AT,
             INSERTED.CREATED_BY, INSERTED.NOTAS, INSERTED.EXPIRES_AT
      VALUES (@nombre, @prefix, @hash, @scopes, @notas, @createdBy, @expiresAt)
    `);
  return { ...rowToApiKey(r.recordset[0]), RAW_KEY: rawKey };
}

/**
 * Revoca todas las API keys activas que tengan scope 'mobile' (excepto
 * el ID provisto, útil para mantener la recién creada).
 */
async function revokeMobileKeysExcept(exceptId: number | null = null): Promise<number> {
  const pool = await getPool();
  const req = pool.request()
    .input('scope', sql.NVarChar(500), '%mobile%');
  let where = `ACTIVA = 1 AND SCOPES LIKE @scope`;
  if (exceptId != null) {
    where += ` AND API_KEY_ID <> @exceptId`;
    req.input('exceptId', sql.Int, exceptId);
  }
  const r = await req.query(`
    UPDATE INTEGRACIONES_API_KEYS
    SET ACTIVA = 0, REVOKED_AT = SYSDATETIME()
    WHERE ${where};
    SELECT @@ROWCOUNT AS affected;
  `);
  return Number(r.recordset?.[0]?.affected ?? 0);
}

/**
 * Crea una API key efímera scope 'mobile' con expiración a 30 días.
 * Revoca cualquier otra mobile activa antes de crearla.
 * Devuelve { key, rawKey, expiresAt }.
 */
async function createEphemeralMobileKey(
  deviceName: string,
  createdBy: number | null
): Promise<{ key: ApiKeyCreated; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 días
  const nombre = `mobile-${deviceName}`.slice(0, 120);
  const notas = `Generada automáticamente para conexión vía Cloudflare Tunnel. Expira el ${expiresAt.toISOString().slice(0, 10)}.`;

  const created = await createApiKey(nombre, 'mobile', notas, createdBy, expiresAt);
  // Revocar otras mobile (mantener la recién creada)
  await revokeMobileKeysExcept(created.API_KEY_ID);
  return { key: created, expiresAt };
}

/**
 * Crea un "registration token" — una API key con scope 'mobile_register'
 * que se mete en el QR. Es de un solo uso: cuando un device la presenta
 * al endpoint /api/mobile/register-device, se canjea por una API key
 * scope 'mobile' propia del device.
 *
 * A diferencia de createEphemeralMobileKey, NO revoca otras mobile_register:
 * queremos permitir que múltiples devices se registren contra el mismo QR.
 * Una vez que todos los devices se registran (o al refrescar el QR), el
 * operador puede revocar las register-keys sobrantes con cleanup.
 */
async function createRegistrationToken(
  createdBy: number | null
): Promise<{ apiKey: ApiKeyCreated; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const nombre = `mobile-register-${Date.now()}`.slice(0, 120);
  const notas = `Token de registro de devices mobile (one-time use). Expira el ${expiresAt.toISOString().slice(0, 10)}.`;
  const apiKey = await createApiKey(nombre, 'mobile_register', notas, createdBy, expiresAt);
  return { apiKey, expiresAt };
}

/**
 * Canjea un registration token por una API key scope 'mobile' propia del device.
 *
 * Comportamiento:
 *   - Si el UUID NO existe en INTEGRACIONES_MOBILE_DEVICES → INSERT nuevo row.
 *   - Si el UUID YA existe (activo, revocado o huérfano) → UPSERT del row
 *     existente: se crea nueva API key, se revoca la anterior, se actualiza
 *     DEVICE_NAME y se limpia REVOKED_AT. Esto evita violación del UNIQUE
 *     constraint cuando el operador le pide al device re-escanear.
 *   - El registration token se revoca tras un solo uso (one-time).
 */
async function registerMobileDevice(opts: {
  registrationToken: string;
  deviceName: string;
  deviceUuid: string;
  ip?: string | null;
}): Promise<{ apiKey: ApiKeyCreated; deviceId: number; expiresAt: Date }> {
  const { registrationToken, deviceName, deviceUuid, ip } = opts;

  if (!registrationToken || !deviceName?.trim() || !deviceUuid?.trim()) {
    const e: any = new Error('Faltan datos: registrationToken, deviceName y deviceUuid son requeridos');
    e.name = 'ValidationError';
    throw e;
  }

  const trimmedUuid = deviceUuid.trim();
  const safeName = deviceName.trim().slice(0, 120);

  // ── 1) Validar el registration token ──
  const prefix = registrationToken.slice(0, KEY_PREFIX_LEN);
  const pool = await getPool();
  const lookup = await pool.request()
    .input('prefix', sql.NVarChar(16), prefix)
    .query(`SELECT API_KEY_ID, KEY_HASH, SCOPES, ACTIVA, EXPIRES_AT
            FROM INTEGRACIONES_API_KEYS
            WHERE KEY_PREFIX = @prefix`);
  let regKeyId: number | null = null;
  for (const row of lookup.recordset) {
    if (!(await bcrypt.compare(registrationToken, row.KEY_HASH))) continue;
    if (!row.ACTIVA) throw Object.assign(new Error('Token de registro revocado o ya utilizado'), { name: 'ValidationError' });
    if (row.EXPIRES_AT && new Date(row.EXPIRES_AT).getTime() < Date.now()) {
      throw Object.assign(new Error('Token de registro expirado'), { name: 'ValidationError' });
    }
    if (!row.SCOPES || !row.SCOPES.includes('mobile_register')) {
      throw Object.assign(new Error('Token inválido para este endpoint'), { name: 'ValidationError' });
    }
    regKeyId = row.API_KEY_ID;
    break;
  }
  if (!regKeyId) {
    throw Object.assign(new Error('Token de registro inválido'), { name: 'ValidationError' });
  }

  // ── 2) Crear nueva API key scope 'mobile' ──
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const notas = `Device UUID: ${trimmedUuid}. Registrado vía QR mobile tunnel.`;
  const apiKey = await createApiKey(`mobile-device:${safeName}`, 'mobile', notas, null, expiresAt);

  // ── 3) UPSERT del row del device por UUID ──
  let deviceId: number;
  const existing = await pool.request()
    .input('uuid', sql.NVarChar(100), trimmedUuid)
    .query(`SELECT TOP 1 DEVICE_ID, API_KEY_ID
            FROM INTEGRACIONES_MOBILE_DEVICES
            WHERE DEVICE_UUID = @uuid`);

  if (existing.recordset.length > 0) {
    // El device ya existía (activo, revocado u huérfano). Re-vincular.
    const oldKeyId = existing.recordset[0].API_KEY_ID as number | null;
    deviceId = existing.recordset[0].DEVICE_ID as number;

    // Revocar la API key anterior si tenía una y era distinta a la nueva
    if (oldKeyId && oldKeyId !== apiKey.API_KEY_ID) {
      await pool.request()
        .input('id', sql.Int, oldKeyId)
        .query(`UPDATE INTEGRACIONES_API_KEYS
                SET ACTIVA = 0, REVOKED_AT = SYSDATETIME()
                WHERE API_KEY_ID = @id AND ACTIVA = 1`);
    }

    // Actualizar el row existente: nueva key, nuevo nombre, reset REVOKED
    await pool.request()
      .input('id', sql.Int, deviceId)
      .input('keyId', sql.Int, apiKey.API_KEY_ID)
      .input('name', sql.NVarChar(120), safeName)
      .input('ip', sql.NVarChar(50), ip ?? null)
      .query(`UPDATE INTEGRACIONES_MOBILE_DEVICES
              SET API_KEY_ID    = @keyId,
                  DEVICE_NAME   = @name,
                  REVOKED_AT    = NULL,
                  LAST_IP       = COALESCE(@ip, LAST_IP),
                  REGISTERED_AT = SYSDATETIME()
              WHERE DEVICE_ID = @id`);
  } else {
    // Primer registro de este UUID → INSERT
    const insert = await pool.request()
      .input('keyId', sql.Int, apiKey.API_KEY_ID)
      .input('name', sql.NVarChar(120), safeName)
      .input('uuid', sql.NVarChar(100), trimmedUuid)
      .input('ip', sql.NVarChar(50), ip ?? null)
      .query(`INSERT INTO INTEGRACIONES_MOBILE_DEVICES (API_KEY_ID, DEVICE_NAME, DEVICE_UUID, LAST_IP)
              OUTPUT INSERTED.DEVICE_ID
              VALUES (@keyId, @name, @uuid, @ip)`);
    deviceId = insert.recordset[0].DEVICE_ID as number;
  }

  // ── 4) Revocar el registration token (one-time use) ──
  await pool.request()
    .input('id', sql.Int, regKeyId)
    .query(`UPDATE INTEGRACIONES_API_KEYS
            SET ACTIVA = 0, REVOKED_AT = SYSDATETIME()
            WHERE API_KEY_ID = @id AND ACTIVA = 1`);

  return { apiKey, deviceId, expiresAt };
}

async function listMobileDevices(): Promise<MobileDevice[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT
      d.DEVICE_ID, d.API_KEY_ID, d.DEVICE_NAME, d.DEVICE_UUID,
      d.REGISTERED_AT, d.LAST_SEEN_AT, d.LAST_IP, d.REVOKED_AT,
      k.KEY_PREFIX, k.EXPIRES_AT, k.REVOKED_AT AS KEY_REVOKED_AT, k.ACTIVA AS KEY_ACTIVA
    FROM INTEGRACIONES_MOBILE_DEVICES d
    LEFT JOIN INTEGRACIONES_API_KEYS k ON k.API_KEY_ID = d.API_KEY_ID
    ORDER BY d.REGISTERED_AT DESC
  `);
  return r.recordset as MobileDevice[];
}

async function revokeMobileDevice(deviceId: number): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, deviceId)
    .query(`UPDATE d SET d.REVOKED_AT = SYSDATETIME()
            FROM INTEGRACIONES_MOBILE_DEVICES d
            WHERE d.DEVICE_ID = @id AND d.REVOKED_AT IS NULL`);
  // También revocamos la API key asociada
  await pool.request()
    .input('id', sql.Int, deviceId)
    .query(`UPDATE k SET k.ACTIVA = 0, k.REVOKED_AT = SYSDATETIME()
            FROM INTEGRACIONES_API_KEYS k
            JOIN INTEGRACIONES_MOBILE_DEVICES d ON d.API_KEY_ID = k.API_KEY_ID
            WHERE d.DEVICE_ID = @id AND k.ACTIVA = 1`);
}

/**
 * Desvincula un device de su API key sin eliminar el device row.
 *   - Setea device.API_KEY_ID = NULL
 *   - Revoca la API key (queda inactiva pero en el historial)
 *   - Marca el device como REVOKED para que no aparezca "activo"
 * Útil cuando querés desvincular limpiamente un device pero mantener
 * la historia de quién estaba registrado.
 */
async function unlinkMobileDevice(deviceId: number): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, deviceId)
    .query(`UPDATE d SET d.REVOKED_AT = SYSDATETIME(), d.API_KEY_ID = NULL
            FROM INTEGRACIONES_MOBILE_DEVICES d
            WHERE d.DEVICE_ID = @id`);
  // Revocar la API key (sigue en DB, queda marcada como revocada)
  await pool.request()
    .input('id', sql.Int, deviceId)
    .query(`UPDATE k SET k.ACTIVA = 0, k.REVOKED_AT = SYSDATETIME()
            FROM INTEGRACIONES_API_KEYS k
            WHERE k.API_KEY_ID IN (
              SELECT API_KEY_ID FROM INTEGRACIONES_MOBILE_DEVICES
              WHERE DEVICE_ID = @id AND API_KEY_ID IS NOT NULL
            )
              AND k.ACTIVA = 1`);
}

/**
 * Elimina físicamente el row de un device. No toca la API key asociada.
 * Use case: limpiar devices huérfanos (los que quedaron sin API_KEY_ID
 * tras un DELETE de la key).
 */
async function deleteMobileDevice(deviceId: number): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, deviceId)
    .query(`DELETE FROM INTEGRACIONES_MOBILE_DEVICES WHERE DEVICE_ID = @id`);
}

/** Cantidad de devices vinculados (API_KEY_ID NOT NULL y no revoked) a una API key. */
async function countActiveDevicesForKey(apiKeyId: number): Promise<number> {
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.Int, apiKeyId)
    .query(`SELECT COUNT(*) AS n FROM INTEGRACIONES_MOBILE_DEVICES
            WHERE API_KEY_ID = @id AND REVOKED_AT IS NULL`);
  return Number(r.recordset[0]?.n ?? 0);
}

/** Toca last_seen del device que matchea la API key. Best-effort. */
async function recordDeviceSeen(apiKeyId: number, ip: string | null): Promise<void> {
  try {
    const pool = await getPool();
    await pool.request()
      .input('keyId', sql.Int, apiKeyId)
      .input('ip', sql.NVarChar(50), ip ?? null)
      .query(`UPDATE INTEGRACIONES_MOBILE_DEVICES
              SET LAST_SEEN_AT = SYSDATETIME(), LAST_IP = COALESCE(@ip, LAST_IP)
              WHERE API_KEY_ID = @keyId AND REVOKED_AT IS NULL`);
  } catch (e) {
    // No crítico — no debe romper el request principal
    console.error('[integraciones] recordDeviceSeen error:', (e as Error).message);
  }
}

/** Devuelve el device asociado a una API key (si existe). */
async function getDeviceByApiKeyId(apiKeyId: number): Promise<MobileDevice | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('keyId', sql.Int, apiKeyId)
    .query(`SELECT TOP 1
              d.DEVICE_ID, d.API_KEY_ID, d.DEVICE_NAME, d.DEVICE_UUID,
              d.REGISTERED_AT, d.LAST_SEEN_AT, d.LAST_IP, d.REVOKED_AT,
              k.KEY_PREFIX, k.EXPIRES_AT, k.REVOKED_AT AS KEY_REVOKED_AT, k.ACTIVA AS KEY_ACTIVA
            FROM INTEGRACIONES_MOBILE_DEVICES d
            JOIN INTEGRACIONES_API_KEYS k ON k.API_KEY_ID = d.API_KEY_ID
            WHERE d.API_KEY_ID = @keyId
            ORDER BY d.REGISTERED_AT DESC`);
  return (r.recordset[0] as MobileDevice) ?? null;
}

async function revokeApiKey(id: number): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, id)
    .query(`UPDATE INTEGRACIONES_API_KEYS
            SET ACTIVA = 0, REVOKED_AT = SYSDATETIME()
            WHERE API_KEY_ID = @id`);
}

async function deleteApiKey(id: number): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, id)
    .query(`DELETE FROM INTEGRACIONES_API_KEYS WHERE API_KEY_ID = @id`);
}

/**
 * Valida la apiKey enviada por el VPS contra los hashes activos en DB.
 * Devuelve el ID si es válida, null en caso contrario.
 *
 * Optimización: filtra primero por KEY_PREFIX (índice) para no recorrer
 * todos los registros con bcrypt.
 */
async function verifyApiKey(rawKey: string): Promise<number | null> {
  if (!rawKey || typeof rawKey !== 'string' || rawKey.length < KEY_PREFIX_LEN) {
    return null;
  }
  const prefix = rawKey.slice(0, KEY_PREFIX_LEN);
  const pool = await getPool();
  const r = await pool.request()
    .input('prefix', sql.NVarChar(16), prefix)
    .query(`SELECT API_KEY_ID, KEY_HASH, EXPIRES_AT
            FROM INTEGRACIONES_API_KEYS
            WHERE KEY_PREFIX = @prefix AND ACTIVA = 1
              AND (EXPIRES_AT IS NULL OR EXPIRES_AT > SYSDATETIME())`);

  for (const row of r.recordset) {
    if (await bcrypt.compare(rawKey, row.KEY_HASH)) {
      // touch last_used_at (best-effort, no await blocking)
      pool.request()
        .input('id', sql.Int, row.API_KEY_ID)
        .query(`UPDATE INTEGRACIONES_API_KEYS SET LAST_USED_AT = SYSDATETIME() WHERE API_KEY_ID = @id`)
        .catch(() => {});
      return row.API_KEY_ID as number;
    }
  }
  return null;
}

// ── CONFIG ─────────────────────────────────────────────────────────

async function getConfig(): Promise<IntegracionesConfig> {
  const pool = await getPool();
  const r = await pool.request().query(`SELECT CLAVE, VALOR FROM INTEGRACIONES_CONFIG`);
  const map: Record<string, string | null> = {};
  for (const row of r.recordset) map[row.CLAVE] = row.VALOR;
  return {
    webhook_url: map.webhook_url || null,
    webhook_secret: map.webhook_secret || null,
    webhook_enabled: map.webhook_enabled === '1' || map.webhook_enabled === 'true',
    webhook_max_retries: parseInt(map.webhook_max_retries || '3', 10),
    orders_default_cliente_id: map.orders_default_cliente_id ? parseInt(map.orders_default_cliente_id, 10) : null,
    orders_default_punto_venta_id: map.orders_default_punto_venta_id ? parseInt(map.orders_default_punto_venta_id, 10) : null,
  };
}

async function setConfig(partial: Partial<IntegracionesConfig>, userId: number | null): Promise<IntegracionesConfig> {
  const pool = await getPool();
  const entries: { clave: ConfigKey; valor: string | null }[] = [];

  if ('webhook_url' in partial) entries.push({ clave: 'webhook_url', valor: partial.webhook_url ?? null });
  if ('webhook_secret' in partial) entries.push({ clave: 'webhook_secret', valor: partial.webhook_secret ?? null });
  if ('webhook_enabled' in partial) entries.push({ clave: 'webhook_enabled', valor: partial.webhook_enabled ? '1' : '0' });
  if ('webhook_max_retries' in partial) entries.push({ clave: 'webhook_max_retries', valor: String(partial.webhook_max_retries ?? 3) });
  if ('orders_default_cliente_id' in partial) entries.push({ clave: 'orders_default_cliente_id', valor: partial.orders_default_cliente_id != null ? String(partial.orders_default_cliente_id) : null });
  if ('orders_default_punto_venta_id' in partial) entries.push({ clave: 'orders_default_punto_venta_id', valor: partial.orders_default_punto_venta_id != null ? String(partial.orders_default_punto_venta_id) : null });

  for (const { clave, valor } of entries) {
    await pool.request()
      .input('k', sql.NVarChar(60), clave)
      .input('v', sql.NVarChar(sql.MAX), valor)
      .input('u', sql.Int, userId)
      .query(`
        MERGE INTEGRACIONES_CONFIG AS t
        USING (SELECT @k AS CLAVE) AS s ON t.CLAVE = s.CLAVE
        WHEN MATCHED THEN UPDATE SET VALOR = @v, UPDATED_AT = SYSDATETIME(), UPDATED_BY = @u
        WHEN NOT MATCHED THEN INSERT (CLAVE, VALOR, UPDATED_BY) VALUES (@k, @v, @u);
      `);
  }
  return getConfig();
}

// ── LOGS ───────────────────────────────────────────────────────────

interface LogInput {
  eventType: string;
  direction: SyncDirection;
  status: SyncStatus;
  httpStatus?: number | null;
  targetUrl?: string | null;
  requestBody?: unknown;
  responseBody?: unknown;
  errorMessage?: string | null;
  durationMs?: number | null;
  apiKeyId?: number | null;
}

function safeStringify(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.length > 8000 ? v.slice(0, 8000) + '…' : v;
  try {
    const s = JSON.stringify(v);
    return s.length > 8000 ? s.slice(0, 8000) + '…' : s;
  } catch {
    return null;
  }
}

async function log(input: LogInput): Promise<void> {
  try {
    const pool = await getPool();
    await pool.request()
      .input('event', sql.NVarChar(60), input.eventType)
      .input('dir', sql.NVarChar(10), input.direction)
      .input('status', sql.NVarChar(10), input.status)
      .input('http', sql.Int, input.httpStatus ?? null)
      .input('url', sql.NVarChar(500), input.targetUrl ?? null)
      .input('req', sql.NVarChar(sql.MAX), safeStringify(input.requestBody))
      .input('res', sql.NVarChar(sql.MAX), safeStringify(input.responseBody))
      .input('err', sql.NVarChar(sql.MAX), input.errorMessage ?? null)
      .input('dur', sql.Int, input.durationMs ?? null)
      .input('key', sql.Int, input.apiKeyId ?? null)
      .query(`
        INSERT INTO INTEGRACIONES_SYNC_LOGS
          (EVENT_TYPE, DIRECTION, STATUS, HTTP_STATUS, TARGET_URL,
           REQUEST_BODY, RESPONSE_BODY, ERROR_MESSAGE, DURATION_MS, API_KEY_ID)
        VALUES (@event, @dir, @status, @http, @url, @req, @res, @err, @dur, @key)
      `);
  } catch (e) {
    // No queremos que el logging tire abajo la operación principal
    console.error('[integraciones] log error:', (e as Error).message);
  }
}

async function listLogs(limit = 10): Promise<SyncLog[]> {
  const pool = await getPool();
  const r = await pool.request()
    .input('lim', sql.Int, Math.max(1, Math.min(limit, 200)))
    .query(`
      SELECT TOP (@lim) *
      FROM INTEGRACIONES_SYNC_LOGS
      ORDER BY CREATED_AT DESC, LOG_ID DESC
    `);
  return r.recordset as SyncLog[];
}

// ── STOCK PARA TIENDA ──────────────────────────────────────────────

/**
 * Devuelve el snapshot de stock de productos marcados como VENTA_WEB=1.
 * Suma el stock de todos los depósitos.
 */
async function getStockParaTienda(opts: { productoIds?: number[] } = {}): Promise<StockSyncItem[]> {
  const pool = await getPool();
  const req = pool.request();
  let extraFilter = '';
  if (opts.productoIds && opts.productoIds.length > 0) {
    const ids = opts.productoIds.slice(0, 500);
    ids.forEach((id, i) => req.input(`pid${i}`, sql.Int, id));
    extraFilter = ` AND p.PRODUCTO_ID IN (${ids.map((_, i) => `@pid${i}`).join(',')})`;
  }
  const r = await req.query(`
    SELECT
      p.PRODUCTO_ID,
      p.CODIGOPARTICULAR     AS CODIGO,
      p.NOMBRE,
      ISNULL((SELECT TOP 1 plp.PRECIO FROM PRODUCTO_LISTA_PRECIOS plp WHERE plp.PRODUCTO_ID = p.PRODUCTO_ID AND plp.LISTA_ID = ISNULL(p.LISTA_DEFECTO, 1)), 0) AS PRECIO,
      p.ACTIVO,
      (SELECT ISNULL(SUM(sd.CANTIDAD), 0) FROM STOCK_DEPOSITOS sd WHERE sd.PRODUCTO_ID = p.PRODUCTO_ID) AS STOCK,
      (SELECT TOP 1 cb.CODIGO_BARRAS FROM PRODUCTOS_COD_BARRAS cb WHERE cb.PRODUCTO_ID = p.PRODUCTO_ID) AS CODIGO_BARRAS
    FROM PRODUCTOS p
    WHERE p.VENTA_WEB = 1 ${extraFilter}
    ORDER BY p.NOMBRE
  `);
  return r.recordset.map((row: any) => ({
    PRODUCTO_ID: row.PRODUCTO_ID,
    CODIGO: row.CODIGO,
    NOMBRE: row.NOMBRE,
    PRECIO: Number(row.PRECIO || 0),
    STOCK: Number(row.STOCK || 0),
    ACTIVO: !!row.ACTIVO,
    CODIGO_BARRAS: row.CODIGO_BARRAS,
  }));
}

/** Verifica si un producto está marcado como VENTA_WEB */
async function isProductoVentaWeb(productoId: number): Promise<boolean> {
  const pool = await getPool();
  const r = await pool.request()
    .input('id', sql.Int, productoId)
    .query(`SELECT VENTA_WEB FROM PRODUCTOS WHERE PRODUCTO_ID = @id`);
  return r.recordset.length > 0 && !!r.recordset[0].VENTA_WEB;
}

export const integracionesService = {
  ensureTables,
  // api keys
  listApiKeys,
  createApiKey,
  revokeApiKey,
  deleteApiKey,
  verifyApiKey,
  createEphemeralMobileKey,
  createRegistrationToken,
  registerMobileDevice,
  listMobileDevices,
  revokeMobileDevice,
  unlinkMobileDevice,
  deleteMobileDevice,
  countActiveDevicesForKey,
  recordDeviceSeen,
  getDeviceByApiKeyId,
  revokeMobileKeysExcept,
  // config
  getConfig,
  setConfig,
  // logs
  log,
  listLogs,
  // stock
  getStockParaTienda,
  isProductoVentaWeb,
};
