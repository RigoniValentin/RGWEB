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

import crypto from 'crypto';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseStringPromise } from 'xml2js';

// ── Endpoints ────────────────────────────────────────
const WSAA_URLS = {
  testing: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  production: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
} as const;

// ── Cached credentials ──────────────────────────────
interface WSAACredentials {
  token: string;
  sign: string;
  expirationTime: Date;
}

const credentialsCache: Map<string, WSAACredentials> = new Map();

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

  const formatDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '-03:00');

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
 * Sign the TRA using OpenSSL to create a CMS (PKCS#7) signed message.
 * Uses the contributor's private key and certificate.
 *
 * We shell out to OpenSSL because Node.js crypto doesn't natively support
 * creating PKCS#7/CMS signed data in the format ARCA requires.
 */
function signTRA(tra: string, privateKeyPath: string, certPath: string): string {
  // Write TRA to a temp file
  const tmpDir = os.tmpdir();
  const traPath = path.join(tmpDir, `tra_${Date.now()}.xml`);
  const cmsPath = path.join(tmpDir, `cms_${Date.now()}.pem`);

  try {
    fs.writeFileSync(traPath, tra, 'utf8');

    // Sign with OpenSSL (creates a PKCS#7 S/MIME signed message in DER→Base64)
    execSync(
      `openssl smime -sign -signer "${certPath}" -inkey "${privateKeyPath}" ` +
      `-in "${traPath}" -out "${cmsPath}" -outform pem -nodetach`,
      { stdio: 'pipe', timeout: 15_000 }
    );

    // Read the CMS output, extract only the Base64 payload (strip headers)
    const cmsContent = fs.readFileSync(cmsPath, 'utf8');
    const base64 = cmsContent
      .replace(/-----BEGIN PKCS7-----/g, '')
      .replace(/-----END PKCS7-----/g, '')
      .replace(/\r?\n/g, '');

    return base64;
  } finally {
    // Clean up temp files
    try { fs.unlinkSync(traPath); } catch { /* ignore */ }
    try { fs.unlinkSync(cmsPath); } catch { /* ignore */ }
  }
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

  // Check cache — reuse if not expired (with 5 min margin)
  const cached = credentialsCache.get(cacheKey);
  if (cached && cached.expirationTime.getTime() > Date.now() + 300_000) {
    return { token: cached.token, sign: cached.sign };
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
      new Error(`WSAA: Error al firmar el TRA: ${err.message}. Verifique que OpenSSL esté instalado y los archivos de certificado sean válidos.`),
      { name: 'WSAASignError' }
    );
  }

  // 3. Call WSAA LoginCms
  const wsaaUrl = WSAA_URLS[config.environment];
  const soapEnvelope = buildLoginCmsRequest(cms);

  const response = await fetch(wsaaUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '',
    },
    body: soapEnvelope,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw Object.assign(
      new Error(`WSAA: HTTP ${response.status} - ${errorText.substring(0, 500)}`),
      { name: 'WSAAError' }
    );
  }

  const responseXml = await response.text();

  // 4. Parse response
  const credentials = await parseLoginResponse(responseXml);

  // 5. Cache
  credentialsCache.set(cacheKey, credentials);
  console.log(`[WSAA] Autenticación exitosa. Token válido hasta: ${credentials.expirationTime.toLocaleString()}`);

  return { token: credentials.token, sign: credentials.sign };
}

/**
 * Clear cached credentials (useful for testing or forced re-auth).
 */
export function clearWSAACache(): void {
  credentialsCache.clear();
}
