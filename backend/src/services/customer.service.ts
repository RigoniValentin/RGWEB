import { getPool, sql } from '../database/connection.js';
import type { Cliente, PaginatedResult } from '../types/index.js';

export interface ClienteFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  activo?: boolean;
}

export const customerService = {
  async getAll(filter: ClienteFilter = {}): Promise<PaginatedResult<Cliente>> {
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
      where += ' AND (NOMBRE LIKE @search OR CODIGOPARTICULAR LIKE @search OR NUMERO_DOC LIKE @search OR EMAIL LIKE @search)';
      countReq.input('search', sql.NVarChar, `%${filter.search}%`);
      dataReq.input('search', sql.NVarChar, `%${filter.search}%`);
    }

    const countResult = await countReq.query(`SELECT COUNT(*) as total FROM CLIENTES ${where}`);
    const total = countResult.recordset[0].total;

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query<Cliente>(`
      SELECT * FROM CLIENTES
      ${where}
      ORDER BY NOMBRE
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  async getById(id: number): Promise<Cliente> {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query<Cliente>('SELECT * FROM CLIENTES WHERE CLIENTE_ID = @id');

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Cliente no encontrado'), { name: 'ValidationError' });
    }
    return result.recordset[0];
  },

  async getCtaCorrienteSaldo(clienteId: number) {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, clienteId)
      .query(`
        SELECT 
          cc.CTA_CORRIENTE_ID,
          ISNULL(SUM(vcc.DEBE), 0) AS TOTAL_DEBE,
          ISNULL(SUM(vcc.HABER), 0) AS TOTAL_HABER,
          ISNULL(SUM(vcc.DEBE), 0) - ISNULL(SUM(vcc.HABER), 0) AS SALDO
        FROM CTA_CORRIENTE_C cc
        LEFT JOIN VENTAS_CTA_CORRIENTE vcc ON cc.CTA_CORRIENTE_ID = vcc.CTA_CORRIENTE_ID
        WHERE cc.CLIENTE_ID = @id
        GROUP BY cc.CTA_CORRIENTE_ID
      `);
    return result.recordset[0] || { SALDO: 0, TOTAL_DEBE: 0, TOTAL_HABER: 0 };
  },
};
