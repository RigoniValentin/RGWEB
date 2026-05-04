import { getPool, sql } from '../database/connection.js';
import { marcarChequesEgresados, revertirEgresoCheques } from './cheques.service.js';

// ═══════════════════════════════════════════════════
//  Cuenta Corriente Proveedores — Service
// ═══════════════════════════════════════════════════

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── MOVIMIENTOS_CAJA_METODOS_PAGO table helper ──

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

// ── ORDENES_PAGO_METODOS_PAGO table helper ──

let _ordenesPagoMetodosPagoTableReady = false;

async function ensureOrdenesPagoMetodosPagoTable(poolOrTx: any): Promise<void> {
  if (_ordenesPagoMetodosPagoTableReady) return;
  await poolOrTx.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'ORDENES_PAGO_METODOS_PAGO')
    CREATE TABLE ORDENES_PAGO_METODOS_PAGO (
      ID INT IDENTITY(1,1) PRIMARY KEY,
      PAGO_ID INT NOT NULL,
      METODO_PAGO_ID INT NOT NULL,
      MONTO DECIMAL(18,2) NOT NULL
    )
  `);
  _ordenesPagoMetodosPagoTableReady = true;
}

/** Derive EFECTIVO / DIGITAL / CHEQUES totals from metodos_pago */
async function derivarCategoriasOP(
  tx: any,
  metodosPago: OrdenPagoMetodoPagoItem[]
): Promise<{ efectivo: number; digital: number; cheques: number }> {
  let efectivo = 0;
  let digital = 0;
  let cheques = 0;
  for (const mp of metodosPago) {
    if (mp.MONTO <= 0) continue;
    const cat = await tx.request()
      .input('mid', sql.Int, mp.METODO_PAGO_ID)
      .query(`SELECT CATEGORIA FROM METODOS_PAGO WHERE METODO_PAGO_ID = @mid`);
    const categoria = cat.recordset[0]?.CATEGORIA || 'EFECTIVO';
    if (categoria === 'DIGITAL') {
      digital += mp.MONTO;
    } else if (categoria === 'CHEQUES') {
      cheques += mp.MONTO;
    } else {
      efectivo += mp.MONTO;
    }
  }
  return { efectivo: r2(efectivo), digital: r2(digital), cheques: r2(cheques) };
}

export interface OrdenPagoMetodoPagoItem {
  METODO_PAGO_ID: number;
  MONTO: number;
}

export interface CtaCorrienteProvListItem {
  CTA_CORRIENTE_ID: number;
  PROVEEDOR_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  NUMERO_DOC: string;
  TELEFONO: string | null;
  ESTADO_CUENTA: string;
  SALDO_ACTUAL: number;
  ULTIMA_TRANSACCION: string | null;
  CANTIDAD_MOVIMIENTOS: number;
}

export interface MovimientoCtaCteProv {
  COMPROBANTE_ID: number;
  FECHA: string;
  CONCEPTO: string;
  TIPO_COMPROBANTE: string;
  DEBE: number;
  HABER: number;
  SALDO: number;
}

export interface OrdenPagoItem {
  PAGO_ID: number;
  CTA_CORRIENTE_ID: number;
  FECHA: string;
  TOTAL: number;
  CONCEPTO: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  USUARIO: string;
}

export interface OrdenPagoInput {
  FECHA: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  CONCEPTO: string;
  DESTINO_PAGO?: 'CAJA_CENTRAL' | 'CAJA';
  metodos_pago?: OrdenPagoMetodoPagoItem[];
  /** IDs de cheques EN_CARTERA a egresar como pago al proveedor. */
  cheques_ids?: number[];
}

export interface CtaCorrienteProvTotales {
  TOTAL_DEBE: number;
  TOTAL_HABER: number;
  SALDO: number;
}

export const ctaCorrienteProvService = {

  // ── List all suppliers with CTA_CORRIENTE = 1 ──
  async getAll(search?: string): Promise<CtaCorrienteProvListItem[]> {
    const pool = await getPool();
    const req = pool.request();

    let where = 'WHERE P.CTA_CORRIENTE = 1 AND P.ACTIVO = 1';

    if (search) {
      where += ' AND (P.NOMBRE LIKE @search OR P.CODIGOPARTICULAR LIKE @search OR P.NUMERO_DOC LIKE @search)';
      req.input('search', sql.NVarChar, `%${search}%`);
    }

    const result = await req.query(`
      SELECT 
        ISNULL(CTA.CTA_CORRIENTE_ID, 0) AS CTA_CORRIENTE_ID,
        P.PROVEEDOR_ID, 
        P.CODIGOPARTICULAR, 
        P.NOMBRE,
        P.NUMERO_DOC,
        P.TELEFONO,
        CASE 
          WHEN CTA.CTA_CORRIENTE_ID IS NULL THEN 'SIN_CREAR'
          WHEN NOT EXISTS (
            SELECT 1 FROM COMPRAS_CTA_CORRIENTE CC 
            WHERE CC.CTA_CORRIENTE_ID = CTA.CTA_CORRIENTE_ID
          ) THEN 'CREADA_SIN_MOV'
          ELSE 'ACTIVA'
        END AS ESTADO_CUENTA,
        ISNULL((
          SELECT SUM(DEBE - HABER) 
          FROM COMPRAS_CTA_CORRIENTE CC 
          WHERE CC.CTA_CORRIENTE_ID = CTA.CTA_CORRIENTE_ID
        ), 0) AS SALDO_ACTUAL,
        (
          SELECT TOP 1 CC.FECHA 
          FROM COMPRAS_CTA_CORRIENTE CC 
          WHERE CC.CTA_CORRIENTE_ID = CTA.CTA_CORRIENTE_ID
          ORDER BY CC.FECHA DESC
        ) AS ULTIMA_TRANSACCION,
        ISNULL((
          SELECT COUNT(*) 
          FROM COMPRAS_CTA_CORRIENTE CC 
          WHERE CC.CTA_CORRIENTE_ID = CTA.CTA_CORRIENTE_ID
        ), 0) AS CANTIDAD_MOVIMIENTOS
      FROM PROVEEDORES AS P
      LEFT JOIN CTA_CORRIENTE_P AS CTA ON P.PROVEEDOR_ID = CTA.PROVEEDOR_ID
      ${where}
      ORDER BY 
        CASE WHEN CTA.CTA_CORRIENTE_ID IS NULL THEN 0 ELSE 1 END,
        P.NOMBRE
    `);

    return result.recordset;
  },

  // ── Create account (CTA_CORRIENTE_P) ───────────
  async crearCuenta(proveedorId: number): Promise<{ CTA_CORRIENTE_ID: number }> {
    const pool = await getPool();

    // Check if already exists
    const check = await pool.request()
      .input('proveedorId', sql.Int, proveedorId)
      .query('SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_P WHERE PROVEEDOR_ID = @proveedorId');

    if (check.recordset.length > 0) {
      return { CTA_CORRIENTE_ID: check.recordset[0].CTA_CORRIENTE_ID };
    }

    const result = await pool.request()
      .input('proveedorId', sql.Int, proveedorId)
      .query(`
        INSERT INTO CTA_CORRIENTE_P (PROVEEDOR_ID, FECHA)
        OUTPUT INSERTED.CTA_CORRIENTE_ID
        VALUES (@proveedorId, GETDATE())
      `);

    return { CTA_CORRIENTE_ID: result.recordset[0].CTA_CORRIENTE_ID };
  },

  // ── Get movements (detalle) for a cta corriente ─
  async getMovimientos(
    ctaCorrienteId: number,
    fechaDesde?: string,
    fechaHasta?: string,
  ): Promise<{ movimientos: MovimientoCtaCteProv[]; saldoAnterior: number; totales: CtaCorrienteProvTotales }> {
    const pool = await getPool();

    // 1) Calculate saldo anterior (before fechaDesde)
    let saldoAnterior = 0;
    if (fechaDesde) {
      const sa = await pool.request()
        .input('id', sql.Int, ctaCorrienteId)
        .input('fechaDesde', sql.DateTime, new Date(fechaDesde))
        .query(`
          SELECT ISNULL(SUM(DEBE - HABER), 0) AS SALDO_ANTERIOR
          FROM COMPRAS_CTA_CORRIENTE 
          WHERE CTA_CORRIENTE_ID = @id AND FECHA < @fechaDesde
        `);
      saldoAnterior = sa.recordset[0]?.SALDO_ANTERIOR || 0;
    }

    // 2) Global totals (no date filter)
    const totalesResult = await pool.request()
      .input('id', sql.Int, ctaCorrienteId)
      .query(`
        SELECT 
          ISNULL(SUM(DEBE), 0) AS TOTAL_DEBE,
          ISNULL(SUM(HABER), 0) AS TOTAL_HABER,
          ISNULL(SUM(DEBE - HABER), 0) AS SALDO
        FROM COMPRAS_CTA_CORRIENTE WHERE CTA_CORRIENTE_ID = @id
      `);
    const totales: CtaCorrienteProvTotales = totalesResult.recordset[0] || { TOTAL_DEBE: 0, TOTAL_HABER: 0, SALDO: 0 };

    // 3) Fetch movements with running balance
    const req = pool.request()
      .input('id', sql.Int, ctaCorrienteId)
      .input('saldoInicial', sql.Decimal(18, 2), saldoAnterior);

    let dateFilter = '';
    if (fechaDesde && fechaHasta) {
      dateFilter = ' AND FECHA BETWEEN @fechaDesde AND @fechaHasta';
      req.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
      req.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    }

    const result = await req.query(`
      SELECT 
        COMPROBANTE_ID,
        FECHA,
        CONCEPTO,
        TIPO_COMPROBANTE,
        DEBE,
        HABER,
        SUM(DEBE - HABER) OVER (ORDER BY FECHA, COMPROBANTE_ID ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) + @saldoInicial AS SALDO
      FROM COMPRAS_CTA_CORRIENTE
      WHERE CTA_CORRIENTE_ID = @id ${dateFilter}
      ORDER BY FECHA, COMPROBANTE_ID
    `);

    return { movimientos: result.recordset, saldoAnterior, totales };
  },

  // ── Get ordenes de pago ────────────────────────
  async getOrdenesPago(
    ctaCorrienteId: number,
    fechaDesde?: string,
    fechaHasta?: string,
  ): Promise<OrdenPagoItem[]> {
    const pool = await getPool();
    const req = pool.request().input('id', sql.Int, ctaCorrienteId);

    let dateFilter = '';
    if (fechaDesde && fechaHasta) {
      dateFilter = ' AND p.FECHA BETWEEN @fechaDesde AND @fechaHasta';
      req.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
      req.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    }

    const result = await req.query(`
      SELECT 
        p.PAGO_ID,
        p.CTA_CORRIENTE_ID,
        p.FECHA,
        p.TOTAL,
        p.CONCEPTO,
        ISNULL(p.EFECTIVO, 0) AS EFECTIVO,
        ISNULL(p.DIGITAL, 0) AS DIGITAL,
        ISNULL(p.CHEQUES, 0) AS CHEQUES,
        ISNULL(u.NOMBRE, 'Sistema') AS USUARIO
      FROM PAGOS_CTA_CORRIENTE_P p
      LEFT JOIN USUARIOS u ON p.USUARIO_ID = u.USUARIO_ID
      WHERE p.CTA_CORRIENTE_ID = @id ${dateFilter}
      ORDER BY p.FECHA DESC, p.PAGO_ID DESC
    `);

    return result.recordset;
  },

  // ── Get single orden de pago for edit ──────────
  async getOrdenPagoById(pagoId: number): Promise<OrdenPagoItem & { EFECTIVO: number; DIGITAL: number; CHEQUES: number; metodos_pago: OrdenPagoMetodoPagoItem[]; cheques_ids: number[] }> {
    const pool = await getPool();
    const result = await pool.request()
      .input('pagoId', sql.Int, pagoId)
      .query(`
        SELECT 
          p.PAGO_ID, p.CTA_CORRIENTE_ID, p.FECHA, p.TOTAL, p.CONCEPTO,
          ISNULL(p.EFECTIVO, 0) AS EFECTIVO,
          ISNULL(p.DIGITAL, 0) AS DIGITAL,
          ISNULL(p.CHEQUES, 0) AS CHEQUES,
          ISNULL(u.NOMBRE, 'Sistema') AS USUARIO
        FROM PAGOS_CTA_CORRIENTE_P p
        LEFT JOIN USUARIOS u ON p.USUARIO_ID = u.USUARIO_ID
        WHERE p.PAGO_ID = @pagoId
      `);

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Orden de pago no encontrada'), { name: 'ValidationError' });
    }

    // Fetch stored metodos_pago breakdown if available
    await ensureOrdenesPagoMetodosPagoTable(pool);
    const mpResult = await pool.request()
      .input('pagoId', sql.Int, pagoId)
      .query(`SELECT METODO_PAGO_ID, MONTO FROM ORDENES_PAGO_METODOS_PAGO WHERE PAGO_ID = @pagoId`);

    // Cheques egresados a esta OP
    const chq = await pool.request()
      .input('pagoId', sql.Int, pagoId)
      .query(`SELECT CHEQUE_ID FROM CHEQUES WHERE DESTINO_TIPO = 'ORDEN_PAGO' AND DESTINO_ID = @pagoId`);
    const cheques_ids = chq.recordset.map((r: any) => r.CHEQUE_ID as number);

    return { ...result.recordset[0], metodos_pago: mpResult.recordset, cheques_ids };
  },

  // ── Create orden de pago ───────────────────────
  async crearOrdenPago(
    ctaCorrienteId: number,
    proveedorId: number,
    input: OrdenPagoInput,
    usuarioId: number,
  ): Promise<{ PAGO_ID: number }> {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Derive efectivo/digital/cheques from metodos_pago if provided
      let efectivo = input.EFECTIVO || 0;
      let digital = input.DIGITAL || 0;
      let cheques = input.CHEQUES || 0;

      if (input.metodos_pago && input.metodos_pago.length > 0) {
        const derived = await derivarCategoriasOP(tx, input.metodos_pago);
        efectivo = derived.efectivo;
        digital = derived.digital;
        cheques = derived.cheques;
      }

      const total = r2(efectivo + digital + cheques);

      if (total <= 0) {
        throw Object.assign(new Error('El total debe ser mayor a cero'), { name: 'ValidationError' });
      }

      if (cheques > 0 && (!input.cheques_ids || input.cheques_ids.length === 0)) {
        throw Object.assign(new Error('Debe seleccionar cheques de cartera para el método CHEQUES'), { name: 'ValidationError' });
      }

      // 1) Insert payment
      const insertResult = await tx.request()
        .input('ctaId', sql.Int, ctaCorrienteId)
        .input('fecha', sql.DateTime, new Date(input.FECHA))
        .input('total', sql.Decimal(18, 2), total)
        .input('concepto', sql.NVarChar, input.CONCEPTO || '')
        .input('efectivo', sql.Decimal(18, 2), efectivo)
        .input('digital', sql.Decimal(18, 2), digital)
        .input('cheques', sql.Decimal(18, 2), cheques)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
          INSERT INTO PAGOS_CTA_CORRIENTE_P 
            (CTA_CORRIENTE_ID, FECHA, TOTAL, CONCEPTO, EFECTIVO, DIGITAL, CHEQUES, USUARIO_ID)
          OUTPUT INSERTED.PAGO_ID
          VALUES (@ctaId, @fecha, @total, @concepto, @efectivo, @digital, @cheques, @usuarioId)
        `);

      const pagoId = insertResult.recordset[0].PAGO_ID;

      // 1a) Marcar cheques EGRESADOS si se enviaron
      if (input.cheques_ids && input.cheques_ids.length > 0) {
        const r = await marcarChequesEgresados(
          tx,
          input.cheques_ids,
          'ORDEN_PAGO',
          pagoId,
          `Pago OP #${pagoId}`,
          usuarioId,
          null,
        );
        if (Math.abs(r.total - cheques) > 0.01) {
          throw Object.assign(
            new Error(`El total de cheques seleccionados ($${r.total.toFixed(2)}) no coincide con el monto del método CHEQUES ($${cheques.toFixed(2)}).`),
            { name: 'ValidationError' },
          );
        }
      }

      // 1b) Store payment method breakdown
      if (input.metodos_pago && input.metodos_pago.length > 0) {
        await ensureOrdenesPagoMetodosPagoTable(tx);
        for (const mp of input.metodos_pago) {
          if (mp.MONTO <= 0) continue;
          await tx.request()
            .input('pagoId', sql.Int, pagoId)
            .input('mpId', sql.Int, mp.METODO_PAGO_ID)
            .input('monto', sql.Decimal(18, 2), r2(mp.MONTO))
            .query(`INSERT INTO ORDENES_PAGO_METODOS_PAGO (PAGO_ID, METODO_PAGO_ID, MONTO) VALUES (@pagoId, @mpId, @monto)`);
        }
      }

      // 2) Update concepto with format "OP #[ID] - [Desc]"
      const conceptoFinal = input.CONCEPTO?.trim()
        ? `OP #${pagoId} - ${input.CONCEPTO.trim()}`
        : `OP #${pagoId}`;

      await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .input('concepto', sql.NVarChar, conceptoFinal)
        .query('UPDATE PAGOS_CTA_CORRIENTE_P SET CONCEPTO = @concepto WHERE PAGO_ID = @pagoId');

      // 3) Insert comprobante in COMPRAS_CTA_CORRIENTE (HABER = total, type PA)
      await tx.request()
        .input('comprobanteId', sql.Int, pagoId)
        .input('ctaId', sql.Int, ctaCorrienteId)
        .input('fecha', sql.DateTime, new Date(input.FECHA))
        .input('concepto', sql.NVarChar, conceptoFinal)
        .input('total', sql.Decimal(18, 2), total)
        .query(`
          INSERT INTO COMPRAS_CTA_CORRIENTE 
            (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
          VALUES (@comprobanteId, @ctaId, @fecha, @concepto, 'PA', 0, @total)
        `);

      // 4) Imputar a compras pendientes
      await this._imputarPagoAComprasPendientes(tx, ctaCorrienteId, proveedorId, pagoId, total, new Date(input.FECHA), usuarioId);

      // 5) Registrar egreso en Caja o Caja Central
      const efectivoNeto = Math.max(0, efectivo);
      const digitalNeto = digital;
      const chequesNeto = cheques;
      if (efectivoNeto > 0 || digitalNeto > 0 || chequesNeto > 0) {
        const destino = input.DESTINO_PAGO || 'CAJA_CENTRAL';

        // Get supplier name
        const provNombreRes = await tx.request()
          .input('pid', sql.Int, proveedorId)
          .query(`SELECT NOMBRE FROM PROVEEDORES WHERE PROVEEDOR_ID = @pid`);
        const nombreProv = provNombreRes.recordset[0]?.NOMBRE || '';
        const descEgreso = `Pago OP #${pagoId} - ${nombreProv}`;

        if (destino === 'CAJA') {
          const caja = await this._getCajaAbiertaTx(tx, usuarioId);
          if (!caja) {
            throw Object.assign(
              new Error('No se encontró una caja abierta para el usuario'),
              { name: 'ValidationError' }
            );
          }
          await tx.request()
            .input('cajaId', sql.Int, caja.CAJA_ID)
            .input('origenTipo', sql.VarChar(30), 'ORDEN_PAGO')
            .input('origenId', sql.Int, pagoId)
            .input('efectivo', sql.Decimal(18, 2), -efectivoNeto)
            .input('digital', sql.Decimal(18, 2), -(digitalNeto + chequesNeto))
            .input('desc', sql.NVarChar(255), descEgreso)
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
                MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @origenId,
                @efectivo, @digital, @desc, @uid)
            `);
        } else {
          const totalEgreso = r2(efectivoNeto + digitalNeto + chequesNeto);
          const caja = await this._getCajaAbiertaTx(tx, usuarioId);
          const pvId = caja?.PUNTO_VENTA_ID || null;
          const movResult = await tx.request()
            .input('idEntidad', sql.Int, pagoId)
            .input('tipoEntidad', sql.VarChar(20), 'ORDEN_PAGO')
            .input('movimiento', sql.NVarChar(500), descEgreso)
            .input('uid', sql.Int, usuarioId)
            .input('efectivo', sql.Decimal(18, 2), -efectivoNeto)
            .input('digital', sql.Decimal(18, 2), -digitalNeto)
            .input('cheques', sql.Decimal(18, 2), -chequesNeto)
            .input('total', sql.Decimal(18, 2), -totalEgreso)
            .input('pvId', sql.Int, pvId)
            .query(`
              INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
              OUTPUT INSERTED.ID
              VALUES (@idEntidad, @tipoEntidad, @movimiento, @uid, @efectivo, @digital, @cheques, 0, @total, @pvId, 0)
            `);

          // Insert payment method breakdown for this movement
          const movId = movResult.recordset[0].ID;
          if (input.metodos_pago && input.metodos_pago.length > 0) {
            await ensureMovCajaMetodosPagoTable(tx);
            for (const mp of input.metodos_pago) {
              if (mp.MONTO <= 0) continue;
              await tx.request()
                .input('movId', sql.Int, movId)
                .input('mpId', sql.Int, mp.METODO_PAGO_ID)
                .input('monto', sql.Decimal(18, 2), -r2(mp.MONTO))
                .query(`INSERT INTO MOVIMIENTOS_CAJA_METODOS_PAGO (MOVIMIENTO_ID, METODO_PAGO_ID, MONTO) VALUES (@movId, @mpId, @monto)`);
            }
          }
        }
      }

      await tx.commit();
      return { PAGO_ID: pagoId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update orden de pago ───────────────────────
  async actualizarOrdenPago(
    pagoId: number,
    ctaCorrienteId: number,
    proveedorId: number,
    input: OrdenPagoInput,
    usuarioId: number,
  ): Promise<void> {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Derive efectivo/digital/cheques from metodos_pago if provided
      let efectivo = input.EFECTIVO || 0;
      let digital = input.DIGITAL || 0;
      let cheques = input.CHEQUES || 0;

      if (input.metodos_pago && input.metodos_pago.length > 0) {
        const derived = await derivarCategoriasOP(tx, input.metodos_pago);
        efectivo = derived.efectivo;
        digital = derived.digital;
        cheques = derived.cheques;
      }

      const total = r2(efectivo + digital + cheques);

      if (total <= 0) {
        throw Object.assign(new Error('El total debe ser mayor a cero'), { name: 'ValidationError' });
      }

      if (cheques > 0 && (!input.cheques_ids || input.cheques_ids.length === 0)) {
        throw Object.assign(new Error('Debe seleccionar cheques de cartera para el método CHEQUES'), { name: 'ValidationError' });
      }

      // 0) Revertir cheques previamente egresados (vuelven a EN_CARTERA)
      await revertirEgresoCheques(tx, 'ORDEN_PAGO', pagoId, usuarioId, null);

      // 1) Revert previous imputaciones
      await this._revertirImputaciones(tx, pagoId);

      // 2) Update payment
      const conceptoFinal = input.CONCEPTO?.trim()
        ? `OP #${pagoId} - ${input.CONCEPTO.trim()}`
        : `OP #${pagoId}`;

      await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .input('fecha', sql.DateTime, new Date(input.FECHA))
        .input('total', sql.Decimal(18, 2), total)
        .input('concepto', sql.NVarChar, conceptoFinal)
        .input('efectivo', sql.Decimal(18, 2), efectivo)
        .input('digital', sql.Decimal(18, 2), digital)
        .input('cheques', sql.Decimal(18, 2), cheques)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
          UPDATE PAGOS_CTA_CORRIENTE_P SET
            FECHA = @fecha, TOTAL = @total, CONCEPTO = @concepto,
            EFECTIVO = @efectivo, DIGITAL = @digital, CHEQUES = @cheques,
            USUARIO_ID = @usuarioId
          WHERE PAGO_ID = @pagoId
        `);

      // 2b) Update payment method breakdown
      await ensureOrdenesPagoMetodosPagoTable(tx);
      await tx.request().input('pagoId', sql.Int, pagoId)
        .query(`DELETE FROM ORDENES_PAGO_METODOS_PAGO WHERE PAGO_ID = @pagoId`);
      if (input.metodos_pago && input.metodos_pago.length > 0) {
        for (const mp of input.metodos_pago) {
          if (mp.MONTO <= 0) continue;
          await tx.request()
            .input('pagoId', sql.Int, pagoId)
            .input('mpId', sql.Int, mp.METODO_PAGO_ID)
            .input('monto', sql.Decimal(18, 2), r2(mp.MONTO))
            .query(`INSERT INTO ORDENES_PAGO_METODOS_PAGO (PAGO_ID, METODO_PAGO_ID, MONTO) VALUES (@pagoId, @mpId, @monto)`);
        }
      }

      // 3) Update comprobante in COMPRAS_CTA_CORRIENTE
      await tx.request()
        .input('comprobanteId', sql.Int, pagoId)
        .input('fecha', sql.DateTime, new Date(input.FECHA))
        .input('concepto', sql.NVarChar, conceptoFinal)
        .input('total', sql.Decimal(18, 2), total)
        .query(`
          UPDATE COMPRAS_CTA_CORRIENTE SET
            FECHA = @fecha, CONCEPTO = @concepto, HABER = @total
          WHERE COMPROBANTE_ID = @comprobanteId AND TIPO_COMPROBANTE = 'PA'
        `);

      // 4) Re-imputar
      await this._imputarPagoAComprasPendientes(tx, ctaCorrienteId, proveedorId, pagoId, total, new Date(input.FECHA), usuarioId);

      // 4b) Re-marcar cheques EGRESADOS
      if (input.cheques_ids && input.cheques_ids.length > 0) {
        const r = await marcarChequesEgresados(
          tx,
          input.cheques_ids,
          'ORDEN_PAGO',
          pagoId,
          `Pago OP #${pagoId}`,
          usuarioId,
          null,
        );
        if (Math.abs(r.total - cheques) > 0.01) {
          throw Object.assign(
            new Error(`El total de cheques seleccionados ($${r.total.toFixed(2)}) no coincide con el monto del método CHEQUES ($${cheques.toFixed(2)}).`),
            { name: 'ValidationError' },
          );
        }
      }

      // 5) Remove old egreso records and re-register
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'ORDEN_PAGO'`);
      await ensureMovCajaMetodosPagoTable(tx);
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM MOVIMIENTOS_CAJA_METODOS_PAGO WHERE MOVIMIENTO_ID IN (SELECT ID FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @origenId AND TIPO_ENTIDAD = 'ORDEN_PAGO')`);
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @origenId AND TIPO_ENTIDAD = 'ORDEN_PAGO'`);

      const efectivoNeto = Math.max(0, efectivo);
      const digitalNeto = digital;
      const chequesNeto = cheques;
      if (efectivoNeto > 0 || digitalNeto > 0 || chequesNeto > 0) {
        const destino = input.DESTINO_PAGO || 'CAJA_CENTRAL';

        const provNombreRes = await tx.request()
          .input('pid', sql.Int, proveedorId)
          .query(`SELECT NOMBRE FROM PROVEEDORES WHERE PROVEEDOR_ID = @pid`);
        const nombreProv = provNombreRes.recordset[0]?.NOMBRE || '';
        const descEgreso = `Pago OP #${pagoId} - ${nombreProv}`;

        if (destino === 'CAJA') {
          const caja = await this._getCajaAbiertaTx(tx, usuarioId);
          if (!caja) {
            throw Object.assign(
              new Error('No se encontró una caja abierta para el usuario'),
              { name: 'ValidationError' }
            );
          }
          await tx.request()
            .input('cajaId', sql.Int, caja.CAJA_ID)
            .input('origenTipo', sql.VarChar(30), 'ORDEN_PAGO')
            .input('origenId2', sql.Int, pagoId)
            .input('efectivo', sql.Decimal(18, 2), -efectivoNeto)
            .input('digital', sql.Decimal(18, 2), -(digitalNeto + chequesNeto))
            .input('desc', sql.NVarChar(255), descEgreso)
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
                MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @origenId2,
                @efectivo, @digital, @desc, @uid)
            `);
        } else {
          const totalEgreso = r2(efectivoNeto + digitalNeto + chequesNeto);
          const caja = await this._getCajaAbiertaTx(tx, usuarioId);
          const pvId = caja?.PUNTO_VENTA_ID || null;
          const movResult = await tx.request()
            .input('idEntidad', sql.Int, pagoId)
            .input('tipoEntidad', sql.VarChar(20), 'ORDEN_PAGO')
            .input('movimiento', sql.NVarChar(500), descEgreso)
            .input('uid', sql.Int, usuarioId)
            .input('efectivo', sql.Decimal(18, 2), -efectivoNeto)
            .input('digital', sql.Decimal(18, 2), -digitalNeto)
            .input('cheques', sql.Decimal(18, 2), -chequesNeto)
            .input('total', sql.Decimal(18, 2), -totalEgreso)
            .input('pvId', sql.Int, pvId)
            .query(`
              INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
              OUTPUT INSERTED.ID
              VALUES (@idEntidad, @tipoEntidad, @movimiento, @uid, @efectivo, @digital, @cheques, 0, @total, @pvId, 0)
            `);

          // Insert payment method breakdown for this movement
          const movId = movResult.recordset[0].ID;
          if (input.metodos_pago && input.metodos_pago.length > 0) {
            for (const mp of input.metodos_pago) {
              if (mp.MONTO <= 0) continue;
              await tx.request()
                .input('movId', sql.Int, movId)
                .input('mpId', sql.Int, mp.METODO_PAGO_ID)
                .input('monto', sql.Decimal(18, 2), -r2(mp.MONTO))
                .query(`INSERT INTO MOVIMIENTOS_CAJA_METODOS_PAGO (MOVIMIENTO_ID, METODO_PAGO_ID, MONTO) VALUES (@movId, @mpId, @monto)`);
            }
          }
        }
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete orden de pago ───────────────────────
  async eliminarOrdenPago(pagoId: number): Promise<void> {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // 0) Revertir cheques egresados a esta OP (vuelven a EN_CARTERA)
      await revertirEgresoCheques(tx, 'ORDEN_PAGO', pagoId, 0, null);

      // 1) Revert imputaciones
      await this._revertirImputaciones(tx, pagoId);

      // 2) Delete anticipos
      await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .query('DELETE FROM ANTICIPOS_PROVEEDORES WHERE PAGO_ID = @pagoId');

      // 3) Delete comprobante
      await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .query("DELETE FROM COMPRAS_CTA_CORRIENTE WHERE COMPROBANTE_ID = @pagoId AND TIPO_COMPROBANTE = 'PA'");

      // 3b) Remove egreso records from Caja / Caja Central
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'ORDEN_PAGO'`);
      await ensureMovCajaMetodosPagoTable(tx);
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM MOVIMIENTOS_CAJA_METODOS_PAGO WHERE MOVIMIENTO_ID IN (SELECT ID FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @origenId AND TIPO_ENTIDAD = 'ORDEN_PAGO')`);
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @origenId AND TIPO_ENTIDAD = 'ORDEN_PAGO'`);

      // 3c) Remove payment method breakdown
      await ensureOrdenesPagoMetodosPagoTable(tx);
      await tx.request().input('pagoId', sql.Int, pagoId)
        .query(`DELETE FROM ORDENES_PAGO_METODOS_PAGO WHERE PAGO_ID = @pagoId`);

      // 4) Delete payment
      const del = await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .query('DELETE FROM PAGOS_CTA_CORRIENTE_P WHERE PAGO_ID = @pagoId');

      if (del.rowsAffected[0] === 0) {
        throw Object.assign(new Error('Orden de pago no encontrada'), { name: 'ValidationError' });
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Internal: imputar pago a compras pendientes ─
  async _imputarPagoAComprasPendientes(
    tx: any,
    ctaCorrienteId: number,
    proveedorId: number,
    pagoId: number,
    montoTotal: number,
    fecha: Date,
    usuarioId: number,
  ): Promise<void> {
    // Get pending purchases ordered oldest first
    const pending = await tx.request()
      .input('ctaId', sql.Int, ctaCorrienteId)
      .query(`
        SELECT v.COMPROBANTE_ID, v.FECHA, v.TIPO_COMPROBANTE,
          v.DEBE 
            - ISNULL((SELECT SUM(MONTO_IMPUTADO) 
                      FROM IMPUTACIONES_PAGOS_P 
                      WHERE COMPRA_ID = v.COMPROBANTE_ID 
                      AND TIPO_COMPROBANTE = v.TIPO_COMPROBANTE), 0) AS SALDO_PENDIENTE
        FROM COMPRAS_CTA_CORRIENTE v
        WHERE v.CTA_CORRIENTE_ID = @ctaId
          AND v.TIPO_COMPROBANTE IN ('FA', 'FB', 'FC', 'Fa.A', 'Fa.B', 'Fa.C', 'Nd.A', 'Nd.B', 'Nd.C', 'X', 'R')
          AND v.DEBE > 0
          AND v.DEBE > ISNULL((SELECT SUM(MONTO_IMPUTADO) 
                               FROM IMPUTACIONES_PAGOS_P 
                               WHERE COMPRA_ID = v.COMPROBANTE_ID 
                               AND TIPO_COMPROBANTE = v.TIPO_COMPROBANTE), 0)
        ORDER BY v.FECHA, v.COMPROBANTE_ID
      `);

    let montoRestante = montoTotal;
    const comprasPagadas: number[] = [];

    for (const compra of pending.recordset) {
      if (montoRestante <= 0.01) break;

      const montoAImputar = Math.min(montoRestante, compra.SALDO_PENDIENTE);

      if (montoAImputar > 0.01) {
        await tx.request()
          .input('pagoId', sql.Int, pagoId)
          .input('compraId', sql.Int, compra.COMPROBANTE_ID)
          .input('tipoComp', sql.NVarChar, compra.TIPO_COMPROBANTE)
          .input('monto', sql.Decimal(18, 2), montoAImputar)
          .input('fecha', sql.DateTime, fecha)
          .input('usuarioId', sql.Int, usuarioId)
          .query(`
            INSERT INTO IMPUTACIONES_PAGOS_P 
              (PAGO_ID, COMPRA_ID, TIPO_COMPROBANTE, MONTO_IMPUTADO, FECHA_IMPUTACION, USUARIO_ID)
            VALUES (@pagoId, @compraId, @tipoComp, @monto, @fecha, @usuarioId)
          `);

        if (Math.abs(montoAImputar - compra.SALDO_PENDIENTE) < 0.01) {
          comprasPagadas.push(compra.COMPROBANTE_ID);
        }
      }
      montoRestante -= montoAImputar;
    }

    // Mark fully paid purchases
    if (comprasPagadas.length > 0) {
      const ids = comprasPagadas.join(',');
      await tx.request().query(`
        UPDATE COMPRAS SET COBRADA = 1
        WHERE COMPRA_ID IN (${ids}) AND ES_CTA_CORRIENTE = 1
      `);
    }

    // If remaining, create anticipo
    if (montoRestante > 0.01) {
      await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .input('proveedorId', sql.Int, proveedorId)
        .input('monto', sql.Decimal(18, 2), montoRestante)
        .input('fecha', sql.DateTime, fecha)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
          INSERT INTO ANTICIPOS_PROVEEDORES 
            (PAGO_ID, PROVEEDOR_ID, MONTO_DISPONIBLE, FECHA_ANTICIPO, USUARIO_ID)
          VALUES (@pagoId, @proveedorId, @monto, @fecha, @usuarioId)
        `);
    }

    // Update COBRADA status for all cta corriente purchases
    await tx.request()
      .input('ctaId', sql.Int, ctaCorrienteId)
      .query(`
        UPDATE v
        SET v.COBRADA = CASE 
          WHEN vc.DEBE <= ISNULL(ip.TOTAL_IMPUTADO, 0) THEN 1
          ELSE 0
        END
        FROM COMPRAS v
        INNER JOIN COMPRAS_CTA_CORRIENTE vc ON v.COMPRA_ID = vc.COMPROBANTE_ID
        LEFT JOIN (
          SELECT COMPRA_ID, TIPO_COMPROBANTE, SUM(MONTO_IMPUTADO) AS TOTAL_IMPUTADO
          FROM IMPUTACIONES_PAGOS_P
          GROUP BY COMPRA_ID, TIPO_COMPROBANTE
        ) ip ON vc.COMPROBANTE_ID = ip.COMPRA_ID AND vc.TIPO_COMPROBANTE = ip.TIPO_COMPROBANTE
        WHERE vc.CTA_CORRIENTE_ID = @ctaId
          AND vc.TIPO_COMPROBANTE IN ('FA', 'FB', 'FC', 'Fa.A', 'Fa.B', 'Fa.C', 'Nd.A', 'Nd.B', 'Nd.C', 'X', 'R')
          AND v.ES_CTA_CORRIENTE = 1
      `);
  },

  // ── Internal: get user's open caja ─────────────
  async _getCajaAbiertaTx(
    tx: any,
    usuarioId: number
  ): Promise<{ CAJA_ID: number; PUNTO_VENTA_ID: number | null } | null> {
    const result = await tx.request()
      .input('uid', sql.Int, usuarioId)
      .query(`SELECT CAJA_ID, PUNTO_VENTA_ID FROM CAJA WHERE USUARIO_ID = @uid AND ESTADO = 'ACTIVA'`);
    return result.recordset.length > 0 ? result.recordset[0] : null;
  },

  // ── Internal: revert imputaciones for a pago ───
  async _revertirImputaciones(tx: any, pagoId: number): Promise<void> {
    // Get affected purchases
    const affected = await tx.request()
      .input('pagoId', sql.Int, pagoId)
      .query('SELECT DISTINCT COMPRA_ID FROM IMPUTACIONES_PAGOS_P WHERE PAGO_ID = @pagoId');

    const compraIds = affected.recordset.map((r: any) => r.COMPRA_ID);

    // Delete imputaciones
    await tx.request()
      .input('pagoId', sql.Int, pagoId)
      .query('DELETE FROM IMPUTACIONES_PAGOS_P WHERE PAGO_ID = @pagoId');

    // Delete anticipos
    await tx.request()
      .input('pagoId', sql.Int, pagoId)
      .query('DELETE FROM ANTICIPOS_PROVEEDORES WHERE PAGO_ID = @pagoId');

    // Update COBRADA for affected purchases
    if (compraIds.length > 0) {
      const ids = compraIds.join(',');
      await tx.request().query(`
        UPDATE v
        SET v.COBRADA = CASE 
          WHEN vc.DEBE <= ISNULL((SELECT SUM(MONTO_IMPUTADO) 
                                  FROM IMPUTACIONES_PAGOS_P 
                                  WHERE COMPRA_ID = v.COMPRA_ID), 0) THEN 1
          ELSE 0
        END
        FROM COMPRAS v
        INNER JOIN COMPRAS_CTA_CORRIENTE vc ON v.COMPRA_ID = vc.COMPROBANTE_ID
        WHERE v.COMPRA_ID IN (${ids})
          AND v.ES_CTA_CORRIENTE = 1
          AND vc.TIPO_COMPROBANTE IN ('FA', 'FB', 'FC', 'Fa.A', 'Fa.B', 'Fa.C', 'Nd.A', 'Nd.B', 'Nd.C', 'X', 'R')
      `);
    }
  },

  // ── Get active payment methods ─────────────────
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

  // ── Get ALL ordenes de pago across all accounts ─
  async getAllOrdenesPago(
    fechaDesde?: string,
    fechaHasta?: string,
    search?: string,
  ): Promise<(OrdenPagoItem & { PROVEEDOR_ID: number; PROVEEDOR_NOMBRE: string; CTA_CORRIENTE_ID: number })[]> {
    const pool = await getPool();
    const req = pool.request();

    let dateFilter = '';
    if (fechaDesde && fechaHasta) {
      dateFilter = ' AND p.FECHA BETWEEN @fechaDesde AND @fechaHasta';
      req.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
      req.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    }

    let searchFilter = '';
    if (search) {
      searchFilter = ' AND (prov.NOMBRE LIKE @search OR prov.CODIGOPARTICULAR LIKE @search OR prov.NUMERO_DOC LIKE @search)';
      req.input('search', sql.NVarChar, `%${search}%`);
    }

    const result = await req.query(`
      SELECT 
        p.PAGO_ID,
        p.CTA_CORRIENTE_ID,
        p.FECHA,
        p.TOTAL,
        p.CONCEPTO,
        ISNULL(p.EFECTIVO, 0) AS EFECTIVO,
        ISNULL(p.DIGITAL, 0) AS DIGITAL,
        ISNULL(p.CHEQUES, 0) AS CHEQUES,
        ISNULL(u.NOMBRE, 'Sistema') AS USUARIO,
        prov.PROVEEDOR_ID,
        prov.NOMBRE AS PROVEEDOR_NOMBRE
      FROM PAGOS_CTA_CORRIENTE_P p
      INNER JOIN CTA_CORRIENTE_P cta ON p.CTA_CORRIENTE_ID = cta.CTA_CORRIENTE_ID
      INNER JOIN PROVEEDORES prov ON cta.PROVEEDOR_ID = prov.PROVEEDOR_ID
      LEFT JOIN USUARIOS u ON p.USUARIO_ID = u.USUARIO_ID
      WHERE 1=1 ${dateFilter} ${searchFilter}
      ORDER BY p.FECHA DESC, p.PAGO_ID DESC
    `);

    return result.recordset;
  },

  // ── Get supplier list for orden de pago selector ─
  async getProveedoresConCtaCorriente(search?: string): Promise<{ PROVEEDOR_ID: number; CTA_CORRIENTE_ID: number; NOMBRE: string; CODIGOPARTICULAR: string; NUMERO_DOC: string; SALDO_ACTUAL: number }[]> {
    const pool = await getPool();
    const req = pool.request();

    let searchFilter = '';
    if (search) {
      searchFilter = ' AND (prov.NOMBRE LIKE @search OR prov.CODIGOPARTICULAR LIKE @search OR prov.NUMERO_DOC LIKE @search)';
      req.input('search', sql.NVarChar, `%${search}%`);
    }

    const result = await req.query(`
      SELECT 
        prov.PROVEEDOR_ID,
        cta.CTA_CORRIENTE_ID,
        prov.NOMBRE,
        prov.CODIGOPARTICULAR,
        prov.NUMERO_DOC,
        ISNULL((
          SELECT SUM(DEBE - HABER) 
          FROM COMPRAS_CTA_CORRIENTE cc 
          WHERE cc.CTA_CORRIENTE_ID = cta.CTA_CORRIENTE_ID
        ), 0) AS SALDO_ACTUAL
      FROM PROVEEDORES prov
      INNER JOIN CTA_CORRIENTE_P cta ON prov.PROVEEDOR_ID = cta.PROVEEDOR_ID
      WHERE prov.ACTIVO = 1 AND prov.CTA_CORRIENTE = 1 ${searchFilter}
      ORDER BY prov.NOMBRE
    `);

    return result.recordset;
  },

  // ── Get aggregated payment method totals for ordenes de pago ─
  async getOrdenesPagoMetodosTotales(
    fechaDesde?: string,
    fechaHasta?: string,
    search?: string,
  ) {
    const pool = await getPool();
    await ensureOrdenesPagoMetodosPagoTable(pool);
    const req = pool.request();

    let dateFilter = '';
    if (fechaDesde && fechaHasta) {
      dateFilter = ' AND p.FECHA BETWEEN @fechaDesde AND @fechaHasta';
      req.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
      req.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    }

    let searchFilter = '';
    if (search) {
      searchFilter = ' AND (prov.NOMBRE LIKE @search OR prov.CODIGOPARTICULAR LIKE @search OR prov.NUMERO_DOC LIKE @search)';
      req.input('search', sql.NVarChar, `%${search}%`);
    }

    const result = await req.query(`
      SELECT 
        mp.NOMBRE AS METODO_NOMBRE,
        mp.CATEGORIA,
        ISNULL(mp.IMAGEN_BASE64, '') AS IMAGEN_BASE64,
        SUM(opm.MONTO) AS TOTAL
      FROM ORDENES_PAGO_METODOS_PAGO opm
      INNER JOIN PAGOS_CTA_CORRIENTE_P p ON opm.PAGO_ID = p.PAGO_ID
      INNER JOIN CTA_CORRIENTE_P cta ON p.CTA_CORRIENTE_ID = cta.CTA_CORRIENTE_ID
      INNER JOIN PROVEEDORES prov ON cta.PROVEEDOR_ID = prov.PROVEEDOR_ID
      INNER JOIN METODOS_PAGO mp ON opm.METODO_PAGO_ID = mp.METODO_PAGO_ID
      WHERE opm.MONTO > 0 ${dateFilter} ${searchFilter}
      GROUP BY mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64
      ORDER BY mp.CATEGORIA, SUM(opm.MONTO) DESC
    `);

    return result.recordset as { METODO_NOMBRE: string; CATEGORIA: string; IMAGEN_BASE64: string; TOTAL: number }[];
  },

  // ── Get recibo data for printing (orden de pago) ─
  async getOrdenPagoReciboData(pagoId: number) {
    const pool = await getPool();

    // 1) Payment + supplier + empresa data
    const result = await pool.request()
      .input('pagoId', sql.Int, pagoId)
      .query(`
        SELECT 
          p.PAGO_ID, p.CTA_CORRIENTE_ID, p.FECHA, p.TOTAL, p.CONCEPTO,
          ISNULL(p.EFECTIVO, 0) AS EFECTIVO,
          ISNULL(p.DIGITAL, 0) AS DIGITAL,
          ISNULL(p.CHEQUES, 0) AS CHEQUES,
          ISNULL(u.NOMBRE, 'Sistema') AS USUARIO,
          prov.PROVEEDOR_ID, prov.NOMBRE AS PROVEEDOR_NOMBRE,
          prov.CODIGOPARTICULAR AS PROVEEDOR_CODIGO,
          prov.DIRECCION AS PROVEEDOR_DOMICILIO,
          prov.CIUDAD AS PROVEEDOR_LOCALIDAD,
          prov.NUMERO_DOC AS PROVEEDOR_DOCUMENTO,
          ISNULL((
            SELECT SUM(DEBE - HABER) 
            FROM COMPRAS_CTA_CORRIENTE cc 
            WHERE cc.CTA_CORRIENTE_ID = p.CTA_CORRIENTE_ID
          ), 0) AS SALDO_ACTUAL
        FROM PAGOS_CTA_CORRIENTE_P p
        INNER JOIN CTA_CORRIENTE_P cta ON p.CTA_CORRIENTE_ID = cta.CTA_CORRIENTE_ID
        INNER JOIN PROVEEDORES prov ON cta.PROVEEDOR_ID = prov.PROVEEDOR_ID
        LEFT JOIN USUARIOS u ON p.USUARIO_ID = u.USUARIO_ID
        WHERE p.PAGO_ID = @pagoId
      `);

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Orden de pago no encontrada'), { name: 'ValidationError' });
    }

    // 2) Payment method breakdown with names
    await ensureOrdenesPagoMetodosPagoTable(pool);
    const mpResult = await pool.request()
      .input('pagoId', sql.Int, pagoId)
      .query(`
        SELECT opm.METODO_PAGO_ID, opm.MONTO, mp.NOMBRE AS METODO_NOMBRE, mp.CATEGORIA
        FROM ORDENES_PAGO_METODOS_PAGO opm
        INNER JOIN METODOS_PAGO mp ON opm.METODO_PAGO_ID = mp.METODO_PAGO_ID
        WHERE opm.PAGO_ID = @pagoId
      `);

    // 3) Empresa info (try EMPRESA first, then override with EMPRESA_CLIENTE)
    const empresa: any = {};
    try {
      const empResult = await pool.request().query(`
        SELECT TOP 1 
          ISNULL(NOMBRE_FANTASIA, '') AS NOMBRE_FANTASIA,
          ISNULL(RAZON_SOCIAL, '') AS RAZON_SOCIAL,
          ISNULL(DOMICILIO, '') AS DOMICILIO_FISCAL,
          ISNULL(CUIT, '') AS CUIT,
          ISNULL(CONDICION_IVA, '') AS CONDICION_IVA,
          ISNULL(LOCALIDAD, '') AS LOCALIDAD
        FROM EMPRESA
      `);
      Object.assign(empresa, empResult.recordset[0] || {});
    } catch { /* EMPRESA table may not exist */ }

    try {
      const ecResult = await pool.request().query(`
        SELECT TOP 1
          ISNULL(RAZON_SOCIAL, '') AS EC_RAZON_SOCIAL,
          ISNULL(DOMICILIO_FISCAL, '') AS EC_DOMICILIO,
          ISNULL(CONDICION_IVA, '') AS EC_CONDICION_IVA,
          ISNULL(CUIT, '') AS EC_CUIT
        FROM EMPRESA_CLIENTE
      `);
      const ec = ecResult.recordset[0];
      if (ec) {
        if (ec.EC_RAZON_SOCIAL) empresa.RAZON_SOCIAL = ec.EC_RAZON_SOCIAL;
        if (ec.EC_DOMICILIO) empresa.DOMICILIO_FISCAL = ec.EC_DOMICILIO;
        if (ec.EC_CONDICION_IVA) empresa.CONDICION_IVA = ec.EC_CONDICION_IVA;
        if (ec.EC_CUIT) empresa.CUIT = ec.EC_CUIT;
      }
    } catch { /* EMPRESA_CLIENTE table may not exist */ }

    return {
      ...result.recordset[0],
      metodos_pago: mpResult.recordset,
      empresa,
    };
  },
};
