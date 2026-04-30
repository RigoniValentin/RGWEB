import { getPool, sql } from '../database/connection.js';
import type { Deposito, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Deposit Service — Full CRUD
// ═══════════════════════════════════════════════════

export interface DepositoFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface DepositoInput {
  CODIGOPARTICULAR?: string;
  NOMBRE: string;
  /** Optional list of PUNTO_VENTA_IDs to assign on save. */
  puntosVenta?: number[];
  /** Optional PUNTO_VENTA_ID flagged as preferido for this deposit. */
  puntoVentaPreferido?: number | null;
}

export const depositService = {
  // ── List with pagination & filters ─────────────
  async getAll(filter: DepositoFilter = {}): Promise<PaginatedResult<Deposito>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.search) {
      where += ' AND (NOMBRE LIKE @search OR CODIGOPARTICULAR LIKE @search)';
      countReq.input('search', sql.NVarChar, `%${filter.search}%`);
      dataReq.input('search', sql.NVarChar, `%${filter.search}%`);
    }

    const countResult = await countReq.query(`SELECT COUNT(*) as total FROM DEPOSITOS ${where}`);
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

    const dataResult = await dataReq.query<Deposito>(`
      SELECT DEPOSITO_ID, CODIGOPARTICULAR, NOMBRE
      FROM DEPOSITOS
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    // Attach puntos de venta per deposit (best-effort: junction table is optional)
    const ids = dataResult.recordset.map(d => d.DEPOSITO_ID);
    let pvByDep: Record<number, Array<{ PUNTO_VENTA_ID: number; NOMBRE: string; ES_PREFERIDO: boolean }>> = {};
    if (ids.length > 0) {
      try {
        const pvResult = await pool.request().query(`
          SELECT pvd.DEPOSITO_ID, pvd.PUNTO_VENTA_ID, pv.NOMBRE,
                 ISNULL(pvd.ES_PREFERIDO, 0) AS ES_PREFERIDO
          FROM PUNTOS_VENTA_DEPOSITOS pvd
          JOIN PUNTO_VENTAS pv ON pv.PUNTO_VENTA_ID = pvd.PUNTO_VENTA_ID
          WHERE pvd.DEPOSITO_ID IN (${ids.join(',')})
          ORDER BY pv.NOMBRE
        `);
        for (const row of pvResult.recordset) {
          if (!pvByDep[row.DEPOSITO_ID]) pvByDep[row.DEPOSITO_ID] = [];
          pvByDep[row.DEPOSITO_ID].push({
            PUNTO_VENTA_ID: row.PUNTO_VENTA_ID,
            NOMBRE: row.NOMBRE,
            ES_PREFERIDO: !!row.ES_PREFERIDO,
          });
        }
      } catch { /* tables may not exist yet */ }
    }

    const data = dataResult.recordset.map(d => ({
      ...d,
      puntosVenta: pvByDep[d.DEPOSITO_ID] || [],
    }));

    return { data, total, page, pageSize };
  },

  // ── Get by ID ──────────────────────────────────
  async getById(id: number): Promise<Deposito & { puntosVenta?: Array<{ PUNTO_VENTA_ID: number; NOMBRE: string; ES_PREFERIDO: boolean }> }> {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, id)
      .query<Deposito>('SELECT DEPOSITO_ID, CODIGOPARTICULAR, NOMBRE FROM DEPOSITOS WHERE DEPOSITO_ID = @id');

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Depósito no encontrado'), { name: 'ValidationError' });
    }

    let puntosVenta: Array<{ PUNTO_VENTA_ID: number; NOMBRE: string; ES_PREFERIDO: boolean }> = [];
    try {
      const pvResult = await pool.request().input('id', sql.Int, id).query(`
        SELECT pvd.PUNTO_VENTA_ID, pv.NOMBRE, ISNULL(pvd.ES_PREFERIDO, 0) AS ES_PREFERIDO
        FROM PUNTOS_VENTA_DEPOSITOS pvd
        JOIN PUNTO_VENTAS pv ON pv.PUNTO_VENTA_ID = pvd.PUNTO_VENTA_ID
        WHERE pvd.DEPOSITO_ID = @id
        ORDER BY pv.NOMBRE
      `);
      puntosVenta = pvResult.recordset.map((r: any) => ({
        PUNTO_VENTA_ID: r.PUNTO_VENTA_ID,
        NOMBRE: r.NOMBRE,
        ES_PREFERIDO: !!r.ES_PREFERIDO,
      }));
    } catch { /* junction may not exist yet */ }

    return { ...result.recordset[0], puntosVenta };
  },

  // ── Create ─────────────────────────────────────
  async create(input: DepositoInput) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Get next ID with exclusive lock to prevent race conditions
      const maxResult = await tx.request().query(
        `SELECT ISNULL(MAX(DEPOSITO_ID), 0) + 1 AS nextId FROM DEPOSITOS WITH (TABLOCKX, HOLDLOCK)`
      );
      const nextId = maxResult.recordset[0].nextId;

      // Check duplicate code
      if (input.CODIGOPARTICULAR) {
        const dup = await tx.request()
          .input('code', sql.NVarChar, input.CODIGOPARTICULAR)
          .query(`SELECT 1 FROM DEPOSITOS WHERE CODIGOPARTICULAR = @code`);
        if (dup.recordset.length > 0) {
          throw Object.assign(new Error('El código ya existe'), { name: 'ValidationError' });
        }
      }

      const code = input.CODIGOPARTICULAR || String(nextId);

      await tx.request()
        .input('id', sql.Int, nextId)
        .input('codigo', sql.NVarChar, code)
        .input('nombre', sql.NVarChar, input.NOMBRE)
        .query(`
          INSERT INTO DEPOSITOS (DEPOSITO_ID, CODIGOPARTICULAR, NOMBRE)
          VALUES (@id, @codigo, @nombre)
        `);

      if (input.puntosVenta !== undefined) {
        await syncPuntosVentaForDeposito(tx, nextId, input.puntosVenta, input.puntoVentaPreferido ?? null);
      }

      await tx.commit();
      return { DEPOSITO_ID: nextId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update ─────────────────────────────────────
  async update(id: number, input: DepositoInput) {
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
        .query(`SELECT 1 FROM DEPOSITOS WHERE CODIGOPARTICULAR = @code AND DEPOSITO_ID != @id`);
      if (dup.recordset.length > 0) {
        throw Object.assign(new Error('El código ya existe'), { name: 'ValidationError' });
      }
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request()
        .input('id', sql.Int, id)
        .input('codigo', sql.NVarChar, input.CODIGOPARTICULAR || '')
        .input('nombre', sql.NVarChar, input.NOMBRE)
        .query(`
          UPDATE DEPOSITOS SET
            CODIGOPARTICULAR = @codigo, NOMBRE = @nombre
          WHERE DEPOSITO_ID = @id
        `);

      if (input.puntosVenta !== undefined) {
        await syncPuntosVentaForDeposito(tx, id, input.puntosVenta, input.puntoVentaPreferido ?? null);
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete (check references first) ────────────
  async delete(id: number) {
    const pool = await getPool();

    // Prevent deleting DEPOSITO CENTRAL
    if (id === 1) {
      throw Object.assign(new Error('No se puede eliminar el DEPOSITO CENTRAL, ya que es el que se toma por defecto. Si desea puede modificarle el nombre.'), { name: 'ValidationError' });
    }

    // Check if referenced in STOCK_DEPOSITOS
    const checkStock = await pool.request().input('id', sql.Int, id).query(`
      SELECT COUNT(*) AS enStock FROM STOCK_DEPOSITOS WHERE DEPOSITO_ID = @id
    `);
    const { enStock } = checkStock.recordset[0];

    if (enStock > 0) {
      throw Object.assign(new Error('No se puede eliminar el depósito porque tiene stock asociado. Mueva el stock a otro depósito primero.'), { name: 'ValidationError' });
    }

    // Remove punto-venta links (junction table) before deleting the deposit.
    try {
      await pool.request().input('id', sql.Int, id)
        .query(`DELETE FROM PUNTOS_VENTA_DEPOSITOS WHERE DEPOSITO_ID = @id`);
    } catch { /* table may not exist */ }

    await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM DEPOSITOS WHERE DEPOSITO_ID = @id`);

    return { mode: 'hard' as const };
  },

  // ── Get next code ──────────────────────────────
  async getNextCode(): Promise<string> {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT ISNULL(MAX(DEPOSITO_ID), 0) + 1 AS nextId FROM DEPOSITOS`);
    return String(result.recordset[0].nextId);
  },
};
// ── Internal helper for PV ↔ DEPOSITO sync ───────────────────────────
async function syncPuntosVentaForDeposito(tx: any, depositoId: number, pvIds: number[], preferido: number | null) {
  try {
    await tx.request().input('id', sql.Int, depositoId)
      .query(`DELETE FROM PUNTOS_VENTA_DEPOSITOS WHERE DEPOSITO_ID = @id`);

    for (const pv of pvIds) {
      await tx.request()
        .input('pv', sql.Int, pv)
        .input('dep', sql.Int, depositoId)
        .input('pref', sql.Bit, preferido != null && pv === preferido ? 1 : 0)
        .query(`
          INSERT INTO PUNTOS_VENTA_DEPOSITOS (PUNTO_VENTA_ID, DEPOSITO_ID, ES_PREFERIDO)
          VALUES (@pv, @dep, @pref)
        `);
    }
  } catch {
    // Junction table missing — ignore (legacy installs).
  }
}