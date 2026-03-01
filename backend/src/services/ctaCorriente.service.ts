import { getPool, sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  Cuenta Corriente Clientes — Service
// ═══════════════════════════════════════════════════

export interface CtaCorrienteListItem {
  CTA_CORRIENTE_ID: number;
  CLIENTE_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  NUMERO_DOC: string;
  TELEFONO: string | null;
  PROVINCIA: string | null;
  ESTADO_CUENTA: string;
  SALDO_ACTUAL: number;
  ULTIMA_TRANSACCION: string | null;
  CANTIDAD_MOVIMIENTOS: number;
}

export interface MovimientoCtaCte {
  COMPROBANTE_ID: number;
  FECHA: string;
  CONCEPTO: string;
  TIPO_COMPROBANTE: string;
  DEBE: number;
  HABER: number;
  SALDO: number;
}

export interface CobranzaItem {
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

export interface CobranzaInput {
  FECHA: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  CONCEPTO: string;
}

export interface CtaCorrienteTotales {
  TOTAL_DEBE: number;
  TOTAL_HABER: number;
  SALDO: number;
}

export const ctaCorrienteService = {

  // ── List all customers with CTA_CORRIENTE = 1 ──
  async getAll(search?: string): Promise<CtaCorrienteListItem[]> {
    const pool = await getPool();
    const req = pool.request();

    let where = 'WHERE C.CTA_CORRIENTE = 1 AND C.ACTIVO = 1';

    if (search) {
      where += ' AND (C.NOMBRE LIKE @search OR C.CODIGOPARTICULAR LIKE @search OR C.NUMERO_DOC LIKE @search)';
      req.input('search', sql.NVarChar, `%${search}%`);
    }

    const result = await req.query(`
      SELECT 
        ISNULL(CTA.CTA_CORRIENTE_ID, 0) AS CTA_CORRIENTE_ID,
        C.CLIENTE_ID, 
        C.CODIGOPARTICULAR, 
        C.NOMBRE,
        C.NUMERO_DOC,
        C.TELEFONO,
        C.PROVINCIA,
        CASE 
          WHEN CTA.CTA_CORRIENTE_ID IS NULL THEN 'SIN_CREAR'
          WHEN NOT EXISTS (
            SELECT 1 FROM VENTAS_CTA_CORRIENTE VC 
            WHERE VC.CTA_CORRIENTE_ID = CTA.CTA_CORRIENTE_ID
          ) THEN 'CREADA_SIN_MOV'
          ELSE 'ACTIVA'
        END AS ESTADO_CUENTA,
        ISNULL((
          SELECT SUM(DEBE - HABER) 
          FROM VENTAS_CTA_CORRIENTE VC 
          WHERE VC.CTA_CORRIENTE_ID = CTA.CTA_CORRIENTE_ID
        ), 0) AS SALDO_ACTUAL,
        (
          SELECT TOP 1 VC.FECHA 
          FROM VENTAS_CTA_CORRIENTE VC 
          WHERE VC.CTA_CORRIENTE_ID = CTA.CTA_CORRIENTE_ID
          ORDER BY VC.FECHA DESC
        ) AS ULTIMA_TRANSACCION,
        ISNULL((
          SELECT COUNT(*) 
          FROM VENTAS_CTA_CORRIENTE VC 
          WHERE VC.CTA_CORRIENTE_ID = CTA.CTA_CORRIENTE_ID
        ), 0) AS CANTIDAD_MOVIMIENTOS
      FROM CLIENTES AS C
      LEFT JOIN CTA_CORRIENTE_C AS CTA ON C.CLIENTE_ID = CTA.CLIENTE_ID
      ${where}
      ORDER BY 
        CASE WHEN CTA.CTA_CORRIENTE_ID IS NULL THEN 0 ELSE 1 END,
        C.NOMBRE
    `);

    return result.recordset;
  },

  // ── Create account (CTA_CORRIENTE_C) ───────────
  async crearCuenta(clienteId: number): Promise<{ CTA_CORRIENTE_ID: number }> {
    const pool = await getPool();

    // Check if already exists
    const check = await pool.request()
      .input('clienteId', sql.Int, clienteId)
      .query('SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @clienteId');

    if (check.recordset.length > 0) {
      return { CTA_CORRIENTE_ID: check.recordset[0].CTA_CORRIENTE_ID };
    }

    const result = await pool.request()
      .input('clienteId', sql.Int, clienteId)
      .query(`
        INSERT INTO CTA_CORRIENTE_C (CLIENTE_ID, FECHA)
        OUTPUT INSERTED.CTA_CORRIENTE_ID
        VALUES (@clienteId, GETDATE())
      `);

    return { CTA_CORRIENTE_ID: result.recordset[0].CTA_CORRIENTE_ID };
  },

  // ── Get totals for a cta corriente ─────────────
  async getTotales(ctaCorrienteId: number): Promise<CtaCorrienteTotales> {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, ctaCorrienteId)
      .query(`
        SELECT 
          ISNULL(SUM(DEBE), 0) AS TOTAL_DEBE,
          ISNULL(SUM(HABER), 0) AS TOTAL_HABER,
          ISNULL(SUM(DEBE - HABER), 0) AS SALDO
        FROM VENTAS_CTA_CORRIENTE 
        WHERE CTA_CORRIENTE_ID = @id
      `);

    return result.recordset[0] || { TOTAL_DEBE: 0, TOTAL_HABER: 0, SALDO: 0 };
  },

  // ── Get movements (detalle) for a cta corriente ─
  async getMovimientos(
    ctaCorrienteId: number,
    fechaDesde?: string,
    fechaHasta?: string,
  ): Promise<{ movimientos: MovimientoCtaCte[]; saldoAnterior: number; totales: CtaCorrienteTotales }> {
    const pool = await getPool();

    // 1) Calculate saldo anterior (before fechaDesde)
    let saldoAnterior = 0;
    if (fechaDesde) {
      const sa = await pool.request()
        .input('id', sql.Int, ctaCorrienteId)
        .input('fechaDesde', sql.DateTime, new Date(fechaDesde))
        .query(`
          SELECT ISNULL(SUM(DEBE - HABER), 0) AS SALDO_ANTERIOR
          FROM VENTAS_CTA_CORRIENTE 
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
        FROM VENTAS_CTA_CORRIENTE WHERE CTA_CORRIENTE_ID = @id
      `);
    const totales: CtaCorrienteTotales = totalesResult.recordset[0] || { TOTAL_DEBE: 0, TOTAL_HABER: 0, SALDO: 0 };

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
      FROM VENTAS_CTA_CORRIENTE
      WHERE CTA_CORRIENTE_ID = @id ${dateFilter}
      ORDER BY FECHA, COMPROBANTE_ID
    `);

    return { movimientos: result.recordset, saldoAnterior, totales };
  },

  // ── Get cobranzas (payments) ───────────────────
  async getCobranzas(
    ctaCorrienteId: number,
    fechaDesde?: string,
    fechaHasta?: string,
  ): Promise<CobranzaItem[]> {
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
      FROM PAGOS_CTA_CORRIENTE_C p
      LEFT JOIN USUARIOS u ON p.USUARIO_ID = u.USUARIO_ID
      WHERE p.CTA_CORRIENTE_ID = @id ${dateFilter}
      ORDER BY p.FECHA DESC, p.PAGO_ID DESC
    `);

    return result.recordset;
  },

  // ── Get single cobranza for edit ───────────────
  async getCobranzaById(pagoId: number): Promise<CobranzaItem & { EFECTIVO: number; DIGITAL: number; CHEQUES: number }> {
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
        FROM PAGOS_CTA_CORRIENTE_C p
        LEFT JOIN USUARIOS u ON p.USUARIO_ID = u.USUARIO_ID
        WHERE p.PAGO_ID = @pagoId
      `);

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Cobranza no encontrada'), { name: 'ValidationError' });
    }
    return result.recordset[0];
  },

  // ── Create cobranza ────────────────────────────
  async crearCobranza(
    ctaCorrienteId: number,
    clienteId: number,
    input: CobranzaInput,
    usuarioId: number,
  ): Promise<{ PAGO_ID: number }> {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const total = input.EFECTIVO + input.DIGITAL + input.CHEQUES;

      if (total <= 0) {
        throw Object.assign(new Error('El total debe ser mayor a cero'), { name: 'ValidationError' });
      }

      // 1) Insert payment
      const insertResult = await tx.request()
        .input('ctaId', sql.Int, ctaCorrienteId)
        .input('fecha', sql.DateTime, new Date(input.FECHA))
        .input('total', sql.Decimal(18, 2), total)
        .input('concepto', sql.NVarChar, input.CONCEPTO || '')
        .input('efectivo', sql.Decimal(18, 2), input.EFECTIVO)
        .input('digital', sql.Decimal(18, 2), input.DIGITAL)
        .input('cheques', sql.Decimal(18, 2), input.CHEQUES)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
          INSERT INTO PAGOS_CTA_CORRIENTE_C 
            (CTA_CORRIENTE_ID, FECHA, TOTAL, CONCEPTO, EFECTIVO, DIGITAL, CHEQUES, USUARIO_ID)
          OUTPUT INSERTED.PAGO_ID
          VALUES (@ctaId, @fecha, @total, @concepto, @efectivo, @digital, @cheques, @usuarioId)
        `);

      const pagoId = insertResult.recordset[0].PAGO_ID;

      // 2) Update concepto with format "CO #[ID] - [Desc]"
      const conceptoFinal = input.CONCEPTO?.trim()
        ? `CO #${pagoId} - ${input.CONCEPTO.trim()}`
        : `CO #${pagoId}`;

      await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .input('concepto', sql.NVarChar, conceptoFinal)
        .query('UPDATE PAGOS_CTA_CORRIENTE_C SET CONCEPTO = @concepto WHERE PAGO_ID = @pagoId');

      // 3) Insert comprobante in VENTAS_CTA_CORRIENTE (HABER = total)
      await tx.request()
        .input('comprobanteId', sql.Int, pagoId)
        .input('ctaId', sql.Int, ctaCorrienteId)
        .input('fecha', sql.DateTime, new Date(input.FECHA))
        .input('concepto', sql.NVarChar, conceptoFinal)
        .input('total', sql.Decimal(18, 2), total)
        .query(`
          INSERT INTO VENTAS_CTA_CORRIENTE 
            (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
          VALUES (@comprobanteId, @ctaId, @fecha, @concepto, 'CO', 0, @total)
        `);

      // 4) Imputar a ventas pendientes
      await this._imputarCobroAVentasPendientes(tx, ctaCorrienteId, clienteId, pagoId, total, new Date(input.FECHA), usuarioId);

      await tx.commit();
      return { PAGO_ID: pagoId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update cobranza ────────────────────────────
  async actualizarCobranza(
    pagoId: number,
    ctaCorrienteId: number,
    clienteId: number,
    input: CobranzaInput,
    usuarioId: number,
  ): Promise<void> {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const total = input.EFECTIVO + input.DIGITAL + input.CHEQUES;

      if (total <= 0) {
        throw Object.assign(new Error('El total debe ser mayor a cero'), { name: 'ValidationError' });
      }

      // 1) Revert previous imputaciones
      await this._revertirImputaciones(tx, pagoId);

      // 2) Update payment
      const conceptoFinal = input.CONCEPTO?.trim()
        ? `CO #${pagoId} - ${input.CONCEPTO.trim()}`
        : `CO #${pagoId}`;

      await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .input('fecha', sql.DateTime, new Date(input.FECHA))
        .input('total', sql.Decimal(18, 2), total)
        .input('concepto', sql.NVarChar, conceptoFinal)
        .input('efectivo', sql.Decimal(18, 2), input.EFECTIVO)
        .input('digital', sql.Decimal(18, 2), input.DIGITAL)
        .input('cheques', sql.Decimal(18, 2), input.CHEQUES)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
          UPDATE PAGOS_CTA_CORRIENTE_C SET
            FECHA = @fecha, TOTAL = @total, CONCEPTO = @concepto,
            EFECTIVO = @efectivo, DIGITAL = @digital, CHEQUES = @cheques,
            USUARIO_ID = @usuarioId
          WHERE PAGO_ID = @pagoId
        `);

      // 3) Update comprobante in VENTAS_CTA_CORRIENTE
      await tx.request()
        .input('comprobanteId', sql.Int, pagoId)
        .input('fecha', sql.DateTime, new Date(input.FECHA))
        .input('concepto', sql.NVarChar, conceptoFinal)
        .input('total', sql.Decimal(18, 2), total)
        .query(`
          UPDATE VENTAS_CTA_CORRIENTE SET
            FECHA = @fecha, CONCEPTO = @concepto, HABER = @total
          WHERE COMPROBANTE_ID = @comprobanteId AND TIPO_COMPROBANTE = 'CO'
        `);

      // 4) Re-imputar
      await this._imputarCobroAVentasPendientes(tx, ctaCorrienteId, clienteId, pagoId, total, new Date(input.FECHA), usuarioId);

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete cobranza ────────────────────────────
  async eliminarCobranza(pagoId: number): Promise<void> {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // 1) Revert imputaciones
      await this._revertirImputaciones(tx, pagoId);

      // 2) Delete anticipos
      await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .query('DELETE FROM ANTICIPOS_CLIENTES WHERE PAGO_ID = @pagoId');

      // 3) Delete comprobante
      await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .query("DELETE FROM VENTAS_CTA_CORRIENTE WHERE COMPROBANTE_ID = @pagoId AND TIPO_COMPROBANTE = 'CO'");

      // 4) Delete payment
      const del = await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .query('DELETE FROM PAGOS_CTA_CORRIENTE_C WHERE PAGO_ID = @pagoId');

      if (del.rowsAffected[0] === 0) {
        throw Object.assign(new Error('Cobranza no encontrada'), { name: 'ValidationError' });
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Internal: imputar cobro a ventas pendientes ─
  async _imputarCobroAVentasPendientes(
    tx: any,
    ctaCorrienteId: number,
    clienteId: number,
    pagoId: number,
    montoTotal: number,
    fecha: Date,
    usuarioId: number,
  ): Promise<void> {
    // Get pending sales ordered oldest first
    // IMPUTACIONES_PAGOS already tracks anticipo consumption, so no need to subtract MONTO_ANTICIPO
    const pending = await tx.request()
      .input('ctaId', sql.Int, ctaCorrienteId)
      .query(`
        SELECT v.COMPROBANTE_ID, v.FECHA, v.TIPO_COMPROBANTE,
          v.DEBE 
            - ISNULL((SELECT SUM(MONTO_IMPUTADO) 
                      FROM IMPUTACIONES_PAGOS 
                      WHERE VENTA_ID = v.COMPROBANTE_ID 
                      AND TIPO_COMPROBANTE = v.TIPO_COMPROBANTE), 0) AS SALDO_PENDIENTE
        FROM VENTAS_CTA_CORRIENTE v
        WHERE v.CTA_CORRIENTE_ID = @ctaId
          AND v.TIPO_COMPROBANTE IN ('Fa.A', 'Fa.B', 'Fa.C', 'Nd.A', 'Nd.B', 'Nd.C')
          AND v.DEBE > 0
          AND v.DEBE > ISNULL((SELECT SUM(MONTO_IMPUTADO) 
                               FROM IMPUTACIONES_PAGOS 
                               WHERE VENTA_ID = v.COMPROBANTE_ID 
                               AND TIPO_COMPROBANTE = v.TIPO_COMPROBANTE), 0)
        ORDER BY v.FECHA, v.COMPROBANTE_ID
      `);

    let montoRestante = montoTotal;
    const ventasPagadas: number[] = [];

    for (const venta of pending.recordset) {
      if (montoRestante <= 0.01) break;

      const montoAImputar = Math.min(montoRestante, venta.SALDO_PENDIENTE);

      if (montoAImputar > 0.01) {
        await tx.request()
          .input('pagoId', sql.Int, pagoId)
          .input('ventaId', sql.Int, venta.COMPROBANTE_ID)
          .input('tipoComp', sql.NVarChar, venta.TIPO_COMPROBANTE)
          .input('monto', sql.Decimal(18, 2), montoAImputar)
          .input('fecha', sql.DateTime, fecha)
          .input('usuarioId', sql.Int, usuarioId)
          .query(`
            INSERT INTO IMPUTACIONES_PAGOS 
              (PAGO_ID, VENTA_ID, TIPO_COMPROBANTE, MONTO_IMPUTADO, FECHA_IMPUTACION, USUARIO_ID)
            VALUES (@pagoId, @ventaId, @tipoComp, @monto, @fecha, @usuarioId)
          `);

        if (Math.abs(montoAImputar - venta.SALDO_PENDIENTE) < 0.01) {
          ventasPagadas.push(venta.COMPROBANTE_ID);
        }
      }
      montoRestante -= montoAImputar;
    }

    // Mark fully paid sales
    if (ventasPagadas.length > 0) {
      const ids = ventasPagadas.join(',');
      await tx.request().query(`
        UPDATE VENTAS SET COBRADA = 1
        WHERE VENTA_ID IN (${ids}) AND ES_CTA_CORRIENTE = 1
      `);
    }

    // If remaining, create anticipo
    if (montoRestante > 0.01) {
      await tx.request()
        .input('pagoId', sql.Int, pagoId)
        .input('clienteId', sql.Int, clienteId)
        .input('monto', sql.Decimal(18, 2), montoRestante)
        .input('fecha', sql.DateTime, fecha)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
          INSERT INTO ANTICIPOS_CLIENTES 
            (PAGO_ID, CLIENTE_ID, MONTO_DISPONIBLE, FECHA_ANTICIPO, USUARIO_ID)
          VALUES (@pagoId, @clienteId, @monto, @fecha, @usuarioId)
        `);
    }

    // Update COBRADA status for all cta corriente sales
    // IMPUTACIONES_PAGOS already includes anticipo consumption records
    await tx.request()
      .input('ctaId', sql.Int, ctaCorrienteId)
      .query(`
        UPDATE v
        SET v.COBRADA = CASE 
          WHEN vc.DEBE <= ISNULL(ip.TOTAL_IMPUTADO, 0) THEN 1
          ELSE 0
        END
        FROM VENTAS v
        INNER JOIN VENTAS_CTA_CORRIENTE vc ON v.VENTA_ID = vc.COMPROBANTE_ID
        LEFT JOIN (
          SELECT VENTA_ID, TIPO_COMPROBANTE, SUM(MONTO_IMPUTADO) AS TOTAL_IMPUTADO
          FROM IMPUTACIONES_PAGOS
          GROUP BY VENTA_ID, TIPO_COMPROBANTE
        ) ip ON vc.COMPROBANTE_ID = ip.VENTA_ID AND vc.TIPO_COMPROBANTE = ip.TIPO_COMPROBANTE
        WHERE vc.CTA_CORRIENTE_ID = @ctaId
          AND vc.TIPO_COMPROBANTE IN ('Fa.A', 'Fa.B', 'Fa.C', 'Nd.A', 'Nd.B', 'Nd.C')
          AND v.ES_CTA_CORRIENTE = 1
      `);
  },

  // ── Internal: revert imputaciones for a pago ───
  async _revertirImputaciones(tx: any, pagoId: number): Promise<void> {
    // Get affected sales
    const affected = await tx.request()
      .input('pagoId', sql.Int, pagoId)
      .query('SELECT DISTINCT VENTA_ID FROM IMPUTACIONES_PAGOS WHERE PAGO_ID = @pagoId');

    const ventaIds = affected.recordset.map((r: any) => r.VENTA_ID);

    // Delete imputaciones
    await tx.request()
      .input('pagoId', sql.Int, pagoId)
      .query('DELETE FROM IMPUTACIONES_PAGOS WHERE PAGO_ID = @pagoId');

    // Delete anticipos
    await tx.request()
      .input('pagoId', sql.Int, pagoId)
      .query('DELETE FROM ANTICIPOS_CLIENTES WHERE PAGO_ID = @pagoId');

    // Update COBRADA and reset MONTO_ANTICIPO for affected sales
    if (ventaIds.length > 0) {
      const ids = ventaIds.join(',');
      await tx.request().query(`
        UPDATE v
        SET v.COBRADA = CASE 
          WHEN vc.DEBE <= ISNULL((SELECT SUM(MONTO_IMPUTADO) 
                                  FROM IMPUTACIONES_PAGOS 
                                  WHERE VENTA_ID = v.VENTA_ID), 0) THEN 1
          ELSE 0
        END,
        v.MONTO_ANTICIPO = ISNULL((SELECT SUM(MONTO_IMPUTADO) 
                                   FROM IMPUTACIONES_PAGOS ip2
                                   INNER JOIN ANTICIPOS_CLIENTES ac ON ip2.PAGO_ID = ac.PAGO_ID
                                   WHERE ip2.VENTA_ID = v.VENTA_ID), 0)
        FROM VENTAS v
        INNER JOIN VENTAS_CTA_CORRIENTE vc ON v.VENTA_ID = vc.COMPROBANTE_ID
        WHERE v.VENTA_ID IN (${ids})
          AND v.ES_CTA_CORRIENTE = 1
          AND vc.TIPO_COMPROBANTE IN ('Fa.A', 'Fa.B', 'Fa.C', 'Nd.A', 'Nd.B', 'Nd.C')
      `);
    }
  },
};
