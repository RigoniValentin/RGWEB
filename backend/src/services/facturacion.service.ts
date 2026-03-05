import { getPool, sql } from '../database/connection.js';
import { config } from '../config/index.js';

// ═══════════════════════════════════════════════════
//  Facturación Electrónica Service
//  Integración con TusFacturasAPP API v2
//  Endpoint: POST https://www.tusfacturas.app/app/api/v2/facturacion/nuevo
// ═══════════════════════════════════════════════════

const TUSFACTURAS_URL = 'https://www.tusfacturas.app/app/api/v2/facturacion/nuevo';

// ── Interfaces ───────────────────────────────────

export interface FECliente {
  razon_social: string;
  documento_tipo: string;
  documento_nro: string;
  email: string;
  domicilio: string;
  provincia: string;
  envia_por_mail: string;
  condicion_iva: string;
  condicion_pago: string;
  reclama_deuda: string;
}

export interface FEProducto {
  descripcion: string;
  codigo: string;
  unidad_bulto: string;
  precio_unitario_sin_iva: string;
  unidad_medida: string;
  lista_precios: string;
  alicuota: string;
  rg5329: string;
  impuestos_internos_alicuota: number;
}

export interface FEDetalle {
  cantidad: string;
  bonificacion_porcentaje: string;
  producto: FEProducto;
  leyenda: string;
}

export interface FEComprobante {
  tipo: string;
  punto_venta: string;
  moneda: string;
  fecha: string;
  periodo_facturado_desde: string;
  periodo_facturado_hasta: string;
  vencimiento: string;
  operacion: string;
  idioma: string;
  cotizacion: number;
  detalle: FEDetalle[];
  total: string;
  bonificacion: string;
  impuestos_internos: string;
  impuestos_internos_base: string;
  impuestos_internos_alicuota: string;
}

export interface FEFactura {
  usertoken: string;
  apikey: string;
  apitoken: string;
  cliente: FECliente;
  comprobante: FEComprobante;
}

export interface FERespuesta {
  error: string;
  errores: string[];
  rta: string;
  cae: string;
  requiere_fec: string;
  vencimiento_cae: string;
  vencimiento_pago: string;
  comprobante_pdf_url: string;
  comprobante_ticket_url: string;
  afip_qr: string;
  afip_codigo_barras: string;
  envio_x_mail: string;
  external_reference: string;
  comprobante_nro: string;
  comprobante_tipo: string;
  envio_x_mail_direcciones: string;
}

// ── Helpers ──────────────────────────────────────

/**
 * Formats a date as DD/MM/YYYY for TusFacturas API.
 */
