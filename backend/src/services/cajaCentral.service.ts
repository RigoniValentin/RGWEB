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
  metodos_pago?: { METODO_PAGO_ID: number; MONTO: number }[];
}

export const cajaCentralService = {
  // ── Get movement lists (income/expenses) ───────
  async getMovimientos(filter: CajaCentralFilter = {}) {
    const pool = await getPool();

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.fechaDesde) {
      where += ' AND m.FECHA >= @fechaDesde';
      params.push({ name: 'fechaDesde', type: sql.DateTime, value: new Date(filter.fechaDesde + 'T00:00:00') });
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

    // Exclude internal fondo movements from the grid (like desktop app)
    // FC transfers are internal and should not appear as ingresos/egresos
    const whereGrid = where + ` AND m.TIPO_ENTIDAD NOT IN ('TRANSFERENCIA_FC', 'REINTEGRO_FONDO', 'DEPOSITO_FONDO')`;

    const result = await bind(pool.request()).query(`
      SELECT m.*, u.NOMBRE AS USUARIO_NOMBRE
      FROM MOVIMIENTOS_CAJA m
      LEFT JOIN USUARIOS u ON m.USUARIO_ID = u.USUARIO_ID
      ${whereGrid}
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
      params.push({ name: 'fechaDesde', type: sql.DateTime, value: new Date(filter.fechaDesde + 'T00:00:00') });
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

    // Query 1: Ingresos / Egresos / Balance / Digital
    // Exclude internal FC transfers (like desktop app)
    const whereTotales = where + ` AND m.TIPO_ENTIDAD NOT IN ('TRANSFERENCIA_FC', 'REINTEGRO_FONDO', 'DEPOSITO_FONDO')`;

    const totalesResult = await bind(pool.request()).query(`
      SELECT
        ISNULL(SUM(CASE WHEN TOTAL >= 0 THEN TOTAL ELSE 0 END), 0) AS totalIngresos,
        ISNULL(SUM(CASE WHEN TOTAL < 0 THEN ABS(TOTAL) ELSE 0 END), 0) AS totalEgresos,
        ISNULL(SUM(TOTAL), 0) AS balance,
        ISNULL(SUM(DIGITAL), 0) AS digital
      FROM MOVIMIENTOS_CAJA m
      ${whereTotales}
    `);

    // Query 2: Efectivo includes ALL movements (FC transfers affect cash)
    const efectivoResult = await bind(pool.request()).query(`
      SELECT ISNULL(SUM(EFECTIVO), 0) AS efectivo
      FROM MOVIMIENTOS_CAJA m
      ${where}
    `);

    return {
      ...totalesResult.recordset[0],
      efectivo: efectivoResult.recordset[0].efectivo,
    };
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

    // Ingresos / Egresos / Balance: Exclude internal FC transfers (like desktop app)
    const excludeFC = pvFilter
      ? pvFilter + ` AND TIPO_ENTIDAD NOT IN ('TRANSFERENCIA_FC', 'REINTEGRO_FONDO', 'DEPOSITO_FONDO')`
      : `WHERE TIPO_ENTIDAD NOT IN ('TRANSFERENCIA_FC', 'REINTEGRO_FONDO', 'DEPOSITO_FONDO')`;

    const totalesResult = await req.query(`
      SELECT
        ISNULL(SUM(CASE WHEN TOTAL >= 0 THEN TOTAL ELSE 0 END), 0) AS totalIngresos,
        ISNULL(SUM(CASE WHEN TOTAL < 0 THEN ABS(TOTAL) ELSE 0 END), 0) AS totalEgresos,
        ISNULL(SUM(TOTAL), 0) AS balance,
        ISNULL(SUM(DIGITAL), 0) AS digital
      FROM MOVIMIENTOS_CAJA
      ${excludeFC}
    `);

    // Efectivo includes ALL movements (FC transfers affect cash)
    const reqEfectivo = pool.request();
    if (puntoVentaIds && puntoVentaIds.length > 0) {
      puntoVentaIds.forEach((id, i) => {
        reqEfectivo.input(`pv${i}`, sql.Int, id);
      });
    }
    const efectivoResult = await reqEfectivo.query(`
      SELECT ISNULL(SUM(EFECTIVO), 0) AS efectivo
      FROM MOVIMIENTOS_CAJA
      ${pvFilter}
    `);

    return {
      ...totalesResult.recordset[0],
      efectivo: efectivoResult.recordset[0].efectivo,
    };
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

    // Derive efectivo/digital from payment methods
    let efectivo = 0;
    let digital = 0;
    const metodos = input.metodos_pago || [];
    if (metodos.length > 0) {
      // Look up categories
      const mpIds = metodos.map(m => m.METODO_PAGO_ID);
      const ph = mpIds.map((_, i) => `@mp${i}`).join(', ');
      const catReq = pool.request();
      mpIds.forEach((id, i) => catReq.input(`mp${i}`, sql.Int, id));
      const catResult = await catReq.query(`SELECT METODO_PAGO_ID, CATEGORIA FROM METODOS_PAGO WHERE METODO_PAGO_ID IN (${ph})`);
      const catMap: Record<number, string> = {};
      for (const r of catResult.recordset) catMap[r.METODO_PAGO_ID] = r.CATEGORIA;
      for (const m of metodos) {
        if (catMap[m.METODO_PAGO_ID] === 'EFECTIVO') efectivo += m.MONTO;
        else digital += m.MONTO;
      }
    }

    const total = efectivo + digital;
    const sign = input.tipo === 'EGRESO' ? -1 : 1;

    const result = await pool.request()
      .input('tipoEntidad', sql.VarChar(20), input.tipo)
      .input('movimiento', sql.NVarChar(500), input.descripcion)
      .input('uid', sql.Int, usuarioId)
      .input('efectivo', sql.Decimal(18, 2), sign * efectivo)
      .input('digital', sql.Decimal(18, 2), sign * digital)
      .input('cheques', sql.Decimal(18, 2), 0)
      .input('ctaCte', sql.Decimal(18, 2), 0)
      .input('total', sql.Decimal(18, 2), sign * total)
      .input('pvId', sql.Int, puntoVentaId || null)
      .query(`
        INSERT INTO MOVIMIENTOS_CAJA (TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
        OUTPUT INSERTED.ID
        VALUES (@tipoEntidad, @movimiento, @uid, @efectivo, @digital, @cheques, @ctaCte, @total, @pvId, 1)
      `);

    const movId = result.recordset[0].ID;

    // Store individual method amounts in MOVIMIENTOS_CAJA_METODOS_PAGO
    if (metodos.length > 0) {
      // Ensure junction table exists
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MOVIMIENTOS_CAJA_METODOS_PAGO')
        CREATE TABLE MOVIMIENTOS_CAJA_METODOS_PAGO (
          ID INT IDENTITY(1,1) PRIMARY KEY,
          MOVIMIENTO_ID INT NOT NULL,
          METODO_PAGO_ID INT NOT NULL,
          MONTO DECIMAL(18,2) NOT NULL
        )
      `);
      for (const m of metodos) {
        await pool.request()
          .input('movId', sql.Int, movId)
          .input('mpId', sql.Int, m.METODO_PAGO_ID)
          .input('monto', sql.Decimal(18, 2), sign * m.MONTO)
          .query(`INSERT INTO MOVIMIENTOS_CAJA_METODOS_PAGO (MOVIMIENTO_ID, METODO_PAGO_ID, MONTO) VALUES (@movId, @mpId, @monto)`);
      }
    }

    return { ID: movId };
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

    // Also delete method breakdown if exists
    try {
      await pool.request()
        .input('id', sql.Int, id)
        .query(`DELETE FROM MOVIMIENTOS_CAJA_METODOS_PAGO WHERE MOVIMIENTO_ID = @id`);
    } catch { /* table may not exist yet */ }

    return { success: true };
  },

  // ── Get payment method breakdown for a specific movimiento ──
  async getDesgloseMovimiento(movimientoId: number) {
    const pool = await getPool();

    // Check if junction table exists and has data for this movement
    try {
      const result = await pool.request()
        .input('movId', sql.Int, movimientoId)
        .query(`
          SELECT mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64,
                 mcm.MONTO AS TOTAL
          FROM MOVIMIENTOS_CAJA_METODOS_PAGO mcm
          JOIN METODOS_PAGO mp ON mcm.METODO_PAGO_ID = mp.METODO_PAGO_ID
          WHERE mcm.MOVIMIENTO_ID = @movId
          ORDER BY CASE WHEN mp.CATEGORIA = 'EFECTIVO' THEN 0 ELSE 1 END, mp.NOMBRE
        `);
      if (result.recordset.length > 0) return result.recordset;
    } catch { /* table may not exist */ }

    // Fallback for old movements: derive from EFECTIVO/DIGITAL columns
    const mov = await pool.request()
      .input('id', sql.Int, movimientoId)
      .query(`SELECT EFECTIVO, DIGITAL FROM MOVIMIENTOS_CAJA WHERE ID = @id`);
    if (mov.recordset.length === 0) return [];

    const { EFECTIVO, DIGITAL } = mov.recordset[0];
    const fallback: any[] = [];

    if (EFECTIVO && EFECTIVO !== 0) {
      const ef = await pool.request().query(`SELECT TOP 1 METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64 FROM METODOS_PAGO WHERE CATEGORIA = 'EFECTIVO' AND ACTIVA = 1 ORDER BY POR_DEFECTO DESC`);
      if (ef.recordset.length > 0) {
        fallback.push({ ...ef.recordset[0], TOTAL: EFECTIVO });
      }
    }
    if (DIGITAL && DIGITAL !== 0) {
      const dg = await pool.request().query(`SELECT TOP 1 METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64 FROM METODOS_PAGO WHERE CATEGORIA = 'DIGITAL' AND ACTIVA = 1 ORDER BY POR_DEFECTO DESC`);
      if (dg.recordset.length > 0) {
        fallback.push({ ...dg.recordset[0], TOTAL: DIGITAL });
      }
    }
    return fallback;
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
