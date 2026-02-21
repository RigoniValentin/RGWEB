import dotenv from 'dotenv';
import { loadAppData } from './appdata.js';
import { envPath } from './paths.js';

// Load .env only for non-DB settings (PORT, JWT, NODE_ENV)
dotenv.config({ path: envPath });

// ── appdata.ini is REQUIRED — system will not start without it ──
const appData = loadAppData();

const dbServerRaw = appData.dataSource;
const hasNamedInstance = dbServerRaw.includes('\\');

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    server: hasNamedInstance ? dbServerRaw.split('\\')[0] : dbServerRaw,
    port: hasNamedInstance ? undefined : parseInt(process.env.DB_PORT || '1433', 10),
    instanceName: hasNamedInstance ? dbServerRaw.split('\\')[1] : undefined,
    database: appData.initialCatalog,
    user: appData.userId,
    password: appData.password,
    options: {
      encrypt: false,
      trustServerCertificate: appData.trustServerCertificate,
    },
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  // ── Business settings (from appdata.ini) ───────────
  app: {
    nombreFantasia: appData.nombreFantasia,
    nombreCliente: appData.nombreCliente,
    telefonoSoporte: appData.telefonoSoporte,
    telefonoCliente: appData.telefonoCliente,
    utilizaFE: appData.utilizaFE,
  },

  // ── External service integrations ──────────────────
  integrations: {
    userToken: appData.userToken,
    apiKey: appData.apiKey,
    apiToken: appData.apiToken,
    ipWsp: appData.ipWsp,
  },
};
