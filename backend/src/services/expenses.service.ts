import { getPool, sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  Gastos y Servicios — Service
//
//  Registers expenses (light, water, salaries, etc.).
//  Each expense generates an EGRESO record in MOVIMIENTOS_CAJA
//  with TIPO_ENTIDAD = 'GASTO' for traceability.
// ═══════════════════════════════════════════════════

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ── Lazy table ensure helpers ─────────────────────

let _gastosTableReady = false;
async function ensureGastosTable(poolOrTx: any): Promise<void> {
  if (_gastosTableReady) return;
  await poolOrTx.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GASTOS_SERVICIOS')
    CREATE TABLE GASTOS_SERVICIOS (
      GASTO_ID    INT IDENTITY(1,1) PRIMARY KEY,
      ENTIDAD     NVARCHAR(100)   NOT NULL,
      DESCRIPCION NVARCHAR(255)   NULL,
      MONTO       DECIMAL(18,2)   NOT NULL,
      FECHA       DATETIME        NOT NULL,
      COMPRA_ID   INT             NULL,
      CATEGORIA   NVARCHAR(50)    NULL,
      USUARIO_ID  INT             NULL,
      PUNTO_VENTA_ID INT          NULL,
      EFECTIVO    DECIMAL(18,2)   NOT NULL DEFAULT 0,
      DIGITAL     DECIMAL(18,2)   NOT NULL DEFAULT 0,
      CHEQUES     DECIMAL(18,2)   NOT NULL DEFAULT 0,
      CTA_CTE     DECIMAL(18,2)   NOT NULL DEFAULT 0,
      MOVIMIENTO_CAJA_ID INT      NULL
    )
  `);
  // Add columns idempotently for environments where the legacy table is present.
  const cols: { col: string; def: string }[] = [
    { col: 'CATEGORIA',          def: 'NVARCHAR(50) NULL' },
    { col: 'USUARIO_ID',         def: 'INT NULL' },
    { col: 'PUNTO_VENTA_ID',     def: 'INT NULL' },
    { col: 'EFECTIVO',           def: 'DECIMAL(18,2) NOT NULL CONSTRAINT DF_GASTOS_SERVICIOS_EFECTIVO DEFAULT 0' },
    { col: 'DIGITAL',            def: 'DECIMAL(18,2) NOT NULL CONSTRAINT DF_GASTOS_SERVICIOS_DIGITAL DEFAULT 0' },
    { col: 'CHEQUES',            def: 'DECIMAL(18,2) NOT NULL CONSTRAINT DF_GASTOS_SERVICIOS_CHEQUES DEFAULT 0' },
    { col: 'CTA_CTE',            def: 'DECIMAL(18,2) NOT NULL CONSTRAINT DF_GASTOS_SERVICIOS_CTA_CTE DEFAULT 0' },
    { col: 'MOVIMIENTO_CAJA_ID', def: 'INT NULL' },
  ];
  for (const c of cols) {
    await poolOrTx.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('GASTOS_SERVICIOS') AND name = '${c.col}')
        ALTER TABLE GASTOS_SERVICIOS ADD ${c.col} ${c.def}
    `);
  }
  _gastosTableReady = true;
}

let _gastosMetodosPagoTableReady = false;
async function ensureGastosMetodosPagoTable(poolOrTx: any): Promise<void> {
  if (_gastosMetodosPagoTableReady) return;
  await poolOrTx.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'GASTOS_SERVICIOS_METODOS_PAGO')
    CREATE TABLE GASTOS_SERVICIOS_METODOS_PAGO (
      ID             INT IDENTITY(1,1) PRIMARY KEY,
      GASTO_ID       INT NOT NULL,
      METODO_PAGO_ID INT NOT NULL,
      MONTO          DECIMAL(18,2) NOT NULL
    )
  `);
  _gastosMetodosPagoTableReady = true;
}

let _movCajaMetodosPagoTableReady = false;
async function ensureMovCajaMetodosPagoTable(poolOrTx: any): Promise<void> {
  if (_movCajaMetodosPagoTableReady) return;
  await poolOrTx.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MOVIMIENTOS_CAJA_METODOS_PAGO')
    CREATE TABLE MOVIMIENTOS_CAJA_METODOS_PAGO (
      ID INT IDENTITY(1,1) PRIMARY KEY,
      MOVIMIENTO_ID INT NOT NULL,
      METODO_PAGO_ID INT NOT NULL,
      MONTO DECIMAL(18,2) NOT NULL
    )
  `);
  _movCajaMetodosPagoTableReady = true;
}

