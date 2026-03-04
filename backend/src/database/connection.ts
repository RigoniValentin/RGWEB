import sql from 'mssql';
import { config } from '../config/index.js';

// When connecting to a named instance (e.g. TheBeast\SQLEXPRESS), tedious needs
// SQL Browser service running to resolve the dynamic port. Since the instance
// may have a fixed TCP port configured, we try instanceName-based connection first
// and fall back to direct port connection if it times out.
const sqlConfig: sql.config = {
  server: config.db.server,
  ...(config.db.port ? { port: config.db.port } : {}),
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  options: {
    encrypt: config.db.options.encrypt,
    trustServerCertificate: config.db.options.trustServerCertificate,
    enableArithAbort: true,
    ...(config.db.instanceName ? { instanceName: config.db.instanceName } : {}),
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
  requestTimeout: 30000,
  connectionTimeout: config.db.instanceName ? 5000 : 15000,  // shorter timeout for named instance (will fallback)
};

// Fallback config: same but WITHOUT instanceName, using port 1433 directly
const sqlConfigFallback: sql.config = {
  ...sqlConfig,
  port: config.db.port || 1433,
  options: {
    ...sqlConfig.options,
    instanceName: undefined,
  },
};

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    // If a port is configured or we know the instance, try direct port first (faster, no SQL Browser needed)
    if (config.db.port || config.db.instanceName) {
      try {
        pool = await sql.connect(sqlConfigFallback);
        return pool;
      } catch {
        // If direct port fails and we have an instanceName, try via SQL Browser
        if (config.db.instanceName) {
          console.warn(`⚠ Direct port connection failed. Retrying via SQL Browser (instance: ${config.db.instanceName})...`);
        }
      }
    }

    // Fallback: try with instanceName via SQL Browser
    pool = await sql.connect(sqlConfig);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export { sql };
