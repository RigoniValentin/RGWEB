import { getPool, sql } from '../database/connection.js';
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
      where += ' AND v.FECHA_VENTA >= @fechaDesde';
      params.push({ name: 'fechaDesde', type: sql.DateTime, value: new Date(filter.fechaDesde) });
    }
    if (filter.fechaHasta) {
      where += ' AND v.FECHA_VENTA <= @fechaHasta';
      params.push({ name: 'fechaHasta', type: sql.DateTime, value: new Date(filter.fechaHasta + 'T23:59:59') });
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

    const dataResult = await dataReq.query<Venta>(`
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
               p.NOMBRE AS PRODUCTO_NOMBRE, 
               p.CODIGOPARTICULAR AS PRODUCTO_CODIGO
        FROM VENTAS_ITEMS vi
        JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
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
      // Calculate totals from items
      let subtotal = 0;
      let ganancias = 0;
      let ivaTotal = 0;
      let impuestoInternoTotal = 0;
      let bonificaciones = 0;
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

        ivaTotal += (item.IVA_MONTO || 0) * item.CANTIDAD;
        impuestoInternoTotal += (item.IMPUESTO_INTERNO_MONTO || 0) * item.CANTIDAD;
      }

      // Apply general discount
      let total = subtotal;
      if (dtoGral > 0) {
        const montoDescuento = subtotal * (dtoGral / 100);
        total = subtotal - montoDescuento;
        ganancias -= montoDescuento;
        bonificaciones += montoDescuento;
      }

      const cobrada = input.COBRADA !== undefined ? input.COBRADA : true;
      const montoEfectivo = input.MONTO_EFECTIVO || 0;
      const montoDigital = input.MONTO_DIGITAL || 0;
      const vuelto = input.VUELTO || 0;

      // Insert into VENTAS
      const ventaResult = await tx.request()
        .input('clienteId', sql.Int, input.CLIENTE_ID)
        .input('fechaVenta', sql.DateTime, input.FECHA_VENTA ? new Date(input.FECHA_VENTA) : new Date())
        .input('total', sql.Decimal(18, 2), Math.round(total * 100) / 100)
        .input('ganancias', sql.Decimal(18, 2), Math.round(ganancias * 100) / 100)
        .input('esCtaCorriente', sql.Bit, input.ES_CTA_CORRIENTE ? 1 : 0)
        .input('montoEfectivo', sql.Decimal(18, 2), montoEfectivo)
        .input('montoDigital', sql.Decimal(18, 2), montoDigital)
        .input('vuelto', sql.Decimal(18, 2), vuelto)
        .input('tipoComprobante', sql.NVarChar, input.TIPO_COMPROBANTE || null)
        .input('cobrada', sql.Bit, cobrada ? 1 : 0)
        .input('puntoVentaId', sql.Int, input.PUNTO_VENTA_ID)
        .input('usuarioId', sql.Int, usuarioId)
        .input('dtoGral', sql.Decimal(18, 2), dtoGral)
        .input('subtotal', sql.Decimal(18, 2), Math.round(subtotal * 100) / 100)
        .input('bonificaciones', sql.Decimal(18, 2), Math.round(bonificaciones * 100) / 100)
        .input('impuestoInterno', sql.Decimal(18, 2), Math.round(impuestoInternoTotal * 100) / 100)
        .input('ivaTotal', sql.Decimal(18, 2), Math.round(ivaTotal * 100) / 100)
        .input('montoAnticipo', sql.Decimal(18, 2), 0)
        .query(`
          INSERT INTO VENTAS (
            CLIENTE_ID, FECHA_VENTA, TOTAL, GANANCIAS, ES_CTA_CORRIENTE,
            MONTO_EFECTIVO, MONTO_DIGITAL, VUELTO, TIPO_COMPROBANTE,
            COBRADA, PUNTO_VENTA_ID, USUARIO_ID, DTO_GRAL,
            SUBTOTAL, BONIFICACIONES, IMPUESTO_INTERNO, IVA_TOTAL, MONTO_ANTICIPO
          ) VALUES (
            @clienteId, @fechaVenta, @total, @ganancias, @esCtaCorriente,
            @montoEfectivo, @montoDigital, @vuelto, @tipoComprobante,
            @cobrada, @puntoVentaId, @usuarioId, @dtoGral,
            @subtotal, @bonificaciones, @impuestoInterno, @ivaTotal, @montoAnticipo
          );
          SELECT SCOPE_IDENTITY() AS VENTA_ID;
        `);

      const ventaId = ventaResult.recordset[0].VENTA_ID;

      // Insert items
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
          .query(`
            INSERT INTO VENTAS_ITEMS (
              VENTA_ID, PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, PRECIO_UNITARIO_DTO,
              DESCUENTO, PROMOCION_ID, CANTIDAD_PROMO, PRECIO_PROMOCION,
              PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID,
              IMPUESTO_INTERNO_PORCENTAJE, IMPUESTO_INTERNO_MONTO, IMPUESTO_INTERNO_TIPO,
              IVA_ALICUOTA, IVA_MONTO
            ) VALUES (
              @ventaId, @productoId, @precioUnitario, @cantidad, @precioUnitarioDto,
              @descuento, @promocionId, @cantidadPromo, @precioPromocion,
              @precioCompra, @depositoId, @listaId,
              @impIntPorcentaje, @impIntMonto, @impIntTipo,
              @ivaAlicuota, @ivaMonto
            )
          `);

        // Update stock (decrease)
        if (item.DEPOSITO_ID) {
          await tx.request()
            .input('prodId', sql.Int, item.PRODUCTO_ID)
            .input('depId', sql.Int, item.DEPOSITO_ID)
            .input('cant', sql.Decimal(18, 4), item.CANTIDAD)
            .query(`
              UPDATE STOCK_DEPOSITOS 
              SET CANTIDAD = CANTIDAD - @cant 
              WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId
            `);
        }

        // Update total stock on product
        await tx.request()
          .input('prodId', sql.Int, item.PRODUCTO_ID)
          .input('cant', sql.Decimal(18, 4), item.CANTIDAD)
          .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
      }

      // If cuenta corriente and not paid, update balance
      if (input.ES_CTA_CORRIENTE && !cobrada) {
        await tx.request()
          .input('clienteId', sql.Int, input.CLIENTE_ID)
          .input('monto', sql.Decimal(18, 2), Math.round(total * 100) / 100)
          .query(`
            IF EXISTS (SELECT 1 FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @clienteId)
              UPDATE CTA_CORRIENTE_C SET SALDO = SALDO + @monto WHERE CLIENTE_ID = @clienteId
          `);
      }

      await tx.commit();
      return { VENTA_ID: ventaId, TOTAL: Math.round(total * 100) / 100 };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update sale ────────────────────────────────
  async update(id: number, input: VentaInput) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Check sale exists and is not invoiced
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, NUMERO_FISCAL, COBRADA FROM VENTAS WHERE VENTA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
      }
      if (existing.recordset[0].NUMERO_FISCAL) {
        throw Object.assign(new Error('No se puede modificar una venta con número fiscal emitido'), { name: 'ValidationError' });
      }

      // Restore stock from old items
      const oldItems = await tx.request()
        .input('ventaId', sql.Int, id)
        .query(`SELECT PRODUCTO_ID, CANTIDAD, DEPOSITO_ID FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);

      for (const oldItem of oldItems.recordset) {
        if (oldItem.DEPOSITO_ID) {
          await tx.request()
            .input('prodId', sql.Int, oldItem.PRODUCTO_ID)
            .input('depId', sql.Int, oldItem.DEPOSITO_ID)
            .input('cant', sql.Decimal(18, 4), oldItem.CANTIDAD)
            .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
        }
        await tx.request()
          .input('prodId', sql.Int, oldItem.PRODUCTO_ID)
          .input('cant', sql.Decimal(18, 4), oldItem.CANTIDAD)
          .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
      }

      // Delete old items
      await tx.request().input('ventaId', sql.Int, id)
        .query(`DELETE FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);

      // Calculate new totals
      let subtotal = 0;
      let ganancias = 0;
      let bonificaciones = 0;
      const dtoGral = input.DTO_GRAL || 0;

      for (const item of input.items) {
        const precioConDto = item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO;
        subtotal += precioConDto * item.CANTIDAD;
        ganancias += (precioConDto - (item.PRECIO_COMPRA || 0)) * item.CANTIDAD;
        if (item.DESCUENTO > 0) {
          bonificaciones += (item.PRECIO_UNITARIO - precioConDto) * item.CANTIDAD;
        }
      }

      let total = subtotal;
      if (dtoGral > 0) {
        const montoDescuento = subtotal * (dtoGral / 100);
        total -= montoDescuento;
        ganancias -= montoDescuento;
        bonificaciones += montoDescuento;
      }

      const cobrada = input.COBRADA !== undefined ? input.COBRADA : existing.recordset[0].COBRADA;

      // Update VENTAS
      await tx.request()
        .input('id', sql.Int, id)
        .input('clienteId', sql.Int, input.CLIENTE_ID)
        .input('fechaVenta', sql.DateTime, input.FECHA_VENTA ? new Date(input.FECHA_VENTA) : new Date())
        .input('total', sql.Decimal(18, 2), Math.round(total * 100) / 100)
        .input('ganancias', sql.Decimal(18, 2), Math.round(ganancias * 100) / 100)
        .input('esCtaCorriente', sql.Bit, input.ES_CTA_CORRIENTE ? 1 : 0)
        .input('montoEfectivo', sql.Decimal(18, 2), input.MONTO_EFECTIVO || 0)
        .input('montoDigital', sql.Decimal(18, 2), input.MONTO_DIGITAL || 0)
        .input('vuelto', sql.Decimal(18, 2), input.VUELTO || 0)
        .input('tipoComprobante', sql.NVarChar, input.TIPO_COMPROBANTE || null)
        .input('cobrada', sql.Bit, cobrada ? 1 : 0)
        .input('dtoGral', sql.Decimal(18, 2), dtoGral)
        .input('subtotal', sql.Decimal(18, 2), Math.round(subtotal * 100) / 100)
        .input('bonificaciones', sql.Decimal(18, 2), Math.round(bonificaciones * 100) / 100)
        .query(`
          UPDATE VENTAS SET
            CLIENTE_ID=@clienteId, FECHA_VENTA=@fechaVenta, TOTAL=@total,
            GANANCIAS=@ganancias, ES_CTA_CORRIENTE=@esCtaCorriente,
            MONTO_EFECTIVO=@montoEfectivo, MONTO_DIGITAL=@montoDigital, VUELTO=@vuelto,
            TIPO_COMPROBANTE=@tipoComprobante, COBRADA=@cobrada, DTO_GRAL=@dtoGral,
            SUBTOTAL=@subtotal, BONIFICACIONES=@bonificaciones
          WHERE VENTA_ID = @id
        `);

      // Insert new items and decrease stock
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
          .input('precioCompra', sql.Decimal(18, 4), item.PRECIO_COMPRA || 0)
          .input('depositoId', sql.Int, item.DEPOSITO_ID || null)
          .input('listaId', sql.Int, item.LISTA_ID || 1)
          .query(`
            INSERT INTO VENTAS_ITEMS (
              VENTA_ID, PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, PRECIO_UNITARIO_DTO,
              DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID
            ) VALUES (
              @ventaId, @productoId, @precioUnitario, @cantidad, @precioUnitarioDto,
              @descuento, @precioCompra, @depositoId, @listaId
            )
          `);

        if (item.DEPOSITO_ID) {
          await tx.request()
            .input('prodId', sql.Int, item.PRODUCTO_ID)
            .input('depId', sql.Int, item.DEPOSITO_ID)
            .input('cant', sql.Decimal(18, 4), item.CANTIDAD)
            .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
        }
        await tx.request()
          .input('prodId', sql.Int, item.PRODUCTO_ID)
          .input('cant', sql.Decimal(18, 4), item.CANTIDAD)
          .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
      }

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete sale ────────────────────────────────
  async delete(id: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, NUMERO_FISCAL, ES_CTA_CORRIENTE, CLIENTE_ID, TOTAL, COBRADA 
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

      // Restore stock from items
      const items = await tx.request()
        .input('ventaId', sql.Int, id)
        .query(`SELECT PRODUCTO_ID, CANTIDAD, DEPOSITO_ID FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);

      for (const item of items.recordset) {
        if (item.DEPOSITO_ID) {
          await tx.request()
            .input('prodId', sql.Int, item.PRODUCTO_ID)
            .input('depId', sql.Int, item.DEPOSITO_ID)
            .input('cant', sql.Decimal(18, 4), item.CANTIDAD)
            .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
        }
        await tx.request()
          .input('prodId', sql.Int, item.PRODUCTO_ID)
          .input('cant', sql.Decimal(18, 4), item.CANTIDAD)
          .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
      }

      // If cuenta corriente, reverse balance
      if (venta.ES_CTA_CORRIENTE && !venta.COBRADA) {
        await tx.request()
          .input('clienteId', sql.Int, venta.CLIENTE_ID)
          .input('monto', sql.Decimal(18, 2), venta.TOTAL)
          .query(`
            IF EXISTS (SELECT 1 FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @clienteId)
              UPDATE CTA_CORRIENTE_C SET SALDO = SALDO - @monto WHERE CLIENTE_ID = @clienteId
          `);
      }

      // Delete items then sale
      await tx.request().input('ventaId', sql.Int, id)
        .query(`DELETE FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);
      await tx.request().input('id', sql.Int, id)
        .query(`DELETE FROM VENTAS WHERE VENTA_ID = @id`);

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Mark as paid (total or partial) ────────────
  async markAsPaid(id: number, payment: PaymentInput) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, TOTAL, COBRADA, MONTO_EFECTIVO, MONTO_DIGITAL, 
                       ES_CTA_CORRIENTE, CLIENTE_ID FROM VENTAS WHERE VENTA_ID = @id`);

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

      // If cta corriente and now fully paid, reduce balance
      if (cobrada && venta.ES_CTA_CORRIENTE) {
        await tx.request()
          .input('clienteId', sql.Int, venta.CLIENTE_ID)
          .input('monto', sql.Decimal(18, 2), venta.TOTAL)
          .query(`
            IF EXISTS (SELECT 1 FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @clienteId)
              UPDATE CTA_CORRIENTE_C SET SALDO = SALDO - @monto WHERE CLIENTE_ID = @clienteId
          `);
      }

      await tx.commit();
      return { ok: true, cobrada };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Remove payment ─────────────────────────────
  async removePaid(id: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, TOTAL, COBRADA, ES_CTA_CORRIENTE, CLIENTE_ID FROM VENTAS WHERE VENTA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
      }

      const venta = existing.recordset[0];

      await tx.request()
        .input('id', sql.Int, id)
        .query(`UPDATE VENTAS SET MONTO_EFECTIVO=0, MONTO_DIGITAL=0, VUELTO=0, COBRADA=0 WHERE VENTA_ID = @id`);

      // If was paid and cta corriente, restore balance
      if (venta.COBRADA && venta.ES_CTA_CORRIENTE) {
        await tx.request()
          .input('clienteId', sql.Int, venta.CLIENTE_ID)
          .input('monto', sql.Decimal(18, 2), venta.TOTAL)
          .query(`
            IF EXISTS (SELECT 1 FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @clienteId)
              UPDATE CTA_CORRIENTE_C SET SALDO = SALDO + @monto WHERE CLIENTE_ID = @clienteId
          `);
      }

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Search products for sale form ──────────────
  async searchProducts(search: string, listaId: number = 1, limit: number = 20) {
    const pool = await getPool();
    const listaCol = `LISTA_${Math.max(1, Math.min(5, listaId))}`;

    const result = await pool.request()
      .input('search', sql.NVarChar, `%${search}%`)
      .input('limit', sql.Int, limit)
      .query(`
        SELECT DISTINCT TOP (@limit)
          p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, 
          p.${listaCol} AS PRECIO_VENTA,
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
};
