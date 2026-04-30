import dotenv from 'dotenv';
import path from 'path';
import { loadAppData } from './appdata.js';
import { isPkg, envPath, rootDir } from './paths.js';

// ── In development, .env can optionally override some values ──
// In production (pkg), everything comes from appdata.ini
if (!isPkg) {
  dotenv.config({ path: envPath });
}

const appData = loadAppData();

const dbServerRaw = appData.dataSource;
const hasNamedInstance = dbServerRaw.includes('\\');

export const config = {
  port: parseInt(process.env.PORT || String(appData.port), 10),
  nodeEnv: isPkg ? 'production' : (process.env.NODE_ENV || 'development'),

  db: {
    server: hasNamedInstance ? dbServerRaw.split('\\')[0] : dbServerRaw,
    port: hasNamedInstance ? undefined : 1433,
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
    secret: process.env.JWT_SECRET || appData.jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || appData.jwtExpiresIn,
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

  // ── ARCA (direct electronic invoicing) ─────────────
  arca: {
    cuit: appData.arcaCuit,
    // Resolve relative paths from the project root so they work regardless
    // of what directory Node is launched from (e.g. backend/ in dev)
    certPath: appData.arcaCertPath
      ? path.resolve(rootDir, appData.arcaCertPath)
      : '',
    keyPath: appData.arcaKeyPath
      ? path.resolve(rootDir, appData.arcaKeyPath)
      : '',
    environment: appData.arcaEnvironment,
  },
};
