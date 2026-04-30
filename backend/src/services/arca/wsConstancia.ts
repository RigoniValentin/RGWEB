/**
 * ws_sr_constancia — Consulta de Constancia de Inscripción (ARCA)
 * ─────────────────────────────────────────────────────────────────
 * Retrieves the taxpayer's inscription constancy (A4 service), which
 * provides a richer view of their tax obligations compared to the
 * Padrón A13.
 *
 * Key differences from ws_sr_padron_a13:
 *  - Service name:  ws_sr_constancia
 *  - Endpoint:      personaServiceA4
 *  - SOAP prefix:   a4:
 *  - XML structure: NESTED — data lives under <datosGenerales>
 *  - IVA impuesto IDs:
 *      30 → Responsable Inscripto
 *      20 → Monotributista
 *      32 → Exento
 *
 * TA caching: reuses getWSAACredentials() — no extra login per query.
 */

import { parseStringPromise } from 'xml2js';
import { arcaFetch } from './arcaFetch.js';
import { getWSAACredentials, type WSAAConfig } from './wsaa.js';

// ── Endpoints ────────────────────────────────────────────
const CONSTANCIA_URLS = {
  testing: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA4',
  production: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA4',
} as const;

// ── Business-rule IVA ID → condition string ──────────────
const IVA_MAP: Record<string, string> = {
  '30': 'Responsable Inscripto',
  '20': 'Monotributista',
  '32': 'Exento',
};

// ── Public result type ───────────────────────────────────
export interface ConstanciaResult {
  cuit: string;
  razonSocial: string;
  condicionIva: string;
  domicilio: string | null;
  ciudad: string | null;
  provincia: string | null;
  codigoPostal: string | null;
  estadoClave: string;
}

// ── Helpers ──────────────────────────────────────────────

function toTitleCase(str: string): string {
  if (!str) return str;
  return str.toLowerCase().replace(/(?:^|\s|,|-)\w/g, (c) => c.toUpperCase());
}

