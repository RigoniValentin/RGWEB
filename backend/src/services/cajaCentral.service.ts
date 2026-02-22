import { getPool, sql } from '../database/connection.js';
import type { MovimientoCaja } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Caja Central (Central Cash) Service
// ═══════════════════════════════════════════════════

export interface CajaCentralFilter {
  fechaDesde?: string;
  fechaHasta?: string;
  puntoVentaIds?: number[];
  cajaId?: number;
}

export interface NuevoMovimientoInput {
  tipo: 'INGRESO' | 'EGRESO';
  descripcion: string;
  efectivo?: number;
  digital?: number;
  cheques?: number;
  ctaCte?: number;
}

export const cajaCentralService = {
  // ── Get movement lists (income/expenses) ───────
  async getMovimientos(filter: CajaCentralFilter = {}) {
    const pool = await getPool();

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.fechaDesde) {
      where += ' AND m.FECHA >= @fechaDesde';
      params.push({ name: 'fechaDesde', type: sql.DateTime, value: new Date(filter.fechaDesde) });
    }
    if (filter.fechaHasta) {
      where += ' AND m.FECHA <= @fechaHasta';
      params.push({ name: 'fechaHasta', type: sql.DateTime, value: new Date(filter.fechaHasta + 'T23:59:59') });
    }
    if (filter.puntoVentaIds && filter.puntoVentaIds.length > 0) {
      const pvPlaceholders = filter.puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      where += ` AND m.PUNTO_VENTA_ID IN (${pvPlaceholders})`;
      filter.puntoVentaIds.forEach((id, i) => {
        params.push({ name: `pv${i}`, type: sql.Int, value: id });
      });
    }
    if (filter.cajaId) {
      where += ' AND m.CAJA_ID = @cajaId';
      params.push({ name: 'cajaId', type: sql.Int, value: filter.cajaId });
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    const result = await bind(pool.request()).query(`
      SELECT m.*, u.NOMBRE AS USUARIO_NOMBRE
      FROM MOVIMIENTOS_CAJA m
      LEFT JOIN USUARIOS u ON m.USUARIO_ID = u.USUARIO_ID
      ${where}
      ORDER BY m.FECHA DESC
    `);

    const all: MovimientoCaja[] = result.recordset;

    // Split into income / expenses based on TOTAL sign
    const ingresos = all.filter(m => m.TOTAL >= 0);
    const egresos = all.filter(m => m.TOTAL < 0);

    return { ingresos, egresos };
  },

  // ── Get totals summary ─────────────────────────
  async getTotales(filter: CajaCentralFilter = {}) {
    const pool = await getPool();

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.fechaDesde) {
      where += ' AND m.FECHA >= @fechaDesde';
      params.push({ name: 'fechaDesde', type: sql.DateTime, value: new Date(filter.fechaDesde) });
    }
    if (filter.fechaHasta) {
      where += ' AND m.FECHA <= @fechaHasta';
      params.push({ name: 'fechaHasta', type: sql.DateTime, value: new Date(filter.fechaHasta + 'T23:59:59') });
    }
    if (filter.puntoVentaIds && filter.puntoVentaIds.length > 0) {
      const pvPlaceholders = filter.puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      where += ` AND m.PUNTO_VENTA_ID IN (${pvPlaceholders})`;
      filter.puntoVentaIds.forEach((id, i) => {
        params.push({ name: `pv${i}`, type: sql.Int, value: id });
      });
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    const result = await bind(pool.request()).query(`
      SELECT
        ISNULL(SUM(CASE WHEN TOTAL >= 0 THEN TOTAL ELSE 0 END), 0) AS totalIngresos,
        ISNULL(SUM(CASE WHEN TOTAL < 0 THEN ABS(TOTAL) ELSE 0 END), 0) AS totalEgresos,
        ISNULL(SUM(TOTAL), 0) AS balance,
        ISNULL(SUM(CASE WHEN TOTAL >= 0 THEN EFECTIVO ELSE 0 END), 0) 
          + ISNULL(SUM(CASE WHEN TOTAL < 0 THEN EFECTIVO ELSE 0 END), 0) AS efectivo,
        ISNULL(SUM(DIGITAL), 0) AS digital,
        ISNULL(SUM(CHEQUES), 0) AS cheques,
        ISNULL(SUM(CTA_CTE), 0) AS ctaCte
      FROM MOVIMIENTOS_CAJA m
      ${where}
    `);

    return result.recordset[0];
  },

  // ── Get historical balance (all time) ──────────
  async getBalanceHistorico(puntoVentaIds?: number[]) {
    const pool = await getPool();
    const req = pool.request();
    let pvFilter = '';

    if (puntoVentaIds && puntoVentaIds.length > 0) {
      const pvPlaceholders = puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      pvFilter = `WHERE PUNTO_VENTA_ID IN (${pvPlaceholders})`;
      puntoVentaIds.forEach((id, i) => {
        req.input(`pv${i}`, sql.Int, id);
      });
    }

    const result = await req.query(`
      SELECT
        ISNULL(SUM(CASE WHEN TOTAL >= 0 THEN TOTAL ELSE 0 END), 0) AS totalIngresos,
        ISNULL(SUM(CASE WHEN TOTAL < 0 THEN ABS(TOTAL) ELSE 0 END), 0) AS totalEgresos,
        ISNULL(SUM(TOTAL), 0) AS balance,
        ISNULL(SUM(EFECTIVO), 0) AS efectivo,
        ISNULL(SUM(DIGITAL), 0) AS digital,
        ISNULL(SUM(CHEQUES), 0) AS cheques,
        ISNULL(SUM(CTA_CTE), 0) AS ctaCte
      FROM MOVIMIENTOS_CAJA
      ${pvFilter}
    `);

    return result.recordset[0];
  },

  // ── Get fondo de cambio saldo ──────────────────
  async getSaldoFondoCambio(puntoVentaIds?: number[]) {
    const pool = await getPool();
    const req = pool.request();

    if (puntoVentaIds && puntoVentaIds.length > 0) {
      // Get sum of latest saldo per punto_venta
      const pvPlaceholders = puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      puntoVentaIds.forEach((id, i) => {
        req.input(`pv${i}`, sql.Int, id);
      });

      const result = await req.query(`
        SELECT ISNULL(SUM(saldo), 0) AS saldo FROM (
          SELECT fc.PUNTO_VENTA_ID, fc.SALDO_RESULTANTE AS saldo
          FROM FONDO_CAMBIO fc
          INNER JOIN (
            SELECT PUNTO_VENTA_ID, MAX(ID) AS MAX_ID
            FROM FONDO_CAMBIO
            WHERE PUNTO_VENTA_ID IN (${pvPlaceholders})
            GROUP BY PUNTO_VENTA_ID
          ) latest ON fc.ID = latest.MAX_ID
        ) t
      `);
      return result.recordset[0].saldo;
    }

    // Global saldo
    const result = await req.query(`
      SELECT TOP 1 SALDO_RESULTANTE AS saldo 
      FROM FONDO_CAMBIO 
      ORDER BY ID DESC
    `);
    return result.recordset.length > 0 ? result.recordset[0].saldo : 0;
  },

  // ── Create manual movement ─────────────────────
  async crearMovimiento(input: NuevoMovimientoInput, usuarioId: number, puntoVentaId?: number) {
    const pool = await getPool();

    const efectivo = input.efectivo || 0;
    const digital = input.digital || 0;
    const cheques = input.cheques || 0;
    const ctaCte = input.ctaCte || 0;
    const total = efectivo + digital + cheques + ctaCte;
    const signedTotal = input.tipo === 'EGRESO' ? -Math.abs(total) : Math.abs(total);
    const signedEfectivo = input.tipo === 'EGRESO' ? -Math.abs(efectivo) : Math.abs(efectivo);
    const signedDigital = input.tipo === 'EGRESO' ? -Math.abs(digital) : Math.abs(digital);
    const signedCheques = input.tipo === 'EGRESO' ? -Math.abs(cheques) : Math.abs(cheques);
    const signedCtaCte = input.tipo === 'EGRESO' ? -Math.abs(ctaCte) : Math.abs(ctaCte);

    const result = await pool.request()
      .input('tipoEntidad', sql.VarChar(20), input.tipo)
      .input('movimiento', sql.NVarChar(500), input.descripcion)
      .input('uid', sql.Int, usuarioId)
      .input('efectivo', sql.Decimal(18, 2), signedEfectivo)
      .input('digital', sql.Decimal(18, 2), signedDigital)
      .input('cheques', sql.Decimal(18, 2), signedCheques)
      .input('ctaCte', sql.Decimal(18, 2), signedCtaCte)
      .input('total', sql.Decimal(18, 2), signedTotal)
      .input('pvId', sql.Int, puntoVentaId || null)
      .query(`
        INSERT INTO MOVIMIENTOS_CAJA (TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
        OUTPUT INSERTED.ID
        VALUES (@tipoEntidad, @movimiento, @uid, @efectivo, @digital, @cheques, @ctaCte, @total, @pvId, 1)
      `);

    return { ID: result.recordset[0].ID };
  },

  // ── Delete manual movement ─────────────────────
  async eliminarMovimiento(id: number) {
    const pool = await getPool();

    // Check it's a manual movement
    const check = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT ID, ES_MANUAL FROM MOVIMIENTOS_CAJA WHERE ID = @id`);

    if (check.recordset.length === 0) {
      throw new ValidationError('Movimiento no encontrado');
    }
    if (!check.recordset[0].ES_MANUAL) {
      throw new ValidationError('Solo se pueden eliminar movimientos manuales');
    }

    await pool.request()
      .input('id', sql.Int, id)
      .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID = @id`);

    return { success: true };
  },
};

// ── Error helper ─────────────────────────────────
class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