// ── Types ─────────────────────────────────────────

export interface MetodoPagoItem {
  METODO_PAGO_ID: number;
  MONTO: number;
}

export interface GastoServicioItem {
  GASTO_ID: number;
  ENTIDAD: string;
  DESCRIPCION: string | null;
  CATEGORIA: string | null;
  MONTO: number;
  FECHA: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  CTA_CTE: number;
  USUARIO_ID: number | null;
  USUARIO_NOMBRE: string | null;
  PUNTO_VENTA_ID: number | null;
  MOVIMIENTO_CAJA_ID: number | null;
}

export interface GastoServicioInput {
  ENTIDAD: string;
  DESCRIPCION?: string;
  CATEGORIA?: string;
  FECHA: string;
  metodos_pago?: MetodoPagoItem[];
  puntoVentaId?: number;
}

export interface GastoServicioFilter {
  fechaDesde?: string;
  fechaHasta?: string;
  search?: string;
  puntoVentaIds?: number[];
}

// ── Helpers ───────────────────────────────────────

async function derivarCategorias(
  tx: any,
  metodosPago: MetodoPagoItem[],
): Promise<{ efectivo: number; digital: number }> {
  let efectivo = 0;
  let digital = 0;
  for (const mp of metodosPago) {
    if (mp.MONTO <= 0) continue;
    const cat = await tx.request()
      .input('mid', sql.Int, mp.METODO_PAGO_ID)
      .query(`SELECT CATEGORIA FROM METODOS_PAGO WHERE METODO_PAGO_ID = @mid`);
    const categoria = cat.recordset[0]?.CATEGORIA || 'EFECTIVO';
    if (categoria === 'DIGITAL') digital += mp.MONTO;
    else efectivo += mp.MONTO;
  }
  return { efectivo: r2(efectivo), digital: r2(digital) };
}

async function getCajaAbiertaTx(tx: any, usuarioId: number): Promise<{ CAJA_ID: number; PUNTO_VENTA_ID: number | null } | null> {
  const result = await tx.request()
    .input('uid', sql.Int, usuarioId)
    .query(`
      SELECT TOP 1 CAJA_ID, PUNTO_VENTA_ID FROM CAJA
      WHERE USUARIO_ID = @uid AND ESTADO = 'ABIERTA'
      ORDER BY FECHA_APERTURA DESC
    `);
  return result.recordset[0] || null;
}

async function registrarEgresoCajaCentral(
  tx: any,
  gastoId: number,
  descripcion: string,
  efectivo: number,
  digital: number,
  cheques: number,
  metodosPago: MetodoPagoItem[],
  usuarioId: number,
  puntoVentaId: number | null,
): Promise<number> {
  const totalEgreso = r2(efectivo + digital + cheques);
  const movResult = await tx.request()
    .input('idEntidad', sql.Int, gastoId)
    .input('tipoEntidad', sql.VarChar(20), 'GASTO')
    .input('movimiento', sql.NVarChar(500), descripcion)
    .input('uid', sql.Int, usuarioId)
    .input('efectivo', sql.Decimal(18, 2), -efectivo)
    .input('digital', sql.Decimal(18, 2), -digital)
    .input('cheques', sql.Decimal(18, 2), -cheques)
    .input('total', sql.Decimal(18, 2), -totalEgreso)
    .input('pvId', sql.Int, puntoVentaId)
    .query(`
      INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
      OUTPUT INSERTED.ID
      VALUES (@idEntidad, @tipoEntidad, @movimiento, @uid, @efectivo, @digital, @cheques, 0, @total, @pvId, 0)
    `);
  const movId = movResult.recordset[0].ID;

  if (metodosPago.length > 0) {
    await ensureMovCajaMetodosPagoTable(tx);
    for (const mp of metodosPago) {
      if (mp.MONTO <= 0) continue;
      await tx.request()
        .input('movId', sql.Int, movId)
        .input('mpId', sql.Int, mp.METODO_PAGO_ID)
        .input('monto', sql.Decimal(18, 2), -r2(mp.MONTO))
        .query(`INSERT INTO MOVIMIENTOS_CAJA_METODOS_PAGO (MOVIMIENTO_ID, METODO_PAGO_ID, MONTO) VALUES (@movId, @mpId, @monto)`);
    }
  }
  return movId;
}

