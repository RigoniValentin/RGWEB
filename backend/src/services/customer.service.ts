import { getPool, sql } from '../database/connection.js';
import type { Cliente, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Customer Service — Full CRUD
// ═══════════════════════════════════════════════════

export interface ClienteFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  activo?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface ClienteInput {
  CODIGOPARTICULAR?: string;
  NOMBRE: string;
  DOMICILIO?: string | null;
  CIUDAD?: string | null;
  CP?: string | null;
  PROVINCIA?: string | null;
  TELEFONO?: string | null;
  EMAIL?: string | null;
  TIPO_DOCUMENTO?: string;
  NUMERO_DOC?: string;
  CONDICION_IVA?: string | null;
  RUBRO?: string | null;
  FECHA_NACIMIENTO?: string | null;
  CTA_CORRIENTE?: boolean;
  ACTIVO?: boolean;
}

export const customerService = {
  // ── List with pagination & filters ─────────────
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
      where += ' AND (NOMBRE LIKE @search OR CODIGOPARTICULAR LIKE @search OR NUMERO_DOC LIKE @search OR EMAIL LIKE @search OR TELEFONO LIKE @search)';
      countReq.input('search', sql.NVarChar, `%${filter.search}%`);
      dataReq.input('search', sql.NVarChar, `%${filter.search}%`);
    }

    const countResult = await countReq.query(`SELECT COUNT(*) as total FROM CLIENTES ${where}`);
    const total = countResult.recordset[0].total;

    // Sorting
    const validCols: Record<string, string> = {
      NOMBRE: 'NOMBRE',
      CODIGOPARTICULAR: 'CODIGOPARTICULAR',
      PROVINCIA: 'PROVINCIA',
      CONDICION_IVA: 'CONDICION_IVA',
      NUMERO_DOC: 'NUMERO_DOC',
    };
    const orderCol = validCols[filter.orderBy || 'NOMBRE'] || 'NOMBRE';
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query<Cliente>(`
      SELECT * FROM CLIENTES
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  // ── Get by ID ──────────────────────────────────
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

  // ── Create ─────────────────────────────────────
  async create(input: ClienteInput) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Get next ID with exclusive lock to prevent race conditions
      const maxResult = await tx.request().query(
        `SELECT ISNULL(MAX(CLIENTE_ID), 0) + 1 AS nextId FROM CLIENTES WITH (TABLOCKX, HOLDLOCK)`
      );
      const nextId = maxResult.recordset[0].nextId;

      // Check duplicate code
      if (input.CODIGOPARTICULAR) {
        const dup = await tx.request()
          .input('code', sql.NVarChar, input.CODIGOPARTICULAR)
          .query(`SELECT 1 FROM CLIENTES WHERE CODIGOPARTICULAR = @code`);
        if (dup.recordset.length > 0) {
          throw Object.assign(new Error('El código ya existe'), { name: 'ValidationError' });
        }
      }

      const code = input.CODIGOPARTICULAR || String(nextId);

      await tx.request()
        .input('id', sql.Int, nextId)
        .input('codigo', sql.NVarChar, code)
        .input('nombre', sql.NVarChar, input.NOMBRE)
        .input('domicilio', sql.NVarChar, input.DOMICILIO || null)
        .input('ciudad', sql.NVarChar, input.CIUDAD || null)
        .input('cp', sql.NVarChar, input.CP || null)
        .input('provincia', sql.NVarChar, input.PROVINCIA || null)
        .input('telefono', sql.NVarChar, input.TELEFONO || null)
        .input('email', sql.NVarChar, input.EMAIL || null)
        .input('tipoDoc', sql.NVarChar, input.TIPO_DOCUMENTO || 'DNI')
        .input('numDoc', sql.NVarChar, input.NUMERO_DOC || '')
        .input('condIva', sql.NVarChar, input.CONDICION_IVA || null)
        .input('rubro', sql.NVarChar, input.RUBRO || null)
        .input('fechaNac', sql.Date, input.FECHA_NACIMIENTO || null)
        .input('ctaCte', sql.Bit, input.CTA_CORRIENTE ? 1 : 0)
        .input('activo', sql.Bit, input.ACTIVO !== false ? 1 : 0)
        .query(`
          INSERT INTO CLIENTES (CLIENTE_ID, CODIGOPARTICULAR, NOMBRE, DOMICILIO, CIUDAD, CP,
            PROVINCIA, TELEFONO, EMAIL, TIPO_DOCUMENTO, NUMERO_DOC, CONDICION_IVA,
            RUBRO, FECHA_NACIMIENTO, CTA_CORRIENTE, ACTIVO)
          VALUES (@id, @codigo, @nombre, @domicilio, @ciudad, @cp,
            @provincia, @telefono, @email, @tipoDoc, @numDoc, @condIva,
            @rubro, @fechaNac, @ctaCte, @activo)
        `);

      await tx.commit();
      return { CLIENTE_ID: nextId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update ─────────────────────────────────────
  async update(id: number, input: ClienteInput) {
    const pool = await getPool();

    // Prevent editing CONSUMIDOR FINAL (ID 1)
    if (id === 1) {
      throw Object.assign(new Error('No se puede modificar el cliente CONSUMIDOR FINAL'), { name: 'ValidationError' });
    }

    // Validate required fields
    if (!input.CODIGOPARTICULAR?.trim()) {
      throw Object.assign(new Error('El código es obligatorio'), { name: 'ValidationError' });
    }

    // Check duplicate code
    if (input.CODIGOPARTICULAR) {
      const dup = await pool.request()
        .input('code', sql.NVarChar, input.CODIGOPARTICULAR)
        .input('id', sql.Int, id)
        .query(`SELECT 1 FROM CLIENTES WHERE CODIGOPARTICULAR = @code AND CLIENTE_ID != @id`);
      if (dup.recordset.length > 0) {
        throw Object.assign(new Error('El código ya existe'), { name: 'ValidationError' });
      }
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('codigo', sql.NVarChar, input.CODIGOPARTICULAR || '')
      .input('nombre', sql.NVarChar, input.NOMBRE)
      .input('domicilio', sql.NVarChar, input.DOMICILIO || null)
      .input('ciudad', sql.NVarChar, input.CIUDAD || null)
      .input('cp', sql.NVarChar, input.CP || null)
      .input('provincia', sql.NVarChar, input.PROVINCIA || null)
      .input('telefono', sql.NVarChar, input.TELEFONO || null)
      .input('email', sql.NVarChar, input.EMAIL || null)
      .input('tipoDoc', sql.NVarChar, input.TIPO_DOCUMENTO || 'DNI')
      .input('numDoc', sql.NVarChar, input.NUMERO_DOC || '')
      .input('condIva', sql.NVarChar, input.CONDICION_IVA || null)
      .input('rubro', sql.NVarChar, input.RUBRO || null)
      .input('fechaNac', sql.Date, input.FECHA_NACIMIENTO || null)
      .input('ctaCte', sql.Bit, input.CTA_CORRIENTE ? 1 : 0)
      .input('activo', sql.Bit, input.ACTIVO !== false ? 1 : 0)
      .query(`
        UPDATE CLIENTES SET
          CODIGOPARTICULAR = @codigo, NOMBRE = @nombre, DOMICILIO = @domicilio,
          CIUDAD = @ciudad, CP = @cp, PROVINCIA = @provincia,
          TELEFONO = @telefono, EMAIL = @email,
          TIPO_DOCUMENTO = @tipoDoc, NUMERO_DOC = @numDoc, CONDICION_IVA = @condIva,
          RUBRO = @rubro, FECHA_NACIMIENTO = @fechaNac,
          CTA_CORRIENTE = @ctaCte, ACTIVO = @activo
        WHERE CLIENTE_ID = @id
      `);
  },

  // ── Delete (soft if referenced, hard otherwise) ─
  async delete(id: number) {
    const pool = await getPool();

    // Prevent deleting CONSUMIDOR FINAL
    if (id === 1) {
      throw Object.assign(new Error('No se puede eliminar el cliente CONSUMIDOR FINAL'), { name: 'ValidationError' });
    }

    // Check if referenced in VENTAS
    const check = await pool.request().input('id', sql.Int, id).query(`
      SELECT COUNT(*) AS enVentas FROM VENTAS WHERE CLIENTE_ID = @id
    `);
    const { enVentas } = check.recordset[0];

    if (enVentas > 0) {
      await pool.request().input('id', sql.Int, id)
        .query(`UPDATE CLIENTES SET ACTIVO = 0 WHERE CLIENTE_ID = @id`);
      return { mode: 'soft' as const };
    }

    // Clean up CTA_CORRIENTE if exists, then delete
    try {
      await pool.request().input('id', sql.Int, id)
        .query(`DELETE FROM VENTAS_CTA_CORRIENTE WHERE CTA_CORRIENTE_ID IN (SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @id)`);
    } catch { /* table may not exist or no records */ }
    try {
      await pool.request().input('id', sql.Int, id)
        .query(`DELETE FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @id`);
    } catch { /* table may not exist or no records */ }

    await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM CLIENTES WHERE CLIENTE_ID = @id`);

    return { mode: 'hard' as const };
  },

  // ── Cta corriente saldo ────────────────────────
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

  // ── Get next code ──────────────────────────────
  async getNextCode(): Promise<string> {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT ISNULL(MAX(CLIENTE_ID), 0) + 1 AS nextId FROM CLIENTES`);
    return String(result.recordset[0].nextId);
  },
};
