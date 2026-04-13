/**
 * WSAA — Web Service de Autenticación y Autorización (ARCA)
 * ──────────────────────────────────────────────────────────
 * Handles authentication against ARCA using X.509 certificates.
 *
 * Flow:
 *   1. Build a TRA (Ticket de Requerimiento de Acceso) XML
 *   2. Sign the TRA with the private key → CMS (PKCS#7)
 *   3. Send the CMS to WSAA LoginCms endpoint
 *   4. Receive Token + Sign (valid ~12h)
 *   5. Cache credentials until expiration
 *
 * References:
 *   - https://www.afip.gob.ar/ws/WSAA/WSAAmanualDev.pdf
 *   - https://www.afip.gob.ar/ws/WSAA/Especificacion_Tecnica_WSAA_1.2.2.pdf
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import forge from 'node-forge';
import { parseStringPromise } from 'xml2js';
import { arcaFetch } from './arcaFetch.js';

// ── Endpoints ────────────────────────────────────────
const WSAA_URLS = {
  testing: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  production: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
} as const;

// ── Cached credentials (memory + file persistence) ──
interface WSAACredentials {
  token: string;
  sign: string;
  expirationTime: Date;
}

const credentialsCache: Map<string, WSAACredentials> = new Map();

const CACHE_DIR = path.join(os.tmpdir(), 'rgweb-wsaa');

function getCacheFilePath(cacheKey: string): string {
  // Sanitize key for filename
  return path.join(CACHE_DIR, `${cacheKey.replace(/[^a-zA-Z0-9_]/g, '_')}.json`);
}

function loadCachedCredentials(cacheKey: string): WSAACredentials | null {
  try {
    const filePath = getCacheFilePath(cacheKey);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    data.expirationTime = new Date(data.expirationTime);
    if (data.expirationTime.getTime() > Date.now() + 300_000) {
      return data;
    }
    // Expired — remove file
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    return null;
  } catch {
    return null;
  }
}

function saveCachedCredentials(cacheKey: string, creds: WSAACredentials): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(getCacheFilePath(cacheKey), JSON.stringify(creds), 'utf8');
  } catch { /* ignore */ }
}

// ── Configuration ───────────────────────────────────
export interface WSAAConfig {
  /** Path to the private key file (.key) */
  privateKeyPath: string;
  /** Path to the certificate file (.crt / .pem) */
  certPath: string;
  /** 'testing' or 'production' */
  environment: 'testing' | 'production';
  /** CUIT of the taxpayer */
  cuit: string;
}

/**
 * Build the TRA (Ticket de Requerimiento de Acceso) XML.
 * The TRA has a generation time, expiration time, and the target service name.
 */
function buildTRA(service: string): string {
  const now = new Date();
  const generationTime = new Date(now.getTime() - 600_000); // 10 min in the past (clock skew tolerance)
  const expirationTime = new Date(now.getTime() + 600_000); // 10 min in the future

  // Use ISO format with Z (UTC) — WSAA accepts both UTC and local offset
  const formatDate = (d: Date) => d.toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>
    <generationTime>${formatDate(generationTime)}</generationTime>
    <expirationTime>${formatDate(expirationTime)}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

/**
 * Sign the TRA using node-forge to create a CMS (PKCS#7) signed message.
 * Uses the contributor's private key and certificate.
 * Pure JS implementation — no system OpenSSL binary required.
 */
function signTRA(tra: string, privateKeyPath: string, certPath: string): string {
  const certPem = fs.readFileSync(certPath, 'utf8');
  const keyPem = fs.readFileSync(privateKeyPath, 'utf8');

  const certificate = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(certificate);
  p7.addSigner({
    key: privateKey,
    certificate: certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() as any },
    ],
  });
  p7.sign({ detached: false });

  const asn1 = p7.toAsn1();
  const derBytes = forge.asn1.toDer(asn1);
  return forge.util.encode64(derBytes.getBytes());
}

