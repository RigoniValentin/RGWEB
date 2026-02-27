import { getPool, sql } from '../database/connection.js';
import type { Categoria, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Category Service — Full CRUD
// ═══════════════════════════════════════════════════

export interface CategoriaFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  activa?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface CategoriaInput {
  CODIGOPARTICULAR?: string;
  NOMBRE: string;
  GUARDA_VENCIMIENTO?: boolean;
  ACTIVA?: boolean;
}

export const categoryService = {
  // ── List with pagination & filters ─────────────
  async getAll(filter: CategoriaFilter = {}): Promise<PaginatedResult<Categoria>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.activa !== undefined) {
      where += ' AND ACTIVA = @activa';
      countReq.input('activa', sql.Bit, filter.activa ? 1 : 0);
      dataReq.input('activa', sql.Bit, filter.activa ? 1 : 0);
    }
    if (filter.search) {
      where += ' AND (NOMBRE LIKE @search OR CODIGOPARTICULAR LIKE @search)';
      countReq.input('search', sql.NVarChar, `%${filter.search}%`);
      dataReq.input('search', sql.NVarChar, `%${filter.search}%`);
    }

    const countResult = await countReq.query(`SELECT COUNT(*) as total FROM CATEGORIAS ${where}`);
    const total = countResult.recordset[0].total;

    // Sorting
    const validCols: Record<string, string> = {
      NOMBRE: 'NOMBRE',
      CODIGOPARTICULAR: 'CODIGOPARTICULAR',
    };
    const orderCol = validCols[filter.orderBy || 'NOMBRE'] || 'NOMBRE';
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query<Categoria>(`
      SELECT CATEGORIA_ID, CODIGOPARTICULAR, NOMBRE, GUARDA_VENCIMIENTO, ACTIVA
      FROM CATEGORIAS
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  // ── Get by ID ──────────────────────────────────
  async getById(id: number): Promise<Categoria> {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query<Categoria>('SELECT CATEGORIA_ID, CODIGOPARTICULAR, NOMBRE, GUARDA_VENCIMIENTO, ACTIVA FROM CATEGORIAS WHERE CATEGORIA_ID = @id');

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Categoría no encontrada'), { name: 'ValidationError' });
    }
    return result.recordset[0];
  },

  // ── Create ─────────────────────────────────────
  async create(input: CategoriaInput) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Get next ID with exclusive lock to prevent race conditions
      const maxResult = await tx.request().query(
        `SELECT ISNULL(MAX(CATEGORIA_ID), 0) + 1 AS nextId FROM CATEGORIAS WITH (TABLOCKX, HOLDLOCK)`
      );
      const nextId = maxResult.recordset[0].nextId;

      // Check duplicate code
      if (input.CODIGOPARTICULAR) {
        const dup = await tx.request()
          .input('code', sql.NVarChar, input.CODIGOPARTICULAR)
          .query(`SELECT 1 FROM CATEGORIAS WHERE CODIGOPARTICULAR = @code`);
        if (dup.recordset.length > 0) {
          throw Object.assign(new Error('El código ya existe'), { name: 'ValidationError' });
        }
      }

      const code = input.CODIGOPARTICULAR || String(nextId);

      await tx.request()
        .input('id', sql.Int, nextId)
        .input('codigo', sql.NVarChar, code)
        .input('nombre', sql.NVarChar, input.NOMBRE)
        .input('guardaVenc', sql.Bit, input.GUARDA_VENCIMIENTO ? 1 : 0)
        .input('activa', sql.Bit, input.ACTIVA !== false ? 1 : 0)
        .query(`
          INSERT INTO CATEGORIAS (CATEGORIA_ID, CODIGOPARTICULAR, NOMBRE, GUARDA_VENCIMIENTO, ACTIVA)
          VALUES (@id, @codigo, @nombre, @guardaVenc, @activa)
        `);

      await tx.commit();
      return { CATEGORIA_ID: nextId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update ─────────────────────────────────────
  async update(id: number, input: CategoriaInput) {
    const pool = await getPool();

    // Validate required fields
    if (!input.CODIGOPARTICULAR?.trim()) {
      throw Object.assign(new Error('El código es obligatorio'), { name: 'ValidationError' });
    }
    if (!input.NOMBRE?.trim()) {
      throw Object.assign(new Error('El nombre es obligatorio'), { name: 'ValidationError' });
    }

    // Check duplicate code
    if (input.CODIGOPARTICULAR) {
      const dup = await pool.request()
        .input('code', sql.NVarChar, input.CODIGOPARTICULAR)
        .input('id', sql.Int, id)
        .query(`SELECT 1 FROM CATEGORIAS WHERE CODIGOPARTICULAR = @code AND CATEGORIA_ID != @id`);
      if (dup.recordset.length > 0) {
        throw Object.assign(new Error('El código ya existe'), { name: 'ValidationError' });
      }
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('codigo', sql.NVarChar, input.CODIGOPARTICULAR)
      .input('nombre', sql.NVarChar, input.NOMBRE)
      .input('guardaVenc', sql.Bit, input.GUARDA_VENCIMIENTO ? 1 : 0)
      .input('activa', sql.Bit, input.ACTIVA !== false ? 1 : 0)
      .query(`
        UPDATE CATEGORIAS SET
          CODIGOPARTICULAR = @codigo, NOMBRE = @nombre,
          GUARDA_VENCIMIENTO = @guardaVenc, ACTIVA = @activa
        WHERE CATEGORIA_ID = @id
      `);
  },

  // ── Delete (soft if referenced, hard otherwise) ─
  async delete(id: number) {
    const pool = await getPool();

    // Check if referenced in PRODUCTOS
    const check = await pool.request().input('id', sql.Int, id).query(`
      SELECT COUNT(*) AS enProductos FROM PRODUCTOS WHERE CATEGORIA_ID = @id
    `);
    const { enProductos } = check.recordset[0];

    if (enProductos > 0) {
      // Soft delete — mark as inactive
      await pool.request().input('id', sql.Int, id)
        .query(`UPDATE CATEGORIAS SET ACTIVA = 0 WHERE CATEGORIA_ID = @id`);
      return { mode: 'soft' as const };
    }

    await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM CATEGORIAS WHERE CATEGORIA_ID = @id`);

    return { mode: 'hard' as const };
  },

  // ── Get next code ──────────────────────────────
  async getNextCode(): Promise<string> {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT ISNULL(MAX(CATEGORIA_ID), 0) + 1 AS nextId FROM CATEGORIAS`);
    return String(result.recordset[0].nextId);
  },
};
