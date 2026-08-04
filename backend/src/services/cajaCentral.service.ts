import { getPool, sql } from '../database/connection.js';
import type { MovimientoCaja } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Caja Central (Central Cash) Service
//
//  POST-MIGRACIÓN: sin Fondo de Cambio. Los tipos internos que se
//  excluyen del balance operativo son: transferencias CC↔Caja,
//  aporte de apertura, depósito por cierre.
// ═══════════════════════════════════════════════════

// `DEPOSITO_CIERRE` NO se incluye como interno: representa el movimiento
// real de efectivo desde la caja hacia Caja Central al cerrar la sesión y
// debe impactar el balance (igual que la versión anterior con `CIERRE_CAJA`).
// `DEPOSITO_FONDO` y `REINTEGRO_FONDO` SÍ se incluyen: son los movimientos
// legacy de Fondo de Cambio con TOTAL=0 que sólo trasladan saldo dentro de CC
// y no deben aparecer como ingresos/egresos operativos en la grilla.
// `TRANSFERENCIA_FC` también se excluye: son ajustes de reconciliación con
// TOTAL=0 cuyo EFECTIVO se reparte entre los métodos. Esto mantiene la
// simetría: BALANCE = suma de métodos (sin doble conteo).
const INTERNAL_TYPES_SQL = `('TRANSFERENCIA_CC', 'TRANSFERENCIA_FC', 'APERTURA_CAJA', 'DEPOSITO_FONDO', 'REINTEGRO_FONDO')`;

// `DEPOSITO_CIERRE` se clasifica siempre como INGRESO: es el reporte del
// impacto neto de una sesión de caja sobre CC. Su TOTAL puede ser negativo
// (cuando los egresos superan a ventas + aporte) — en ese caso aparece como
// "ingreso negativo", pero no es un egreso manual. La idea es que CC siempre
// reciba los registros de los métodos de pago que vienen desde caja.
const CIERRE_TIPO_ENTIDAD = `'DEPOSITO_CIERRE'`;

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

