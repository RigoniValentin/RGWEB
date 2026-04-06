import { getPool, sql } from '../database/connection.js';
import { config } from '../config/index.js';
import { getWSAACredentials, type WSAAConfig } from './arca/wsaa.js';
import {
  feCAESolicitar, feCompUltimoAutorizado, feDummy,
  feParamGetPtosVenta, feCompConsultar,
  CBTE_TIPOS, IVA_IDS, CONCEPTO, DOC_TIPOS,
  type FEAuthRequest, type FEComprobante, type FEAlicuotaIva, type FECAEResponse,
} from './arca/wsfev1.js';

// ═══════════════════════════════════════════════════
//  Facturación Electrónica Service
//  Integración directa con ARCA (ex-AFIP) via WSFEv1
// ═══════════════════════════════════════════════════

// ── Interfaces ───────────────────────────────────

export interface FERespuesta {
  error: string;
  errores: string[];
  rta: string;
  cae: string;
  vencimiento_cae: string;
  comprobante_nro: string;
  comprobante_tipo: string;
}

// ── Helpers ──────────────────────────────────────

/**
 * Formats a date as YYYYMMDD for ARCA WSFEv1.
 */
function formatFechaARCA(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Formats a number with InvariantCulture style (dot as decimal separator).
 */
function fmtNum(n: number): string {
  return n.toFixed(2);
}

/**
 * Calculates the Neto and IVA from a final (IVA-included) price.
 * AFIP Rule:
 *   IVA = PrecioFinal × (Alicuota / (1 + Alicuota))
 *   Neto = PrecioFinal - IVA
 * The alicuota parameter is already in decimal form (e.g. 0.21 for 21%).
 */
function calcularNetoEIva(precioFinal: number, alicuota: number): { iva: number; neto: number } {
  if (alicuota <= 0 || precioFinal <= 0) return { iva: 0, neto: precioFinal };
  const iva = Math.round(precioFinal * (alicuota / (1 + alicuota)) * 100) / 100;
  const neto = precioFinal - iva;
  return { iva, neto };
}

/**
 * Maps internal unit IDs to AFIP unit codes (kept for future use with wsmtxca).
 */
function mapUnidadAFIP(unidadId: number): number {
  switch (unidadId) {
    case 2: return 1;  // Kilo
    case 3: return 5;  // Litro
    default: return 7; // Unidad
  }
}

/**
 * Maps internal CONDICION_IVA to ARCA document type requirement.
 * RI and Monotributo require CUIT (80), CF can use DNI (96) or SIN_IDENTIFICAR (99).
 */
function getDocTipoForCondicion(condicionIva: string, documentoTipo: string): number {
  const c = (condicionIva || '').toUpperCase().trim();
  if (c === 'RESPONSABLE INSCRIPTO' || c === 'MONOTRIBUTO') return DOC_TIPOS.CUIT;
  const dt = (documentoTipo || '').toUpperCase().trim();
  if (dt === 'CUIT') return DOC_TIPOS.CUIT;
  if (dt === 'CUIL') return DOC_TIPOS.CUIL;
  if (dt === 'DNI') return DOC_TIPOS.DNI;
  return DOC_TIPOS.SIN_IDENTIFICAR;
}

/**
 * Maps internal comprobante codes to ARCA CbteTipo IDs.
 * Fa.A → 1, Fa.B → 6, Fa.C → 11
 */
function mapTipoComprobanteToARCA(tipo: string): number {
  switch (tipo) {
    case 'Fa.A': return CBTE_TIPOS['FACTURA A'];
    case 'Fa.B': return CBTE_TIPOS['FACTURA B'];
    case 'Fa.C': return CBTE_TIPOS['FACTURA C'];
    default: return CBTE_TIPOS['FACTURA B'];
  }
}

/**
 * Maps ARCA CbteTipo ID back to internal code.
 */
function mapTipoComprobanteFromARCA(cbteTipo: number): string {
  switch (cbteTipo) {
    case CBTE_TIPOS['FACTURA A']: return 'Fa.A';
    case CBTE_TIPOS['FACTURA B']: return 'Fa.B';
    case CBTE_TIPOS['FACTURA C']: return 'Fa.C';
    default: return `Tipo${cbteTipo}`;
  }
}

/**
 * Province name → AFIP province number.
 * Returns "1" (CABA) by default if unknown.
 */
function mapProvinciaAFIP(provincia: string): string {
  const p = (provincia || '').toUpperCase().trim();
  const map: Record<string, string> = {
    'BUENOS AIRES': '1',
    'CATAMARCA': '2',
    'CHACO': '3',
    'CHUBUT': '4',
    'CIUDAD AUTONOMA DE BUENOS AIRES': '0',
    'CAPITAL FEDERAL': '0',
    'CABA': '0',
    'CORDOBA': '5',
    'CÓRDOBA': '5',
    'CORRIENTES': '6',
    'ENTRE RIOS': '7',
    'ENTRE RÍOS': '7',
    'FORMOSA': '8',
    'JUJUY': '9',
    'LA PAMPA': '10',
    'LA RIOJA': '11',
    'MENDOZA': '12',
    'MISIONES': '13',
    'NEUQUEN': '14',
    'NEUQUÉN': '14',
    'RIO NEGRO': '15',
    'RÍO NEGRO': '15',
    'SALTA': '16',
    'SAN JUAN': '17',
    'SAN LUIS': '18',
    'SANTA CRUZ': '19',
    'SANTA FE': '20',
    'SANTIAGO DEL ESTERO': '21',
    'TIERRA DEL FUEGO': '22',
    'TUCUMAN': '23',
    'TUCUMÁN': '23',
  };
  return map[p] || '1';
}

// ── Service ──────────────────────────────────────

/**
 * Get WSAA config from app config.
 */
function getWSAAConfig(): WSAAConfig {
  return {
    privateKeyPath: config.arca.keyPath,
    certPath: config.arca.certPath,
    environment: config.arca.environment,
    cuit: config.arca.cuit,
  };
}

/**
 * Get authenticated FEAuthRequest for WSFEv1 calls.
 */
async function getAuth(): Promise<FEAuthRequest> {
  const wsaaConfig = getWSAAConfig();
  const { token, sign } = await getWSAACredentials('wsfe', wsaaConfig);
  return { Token: token, Sign: sign, Cuit: config.arca.cuit };
}

export const facturacionService = {
  /**
   * Check if FE is enabled for this installation.
   */
  isEnabled(): boolean {
    return config.app.utilizaFE === true;
  },

  /**
   * Check if ARCA integration is properly configured.
   */
  isArcaConfigured(): boolean {
    return !!(config.arca.cuit && config.arca.certPath && config.arca.keyPath);
  },

  /**
   * Get FE configuration status (for frontend).
   */
  getConfig() {
    return {
      utilizaFE: config.app.utilizaFE === true,
      arcaConfigured: this.isArcaConfigured(),
      arcaEnvironment: config.arca.environment,
    };
  },

  /**
   * Health check — calls FEDummy to verify ARCA services are up.
   */
  async healthCheck() {
    return await feDummy(config.arca.environment);
  },

  /**
   * Fetch client data for ARCA invoicing.
   * Returns document type (ARCA ID) and document number.
   */
  async getClienteData(clienteId: number): Promise<{
    docTipo: number;
    docNro: number;
    condicionIva: string;
    nombre: string;
  }> {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, clienteId)
      .query(`
        SELECT TIPO_DOCUMENTO, NUMERO_DOC, NOMBRE,
               CONDICION_IVA
        FROM CLIENTES WHERE CLIENTE_ID = @id
      `);

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Cliente no encontrado'), { name: 'ValidationError' });
    }

    const c = result.recordset[0];
    const condicionIva = (c.CONDICION_IVA || '').toUpperCase().trim();
    const esRI = condicionIva === 'RESPONSABLE INSCRIPTO';
    const esMonotributo = condicionIva === 'MONOTRIBUTO';

    let documentoTipo = c.TIPO_DOCUMENTO || 'DNI';
    let documentoNro = c.NUMERO_DOC || '0';

    if (esRI || esMonotributo) {
      documentoTipo = 'CUIT';
      if (!documentoNro || documentoNro === '0' || documentoNro.replace(/\D/g, '').length < 11) {
        throw Object.assign(
          new Error(`El cliente "${c.NOMBRE}" es ${condicionIva} y requiere un CUIT válido (11 dígitos). Actualice los datos del cliente antes de facturar.`),
          { name: 'ValidationError' }
        );
      }
      documentoNro = documentoNro.replace(/\D/g, '');
    }

    const docTipo = getDocTipoForCondicion(condicionIva, documentoTipo);
    // For Consumidor Final without doc, use 0
    const docNro = docTipo === DOC_TIPOS.SIN_IDENTIFICAR ? 0 : parseInt(documentoNro.replace(/\D/g, ''), 10) || 0;

    return {
      docTipo,
      docNro,
      condicionIva,
      nombre: c.NOMBRE || 'Consumidor Final',
    };
  },

  /**
   * Get the IVA alícuota (as decimal, e.g. 0.21) for a product.
   * Returns { porcentaje: 0, esExento: false } for Monotributo companies.
   * Returns esExento: true when the tax rate name contains "Exento".
   */
  async getAlicuotaProducto(productoId: number): Promise<{ porcentaje: number; esExento: boolean }> {
    const empresaIva = (await this.getEmpresaCondicionIVA()).toUpperCase();

    // Monotributo never discriminates IVA
    if (empresaIva === 'MONOTRIBUTO') return { porcentaje: 0, esExento: false };
    // Only RI discriminates
    if (empresaIva !== 'RESPONSABLE INSCRIPTO') return { porcentaje: 0, esExento: false };

    const pool = await getPool();
    const result = await pool.request()
      .input('pid', sql.Int, productoId)
      .query(`
        SELECT t.PORCENTAJE, t.NOMBRE AS TASA_NOMBRE
        FROM PRODUCTOS p
        LEFT JOIN TASAS_IMPUESTOS t ON p.TASA_IVA_ID = t.TASA_ID AND t.ACTIVA = 1
        WHERE p.PRODUCTO_ID = @pid
      `);

    if (result.recordset.length === 0 || result.recordset[0].PORCENTAJE == null) {
      return { porcentaje: 0, esExento: false };
    }

    const row = result.recordset[0];
    const esExento = (row.TASA_NOMBRE || '').toUpperCase().includes('EXENTO');
    return { porcentaje: row.PORCENTAJE / 100, esExento }; // e.g. 21 → 0.21
  },

  /**
   * Get the empresa CONDICION_IVA.
   */
  async getEmpresaCondicionIVA(): Promise<string> {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CONDICION_IVA FROM EMPRESA_CLIENTE
    `);
    return result.recordset[0]?.CONDICION_IVA || '';
  },

  /**
   * Get the PUNTO_VENTA from EMPRESA_CLIENTE table (fiscal point of sale for AFIP).
   */
  async getPuntoVentaFiscal(): Promise<string> {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT PUNTO_VENTA FROM EMPRESA_CLIENTE
    `);
    return result.recordset[0]?.PUNTO_VENTA?.toString() || '1';
  },

  /**
   * Get the unit ID for a product.
   */
  async getUnidadMedida(productoId: number): Promise<number> {
    const pool = await getPool();
    const result = await pool.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT UNIDAD_ID FROM PRODUCTOS WHERE PRODUCTO_ID = @pid`);
    return result.recordset[0]?.UNIDAD_ID || 1;
  },

  /**
   * Build and emit a factura electrónica via ARCA WSFEv1.
   * Replaces the old TusFacturasApp integration.
   */
  async emitirFactura(ventaId: number): Promise<{
    success: boolean;
    comprobante_nro: string;
    cae: string;
    cae_vto: string;
    tipo_comprobante: string;
    errores?: string[];
  }> {
    // Validate FE is enabled
    if (!this.isEnabled()) {
      throw Object.assign(new Error('La facturación electrónica no está habilitada'), { name: 'ValidationError' });
    }
    if (!this.isArcaConfigured()) {
      throw Object.assign(new Error('La integración con ARCA no está configurada. Verifique ArcaCuit, ArcaCertPath y ArcaKeyPath en appdata.ini'), { name: 'ValidationError' });
    }

    const pool = await getPool();

    // ── 1. Get the sale data ──
    const ventaResult = await pool.request()
      .input('id', sql.Int, ventaId)
      .query(`
        SELECT v.*, c.NOMBRE AS CLIENTE_NOMBRE, c.CONDICION_IVA AS CLIENTE_CONDICION_IVA
        FROM VENTAS v
        LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
        WHERE v.VENTA_ID = @id
      `);

    if (ventaResult.recordset.length === 0) {
      throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
    }

    const venta = ventaResult.recordset[0];

    // Check if already invoiced
    if (venta.NUMERO_FISCAL) {
      throw Object.assign(
        new Error(`La venta ya tiene número fiscal: ${venta.NUMERO_FISCAL}`),
        { name: 'ValidationError' }
      );
    }

    // ── 2. Get sale items ──
    const itemsResult = await pool.request()
      .input('id', sql.Int, ventaId)
      .query(`
        SELECT vi.*, p.NOMBRE AS PRODUCTO_NOMBRE, p.CODIGOPARTICULAR AS PRODUCTO_CODIGO,
               p.UNIDAD_ID, vi.IVA_ALICUOTA
        FROM VENTAS_ITEMS vi
        JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
        WHERE vi.VENTA_ID = @id
        ORDER BY vi.ITEM_ID
      `);

    const items = itemsResult.recordset;

    // ── 3. Get client data ──
    const cliente = await this.getClienteData(venta.CLIENTE_ID);

    // ── 4. Determine comprobante type ──
    const tipoComprobante = venta.TIPO_COMPROBANTE || 'Fa.B';
    const cbteTipo = mapTipoComprobanteToARCA(tipoComprobante);
    const esFacturaConIVA = tipoComprobante === 'Fa.A' || tipoComprobante === 'Fa.B';

    // ── 5. Format date ──
    const fecha = formatFechaARCA(new Date());

    // ── 6. Get fiscal punto de venta ──
    const puntoVenta = parseInt(await this.getPuntoVentaFiscal(), 10);

    // ── 7. Authenticate with ARCA ──
    const auth = await getAuth();

    // ── 8. Get last authorized receipt number ──
    const ultimoNro = await feCompUltimoAutorizado(auth, puntoVenta, cbteTipo, config.arca.environment);
    const cbteNro = ultimoNro + 1;

    // ── 9. Normalize detail totals against sale total ──
    const subtotalItems = items.reduce((sum: number, item: any) => {
      const unitConDto = item.PRECIO_UNITARIO_DTO != null
        ? Number(item.PRECIO_UNITARIO_DTO)
        : (item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO);
      return sum + (unitConDto * item.CANTIDAD);
    }, 0);
    const factorNormalizacion = subtotalItems > 0
      ? (Number(venta.TOTAL) / subtotalItems)
      : 1;

    // ── 10. Calculate IVA breakdown for ARCA ──
    // WSFEv1 requires IVA grouped by alicuota, not per item
    const ivaMap = new Map<number, { baseImp: number; importe: number }>();
    let totalNeto = 0;
    let totalIVA = 0;
    let totalExentos = 0;
    let totalNoGravado = 0;

    for (const item of items) {
      const productoId = item.PRODUCTO_ID;

      // Get IVA alícuota for this item
      let alicuotaDecimal = 0;
      let esExento = false;
      if (item.IVA_ALICUOTA != null && item.IVA_ALICUOTA > 0) {
        alicuotaDecimal = item.IVA_ALICUOTA;
      } else {
        const alicuotaInfo = await this.getAlicuotaProducto(productoId);
        alicuotaDecimal = alicuotaInfo.porcentaje;
        esExento = alicuotaInfo.esExento;
      }

      // Calculate final unit price (with discount + normalization)
      const precioUnitarioConDtoItem = item.PRECIO_UNITARIO_DTO != null
        ? Number(item.PRECIO_UNITARIO_DTO)
        : (item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO);
      const precioUnitarioFinal = precioUnitarioConDtoItem * factorNormalizacion;
      const lineTotal = precioUnitarioFinal * item.CANTIDAD;

      if (esExento) {
        totalExentos += lineTotal;
      } else if (esFacturaConIVA && alicuotaDecimal > 0) {
        // Discriminate IVA: calculate neto and IVA from final price (which includes IVA)
        const { neto, iva } = calcularNetoEIva(lineTotal, alicuotaDecimal);
        totalNeto += neto;
        totalIVA += iva;

        // Group by alicuota percentage (as integer: 21, 10.5, etc.)
        const alicPct = Math.round(alicuotaDecimal * 10000) / 100; // 0.21 → 21
        const existing = ivaMap.get(alicPct) || { baseImp: 0, importe: 0 };
        existing.baseImp += neto;
        existing.importe += iva;
        ivaMap.set(alicPct, existing);
      } else {
        // Factura C or 0% IVA — everything is neto
        totalNeto += lineTotal;
      }
    }

    // Build IVA array for ARCA
    const ivaArray: FEAlicuotaIva[] = [];
    for (const [alicPct, values] of ivaMap) {
      const ivaId = IVA_IDS[alicPct];
      if (!ivaId) {
        throw Object.assign(
          new Error(`Alícuota de IVA ${alicPct}% no reconocida por ARCA. Alícuotas válidas: 0, 2.5, 5, 10.5, 21, 27`),
          { name: 'ValidationError' }
        );
      }
      ivaArray.push({
        Id: ivaId,
        BaseImp: Math.round(values.baseImp * 100) / 100,
        Importe: Math.round(values.importe * 100) / 100,
      });
    }

    // Round totals
    totalNeto = Math.round(totalNeto * 100) / 100;
    totalIVA = Math.round(totalIVA * 100) / 100;
    totalExentos = Math.round(totalExentos * 100) / 100;
    const impTotal = Number(venta.TOTAL);

    // ── 11. Build ARCA comprobante ──
    const comprobante: FEComprobante = {
      CbteTipo: cbteTipo,
      Concepto: CONCEPTO.PRODUCTOS,
      DocTipo: cliente.docTipo,
      DocNro: cliente.docNro,
      CbteDesde: cbteNro,
      CbteHasta: cbteNro,
      CbteFch: fecha,
      ImpTotal: impTotal,
      ImpTotConc: totalNoGravado,
      ImpNeto: esFacturaConIVA ? totalNeto : impTotal - totalExentos,
      ImpOpEx: totalExentos,
      ImpIVA: totalIVA,
      ImpTrib: 0,
      MonId: 'PES',
      MonCotiz: 1,
      Iva: ivaArray.length > 0 ? ivaArray : undefined,
    };

    // ── 12. Call ARCA WSFEv1 ──
    let respuesta: FECAEResponse;
    try {
      respuesta = await feCAESolicitar(auth, puntoVenta, comprobante, config.arca.environment);
    } catch (err: any) {
      await this.guardarErrorFE(ventaId, 'S', err.message);
      throw Object.assign(
        new Error(`Error al conectar con ARCA: ${err.message}`),
        { name: 'FEError' }
      );
    }

    // ── 13. Handle response ──
    const detResp = respuesta.FeDetResp?.[0];
    const resultado = detResp?.Resultado || respuesta.FeCabResp?.Resultado || 'R';

    if (resultado === 'A') {
      // Success — Aprobado
      const cae = detResp?.CAE || '';
      const caeVto = detResp?.CAEFchVto || '';
      const numeroFiscal = String(cbteNro).padStart(8, '0');
      const tipoInterno = mapTipoComprobanteFromARCA(cbteTipo);
      const ptoVtaStr = String(puntoVenta).padStart(5, '0');

      // Save to VENTAS table
      await this.guardarDatosFactura(ventaId, numeroFiscal, cae, tipoInterno, ptoVtaStr);

      // Save full response
      await this.guardarRespuestaFE(ventaId, {
        error: 'N',
        errores: [],
        rta: 'A',
        cae,
        vencimiento_cae: caeVto,
        comprobante_nro: numeroFiscal,
        comprobante_tipo: tipoInterno,
      });

      // Clear error flags
      await this.guardarErrorFE(ventaId, 'N', '');

      // Update cta corriente concept if applicable
      if (venta.ES_CTA_CORRIENTE) {
        await this.actualizarConceptoCtaCorriente(ventaId, numeroFiscal, tipoInterno);
      }

      return {
        success: true,
        comprobante_nro: `${ptoVtaStr}-${numeroFiscal}`,
        cae,
        cae_vto: caeVto,
        tipo_comprobante: tipoInterno,
      };
    } else {
      // Error — Rechazado
      const errores: string[] = [];
      if (respuesta.Errors) {
        errores.push(...respuesta.Errors.map(e => `[${e.Code}] ${e.Msg}`));
      }
      if (detResp?.Observaciones) {
        errores.push(...detResp.Observaciones.map(o => `[${o.Code}] ${o.Msg}`));
      }

      await this.guardarErrorFE(ventaId, 'S', errores.join(', '));

      return {
        success: false,
        comprobante_nro: '',
        cae: '',
        cae_vto: '',
        tipo_comprobante: '',
        errores,
      };
    }
  },

  // ── DB persistence helpers ─────────────────────

  /**
   * Save fiscal data to VENTAS table.
   */
  async guardarDatosFactura(
    ventaId: number, numeroFiscal: string, cae: string,
    tipoComprobante: string, puntoVenta: string
  ) {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, ventaId)
      .input('nf', sql.NVarChar, numeroFiscal)
      .input('cae', sql.NVarChar, cae)
      .input('pv', sql.NVarChar, puntoVenta)
      .input('tc', sql.NVarChar, tipoComprobante)
      .query(`
        UPDATE VENTAS
        SET NUMERO_FISCAL = @nf, CAE = @cae,
            PUNTO_VENTA = @pv, TIPO_COMPROBANTE = @tc
        WHERE VENTA_ID = @id
      `);
  },

  /**
   * Save full FE response to RESPUESTA_FE table.
   */
  async guardarRespuestaFE(ventaId: number, resp: FERespuesta) {
    const pool = await getPool();

    // Parse YYYYMMDD date strings from ARCA
    const parseDate = (s: string): Date | null => {
      if (!s || !s.trim()) return null;
      const str = s.trim();
      if (str.length === 8) {
        // YYYYMMDD format
        const yyyy = parseInt(str.substring(0, 4));
        const mm = parseInt(str.substring(4, 6)) - 1;
        const dd = parseInt(str.substring(6, 8));
        const d = new Date(yyyy, mm, dd);
        if (!isNaN(d.getTime())) return d;
      }
      // Try DD/MM/YYYY fallback
      const parts = str.split('/');
      if (parts.length === 3) {
        const [dd, mm, yyyy] = parts;
        const d = new Date(parseInt(yyyy!), parseInt(mm!) - 1, parseInt(dd!));
        if (!isNaN(d.getTime())) return d;
      }
      return null;
    };

    try {
      await pool.request()
        .input('compId', sql.Int, ventaId)
        .input('error', sql.VarChar(1), (resp.error || '').trim().substring(0, 1))
        .input('errores', sql.Text, (resp.errores || []).join(', '))
        .input('rta', sql.VarChar(255), (resp.rta || '').trim())
        .input('cae', sql.VarChar(14), (resp.cae || '').trim())
        .input('vencCae', sql.Date, parseDate(resp.vencimiento_cae || ''))
        .input('compNro', sql.VarChar(20), (resp.comprobante_nro || '').trim())
        .input('compTipo', sql.VarChar(50), (resp.comprobante_tipo || '').trim())
        .query(`
          INSERT INTO RESPUESTA_FE (
            COMPROBANTE_ID, ERROR, ERRORES, RTA, CAE,
            VENCIMIENTO_CAE, COMPROBANTE_NRO, COMPROBANTE_TIPO
          ) VALUES (
            @compId, @error, @errores, @rta, @cae,
            @vencCae, @compNro, @compTipo
          )
        `);
    } catch (err: any) {
      console.warn('[FE] Warning: Could not save to RESPUESTA_FE:', err.message);
    }
  },

  /**
   * Save error flags to VENTAS table.
   */
  async guardarErrorFE(ventaId: number, error: string, errores: string) {
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, ventaId)
      .input('error', sql.NVarChar, error)
      .input('errores', sql.NVarChar, errores || null)
      .query(`
        UPDATE VENTAS
        SET ERROR_FE = @error, ERRORES = @errores
        WHERE VENTA_ID = @id
      `);
  },

  /**
   * Update cta corriente concept with fiscal number.
   */
  async actualizarConceptoCtaCorriente(ventaId: number, numeroFiscal: string, tipoComprobante: string) {
    const pool = await getPool();
    try {
      await pool.request()
        .input('id', sql.Int, ventaId)
        .input('concepto', sql.NVarChar, `${tipoComprobante} ${numeroFiscal}`)
        .query(`
          UPDATE CTA_CORRIENTE_MOVIMIENTOS
          SET CONCEPTO = @concepto
          WHERE ORIGEN_ID = @id AND ORIGEN_TIPO = 'VENTA'
        `);
    } catch { /* table might not exist */ }
  },

  /**
   * Get FE response data for a sale.
   */
  async getRespuestaFE(ventaId: number) {
    const pool = await getPool();
    try {
      const result = await pool.request()
        .input('id', sql.Int, ventaId)
        .query(`
          SELECT * FROM RESPUESTA_FE WHERE COMPROBANTE_ID = @id
        `);
      return result.recordset[0] || null;
    } catch {
      return null;
    }
  },

  /**
   * Consult an already-issued comprobante in ARCA.
   */
  async consultarComprobante(cbteTipo: number, ptoVta: number, cbteNro: number) {
    const auth = await getAuth();
    return await feCompConsultar(auth, cbteTipo, ptoVta, cbteNro, config.arca.environment);
  },

  /**
   * Get registered puntos de venta from ARCA.
   */
  async getPuntosVentaARCA() {
    const auth = await getAuth();
    return await feParamGetPtosVenta(auth, config.arca.environment);
  },
};
