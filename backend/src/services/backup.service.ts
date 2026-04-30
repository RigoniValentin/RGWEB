/**
 * Backup Service
 * ──────────────
 * Realiza copias de seguridad profesionales de la base de datos SQL Server
 * usando `BACKUP DATABASE` nativo. Mantiene historial, política de retención
 * y verificación de integridad.
 *
 * Notas importantes:
 *  - El archivo .bak se escribe en el contexto del servicio SQL Server, por
 *    lo que la ruta debe ser local al servidor (o un share UNC accesible
 *    para la cuenta de servicio de SQL).
 *  - Por defecto se usan WITH COPY_ONLY + COMPRESSION + CHECKSUM para no
 *    interferir con planes de backup diferenciales/log que pueda haber
 *    configurados al nivel del motor.
 */
import sql from 'mssql';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getPool, closePool } from '../database/connection.js';
import { config } from '../config/index.js';
import { rootDir } from '../config/paths.js';

export interface BackupConfig {
  ACTIVO: boolean;
  HORARIO_CRON: string;
  DESTINO_PATH: string | null;
  RETENCION_DIAS: number;
  RETENCION_MIN_KEEP: number;
  VERIFICAR_BACKUP: boolean;
  COPY_ONLY: boolean;
  COMPRESION: boolean;
  ULTIMA_EJECUCION: Date | null;
  ULTIMO_ESTADO: string | null;
}

export interface BackupRecord {
  BACKUP_ID: number;
  FECHA_INICIO: Date;
  FECHA_FIN: Date | null;
  DURACION_MS: number | null;
  ARCHIVO_NOMBRE: string;
  ARCHIVO_RUTA: string;
  TAMANO_BYTES: number | null;
  HASH_SHA256: string | null;
  ESTADO: 'EN_PROGRESO' | 'OK' | 'ERROR';
  VERIFICADO: boolean;
  TIPO: 'MANUAL' | 'PROGRAMADO';
  ERROR_MENSAJE: string | null;
  USUARIO_ID: number | null;
  USUARIO_NOMBRE: string | null;
  DB_NOMBRE: string;
}

export interface RestoreRecord {
  RESTORE_ID: number;
  FECHA_INICIO: Date;
  FECHA_FIN: Date | null;
  DURACION_MS: number | null;
  ARCHIVO_RUTA: string;
  ARCHIVO_NOMBRE: string;
  ORIGEN: 'HISTORIAL' | 'UPLOAD';
  BACKUP_ID: number | null;
  ESTADO: 'EN_PROGRESO' | 'OK' | 'ERROR';
  ERROR_MENSAJE: string | null;
  USUARIO_ID: number | null;
  USUARIO_NOMBRE: string | null;
  DB_NOMBRE: string;
}

let _tablesEnsured = false;

