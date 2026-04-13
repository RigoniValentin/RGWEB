/**
 * WSFEv1 — Web Service de Factura Electrónica V1 (ARCA)
 * ──────────────────────────────────────────────────────
 * Implements the SOAP calls to WSFEv1 for electronic invoicing:
 *   - FECAESolicitar (request CAE)

 *   - FECompUltimoAutorizado (last authorized receipt number)
 *   - FEParamGetTiposCbte, FEParamGetTiposIva, etc. (parametric tables)
 *   - FECompConsultar (query an issued receipt)
 *   - FEDummy (health check)
 *
 * Reference: manual-desarrollador-ARCA-COMPG-v4-1.pdf
 */

import { parseStringPromise, Builder } from 'xml2js';
import { arcaFetch } from './arcaFetch.js';

// ── Endpoints ────────────────────────────────────────
export const WSFEV1_URLS = {
  testing: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  production: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
} as const;

// ── AFIP Comprobante type IDs ────────────────────────
export const CBTE_TIPOS = {
  'FACTURA A': 1,
  'NOTA DE DEBITO A': 2,
  'NOTA DE CREDITO A': 3,
  'FACTURA B': 6,
  'NOTA DE DEBITO B': 7,
  'NOTA DE CREDITO B': 8,
  'FACTURA C': 11,
  'NOTA DE DEBITO C': 12,
  'NOTA DE CREDITO C': 13,
} as const;

// ── AFIP IVA IDs ────────────────────────────────────
export const IVA_IDS = {
  0: 3,      // 0%
  2.5: 9,    // 2.5%
  5: 8,      // 5%
  10.5: 4,   // 10.5%
  21: 5,     // 21%
  27: 6,     // 27%
} as Record<number, number>;

// ── AFIP Concepto IDs ───────────────────────────────
export const CONCEPTO = {
  PRODUCTOS: 1,
  SERVICIOS: 2,
  PRODUCTOS_Y_SERVICIOS: 3,
} as const;

// ── AFIP Doc Tipo IDs ───────────────────────────────
export const DOC_TIPOS = {
  CUIT: 80,
  CUIL: 86,
  CDI: 87,
  LE: 89,
  LC: 90,
  CI_EXTRANJERA: 91,
  DNI: 96,
  PASAPORTE: 94,
  CI: 0,
  SIN_IDENTIFICAR: 99,
} as const;

// ── Interfaces ──────────────────────────────────────

export interface FEAuthRequest {
  Token: string;
  Sign: string;
  Cuit: string;
}

export interface FEAlicuotaIva {
  Id: number;       // IVA_IDS value (3, 4, 5, 6, 8, 9)
  BaseImp: number;  // Neto gravado for this rate
  Importe: number;  // IVA amount
}

export interface FEComprobante {
  CbteTipo: number;        // CBTE_TIPOS value
  Concepto: number;        // 1=Productos, 2=Servicios, 3=Ambos
  DocTipo: number;         // DOC_TIPOS value
  DocNro: number;          // Doc number (CUIT, DNI, etc.)
  CbteDesde: number;       // Receipt number from
  CbteHasta: number;       // Receipt number to (same as CbteDesde for single)
  CbteFch: string;         // Date YYYYMMDD
  ImpTotal: number;        // Total amount
  ImpTotConc: number;      // Non-taxable total (no gravado)
  ImpNeto: number;         // Net taxable total
  ImpOpEx: number;         // Exempt total
  ImpIVA: number;          // IVA total
  ImpTrib: number;         // Other taxes total
  MonId: string;           // Currency code ('PES' for ARS)
  MonCotiz: number;        // Exchange rate (1 for PES)
  Iva?: FEAlicuotaIva[];   // IVA breakdown (required for A/B)
  FchServDesde?: string;   // Service period start (for Concepto 2/3)
  FchServHasta?: string;   // Service period end
  FchVtoPago?: string;     // Payment due date (for Concepto 2/3)
  CbtesAsoc?: { Tipo: number; PtoVta: number; Nro: number; Cuit?: string; CbteFch?: string }[];
  Tributos?: { Id: number; Desc: string; BaseImp: number; Alic: number; Importe: number }[];
  Opcionales?: { Id: string; Valor: string }[];
  CondicionIvaReceptor?: number;
}

export interface FECAEResponse {
  FeCabResp: {
    Cuit: string;
    PtoVta: number;
    CbteTipo: number;
    FchProceso: string;
    CantReg: number;
    Resultado: string; // 'A' = Aprobado, 'R' = Rechazado, 'P' = Parcial
  };
  FeDetResp: {
    Resultado: string;
    CbteDesde: number;
    CbteHasta: number;
    CAE: string;
    CAEFchVto: string;
    Observaciones?: { Code: string; Msg: string }[];
  }[];
  Errors?: { Code: string; Msg: string }[];
  Events?: { Code: string; Msg: string }[];
}

