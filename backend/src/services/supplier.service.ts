import { getPool, sql } from '../database/connection.js';
import type { Proveedor, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Supplier Service — Full CRUD
// ═══════════════════════════════════════════════════

export interface ProveedorFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  activo?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface ProveedorInput {
  CODIGOPARTICULAR?: string;
  NOMBRE: string;
  TELEFONO?: string | null;
  EMAIL?: string | null;
  DIRECCION?: string | null;
  CIUDAD?: string | null;
  CP?: string | null;
  CONDICION_IVA?: string | null;
  RUBRO?: string | null;
  TIPO_DOCUMENTO?: string;
  NUMERO_DOC?: string;
  CTA_CORRIENTE?: boolean;
  ACTIVO?: boolean;
}

export const supplierService = {
  // ── List with pagination & filters ─────────────
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
      where += ' AND (NOMBRE LIKE @search OR CODIGOPARTICULAR LIKE @search OR NUMERO_DOC LIKE @search OR EMAIL LIKE @search OR TELEFONO LIKE @search)';
      countReq.input('search', sql.NVarChar, `%${filter.search}%`);
      dataReq.input('search', sql.NVarChar, `%${filter.search}%`);
    }

    const countResult = await countReq.query(`SELECT COUNT(*) as total FROM PROVEEDORES ${where}`);
    const total = countResult.recordset[0].total;

    // Sorting
    const validCols: Record<string, string> = {
      NOMBRE: 'NOMBRE',
      CODIGOPARTICULAR: 'CODIGOPARTICULAR',
      CIUDAD: 'CIUDAD',
      NUMERO_DOC: 'NUMERO_DOC',
    };
    const orderCol = validCols[filter.orderBy || 'NOMBRE'] || 'NOMBRE';
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query<Proveedor>(`
      SELECT * FROM PROVEEDORES
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  // ── Get by ID ──────────────────────────────────
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

  // ── Create ─────────────────────────────────────
  async create(input: ProveedorInput) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Get next ID with exclusive lock to prevent race conditions
      const maxResult = await tx.request().query(
        `SELECT ISNULL(MAX(PROVEEDOR_ID), 0) + 1 AS nextId FROM PROVEEDORES WITH (TABLOCKX, HOLDLOCK)`
      );
      const nextId = maxResult.recordset[0].nextId;

      // Check duplicate code
      if (input.CODIGOPARTICULAR) {
        const dup = await tx.request()
          .input('code', sql.NVarChar, input.CODIGOPARTICULAR)
          .query(`SELECT 1 FROM PROVEEDORES WHERE CODIGOPARTICULAR = @code`);
        if (dup.recordset.length > 0) {
          throw Object.assign(new Error('El código ya existe'), { name: 'ValidationError' });
        }
      }

      const code = input.CODIGOPARTICULAR || String(nextId);

      await tx.request()
        .input('id', sql.Int, nextId)
        .input('codigo', sql.NVarChar, code)
        .input('nombre', sql.NVarChar, input.NOMBRE)
        .input('telefono', sql.NVarChar, input.TELEFONO || null)
        .input('email', sql.NVarChar, input.EMAIL || null)
        .input('direccion', sql.NVarChar, input.DIRECCION || null)
        .input('ciudad', sql.NVarChar, input.CIUDAD || null)
        .input('cp', sql.NVarChar, input.CP || null)
        .input('condIva', sql.NVarChar, input.CONDICION_IVA || null)
        .input('rubro', sql.NVarChar, input.RUBRO || null)
        .input('tipoDoc', sql.NVarChar, input.TIPO_DOCUMENTO || 'CUIT')
        .input('numDoc', sql.NVarChar, input.NUMERO_DOC || '')
        .input('ctaCte', sql.Bit, input.CTA_CORRIENTE ? 1 : 0)
        .input('activo', sql.Bit, input.ACTIVO !== false ? 1 : 0)
        .query(`
          INSERT INTO PROVEEDORES (PROVEEDOR_ID, CODIGOPARTICULAR, NOMBRE, TELEFONO, EMAIL,
            DIRECCION, CIUDAD, CP, CONDICION_IVA, RUBRO, TIPO_DOCUMENTO, NUMERO_DOC, CTA_CORRIENTE, ACTIVO)
          VALUES (@id, @codigo, @nombre, @telefono, @email,
            @direccion, @ciudad, @cp, @condIva, @rubro, @tipoDoc, @numDoc, @ctaCte, @activo)
        `);

      await tx.commit();
      return { PROVEEDOR_ID: nextId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update ─────────────────────────────────────
  async update(id: number, input: ProveedorInput) {
    const pool = await getPool();

    // Validate required fields
    if (!input.CODIGOPARTICULAR?.trim()) {
      throw Object.assign(new Error('El código es obligatorio'), { name: 'ValidationError' });
    }

    // Check duplicate code
    if (input.CODIGOPARTICULAR) {
      const dup = await pool.request()
        .input('code', sql.NVarChar, input.CODIGOPARTICULAR)
        .input('id', sql.Int, id)
        .query(`SELECT 1 FROM PROVEEDORES WHERE CODIGOPARTICULAR = @code AND PROVEEDOR_ID != @id`);
      if (dup.recordset.length > 0) {
        throw Object.assign(new Error('El código ya existe'), { name: 'ValidationError' });
      }
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('codigo', sql.NVarChar, input.CODIGOPARTICULAR || '')
      .input('nombre', sql.NVarChar, input.NOMBRE)
      .input('telefono', sql.NVarChar, input.TELEFONO || null)
      .input('email', sql.NVarChar, input.EMAIL || null)
      .input('direccion', sql.NVarChar, input.DIRECCION || null)
      .input('ciudad', sql.NVarChar, input.CIUDAD || null)
      .input('cp', sql.NVarChar, input.CP || null)
      .input('condIva', sql.NVarChar, input.CONDICION_IVA || null)
      .input('rubro', sql.NVarChar, input.RUBRO || null)
      .input('tipoDoc', sql.NVarChar, input.TIPO_DOCUMENTO || 'CUIT')
      .input('numDoc', sql.NVarChar, input.NUMERO_DOC || '')
      .input('ctaCte', sql.Bit, input.CTA_CORRIENTE ? 1 : 0)
      .input('activo', sql.Bit, input.ACTIVO !== false ? 1 : 0)
      .query(`
        UPDATE PROVEEDORES SET
          CODIGOPARTICULAR = @codigo, NOMBRE = @nombre, TELEFONO = @telefono,
          EMAIL = @email, DIRECCION = @direccion, CIUDAD = @ciudad, CP = @cp,
          CONDICION_IVA = @condIva, RUBRO = @rubro,
          TIPO_DOCUMENTO = @tipoDoc, NUMERO_DOC = @numDoc,
          CTA_CORRIENTE = @ctaCte, ACTIVO = @activo
        WHERE PROVEEDOR_ID = @id
      `);
  },

  // ── Delete (soft if referenced, hard otherwise) ─
  async delete(id: number) {
    const pool = await getPool();

    // Check if referenced in COMPRAS or PRODUCTOS_PROVEEDORES
    const check = await pool.request().input('id', sql.Int, id).query(`
      SELECT
        (SELECT COUNT(*) FROM COMPRAS WHERE PROVEEDOR_ID = @id) AS enCompras,
        (SELECT COUNT(*) FROM PRODUCTOS_PROVEEDORES WHERE PROVEEDOR_ID = @id) AS enProductos
    `);
    const { enCompras, enProductos } = check.recordset[0];

    if (enCompras > 0 || enProductos > 0) {
      await pool.request().input('id', sql.Int, id)
        .query(`UPDATE PROVEEDORES SET ACTIVO = 0 WHERE PROVEEDOR_ID = @id`);
      return { mode: 'soft' as const };
    }

    await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM PROVEEDORES WHERE PROVEEDOR_ID = @id`);

    return { mode: 'hard' as const };
  },

  // ── Get next code ──────────────────────────────
  async getNextCode(): Promise<string> {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT ISNULL(MAX(PROVEEDOR_ID), 0) + 1 AS nextId FROM PROVEEDORES`);
    return String(result.recordset[0].nextId);
  },
};
