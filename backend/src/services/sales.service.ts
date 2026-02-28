import { getPool, sql } from '../database/connection.js';
import { config } from '../config/index.js';
import type { Venta, VentaItem, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Sales Service — Full CRUD + Payment Management
// ═══════════════════════════════════════════════════

export interface VentaFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  clienteId?: number;
  puntoVentaId?: number;
  cobrada?: boolean;
  usuarioId?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface VentaItemInput {
  PRODUCTO_ID: number;
  PRECIO_UNITARIO: number;
  CANTIDAD: number;
  DESCUENTO: number;
  PRECIO_COMPRA: number;
  DEPOSITO_ID?: number;
  LISTA_ID?: number;
  PROMOCION_ID?: number | null;
  CANTIDAD_PROMO?: number | null;
  PRECIO_PROMOCION?: number | null;
  IMPUESTO_INTERNO_PORCENTAJE?: number;
  IMPUESTO_INTERNO_MONTO?: number;
  IMPUESTO_INTERNO_TIPO?: number;
  IVA_ALICUOTA?: number;
  IVA_MONTO?: number;
  CANTIDAD_PRODUCTOS_PROMO?: number;
}

export interface VentaInput {
  CLIENTE_ID: number;
  FECHA_VENTA?: string;
  TIPO_COMPROBANTE?: string;
  PUNTO_VENTA_ID: number;
  ES_CTA_CORRIENTE?: boolean;
  MONTO_EFECTIVO?: number;
  MONTO_DIGITAL?: number;
  VUELTO?: number;
  DTO_GRAL?: number;
  COBRADA?: boolean;
  items: VentaItemInput[];
}

export interface PaymentInput {
  MONTO_EFECTIVO: number;
  MONTO_DIGITAL: number;
  VUELTO: number;
  parcial?: boolean;
}

// ── Stock helpers ────────────────────────────────

/**
 * Decrement stock for a product.
 * - Conjuntos (kits): decrements children via PRODUCTO_CONJUNTO_DEPOSITO,
 *   then parent if DESCUENTA_STOCK is true.
 * - Normal products: only decrements if DESCUENTA_STOCK is true.
 */
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
    // Decrement children
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

    // Also decrement parent if DESCUENTA_STOCK
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

/**
 * Restore stock for a product (reverse of decrementarStock).
 */
async function restaurarStock(
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

// ── Audit helper ─────────────────────────────────

async function registrarAuditoria(
  tx: any,
  tipoEntidad: string,
  entidadId: number,
  tipoMovimiento: string,
  usuarioId: number,
  puntoVentaId: number | null,
  cajaId: number | null,
  monto: number,
  descripcion: string
) {
  try {
    await tx.request()
      .input('TipoEntidad', sql.NVarChar(50), tipoEntidad)
      .input('EntidadId', sql.Int, entidadId)
      .input('TipoMovimiento', sql.NVarChar(50), tipoMovimiento)
      .input('UsuarioId', sql.Int, usuarioId)
      .input('PuntoVentaId', sql.Int, puntoVentaId)
      .input('CajaId', sql.Int, cajaId)
      .input('Descripcion', sql.NVarChar(500), descripcion)
      .input('Monto', sql.Decimal(18, 2), monto)
      .output('AuditoriaId', sql.BigInt)
      .execute('SP_REGISTRAR_AUDITORIA');
  } catch {
    // Audit failure should not abort the transaction
    console.warn(`Audit registration failed for ${tipoEntidad} ${entidadId} (${tipoMovimiento})`);
  }
}

// ── Caja helper ──────────────────────────────────

async function getCajaAbiertaTx(
  tx: any,
  usuarioId: number
): Promise<{ CAJA_ID: number } | null> {
  const result = await tx.request()
    .input('uid', sql.Int, usuarioId)
    .query(`SELECT CAJA_ID FROM CAJA WHERE USUARIO_ID = @uid AND ESTADO = 'ACTIVA'`);
  return result.recordset.length > 0 ? result.recordset[0] : null;
}

// ── CTA Corriente helper ─────────────────────────

async function ensureCtaCorriente(tx: any, clienteId: number): Promise<number> {
  const existing = await tx.request()
    .input('cid', sql.Int, clienteId)
    .query(`SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @cid`);

  if (existing.recordset.length > 0) {
    return existing.recordset[0].CTA_CORRIENTE_ID;
  }

  // Create new CTA_CORRIENTE_C row
  const result = await tx.request()
    .input('cid', sql.Int, clienteId)
    .query(`
      INSERT INTO CTA_CORRIENTE_C (CLIENTE_ID, FECHA) VALUES (@cid, GETDATE());
      SELECT SCOPE_IDENTITY() AS CTA_CORRIENTE_ID;
    `);
  return result.recordset[0].CTA_CORRIENTE_ID;
}

// ── Round helper ─────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ═══════════════════════════════════════════════════

export const salesService = {
  // ── List with pagination & filters ─────────────
  async getAll(filter: VentaFilter = {}): Promise<PaginatedResult<Venta>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.fechaDesde) {
      where += ' AND CAST(v.FECHA_VENTA AS DATE) >= @fechaDesde';
      params.push({ name: 'fechaDesde', type: sql.VarChar(10), value: filter.fechaDesde });
    }
    if (filter.fechaHasta) {
      where += ' AND CAST(v.FECHA_VENTA AS DATE) <= @fechaHasta';
      params.push({ name: 'fechaHasta', type: sql.VarChar(10), value: filter.fechaHasta });
    }
    if (filter.clienteId) {
      where += ' AND v.CLIENTE_ID = @clienteId';
      params.push({ name: 'clienteId', type: sql.Int, value: filter.clienteId });
    }
    if (filter.puntoVentaId) {
      where += ' AND v.PUNTO_VENTA_ID = @puntoVentaId';
      params.push({ name: 'puntoVentaId', type: sql.Int, value: filter.puntoVentaId });
    }
    if (filter.usuarioId) {
      where += ' AND v.USUARIO_ID = @usuarioId';
      params.push({ name: 'usuarioId', type: sql.Int, value: filter.usuarioId });
    }
    if (filter.cobrada !== undefined) {
      where += ' AND v.COBRADA = @cobrada';
      params.push({ name: 'cobrada', type: sql.Bit, value: filter.cobrada ? 1 : 0 });
    }
    if (filter.search) {
      where += ` AND (c.NOMBRE LIKE @search OR v.NUMERO_FISCAL LIKE @search 
                  OR CAST(v.VENTA_ID AS VARCHAR) LIKE @search
                  OR u.NOMBRE LIKE @search)`;
      params.push({ name: 'search', type: sql.NVarChar, value: `%${filter.search}%` });
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    const countResult = await bind(pool.request()).query(`
      SELECT COUNT(*) as total FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
      LEFT JOIN USUARIOS u ON v.USUARIO_ID = u.USUARIO_ID
      ${where}
    `);
    const total = countResult.recordset[0].total;

    const validCols: Record<string, string> = {
      fecha: 'v.FECHA_VENTA', total: 'v.TOTAL', cliente: 'c.NOMBRE',
      usuario: 'u.NOMBRE', id: 'v.VENTA_ID',
    };
    const orderCol = validCols[(filter.orderBy || 'fecha').toLowerCase()] || 'v.FECHA_VENTA';
    const orderDir = filter.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const dataReq = bind(pool.request());
    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query(`
      SELECT 
        v.VENTA_ID, v.CLIENTE_ID, v.FECHA_VENTA, v.TOTAL, v.GANANCIAS,
        v.ES_CTA_CORRIENTE, v.MONTO_EFECTIVO, v.MONTO_DIGITAL, v.VUELTO,
        v.NUMERO_FISCAL, v.CAE, v.PUNTO_VENTA, v.TIPO_COMPROBANTE,
        v.COBRADA, v.PUNTO_VENTA_ID, v.USUARIO_ID,
        ISNULL(v.MONTO_ANTICIPO, 0) AS MONTO_ANTICIPO,
        ISNULL(v.DTO_GRAL, 0) AS DTO_GRAL,
        v.ERROR_FE, v.ERRORES,
        c.NOMBRE AS CLIENTE_NOMBRE,
        u.NOMBRE AS USUARIO_NOMBRE
      FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
      LEFT JOIN USUARIOS u ON v.USUARIO_ID = u.USUARIO_ID
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  // ── Get by ID (full detail with items) ─────────
  async getById(id: number): Promise<Venta & { items: VentaItem[] }> {
    const pool = await getPool();

    const ventaResult = await pool
      .request()
      .input('id', sql.Int, id)
      .query<Venta>(`
        SELECT v.*, 
          c.NOMBRE AS CLIENTE_NOMBRE, 
          u.NOMBRE AS USUARIO_NOMBRE
        FROM VENTAS v
        LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
        LEFT JOIN USUARIOS u ON v.USUARIO_ID = u.USUARIO_ID
        WHERE v.VENTA_ID = @id
      `);

    if (ventaResult.recordset.length === 0) {
      throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
    }

    const itemsResult = await pool
      .request()
      .input('id', sql.Int, id)
      .query<VentaItem>(`
        SELECT vi.ITEM_ID, vi.VENTA_ID, vi.PRODUCTO_ID, 
               vi.PRECIO_UNITARIO, vi.CANTIDAD, vi.PRECIO_UNITARIO_DTO, vi.DESCUENTO,
               vi.PROMOCION_ID, vi.CANTIDAD_PROMO, vi.PRECIO_PROMOCION,
               vi.PRECIO_COMPRA, vi.DEPOSITO_ID, vi.LISTA_ID,
               ISNULL(vi.IMPUESTO_INTERNO_PORCENTAJE, 0) AS IMPUESTO_INTERNO_PORCENTAJE,
               ISNULL(vi.IMPUESTO_INTERNO_MONTO, 0) AS IMPUESTO_INTERNO_MONTO,
               ISNULL(vi.IMPUESTO_INTERNO_TIPO, 1) AS IMPUESTO_INTERNO_TIPO,
               ISNULL(vi.IVA_ALICUOTA, 0) AS IVA_ALICUOTA,
               ISNULL(vi.IVA_MONTO, 0) AS IVA_MONTO,
               ISNULL(vi.CANTIDAD_PRODUCTOS_PROMO, 0) AS CANTIDAD_PRODUCTOS_PROMO,
               p.NOMBRE AS PRODUCTO_NOMBRE, 
               p.CODIGOPARTICULAR AS PRODUCTO_CODIGO,
               ISNULL(um.ABREVIACION, 'u') AS UNIDAD_ABREVIACION
        FROM VENTAS_ITEMS vi
        JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
        LEFT JOIN UNIDADES_MEDIDA um ON p.UNIDAD_ID = um.UNIDAD_ID
        WHERE vi.VENTA_ID = @id
        ORDER BY vi.ITEM_ID
      `);

    return {
      ...ventaResult.recordset[0],
      items: itemsResult.recordset,
    };
  },

  // ── Create sale with items ─────────────────────
  async create(input: VentaInput, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // ── 1. Calculate totals from items ──
      let subtotal = 0;
      let ganancias = 0;
      let ivaTotal = 0;
      let impuestoInternoTotal = 0;
      let bonificaciones = 0;
      let netoGravado = 0;
      let netoNoGravado = 0;
      const dtoGral = input.DTO_GRAL || 0;

      for (const item of input.items) {
        const precioConDto = item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO;
        const lineTotal = precioConDto * item.CANTIDAD;
        subtotal += lineTotal;
        ganancias += (precioConDto - (item.PRECIO_COMPRA || 0)) * item.CANTIDAD;

        if (item.DESCUENTO > 0) {
          bonificaciones += (item.PRECIO_UNITARIO - precioConDto) * item.CANTIDAD;
        }

        const ivaMonto = item.IVA_MONTO || 0;
        const ivaAlicuota = item.IVA_ALICUOTA || 0;
        ivaTotal += ivaMonto * item.CANTIDAD;
        impuestoInternoTotal += (item.IMPUESTO_INTERNO_MONTO || 0) * item.CANTIDAD;

        // NETO split: gravado vs no gravado
        if (ivaAlicuota > 0) {
          netoGravado += (precioConDto - ivaMonto) * item.CANTIDAD;
        } else {
          netoNoGravado += precioConDto * item.CANTIDAD;
        }
      }

      // Apply general discount
      let total = subtotal;
      if (dtoGral > 0) {
        const montoDescuento = subtotal * (dtoGral / 100);
        total -= montoDescuento;
        ganancias -= montoDescuento;
        bonificaciones += montoDescuento;
        // Proportionally reduce neto amounts
        const factor = 1 - dtoGral / 100;
        netoGravado *= factor;
        netoNoGravado *= factor;
      }

      const cobrada = input.COBRADA !== undefined ? input.COBRADA : !input.ES_CTA_CORRIENTE;
      const montoEfectivo = input.MONTO_EFECTIVO || 0;
      const montoDigital = input.MONTO_DIGITAL || 0;
      const vuelto = input.VUELTO || 0;

      // ── 2. Get caja abierta ──
      const caja = await getCajaAbiertaTx(tx, usuarioId);

      // ── 3. INSERT into VENTAS ──
      const ventaResult = await tx.request()
        .input('clienteId', sql.Int, input.CLIENTE_ID)
        .input('total', sql.Decimal(18, 2), r2(total))
        .input('ganancias', sql.Decimal(18, 2), r2(ganancias))
        .input('esCtaCorriente', sql.Bit, input.ES_CTA_CORRIENTE ? 1 : 0)
        .input('montoEfectivo', sql.Decimal(18, 2), montoEfectivo)
        .input('montoDigital', sql.Decimal(18, 2), montoDigital)
        .input('vuelto', sql.Decimal(18, 2), vuelto)
        .input('tipoComprobante', sql.NVarChar, input.TIPO_COMPROBANTE || null)
        .input('cobrada', sql.Bit, cobrada ? 1 : 0)
        .input('puntoVentaId', sql.Int, input.PUNTO_VENTA_ID)
        .input('usuarioId', sql.Int, usuarioId)
        .input('dtoGral', sql.Decimal(18, 2), dtoGral)
        .input('subtotal', sql.Decimal(18, 2), r2(subtotal))
        .input('bonificaciones', sql.Decimal(18, 2), r2(bonificaciones))
        .input('impuestoInterno', sql.Decimal(18, 2), r2(impuestoInternoTotal))
        .input('ivaTotal', sql.Decimal(18, 2), r2(ivaTotal))
        .input('montoAnticipo', sql.Decimal(18, 2), 0)
        .input('netoGravado', sql.Decimal(18, 2), r2(netoGravado))
        .input('netoNoGravado', sql.Decimal(18, 2), r2(netoNoGravado))
        .query(`
          INSERT INTO VENTAS (
            CLIENTE_ID, FECHA_VENTA, TOTAL, GANANCIAS, ES_CTA_CORRIENTE,
            MONTO_EFECTIVO, MONTO_DIGITAL, VUELTO, TIPO_COMPROBANTE,
            COBRADA, PUNTO_VENTA_ID, USUARIO_ID, DTO_GRAL,
            SUBTOTAL, BONIFICACIONES, IMPUESTO_INTERNO, IVA_TOTAL, MONTO_ANTICIPO,
            NETO_GRAVADO, NETO_NO_GRAVADO
          ) VALUES (
            @clienteId, GETDATE(), @total, @ganancias, @esCtaCorriente,
            @montoEfectivo, @montoDigital, @vuelto, @tipoComprobante,
            @cobrada, @puntoVentaId, @usuarioId, @dtoGral,
            @subtotal, @bonificaciones, @impuestoInterno, @ivaTotal, @montoAnticipo,
            @netoGravado, @netoNoGravado
          );
          SELECT SCOPE_IDENTITY() AS VENTA_ID;
        `);

      const ventaId = ventaResult.recordset[0].VENTA_ID;

      // ── 4. INSERT VENTAS_ITEMS + decrement stock ──
      for (const item of input.items) {
        const precioConDto = item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO;

        await tx.request()
          .input('ventaId', sql.Int, ventaId)
          .input('productoId', sql.Int, item.PRODUCTO_ID)
          .input('precioUnitario', sql.Decimal(18, 4), item.PRECIO_UNITARIO)
          .input('cantidad', sql.Decimal(18, 4), item.CANTIDAD)
          .input('precioUnitarioDto', sql.Decimal(18, 4), Math.round(precioConDto * 10000) / 10000)
          .input('descuento', sql.Decimal(18, 2), item.DESCUENTO)
          .input('promocionId', sql.Int, item.PROMOCION_ID || null)
          .input('cantidadPromo', sql.Decimal(18, 4), item.CANTIDAD_PROMO || null)
          .input('precioPromocion', sql.Decimal(18, 4), item.PRECIO_PROMOCION || null)
          .input('precioCompra', sql.Decimal(18, 4), item.PRECIO_COMPRA || 0)
          .input('depositoId', sql.Int, item.DEPOSITO_ID || null)
          .input('listaId', sql.Int, item.LISTA_ID || 1)
          .input('impIntPorcentaje', sql.Decimal(18, 4), item.IMPUESTO_INTERNO_PORCENTAJE || 0)
          .input('impIntMonto', sql.Decimal(18, 4), item.IMPUESTO_INTERNO_MONTO || 0)
          .input('impIntTipo', sql.Int, item.IMPUESTO_INTERNO_TIPO || 1)
          .input('ivaAlicuota', sql.Decimal(18, 4), item.IVA_ALICUOTA || 0)
          .input('ivaMonto', sql.Decimal(18, 4), item.IVA_MONTO || 0)
          .input('cantidadProductosPromo', sql.Decimal(18, 2), item.CANTIDAD_PRODUCTOS_PROMO || 0)
          .query(`
            INSERT INTO VENTAS_ITEMS (
              VENTA_ID, PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, PRECIO_UNITARIO_DTO,
              DESCUENTO, PROMOCION_ID, CANTIDAD_PROMO, PRECIO_PROMOCION,
              PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID,
              IMPUESTO_INTERNO_PORCENTAJE, IMPUESTO_INTERNO_MONTO, IMPUESTO_INTERNO_TIPO,
              IVA_ALICUOTA, IVA_MONTO, CANTIDAD_PRODUCTOS_PROMO
            ) VALUES (
              @ventaId, @productoId, @precioUnitario, @cantidad, @precioUnitarioDto,
              @descuento, @promocionId, @cantidadPromo, @precioPromocion,
              @precioCompra, @depositoId, @listaId,
              @impIntPorcentaje, @impIntMonto, @impIntTipo,
              @ivaAlicuota, @ivaMonto, @cantidadProductosPromo
            )
          `);

        // Decrement stock (handles DESCUENTA_STOCK flag + conjuntos)
        await decrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID || null);
      }

      // ── 5. CAJA_ITEMS (if not cta corriente and caja active) ──
      if (!input.ES_CTA_CORRIENTE && caja) {
        const efectivoNeto = Math.max(0, montoEfectivo - vuelto);
        if (efectivoNeto > 0 || montoDigital > 0) {
          await tx.request()
            .input('cajaId', sql.Int, caja.CAJA_ID)
            .input('origenTipo', sql.VarChar(30), 'VENTA')
            .input('origenId', sql.Int, ventaId)
            .input('efectivo', sql.Decimal(18, 2), efectivoNeto)
            .input('digital', sql.Decimal(18, 2), montoDigital)
            .input('desc', sql.NVarChar(255), `Venta #${ventaId}`)
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
                MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @origenId,
                @efectivo, @digital, @desc, @uid)
            `);
        }
      }

      // ── 6. CTA_CORRIENTE (if cuenta corriente sale) ──
      if (input.ES_CTA_CORRIENTE) {
        const ctaCteId = await ensureCtaCorriente(tx, input.CLIENTE_ID);
        await tx.request()
          .input('comprobanteId', sql.Int, ventaId)
          .input('ctaCteId', sql.Int, ctaCteId)
          .input('fecha', sql.DateTime, input.FECHA_VENTA ? new Date(input.FECHA_VENTA) : new Date())
          .input('concepto', sql.NVarChar(255), `Venta #${ventaId}`)
          .input('tipoComp', sql.NVarChar(50), 'VENTA')
          .input('debe', sql.Decimal(18, 2), r2(total))
          .input('haber', sql.Decimal(18, 2), 0)
          .query(`
            INSERT INTO VENTAS_CTA_CORRIENTE
              (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
            VALUES
              (@comprobanteId, @ctaCteId, @fecha, @concepto, @tipoComp, @debe, @haber)
          `);
      }

      // ── 7. AUDITORIA ──
      await registrarAuditoria(
        tx, 'VENTA', ventaId, 'CREACION', usuarioId,
        input.PUNTO_VENTA_ID, caja?.CAJA_ID || null,
        r2(total), `Venta #${ventaId} creada`
      );

      await tx.commit();
      return { VENTA_ID: ventaId, TOTAL: r2(total) };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update sale ────────────────────────────────
  async update(id: number, input: VentaInput, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Check sale exists and is not invoiced
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, NUMERO_FISCAL, COBRADA, ES_CTA_CORRIENTE,
                       CLIENTE_ID, TOTAL, PUNTO_VENTA_ID
                FROM VENTAS WHERE VENTA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
      }
      if (existing.recordset[0].NUMERO_FISCAL) {
        throw Object.assign(new Error('No se puede modificar una venta con número fiscal emitido'), { name: 'ValidationError' });
      }

      const oldVenta = existing.recordset[0];

      // ── 1. Restore stock from old items ──
      const oldItems = await tx.request()
        .input('ventaId', sql.Int, id)
        .query(`SELECT PRODUCTO_ID, CANTIDAD, DEPOSITO_ID FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);

      for (const oldItem of oldItems.recordset) {
        await restaurarStock(tx, oldItem.PRODUCTO_ID, oldItem.CANTIDAD, oldItem.DEPOSITO_ID);
      }

      // ── 2. Delete old items ──
      await tx.request().input('ventaId', sql.Int, id)
        .query(`DELETE FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);

      // ── 3. Remove old CAJA_ITEMS for this sale ──
      await tx.request().input('origenId', sql.Int, id)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'VENTA'`);

      // ── 4. Remove old CTA_CORRIENTE records ──
      if (oldVenta.ES_CTA_CORRIENTE) {
        await tx.request().input('comprobanteId', sql.Int, id)
          .query(`DELETE FROM VENTAS_CTA_CORRIENTE WHERE COMPROBANTE_ID = @comprobanteId AND TIPO_COMPROBANTE = 'VENTA'`);
      }

      // ── 5. Calculate new totals ──
      let subtotal = 0;
      let ganancias = 0;
      let bonificaciones = 0;
      let ivaTotal = 0;
      let impuestoInternoTotal = 0;
      let netoGravado = 0;
      let netoNoGravado = 0;
      const dtoGral = input.DTO_GRAL || 0;

      for (const item of input.items) {
        const precioConDto = item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO;
        const lineTotal = precioConDto * item.CANTIDAD;
        subtotal += lineTotal;
        ganancias += (precioConDto - (item.PRECIO_COMPRA || 0)) * item.CANTIDAD;

        if (item.DESCUENTO > 0) {
          bonificaciones += (item.PRECIO_UNITARIO - precioConDto) * item.CANTIDAD;
        }

        const ivaMonto = item.IVA_MONTO || 0;
        const ivaAlicuota = item.IVA_ALICUOTA || 0;
        ivaTotal += ivaMonto * item.CANTIDAD;
        impuestoInternoTotal += (item.IMPUESTO_INTERNO_MONTO || 0) * item.CANTIDAD;

        if (ivaAlicuota > 0) {
          netoGravado += (precioConDto - ivaMonto) * item.CANTIDAD;
        } else {
          netoNoGravado += precioConDto * item.CANTIDAD;
        }
      }

      let total = subtotal;
      if (dtoGral > 0) {
        const montoDescuento = subtotal * (dtoGral / 100);
        total -= montoDescuento;
        ganancias -= montoDescuento;
        bonificaciones += montoDescuento;
        const factor = 1 - dtoGral / 100;
        netoGravado *= factor;
        netoNoGravado *= factor;
      }

      const cobrada = input.COBRADA !== undefined ? input.COBRADA : oldVenta.COBRADA;

      // ── 6. UPDATE VENTAS ──
      await tx.request()
        .input('id', sql.Int, id)
        .input('clienteId', sql.Int, input.CLIENTE_ID)
        .input('fechaVenta', sql.DateTime, input.FECHA_VENTA ? new Date(input.FECHA_VENTA) : new Date())
        .input('total', sql.Decimal(18, 2), r2(total))
        .input('ganancias', sql.Decimal(18, 2), r2(ganancias))
        .input('esCtaCorriente', sql.Bit, input.ES_CTA_CORRIENTE ? 1 : 0)
        .input('montoEfectivo', sql.Decimal(18, 2), input.MONTO_EFECTIVO || 0)
        .input('montoDigital', sql.Decimal(18, 2), input.MONTO_DIGITAL || 0)
        .input('vuelto', sql.Decimal(18, 2), input.VUELTO || 0)
        .input('tipoComprobante', sql.NVarChar, input.TIPO_COMPROBANTE || null)
        .input('cobrada', sql.Bit, cobrada ? 1 : 0)
        .input('dtoGral', sql.Decimal(18, 2), dtoGral)
        .input('subtotal', sql.Decimal(18, 2), r2(subtotal))
        .input('bonificaciones', sql.Decimal(18, 2), r2(bonificaciones))
        .input('impuestoInterno', sql.Decimal(18, 2), r2(impuestoInternoTotal))
        .input('ivaTotal', sql.Decimal(18, 2), r2(ivaTotal))
        .input('netoGravado', sql.Decimal(18, 2), r2(netoGravado))
        .input('netoNoGravado', sql.Decimal(18, 2), r2(netoNoGravado))
        .query(`
          UPDATE VENTAS SET
            CLIENTE_ID=@clienteId, FECHA_VENTA=@fechaVenta, TOTAL=@total,
            GANANCIAS=@ganancias, ES_CTA_CORRIENTE=@esCtaCorriente,
            MONTO_EFECTIVO=@montoEfectivo, MONTO_DIGITAL=@montoDigital, VUELTO=@vuelto,
            TIPO_COMPROBANTE=@tipoComprobante, COBRADA=@cobrada, DTO_GRAL=@dtoGral,
            SUBTOTAL=@subtotal, BONIFICACIONES=@bonificaciones,
            IMPUESTO_INTERNO=@impuestoInterno, IVA_TOTAL=@ivaTotal,
            NETO_GRAVADO=@netoGravado, NETO_NO_GRAVADO=@netoNoGravado
          WHERE VENTA_ID = @id
        `);

      // ── 7. Insert new items + decrement stock ──
      for (const item of input.items) {
        const precioConDto = item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO;

        await tx.request()
          .input('ventaId', sql.Int, id)
          .input('productoId', sql.Int, item.PRODUCTO_ID)
          .input('precioUnitario', sql.Decimal(18, 4), item.PRECIO_UNITARIO)
          .input('cantidad', sql.Decimal(18, 4), item.CANTIDAD)
          .input('precioUnitarioDto', sql.Decimal(18, 4), Math.round(precioConDto * 10000) / 10000)
          .input('descuento', sql.Decimal(18, 2), item.DESCUENTO)
          .input('promocionId', sql.Int, item.PROMOCION_ID || null)
          .input('cantidadPromo', sql.Decimal(18, 4), item.CANTIDAD_PROMO || null)
          .input('precioPromocion', sql.Decimal(18, 4), item.PRECIO_PROMOCION || null)
          .input('precioCompra', sql.Decimal(18, 4), item.PRECIO_COMPRA || 0)
          .input('depositoId', sql.Int, item.DEPOSITO_ID || null)
          .input('listaId', sql.Int, item.LISTA_ID || 1)
          .input('impIntPorcentaje', sql.Decimal(18, 4), item.IMPUESTO_INTERNO_PORCENTAJE || 0)
          .input('impIntMonto', sql.Decimal(18, 4), item.IMPUESTO_INTERNO_MONTO || 0)
          .input('impIntTipo', sql.Int, item.IMPUESTO_INTERNO_TIPO || 1)
          .input('ivaAlicuota', sql.Decimal(18, 4), item.IVA_ALICUOTA || 0)
          .input('ivaMonto', sql.Decimal(18, 4), item.IVA_MONTO || 0)
          .input('cantidadProductosPromo', sql.Decimal(18, 2), item.CANTIDAD_PRODUCTOS_PROMO || 0)
          .query(`
            INSERT INTO VENTAS_ITEMS (
              VENTA_ID, PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, PRECIO_UNITARIO_DTO,
              DESCUENTO, PROMOCION_ID, CANTIDAD_PROMO, PRECIO_PROMOCION,
              PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID,
              IMPUESTO_INTERNO_PORCENTAJE, IMPUESTO_INTERNO_MONTO, IMPUESTO_INTERNO_TIPO,
              IVA_ALICUOTA, IVA_MONTO, CANTIDAD_PRODUCTOS_PROMO
            ) VALUES (
              @ventaId, @productoId, @precioUnitario, @cantidad, @precioUnitarioDto,
              @descuento, @promocionId, @cantidadPromo, @precioPromocion,
              @precioCompra, @depositoId, @listaId,
              @impIntPorcentaje, @impIntMonto, @impIntTipo,
              @ivaAlicuota, @ivaMonto, @cantidadProductosPromo
            )
          `);

        await decrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID || null);
      }

      // ── 8. Re-create CAJA_ITEMS if applicable ──
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      if (!input.ES_CTA_CORRIENTE && caja) {
        const montoEfectivo = input.MONTO_EFECTIVO || 0;
        const montoDigital = input.MONTO_DIGITAL || 0;
        const vuelto = input.VUELTO || 0;
        const efectivoNeto = Math.max(0, montoEfectivo - vuelto);
        if (efectivoNeto > 0 || montoDigital > 0) {
          await tx.request()
            .input('cajaId', sql.Int, caja.CAJA_ID)
            .input('origenTipo', sql.VarChar(30), 'VENTA')
            .input('origenId', sql.Int, id)
            .input('efectivo', sql.Decimal(18, 2), efectivoNeto)
            .input('digital', sql.Decimal(18, 2), montoDigital)
            .input('desc', sql.NVarChar(255), `Venta #${id}`)
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
                MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @origenId,
                @efectivo, @digital, @desc, @uid)
            `);
        }
      }

      // ── 9. Re-create CTA_CORRIENTE if applicable ──
      if (input.ES_CTA_CORRIENTE) {
        const ctaCteId = await ensureCtaCorriente(tx, input.CLIENTE_ID);
        await tx.request()
          .input('comprobanteId', sql.Int, id)
          .input('ctaCteId', sql.Int, ctaCteId)
          .input('fecha', sql.DateTime, input.FECHA_VENTA ? new Date(input.FECHA_VENTA) : new Date())
          .input('concepto', sql.NVarChar(255), `Venta #${id}`)
          .input('tipoComp', sql.NVarChar(50), 'VENTA')
          .input('debe', sql.Decimal(18, 2), r2(total))
          .input('haber', sql.Decimal(18, 2), 0)
          .query(`
            INSERT INTO VENTAS_CTA_CORRIENTE
              (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
            VALUES
              (@comprobanteId, @ctaCteId, @fecha, @concepto, @tipoComp, @debe, @haber)
          `);
      }

      // ── 10. AUDITORIA ──
      await registrarAuditoria(
        tx, 'VENTA', id, 'MODIFICACION', usuarioId,
        input.PUNTO_VENTA_ID, caja?.CAJA_ID || null,
        r2(total), `Venta #${id} modificada`
      );

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete sale ────────────────────────────────
  async delete(id: number, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, NUMERO_FISCAL, ES_CTA_CORRIENTE, CLIENTE_ID,
                       TOTAL, COBRADA, PUNTO_VENTA_ID
                FROM VENTAS WHERE VENTA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
      }

      const venta = existing.recordset[0];

      if (venta.NUMERO_FISCAL) {
        throw Object.assign(
          new Error('No se puede eliminar una venta con número fiscal emitido. Debe generar una nota de crédito.'),
          { name: 'ValidationError' }
        );
      }

      // ── 1. Restore stock from items ──
      const items = await tx.request()
        .input('ventaId', sql.Int, id)
        .query(`SELECT PRODUCTO_ID, CANTIDAD, DEPOSITO_ID FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);

      for (const item of items.recordset) {
        await restaurarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID);
      }

      // ── 2. Remove CAJA_ITEMS ──
      await tx.request().input('origenId', sql.Int, id)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'VENTA'`);

      // ── 3. Remove CTA_CORRIENTE records (both VENTA and PAGO entries) ──
      if (venta.ES_CTA_CORRIENTE) {
        await tx.request().input('comprobanteId', sql.Int, id)
          .query(`DELETE FROM VENTAS_CTA_CORRIENTE WHERE COMPROBANTE_ID = @comprobanteId`);
      }

      // ── 4. Delete items then sale ──
      await tx.request().input('ventaId', sql.Int, id)
        .query(`DELETE FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);
      await tx.request().input('id', sql.Int, id)
        .query(`DELETE FROM VENTAS WHERE VENTA_ID = @id`);

      // ── 5. AUDITORIA ──
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      await registrarAuditoria(
        tx, 'VENTA', id, 'ELIMINACION', usuarioId,
        venta.PUNTO_VENTA_ID, caja?.CAJA_ID || null,
        venta.TOTAL, `Venta #${id} eliminada`
      );

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Mark as paid (total or partial) ────────────
  async markAsPaid(id: number, payment: PaymentInput, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, TOTAL, COBRADA, MONTO_EFECTIVO, MONTO_DIGITAL,
                       ES_CTA_CORRIENTE, CLIENTE_ID, PUNTO_VENTA_ID
                FROM VENTAS WHERE VENTA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
      }

      const venta = existing.recordset[0];
      const prevEfectivo = venta.MONTO_EFECTIVO || 0;
      const prevDigital = venta.MONTO_DIGITAL || 0;
      const newEfectivo = prevEfectivo + payment.MONTO_EFECTIVO;
      const newDigital = prevDigital + payment.MONTO_DIGITAL;
      const totalPaidNow = newEfectivo + newDigital;
      const cobrada = !payment.parcial && (totalPaidNow >= venta.TOTAL);

      // ── 1. Update VENTAS ──
      await tx.request()
        .input('id', sql.Int, id)
        .input('montoEfectivo', sql.Decimal(18, 2), newEfectivo)
        .input('montoDigital', sql.Decimal(18, 2), newDigital)
        .input('vuelto', sql.Decimal(18, 2), payment.VUELTO)
        .input('cobrada', sql.Bit, cobrada ? 1 : 0)
        .query(`
          UPDATE VENTAS SET 
            MONTO_EFECTIVO=@montoEfectivo, MONTO_DIGITAL=@montoDigital,
            VUELTO=@vuelto, COBRADA=@cobrada
          WHERE VENTA_ID = @id
        `);

      // ── 2. CAJA_ITEMS ──
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      if (caja) {
        const efectivoNeto = Math.max(0, payment.MONTO_EFECTIVO - payment.VUELTO);
        if (efectivoNeto > 0 || payment.MONTO_DIGITAL > 0) {
          await tx.request()
            .input('cajaId', sql.Int, caja.CAJA_ID)
            .input('origenTipo', sql.VarChar(30), 'VENTA')
            .input('origenId', sql.Int, id)
            .input('efectivo', sql.Decimal(18, 2), efectivoNeto)
            .input('digital', sql.Decimal(18, 2), payment.MONTO_DIGITAL)
            .input('desc', sql.NVarChar(255), `Cobro Venta #${id}`)
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
                MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @origenId,
                @efectivo, @digital, @desc, @uid)
            `);
        }
      }

      // ── 3. CTA_CORRIENTE: record payment as HABER ──
      if (venta.ES_CTA_CORRIENTE) {
        const ctaCteResult = await tx.request()
          .input('cid', sql.Int, venta.CLIENTE_ID)
          .query(`SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @cid`);

        if (ctaCteResult.recordset.length > 0) {
          const ctaCteId = ctaCteResult.recordset[0].CTA_CORRIENTE_ID;
          const totalPayment = r2(payment.MONTO_EFECTIVO + payment.MONTO_DIGITAL - payment.VUELTO);
          await tx.request()
            .input('comprobanteId', sql.Int, id)
            .input('ctaCteId', sql.Int, ctaCteId)
            .input('concepto', sql.NVarChar(255), `Pago Venta #${id}`)
            .input('tipoComp', sql.NVarChar(50), 'PAGO')
            .input('haber', sql.Decimal(18, 2), totalPayment)
            .query(`
              INSERT INTO VENTAS_CTA_CORRIENTE
                (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
              VALUES
                (@comprobanteId, @ctaCteId, GETDATE(), @concepto, @tipoComp, 0, @haber)
            `);
        }
      }

      // ── 4. AUDITORIA ──
      await registrarAuditoria(
        tx, 'VENTA', id, 'COBRO', usuarioId,
        venta.PUNTO_VENTA_ID, caja?.CAJA_ID || null,
        r2(payment.MONTO_EFECTIVO + payment.MONTO_DIGITAL),
        `Cobro Venta #${id}`
      );

      await tx.commit();
      return { ok: true, cobrada };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Remove payment ─────────────────────────────
  async removePaid(id: number, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, TOTAL, COBRADA, ES_CTA_CORRIENTE, CLIENTE_ID,
                       PUNTO_VENTA_ID, MONTO_EFECTIVO, MONTO_DIGITAL
                FROM VENTAS WHERE VENTA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
      }

      const venta = existing.recordset[0];
      const oldMonto = (venta.MONTO_EFECTIVO || 0) + (venta.MONTO_DIGITAL || 0);

      // ── 1. Reset payment on VENTAS ──
      await tx.request()
        .input('id', sql.Int, id)
        .query(`UPDATE VENTAS SET MONTO_EFECTIVO=0, MONTO_DIGITAL=0, VUELTO=0, COBRADA=0
                WHERE VENTA_ID = @id`);

      // ── 2. Remove CAJA_ITEMS for this sale ──
      await tx.request().input('origenId', sql.Int, id)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'VENTA'`);

      // ── 3. Remove CTA_CORRIENTE payment records ──
      if (venta.ES_CTA_CORRIENTE) {
        await tx.request().input('comprobanteId', sql.Int, id)
          .query(`DELETE FROM VENTAS_CTA_CORRIENTE
                  WHERE COMPROBANTE_ID = @comprobanteId AND TIPO_COMPROBANTE = 'PAGO'`);
      }

      // ── 4. AUDITORIA ──
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      await registrarAuditoria(
        tx, 'VENTA', id, 'DESCOBRO', usuarioId,
        venta.PUNTO_VENTA_ID, caja?.CAJA_ID || null,
        oldMonto, `Descobro Venta #${id}`
      );

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Search products for sale form ──────────────
  async searchProducts(search: string, listaId: number = 0, limit: number = 20) {
    const pool = await getPool();

    // If listaId is explicitly provided (>0), use that fixed list.
    // Otherwise (0), use each product's LISTA_DEFECTO.
    const precioExpr = listaId > 0
      ? `p.LISTA_${Math.max(1, Math.min(5, listaId))}`
      : `CASE ISNULL(p.LISTA_DEFECTO, 1)
           WHEN 1 THEN p.LISTA_1
           WHEN 2 THEN p.LISTA_2
           WHEN 3 THEN p.LISTA_3
           WHEN 4 THEN p.LISTA_4
           WHEN 5 THEN p.LISTA_5
           ELSE p.LISTA_1
         END`;

    const result = await pool.request()
      .input('search', sql.NVarChar, `%${search}%`)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT DISTINCT TOP (@limit)
          p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, 
          ${precioExpr} AS PRECIO_VENTA,
          ISNULL(p.LISTA_DEFECTO, 1) AS LISTA_DEFECTO,
          p.PRECIO_COMPRA, p.CANTIDAD AS STOCK,
          p.ES_CONJUNTO, p.DESCUENTA_STOCK, p.ACTIVO,
          p.IMP_INT, p.TASA_IVA_ID, p.UNIDAD_ID,
          ISNULL(u.NOMBRE, '') AS UNIDAD_NOMBRE,
          ISNULL(u.ABREVIACION, '') AS UNIDAD_ABREVIACION,
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

  // ── Clients for sale form ──────────────────────
  async getClientes() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CLIENTE_ID, CODIGOPARTICULAR, NOMBRE, CONDICION_IVA, 
             CTA_CORRIENTE, TIPO_DOCUMENTO, NUMERO_DOC
      FROM CLIENTES WHERE ACTIVO = 1 ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Depositos for sale form ────────────────────
  async getDepositos() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT DEPOSITO_ID, CODIGOPARTICULAR, NOMBRE FROM DEPOSITOS ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Depositos linked to a punto de venta ───────
  async getDepositosPuntoVenta(puntoVentaId: number) {
    const pool = await getPool();
    const result = await pool.request()
      .input('pvId', sql.Int, puntoVentaId)
      .query(`
        SELECT d.DEPOSITO_ID, d.CODIGOPARTICULAR, d.NOMBRE, pvd.ES_PREFERIDO
        FROM PUNTOS_VENTA_DEPOSITOS pvd
        JOIN DEPOSITOS d ON pvd.DEPOSITO_ID = d.DEPOSITO_ID
        WHERE pvd.PUNTO_VENTA_ID = @pvId
        ORDER BY pvd.ES_PREFERIDO DESC, d.NOMBRE
      `);
    return result.recordset;
  },

  // ── Empresa IVA condition ──────────────────────
  async getEmpresaIva() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CONDICION_IVA FROM EMPRESA_CLIENTE
    `);
    return result.recordset.length > 0
      ? { CONDICION_IVA: result.recordset[0].CONDICION_IVA }
      : { CONDICION_IVA: null };
  },

  // ── Empresa info (for receipts) ────────────────
  async getEmpresaInfo() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT RAZON_SOCIAL, DOMICILIO_FISCAL, CONDICION_IVA, CUIT
      FROM EMPRESA_CLIENTE
    `);
    const row = result.recordset[0] || {};
    return {
      NOMBRE_FANTASIA: config.app.nombreFantasia || row.RAZON_SOCIAL || '',
      RAZON_SOCIAL: row.RAZON_SOCIAL || '',
      DOMICILIO_FISCAL: row.DOMICILIO_FISCAL || '',
      CONDICION_IVA: row.CONDICION_IVA || '',
      CUIT: row.CUIT || '',
      TELEFONO_CLIENTE: config.app.telefonoCliente || '',
    };
  },

  // ── Send WhatsApp message ──────────────────────
  async sendWhatsApp(telefono: string, mensaje: string) {
    const ipWsp = config.integrations.ipWsp;
    if (!ipWsp) {
      throw Object.assign(new Error('WhatsApp no configurado (ipWsp)'), { name: 'ValidationError' });
    }

    const url = `${ipWsp}/send-message`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: telefono, mensaje }),
    });

    if (!response.ok) {
      throw new Error(`Error al enviar WhatsApp: ${response.status}`);
    }

    return { success: true };
  },

  // ── Build WhatsApp sale detail message ─────────
  async buildWhatsAppMessage(ventaId: number) {
    const venta = await this.getById(ventaId);
    const empresa = await this.getEmpresaInfo();

    let msg = `*-------- ${empresa.NOMBRE_FANTASIA.toUpperCase()} --------*\n`;
    msg += `🗣️ \`\`\`Su compra.\`\`\`\n\n`;
    msg += `Estimado/a *${venta.CLIENTE_NOMBRE || 'Cliente'}*\n\n`;
    msg += `Le enviamos el detalle de su compra:\n\n`;

    for (const item of venta.items) {
      const unidad = (item as any).UNIDAD_ABREVIACION || 'u';
      const qtyStr = formatQtyWsp(item.CANTIDAD, unidad);
      const total = item.DESCUENTO > 0
        ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100) * item.CANTIDAD
        : item.PRECIO_UNITARIO * item.CANTIDAD;
      msg += `- _x ${qtyStr}_ *${item.PRODUCTO_NOMBRE}*   _total_ = _$${fmtDecimal(total)}_\n`;
    }

    msg += `\n- *TOTAL* = *$${fmtDecimal(venta.TOTAL)}*.\n\n`;
    msg += `Gracias por su compra.🫱🏻‍🫲🏼\n\n`;
    msg += `_Enviado desde *Río Gestión* Software_.`;

    return msg;
  },

  // ── Send sale detail notifications ─────────────
  async sendSaleWhatsApp(ventaId: number, telefonoCliente: string, nombreCliente: string) {
    const msg = await this.buildWhatsAppMessage(ventaId);

    // Normalize phone: ensure 549 prefix
    let phone = telefonoCliente.replace(/\D/g, '');
    if (phone.length === 10) phone = `549${phone}`;
    else if (phone.length === 12 && phone.startsWith('54')) phone = `549${phone.slice(2)}`;

    // 1. Send to customer
    await this.sendWhatsApp(phone, msg);

    // 2. Send notification to business owner
    const ownerPhone = config.app.telefonoCliente;
    if (ownerPhone) {
      let ownerNum = ownerPhone.replace(/\D/g, '');
      if (ownerNum.length === 10) ownerNum = `549${ownerNum}`;

      const ownerMsg = `*-------- RÍO GESTIÓN --------*\n` +
        `🗣️ \`\`\`Cliente notificado.\`\`\`\n\n` +
        `Se ha enviado el detalle de la venta a:\n` +
        `- Nombre: *${nombreCliente}* .\n` +
        `- Cel: *${telefonoCliente}* .\n\n` +
        `_Gestionamos con vos, crecemos juntos_.🫱🏻‍🫲🏼`;

      try {
        await this.sendWhatsApp(ownerNum, ownerMsg);
      } catch { /* don't fail main flow if owner notification fails */ }
    }

    // 3. Update venta record with send info
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, ventaId)
      .input('nombre', sql.NVarChar, nombreCliente)
      .input('nro', sql.NVarChar, telefonoCliente)
      .query(`
        UPDATE VENTAS
        SET NOMBRE_ENVIO_DETALLE = @nombre, NRO_ENVIO_DETALLE = @nro
        WHERE VENTA_ID = @id
      `);

    return { success: true };
  },
};

// ── WhatsApp formatting helpers ──────────────────
function formatQtyWsp(cantidad: number, unidad: string): string {
  const u = (unidad || 'u').toLowerCase();
  if (u === 'kg') return `${cantidad.toFixed(3)} Kg`;
  if (u === 'lts' || u === 'lt') return `${cantidad.toFixed(2)} lts`;
  return `${cantidad.toFixed(2)} u`;
}

function fmtDecimal(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
