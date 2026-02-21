import { getPool, sql } from '../database/connection.js';
import type { Proveedor, PaginatedResult } from '../types/index.js';

export interface ProveedorFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  activo?: boolean;
}

export const supplierService = {
  async getAll(filter: ProveedorFilter = {}): Promise<PaginatedResult<Proveedor>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.activo !== undefined) {
      where += ' AND ACTIVO = @activo';
      countReq.input('activo', sql.Bit, filter.activo ? 1 : 0);
      dataReq.input('activo', sql.Bit, filter.activo ? 1 : 0);
    }
    if (filter.search) {
      where += ' AND (NOMBRE LIKE @search OR CODIGOPARTICULAR LIKE @search OR NUMERO_DOC LIKE @search)';
      countReq.input('search', sql.NVarChar, `%${filter.search}%`);
      dataReq.input('search', sql.NVarChar, `%${filter.search}%`);
    }

    const countResult = await countReq.query(`SELECT COUNT(*) as total FROM PROVEEDORES ${where}`);
    const total = countResult.recordset[0].total;

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query<Proveedor>(`
      SELECT * FROM PROVEEDORES
      ${where}
      ORDER BY NOMBRE
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  async getById(id: number): Promise<Proveedor> {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query<Proveedor>('SELECT * FROM PROVEEDORES WHERE PROVEEDOR_ID = @id');

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Proveedor no encontrado'), { name: 'ValidationError' });
    }
    return result.recordset[0];
  },
};
