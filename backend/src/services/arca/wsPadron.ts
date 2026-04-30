/**
 * ws_sr_padron_a13 — Consulta de CUIT en el Padrón de ARCA
 * ──────────────────────────────────────────────────────────
 * Allows looking up a CUIT to retrieve the contributor's name,
 * IVA condition, and fiscal address.
 *
 * TA caching: reuses getWSAACredentials() from wsaa.ts — no extra login
 * requests are made if a valid TA is already cached (in memory or on disk).
 *
 * "No Alcanzado": when a CUIT exists in the padrón but has no IVA
 * registration (e.g. employees, pensioners), noAlcanzado is set to true
 * and condicionIva is returned as null. The frontend should keep the IVA
 * field unlocked so the user can choose manually.
 *
 * Name normalization: AFIP returns all fields in UPPER CASE.
 * We apply title case here so the DB always receives clean values.
 */

import { parseStringPromise } from 'xml2js';
import { arcaFetch } from './arcaFetch.js';
import { getWSAACredentials, type WSAAConfig } from './wsaa.js';

// ── Endpoints ────────────────────────────────────────────
const PADRON_URLS = {
  testing: 'https://awshomo.afip.gov.ar/sr-padron/webservices/personaServiceA13',
  production: 'https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13',
} as const;

// ── Public result type ───────────────────────────────────
export interface PadronResult {
  /** Razón social or Apellido, Nombre — already in title case */
  razonSocial: string;
  /** Normalized IVA condition (our system's format), or null if "No Alcanzado" */
  condicionIva: string | null;
  /** True when the CUIT exists but has no active IVA/Monotributo registration */
  noAlcanzado: boolean;
  /** Fiscal street address */
  domicilio: string | null;
  /** City / locality */
  ciudad: string | null;
  /** Province name */
  provincia: string | null;
  /** Postal code from fiscal address */
  codigoPostal: string | null;
  /** Primary economic activity description (descripcionActividadPrincipal) */
  rubro: string | null;
  /** Date of birth in ISO format (FISICA only) */
  fechaNacimiento: string | null;
  /** 'FISICA' | 'JURIDICA' */
  tipoPersona: string | null;
  /** 'ACTIVO' | 'INACTIVO' */
  estadoClave: string;
}

// ── Helpers ──────────────────────────────────────────────

/** Convert an AFIP all-caps string to title case. */
function toTitleCase(str: string): string {
  if (!str) return str;
  return str.toLowerCase().replace(/(?:^|\s|,|-)\w/g, c => c.toUpperCase());
}

