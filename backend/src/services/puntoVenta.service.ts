import { getPool, sql } from '../database/connection.js';
import type { PuntoVenta, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Puntos de Venta — Full CRUD + assignments
// ═══════════════════════════════════════════════════

export interface PuntoVentaFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  soloActivos?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface PuntoVentaInput {
  NOMBRE: string;
  DIRECCION?: string | null;
  COMENTARIOS?: string | null;
  ACTIVO?: boolean;
  /** Optional list of DEPOSITO_IDs to assign on save. */
  depositos?: number[];
  /** Optional DEPOSITO_ID flagged as preferido for this PV. */
  depositoPreferido?: number | null;
  /** Optional list of USUARIO_IDs to assign on save. */
  usuarios?: number[];
  /** Optional USUARIO_ID flagged as preferido for this PV. */
  usuarioPreferido?: number | null;
}

export interface PuntoVentaWithCounts extends PuntoVenta {
  CANT_DEPOSITOS: number;
  CANT_USUARIOS: number;
}

/** Quote a column whose name uses an unsafe character (the legacy DIRECCIÓN). */
const COL_DIRECCION = '[DIRECCIÓN]';

const safeOrderCol = (col?: string): string => {
  const map: Record<string, string> = {
    NOMBRE: 'NOMBRE',
    PUNTO_VENTA_ID: 'PUNTO_VENTA_ID',
    ACTIVO: 'ACTIVO',
  };
  return map[col || 'NOMBRE'] || 'NOMBRE';
};

export const puntoVentaService = {
  // ── List with pagination ───────────────────────
  async getAll(filter: PuntoVentaFilter = {}): Promise<PaginatedResult<PuntoVentaWithCounts>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.search) {
      where += ` AND (NOMBRE LIKE @search OR ${COL_DIRECCION} LIKE @search)`;
      countReq.input('search', sql.NVarChar, `%${filter.search}%`);
      dataReq.input('search', sql.NVarChar, `%${filter.search}%`);
    }

    if (filter.soloActivos) {
      where += ' AND ACTIVO = 1';
    }

    const countResult = await countReq.query(`SELECT COUNT(*) AS total FROM PUNTO_VENTAS ${where}`);
    const total = countResult.recordset[0].total;

    const orderCol = safeOrderCol(filter.orderBy);
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query<PuntoVentaWithCounts>(`
      SELECT pv.PUNTO_VENTA_ID,
             pv.NOMBRE,
             ISNULL(pv.${COL_DIRECCION}, '') AS DIRECCION,
             pv.COMENTARIOS,
             pv.ACTIVO,
             ISNULL((SELECT COUNT(*) FROM PUNTOS_VENTA_DEPOSITOS pvd
                     WHERE pvd.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID), 0) AS CANT_DEPOSITOS,
             ISNULL((SELECT COUNT(*) FROM USUARIOS_PUNTOS_VENTA upv
                     WHERE upv.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID), 0) AS CANT_USUARIOS
      FROM PUNTO_VENTAS pv
      ${where}
      ORDER BY pv.${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  // ── Lightweight selector (for combos) ──────────
  async getSelector(): Promise<Array<Pick<PuntoVenta, 'PUNTO_VENTA_ID' | 'NOMBRE' | 'ACTIVO'>>> {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT PUNTO_VENTA_ID, NOMBRE, ACTIVO
      FROM PUNTO_VENTAS
      ORDER BY ACTIVO DESC, NOMBRE
    `);
    return result.recordset;
  },

  // ── Get by ID with assignments ─────────────────
  async getById(id: number): Promise<PuntoVenta & { depositos: Array<{ DEPOSITO_ID: number; NOMBRE: string; ES_PREFERIDO: boolean }>; usuarios: Array<{ USUARIO_ID: number; NOMBRE: string; ES_PREFERIDO: boolean }> }> {
    const pool = await getPool();

    const pvResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT PUNTO_VENTA_ID,
               NOMBRE,
               ISNULL(${COL_DIRECCION}, '') AS DIRECCION,
               COMENTARIOS,
               ACTIVO
        FROM PUNTO_VENTAS
        WHERE PUNTO_VENTA_ID = @id
      `);

    if (pvResult.recordset.length === 0) {
      throw Object.assign(new Error('Punto de venta no encontrado'), { name: 'ValidationError' });
    }

    const depositosResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT pvd.DEPOSITO_ID, d.NOMBRE, ISNULL(pvd.ES_PREFERIDO, 0) AS ES_PREFERIDO
        FROM PUNTOS_VENTA_DEPOSITOS pvd
        JOIN DEPOSITOS d ON d.DEPOSITO_ID = pvd.DEPOSITO_ID
        WHERE pvd.PUNTO_VENTA_ID = @id
        ORDER BY d.NOMBRE
      `);

    let usuarios: any[] = [];
    try {
      const usrResult = await pool.request()
        .input('id', sql.Int, id)
        .query(`
          SELECT upv.USUARIO_ID, u.NOMBRE, ISNULL(upv.ES_PREFERIDO, 0) AS ES_PREFERIDO
          FROM USUARIOS_PUNTOS_VENTA upv
          JOIN USUARIOS u ON u.USUARIO_ID = upv.USUARIO_ID
          WHERE upv.PUNTO_VENTA_ID = @id
          ORDER BY u.NOMBRE
        `);
      usuarios = usrResult.recordset;
    } catch { /* USUARIOS_PUNTOS_VENTA may not exist */ }

    return {
      ...pvResult.recordset[0],
      depositos: depositosResult.recordset,
      usuarios,
    };
  },

  // ── Create ─────────────────────────────────────
  async create(input: PuntoVentaInput) {
    if (!input.NOMBRE?.trim()) {
      throw Object.assign(new Error('El nombre es obligatorio'), { name: 'ValidationError' });
    }

    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const insertResult = await tx.request()
        .input('nombre', sql.NVarChar, input.NOMBRE.trim())
        .input('direccion', sql.NVarChar, input.DIRECCION ?? null)
        .input('coment', sql.NVarChar, input.COMENTARIOS ?? null)
        .input('activo', sql.Bit, input.ACTIVO === false ? 0 : 1)
        .query(`
          INSERT INTO PUNTO_VENTAS (NOMBRE, ${COL_DIRECCION}, COMENTARIOS, ACTIVO)
          OUTPUT INSERTED.PUNTO_VENTA_ID
          VALUES (@nombre, @direccion, @coment, @activo)
        `);

      const nextId: number = insertResult.recordset[0].PUNTO_VENTA_ID;

      await syncDepositosAssignments(tx, nextId, input.depositos ?? [], input.depositoPreferido ?? null);
      await syncUsuariosAssignments(tx, nextId, input.usuarios ?? [], input.usuarioPreferido ?? null);

      await tx.commit();
      return { PUNTO_VENTA_ID: nextId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update ─────────────────────────────────────
  async update(id: number, input: PuntoVentaInput) {
    if (!input.NOMBRE?.trim()) {
      throw Object.assign(new Error('El nombre es obligatorio'), { name: 'ValidationError' });
    }

    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const exists = await tx.request().input('id', sql.Int, id)
        .query(`SELECT 1 FROM PUNTO_VENTAS WHERE PUNTO_VENTA_ID = @id`);
      if (exists.recordset.length === 0) {
        throw Object.assign(new Error('Punto de venta no encontrado'), { name: 'ValidationError' });
      }

      await tx.request()
        .input('id', sql.Int, id)
        .input('nombre', sql.NVarChar, input.NOMBRE.trim())
        .input('direccion', sql.NVarChar, input.DIRECCION ?? null)
        .input('coment', sql.NVarChar, input.COMENTARIOS ?? null)
        .input('activo', sql.Bit, input.ACTIVO === false ? 0 : 1)
        .query(`
          UPDATE PUNTO_VENTAS SET
            NOMBRE = @nombre,
            ${COL_DIRECCION} = @direccion,
            COMENTARIOS = @coment,
            ACTIVO = @activo
          WHERE PUNTO_VENTA_ID = @id
        `);

      if (input.depositos !== undefined) {
        await syncDepositosAssignments(tx, id, input.depositos, input.depositoPreferido ?? null);
      }
      if (input.usuarios !== undefined) {
        await syncUsuariosAssignments(tx, id, input.usuarios, input.usuarioPreferido ?? null);
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete ─────────────────────────────────────
  async delete(id: number) {
    const pool = await getPool();

    if (id === 1) {
      throw Object.assign(
        new Error('No se puede eliminar el Punto de Venta por defecto. Si desea puede modificarle el nombre o desactivarlo.'),
        { name: 'ValidationError' },
      );
    }

    // Block deletion if referenced by core movement tables. We check the most common
    // ones; missing tables are ignored so the validation works on any installation.
    const refTables: Array<{ table: string; column?: string }> = [
      { table: 'CAJA' },
      { table: 'VENTAS' },
      { table: 'COMPRAS' },
      { table: 'MOVIMIENTOS_CAJA' },
    ];
    for (const ref of refTables) {
      try {
        const result = await pool.request().input('id', sql.Int, id)
          .query(`SELECT TOP 1 1 AS x FROM ${ref.table} WHERE PUNTO_VENTA_ID = @id`);
        if (result.recordset.length > 0) {
          throw Object.assign(
            new Error(`No se puede eliminar el punto de venta porque tiene movimientos asociados (${ref.table}).`),
            { name: 'ValidationError' },
          );
        }
      } catch (err: any) {
        if (err.name === 'ValidationError') throw err;
        // Ignore "invalid object name" / "invalid column name" — table or column missing.
      }
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM PUNTOS_VENTA_DEPOSITOS WHERE PUNTO_VENTA_ID = @id`);
      try {
        await tx.request().input('id', sql.Int, id).query(`DELETE FROM USUARIOS_PUNTOS_VENTA WHERE PUNTO_VENTA_ID = @id`);
      } catch { /* table may not exist */ }
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM PUNTO_VENTAS WHERE PUNTO_VENTA_ID = @id`);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    return { mode: 'hard' as const };
  },

  // ── Helpers exposed for other services ─────────
  async getDepositosByPuntoVenta(puntoVentaId: number): Promise<number[]> {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, puntoVentaId)
      .query(`SELECT DEPOSITO_ID FROM PUNTOS_VENTA_DEPOSITOS WHERE PUNTO_VENTA_ID = @id`);
    return result.recordset.map((r: any) => r.DEPOSITO_ID);
  },
};

// ── Internal helpers ─────────────────────────────────────────────────────
async function syncDepositosAssignments(tx: any, puntoVentaId: number, depositoIds: number[], preferido: number | null) {
  await tx.request().input('id', sql.Int, puntoVentaId)
    .query(`DELETE FROM PUNTOS_VENTA_DEPOSITOS WHERE PUNTO_VENTA_ID = @id`);

  for (const depId of depositoIds) {
    await tx.request()
      .input('pv', sql.Int, puntoVentaId)
      .input('dep', sql.Int, depId)
      .input('pref', sql.Bit, preferido != null && depId === preferido ? 1 : 0)
      .query(`
        INSERT INTO PUNTOS_VENTA_DEPOSITOS (PUNTO_VENTA_ID, DEPOSITO_ID, ES_PREFERIDO)
        VALUES (@pv, @dep, @pref)
      `);
  }
}

async function syncUsuariosAssignments(tx: any, puntoVentaId: number, usuarioIds: number[], _preferido: number | null) {
  // El flag ES_PREFERIDO de USUARIOS_PUNTOS_VENTA representa el PV preferido
  // de CADA USUARIO (cada usuario puede tener un único PV preferido). Por lo
  // tanto, este sync (que opera desde la perspectiva del PV) NO debe modificar
  // el preferido: sólo gestiona qué usuarios están asignados a este PV.
  // Para no perder los preferidos ya configurados, hacemos un snapshot del
  // valor actual ES_PREFERIDO por usuario y lo conservamos al re-insertar.
  try {
    const existing = await tx.request().input('id', sql.Int, puntoVentaId)
      .query(`SELECT USUARIO_ID, ES_PREFERIDO FROM USUARIOS_PUNTOS_VENTA WHERE PUNTO_VENTA_ID = @id`);
    const prevPref = new Map<number, number>();
    for (const row of existing.recordset) {
      prevPref.set(row.USUARIO_ID, row.ES_PREFERIDO ? 1 : 0);
    }

    await tx.request().input('id', sql.Int, puntoVentaId)
      .query(`DELETE FROM USUARIOS_PUNTOS_VENTA WHERE PUNTO_VENTA_ID = @id`);

    for (const uid of usuarioIds) {
      const pref = prevPref.get(uid) ?? 0;
      await tx.request()
        .input('pv', sql.Int, puntoVentaId)
        .input('u', sql.Int, uid)
        .input('pref', sql.Bit, pref)
        .query(`
          INSERT INTO USUARIOS_PUNTOS_VENTA (USUARIO_ID, PUNTO_VENTA_ID, ES_PREFERIDO)
          VALUES (@u, @pv, @pref)
        `);
    }
  } catch {
    // USUARIOS_PUNTOS_VENTA may not exist — silently skip.
  }
}