async function eliminarEgresoCajaCentral(tx: any, gastoId: number): Promise<void> {
  await ensureMovCajaMetodosPagoTable(tx);
  await tx.request().input('id', sql.Int, gastoId)
    .query(`DELETE FROM MOVIMIENTOS_CAJA_METODOS_PAGO WHERE MOVIMIENTO_ID IN (SELECT ID FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @id AND TIPO_ENTIDAD = 'GASTO')`);
  await tx.request().input('id', sql.Int, gastoId)
    .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @id AND TIPO_ENTIDAD = 'GASTO'`);
}

// ═══════════════════════════════════════════════════
//  Service
// ═══════════════════════════════════════════════════

export const expensesService = {
  // ── List gastos ────────────────────────────────
  async getAll(filter: GastoServicioFilter = {}): Promise<GastoServicioItem[]> {
    const pool = await getPool();
    await ensureGastosTable(pool);

    const req = pool.request();
    let where = 'WHERE 1=1';

    if (filter.fechaDesde) {
      where += ' AND g.FECHA >= @fechaDesde';
      req.input('fechaDesde', sql.DateTime, new Date(filter.fechaDesde + 'T00:00:00'));
    }
    if (filter.fechaHasta) {
      where += ' AND g.FECHA <= @fechaHasta';
      req.input('fechaHasta', sql.DateTime, new Date(filter.fechaHasta + 'T23:59:59'));
    }
    if (filter.search) {
      where += ' AND (g.ENTIDAD LIKE @search OR g.DESCRIPCION LIKE @search OR g.CATEGORIA LIKE @search)';
      req.input('search', sql.NVarChar, `%${filter.search}%`);
    }
    if (filter.puntoVentaIds && filter.puntoVentaIds.length > 0) {
      const ph = filter.puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      where += ` AND g.PUNTO_VENTA_ID IN (${ph})`;
      filter.puntoVentaIds.forEach((id, i) => req.input(`pv${i}`, sql.Int, id));
    }

    const result = await req.query(`
      SELECT
        g.GASTO_ID, g.ENTIDAD, g.DESCRIPCION, g.CATEGORIA, g.MONTO, g.FECHA,
        ISNULL(g.EFECTIVO, 0)  AS EFECTIVO,
        ISNULL(g.DIGITAL, 0)   AS DIGITAL,
        ISNULL(g.CHEQUES, 0)   AS CHEQUES,
        ISNULL(g.CTA_CTE, 0)   AS CTA_CTE,
        g.USUARIO_ID,
        u.NOMBRE AS USUARIO_NOMBRE,
        g.PUNTO_VENTA_ID,
        g.MOVIMIENTO_CAJA_ID
      FROM GASTOS_SERVICIOS g
      LEFT JOIN USUARIOS u ON g.USUARIO_ID = u.USUARIO_ID
      ${where}
      ORDER BY g.FECHA DESC, g.GASTO_ID DESC
    `);

    return result.recordset as GastoServicioItem[];
  },

  // ── Get single gasto ───────────────────────────
  async getById(gastoId: number): Promise<GastoServicioItem & { metodos_pago: MetodoPagoItem[] }> {
    const pool = await getPool();
    await ensureGastosTable(pool);

    const result = await pool.request()
      .input('id', sql.Int, gastoId)
      .query(`
        SELECT
          g.GASTO_ID, g.ENTIDAD, g.DESCRIPCION, g.CATEGORIA, g.MONTO, g.FECHA,
          ISNULL(g.EFECTIVO, 0)  AS EFECTIVO,
          ISNULL(g.DIGITAL, 0)   AS DIGITAL,
          ISNULL(g.CHEQUES, 0)   AS CHEQUES,
          ISNULL(g.CTA_CTE, 0)   AS CTA_CTE,
          g.USUARIO_ID,
          u.NOMBRE AS USUARIO_NOMBRE,
          g.PUNTO_VENTA_ID,
          g.MOVIMIENTO_CAJA_ID
        FROM GASTOS_SERVICIOS g
        LEFT JOIN USUARIOS u ON g.USUARIO_ID = u.USUARIO_ID
        WHERE g.GASTO_ID = @id
      `);

    if (result.recordset.length === 0) {
      throw new ValidationError('Gasto no encontrado');
    }

    await ensureGastosMetodosPagoTable(pool);
    const mpResult = await pool.request()
      .input('id', sql.Int, gastoId)
      .query(`SELECT METODO_PAGO_ID, MONTO FROM GASTOS_SERVICIOS_METODOS_PAGO WHERE GASTO_ID = @id`);

    return { ...result.recordset[0], metodos_pago: mpResult.recordset };
  },

  // ── Active payment methods ─────────────────────
  async getActivePaymentMethods() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64, ACTIVA, POR_DEFECTO
      FROM METODOS_PAGO
      WHERE ACTIVA = 1
      ORDER BY POR_DEFECTO DESC, CATEGORIA, NOMBRE
    `);
    return result.recordset;
  },

  // ── Aggregated payment method totals ───────────
  async getMetodosTotales(filter: GastoServicioFilter = {}) {
    const pool = await getPool();
    await ensureGastosMetodosPagoTable(pool);
    await ensureGastosTable(pool);

    const req = pool.request();
    let where = 'WHERE gpm.MONTO > 0';

    if (filter.fechaDesde) {
      where += ' AND g.FECHA >= @fechaDesde';
      req.input('fechaDesde', sql.DateTime, new Date(filter.fechaDesde + 'T00:00:00'));
    }
    if (filter.fechaHasta) {
      where += ' AND g.FECHA <= @fechaHasta';
      req.input('fechaHasta', sql.DateTime, new Date(filter.fechaHasta + 'T23:59:59'));
    }
    if (filter.search) {
      where += ' AND (g.ENTIDAD LIKE @search OR g.DESCRIPCION LIKE @search OR g.CATEGORIA LIKE @search)';
      req.input('search', sql.NVarChar, `%${filter.search}%`);
    }
    if (filter.puntoVentaIds && filter.puntoVentaIds.length > 0) {
      const ph = filter.puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      where += ` AND g.PUNTO_VENTA_ID IN (${ph})`;
      filter.puntoVentaIds.forEach((id, i) => req.input(`pv${i}`, sql.Int, id));
    }

    const result = await req.query(`
      SELECT
        mp.NOMBRE AS METODO_NOMBRE,
        mp.CATEGORIA,
        ISNULL(mp.IMAGEN_BASE64, '') AS IMAGEN_BASE64,
        SUM(gpm.MONTO) AS TOTAL
      FROM GASTOS_SERVICIOS_METODOS_PAGO gpm
      INNER JOIN GASTOS_SERVICIOS g ON gpm.GASTO_ID = g.GASTO_ID
      INNER JOIN METODOS_PAGO mp ON gpm.METODO_PAGO_ID = mp.METODO_PAGO_ID
      ${where}
      GROUP BY mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64
      ORDER BY mp.CATEGORIA, SUM(gpm.MONTO) DESC
    `);

    return result.recordset as { METODO_NOMBRE: string; CATEGORIA: string; IMAGEN_BASE64: string; TOTAL: number }[];
  },

  // ── List distinct entidades for autocomplete ───
  async getEntidades(): Promise<string[]> {
    const pool = await getPool();
    await ensureGastosTable(pool);
    const result = await pool.request().query(`
      SELECT DISTINCT TOP 100 ENTIDAD FROM GASTOS_SERVICIOS
      WHERE ENTIDAD IS NOT NULL AND ENTIDAD <> ''
      ORDER BY ENTIDAD
    `);
    return result.recordset.map((r: any) => r.ENTIDAD);
  },

  // ── Create gasto ───────────────────────────────
  async crear(input: GastoServicioInput, usuarioId: number): Promise<{ GASTO_ID: number }> {
    if (!input.ENTIDAD || !input.ENTIDAD.trim()) {
      throw new ValidationError('Debe indicar la entidad / proveedor del gasto');
    }
    if (!input.metodos_pago || input.metodos_pago.length === 0) {
      throw new ValidationError('Debe seleccionar al menos un método de pago');
    }

    const pool = await getPool();
    await ensureGastosTable(pool);
    await ensureGastosMetodosPagoTable(pool);

    const tx = pool.transaction();
    await tx.begin();

    try {
      const metodosValidos = input.metodos_pago.filter(m => m.MONTO > 0);
      if (metodosValidos.length === 0) {
        throw new ValidationError('Los montos deben ser mayores a cero');
      }

      const { efectivo, digital } = await derivarCategorias(tx, metodosValidos);
      const cheques = 0;
      const total = r2(efectivo + digital + cheques);
      if (total <= 0) {
        throw new ValidationError('El total debe ser mayor a cero');
      }

      // Resolve PV from caja (if any)
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      const pvId = input.puntoVentaId ?? caja?.PUNTO_VENTA_ID ?? null;

      // 1) Insert gasto
      const insertResult = await tx.request()
        .input('entidad',     sql.NVarChar(100), input.ENTIDAD.trim())
        .input('descripcion', sql.NVarChar(255), input.DESCRIPCION?.trim() || null)
        .input('categoria',   sql.NVarChar(50),  input.CATEGORIA?.trim() || null)
        .input('monto',       sql.Decimal(18, 2), total)
        .input('fecha',       sql.DateTime,       new Date(input.FECHA))
        .input('efectivo',    sql.Decimal(18, 2), efectivo)
        .input('digital',     sql.Decimal(18, 2), digital)
        .input('cheques',     sql.Decimal(18, 2), cheques)
        .input('ctaCte',      sql.Decimal(18, 2), 0)
        .input('uid',         sql.Int,            usuarioId)
        .input('pvId',        sql.Int,            pvId)
        .query(`
          INSERT INTO GASTOS_SERVICIOS
            (ENTIDAD, DESCRIPCION, CATEGORIA, MONTO, FECHA,
             EFECTIVO, DIGITAL, CHEQUES, CTA_CTE,
             USUARIO_ID, PUNTO_VENTA_ID)
          OUTPUT INSERTED.GASTO_ID
          VALUES (@entidad, @descripcion, @categoria, @monto, @fecha,
                  @efectivo, @digital, @cheques, @ctaCte,
                  @uid, @pvId)
        `);

      const gastoId = insertResult.recordset[0].GASTO_ID;

      // 2) Insert payment method breakdown
      for (const mp of metodosValidos) {
        await tx.request()
          .input('gastoId', sql.Int, gastoId)
          .input('mpId',    sql.Int, mp.METODO_PAGO_ID)
          .input('monto',   sql.Decimal(18, 2), r2(mp.MONTO))
          .query(`INSERT INTO GASTOS_SERVICIOS_METODOS_PAGO (GASTO_ID, METODO_PAGO_ID, MONTO) VALUES (@gastoId, @mpId, @monto)`);
      }

      // 3) Register egreso in MOVIMIENTOS_CAJA (Caja Central)
      const descEgreso = `Gasto #${gastoId} - ${input.ENTIDAD.trim()}`;
      const movId = await registrarEgresoCajaCentral(
        tx, gastoId, descEgreso, efectivo, digital, cheques, metodosValidos, usuarioId, pvId,
      );

      // 4) Save MOVIMIENTO_CAJA_ID for traceability back from gasto detail
      await tx.request()
        .input('id', sql.Int, gastoId)
        .input('movId', sql.Int, movId)
        .query(`UPDATE GASTOS_SERVICIOS SET MOVIMIENTO_CAJA_ID = @movId WHERE GASTO_ID = @id`);

      await tx.commit();
      return { GASTO_ID: gastoId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update gasto ───────────────────────────────
  async actualizar(gastoId: number, input: GastoServicioInput, usuarioId: number): Promise<void> {
    if (!input.ENTIDAD || !input.ENTIDAD.trim()) {
      throw new ValidationError('Debe indicar la entidad / proveedor del gasto');
    }
    if (!input.metodos_pago || input.metodos_pago.length === 0) {
      throw new ValidationError('Debe seleccionar al menos un método de pago');
    }

    const pool = await getPool();
    await ensureGastosTable(pool);
    await ensureGastosMetodosPagoTable(pool);

    const tx = pool.transaction();
    await tx.begin();

    try {
      const exists = await tx.request()
        .input('id', sql.Int, gastoId)
        .query(`SELECT GASTO_ID, USUARIO_ID, PUNTO_VENTA_ID FROM GASTOS_SERVICIOS WHERE GASTO_ID = @id`);
      if (exists.recordset.length === 0) {
        throw new ValidationError('Gasto no encontrado');
      }

      const metodosValidos = input.metodos_pago.filter(m => m.MONTO > 0);
      if (metodosValidos.length === 0) {
        throw new ValidationError('Los montos deben ser mayores a cero');
      }

      const { efectivo, digital } = await derivarCategorias(tx, metodosValidos);
      const cheques = 0;
      const total = r2(efectivo + digital + cheques);
      if (total <= 0) {
        throw new ValidationError('El total debe ser mayor a cero');
      }

      // 1) Update master record
      await tx.request()
        .input('id',          sql.Int,            gastoId)
        .input('entidad',     sql.NVarChar(100),  input.ENTIDAD.trim())
        .input('descripcion', sql.NVarChar(255),  input.DESCRIPCION?.trim() || null)
        .input('categoria',   sql.NVarChar(50),   input.CATEGORIA?.trim() || null)
        .input('monto',       sql.Decimal(18, 2), total)
        .input('fecha',       sql.DateTime,       new Date(input.FECHA))
        .input('efectivo',    sql.Decimal(18, 2), efectivo)
        .input('digital',     sql.Decimal(18, 2), digital)
        .input('cheques',     sql.Decimal(18, 2), cheques)
        .query(`
          UPDATE GASTOS_SERVICIOS SET
            ENTIDAD = @entidad,
            DESCRIPCION = @descripcion,
            CATEGORIA = @categoria,
            MONTO = @monto,
            FECHA = @fecha,
            EFECTIVO = @efectivo,
            DIGITAL = @digital,
            CHEQUES = @cheques,
            CTA_CTE = 0
          WHERE GASTO_ID = @id
        `);

      // 2) Replace payment method breakdown
      await tx.request().input('id', sql.Int, gastoId)
        .query(`DELETE FROM GASTOS_SERVICIOS_METODOS_PAGO WHERE GASTO_ID = @id`);
      for (const mp of metodosValidos) {
        await tx.request()
          .input('gastoId', sql.Int, gastoId)
          .input('mpId',    sql.Int, mp.METODO_PAGO_ID)
          .input('monto',   sql.Decimal(18, 2), r2(mp.MONTO))
          .query(`INSERT INTO GASTOS_SERVICIOS_METODOS_PAGO (GASTO_ID, METODO_PAGO_ID, MONTO) VALUES (@gastoId, @mpId, @monto)`);
      }

      // 3) Replace egreso in Caja Central
      await eliminarEgresoCajaCentral(tx, gastoId);

      const pvId = input.puntoVentaId ?? exists.recordset[0].PUNTO_VENTA_ID ?? null;
      const descEgreso = `Gasto #${gastoId} - ${input.ENTIDAD.trim()}`;
      const movId = await registrarEgresoCajaCentral(
        tx, gastoId, descEgreso, efectivo, digital, cheques, metodosValidos, usuarioId, pvId,
      );

      await tx.request()
        .input('id', sql.Int, gastoId)
        .input('movId', sql.Int, movId)
        .query(`UPDATE GASTOS_SERVICIOS SET MOVIMIENTO_CAJA_ID = @movId WHERE GASTO_ID = @id`);

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete gasto ───────────────────────────────
  async eliminar(gastoId: number): Promise<void> {
    const pool = await getPool();
    await ensureGastosTable(pool);
    await ensureGastosMetodosPagoTable(pool);

    const tx = pool.transaction();
    await tx.begin();

    try {
      // 1) Remove caja central egreso
      await eliminarEgresoCajaCentral(tx, gastoId);

      // 2) Remove method breakdown
      await tx.request().input('id', sql.Int, gastoId)
        .query(`DELETE FROM GASTOS_SERVICIOS_METODOS_PAGO WHERE GASTO_ID = @id`);

      // 3) Remove gasto
      const del = await tx.request().input('id', sql.Int, gastoId)
        .query(`DELETE FROM GASTOS_SERVICIOS WHERE GASTO_ID = @id`);

      if (del.rowsAffected[0] === 0) {
        throw new ValidationError('Gasto no encontrado');
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },
};