/** Build the SOAP request envelope for getPersona. */
function buildGetPersonaRequest(
  token: string,
  sign: string,
  cuitRepresentada: string,
  idPersona: string,
): string {
  // Use a namespace prefix (a13:) instead of a default xmlns declaration.
  // With xmlns="..." the namespace propagates to ALL child elements, causing
  // ARCA to reject token/sign/etc. as unexpected qualified elements.
  // With the prefix only the wrapper element is qualified; children stay unqualified.
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:a13="http://a13.soap.ws.server.puc.sr/">
  <soapenv:Header/>
  <soapenv:Body>
    <a13:getPersona>
      <token>${token}</token>
      <sign>${sign}</sign>
      <cuitRepresentada>${cuitRepresentada}</cuitRepresentada>
      <idPersona>${idPersona}</idPersona>
    </a13:getPersona>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * Derive our system's IVA condition string from the raw Padrón persona data.
 *
 * The ws_sr_padron_a13 response is FLAT — all fields are direct children of
 * <persona>, there is no <datosGenerales> or <datosImpositivos> wrapper.
 *
 * Rules:
 *  - actividadesMonotributivas / categoriasMonotributo present → 'Monotributista'
 *  - impuesto with idImpuesto=32 (IVA) → 'Responsable Inscripto'
 *  - neither → noAlcanzado = true, condicionIva = null
 */
function derivarCondicionIva(persona: any): { condicionIva: string | null; noAlcanzado: boolean } {
  // Monotributo: flat indicators directly on persona
  if (
    persona.actividadesMonotributivas ||
    persona.categoriasMonotributo ||
    persona.categoriaMonotributo ||
    persona.datosMonotributo
  ) {
    return { condicionIva: 'Monotributista', noAlcanzado: false };
  }

  // Impuestos are direct children of <persona> (flat schema)
  // Fall back to nested datosImpositivos for safety
  const rawImpuesto = persona.impuesto ?? persona.datosImpositivos?.impuesto;
  const impuestos: any[] = Array.isArray(rawImpuesto) ? rawImpuesto : rawImpuesto ? [rawImpuesto] : [];

  const tieneIva = impuestos.some((i: any) => String(i.idImpuesto) === '32');
  if (tieneIva) {
    return { condicionIva: 'Responsable Inscripto', noAlcanzado: false };
  }

  // CUIT found but no IVA/Monotributo registration — "No Alcanzado"
  return { condicionIva: null, noAlcanzado: true };
}

// ── Main export ──────────────────────────────────────────

/**
 * Consult the ARCA Padrón (ws_sr_padron_a13) for a given CUIT.
 *
 * @param cuit 11-digit CUIT string, no dashes
 * @param wsaaConfig Authentication config (cert, key, environment, cuit)
 */
export async function consultarCuit(cuit: string, wsaaConfig: WSAAConfig): Promise<PadronResult> {
  // TA is cached by wsaa.ts — this will only call WSAA if the token has expired
  const { token, sign } = await getWSAACredentials('ws_sr_padron_a13', wsaaConfig);

  const url = PADRON_URLS[wsaaConfig.environment];
  const body = buildGetPersonaRequest(token, sign, wsaaConfig.cuit, cuit);

  const response = await arcaFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Padrón ARCA: HTTP ${response.status} — ${response.text.slice(0, 200)}`);
  }

  const parsed = await parseStringPromise(response.text, { explicitArray: false });

  // Navigate SOAP envelope (namespace prefix varies)
  const soapBody =
    parsed['soapenv:Envelope']?.['soapenv:Body'] ||
    parsed['soap:Envelope']?.['soap:Body'] ||
    parsed['S:Envelope']?.['S:Body'];

  if (!soapBody) throw new Error('Respuesta SOAP inválida del servicio Padrón');

  // SOAP Fault check
  const fault = soapBody['soapenv:Fault'] || soapBody['soap:Fault'] || soapBody['S:Fault'];
  if (fault) {
    const raw = fault.faultstring || fault['soap:Text'] || 'Error del servicio Padrón';
    const msg: string = typeof raw === 'object' ? (raw._ ?? JSON.stringify(raw)) : String(raw);
    const err = new Error(`ARCA Padrón: ${msg}`) as any;
    // Map "not found" faults to codigoError so the route returns 404
    const msgUpper = msg.toUpperCase();
    if (msgUpper.includes('INEXISTENTE') || msgUpper.includes('NO ENCONTRADO')) {
      err.codigoError = 'NOT_FOUND';
    }
    throw err;
  }

  // personaReturn can come with different namespace prefixes
  const getPersonaResponse =
    soapBody['getPersonaResponse'] ||
    soapBody['ns2:getPersonaResponse'];

  const personaReturn = getPersonaResponse?.['personaReturn'];

  if (!personaReturn) {
    throw new Error('No se encontró personaReturn en la respuesta del Padrón');
  }

  // Error from AFIP (e.g. CUIT not found)
  const errorConstancia = personaReturn.errorConstancia;
  if (errorConstancia?.codigoError && String(errorConstancia.codigoError) !== '0') {
    const err = new Error(
      errorConstancia.descripcionError || `Error ARCA código ${errorConstancia.codigoError}`,
    ) as any;
    err.codigoError = errorConstancia.codigoError;
    throw err;
  }

  const persona = personaReturn.persona;
  if (!persona) {
    throw new Error('CUIT no encontrado en el padrón de ARCA');
  }

  // ws_sr_padron_a13 uses a FLAT structure — fields are directly on persona
  // (no datosGenerales wrapper). datosGenerales fallback kept for safety.
  const dg = persona.datosGenerales ?? persona;

  // Build display name in title case
  let razonSocial: string;
  if (dg.tipoPersona === 'JURIDICA') {
    razonSocial = toTitleCase(dg.razonSocial || String(cuit));
  } else {
    // FISICA: "APELLIDO, NOMBRE SEGUNDO" → "Apellido, Nombre Segundo"
    const apellido = dg.apellido || '';
    const nombre = dg.nombre || '';
    const rawName = apellido && nombre ? `${apellido}, ${nombre}` : apellido || nombre || String(cuit);
    razonSocial = toTitleCase(rawName);
  }

  const { condicionIva, noAlcanzado } = derivarCondicionIva(persona);

  // Fiscal address: ws_sr_padron_a13 returns an array of <domicilio> elements,
  // each with a <tipoDomicilio> field (FISCAL, LEGAL/REAL, etc.).
  // We prefer the FISCAL one; fall back to the first available.
  const rawDomicilios = dg.domicilio ?? dg.domicilioFiscal;
  const domicilios: any[] = Array.isArray(rawDomicilios)
    ? rawDomicilios
    : rawDomicilios
      ? [rawDomicilios]
      : [];
  const domicilioFiscal =
    domicilios.find((d: any) => d.tipoDomicilio === 'FISCAL') ?? domicilios[0];

  const domicilio = domicilioFiscal?.direccion ? toTitleCase(domicilioFiscal.direccion) : null;
  const ciudad = domicilioFiscal?.localidad ? toTitleCase(domicilioFiscal.localidad) : null;
  const provincia = domicilioFiscal?.descripcionProvincia
    ? toTitleCase(domicilioFiscal.descripcionProvincia)
    : null;
  const codigoPostal = domicilioFiscal?.codigoPostal ? String(domicilioFiscal.codigoPostal) : null;

  const rubro = dg.descripcionActividadPrincipal
    ? toTitleCase(String(dg.descripcionActividadPrincipal))
    : null;

  // fechaNacimiento is only present for FISICA; AFIP returns it as ISO date string
  const fechaNacimiento = dg.fechaNacimiento ? String(dg.fechaNacimiento).slice(0, 10) : null;

  return {
    razonSocial,
    condicionIva,
    noAlcanzado,
    domicilio,
    ciudad,
    provincia,
    codigoPostal,
    rubro,
    fechaNacimiento,
    tipoPersona: dg.tipoPersona ?? null,
    estadoClave: dg.estadoClave || 'ACTIVO',
  };
}
