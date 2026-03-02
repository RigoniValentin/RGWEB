import { getPool, sql } from '../database/connection.js';
import type { Compra, CompraItem, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Purchases Service — Full CRUD + Stock/Cost Update
// ═══════════════════════════════════════════════════

export interface CompraFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  proveedorId?: number;
  cobrada?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface CompraItemInput {
  PRODUCTO_ID: number;
  PRECIO_COMPRA: number;
  CANTIDAD: number;
  DEPOSITO_ID?: number;
  BONIFICACION: number;       // percentage 0-100
  IMP_INTERNOS: number;       // internal tax amount per unit
  IVA_ALICUOTA?: number;      // IVA rate fraction (e.g. 0.21)
  TASA_IVA_ID?: number | null;
}

export interface CompraInput {
  PROVEEDOR_ID: number;
  FECHA_COMPRA?: string;
  TIPO_COMPROBANTE?: string;
  PTO_VTA?: string;
  NRO_COMPROBANTE?: string;
  ES_CTA_CORRIENTE?: boolean;
  MONTO_EFECTIVO?: number;
  MONTO_DIGITAL?: number;
  VUELTO?: number;
  COBRADA?: boolean;
  PRECIOS_SIN_IVA?: boolean;
  IMP_INT_GRAVA_IVA?: boolean;
  PERCEPCION_IVA?: number;
  PERCEPCION_IIBB?: number;
  IVA_TOTAL?: number;
  ACTUALIZAR_COSTOS?: boolean;
  ACTUALIZAR_PRECIOS?: boolean;
  items: CompraItemInput[];
}

// ── Round helper ─────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Stock helpers ────────────────────────────────

async function incrementarStock(
  tx: any,
  productoId: number,
  cantidad: number,
  depositoId: number | null
) {
  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query(`SELECT ES_CONJUNTO, DESCUENTA_STOCK FROM PRODUCTOS WHERE PRODUCTO_ID = @pid`);
  if (prod.recordset.length === 0) return;

  const esConjunto = prod.recordset[0].ES_CONJUNTO;
  const descuentaStock = prod.recordset[0].DESCUENTA_STOCK;

  if (esConjunto) {
    const children = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT PRODUCTO_ID_HIJO, DEPOSITO_ID, CANTIDAD
              FROM PRODUCTO_CONJUNTO_DEPOSITO WHERE PRODUCTO_ID = @pid`);

    for (const child of children.recordset) {
      const childQty = cantidad * child.CANTIDAD;
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('depId', sql.Int, child.DEPOSITO_ID)
        .input('cant', sql.Decimal(18, 4), childQty)
        .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant
                WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('cant', sql.Decimal(18, 4), childQty)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
    }

    if (descuentaStock) {
      if (depositoId) {
        await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 4), cantidad)
          .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant
                  WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      }
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
    }
  } else if (descuentaStock) {
    if (depositoId) {
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('depId', sql.Int, depositoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant
                WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
    }
    await tx.request()
      .input('prodId', sql.Int, productoId)
      .input('cant', sql.Decimal(18, 4), cantidad)
      .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
  }
}

async function decrementarStock(
  tx: any,
  productoId: number,
  cantidad: number,
  depositoId: number | null
) {
  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query(`SELECT ES_CONJUNTO, DESCUENTA_STOCK FROM PRODUCTOS WHERE PRODUCTO_ID = @pid`);
  if (prod.recordset.length === 0) return;

  const esConjunto = prod.recordset[0].ES_CONJUNTO;
  const descuentaStock = prod.recordset[0].DESCUENTA_STOCK;

  if (esConjunto) {
    const children = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT PRODUCTO_ID_HIJO, DEPOSITO_ID, CANTIDAD
              FROM PRODUCTO_CONJUNTO_DEPOSITO WHERE PRODUCTO_ID = @pid`);

    for (const child of children.recordset) {
      const childQty = cantidad * child.CANTIDAD;
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('depId', sql.Int, child.DEPOSITO_ID)
        .input('cant', sql.Decimal(18, 4), childQty)
        .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant
                WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('cant', sql.Decimal(18, 4), childQty)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
    }

    if (descuentaStock) {
      if (depositoId) {
        await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 4), cantidad)
          .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant
                  WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      }
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
    }
  } else if (descuentaStock) {
    if (depositoId) {
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('depId', sql.Int, depositoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant
                WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
    }
    await tx.request()
      .input('prodId', sql.Int, productoId)
      .input('cant', sql.Decimal(18, 4), cantidad)
      .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
  }
}

// ── Audit helper ─────────────────────────────────

async function registrarAuditoria(
  tx: any,
  entidadId: number,
  tipoMovimiento: string,
  usuarioId: number,
  monto: number,
  descripcion: string
) {
  try {
    await tx.request()
      .input('TipoEntidad', sql.NVarChar(50), 'COMPRA')
      .input('EntidadId', sql.Int, entidadId)
      .input('TipoMovimiento', sql.NVarChar(50), tipoMovimiento)
      .input('UsuarioId', sql.Int, usuarioId)
      .input('PuntoVentaId', sql.Int, null)
      .input('CajaId', sql.Int, null)
      .input('Descripcion', sql.NVarChar(500), descripcion)
      .input('Monto', sql.Decimal(18, 2), monto)
      .output('AuditoriaId', sql.BigInt)
      .execute('SP_REGISTRAR_AUDITORIA');
  } catch {
    console.warn(`Audit registration failed for COMPRA ${entidadId} (${tipoMovimiento})`);
  }
}

