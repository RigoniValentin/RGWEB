import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (3 levels up from backend/src/config/)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const dbServerRaw = process.env.DB_SERVER || 'localhost';
const hasNamedInstance = dbServerRaw.includes('\\');

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    // For named instances like HOST\SQLEXPRESS, split into server + instanceName
    server: hasNamedInstance ? dbServerRaw.split('\\')[0] : dbServerRaw,
    port: hasNamedInstance ? undefined : parseInt(process.env.DB_PORT || '1433', 10),
    instanceName: hasNamedInstance ? dbServerRaw.split('\\')[1] : undefined,
    database: process.env.DB_DATABASE || 'SesamoDB',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    },
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
};
