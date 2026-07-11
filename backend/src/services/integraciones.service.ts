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
  };
}

async function listApiKeys(): Promise<ApiKey[]> {
  const pool = await getPool();
  const r = await pool.request().query(`
    SELECT API_KEY_ID, NOMBRE, KEY_PREFIX, SCOPES, ACTIVA,
           CREATED_AT, LAST_USED_AT, REVOKED_AT, CREATED_BY, NOTAS
    FROM INTEGRACIONES_API_KEYS
    ORDER BY API_KEY_ID DESC
  `);
  return r.recordset.map(rowToApiKey);
}

async function createApiKey(
  nombre: string,
  scopes: string | null,
  notas: string | null,
  createdBy: number | null
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
    .query(`
      INSERT INTO INTEGRACIONES_API_KEYS (NOMBRE, KEY_PREFIX, KEY_HASH, SCOPES, NOTAS, CREATED_BY)
      OUTPUT INSERTED.API_KEY_ID, INSERTED.NOMBRE, INSERTED.KEY_PREFIX, INSERTED.SCOPES,
             INSERTED.ACTIVA, INSERTED.CREATED_AT, INSERTED.LAST_USED_AT, INSERTED.REVOKED_AT,
             INSERTED.CREATED_BY, INSERTED.NOTAS
      VALUES (@nombre, @prefix, @hash, @scopes, @notas, @createdBy)
    `);
  return { ...rowToApiKey(r.recordset[0]), RAW_KEY: rawKey };
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
    .query(`SELECT API_KEY_ID, KEY_HASH
            FROM INTEGRACIONES_API_KEYS
            WHERE KEY_PREFIX = @prefix AND ACTIVA = 1`);

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