/** Build SOAP envelope for ws_sr_constancia getPersona (A4 namespace). */
function buildRequest(
  token: string,
  sign: string,
  cuitRepresentada: string,
  idPersona: string,
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a4="http://a4.soap.ws.server.puc.sr/">
  <soapenv:Header/>
  <soapenv:Body>
    <a4:getPersona>
      <token>${token}</token>
      <sign>${sign}</sign>
      <cuitRepresentada>${cuitRepresentada}</cuitRepresentada>
      <idPersona>${idPersona}</idPersona>
    </a4:getPersona>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Derive IVA condition from ws_sr_constancia datosGenerales.
 *
 * The response uses nested XML (datosGenerales wrapper). Impuestos can be
 * in datosGenerales.datosRegimenGeneral.impuesto[] or
 * datosGenerales.impuesto[] (fallback). Monotributo is signalled either
 * by idImpuesto=20 or by the presence of datosMonotributo.
 */
function derivarCondicionIva(dg: any): string {
  // Check for Monotributo section
  if (dg.datosMonotributo || dg.categoriaMonotributo) {
    return 'Monotributista';
  }

  // Gather impuesto array from datosRegimenGeneral or directly from dg
  const rawRegGeneral = dg.datosRegimenGeneral?.impuesto ?? dg.impuesto;
  const impuestos: any[] = Array.isArray(rawRegGeneral)
    ? rawRegGeneral
    : rawRegGeneral
      ? [rawRegGeneral]
      : [];

  for (const imp of impuestos) {
    const id = String(imp.idImpuesto ?? imp.id ?? '');
    if (IVA_MAP[id]) return IVA_MAP[id];
  }

  return 'Consumidor Final / No Alcanzado';
}

// ── Main export ──────────────────────────────────────────

/**
 * Consult ARCA Constancia de Inscripción (ws_sr_constancia) for a CUIT.
 *
 * @param cuit 11-digit CUIT string, no dashes
 * @param wsaaConfig Authentication config (cert, key, environment, cuit)
 */
export async function consultarConstancia(
  cuit: string,
  wsaaConfig: WSAAConfig,
): Promise<ConstanciaResult> {
  // TA cache is keyed by service name — ws_sr_constancia gets its own token
  const { token, sign } = await getWSAACredentials('ws_sr_constancia', wsaaConfig);

  const url = CONSTANCIA_URLS[wsaaConfig.environment];
  const body = buildRequest(token, sign, wsaaConfig.cuit, cuit);

  const response = await arcaFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      SOAPAction: '',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Constancia ARCA: HTTP ${response.status} — ${response.text.slice(0, 200)}`);
  }

  const parsed = await parseStringPromise(response.text, { explicitArray: false });

  // Navigate SOAP envelope (namespace prefix varies by JVM config)
  const soapBody =
    parsed['soapenv:Envelope']?.['soapenv:Body'] ||
    parsed['soap:Envelope']?.['soap:Body'] ||
    parsed['S:Envelope']?.['S:Body'];

  if (!soapBody) {
    throw new Error('Respuesta SOAP inválida del servicio Constancia');
  }

  // SOAP Fault
  const fault =
    soapBody['soapenv:Fault'] || soapBody['soap:Fault'] || soapBody['S:Fault'];
  if (fault) {
    const raw = fault.faultstring || fault['soap:Text'] || 'Error del servicio Constancia';
    const msg: string = typeof raw === 'object' ? (raw._ ?? JSON.stringify(raw)) : String(raw);
    const err = new Error(`ARCA Constancia: ${msg}`) as any;
    const msgUpper = msg.toUpperCase();
    if (msgUpper.includes('INEXISTENTE') || msgUpper.includes('NO ENCONTRADO')) {
      err.codigoError = 'NOT_FOUND';
    } else if (
      msgUpper.includes('AUTENTICACION') ||
      msgUpper.includes('AUTENTICACIÓN') ||
      msgUpper.includes('TOKEN') ||
      msgUpper.includes('SIGN')
    ) {
      err.codigoError = 'AUTH_ERROR';
    } else if (msgUpper.includes('CUIT') && msgUpper.includes('INVAL')) {
      err.codigoError = 'INVALID_CUIT';
    }
    throw err;
  }

  // getPersonaResponse — may come with ns2 prefix
  const getPersonaResponse =
    soapBody['getPersonaResponse'] || soapBody['ns2:getPersonaResponse'];

  const personaReturn = getPersonaResponse?.['personaReturn'];

  if (!personaReturn) {
    throw new Error('No se encontró personaReturn en la respuesta de Constancia');
  }

  // AFIP-level error (e.g. CUIT not found)
  const errorConstancia = personaReturn.errorConstancia;
  if (errorConstancia?.codigoError && String(errorConstancia.codigoError) !== '0') {
    const err = new Error(
      errorConstancia.descripcionError ||
        `Error ARCA Constancia código ${errorConstancia.codigoError}`,
    ) as any;
    err.codigoError = errorConstancia.codigoError;
    throw err;
  }

  // ws_sr_constancia uses NESTED structure — data is inside datosGenerales
  const dg = personaReturn.datosGenerales;
  if (!dg) {
    throw new Error('CUIT no encontrado en la constancia de inscripción de ARCA');
  }

  // Build display name
  let razonSocial: string;
  if (dg.tipoPersona === 'JURIDICA') {
    razonSocial = toTitleCase(dg.razonSocial || String(cuit));
  } else {
    const apellido = dg.apellido || '';
    const nombre = dg.nombre || '';
    const raw =
      apellido && nombre ? `${apellido}, ${nombre}` : apellido || nombre || String(cuit);
    razonSocial = toTitleCase(raw);
  }

  const condicionIva = derivarCondicionIva(dg);

  // Fiscal address — ws_sr_constancia uses domicilioFiscal object (not array)
  const df = dg.domicilioFiscal;
  const domicilio = df?.direccion ? toTitleCase(String(df.direccion)) : null;
  const ciudad = df?.localidad ? toTitleCase(String(df.localidad)) : null;
  const provincia = df?.descripcionProvincia
    ? toTitleCase(String(df.descripcionProvincia))
    : null;
  const codigoPostal = df?.codigoPostal ? String(df.codigoPostal) : null;

  return {
    cuit,
    razonSocial,
    condicionIva,
    domicilio,
    ciudad,
    provincia,
    codigoPostal,
    estadoClave: String(dg.estadoClave || 'ACTIVO'),
  };
}