// ── CTA Corriente Proveedor helper ───────────────

async function ensureCtaCorrienteP(tx: any, proveedorId: number): Promise<number> {
  const existing = await tx.request()
    .input('pid', sql.Int, proveedorId)
    .query(`SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_P WHERE PROVEEDOR_ID = @pid`);

  if (existing.recordset.length > 0) {
    return existing.recordset[0].CTA_CORRIENTE_ID;
  }

  const result = await tx.request()
    .input('pid', sql.Int, proveedorId)
    .query(`
      INSERT INTO CTA_CORRIENTE_P (PROVEEDOR_ID, FECHA) VALUES (@pid, GETDATE());
      SELECT SCOPE_IDENTITY() AS CTA_CORRIENTE_ID;
    `);
  return result.recordset[0].CTA_CORRIENTE_ID;
}

// ── Cost / Price update helpers ──────────────────

async function actualizarPrecioCompra(
  tx: any,
  productoId: number,
  precioNetoUnitario: number
) {
  await tx.request()
    .input('prodId', sql.Int, productoId)
    .input('precio', sql.Decimal(18, 4), precioNetoUnitario)
    .query(`UPDATE PRODUCTOS SET PRECIO_COMPRA_BASE = @precio WHERE PRODUCTO_ID = @prodId`);
}