// ── SOAP helpers ────────────────────────────────────

const SOAP_NS = 'http://ar.gov.afip.dif.FEV1/';

function buildSoapEnvelope(method: string, bodyContent: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:ar="${SOAP_NS}">
  <soap:Body>
    <ar:${method}>
      ${bodyContent}
    </ar:${method}>
  </soap:Body>
</soap:Envelope>`;
}

function buildAuthXml(auth: FEAuthRequest): string {
  return `<ar:Auth>
        <ar:Token>${auth.Token}</ar:Token>
        <ar:Sign>${auth.Sign}</ar:Sign>
        <ar:Cuit>${auth.Cuit}</ar:Cuit>
      </ar:Auth>`;
}

async function callSoap(url: string, method: string, body: string): Promise<any> {
  const envelope = buildSoapEnvelope(method, body);

  const response = await arcaFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': `${SOAP_NS}${method}`,
    },
    body: envelope,
  });

  if (!response.ok) {
    throw Object.assign(
      new Error(`WSFEv1 HTTP ${response.status}: ${response.text.substring(0, 500)}`),
      { name: 'WSFEv1Error' }
    );
  }

  const xml = response.text;
  const parsed = await parseStringPromise(xml, { explicitArray: false, ignoreAttrs: true });

  // Navigate to the SOAP body
  const soapBody = parsed['soap:Envelope']?.['soap:Body']
    || parsed['soapenv:Envelope']?.['soapenv:Body'];

  if (!soapBody) {
    throw new Error('WSFEv1: Respuesta SOAP inválida');
  }

  // Check for SOAP fault
  const fault = soapBody['soap:Fault'] || soapBody['soapenv:Fault'];
  if (fault) {
    throw Object.assign(
      new Error(`WSFEv1 SOAP Fault: ${fault.faultstring || 'Error desconocido'}`),
      { name: 'WSFEv1Error' }
    );
  }

  // Extract the response element
  const responseKey = `${method}Response`;
  const resultKey = `${method}Result`;
  const responseEl = soapBody[responseKey];
  return responseEl?.[resultKey] || responseEl;
}

// ── Public API ──────────────────────────────────────

/**
 * FEDummy — Health check. Returns the status of AppServer, DbServer, and AuthServer.
 */
export async function feDummy(
  environment: 'testing' | 'production'
): Promise<{ AppServer: string; DbServer: string; AuthServer: string }> {
  const url = WSFEV1_URLS[environment];
  const result = await callSoap(url, 'FEDummy', '');
  return {
    AppServer: result?.AppServer || 'ERROR',
    DbServer: result?.DbServer || 'ERROR',
    AuthServer: result?.AuthServer || 'ERROR',
  };
}

/**
 * FECompUltimoAutorizado — Get the last authorized receipt number
 * for a given PtoVta + CbteTipo.
 */
export async function feCompUltimoAutorizado(
  auth: FEAuthRequest,
  ptoVta: number,
  cbteTipo: number,
  environment: 'testing' | 'production'
): Promise<number> {
  const url = WSFEV1_URLS[environment];
  const body = `${buildAuthXml(auth)}
      <ar:PtoVta>${ptoVta}</ar:PtoVta>
      <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`;

  const result = await callSoap(url, 'FECompUltimoAutorizado', body);

  if (result?.Errors?.Err) {
    const err = Array.isArray(result.Errors.Err) ? result.Errors.Err : [result.Errors.Err];
    throw Object.assign(
      new Error(`WSFEv1: ${err.map((e: any) => `[${e.Code}] ${e.Msg}`).join(', ')}`),
      { name: 'WSFEv1Error' }
    );
  }

  return parseInt(result?.CbteNro || '0', 10);
}

/**
 * FECAESolicitar — Request a CAE for one or more receipts.
 * This is the core method for electronic invoicing.
 */
export async function feCAESolicitar(
  auth: FEAuthRequest,
  ptoVta: number,
  comprobante: FEComprobante,
  environment: 'testing' | 'production'
): Promise<FECAEResponse> {
  const url = WSFEV1_URLS[environment];

  // Build IVA array XML
  let ivaXml = '';
  if (comprobante.Iva && comprobante.Iva.length > 0) {
    const ivaItems = comprobante.Iva.map(iva =>
      `<ar:AlicIva>
              <ar:Id>${iva.Id}</ar:Id>
              <ar:BaseImp>${iva.BaseImp.toFixed(2)}</ar:BaseImp>
              <ar:Importe>${iva.Importe.toFixed(2)}</ar:Importe>
            </ar:AlicIva>`
    ).join('\n');
    ivaXml = `<ar:Iva>${ivaItems}</ar:Iva>`;
  }

  // Build CbtesAsoc XML
  let asocXml = '';
  if (comprobante.CbtesAsoc && comprobante.CbtesAsoc.length > 0) {
    const items = comprobante.CbtesAsoc.map(a =>
      `<ar:CbteAsoc>
              <ar:Tipo>${a.Tipo}</ar:Tipo>
              <ar:PtoVta>${a.PtoVta}</ar:PtoVta>
              <ar:Nro>${a.Nro}</ar:Nro>
              ${a.Cuit ? `<ar:Cuit>${a.Cuit}</ar:Cuit>` : ''}
              ${a.CbteFch ? `<ar:CbteFch>${a.CbteFch}</ar:CbteFch>` : ''}
            </ar:CbteAsoc>`
    ).join('\n');
    asocXml = `<ar:CbtesAsoc>${items}</ar:CbtesAsoc>`;
  }

  // Build Tributos XML
  let tributosXml = '';
  if (comprobante.Tributos && comprobante.Tributos.length > 0) {
    const items = comprobante.Tributos.map(t =>
      `<ar:Tributo>
              <ar:Id>${t.Id}</ar:Id>
              <ar:Desc>${escapeXml(t.Desc)}</ar:Desc>
              <ar:BaseImp>${t.BaseImp.toFixed(2)}</ar:BaseImp>
              <ar:Alic>${t.Alic.toFixed(2)}</ar:Alic>
              <ar:Importe>${t.Importe.toFixed(2)}</ar:Importe>
            </ar:Tributo>`
    ).join('\n');
    tributosXml = `<ar:Tributos>${items}</ar:Tributos>`;
  }

  // Optional service period fields (required for Concepto 2 or 3)
  const servicePeriodXml = (comprobante.Concepto === CONCEPTO.SERVICIOS || comprobante.Concepto === CONCEPTO.PRODUCTOS_Y_SERVICIOS)
    ? `<ar:FchServDesde>${comprobante.FchServDesde || comprobante.CbteFch}</ar:FchServDesde>
            <ar:FchServHasta>${comprobante.FchServHasta || comprobante.CbteFch}</ar:FchServHasta>
            <ar:FchVtoPago>${comprobante.FchVtoPago || comprobante.CbteFch}</ar:FchVtoPago>`
    : '';

  const body = `${buildAuthXml(auth)}
      <ar:FeCAEReq>
        <ar:FeCabReq>
          <ar:CantReg>1</ar:CantReg>
          <ar:PtoVta>${ptoVta}</ar:PtoVta>
          <ar:CbteTipo>${comprobante.CbteTipo}</ar:CbteTipo>
        </ar:FeCabReq>
        <ar:FeDetReq>
          <ar:FECAEDetRequest>
            <ar:Concepto>${comprobante.Concepto}</ar:Concepto>
            <ar:DocTipo>${comprobante.DocTipo}</ar:DocTipo>
            <ar:DocNro>${comprobante.DocNro}</ar:DocNro>
            <ar:CbteDesde>${comprobante.CbteDesde}</ar:CbteDesde>
            <ar:CbteHasta>${comprobante.CbteHasta}</ar:CbteHasta>
            <ar:CbteFch>${comprobante.CbteFch}</ar:CbteFch>
            <ar:ImpTotal>${comprobante.ImpTotal.toFixed(2)}</ar:ImpTotal>
            <ar:ImpTotConc>${comprobante.ImpTotConc.toFixed(2)}</ar:ImpTotConc>
            <ar:ImpNeto>${comprobante.ImpNeto.toFixed(2)}</ar:ImpNeto>
            <ar:ImpOpEx>${comprobante.ImpOpEx.toFixed(2)}</ar:ImpOpEx>
            <ar:ImpTrib>${comprobante.ImpTrib.toFixed(2)}</ar:ImpTrib>
            <ar:ImpIVA>${comprobante.ImpIVA.toFixed(2)}</ar:ImpIVA>
            ${servicePeriodXml}
            <ar:MonId>${comprobante.MonId}</ar:MonId>
            <ar:MonCotiz>${comprobante.MonCotiz}</ar:MonCotiz>
            ${comprobante.CondicionIvaReceptor ? `<ar:CondicionIVAReceptorId>${comprobante.CondicionIvaReceptor}</ar:CondicionIVAReceptorId>` : ''}
            ${asocXml}
            ${tributosXml}
            ${ivaXml}
          </ar:FECAEDetRequest>
        </ar:FeDetReq>
      </ar:FeCAEReq>`;

  const result = await callSoap(url, 'FECAESolicitar', body);

  // Parse the response
  const response: FECAEResponse = {
    FeCabResp: {
      Cuit: result?.FeCabResp?.Cuit || '',
      PtoVta: parseInt(result?.FeCabResp?.PtoVta || '0', 10),
      CbteTipo: parseInt(result?.FeCabResp?.CbteTipo || '0', 10),
      FchProceso: result?.FeCabResp?.FchProceso || '',
      CantReg: parseInt(result?.FeCabResp?.CantReg || '0', 10),
      Resultado: result?.FeCabResp?.Resultado || 'R',
    },
    FeDetResp: [],
    Errors: [],
    Events: [],
  };

  // Parse detail responses
  const detResp = result?.FeDetResp?.FECAEDetResponse;
  if (detResp) {
    const detArray = Array.isArray(detResp) ? detResp : [detResp];
    response.FeDetResp = detArray.map((d: any) => {
      const obs = d?.Observaciones?.Obs;
      const obsArray = obs ? (Array.isArray(obs) ? obs : [obs]) : [];
      return {
        Resultado: d.Resultado || 'R',
        CbteDesde: parseInt(d.CbteDesde || '0', 10),
        CbteHasta: parseInt(d.CbteHasta || '0', 10),
        CAE: d.CAE || '',
        CAEFchVto: d.CAEFchVto || '',
        Observaciones: obsArray.map((o: any) => ({ Code: o.Code || '', Msg: o.Msg || '' })),
      };
    });
  }

  // Parse errors
  const errors = result?.Errors?.Err;
  if (errors) {
    response.Errors = (Array.isArray(errors) ? errors : [errors])
      .map((e: any) => ({ Code: e.Code || '', Msg: e.Msg || '' }));
  }

  // Parse events
  const events = result?.Events?.Evt;
  if (events) {
    response.Events = (Array.isArray(events) ? events : [events])
      .map((e: any) => ({ Code: e.Code || '', Msg: e.Msg || '' }));
  }

  return response;
}

/**
 * FECompConsultar — Query an already issued receipt by its number.
 */
export async function feCompConsultar(
  auth: FEAuthRequest,
  cbteTipo: number,
  ptoVta: number,
  cbteNro: number,
  environment: 'testing' | 'production'
): Promise<any> {
  const url = WSFEV1_URLS[environment];
  const body = `${buildAuthXml(auth)}
      <ar:FeCompConsReq>
        <ar:CbteTipo>${cbteTipo}</ar:CbteTipo>
        <ar:CbteNro>${cbteNro}</ar:CbteNro>
        <ar:PtoVta>${ptoVta}</ar:PtoVta>
      </ar:FeCompConsReq>`;

  return await callSoap(url, 'FECompConsultar', body);
}

/**
 * FEParamGetPtosVenta — Get the list of registered points of sale.
 */
export async function feParamGetPtosVenta(
  auth: FEAuthRequest,
  environment: 'testing' | 'production'
): Promise<any[]> {
  const url = WSFEV1_URLS[environment];
  const body = buildAuthXml(auth);
  const result = await callSoap(url, 'FEParamGetPtosVenta', body);
  const ptosVenta = result?.ResultGet?.PtoVenta;
  if (!ptosVenta) return [];
  return Array.isArray(ptosVenta) ? ptosVenta : [ptosVenta];
}

/**
 * FEParamGetTiposCbte — Get available receipt types.
 */
export async function feParamGetTiposCbte(
  auth: FEAuthRequest,
  environment: 'testing' | 'production'
): Promise<any[]> {
  const url = WSFEV1_URLS[environment];
  const body = buildAuthXml(auth);
  const result = await callSoap(url, 'FEParamGetTiposCbte', body);
  const tipos = result?.ResultGet?.CbteTipo;
  if (!tipos) return [];
  return Array.isArray(tipos) ? tipos : [tipos];
}

/**
 * FEParamGetTiposIva — Get available IVA rate types.
 */
export async function feParamGetTiposIva(
  auth: FEAuthRequest,
  environment: 'testing' | 'production'
): Promise<any[]> {
  const url = WSFEV1_URLS[environment];
  const body = buildAuthXml(auth);
  const result = await callSoap(url, 'FEParamGetTiposIva', body);
  const tipos = result?.ResultGet?.IvaTipo;
  if (!tipos) return [];
  return Array.isArray(tipos) ? tipos : [tipos];
}

// ── Utility ─────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