async function getChequesEnCarteraResumen(connectionPool: any) {
  const exists = await connectionPool.request().query(`
    SELECT CASE WHEN OBJECT_ID(N'[dbo].[CHEQUES]', N'U') IS NULL THEN 0 ELSE 1 END AS existe
  `);

  if (!exists.recordset[0]?.existe) {
    return { chequesEnCartera: 0, chequesEnCarteraCantidad: 0 };
  }

  const result = await connectionPool.request().query(`
    SELECT
      ISNULL(SUM(CASE WHEN ESTADO = 'EN_CARTERA' THEN IMPORTE ELSE 0 END), 0) AS chequesEnCartera,
      ISNULL(SUM(CASE WHEN ESTADO = 'EN_CARTERA' THEN 1 ELSE 0 END), 0) AS chequesEnCarteraCantidad
    FROM CHEQUES
  `);

  const row = result.recordset[0] || {};
  return {
    chequesEnCartera: Number(row.chequesEnCartera) || 0,
    chequesEnCarteraCantidad: Number(row.chequesEnCarteraCantidad) || 0,
  };
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
      where += ` AND (m.PUNTO_VENTA_ID IN (${pvPlaceholders}) OR (m.TIPO_ENTIDAD = 'CHEQUE' AND m.PUNTO_VENTA_ID IS NULL) OR (m.TIPO_ENTIDAD IN ('COMPRA', 'ORDEN_PAGO', 'COBRANZA') AND m.PUNTO_VENTA_ID IS NULL AND ISNULL(m.CHEQUES, 0) <> 0))`;
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

    // Sólo movimientos operativos (excluye transferencias internas)
    const whereOperativos = where + ` AND m.TIPO_ENTIDAD NOT IN ${INTERNAL_TYPES_SQL}`;

    const result = await bind(pool.request()).query(`
      SELECT m.*, u.NOMBRE AS USUARIO_NOMBRE
      FROM MOVIMIENTOS_CAJA m
      LEFT JOIN USUARIOS u ON m.USUARIO_ID = u.USUARIO_ID
      ${whereOperativos}
      ORDER BY m.FECHA DESC
    `);

    const all: MovimientoCaja[] = result.recordset;

    // DEPOSITO_CIERRE siempre va a INGRESOS aunque su TOTAL sea negativo
    // (refleja el impacto neto de la sesión, no un egreso manual).
    const ingresos = all.filter(m => m.TOTAL >= 0 || m.TIPO_ENTIDAD === 'DEPOSITO_CIERRE');
    const egresos = all.filter(m => m.TOTAL < 0 && m.TIPO_ENTIDAD !== 'DEPOSITO_CIERRE');

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
      where += ` AND (m.PUNTO_VENTA_ID IN (${pvPlaceholders}) OR (m.TIPO_ENTIDAD = 'CHEQUE' AND m.PUNTO_VENTA_ID IS NULL) OR (m.TIPO_ENTIDAD IN ('COMPRA', 'ORDEN_PAGO', 'COBRANZA') AND m.PUNTO_VENTA_ID IS NULL AND ISNULL(m.CHEQUES, 0) <> 0))`;
      filter.puntoVentaIds.forEach((id, i) => {
        params.push({ name: `pv${i}`, type: sql.Int, value: id });
      });
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    // Movimientos operativos: excluye tipos internos
    const whereOperativos = where + ` AND m.TIPO_ENTIDAD NOT IN ${INTERNAL_TYPES_SQL}`;

    const totalesResult = await bind(pool.request()).query(`
      SELECT
        ISNULL(SUM(CASE WHEN (TOTAL >= 0 OR TIPO_ENTIDAD = ${CIERRE_TIPO_ENTIDAD}) THEN TOTAL ELSE 0 END), 0) AS totalIngresos,
        ISNULL(SUM(CASE WHEN TOTAL < 0 AND TIPO_ENTIDAD <> ${CIERRE_TIPO_ENTIDAD} THEN ABS(TOTAL) ELSE 0 END), 0) AS totalEgresos,
        ISNULL(SUM(TOTAL), 0) AS balance,
        ISNULL(SUM(DIGITAL), 0) AS digital,
        ISNULL(SUM(CHEQUES), 0) AS cheques,
        ISNULL(SUM(CTA_CTE), 0) AS cta_cte
      FROM MOVIMIENTOS_CAJA m
      ${whereOperativos}
    `);

    const efectivoResult = await bind(pool.request()).query(`
      SELECT ISNULL(SUM(EFECTIVO), 0) AS efectivo
      FROM MOVIMIENTOS_CAJA m
      ${whereOperativos}
    `);

    const chequesResumen = await getChequesEnCarteraResumen(pool);
    const row = totalesResult.recordset[0] || {};
    const efectivo = Number(efectivoResult.recordset[0]?.efectivo) || 0;
    const digital = Number(row.digital) || 0;
    const cheques = Number(row.cheques) || 0;
    const ctaCte = Number(row.cta_cte) || 0;
    const balance = Number(row.balance) || 0;
    const totalMetodos = efectivo + digital + cheques + ctaCte;

    return {
      ...row,
      efectivo,
      totalMetodos,
      diferenciaMetodosBalance: balance - totalMetodos,
      ...chequesResumen,
    };
  },

  // ── Get historical balance (all time) ──────────
  async getBalanceHistorico(puntoVentaIds?: number[]) {
    const pool = await getPool();
    const req = pool.request();
    let pvFilter = '';

    if (puntoVentaIds && puntoVentaIds.length > 0) {
      const pvPlaceholders = puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      pvFilter = `WHERE (PUNTO_VENTA_ID IN (${pvPlaceholders}) OR (TIPO_ENTIDAD = 'CHEQUE' AND PUNTO_VENTA_ID IS NULL) OR (TIPO_ENTIDAD IN ('COMPRA', 'ORDEN_PAGO', 'COBRANZA') AND PUNTO_VENTA_ID IS NULL AND ISNULL(CHEQUES, 0) <> 0))`;
      puntoVentaIds.forEach((id, i) => {
        req.input(`pv${i}`, sql.Int, id);
      });
    }

    const whereOperativos = pvFilter
      ? pvFilter + ` AND TIPO_ENTIDAD NOT IN ${INTERNAL_TYPES_SQL}`
      : `WHERE TIPO_ENTIDAD NOT IN ${INTERNAL_TYPES_SQL}`;

    const totalesResult = await req.query(`
      SELECT
        ISNULL(SUM(CASE WHEN (TOTAL >= 0 OR TIPO_ENTIDAD = ${CIERRE_TIPO_ENTIDAD}) THEN TOTAL ELSE 0 END), 0) AS totalIngresos,
        ISNULL(SUM(CASE WHEN TOTAL < 0 AND TIPO_ENTIDAD <> ${CIERRE_TIPO_ENTIDAD} THEN ABS(TOTAL) ELSE 0 END), 0) AS totalEgresos,
        ISNULL(SUM(TOTAL), 0) AS balance,
        ISNULL(SUM(DIGITAL), 0) AS digital,
        ISNULL(SUM(CHEQUES), 0) AS cheques,
        ISNULL(SUM(CTA_CTE), 0) AS cta_cte
      FROM MOVIMIENTOS_CAJA
      ${whereOperativos}
    `);

    const reqEfectivo = pool.request();
    if (puntoVentaIds && puntoVentaIds.length > 0) {
      puntoVentaIds.forEach((id, i) => {
        reqEfectivo.input(`pv${i}`, sql.Int, id);
      });
    }
    const efectivoResult = await reqEfectivo.query(`
      SELECT ISNULL(SUM(EFECTIVO), 0) AS efectivo
      FROM MOVIMIENTOS_CAJA
      ${whereOperativos}
    `);

    const chequesResumen = await getChequesEnCarteraResumen(pool);
    const row = totalesResult.recordset[0] || {};
    const efectivo = Number(efectivoResult.recordset[0]?.efectivo) || 0;
    const digital = Number(row.digital) || 0;
    const cheques = Number(row.cheques) || 0;
    const ctaCte = Number(row.cta_cte) || 0;
    const balance = Number(row.balance) || 0;
    const totalMetodos = efectivo + digital + cheques + ctaCte;

    return {
      ...row,
      efectivo,
      totalMetodos,
      diferenciaMetodosBalance: balance - totalMetodos,
      ...chequesResumen,
    };
  },

  // ── Create manual movement ─────────────────────
  async crearMovimiento(input: NuevoMovimientoInput, usuarioId: number, puntoVentaId?: number) {
    const pool = await getPool();

    let efectivo = 0;
    let digital = 0;
    let cheques = 0;
    const metodos = input.metodos_pago || [];
    if (metodos.length > 0) {
      const mpIds = metodos.map(m => m.METODO_PAGO_ID);
      const ph = mpIds.map((_, i) => `@mp${i}`).join(', ');
      const catReq = pool.request();
      mpIds.forEach((id, i) => catReq.input(`mp${i}`, sql.Int, id));
      const catResult = await catReq.query(`SELECT METODO_PAGO_ID, CATEGORIA FROM METODOS_PAGO WHERE METODO_PAGO_ID IN (${ph})`);
      const catMap: Record<number, string> = {};
      for (const r of catResult.recordset) catMap[r.METODO_PAGO_ID] = r.CATEGORIA;
      for (const m of metodos) {
        if (catMap[m.METODO_PAGO_ID] === 'EFECTIVO') efectivo += m.MONTO;
        else if (catMap[m.METODO_PAGO_ID] === 'CHEQUES') cheques += m.MONTO;
        else digital += m.MONTO;
      }
    }

    const total = efectivo + digital + cheques;
    const sign = input.tipo === 'EGRESO' ? -1 : 1;

    const result = await pool.request()
      .input('tipoEntidad', sql.VarChar(20), input.tipo)
      .input('movimiento', sql.NVarChar(500), input.descripcion)
      .input('uid', sql.Int, usuarioId)
      .input('efectivo', sql.Decimal(18, 2), sign * efectivo)
      .input('digital', sql.Decimal(18, 2), sign * digital)
      .input('cheques', sql.Decimal(18, 2), sign * cheques)
      .input('ctaCte', sql.Decimal(18, 2), 0)
      .input('total', sql.Decimal(18, 2), sign * total)
      .input('pvId', sql.Int, puntoVentaId || null)
      .query(`
        INSERT INTO MOVIMIENTOS_CAJA (TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
        OUTPUT INSERTED.ID
        VALUES (@tipoEntidad, @movimiento, @uid, @efectivo, @digital, @cheques, @ctaCte, @total, @pvId, 1)
      `);

    const movId = result.recordset[0].ID;

    if (metodos.length > 0) {
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

    const mov = await pool.request()
      .input('id', sql.Int, movimientoId)
      .query(`SELECT EFECTIVO, DIGITAL, CHEQUES FROM MOVIMIENTOS_CAJA WHERE ID = @id`);
    if (mov.recordset.length === 0) return [];

    const { EFECTIVO, DIGITAL, CHEQUES } = mov.recordset[0];
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
    if (CHEQUES && CHEQUES !== 0) {
      const ch = await pool.request().query(`SELECT TOP 1 METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64 FROM METODOS_PAGO WHERE CATEGORIA = 'CHEQUES' AND ACTIVA = 1 ORDER BY POR_DEFECTO DESC`);
      if (ch.recordset.length > 0) {
        fallback.push({ ...ch.recordset[0], TOTAL: CHEQUES });
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
