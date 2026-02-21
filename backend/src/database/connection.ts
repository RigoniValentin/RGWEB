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
    try {
      pool = await sql.connect(sqlConfig);
      console.log('✅ Connected to SQL Server');
    } catch (err: any) {
      // If named instance connection fails (SQL Browser not running), retry on port 1433
      if (config.db.instanceName && (err.code === 'ETIMEOUT' || err.code === 'ESOCKET')) {
        console.warn(`⚠ Named instance connection failed (SQL Browser may be stopped). Retrying on port ${sqlConfigFallback.port}...`);
        pool = await sql.connect(sqlConfigFallback);
        console.log('✅ Connected to SQL Server (direct port)');
      } else {
        throw err;
      }
    }
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    console.log('🔌 SQL Server connection closed');
  }
}

export { sql };
