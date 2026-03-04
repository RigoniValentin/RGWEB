/**
 * AppData INI Configuration Loader
 * ─────────────────────────────────
 * Mirrors the behavior of the desktop C# ConexionDB class:
 *   1. Reads appdata.ini from the project root
 *   2. If plaintext → encrypts it in place (AES-256-CBC)
 *   3. If already encrypted → decrypts to read values
 *
 * Uses the SAME key/IV as the desktop app for cross-compatibility.
 */
import fs from 'fs';
import crypto from 'crypto';
import { appdataPath } from './paths.js';
import readline from 'readline';

// ── Same key/IV as the C# desktop app ────────────────
const ENCRYPTION_KEY = Buffer.from('RioGestionEncryptionKey32Bytes!!', 'utf8'); // 32 bytes → AES-256
const ENCRYPTION_IV = Buffer.from('RioGestionIv16By', 'utf8');                  // 16 bytes

const ALGORITHM = 'aes-256-cbc';

// ── INI file path (resolved from paths.ts) ───────────
const INI_PATH = appdataPath;

/** Block until user presses Enter (sync-compatible via spawnSync) */
function fatalExit(): never {
  try {
    const { spawnSync } = require('child_process');
    spawnSync('cmd', ['/c', 'pause'], { stdio: 'inherit' });
  } catch { /* fallback: just exit */ }
  process.exit(1);
}

// ── Parsed settings ──────────────────────────────────
export interface AppDataSettings {
  // Database
  dataSource: string;
  initialCatalog: string;
  userId: string;
  password: string;
  trustServerCertificate: boolean;

  // Business
  telefonoSoporte: string;
  telefonoCliente: string;
  nombreFantasia: string;
  nombreCliente: string;
  utilizaFE: boolean;

  // API / integrations
  userToken: string;
  apiKey: string;
  apiToken: string;
  ipWsp: string;

  // Server (optional — sensible defaults)
  port: number;
  jwtSecret: string;
  jwtExpiresIn: string;
}

// ── Encryption helpers (AES-256-CBC, compatible with C#) ──
function encrypt(plainText: string): string {
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, ENCRYPTION_IV);
  let encrypted = cipher.update(plainText, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return encrypted.toString('base64');
}

function decrypt(cipherText: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, ENCRYPTION_IV);
  let decrypted = decipher.update(Buffer.from(cipherText, 'base64'));
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString('utf8');
}

function isEncrypted(content: string): boolean {
  try {
    // Same heuristic as the C# app: if it's valid Base64, it's encrypted
    const buf = Buffer.from(content.trim(), 'base64');
    return buf.length > 0 && buf.toString('base64') === content.trim();
  } catch {
    return false;
  }
}

// ── Simple INI parser (no external dependency needed) ──
function parseIni(content: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection = '';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      result[currentSection] = result[currentSection] || {};
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex > 0 && currentSection) {
      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();
      result[currentSection]![key] = value;
    }
  }

  return result;
}

// ── Main loader ──────────────────────────────────────
export function loadAppData(): AppDataSettings {
  if (!fs.existsSync(INI_PATH)) {
    console.error('\n======================================================');
    console.error('  ERROR FATAL: No se encontro el archivo appdata.ini');
    console.error(`  Ruta esperada: ${INI_PATH}`);
    console.error('  El sistema no puede iniciar sin este archivo.');
    console.error('======================================================\n');
    fatalExit();
  }

  let fileContent = fs.readFileSync(INI_PATH, 'utf8');

  if (isEncrypted(fileContent)) {
    // Already encrypted → decrypt to use
    fileContent = decrypt(fileContent);
  } else {
    // Plaintext → encrypt the file in place for security
    console.log('[appdata] 🔒 Encrypting appdata.ini...');
    const encrypted = encrypt(fileContent);
    fs.writeFileSync(INI_PATH, encrypted, 'utf8');
  }

  // Parse the INI content
  const data = parseIni(fileContent);
  const db = data['DatabaseSettings'];

  if (!db) {
    console.error('\n======================================================');
    console.error('  ERROR FATAL: Seccion [DatabaseSettings] no encontrada');
    console.error('  El archivo appdata.ini no contiene la configuracion requerida.');
    console.error('======================================================\n');
    fatalExit();
  }

  // Optional [ServerSettings] section for port/JWT
  const srv = data['ServerSettings'] || {};

  const settings: AppDataSettings = {
    dataSource: db['DataSource'] || 'localhost',
    initialCatalog: db['InitialCatalog'] || '',
    userId: db['UserID'] || 'sa',
    password: db['Password'] || '',
    trustServerCertificate: db['TrustServerCertificate'] !== 'False',
    telefonoSoporte: db['TelefonoSoporte'] || '',
    telefonoCliente: db['TelefonoCliente'] || '',
    nombreFantasia: db['NombreFantasia'] || '',
    nombreCliente: db['NombreCliente'] || '',
    utilizaFE: db['UtilizaFE'] === 'SI',
    userToken: db['UserToken'] || '',
    apiKey: db['ApiKey'] || '',
    apiToken: db['ApiToken'] || '',
    ipWsp: db['IpWsp'] || '',
    port: parseInt(srv['Port'] || '3001', 10),
    jwtSecret: srv['JwtSecret'] || 'RG-Web-Jwt-Secret-2026!',
    jwtExpiresIn: srv['JwtExpiresIn'] || '8h',
  };

  return settings;
}
