import sql from 'mssql';
import { config } from '../config/index.js';

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
  connectionTimeout: 15000,
};

let pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (!pool) {
    pool = await sql.connect(sqlConfig);
    console.log('✅ Connected to SQL Server');
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