function formatFecha(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
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
 * Maps internal unit IDs to AFIP unit codes.
 * 1 (Unidad) → 7
 * 2 (Kilo) → 1
 * 3 (Litro) → 5
 */
function mapUnidadAFIP(unidadId: number): string {
  switch (unidadId) {
    case 2: return '1';  // Kilo
    case 3: return '5';  // Litro
    default: return '7'; // Unidad
  }
}

/**
 * Maps internal CONDICION_IVA to TusFacturas API code.
 */
function mapCondicionIvaCliente(condicionIva: string): string {
  const c = (condicionIva || '').toUpperCase().trim();
  switch (c) {
    case 'CONSUMIDOR FINAL': return 'CF';
    case 'RESPONSABLE INSCRIPTO': return 'RI';
    case 'MONOTRIBUTO': return 'M';
    case 'EXENTO': return 'E';
    default: return 'CF';
  }
}

/**
 * Maps internal comprobante codes to AFIP tipo names.
 * Fa.A → FACTURA A, Fa.B → FACTURA B, Fa.C → FACTURA C
 */
function mapTipoComprobanteToAFIP(tipo: string): string {
  switch (tipo) {
    case 'Fa.A': return 'FACTURA A';
    case 'Fa.B': return 'FACTURA B';
    case 'Fa.C': return 'FACTURA C';
    default: return 'FACTURA B';
  }
}

/**
 * Maps AFIP comprobante_tipo from response back to internal code.
 */
function mapTipoComprobanteFromAFIP(tipo: string): string {
  switch (tipo.trim()) {
    case 'FACTURA A': return 'Fa.A';
    case 'FACTURA B': return 'Fa.B';
    case 'FACTURA C': return 'Fa.C';
    default: return tipo;
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

export const facturacionService = {
  /**
   * Check if FE is enabled for this installation.
   */
  isEnabled(): boolean {
    return config.app.utilizaFE === true;
  },

  /**
   * Get FE configuration status (for frontend).
   */
  getConfig() {
    return {
      utilizaFE: config.app.utilizaFE === true,
      // Don't expose tokens to frontend
    };
  },

  /**
   * Fetch client data formatted for TusFacturas API.
   */
  async getClienteFE(clienteId: number): Promise<FECliente> {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, clienteId)
      .query(`
        SELECT TIPO_DOCUMENTO, NUMERO_DOC, NOMBRE, EMAIL,
               DOMICILIO, PROVINCIA, CONDICION_IVA
        FROM CLIENTES WHERE CLIENTE_ID = @id
      `);

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Cliente no encontrado'), { name: 'ValidationError' });
    }

    const c = result.recordset[0];
    const condicionIva = (c.CONDICION_IVA || '').toUpperCase().trim();
    const esRI = condicionIva === 'RESPONSABLE INSCRIPTO';
    const esMonotributo = condicionIva === 'MONOTRIBUTO';

    // For RI and Monotributo clients, the document type MUST be CUIT
    // (TusFacturas / AFIP requires CUIT for Factura A and Monotributo)
    let documentoTipo = c.TIPO_DOCUMENTO || 'DNI';
    let documentoNro = c.NUMERO_DOC || '0';

    if (esRI || esMonotributo) {
      documentoTipo = 'CUIT';
      // If the stored document number looks invalid for CUIT, throw a clear error
      if (!documentoNro || documentoNro === '0' || documentoNro.replace(/\D/g, '').length < 11) {
        throw Object.assign(
          new Error(`El cliente "${c.NOMBRE}" es ${condicionIva} y requiere un CUIT válido (11 dígitos). Actualice los datos del cliente antes de facturar.`),
          { name: 'ValidationError' }
        );
      }
      // Ensure only digits are sent (strip dashes/dots)
      documentoNro = documentoNro.replace(/\D/g, '');
    }

    return {
      razon_social: c.NOMBRE || 'Consumidor Final',
      documento_tipo: documentoTipo,
      documento_nro: documentoNro,
      email: c.EMAIL || '',
      domicilio: c.DOMICILIO || '',
      provincia: mapProvinciaAFIP(c.PROVINCIA || ''),
      envia_por_mail: 'S',
      condicion_iva: mapCondicionIvaCliente(c.CONDICION_IVA || ''),
      condicion_pago: '201', // Will be overridden if cta corriente
      reclama_deuda: 'N',
    };
  },

  /**
   * Get the IVA alícuota (as decimal, e.g. 0.21) for a product.
   * Returns 0 for Monotributo companies (they don't discriminate IVA).
   */
  async getAlicuotaProducto(productoId: number): Promise<number> {
    const empresaIva = (await this.getEmpresaCondicionIVA()).toUpperCase();

    // Monotributo never discriminates IVA
    if (empresaIva === 'MONOTRIBUTO') return 0;
    // Only RI discriminates
    if (empresaIva !== 'RESPONSABLE INSCRIPTO') return 0;

    const pool = await getPool();
    const result = await pool.request()
      .input('pid', sql.Int, productoId)
      .query(`
        SELECT t.PORCENTAJE
        FROM PRODUCTOS p
        LEFT JOIN TASAS_IMPUESTOS t ON p.TASA_IVA_ID = t.TASA_ID AND t.ACTIVA = 1
        WHERE p.PRODUCTO_ID = @pid
      `);

    if (result.recordset.length === 0 || result.recordset[0].PORCENTAJE == null) return 0;
    return result.recordset[0].PORCENTAJE / 100; // e.g. 21 → 0.21
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
   * Build and emit a factura electrónica for a given sale.
   * This is the main method that replicates CrearFacturaElectronica + EmitirFactura from C#.
   */
  async emitirFactura(ventaId: number): Promise<{
    success: boolean;
    comprobante_nro: string;
    cae: string;
    tipo_comprobante: string;
    pdf_url: string;
    ticket_url: string;
    errores?: string[];
  }> {
    // Validate FE is enabled
    if (!this.isEnabled()) {
      throw Object.assign(new Error('La facturación electrónica no está habilitada'), { name: 'ValidationError' });
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
    const cliente = await this.getClienteFE(venta.CLIENTE_ID);

    // Set condicion_pago based on cta corriente
    cliente.condicion_pago = venta.ES_CTA_CORRIENTE ? '205' : '201';

    // ── 4. Determine comprobante type ──
    const tipoComprobante = venta.TIPO_COMPROBANTE || 'Fa.B';
    const tipoComprobanteAFIP = mapTipoComprobanteToAFIP(tipoComprobante);
    const esFacturaConIVA = tipoComprobante === 'Fa.A' || tipoComprobante === 'Fa.B';

    // ── 5. Format date ──
    const fecha = formatFecha(new Date());

    // ── 6. Get fiscal punto de venta ──
    const puntoVenta = await this.getPuntoVentaFiscal();

    // ── 7. Calculate bonificacion (dto general as money amount) ──
    const dtoGral = venta.DTO_GRAL || 0;
    const subtotal = items.reduce((sum: number, item: any) => {
      const precioConDto = item.DESCUENTO > 0
        ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
        : item.PRECIO_UNITARIO;
      return sum + precioConDto * item.CANTIDAD;
    }, 0);
    const bonificacionMonto = dtoGral > 0 ? (subtotal * dtoGral / 100) : 0;

    // ── 8. Build detalle ──
    const detalle: FEDetalle[] = [];

    for (const item of items) {
      const productoId = item.PRODUCTO_ID;
      const unidadId = item.UNIDAD_ID || 1;
      const unidadMedidaAFIP = mapUnidadAFIP(unidadId);

      // Get IVA alícuota for this item
      let alicuotaDecimal = 0;
      if (item.IVA_ALICUOTA != null && item.IVA_ALICUOTA > 0) {
        alicuotaDecimal = item.IVA_ALICUOTA;
      } else {
        alicuotaDecimal = await this.getAlicuotaProducto(productoId);
      }

      // AFIP expects alicuota in percentage (e.g. "21", "10.5", "0")
      const alicuotaPorcentaje = (alicuotaDecimal * 100).toFixed(2).replace(/\.?0+$/, '');

      // Calculate price to send to AFIP
      let precioUnitarioAFIP: string;
      if (esFacturaConIVA && alicuotaDecimal > 0) {
        // For A/B invoices: prices in the system include IVA, send neto
        const { neto } = calcularNetoEIva(item.PRECIO_UNITARIO, alicuotaDecimal);
        precioUnitarioAFIP = fmtNum(neto);
      } else {
        // For C invoices or items with 0% IVA: send the full price
        precioUnitarioAFIP = fmtNum(item.PRECIO_UNITARIO);
      }

      const descuento = (item.DESCUENTO || 0).toString();

      const producto: FEProducto = {
        descripcion: item.PRODUCTO_NOMBRE || '',
        codigo: item.PRODUCTO_CODIGO || '',
        unidad_bulto: '1',
        precio_unitario_sin_iva: precioUnitarioAFIP,
        unidad_medida: unidadMedidaAFIP,
        lista_precios: 'Lista 1',
        alicuota: alicuotaPorcentaje,
        rg5329: 'N',
        impuestos_internos_alicuota: 0,
      };

      detalle.push({
        cantidad: item.CANTIDAD.toString(),
        bonificacion_porcentaje: descuento,
        producto,
        leyenda: '',
      });
    }

    // ── 9. Build the full factura object ──
    const factura: FEFactura = {
      usertoken: config.integrations.userToken,
      apikey: config.integrations.apiKey,
      apitoken: config.integrations.apiToken,
      cliente,
      comprobante: {
        tipo: tipoComprobanteAFIP,
        punto_venta: puntoVenta,
        moneda: 'PES',
        fecha,
        periodo_facturado_desde: fecha,
        periodo_facturado_hasta: fecha,
        vencimiento: fecha,
        operacion: 'V',
        idioma: '1',
        cotizacion: 1,
        detalle,
        total: fmtNum(venta.TOTAL),
        bonificacion: fmtNum(bonificacionMonto),
        impuestos_internos: '0',
        impuestos_internos_base: '0',
        impuestos_internos_alicuota: '0',
      },
    };

    // ── 10. Call TusFacturas API ──
    let respuesta: FERespuesta;
    try {
      const response = await fetch(TUSFACTURAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(factura),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      respuesta = await response.json() as FERespuesta;
    } catch (err: any) {
      // Save error to DB
      await this.guardarErrorFE(ventaId, 'S', err.message);
      throw Object.assign(
        new Error(`Error al conectar con TusFacturas: ${err.message}`),
        { name: 'FEError' }
      );
    }

    // ── 11. Handle response ──
    if (respuesta.error === 'N') {
      // Success
      const numeroFiscal = (respuesta.comprobante_nro || '').trim();
      const cae = (respuesta.cae || '').trim();
      let tipoFromAPI = (respuesta.comprobante_tipo || '').trim();
      const tipoInterno = mapTipoComprobanteFromAFIP(tipoFromAPI);

      // Save to VENTAS table
      await this.guardarDatosFactura(ventaId, numeroFiscal, cae, tipoInterno, puntoVenta);

      // Save full response to RESPUESTA_FE table
      await this.guardarRespuestaFE(ventaId, respuesta);

      // Clear error flags
      await this.guardarErrorFE(ventaId, 'N', '');

      // Update cta corriente concept if applicable
      if (venta.ES_CTA_CORRIENTE) {
        await this.actualizarConceptoCtaCorriente(ventaId, numeroFiscal, tipoInterno);
      }

      return {
        success: true,
        comprobante_nro: numeroFiscal,
        cae,
        tipo_comprobante: tipoInterno,
        pdf_url: (respuesta.comprobante_pdf_url || '').trim(),
        ticket_url: (respuesta.comprobante_ticket_url || '').trim(),
      };
    } else {
      // Error from AFIP/TusFacturas
      const errores = respuesta.errores || [];
      await this.guardarErrorFE(ventaId, 'S', errores.join(', '));

      return {
        success: false,
        comprobante_nro: '',
        cae: '',
        tipo_comprobante: '',
        pdf_url: '',
        ticket_url: '',
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

    // Parse DD/MM/YYYY date strings from TusFacturas API into JS Date objects
    const parseDate = (s: string): Date | null => {
      if (!s || !s.trim()) return null;
      const parts = s.trim().split('/');
      if (parts.length === 3) {
        const [dd, mm, yyyy] = parts;
        const d = new Date(parseInt(yyyy!), parseInt(mm!) - 1, parseInt(dd!));
        if (!isNaN(d.getTime())) return d;
      }
      return null;
    };

    // Check if the table exists and handle gracefully
    try {
      await pool.request()
        .input('compId', sql.Int, ventaId)
        .input('error', sql.VarChar(1), (resp.error || '').trim().substring(0, 1))
        .input('errores', sql.Text, (resp.errores || []).join(', '))
        .input('rta', sql.VarChar(255), (resp.rta || '').trim())
        .input('cae', sql.VarChar(14), (resp.cae || '').trim())
        .input('requiereFec', sql.VarChar(2), (resp.requiere_fec || '').trim())
        .input('vencCae', sql.Date, parseDate(resp.vencimiento_cae || ''))
        .input('vencPago', sql.Date, parseDate(resp.vencimiento_pago || ''))
        .input('pdfUrl', sql.VarChar(255), (resp.comprobante_pdf_url || '').trim())
        .input('ticketUrl', sql.VarChar(255), (resp.comprobante_ticket_url || '').trim())
        .input('afipQr', sql.VarChar(sql.MAX), (resp.afip_qr || '').trim())
        .input('afipBarras', sql.VarChar(255), (resp.afip_codigo_barras || '').trim())
        .input('envioMail', sql.VarChar(1), (resp.envio_x_mail || '').trim().substring(0, 1))
        .input('extRef', sql.VarChar(50), (resp.external_reference || '').trim())
        .input('compNro', sql.VarChar(20), (resp.comprobante_nro || '').trim())
        .input('compTipo', sql.VarChar(50), (resp.comprobante_tipo || '').trim())
        .input('envioMailDir', sql.Text, (resp.envio_x_mail_direcciones || '').trim())
        .query(`
          INSERT INTO RESPUESTA_FE (
            COMPROBANTE_ID, ERROR, ERRORES, RTA, CAE, REQUIERE_FEC,
            VENCIMIENTO_CAE, VENCIMIENTO_PAGO, COMPROBANTE_PDF_URL, COMPROBANTE_TICKET_URL,
            AFIP_QR, AFIP_CODIGO_BARRAS, ENVIO_X_MAIL, EXTERNAL_REFERENCE,
            COMPROBANTE_NRO, COMPROBANTE_TIPO, ENVIO_X_MAIL_DIRECCIONES
          ) VALUES (
            @compId, @error, @errores, @rta, @cae, @requiereFec,
            @vencCae, @vencPago, @pdfUrl, @ticketUrl,
            @afipQr, @afipBarras, @envioMail, @extRef,
            @compNro, @compTipo, @envioMailDir
          )
        `);
    } catch (err: any) {
      // RESPUESTA_FE table might not exist yet — log but don't fail
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
   * Get FE response data for a sale (for showing PDF URL, etc.).
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
};