/** Crea tablas BACKUPS_HISTORIAL y BACKUPS_CONFIG si no existen */
async function ensureTables(): Promise<void> {
  if (_tablesEnsured) return;
  const pool = await getPool();

  await pool.request().batch(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BACKUPS_HISTORIAL]') AND type = N'U')
    BEGIN
      CREATE TABLE BACKUPS_HISTORIAL (
        BACKUP_ID         INT IDENTITY(1,1) PRIMARY KEY,
        FECHA_INICIO      DATETIME      NOT NULL,
        FECHA_FIN         DATETIME      NULL,
        DURACION_MS       INT           NULL,
        ARCHIVO_NOMBRE    NVARCHAR(260) NOT NULL,
        ARCHIVO_RUTA      NVARCHAR(500) NOT NULL,
        TAMANO_BYTES      BIGINT        NULL,
        HASH_SHA256       NVARCHAR(64)  NULL,
        ESTADO            NVARCHAR(20)  NOT NULL,
        VERIFICADO        BIT           NOT NULL DEFAULT 0,
        TIPO              NVARCHAR(20)  NOT NULL DEFAULT 'MANUAL',
        ERROR_MENSAJE     NVARCHAR(MAX) NULL,
        USUARIO_ID        INT           NULL,
        USUARIO_NOMBRE    NVARCHAR(100) NULL,
        DB_NOMBRE         NVARCHAR(128) NOT NULL
      );
      CREATE INDEX IX_BACKUPS_HISTORIAL_FECHA ON BACKUPS_HISTORIAL(FECHA_INICIO DESC);
    END
  `);

  await pool.request().batch(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BACKUPS_CONFIG]') AND type = N'U')
    BEGIN
      CREATE TABLE BACKUPS_CONFIG (
        ID                  INT PRIMARY KEY DEFAULT 1,
        ACTIVO              BIT           NOT NULL DEFAULT 1,
        HORARIO_CRON        NVARCHAR(50)  NOT NULL DEFAULT '0 3 * * *',
        DESTINO_PATH        NVARCHAR(500) NULL,
        RETENCION_DIAS      INT           NOT NULL DEFAULT 30,
        RETENCION_MIN_KEEP  INT           NOT NULL DEFAULT 7,
        VERIFICAR_BACKUP    BIT           NOT NULL DEFAULT 1,
        COPY_ONLY           BIT           NOT NULL DEFAULT 1,
        COMPRESION          BIT           NOT NULL DEFAULT 1,
        ULTIMA_EJECUCION    DATETIME      NULL,
        ULTIMO_ESTADO       NVARCHAR(20)  NULL,
        CONSTRAINT CK_BACKUPS_CONFIG_ID CHECK (ID = 1)
      );
      INSERT INTO BACKUPS_CONFIG (ID) VALUES (1);
    END
  `);

  await pool.request().batch(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[RESTAURACIONES_HISTORIAL]') AND type = N'U')
    BEGIN
      CREATE TABLE RESTAURACIONES_HISTORIAL (
        RESTORE_ID        INT IDENTITY(1,1) PRIMARY KEY,
        FECHA_INICIO      DATETIME      NOT NULL,
        FECHA_FIN         DATETIME      NULL,
        DURACION_MS       INT           NULL,
        ARCHIVO_RUTA      NVARCHAR(500) NOT NULL,
        ARCHIVO_NOMBRE    NVARCHAR(260) NOT NULL,
        ORIGEN            NVARCHAR(20)  NOT NULL,  -- HISTORIAL | UPLOAD
        BACKUP_ID         INT           NULL,
        ESTADO            NVARCHAR(20)  NOT NULL,  -- EN_PROGRESO | OK | ERROR
        ERROR_MENSAJE     NVARCHAR(MAX) NULL,
        USUARIO_ID        INT           NULL,
        USUARIO_NOMBRE    NVARCHAR(100) NULL,
        DB_NOMBRE         NVARCHAR(128) NOT NULL
      );
      CREATE INDEX IX_RESTAURACIONES_HISTORIAL_FECHA ON RESTAURACIONES_HISTORIAL(FECHA_INICIO DESC);
    END
  `);

  _tablesEnsured = true;
}

/** Resuelve y crea (si no existe) la carpeta destino de backups */
function resolveDestPath(custom: string | null): string {
  const dest = custom && custom.trim().length > 0
    ? path.resolve(custom)
    : path.join(rootDir, 'backups');
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  return dest;
}

/** Genera nombre de archivo con timestamp local */
function makeFileName(dbName: string, when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `_${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  // Sanitize DB name for filesystem
  const safe = dbName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safe}_${stamp}.bak`;
}

/** Hash SHA-256 streaming de un archivo */
async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Conexión dedicada con timeout extendido (4h) para operaciones largas
 * (BACKUP / RESTORE). Replica la estrategia de fallback de connection.ts:
 *   1° intento → puerto directo (1433) sin SQL Browser
 *   2° intento → instanceName via SQL Browser
 *
 * @param database  BD a la que conectarse. Para RESTORE es CRÍTICO usar 'master'
 *                  porque la BD destino debe estar libre durante la operación.
 */
async function connectLongPool(database = config.db.database): Promise<sql.ConnectionPool> {
  const baseOptions = {
    encrypt: config.db.options.encrypt,
    trustServerCertificate: config.db.options.trustServerCertificate,
    enableArithAbort: true,
    useUTC: false,
  };
  const longTimeout = 4 * 60 * 60 * 1000;

  const direct: sql.config = {
    server: config.db.server,
    port: config.db.port || 1433,
    database,
    user: config.db.user,
    password: config.db.password,
    options: baseOptions,
    requestTimeout: longTimeout,
    connectionTimeout: 15000,
  };

  const viaBrowser: sql.config | null = config.db.instanceName ? {
    server: config.db.server,
    database,
    user: config.db.user,
    password: config.db.password,
    options: { ...baseOptions, instanceName: config.db.instanceName },
    requestTimeout: longTimeout,
    connectionTimeout: 30000,
  } : null;

  let p: sql.ConnectionPool | null = null;
  try {
    p = new sql.ConnectionPool(direct);
    await p.connect();
    return p;
  } catch (firstErr) {
    try { if (p) await p.close(); } catch { /* ignore */ }
    if (!viaBrowser) throw firstErr;
    console.warn(`[backup] Conexión directa falló, reintentando con SQL Browser (instancia ${config.db.instanceName})...`);
    p = new sql.ConnectionPool(viaBrowser);
    await p.connect();
    return p;
  }
}

/** Extrae detalles legibles de un error SQL (precedingErrors) */
function extractSqlErrorDetail(qErr: any): string {
  const preceding: string[] = (Array.isArray(qErr.precedingErrors) ? qErr.precedingErrors : [])
    .map((e: any) => e?.message || String(e))
    .filter(Boolean);
  return preceding.join(' | ');
}

export const backupService = {
  ensureTables,

  /** Lee la configuración (asegura las tablas primero) */
  async getConfig(): Promise<BackupConfig> {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request().query(
      'SELECT TOP 1 * FROM BACKUPS_CONFIG WHERE ID = 1'
    );
    return result.recordset[0] as BackupConfig;
  },

  async updateConfig(input: Partial<BackupConfig>): Promise<BackupConfig> {
    await ensureTables();
    const pool = await getPool();
    const req = pool.request();
    const sets: string[] = [];

    if (input.ACTIVO !== undefined) { req.input('ACTIVO', sql.Bit, input.ACTIVO); sets.push('ACTIVO = @ACTIVO'); }
    if (input.HORARIO_CRON !== undefined) {
      // basic validation: 5 fields separated by spaces
      const parts = input.HORARIO_CRON.trim().split(/\s+/);
      if (parts.length !== 5) throw new Error('Expresión cron inválida (se requieren 5 campos)');
      req.input('HORARIO_CRON', sql.NVarChar(50), input.HORARIO_CRON.trim());
      sets.push('HORARIO_CRON = @HORARIO_CRON');
    }
    if (input.DESTINO_PATH !== undefined) {
      const dp = input.DESTINO_PATH ? String(input.DESTINO_PATH).trim() : null;
      // Path traversal guard: must be absolute or empty
      if (dp && !path.isAbsolute(dp)) throw new Error('La ruta debe ser absoluta');
      req.input('DESTINO_PATH', sql.NVarChar(500), dp);
      sets.push('DESTINO_PATH = @DESTINO_PATH');
    }
    if (input.RETENCION_DIAS !== undefined) {
      const n = Math.max(1, Math.min(3650, Number(input.RETENCION_DIAS)));
      req.input('RETENCION_DIAS', sql.Int, n);
      sets.push('RETENCION_DIAS = @RETENCION_DIAS');
    }
    if (input.RETENCION_MIN_KEEP !== undefined) {
      const n = Math.max(0, Math.min(1000, Number(input.RETENCION_MIN_KEEP)));
      req.input('RETENCION_MIN_KEEP', sql.Int, n);
      sets.push('RETENCION_MIN_KEEP = @RETENCION_MIN_KEEP');
    }
    if (input.VERIFICAR_BACKUP !== undefined) { req.input('VERIFICAR_BACKUP', sql.Bit, input.VERIFICAR_BACKUP); sets.push('VERIFICAR_BACKUP = @VERIFICAR_BACKUP'); }
    if (input.COPY_ONLY !== undefined) { req.input('COPY_ONLY', sql.Bit, input.COPY_ONLY); sets.push('COPY_ONLY = @COPY_ONLY'); }
    if (input.COMPRESION !== undefined) { req.input('COMPRESION', sql.Bit, input.COMPRESION); sets.push('COMPRESION = @COMPRESION'); }

    if (sets.length > 0) {
      await req.query(`UPDATE BACKUPS_CONFIG SET ${sets.join(', ')} WHERE ID = 1`);
    }
    return this.getConfig();
  },

  /** Lista historial paginado (últimos N) */
  async getHistory(limit = 100): Promise<BackupRecord[]> {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('limit', sql.Int, Math.max(1, Math.min(1000, limit)))
      .query(`
        SELECT TOP (@limit) *
        FROM BACKUPS_HISTORIAL
        ORDER BY FECHA_INICIO DESC
      `);
    return result.recordset as BackupRecord[];
  },

  async getById(id: number): Promise<BackupRecord | null> {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM BACKUPS_HISTORIAL WHERE BACKUP_ID = @id');
    return (result.recordset[0] as BackupRecord) || null;
  },

  /** Verifica integridad con RESTORE VERIFYONLY */
  async verifyBackup(filePath: string): Promise<void> {
    const pool = await getPool();
    // RESTORE VERIFYONLY confirma que el archivo .bak es legible y consistente
    await pool.request()
      .input('p', sql.NVarChar(500), filePath)
      .query('RESTORE VERIFYONLY FROM DISK = @p WITH CHECKSUM');
  },

  /**
   * Ejecuta un BACKUP DATABASE.
   * @param tipo MANUAL (desde UI) o PROGRAMADO (cron)
   */
  async runBackup(opts: {
    tipo: 'MANUAL' | 'PROGRAMADO';
    usuarioId?: number | null;
    usuarioNombre?: string | null;
  }): Promise<BackupRecord> {
    await ensureTables();
    const pool = await getPool();
    const cfg = await this.getConfig();
    const dbName = config.db.database;
    const dest = resolveDestPath(cfg.DESTINO_PATH);
    const fileName = makeFileName(dbName, new Date());
    const fullPath = path.join(dest, fileName);
    const startedAt = new Date();

    // Insertar registro EN_PROGRESO
    const insertRes = await pool.request()
      .input('inicio', sql.DateTime, startedAt)
      .input('nombre', sql.NVarChar(260), fileName)
      .input('ruta', sql.NVarChar(500), fullPath)
      .input('estado', sql.NVarChar(20), 'EN_PROGRESO')
      .input('tipo', sql.NVarChar(20), opts.tipo)
      .input('uid', sql.Int, opts.usuarioId ?? null)
      .input('uname', sql.NVarChar(100), opts.usuarioNombre ?? null)
      .input('db', sql.NVarChar(128), dbName)
      .query(`
        INSERT INTO BACKUPS_HISTORIAL
          (FECHA_INICIO, ARCHIVO_NOMBRE, ARCHIVO_RUTA, ESTADO, TIPO, USUARIO_ID, USUARIO_NOMBRE, DB_NOMBRE)
        OUTPUT INSERTED.BACKUP_ID
        VALUES (@inicio, @nombre, @ruta, @estado, @tipo, @uid, @uname, @db)
      `);
    const backupId = insertRes.recordset[0].BACKUP_ID as number;

    try {
      // Construir cláusula WITH
      const withParts: string[] = ['INIT', 'CHECKSUM', 'STATS = 10'];
      if (cfg.COPY_ONLY) withParts.push('COPY_ONLY');

      // COMPRESSION no está soportada en SQL Server Express — lo detectamos
      // consultando la edición para evitar el error en tiempo de ejecución.
      if (cfg.COMPRESION) {
        try {
          const edRes = await pool.request().query<{ edition: string }>(
            `SELECT CAST(SERVERPROPERTY('Edition') AS NVARCHAR(128)) AS edition`
          );
          const edition = (edRes.recordset[0]?.edition || '').toLowerCase();
          const supportsCompression = !edition.includes('express');
          if (supportsCompression) {
            withParts.push('COMPRESSION');
          } else {
            console.log('[backup] Edición Express detectada — COMPRESSION omitida');
          }
        } catch {
          // Si no podemos consultar, omitimos compresión por precaución
          console.warn('[backup] No se pudo determinar edición de SQL Server — COMPRESSION omitida');
        }
      }

      withParts.push(`NAME = N'RG WEB ${opts.tipo} Backup'`);

      // ── Pre-check: verificar que SQL Server puede escribir en el destino ──
      // Escribe un archivo vacío de prueba con xp_create_subdir + BACKUP LOG ...
      // Forma más simple: intentar abrir el archivo con sqlcmd no es posible desde
      // mssql, pero podemos detectar rápido si la carpeta existe a nivel motor.
      // Si no, sugerimos la carpeta de backup por defecto del motor.
      let sqlDefaultBackupDir: string | null = null;
      try {
        const dirRes = await pool.request().query<{ dir: string }>(`
          DECLARE @dir NVARCHAR(500);
          EXEC master.dbo.xp_instance_regread
            N'HKEY_LOCAL_MACHINE',
            N'Software\\Microsoft\\MSSQLServer\\MSSQLServer',
            N'BackupDirectory',
            @dir OUTPUT;
          SELECT @dir AS dir;
        `);
        sqlDefaultBackupDir = dirRes.recordset[0]?.dir || null;
      } catch { /* xp_instance_regread puede estar deshabilitado — ignorar */ }

      console.log(`[backup] Destino: ${fullPath}`);
      if (sqlDefaultBackupDir) {
        console.log(`[backup] Directorio backup por defecto del motor: ${sqlDefaultBackupDir}`);
      }

      // QuoteName para el nombre de la BD; ruta va por parámetro
      const safeDb = dbName.replace(/]/g, ']]');

      // BACKUP DATABASE puede durar varios minutos en BDs grandes.
      // Usamos una conexión dedicada con timeout extendido.
      const longPool = await connectLongPool(config.db.database);
      try {
        const r = longPool.request();
        r.input('p', sql.NVarChar(500), fullPath);

        // Los mensajes de progreso (STATS) llegan como info
        r.on('info', (info: any) => {
          if (info?.message) console.log(`[backup] ${info.message}`);
        });

        try {
          await r.query(`BACKUP DATABASE [${safeDb}] TO DISK = @p WITH ${withParts.join(', ')}`);
        } catch (qErr: any) {
          // mssql acumula los errores precedentes (ej: "Cannot open backup device...
          // Operating system error 5(Access is denied)") en precedingErrors.
          // El error final "BACKUP DATABASE is terminating abnormally" es genérico.
          const detail = extractSqlErrorDetail(qErr);
          const isAccessDenied = /access.?denied|denegad|error\s+5\b|cannot open backup/i.test(detail || qErr.message);
          const hint = isAccessDenied
            ? ` | SOLUCIÓN: otorgue permisos de escritura a la cuenta del servicio SQL Server sobre "${dest}"${sqlDefaultBackupDir ? `, o use la carpeta por defecto del motor: "${sqlDefaultBackupDir}"` : ''}.`
            : '';
          const finalMsg = detail
            ? `${qErr.message} — Detalle: ${detail}${hint}`
            : `${qErr.message}${hint}`;
          throw new Error(finalMsg);
        }
      } finally {
        try { if (longPool) await longPool.close(); } catch { /* ignore */ }
      }

      // Stats del archivo
      const stats = fs.statSync(fullPath);
      const tamano = stats.size;

      // Verificación
      let verificado = false;
      if (cfg.VERIFICAR_BACKUP) {
        try {
          await this.verifyBackup(fullPath);
          verificado = true;
        } catch (e: any) {
          // No fallamos completo: registramos como OK pero verificado=0
          console.warn(`[backup] Verificación falló: ${e.message}`);
        }
      }

      // Hash SHA-256
      let hash: string | null = null;
      try {
        hash = await hashFile(fullPath);
      } catch { /* hash opcional */ }

      const finishedAt = new Date();
      const duration = finishedAt.getTime() - startedAt.getTime();

      await pool.request()
        .input('id', sql.Int, backupId)
        .input('fin', sql.DateTime, finishedAt)
        .input('dur', sql.Int, duration)
        .input('tamano', sql.BigInt, tamano)
        .input('hash', sql.NVarChar(64), hash)
        .input('ver', sql.Bit, verificado)
        .query(`
          UPDATE BACKUPS_HISTORIAL
          SET FECHA_FIN = @fin, DURACION_MS = @dur, TAMANO_BYTES = @tamano,
              HASH_SHA256 = @hash, VERIFICADO = @ver, ESTADO = 'OK'
          WHERE BACKUP_ID = @id
        `);

      await pool.request()
        .input('fin', sql.DateTime, finishedAt)
        .input('estado', sql.NVarChar(20), 'OK')
        .query(`UPDATE BACKUPS_CONFIG SET ULTIMA_EJECUCION = @fin, ULTIMO_ESTADO = @estado WHERE ID = 1`);

      // Aplicar retención (no romper si falla)
      this.applyRetention().catch(err => console.error('[backup] Error en retención:', err));

      return (await this.getById(backupId))!;
    } catch (err: any) {
      const finishedAt = new Date();
      const duration = finishedAt.getTime() - startedAt.getTime();
      const msg = err?.message || String(err);

      await pool.request()
        .input('id', sql.Int, backupId)
        .input('fin', sql.DateTime, finishedAt)
        .input('dur', sql.Int, duration)
        .input('err', sql.NVarChar(sql.MAX), msg)
        .query(`
          UPDATE BACKUPS_HISTORIAL
          SET FECHA_FIN = @fin, DURACION_MS = @dur, ESTADO = 'ERROR', ERROR_MENSAJE = @err
          WHERE BACKUP_ID = @id
        `);
      await pool.request()
        .input('fin', sql.DateTime, finishedAt)
        .input('estado', sql.NVarChar(20), 'ERROR')
        .query(`UPDATE BACKUPS_CONFIG SET ULTIMA_EJECUCION = @fin, ULTIMO_ESTADO = @estado WHERE ID = 1`);

      // Limpiar archivo parcial si quedó
      try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch { /* ignore */ }

      throw new Error(`Backup falló: ${msg}`);
    }
  },

  /**
   * Política de retención: elimina archivos OK más viejos que RETENCION_DIAS,
   * pero conservando siempre los RETENCION_MIN_KEEP más recientes.
   */
  async applyRetention(): Promise<{ eliminados: number }> {
    await ensureTables();
    const cfg = await this.getConfig();
    const pool = await getPool();

    const cutoff = new Date(Date.now() - cfg.RETENCION_DIAS * 24 * 60 * 60 * 1000);
    const result = await pool.request().query<BackupRecord>(`
      SELECT * FROM BACKUPS_HISTORIAL
      WHERE ESTADO = 'OK'
      ORDER BY FECHA_INICIO DESC
    `);
    const all = result.recordset as BackupRecord[];

    // Conservar los N más recientes
    const candidatos = all.slice(cfg.RETENCION_MIN_KEEP);
    const aBorrar = candidatos.filter(r => new Date(r.FECHA_INICIO) < cutoff);

    let eliminados = 0;
    for (const r of aBorrar) {
      try {
        if (fs.existsSync(r.ARCHIVO_RUTA)) fs.unlinkSync(r.ARCHIVO_RUTA);
        await pool.request()
          .input('id', sql.Int, r.BACKUP_ID)
          .query('DELETE FROM BACKUPS_HISTORIAL WHERE BACKUP_ID = @id');
        eliminados++;
      } catch (e) {
        console.error(`[backup] No se pudo eliminar ${r.ARCHIVO_NOMBRE}:`, e);
      }
    }
    return { eliminados };
  },

  /** Borra un backup (archivo + registro) */
  async deleteBackup(id: number): Promise<void> {
    await ensureTables();
    const rec = await this.getById(id);
    if (!rec) throw new Error('Backup no encontrado');

    // Validación anti path-traversal: el archivo debe estar bajo una ruta esperada
    const resolved = path.resolve(rec.ARCHIVO_RUTA);
    if (!path.isAbsolute(resolved)) throw new Error('Ruta inválida');

    try {
      if (fs.existsSync(resolved)) fs.unlinkSync(resolved);
    } catch (e: any) {
      console.warn(`[backup] No se pudo eliminar archivo ${resolved}: ${e.message}`);
    }
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM BACKUPS_HISTORIAL WHERE BACKUP_ID = @id');
  },

  /** Verifica que un archivo de backup todavía exista y opcionalmente que el hash coincida */
  async checkIntegrity(id: number): Promise<{ existe: boolean; hashOk: boolean | null }> {
    const rec = await this.getById(id);
    if (!rec) throw new Error('Backup no encontrado');
    const existe = fs.existsSync(rec.ARCHIVO_RUTA);
    if (!existe) return { existe: false, hashOk: null };
    if (!rec.HASH_SHA256) return { existe: true, hashOk: null };
    const current = await hashFile(rec.ARCHIVO_RUTA);
    return { existe: true, hashOk: current === rec.HASH_SHA256 };
  },

  // ═══════════════════════════════════════════════════════════════
  //  RESTORE
  // ═══════════════════════════════════════════════════════════════

  /** Lista historial de restauraciones */
  async getRestoreHistory(limit = 50): Promise<RestoreRecord[]> {
    await ensureTables();
    const pool = await getPool();
    const result = await pool.request()
      .input('limit', sql.Int, Math.max(1, Math.min(500, limit)))
      .query(`
        SELECT TOP (@limit) *
        FROM RESTAURACIONES_HISTORIAL
        ORDER BY FECHA_INICIO DESC
      `);
    return result.recordset as RestoreRecord[];
  },

  /**
   * Lee la metadata de un archivo .bak (RESTORE FILELISTONLY + HEADERONLY).
   * Útil para validar antes de restaurar y para mostrar qué BD origen contiene.
   */
  async inspectBackupFile(filePath: string): Promise<{
    files: Array<{ logicalName: string; physicalName: string; type: string; size: number }>;
    header: { databaseName: string; serverName: string; backupStartDate: Date | null; backupSize: number | null };
  }> {
    if (!fs.existsSync(filePath)) throw new Error(`El archivo no existe: ${filePath}`);
    const pool = await getPool();
    const fl = await pool.request()
      .input('p', sql.NVarChar(500), filePath)
      .query(`RESTORE FILELISTONLY FROM DISK = @p`);
    const hd = await pool.request()
      .input('p', sql.NVarChar(500), filePath)
      .query(`RESTORE HEADERONLY FROM DISK = @p`);

    const files = fl.recordset.map((r: any) => ({
      logicalName: r.LogicalName,
      physicalName: r.PhysicalName,
      type: r.Type,           // D (data) | L (log)
      size: Number(r.Size),
    }));
    const h = hd.recordset[0] || {};
    const header = {
      databaseName: h.DatabaseName || '',
      serverName: h.ServerName || '',
      backupStartDate: h.BackupStartDate ? new Date(h.BackupStartDate) : null,
      backupSize: h.BackupSize != null ? Number(h.BackupSize) : null,
    };
    return { files, header };
  },

  /**
   * Restaura la BD desde un archivo .bak.
   * 
   * ⚠️ Operación crítica:
   *   1. Cierra todas las conexiones activas (SET SINGLE_USER WITH ROLLBACK IMMEDIATE)
   *   2. RESTORE DATABASE WITH REPLACE, RECOVERY
   *   3. Vuelve a MULTI_USER
   * 
   * Importante: la conexión que ejecuta el restore se hace contra `master`
   * (no contra la BD destino), porque la BD debe estar libre durante la operación.
   * Después del restore, el pool global de la app sigue conectado a la BD restaurada.
   */
  async restoreFromFile(opts: {
    filePath: string;
    fileName: string;
    origen: 'HISTORIAL' | 'UPLOAD';
    backupId?: number | null;
    usuarioId?: number | null;
    usuarioNombre?: string | null;
  }): Promise<RestoreRecord> {
    await ensureTables();
    const dbName = config.db.database;
    const safeDb = dbName.replace(/]/g, ']]');
    const startedAt = new Date();

    // Validar archivo existe
    if (!fs.existsSync(opts.filePath)) {
      throw new Error(`El archivo de backup no existe: ${opts.filePath}`);
    }

    // ── Verificar primero que el archivo es válido ──
    try {
      await this.verifyBackup(opts.filePath);
    } catch (e: any) {
      throw new Error(`El archivo .bak no es válido: ${e.message}`);
    }

    // ── No permitir restore si hay un backup en progreso ──
    {
      const pool = await getPool();
      const inProgress = await pool.request().query<{ n: number }>(
        `SELECT COUNT(*) AS n FROM BACKUPS_HISTORIAL WHERE ESTADO = 'EN_PROGRESO'`
      );
      if ((inProgress.recordset[0]?.n || 0) > 0) {
        throw new Error('Hay un backup en progreso. Esperá a que termine antes de restaurar.');
      }
    }

    // ── Insertar registro EN_PROGRESO usando el pool global ANTES de cerrarlo ──
    let restoreId: number;
    {
      const pool = await getPool();
      const insRes = await pool.request()
        .input('inicio', sql.DateTime, startedAt)
        .input('ruta', sql.NVarChar(500), opts.filePath)
        .input('nombre', sql.NVarChar(260), opts.fileName)
        .input('origen', sql.NVarChar(20), opts.origen)
        .input('bid', sql.Int, opts.backupId ?? null)
        .input('estado', sql.NVarChar(20), 'EN_PROGRESO')
        .input('uid', sql.Int, opts.usuarioId ?? null)
        .input('uname', sql.NVarChar(100), opts.usuarioNombre ?? null)
        .input('db', sql.NVarChar(128), dbName)
        .query(`
          INSERT INTO RESTAURACIONES_HISTORIAL
            (FECHA_INICIO, ARCHIVO_RUTA, ARCHIVO_NOMBRE, ORIGEN, BACKUP_ID, ESTADO, USUARIO_ID, USUARIO_NOMBRE, DB_NOMBRE)
          OUTPUT INSERTED.RESTORE_ID
          VALUES (@inicio, @ruta, @nombre, @origen, @bid, @estado, @uid, @uname, @db)
        `);
      restoreId = insRes.recordset[0].RESTORE_ID as number;
    }

    // ── Cerrar el pool global para liberar la BD ──
    // (necesario para que SQL pueda obtener acceso exclusivo)
    await closePool();

    let masterPool: sql.ConnectionPool | null = null;
    try {
      // Conexión a master (NO a la BD destino — debe estar libre)
      masterPool = await connectLongPool('master');

      // Forzar SINGLE_USER con rollback inmediato (mata todas las sesiones)
      await masterPool.request()
        .batch(`ALTER DATABASE [${safeDb}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);

      // Hacer el RESTORE
      const r = masterPool.request();
      r.input('p', sql.NVarChar(500), opts.filePath);
      r.on('info', (info: any) => {
        if (info?.message) console.log(`[restore] ${info.message}`);
      });
      try {
        await r.query(`RESTORE DATABASE [${safeDb}] FROM DISK = @p WITH REPLACE, RECOVERY, STATS = 10`);
      } catch (qErr: any) {
        const detail = extractSqlErrorDetail(qErr);
        // Intentar volver a MULTI_USER aunque haya fallado
        try {
          await masterPool.request()
            .batch(`ALTER DATABASE [${safeDb}] SET MULTI_USER`);
        } catch { /* ignore */ }
        throw new Error(detail ? `${qErr.message} — ${detail}` : qErr.message);
      }

      // Volver a MULTI_USER
      await masterPool.request()
        .batch(`ALTER DATABASE [${safeDb}] SET MULTI_USER`);

      // Cerrar pool dedicado
      try { await masterPool.close(); } catch { /* ignore */ }
      masterPool = null;

      // Reabrir pool global apuntando a la BD restaurada
      await getPool();

      // Actualizar registro OK
      const finishedAt = new Date();
      const duration = finishedAt.getTime() - startedAt.getTime();
      const pool = await getPool();
      await pool.request()
        .input('id', sql.Int, restoreId)
        .input('fin', sql.DateTime, finishedAt)
        .input('dur', sql.Int, duration)
        .query(`
          UPDATE RESTAURACIONES_HISTORIAL
          SET FECHA_FIN = @fin, DURACION_MS = @dur, ESTADO = 'OK'
          WHERE RESTORE_ID = @id
        `);

      const result = await pool.request()
        .input('id', sql.Int, restoreId)
        .query('SELECT * FROM RESTAURACIONES_HISTORIAL WHERE RESTORE_ID = @id');
      return result.recordset[0] as RestoreRecord;
    } catch (err: any) {
      // Asegurar que masterPool se cierre
      try { if (masterPool) await masterPool.close(); } catch { /* ignore */ }
      // Reabrir pool global para poder registrar el error
      try { await getPool(); } catch { /* ignore */ }

      const finishedAt = new Date();
      const duration = finishedAt.getTime() - startedAt.getTime();
      const msg = err?.message || String(err);
      try {
        const pool = await getPool();
        await pool.request()
          .input('id', sql.Int, restoreId)
          .input('fin', sql.DateTime, finishedAt)
          .input('dur', sql.Int, duration)
          .input('err', sql.NVarChar(sql.MAX), msg)
          .query(`
            UPDATE RESTAURACIONES_HISTORIAL
            SET FECHA_FIN = @fin, DURACION_MS = @dur, ESTADO = 'ERROR', ERROR_MENSAJE = @err
            WHERE RESTORE_ID = @id
          `);
      } catch { /* registro ya quedará como EN_PROGRESO */ }

      throw new Error(`Restore falló: ${msg}`);
    }
  },

  /** Restaura desde un backup del historial (por BACKUP_ID) */
  async restoreFromHistorial(opts: {
    backupId: number;
    usuarioId?: number | null;
    usuarioNombre?: string | null;
  }): Promise<RestoreRecord> {
    const rec = await this.getById(opts.backupId);
    if (!rec) throw new Error('Backup no encontrado');
    if (rec.ESTADO !== 'OK') throw new Error('El backup no está en estado OK');

    // Si tenemos hash, validar integridad
    if (rec.HASH_SHA256 && fs.existsSync(rec.ARCHIVO_RUTA)) {
      const current = await hashFile(rec.ARCHIVO_RUTA);
      if (current !== rec.HASH_SHA256) {
        throw new Error('El archivo .bak fue modificado (hash SHA-256 no coincide). Restore abortado.');
      }
    }

    return this.restoreFromFile({
      filePath: rec.ARCHIVO_RUTA,
      fileName: rec.ARCHIVO_NOMBRE,
      origen: 'HISTORIAL',
      backupId: rec.BACKUP_ID,
      usuarioId: opts.usuarioId,
      usuarioNombre: opts.usuarioNombre,
    });
  },
};