async function actualizarPreciosVenta(
  tx: any,
  productoId: number,
  costoBase: number
) {
  // Get product margins from LISTA_PRECIOS
  const listasResult = await tx.request()
    .query(`SELECT LISTA_ID, MARGEN FROM LISTA_PRECIOS WHERE ACTIVA = 1 ORDER BY LISTA_ID`);

  // Check if product has individual margins
  const prodInfo = await tx.request()
    .input('pid', sql.Int, productoId)
    .query(`SELECT MARGEN_INDIVIDUAL, IMP_INT FROM PRODUCTOS WHERE PRODUCTO_ID = @pid`);

  const margenIndividual = prodInfo.recordset[0]?.MARGEN_INDIVIDUAL;
  const impInt = prodInfo.recordset[0]?.IMP_INT || 0;

  if (margenIndividual) {
    // Use individual margins from PRODUCTO_MARGENES table (single row, columns per list)
    const margenes = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT MARGEN_LISTA_1, MARGEN_LISTA_2, MARGEN_LISTA_3, MARGEN_LISTA_4, MARGEN_LISTA_5
              FROM PRODUCTO_MARGENES WHERE PRODUCTO_ID = @pid`);

    const row = margenes.recordset[0];
    if (row) {
      for (let i = 1; i <= 5; i++) {
        const margen = row[`MARGEN_LISTA_${i}`] || 0;
        const precio = r2((costoBase + impInt) * (1 + margen / 100));
        await tx.request()
          .input('pid', sql.Int, productoId)
          .input('precio', sql.Decimal(18, 4), precio)
          .query(`UPDATE PRODUCTOS SET LISTA_${i} = @precio WHERE PRODUCTO_ID = @pid`);
      }
    }
  } else {
    // Use global list margins
    for (const lista of listasResult.recordset) {
      const listaId = lista.LISTA_ID;
      if (listaId >= 1 && listaId <= 5) {
        const precio = r2((costoBase + impInt) * (1 + lista.MARGEN / 100));
        await tx.request()
          .input('pid', sql.Int, productoId)
          .input('precio', sql.Decimal(18, 4), precio)
          .query(`UPDATE PRODUCTOS SET LISTA_${listaId} = @precio WHERE PRODUCTO_ID = @pid`);
      }
    }
  }
}

// ═══════════════════════════════════════════════════

export const purchasesService = {

  // ── List with pagination & filters ─────────────
  async getAll(filter: CompraFilter = {}): Promise<PaginatedResult<Compra>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.fechaDesde) {
      where += ' AND CAST(c.FECHA_COMPRA AS DATE) >= @fechaDesde';
      params.push({ name: 'fechaDesde', type: sql.VarChar(10), value: filter.fechaDesde });
    }
    if (filter.fechaHasta) {
      where += ' AND CAST(c.FECHA_COMPRA AS DATE) <= @fechaHasta';
      params.push({ name: 'fechaHasta', type: sql.VarChar(10), value: filter.fechaHasta });
    }
    if (filter.proveedorId) {
      where += ' AND c.PROVEEDOR_ID = @proveedorId';
      params.push({ name: 'proveedorId', type: sql.Int, value: filter.proveedorId });
    }
    if (filter.cobrada !== undefined) {
      where += ' AND c.COBRADA = @cobrada';
      params.push({ name: 'cobrada', type: sql.Bit, value: filter.cobrada ? 1 : 0 });
    }
    if (filter.search) {
      where += ` AND (p.NOMBRE LIKE @search OR p.CODIGOPARTICULAR LIKE @search
                  OR CAST(c.COMPRA_ID AS VARCHAR) LIKE @search
                  OR c.NRO_COMPROBANTE LIKE @search)`;
      params.push({ name: 'search', type: sql.NVarChar, value: `%${filter.search}%` });
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    const countResult = await bind(pool.request()).query(`
      SELECT COUNT(*) as total FROM COMPRAS c
      INNER JOIN PROVEEDORES p ON c.PROVEEDOR_ID = p.PROVEEDOR_ID
      ${where}
    `);
    const total = countResult.recordset[0].total;

    const validCols: Record<string, string> = {
      fecha: 'c.FECHA_COMPRA', total: 'c.TOTAL', proveedor: 'p.NOMBRE',
      id: 'c.COMPRA_ID',
    };
    const orderCol = validCols[(filter.orderBy || 'fecha').toLowerCase()] || 'c.FECHA_COMPRA';
    const orderDir = filter.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const dataReq = bind(pool.request());
    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query(`
      SELECT
        c.COMPRA_ID, c.PROVEEDOR_ID, c.FECHA_COMPRA, c.TOTAL,
        c.ES_CTA_CORRIENTE, c.COBRADA, c.TIPO_COMPROBANTE,
        ISNULL(c.PTO_VTA, '0000') AS PTO_VTA,
        ISNULL(c.NRO_COMPROBANTE, '00000000') AS NRO_COMPROBANTE,
        ISNULL(c.MONTO_EFECTIVO, 0) AS MONTO_EFECTIVO,
        ISNULL(c.MONTO_DIGITAL, 0) AS MONTO_DIGITAL,
        ISNULL(c.VUELTO, 0) AS VUELTO,
        ISNULL(c.MONTO_ANTICIPO, 0) AS MONTO_ANTICIPO,
        ISNULL(c.PRECIOS_SIN_IVA, 0) AS PRECIOS_SIN_IVA,
        ISNULL(c.PERCEPCION_IVA, 0) AS PERCEPCION_IVA,
        ISNULL(c.PERCEPCION_IIBB, 0) AS PERCEPCION_IIBB,
        ISNULL(c.IMPUESTO_INTERNO, 0) AS IMPUESTO_INTERNO,
        ISNULL(c.IVA_TOTAL, 0) AS IVA_TOTAL,
        ISNULL(c.BONIFICACION_TOTAL, 0) AS BONIFICACION_TOTAL,
        ISNULL(c.IMP_INT_GRAVA_IVA, 0) AS IMP_INT_GRAVA_IVA,
        p.NOMBRE AS PROVEEDOR_NOMBRE,
        p.CODIGOPARTICULAR AS PROVEEDOR_CODIGO
      FROM COMPRAS c
      INNER JOIN PROVEEDORES p ON c.PROVEEDOR_ID = p.PROVEEDOR_ID
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  // ── Get by ID (full detail with items) ─────────
  async getById(id: number): Promise<Compra & { items: CompraItem[] }> {
    const pool = await getPool();

    const compraResult = await pool.request()
      .input('id', sql.Int, id)
      .query<Compra>(`
        SELECT
          c.COMPRA_ID, c.PROVEEDOR_ID, c.FECHA_COMPRA, c.TOTAL,
          c.ES_CTA_CORRIENTE, c.COBRADA, c.TIPO_COMPROBANTE,
          ISNULL(c.PTO_VTA, '0000') AS PTO_VTA,
          ISNULL(c.NRO_COMPROBANTE, '00000000') AS NRO_COMPROBANTE,
          ISNULL(c.MONTO_EFECTIVO, 0) AS MONTO_EFECTIVO,
          ISNULL(c.MONTO_DIGITAL, 0) AS MONTO_DIGITAL,
          ISNULL(c.VUELTO, 0) AS VUELTO,
          ISNULL(c.MONTO_ANTICIPO, 0) AS MONTO_ANTICIPO,
          ISNULL(c.PRECIOS_SIN_IVA, 0) AS PRECIOS_SIN_IVA,
          ISNULL(c.PERCEPCION_IVA, 0) AS PERCEPCION_IVA,
          ISNULL(c.PERCEPCION_IIBB, 0) AS PERCEPCION_IIBB,
          ISNULL(c.IMPUESTO_INTERNO, 0) AS IMPUESTO_INTERNO,
          ISNULL(c.IVA_TOTAL, 0) AS IVA_TOTAL,
          ISNULL(c.BONIFICACION_TOTAL, 0) AS BONIFICACION_TOTAL,
          ISNULL(c.IMP_INT_GRAVA_IVA, 0) AS IMP_INT_GRAVA_IVA,
          p.NOMBRE AS PROVEEDOR_NOMBRE,
          p.CODIGOPARTICULAR AS PROVEEDOR_CODIGO
        FROM COMPRAS c
        INNER JOIN PROVEEDORES p ON c.PROVEEDOR_ID = p.PROVEEDOR_ID
        WHERE c.COMPRA_ID = @id
      `);

    if (compraResult.recordset.length === 0) {
      throw Object.assign(new Error('Compra no encontrada'), { name: 'ValidationError' });
    }

    const itemsResult = await pool.request()
      .input('id', sql.Int, id)
      .query<CompraItem>(`
        SELECT ci.COMPRA_ID, ci.PRODUCTO_ID,
               ci.PRECIO_COMPRA, ci.CANTIDAD, ci.TOTAL_PRODUCTO,
               ci.DEPOSITO_ID,
               ISNULL(ci.PORCENTAJE_DESCUENTO, 0) AS PORCENTAJE_DESCUENTO,
               ISNULL(ci.DESCUENTO_IMPORTE, 0) AS DESCUENTO_IMPORTE,
               ci.TASA_IVA_ID,
               ISNULL(ci.IVA_ALICUOTA, 0) AS IVA_ALICUOTA,
               ISNULL(ci.IVA_IMPORTE, 0) AS IVA_IMPORTE,
               ISNULL(ci.IMP_INTERNO_IMPORTE, 0) AS IMP_INTERNO_IMPORTE,
               pr.NOMBRE AS PRODUCTO_NOMBRE,
               pr.CODIGOPARTICULAR AS PRODUCTO_CODIGO,
               ISNULL(um.ABREVIACION, 'u') AS UNIDAD_ABREVIACION
        FROM COMPRAS_ITEMS ci
        JOIN PRODUCTOS pr ON ci.PRODUCTO_ID = pr.PRODUCTO_ID
        LEFT JOIN UNIDADES_MEDIDA um ON pr.UNIDAD_ID = um.UNIDAD_ID
        WHERE ci.COMPRA_ID = @id
        ORDER BY ci.PRODUCTO_ID
      `);

    return {
      ...compraResult.recordset[0],
      items: itemsResult.recordset,
    };
  },

  // ── Create purchase ────────────────────────────
  async create(input: CompraInput, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // ── 1. Calculate totals from items ──
      // Non-FA comprobantes (FB, FC, etc.) don't discriminate IVA
      const discriminaIva = (input.TIPO_COMPROBANTE || 'FB') === 'FA';

      let netoTotal = 0;
      let ivaTotal = 0;
      let impInternoTotal = 0;
      let bonifTotal = 0;

      for (const item of input.items) {
        const bonif = item.BONIFICACION || 0;
        const precioNeto = bonif > 0
          ? item.PRECIO_COMPRA * (1 - bonif / 100)
          : item.PRECIO_COMPRA;
        const lineNeto = precioNeto * item.CANTIDAD;
        netoTotal += lineNeto;

        if (bonif > 0) {
          bonifTotal += (item.PRECIO_COMPRA - precioNeto) * item.CANTIDAD;
        }

        const ivaAli = discriminaIva ? (item.IVA_ALICUOTA || 0) : 0;
        ivaTotal += lineNeto * ivaAli;
        impInternoTotal += (item.IMP_INTERNOS || 0) * item.CANTIDAD;
      }

      const percIVA = input.PERCEPCION_IVA || 0;
      const percIIBB = input.PERCEPCION_IIBB || 0;

      // Use manual IVA total if provided (Factura A)
      if (input.IVA_TOTAL !== undefined && input.IVA_TOTAL !== null) {
        ivaTotal = input.IVA_TOTAL;
      }

      let total = r2(netoTotal + ivaTotal + impInternoTotal + percIVA + percIIBB);

      const cobrada = input.COBRADA !== undefined ? input.COBRADA : !input.ES_CTA_CORRIENTE;
      const montoEfectivo = input.MONTO_EFECTIVO || 0;
      const montoDigital = input.MONTO_DIGITAL || 0;
      const vuelto = input.VUELTO || 0;

      // ── 2. Get next COMPRA_ID (not identity) ──
      const nextIdResult = await tx.request()
        .query(`SELECT ISNULL(MAX(COMPRA_ID), 0) + 1 AS NEXT_ID FROM COMPRAS WITH (UPDLOCK, HOLDLOCK)`);
      const compraId = nextIdResult.recordset[0].NEXT_ID;

      // ── 3. INSERT into COMPRAS ──
      await tx.request()
        .input('compraId', sql.Int, compraId)
        .input('proveedorId', sql.Int, input.PROVEEDOR_ID)
        .input('total', sql.Decimal(18, 2), total)
        .input('esCtaCorriente', sql.Bit, input.ES_CTA_CORRIENTE ? 1 : 0)
        .input('montoEfectivo', sql.Decimal(18, 2), montoEfectivo)
        .input('montoDigital', sql.Decimal(18, 2), montoDigital)
        .input('vuelto', sql.Decimal(18, 2), vuelto)
        .input('tipoComprobante', sql.NVarChar, input.TIPO_COMPROBANTE || 'FB')
        .input('cobrada', sql.Bit, cobrada ? 1 : 0)
        .input('ptoVta', sql.NVarChar, input.PTO_VTA || '0000')
        .input('nroComprobante', sql.NVarChar, input.NRO_COMPROBANTE || '00000000')
        .input('preciosSinIva', sql.Bit, input.PRECIOS_SIN_IVA ? 1 : 0)
        .input('impIntGravaIva', sql.Bit, input.IMP_INT_GRAVA_IVA ? 1 : 0)
        .input('percIVA', sql.Decimal(18, 2), percIVA)
        .input('percIIBB', sql.Decimal(18, 2), percIIBB)
        .input('impInterno', sql.Decimal(18, 2), r2(impInternoTotal))
        .input('ivaTotal', sql.Decimal(18, 2), r2(ivaTotal))
        .input('bonifTotal', sql.Decimal(18, 2), r2(bonifTotal))
        .input('fechaCompra', sql.DateTime, input.FECHA_COMPRA ? new Date(input.FECHA_COMPRA) : new Date())
        .input('montoAnticipo', sql.Decimal(18, 2), 0)
        .query(`
          INSERT INTO COMPRAS (
            COMPRA_ID, PROVEEDOR_ID, FECHA_COMPRA, TOTAL, ES_CTA_CORRIENTE,
            MONTO_EFECTIVO, MONTO_DIGITAL, VUELTO, TIPO_COMPROBANTE,
            COBRADA, PTO_VTA, NRO_COMPROBANTE, PRECIOS_SIN_IVA,
            IMP_INT_GRAVA_IVA, PERCEPCION_IVA, PERCEPCION_IIBB,
            IMPUESTO_INTERNO, IVA_TOTAL, BONIFICACION_TOTAL, MONTO_ANTICIPO
          ) VALUES (
            @compraId, @proveedorId, @fechaCompra, @total, @esCtaCorriente,
            @montoEfectivo, @montoDigital, @vuelto, @tipoComprobante,
            @cobrada, @ptoVta, @nroComprobante, @preciosSinIva,
            @impIntGravaIva, @percIVA, @percIIBB,
            @impInterno, @ivaTotal, @bonifTotal, @montoAnticipo
          );
        `);

      // ── 3. INSERT COMPRAS_ITEMS + increment stock ──
      for (const item of input.items) {
        const bonif = item.BONIFICACION || 0;
        const precioNeto = bonif > 0
          ? item.PRECIO_COMPRA * (1 - bonif / 100)
          : item.PRECIO_COMPRA;
        const totalProducto = r2(precioNeto * item.CANTIDAD);
        const descImporte = r2((item.PRECIO_COMPRA - precioNeto) * item.CANTIDAD);

        const ivaAli = discriminaIva ? (item.IVA_ALICUOTA || 0) : 0;
        const ivaImporte = r2(totalProducto * ivaAli);

        // Get TASA_IVA_ID from product if not provided
        let tasaIvaId = discriminaIva ? item.TASA_IVA_ID : null;
        if (tasaIvaId === undefined || tasaIvaId === null) {
          const tasaResult = await tx.request()
            .input('pid', sql.Int, item.PRODUCTO_ID)
            .query('SELECT TASA_IVA_ID FROM PRODUCTOS WHERE PRODUCTO_ID = @pid');
          tasaIvaId = tasaResult.recordset[0]?.TASA_IVA_ID || null;
        }

        const depositoId = item.DEPOSITO_ID || null;

        await tx.request()
          .input('compraId', sql.Int, compraId)
          .input('productoId', sql.Int, item.PRODUCTO_ID)
          .input('precioCompra', sql.Decimal(18, 4), item.PRECIO_COMPRA)
          .input('cantidad', sql.Decimal(18, 4), item.CANTIDAD)
          .input('totalProducto', sql.Decimal(18, 4), totalProducto)
          .input('depositoId', sql.Int, depositoId)
          .input('porcDesc', sql.Decimal(9, 4), bonif)
          .input('descImporte', sql.Decimal(18, 2), descImporte)
          .input('tasaIvaId', sql.Int, tasaIvaId)
          .input('ivaAlicuota', sql.Decimal(9, 4), ivaAli)
          .input('ivaImporte', sql.Decimal(18, 2), ivaImporte)
          .input('impInternoImporte', sql.Decimal(18, 2), item.IMP_INTERNOS || 0)
          .query(`
            INSERT INTO COMPRAS_ITEMS (
              COMPRA_ID, PRODUCTO_ID, PRECIO_COMPRA, CANTIDAD, TOTAL_PRODUCTO,
              DEPOSITO_ID, PORCENTAJE_DESCUENTO, DESCUENTO_IMPORTE,
              TASA_IVA_ID, IVA_ALICUOTA, IVA_IMPORTE, IMP_INTERNO_IMPORTE
            ) VALUES (
              @compraId, @productoId, @precioCompra, @cantidad, @totalProducto,
              @depositoId, @porcDesc, @descImporte,
              @tasaIvaId, @ivaAlicuota, @ivaImporte, @impInternoImporte
            )
          `);

        // Increment stock (purchase increases inventory)
        await incrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, depositoId);

        // Update costs if requested
        if (input.ACTUALIZAR_COSTOS) {
          const precioNetoUnitario = precioNeto; // net after discount, before IVA
          await actualizarPrecioCompra(tx, item.PRODUCTO_ID, precioNetoUnitario);

          if (input.ACTUALIZAR_PRECIOS) {
            await actualizarPreciosVenta(tx, item.PRODUCTO_ID, precioNetoUnitario);
          }
        }
      }

      // ── 4. CTA_CORRIENTE_P (if cuenta corriente purchase) ──
      if (input.ES_CTA_CORRIENTE) {
        const ctaCteId = await ensureCtaCorrienteP(tx, input.PROVEEDOR_ID);
        const fechaCompra = input.FECHA_COMPRA ? new Date(input.FECHA_COMPRA) : new Date();
        const ptoVta = input.PTO_VTA || '0000';
        const nroComp = input.NRO_COMPROBANTE || '00000000';
        const tipoComp = input.TIPO_COMPROBANTE || 'FB';

        await tx.request()
          .input('comprobanteId', sql.Int, compraId)
          .input('ctaCteId', sql.Int, ctaCteId)
          .input('fecha', sql.DateTime, fechaCompra)
          .input('concepto', sql.NVarChar(255), `Compra ${ptoVta}-${nroComp}`)
          .input('tipoComp', sql.NVarChar(50), tipoComp)
          .input('debe', sql.Decimal(18, 2), r2(total))
          .input('haber', sql.Decimal(18, 2), 0)
          .query(`
            INSERT INTO COMPRAS_CTA_CORRIENTE
              (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
            VALUES
              (@comprobanteId, @ctaCteId, @fecha, @concepto, @tipoComp, @debe, @haber)
          `);
      }

      // ── 5. AUDITORIA ──
      await registrarAuditoria(
        tx, compraId, 'CREACION', usuarioId,
        r2(total), `Compra #${compraId} creada`
      );

      await tx.commit();
      return { COMPRA_ID: compraId, TOTAL: r2(total), COBRADA: cobrada };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update purchase ────────────────────────────
  async update(id: number, input: CompraInput, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT COMPRA_ID, ES_CTA_CORRIENTE, PROVEEDOR_ID, TOTAL
                FROM COMPRAS WHERE COMPRA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Compra no encontrada'), { name: 'ValidationError' });
      }

      const oldCompra = existing.recordset[0];

      // ── 1. Restore stock from old items (decrement = reverse of purchase) ──
      const oldItems = await tx.request()
        .input('compraId', sql.Int, id)
        .query(`SELECT PRODUCTO_ID, CANTIDAD, DEPOSITO_ID FROM COMPRAS_ITEMS WHERE COMPRA_ID = @compraId`);

      for (const oldItem of oldItems.recordset) {
        await decrementarStock(tx, oldItem.PRODUCTO_ID, oldItem.CANTIDAD, oldItem.DEPOSITO_ID);
      }

      // ── 2. Delete old items ──
      await tx.request().input('compraId', sql.Int, id)
        .query(`DELETE FROM COMPRAS_ITEMS WHERE COMPRA_ID = @compraId`);

      // ── 3. Remove old CTA_CORRIENTE records ──
      if (oldCompra.ES_CTA_CORRIENTE) {
        await tx.request().input('comprobanteId', sql.Int, id)
          .query(`DELETE FROM COMPRAS_CTA_CORRIENTE WHERE COMPROBANTE_ID = @comprobanteId`);
      }

      // ── 4. Calculate new totals ──
      let netoTotal = 0;
      let ivaTotal = 0;
      let impInternoTotal = 0;
      let bonifTotal = 0;

      for (const item of input.items) {
        const bonif = item.BONIFICACION || 0;
        const precioNeto = bonif > 0
          ? item.PRECIO_COMPRA * (1 - bonif / 100)
          : item.PRECIO_COMPRA;
        const lineNeto = precioNeto * item.CANTIDAD;
        netoTotal += lineNeto;

        if (bonif > 0) {
          bonifTotal += (item.PRECIO_COMPRA - precioNeto) * item.CANTIDAD;
        }

        const ivaAli = item.IVA_ALICUOTA || 0;
        ivaTotal += lineNeto * ivaAli;
        impInternoTotal += (item.IMP_INTERNOS || 0) * item.CANTIDAD;
      }

      const percIVA = input.PERCEPCION_IVA || 0;
      const percIIBB = input.PERCEPCION_IIBB || 0;

      // Use manual IVA total if provided (Factura A)
      if (input.IVA_TOTAL !== undefined && input.IVA_TOTAL !== null) {
        ivaTotal = input.IVA_TOTAL;
      }

      let total = r2(netoTotal + ivaTotal + impInternoTotal + percIVA + percIIBB);

      const cobrada = input.COBRADA !== undefined ? input.COBRADA : oldCompra.COBRADA;

      // ── 5. UPDATE COMPRAS ──
      await tx.request()
        .input('id', sql.Int, id)
        .input('proveedorId', sql.Int, input.PROVEEDOR_ID)
        .input('fechaCompra', sql.DateTime, input.FECHA_COMPRA ? new Date(input.FECHA_COMPRA) : new Date())
        .input('total', sql.Decimal(18, 2), total)
        .input('esCtaCorriente', sql.Bit, input.ES_CTA_CORRIENTE ? 1 : 0)
        .input('montoEfectivo', sql.Decimal(18, 2), input.MONTO_EFECTIVO || 0)
        .input('montoDigital', sql.Decimal(18, 2), input.MONTO_DIGITAL || 0)
        .input('vuelto', sql.Decimal(18, 2), input.VUELTO || 0)
        .input('tipoComprobante', sql.NVarChar, input.TIPO_COMPROBANTE || 'FB')
        .input('cobrada', sql.Bit, cobrada ? 1 : 0)
        .input('ptoVta', sql.NVarChar, input.PTO_VTA || '0000')
        .input('nroComprobante', sql.NVarChar, input.NRO_COMPROBANTE || '00000000')
        .input('preciosSinIva', sql.Bit, input.PRECIOS_SIN_IVA ? 1 : 0)
        .input('impIntGravaIva', sql.Bit, input.IMP_INT_GRAVA_IVA ? 1 : 0)
        .input('percIVA', sql.Decimal(18, 2), percIVA)
        .input('percIIBB', sql.Decimal(18, 2), percIIBB)
        .input('impInterno', sql.Decimal(18, 2), r2(impInternoTotal))
        .input('ivaTotal', sql.Decimal(18, 2), r2(ivaTotal))
        .input('bonifTotal', sql.Decimal(18, 2), r2(bonifTotal))
        .query(`
          UPDATE COMPRAS SET
            PROVEEDOR_ID=@proveedorId, FECHA_COMPRA=@fechaCompra, TOTAL=@total,
            ES_CTA_CORRIENTE=@esCtaCorriente,
            MONTO_EFECTIVO=@montoEfectivo, MONTO_DIGITAL=@montoDigital, VUELTO=@vuelto,
            TIPO_COMPROBANTE=@tipoComprobante, COBRADA=@cobrada,
            PTO_VTA=@ptoVta, NRO_COMPROBANTE=@nroComprobante,
            PRECIOS_SIN_IVA=@preciosSinIva, IMP_INT_GRAVA_IVA=@impIntGravaIva,
            PERCEPCION_IVA=@percIVA, PERCEPCION_IIBB=@percIIBB,
            IMPUESTO_INTERNO=@impInterno, IVA_TOTAL=@ivaTotal,
            BONIFICACION_TOTAL=@bonifTotal
          WHERE COMPRA_ID = @id
        `);

      // ── 6. Insert new items + increment stock ──
      for (const item of input.items) {
        const bonif = item.BONIFICACION || 0;
        const precioNeto = bonif > 0
          ? item.PRECIO_COMPRA * (1 - bonif / 100)
          : item.PRECIO_COMPRA;
        const totalProducto = r2(precioNeto * item.CANTIDAD);
        const descImporte = r2((item.PRECIO_COMPRA - precioNeto) * item.CANTIDAD);

        const ivaAli = item.IVA_ALICUOTA || 0;
        const ivaImporte = r2(totalProducto * ivaAli);

        let tasaIvaId = item.TASA_IVA_ID;
        if (tasaIvaId === undefined || tasaIvaId === null) {
          const tasaResult = await tx.request()
            .input('pid', sql.Int, item.PRODUCTO_ID)
            .query('SELECT TASA_IVA_ID FROM PRODUCTOS WHERE PRODUCTO_ID = @pid');
          tasaIvaId = tasaResult.recordset[0]?.TASA_IVA_ID || null;
        }

        const depositoId = item.DEPOSITO_ID || null;

        await tx.request()
          .input('compraId', sql.Int, id)
          .input('productoId', sql.Int, item.PRODUCTO_ID)
          .input('precioCompra', sql.Decimal(18, 4), item.PRECIO_COMPRA)
          .input('cantidad', sql.Decimal(18, 4), item.CANTIDAD)
          .input('totalProducto', sql.Decimal(18, 4), totalProducto)
          .input('depositoId', sql.Int, depositoId)
          .input('porcDesc', sql.Decimal(9, 4), bonif)
          .input('descImporte', sql.Decimal(18, 2), descImporte)
          .input('tasaIvaId', sql.Int, tasaIvaId)
          .input('ivaAlicuota', sql.Decimal(9, 4), ivaAli)
          .input('ivaImporte', sql.Decimal(18, 2), ivaImporte)
          .input('impInternoImporte', sql.Decimal(18, 2), item.IMP_INTERNOS || 0)
          .query(`
            INSERT INTO COMPRAS_ITEMS (
              COMPRA_ID, PRODUCTO_ID, PRECIO_COMPRA, CANTIDAD, TOTAL_PRODUCTO,
              DEPOSITO_ID, PORCENTAJE_DESCUENTO, DESCUENTO_IMPORTE,
              TASA_IVA_ID, IVA_ALICUOTA, IVA_IMPORTE, IMP_INTERNO_IMPORTE
            ) VALUES (
              @compraId, @productoId, @precioCompra, @cantidad, @totalProducto,
              @depositoId, @porcDesc, @descImporte,
              @tasaIvaId, @ivaAlicuota, @ivaImporte, @impInternoImporte
            )
          `);

        await incrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, depositoId);

        if (input.ACTUALIZAR_COSTOS) {
          await actualizarPrecioCompra(tx, item.PRODUCTO_ID, precioNeto);
          if (input.ACTUALIZAR_PRECIOS) {
            await actualizarPreciosVenta(tx, item.PRODUCTO_ID, precioNeto);
          }
        }
      }

      // ── 7. Re-create CTA_CORRIENTE if applicable ──
      if (input.ES_CTA_CORRIENTE) {
        const ctaCteId = await ensureCtaCorrienteP(tx, input.PROVEEDOR_ID);
        const ptoVta = input.PTO_VTA || '0000';
        const nroComp = input.NRO_COMPROBANTE || '00000000';
        await tx.request()
          .input('comprobanteId', sql.Int, id)
          .input('ctaCteId', sql.Int, ctaCteId)
          .input('fecha', sql.DateTime, input.FECHA_COMPRA ? new Date(input.FECHA_COMPRA) : new Date())
          .input('concepto', sql.NVarChar(255), `Compra ${ptoVta}-${nroComp}`)
          .input('tipoComp', sql.NVarChar(50), input.TIPO_COMPROBANTE || 'FB')
          .input('debe', sql.Decimal(18, 2), r2(total))
          .input('haber', sql.Decimal(18, 2), 0)
          .query(`
            INSERT INTO COMPRAS_CTA_CORRIENTE
              (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
            VALUES
              (@comprobanteId, @ctaCteId, @fecha, @concepto, @tipoComp, @debe, @haber)
          `);
      }

      // ── 8. AUDITORIA ──
      await registrarAuditoria(
        tx, id, 'MODIFICACION', usuarioId,
        r2(total), `Compra #${id} modificada`
      );

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete purchase ────────────────────────────
  async delete(id: number, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT COMPRA_ID, ES_CTA_CORRIENTE, PROVEEDOR_ID, TOTAL
                FROM COMPRAS WHERE COMPRA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Compra no encontrada'), { name: 'ValidationError' });
      }

      const compra = existing.recordset[0];

      // ── 1. Restore stock (decrement = reverse of purchase increment) ──
      const items = await tx.request()
        .input('compraId', sql.Int, id)
        .query(`SELECT PRODUCTO_ID, CANTIDAD, DEPOSITO_ID FROM COMPRAS_ITEMS WHERE COMPRA_ID = @compraId`);

      for (const item of items.recordset) {
        await decrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID);
      }

      // ── 2. Remove CAJA_ITEMS ──
      await tx.request().input('origenId', sql.Int, id)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'COMPRA'`);

      // ── 3. Remove CTA_CORRIENTE records ──
      if (compra.ES_CTA_CORRIENTE) {
        await tx.request().input('comprobanteId', sql.Int, id)
          .query(`DELETE FROM COMPRAS_CTA_CORRIENTE WHERE COMPROBANTE_ID = @comprobanteId`);

        // Check if it was the only record and remove CTA_CORRIENTE_P if empty
        const ctaP = await tx.request()
          .input('pid', sql.Int, compra.PROVEEDOR_ID)
          .query(`SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_P WHERE PROVEEDOR_ID = @pid`);

        if (ctaP.recordset.length > 0) {
          const ctaId = ctaP.recordset[0].CTA_CORRIENTE_ID;
          const remaining = await tx.request()
            .input('ctaId', sql.Int, ctaId)
            .query(`SELECT COUNT(*) AS cnt FROM COMPRAS_CTA_CORRIENTE WHERE CTA_CORRIENTE_ID = @ctaId`);

          if (remaining.recordset[0].cnt === 0) {
            // Also check payments before deleting
            const pagos = await tx.request()
              .input('ctaId', sql.Int, ctaId)
              .query(`SELECT COUNT(*) AS cnt FROM PAGOS_CTA_CORRIENTE_P WHERE CTA_CORRIENTE_ID = @ctaId`);

            if (pagos.recordset[0].cnt === 0) {
              await tx.request()
                .input('ctaId', sql.Int, ctaId)
                .query(`DELETE FROM CTA_CORRIENTE_P WHERE CTA_CORRIENTE_ID = @ctaId`);
            }
          }
        }
      }

      // ── 4. Remove MOVIMIENTOS_CAJA linked to this purchase ──
      await tx.request().input('origenId', sql.Int, id)
        .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @origenId AND TIPO_ENTIDAD = 'COMPRA'`);

      // ── 5. Delete items then purchase ──
      await tx.request().input('compraId', sql.Int, id)
        .query(`DELETE FROM COMPRAS_ITEMS WHERE COMPRA_ID = @compraId`);
      await tx.request().input('id', sql.Int, id)
        .query(`DELETE FROM COMPRAS WHERE COMPRA_ID = @id`);

      // ── 6. AUDITORIA ──
      await registrarAuditoria(
        tx, id, 'ELIMINACION', usuarioId,
        compra.TOTAL, `Compra #${id} eliminada`
      );

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Search products for purchase form ──────────
  async searchProducts(search: string, limit: number = 20) {
    const pool = await getPool();

    const result = await pool.request()
      .input('search', sql.NVarChar, `%${search}%`)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT DISTINCT TOP (@limit)
          p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE,
          CASE
            WHEN ISNULL(p.PRECIO_COMPRA_BASE, 0) > 0 THEN p.PRECIO_COMPRA_BASE
            ELSE ISNULL(p.PRECIO_COMPRA, 0)
          END AS PRECIO_COMPRA,
          p.CANTIDAD AS STOCK,
          p.ES_CONJUNTO, p.DESCUENTA_STOCK, p.ACTIVO,
          ISNULL(p.IMP_INT, 0) AS IMP_INT,
          p.TASA_IVA_ID, p.UNIDAD_ID,
          ISNULL(u.NOMBRE, '') AS UNIDAD_NOMBRE,
          ISNULL(u.ABREVIACION, 'u') AS UNIDAD_ABREVIACION,
          ISNULL(ti.PORCENTAJE, 0) AS IVA_PORCENTAJE
        FROM PRODUCTOS p
        LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
        LEFT JOIN TASAS_IMPUESTOS ti ON p.TASA_IVA_ID = ti.TASA_ID
        LEFT JOIN PRODUCTOS_COD_BARRAS cb ON p.PRODUCTO_ID = cb.PRODUCTO_ID
        WHERE p.ACTIVO = 1
          AND (p.NOMBRE LIKE @search
               OR p.CODIGOPARTICULAR LIKE @search
               OR cb.CODIGO_BARRAS LIKE @search)
        ORDER BY p.NOMBRE
      `);

    return result.recordset;
  },

  // ── Proveedores for purchase form ──────────────
  async getProveedores() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT PROVEEDOR_ID, CODIGOPARTICULAR, NOMBRE,
             CTA_CORRIENTE, TIPO_DOCUMENTO, NUMERO_DOC
      FROM PROVEEDORES WHERE ACTIVO = 1 ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Depositos for purchase form ────────────────
  async getDepositos() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT DEPOSITO_ID, CODIGOPARTICULAR, NOMBRE FROM DEPOSITOS ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Saldo CTA CTE for a supplier ──────────────
  async getSaldoCtaCteP(proveedorId: number): Promise<{ saldo: number; ctaCorrienteId: number | null }> {
    const pool = await getPool();
    const cta = await pool.request()
      .input('pid', sql.Int, proveedorId)
      .query(`SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_P WHERE PROVEEDOR_ID = @pid`);

    if (cta.recordset.length === 0) {
      return { saldo: 0, ctaCorrienteId: null };
    }

    const ctaId = cta.recordset[0].CTA_CORRIENTE_ID;
    const result = await pool.request()
      .input('ctaId', sql.Int, ctaId)
      .query(`SELECT ISNULL(SUM(DEBE - HABER), 0) AS SALDO FROM COMPRAS_CTA_CORRIENTE WHERE CTA_CORRIENTE_ID = @ctaId`);

    return { saldo: result.recordset[0]?.SALDO || 0, ctaCorrienteId: ctaId };
  },
};