/**
 * Build the SOAP envelope for the LoginCms call.
 */
function buildLoginCmsRequest(cmsBase64: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body>
    <wsaa:loginCms>
      <wsaa:in0>${cmsBase64}</wsaa:in0>
    </wsaa:loginCms>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Parse the WSAA LoginCms response to extract token, sign, and expiration.
 */
async function parseLoginResponse(responseXml: string): Promise<WSAACredentials> {
  // The SOAP response contains an embedded XML string in the loginCmsReturn element
  const soapResult = await parseStringPromise(responseXml, { explicitArray: false });

  const body = soapResult['soapenv:Envelope']?.['soapenv:Body']
    || soapResult['soap:Envelope']?.['soap:Body']
    || soapResult['S:Envelope']?.['S:Body'];

  if (!body) {
    throw new Error('WSAA: Respuesta SOAP inválida - no se encontró Body');
  }

  const loginReturn = body['loginCmsResponse']?.['loginCmsReturn']
    || body['ns1:loginCmsResponse']?.['ns1:loginCmsReturn']
    || body['wsaa:loginCmsResponse']?.['wsaa:loginCmsReturn'];

  if (!loginReturn) {
    // Check for SOAP fault
    const fault = body['soapenv:Fault'] || body['soap:Fault'] || body['S:Fault'];
    if (fault) {
      const faultString = fault.faultstring || fault['faultstring'] || 'Error desconocido';
      throw new Error(`WSAA Fault: ${faultString}`);
    }
    throw new Error('WSAA: No se encontró loginCmsReturn en la respuesta');
  }

  // The loginCmsReturn contains an XML string that we need to parse
  const ticketXml = await parseStringPromise(loginReturn, { explicitArray: false });
  const credentials = ticketXml['loginTicketResponse']?.['credentials'];

  if (!credentials) {
    throw new Error('WSAA: No se encontraron credentials en el ticket');
  }

  const token = credentials['token'];
  const sign = credentials['sign'];

  // Parse expiration from the header
  const header = ticketXml['loginTicketResponse']?.['header'];
  const expirationStr = header?.['expirationTime'];
  const expirationTime = expirationStr ? new Date(expirationStr) : new Date(Date.now() + 43200_000); // default 12h

  if (!token || !sign) {
    throw new Error('WSAA: Token o Sign vacíos en la respuesta');
  }

  return { token, sign, expirationTime };
}

/**
 * Authenticate against WSAA and obtain Token + Sign for a target service.
 * Credentials are cached until they expire.
 *
 * @param service - The target WS name (e.g. 'wsfe' for WSFEv1)
 * @param config - WSAA configuration (cert, key, environment)
 * @returns Token + Sign credentials
 */
export async function getWSAACredentials(
  service: string,
  config: WSAAConfig
): Promise<{ token: string; sign: string }> {
  const cacheKey = `${config.cuit}_${service}_${config.environment}`;

  // Check memory cache — reuse if not expired (with 5 min margin)
  const cached = credentialsCache.get(cacheKey);
  if (cached && cached.expirationTime.getTime() > Date.now() + 300_000) {
    return { token: cached.token, sign: cached.sign };
  }

  // Check file cache (survives server restarts)
  const fileCached = loadCachedCredentials(cacheKey);
  if (fileCached) {
    credentialsCache.set(cacheKey, fileCached);
    console.log(`[WSAA] Usando TA cacheado en disco (válido hasta ${fileCached.expirationTime.toLocaleString()})`);
    return { token: fileCached.token, sign: fileCached.sign };
  }

  console.log(`[WSAA] Autenticando para servicio "${service}" (${config.environment})...`);

  // Validate cert/key files exist
  if (!fs.existsSync(config.privateKeyPath)) {
    throw Object.assign(
      new Error(`WSAA: No se encontró la clave privada en: ${config.privateKeyPath}`),
      { name: 'WSAAConfigError' }
    );
  }
  if (!fs.existsSync(config.certPath)) {
    throw Object.assign(
      new Error(`WSAA: No se encontró el certificado en: ${config.certPath}`),
      { name: 'WSAAConfigError' }
    );
  }

  // 1. Build TRA
  const tra = buildTRA(service);

  // 2. Sign TRA → CMS
  let cms: string;
  try {
    cms = signTRA(tra, config.privateKeyPath, config.certPath);
  } catch (err: any) {
    throw Object.assign(
      new Error(`WSAA: Error al firmar el TRA: ${err.message}. Verifique que los archivos de certificado (.crt y .key) sean válidos y coincidan entre sí.`),
      { name: 'WSAASignError' }
    );
  }

  // 3. Call WSAA LoginCms
  const wsaaUrl = WSAA_URLS[config.environment];
  const soapEnvelope = buildLoginCmsRequest(cms);

  const response = await arcaFetch(wsaaUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '',
    },
    body: soapEnvelope,
  });

  if (!response.ok) {
    const errorText = response.text;

    // Handle "already authenticated" — ARCA still has a valid TA for this service.
    // This happens when the server restarts and loses the cached TA.
    // We cannot recover the old TA, so we wait and retry with exponential backoff.
    if (errorText.includes('coe.alreadyAuthenticated')) {
      // Try 3 times with increasing delays (10s, 30s, 60s)
      const delays = [10_000, 30_000, 60_000];
      for (let i = 0; i < delays.length; i++) {
        console.log(`[WSAA] TA aún válido en ARCA, reintentando en ${delays[i] / 1000}s... (${i + 1}/${delays.length})`);
        await new Promise(resolve => setTimeout(resolve, delays[i]));

        // Rebuild TRA with new timestamps and sign again
        const newTra = buildTRA(service);
        const newCms = signTRA(newTra, config.privateKeyPath, config.certPath);
        const newEnvelope = buildLoginCmsRequest(newCms);

        const retryResponse = await arcaFetch(wsaaUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': '' },
          body: newEnvelope,
        });

        if (retryResponse.ok) {
          const retryXml = retryResponse.text;
          const retryCreds = await parseLoginResponse(retryXml);
          credentialsCache.set(cacheKey, retryCreds);
          saveCachedCredentials(cacheKey, retryCreds);
          console.log(`[WSAA] Autenticación exitosa (reintento ${i + 1}). Token válido hasta: ${retryCreds.expirationTime.toLocaleString()}`);
          return { token: retryCreds.token, sign: retryCreds.sign };
        }

        const retryText = retryResponse.text;
        if (!retryText.includes('coe.alreadyAuthenticated')) {
          throw Object.assign(
            new Error(`WSAA: HTTP ${retryResponse.status} - ${retryText.substring(0, 500)}`),
            { name: 'WSAAError' }
          );
        }
      }

      throw Object.assign(
        new Error('WSAA: El servidor ARCA aún posee un ticket válido anterior. Intente nuevamente en unos minutos.'),
        { name: 'WSAAError' }
      );
    }

    throw Object.assign(
      new Error(`WSAA: HTTP ${response.status} - ${errorText.substring(0, 500)}`),
      { name: 'WSAAError' }
    );
  }

  const responseXml = response.text;

  // 4. Parse response
  const credentials = await parseLoginResponse(responseXml);

  // 5. Cache (memory + file)
  credentialsCache.set(cacheKey, credentials);
  saveCachedCredentials(cacheKey, credentials);
  console.log(`[WSAA] Autenticación exitosa. Token válido hasta: ${credentials.expirationTime.toLocaleString()}`);

  return { token: credentials.token, sign: credentials.sign };
}

/**
 * Clear cached credentials (useful for testing or forced re-auth).
 */
export function clearWSAACache(): void {
  credentialsCache.clear();
}
