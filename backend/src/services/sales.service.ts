import { getPool, sql } from '../database/connection.js';
import type { Venta, VentaItem, PaginatedResult } from '../types/index.js';

export interface VentaFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  clienteId?: number;
  puntoVentaId?: number;
}

export const salesService = {
  async getAll(filter: VentaFilter = {}): Promise<PaginatedResult<Venta>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.fechaDesde) {
      where += ' AND v.FECHA_VENTA >= @fechaDesde';
      countReq.input('fechaDesde', sql.DateTime, new Date(filter.fechaDesde));
      dataReq.input('fechaDesde', sql.DateTime, new Date(filter.fechaDesde));
    }
    if (filter.fechaHasta) {
      where += ' AND v.FECHA_VENTA <= @fechaHasta';
      countReq.input('fechaHasta', sql.DateTime, new Date(filter.fechaHasta + 'T23:59:59'));
      dataReq.input('fechaHasta', sql.DateTime, new Date(filter.fechaHasta + 'T23:59:59'));
    }
    if (filter.clienteId) {
      where += ' AND v.CLIENTE_ID = @clienteId';
      countReq.input('clienteId', sql.Int, filter.clienteId);
      dataReq.input('clienteId', sql.Int, filter.clienteId);
    }
    if (filter.puntoVentaId) {
      where += ' AND v.PUNTO_VENTA_ID = @puntoVentaId';
      countReq.input('puntoVentaId', sql.Int, filter.puntoVentaId);
      dataReq.input('puntoVentaId', sql.Int, filter.puntoVentaId);
    }
    if (filter.search) {
      where += ' AND (c.NOMBRE LIKE @search OR v.NUMERO_FISCAL LIKE @search OR CAST(v.VENTA_ID AS VARCHAR) LIKE @search)';
      countReq.input('search', sql.NVarChar, `%${filter.search}%`);
      dataReq.input('search', sql.NVarChar, `%${filter.search}%`);
    }

    const countResult = await countReq.query(`
      SELECT COUNT(*) as total FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
      ${where}
    `);
    const total = countResult.recordset[0].total;

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query<Venta>(`
      SELECT 
        v.VENTA_ID, v.CLIENTE_ID, v.FECHA_VENTA, v.TOTAL, v.GANANCIAS,
        v.ES_CTA_CORRIENTE, v.MONTO_EFECTIVO, v.MONTO_DIGITAL, v.VUELTO,
        v.NUMERO_FISCAL, v.CAE, v.PUNTO_VENTA, v.TIPO_COMPROBANTE,
        v.COBRADA, v.PUNTO_VENTA_ID, v.USUARIO_ID,
        c.NOMBRE AS CLIENTE_NOMBRE,
        u.NOMBRE AS USUARIO_NOMBRE
      FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
      LEFT JOIN USUARIOS u ON v.USUARIO_ID = u.USUARIO_ID
      ${where}
      ORDER BY v.FECHA_VENTA DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  async getById(id: number): Promise<Venta & { items: VentaItem[] }> {
    const pool = await getPool();

    const ventaResult = await pool
      .request()
      .input('id', sql.Int, id)
      .query<Venta>(`
        SELECT v.*, c.NOMBRE AS CLIENTE_NOMBRE, u.NOMBRE AS USUARIO_NOMBRE
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
        SELECT vi.*, p.NOMBRE AS PRODUCTO_NOMBRE, p.CODIGOPARTICULAR AS PRODUCTO_CODIGO
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
};
