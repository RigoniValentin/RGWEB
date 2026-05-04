import { getPool, sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  Cuenta Corriente Clientes — Service
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

// ── COBRANZAS_METODOS_PAGO table helper ──

let _cobranzasMetodosPagoTableReady = false;

async function ensureCobranzasMetodosPagoTable(poolOrTx: any): Promise<void> {
  if (_cobranzasMetodosPagoTableReady) return;
  await poolOrTx.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'COBRANZAS_METODOS_PAGO')
    CREATE TABLE COBRANZAS_METODOS_PAGO (
      ID INT IDENTITY(1,1) PRIMARY KEY,
      PAGO_ID INT NOT NULL,
      METODO_PAGO_ID INT NOT NULL,
      MONTO DECIMAL(18,2) NOT NULL
    )
  `);
  _cobranzasMetodosPagoTableReady = true;
}

import { crearChequeEnCartera } from './cheques.service.js';
import type { ChequePayload } from '../types/index.js';

export interface CobranzaMetodoPagoItem {
  METODO_PAGO_ID: number;
  MONTO: number;
  /** Datos del cheque cuando el método es de categoría CHEQUES. */
  cheque?: ChequePayload;
}

/** Derive EFECTIVO / DIGITAL / CHEQUES totals from metodos_pago */
async function derivarCategoriasCO(
  tx: any,
  metodosPago: CobranzaMetodoPagoItem[]
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

/** Crea registros en CHEQUES (EN_CARTERA) por cada metodo de pago de
 *  categoría CHEQUES con payload cheque. */
async function crearChequesCobranza(
  tx: any,
  pagoId: number,
  metodosPago: CobranzaMetodoPagoItem[],
  usuarioId: number,
): Promise<void> {
  for (const mp of metodosPago) {
    if (!mp.cheque || mp.MONTO <= 0) continue;
    const cat = await tx.request()
      .input('mid', sql.Int, mp.METODO_PAGO_ID)
      .query(`SELECT CATEGORIA FROM METODOS_PAGO WHERE METODO_PAGO_ID = @mid`);
    if (cat.recordset[0]?.CATEGORIA !== 'CHEQUES') continue;
    await crearChequeEnCartera(
      tx,
      mp.cheque,
      mp.MONTO,
      'COBRANZA',
      pagoId,
      usuarioId,
      null,
    );
  }
}

/** Valida que los cheques originados por una cobranza estén EN_CARTERA y los
 *  borra; lanza ValidationError si hay alguno egresado/depositado/anulado. */
async function eliminarChequesDeCobranza(
  tx: any,
  pagoId: number,
): Promise<void> {
  const r = await tx.request()
    .input('pid', sql.Int, pagoId)
    .query(`SELECT CHEQUE_ID, ESTADO FROM CHEQUES WHERE ORIGEN_TIPO = 'COBRANZA' AND ORIGEN_ID = @pid`);
  const noCartera = r.recordset.find((x: any) => x.ESTADO !== 'EN_CARTERA');
  if (noCartera) {
    throw Object.assign(
      new Error('No se puede modificar/eliminar la cobranza: hay cheques que ya fueron egresados, depositados o anulados.'),
      { name: 'ValidationError' },
    );
  }
  if (r.recordset.length > 0) {
    await tx.request()
      .input('pid', sql.Int, pagoId)
      .query(`DELETE FROM CHEQUES_HISTORIAL WHERE CHEQUE_ID IN (SELECT CHEQUE_ID FROM CHEQUES WHERE ORIGEN_TIPO = 'COBRANZA' AND ORIGEN_ID = @pid)`);
    await tx.request()
      .input('pid', sql.Int, pagoId)
      .query(`DELETE FROM CHEQUES WHERE ORIGEN_TIPO = 'COBRANZA' AND ORIGEN_ID = @pid`);
  }
}

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
  DESTINO_COBRO?: 'CAJA_CENTRAL' | 'CAJA';
  metodos_pago?: CobranzaMetodoPagoItem[];
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
  async getCobranzaById(pagoId: number): Promise<CobranzaItem & { EFECTIVO: number; DIGITAL: number; CHEQUES: number; metodos_pago: CobranzaMetodoPagoItem[] }> {
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

    // Fetch stored metodos_pago breakdown if available
    await ensureCobranzasMetodosPagoTable(pool);
    const mpResult = await pool.request()
      .input('pagoId', sql.Int, pagoId)
      .query(`SELECT METODO_PAGO_ID, MONTO FROM COBRANZAS_METODOS_PAGO WHERE PAGO_ID = @pagoId`);

    return { ...result.recordset[0], metodos_pago: mpResult.recordset };
  },

  // ── Get recibo data for printing ───────────────
  async getReciboData(pagoId: number) {
    const pool = await getPool();

    // 1) Payment + customer + empresa data in a single query
    const result = await pool.request()
      .input('pagoId', sql.Int, pagoId)
      .query(`
        SELECT 
          p.PAGO_ID, p.CTA_CORRIENTE_ID, p.FECHA, p.TOTAL, p.CONCEPTO,
          ISNULL(p.EFECTIVO, 0) AS EFECTIVO,
          ISNULL(p.DIGITAL, 0) AS DIGITAL,
          ISNULL(p.CHEQUES, 0) AS CHEQUES,
          ISNULL(u.NOMBRE, 'Sistema') AS USUARIO,
          c.CLIENTE_ID, c.NOMBRE AS CLIENTE_NOMBRE,
          c.CODIGOPARTICULAR AS CLIENTE_CODIGO,
          c.DOMICILIO AS CLIENTE_DOMICILIO,
          c.PROVINCIA AS CLIENTE_LOCALIDAD,
          c.NUMERO_DOC AS CLIENTE_DOCUMENTO,
          ISNULL((
            SELECT SUM(DEBE - HABER) 
            FROM VENTAS_CTA_CORRIENTE vc 
            WHERE vc.CTA_CORRIENTE_ID = p.CTA_CORRIENTE_ID
          ), 0) AS SALDO_ACTUAL
        FROM PAGOS_CTA_CORRIENTE_C p
        INNER JOIN CTA_CORRIENTE_C cta ON p.CTA_CORRIENTE_ID = cta.CTA_CORRIENTE_ID
        INNER JOIN CLIENTES c ON cta.CLIENTE_ID = c.CLIENTE_ID
        LEFT JOIN USUARIOS u ON p.USUARIO_ID = u.USUARIO_ID
        WHERE p.PAGO_ID = @pagoId
      `);

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Cobranza no encontrada'), { name: 'ValidationError' });
    }

    // 2) Payment method breakdown with names
    await ensureCobranzasMetodosPagoTable(pool);
    const mpResult = await pool.request()
      .input('pagoId', sql.Int, pagoId)
      .query(`
        SELECT cm.METODO_PAGO_ID, cm.MONTO, mp.NOMBRE AS METODO_NOMBRE, mp.CATEGORIA
        FROM COBRANZAS_METODOS_PAGO cm
        INNER JOIN METODOS_PAGO mp ON cm.METODO_PAGO_ID = mp.METODO_PAGO_ID
        WHERE cm.PAGO_ID = @pagoId
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
      // Derive efectivo/digital/cheques from metodos_pago if provided
      let efectivo = input.EFECTIVO || 0;
      let digital = input.DIGITAL || 0;
      let cheques = input.CHEQUES || 0;

      if (input.metodos_pago && input.metodos_pago.length > 0) {
        const derived = await derivarCategoriasCO(tx, input.metodos_pago);
        efectivo = derived.efectivo;
        digital = derived.digital;
        cheques = derived.cheques;
      }

      const total = r2(efectivo + digital + cheques);

      if (total <= 0) {
        throw Object.assign(new Error('El total debe ser mayor a cero'), { name: 'ValidationError' });
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
          INSERT INTO PAGOS_CTA_CORRIENTE_C 
            (CTA_CORRIENTE_ID, FECHA, TOTAL, CONCEPTO, EFECTIVO, DIGITAL, CHEQUES, USUARIO_ID)
          OUTPUT INSERTED.PAGO_ID
          VALUES (@ctaId, @fecha, @total, @concepto, @efectivo, @digital, @cheques, @usuarioId)
        `);

      const pagoId = insertResult.recordset[0].PAGO_ID;

      // 1b) Crear registros en CHEQUES para los métodos de categoría CHEQUES
      if (input.metodos_pago && input.metodos_pago.length > 0) {
        await crearChequesCobranza(tx, pagoId, input.metodos_pago, usuarioId);
      }

      // 1c) Store payment method breakdown
      if (input.metodos_pago && input.metodos_pago.length > 0) {
        await ensureCobranzasMetodosPagoTable(tx);
        for (const mp of input.metodos_pago) {
          if (mp.MONTO <= 0) continue;
          await tx.request()
            .input('pagoId', sql.Int, pagoId)
            .input('mpId', sql.Int, mp.METODO_PAGO_ID)
            .input('monto', sql.Decimal(18, 2), r2(mp.MONTO))
            .query(`INSERT INTO COBRANZAS_METODOS_PAGO (PAGO_ID, METODO_PAGO_ID, MONTO) VALUES (@pagoId, @mpId, @monto)`);
        }
      }

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

      // 5) Registrar ingreso en Caja o Caja Central
      const efectivoNeto = Math.max(0, efectivo);
      const digitalNeto = digital;
      const chequesNeto = cheques;
      if (efectivoNeto > 0 || digitalNeto > 0 || chequesNeto > 0) {
        const destino = input.DESTINO_COBRO || 'CAJA_CENTRAL';

        // Get customer name
        const cliNombreRes = await tx.request()
          .input('cid', sql.Int, clienteId)
          .query(`SELECT NOMBRE FROM CLIENTES WHERE CLIENTE_ID = @cid`);
        const nombreCli = cliNombreRes.recordset[0]?.NOMBRE || '';
        const descIngreso = `Cobro CO #${pagoId} - ${nombreCli}`;

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
            .input('origenTipo', sql.VarChar(30), 'COBRANZA')
            .input('origenId', sql.Int, pagoId)
            .input('efectivo', sql.Decimal(18, 2), efectivoNeto)
            .input('digital', sql.Decimal(18, 2), digitalNeto + chequesNeto)
            .input('desc', sql.NVarChar(255), descIngreso)
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
                MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @origenId,
                @efectivo, @digital, @desc, @uid)
            `);
        } else {
          const totalIngreso = r2(efectivoNeto + digitalNeto + chequesNeto);
          const caja = await this._getCajaAbiertaTx(tx, usuarioId);
          const pvId = caja?.PUNTO_VENTA_ID || null;
          const movResult = await tx.request()
            .input('idEntidad', sql.Int, pagoId)
            .input('tipoEntidad', sql.VarChar(20), 'COBRANZA')
            .input('movimiento', sql.NVarChar(500), descIngreso)
            .input('uid', sql.Int, usuarioId)
            .input('efectivo', sql.Decimal(18, 2), efectivoNeto)
            .input('digital', sql.Decimal(18, 2), digitalNeto)
            .input('cheques', sql.Decimal(18, 2), chequesNeto)
            .input('total', sql.Decimal(18, 2), totalIngreso)
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
                .input('monto', sql.Decimal(18, 2), r2(mp.MONTO))
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
      // Derive efectivo/digital/cheques from metodos_pago if provided
      let efectivo = input.EFECTIVO || 0;
      let digital = input.DIGITAL || 0;
      let cheques = input.CHEQUES || 0;

      if (input.metodos_pago && input.metodos_pago.length > 0) {
        const derived = await derivarCategoriasCO(tx, input.metodos_pago);
        efectivo = derived.efectivo;
        digital = derived.digital;
        cheques = derived.cheques;
      }

      const total = r2(efectivo + digital + cheques);

      if (total <= 0) {
        throw Object.assign(new Error('El total debe ser mayor a cero'), { name: 'ValidationError' });
      }

      // 0) Eliminar cheques previos asociados a esta cobranza (deben estar EN_CARTERA)
      await eliminarChequesDeCobranza(tx, pagoId);

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
        .input('efectivo', sql.Decimal(18, 2), efectivo)
        .input('digital', sql.Decimal(18, 2), digital)
        .input('cheques', sql.Decimal(18, 2), cheques)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
          UPDATE PAGOS_CTA_CORRIENTE_C SET
            FECHA = @fecha, TOTAL = @total, CONCEPTO = @concepto,
            EFECTIVO = @efectivo, DIGITAL = @digital, CHEQUES = @cheques,
            USUARIO_ID = @usuarioId
          WHERE PAGO_ID = @pagoId
        `);

      // 2b) Update payment method breakdown
      await ensureCobranzasMetodosPagoTable(tx);
      await tx.request().input('pagoId', sql.Int, pagoId)
        .query(`DELETE FROM COBRANZAS_METODOS_PAGO WHERE PAGO_ID = @pagoId`);
      if (input.metodos_pago && input.metodos_pago.length > 0) {
        for (const mp of input.metodos_pago) {
          if (mp.MONTO <= 0) continue;
          await tx.request()
            .input('pagoId', sql.Int, pagoId)
            .input('mpId', sql.Int, mp.METODO_PAGO_ID)
            .input('monto', sql.Decimal(18, 2), r2(mp.MONTO))
            .query(`INSERT INTO COBRANZAS_METODOS_PAGO (PAGO_ID, METODO_PAGO_ID, MONTO) VALUES (@pagoId, @mpId, @monto)`);
        }
      }

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

      // 4b) Re-crear cheques EN_CARTERA si los hay
      if (input.metodos_pago && input.metodos_pago.length > 0) {
        await crearChequesCobranza(tx, pagoId, input.metodos_pago, usuarioId);
      }

      // 5) Remove old ingreso records and re-register
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'COBRANZA'`);
      await ensureMovCajaMetodosPagoTable(tx);
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM MOVIMIENTOS_CAJA_METODOS_PAGO WHERE MOVIMIENTO_ID IN (SELECT ID FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @origenId AND TIPO_ENTIDAD = 'COBRANZA')`);
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @origenId AND TIPO_ENTIDAD = 'COBRANZA'`);

      const efectivoNeto = Math.max(0, efectivo);
      const digitalNeto = digital;
      const chequesNeto = cheques;
      if (efectivoNeto > 0 || digitalNeto > 0 || chequesNeto > 0) {
        const destino = input.DESTINO_COBRO || 'CAJA_CENTRAL';

        const cliNombreRes = await tx.request()
          .input('cid', sql.Int, clienteId)
          .query(`SELECT NOMBRE FROM CLIENTES WHERE CLIENTE_ID = @cid`);
        const nombreCli = cliNombreRes.recordset[0]?.NOMBRE || '';
        const descIngreso = `Cobro CO #${pagoId} - ${nombreCli}`;

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
            .input('origenTipo', sql.VarChar(30), 'COBRANZA')
            .input('origenId2', sql.Int, pagoId)
            .input('efectivo', sql.Decimal(18, 2), efectivoNeto)
            .input('digital', sql.Decimal(18, 2), digitalNeto + chequesNeto)
            .input('desc', sql.NVarChar(255), descIngreso)
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
                MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @origenId2,
                @efectivo, @digital, @desc, @uid)
            `);
        } else {
          const totalIngreso = r2(efectivoNeto + digitalNeto + chequesNeto);
          const caja = await this._getCajaAbiertaTx(tx, usuarioId);
          const pvId = caja?.PUNTO_VENTA_ID || null;
          const movResult = await tx.request()
            .input('idEntidad', sql.Int, pagoId)
            .input('tipoEntidad', sql.VarChar(20), 'COBRANZA')
            .input('movimiento', sql.NVarChar(500), descIngreso)
            .input('uid', sql.Int, usuarioId)
            .input('efectivo', sql.Decimal(18, 2), efectivoNeto)
            .input('digital', sql.Decimal(18, 2), digitalNeto)
            .input('cheques', sql.Decimal(18, 2), chequesNeto)
            .input('total', sql.Decimal(18, 2), totalIngreso)
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
                .input('monto', sql.Decimal(18, 2), r2(mp.MONTO))
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

  // ── Delete cobranza ────────────────────────────
  async eliminarCobranza(pagoId: number): Promise<void> {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // 0) Eliminar cheques originados por esta cobranza (deben estar EN_CARTERA)
      await eliminarChequesDeCobranza(tx, pagoId);

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

      // 3b) Remove ingreso records from Caja / Caja Central
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'COBRANZA'`);
      await ensureMovCajaMetodosPagoTable(tx);
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM MOVIMIENTOS_CAJA_METODOS_PAGO WHERE MOVIMIENTO_ID IN (SELECT ID FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @origenId AND TIPO_ENTIDAD = 'COBRANZA')`);
      await tx.request().input('origenId', sql.Int, pagoId)
        .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @origenId AND TIPO_ENTIDAD = 'COBRANZA'`);

      // 3c) Remove payment method breakdown
      await ensureCobranzasMetodosPagoTable(tx);
      await tx.request().input('pagoId', sql.Int, pagoId)
        .query(`DELETE FROM COBRANZAS_METODOS_PAGO WHERE PAGO_ID = @pagoId`);

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

  // ── Aggregated payment method totals for cobranzas ──
  async getCobranzasMetodosTotales(
    fechaDesde?: string,
    fechaHasta?: string,
    search?: string,
  ) {
    const pool = await getPool();
    await ensureCobranzasMetodosPagoTable(pool);
    const req = pool.request();

    let dateFilter = '';
    if (fechaDesde && fechaHasta) {
      dateFilter = ' AND p.FECHA BETWEEN @fechaDesde AND @fechaHasta';
      req.input('fechaDesde', sql.DateTime, new Date(fechaDesde));
      req.input('fechaHasta', sql.DateTime, new Date(fechaHasta));
    }

    let searchFilter = '';
    if (search) {
      searchFilter = ' AND (c.NOMBRE LIKE @search OR c.CODIGOPARTICULAR LIKE @search OR c.NUMERO_DOC LIKE @search)';
      req.input('search', sql.NVarChar, `%${search}%`);
    }

    const result = await req.query(`
      SELECT 
        mp.NOMBRE AS METODO_NOMBRE,
        mp.CATEGORIA,
        ISNULL(mp.IMAGEN_BASE64, '') AS IMAGEN_BASE64,
        SUM(cm.MONTO) AS TOTAL
      FROM COBRANZAS_METODOS_PAGO cm
      INNER JOIN PAGOS_CTA_CORRIENTE_C p ON cm.PAGO_ID = p.PAGO_ID
      INNER JOIN CTA_CORRIENTE_C cta ON p.CTA_CORRIENTE_ID = cta.CTA_CORRIENTE_ID
      INNER JOIN CLIENTES c ON cta.CLIENTE_ID = c.CLIENTE_ID
      INNER JOIN METODOS_PAGO mp ON cm.METODO_PAGO_ID = mp.METODO_PAGO_ID
      WHERE cm.MONTO > 0 ${dateFilter} ${searchFilter}
      GROUP BY mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64
      ORDER BY mp.CATEGORIA, SUM(cm.MONTO) DESC
    `);

    return result.recordset as { METODO_NOMBRE: string; CATEGORIA: string; IMAGEN_BASE64: string; TOTAL: number }[];
  },

  // ── Get ALL cobranzas across all accounts ──────
  async getAllCobranzas(
    fechaDesde?: string,
    fechaHasta?: string,
    search?: string,
  ): Promise<(CobranzaItem & { CLIENTE_ID: number; CLIENTE_NOMBRE: string; CTA_CORRIENTE_ID: number })[]> {
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
      searchFilter = ' AND (c.NOMBRE LIKE @search OR c.CODIGOPARTICULAR LIKE @search OR c.NUMERO_DOC LIKE @search)';
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
        c.CLIENTE_ID,
        c.NOMBRE AS CLIENTE_NOMBRE
      FROM PAGOS_CTA_CORRIENTE_C p
      INNER JOIN CTA_CORRIENTE_C cta ON p.CTA_CORRIENTE_ID = cta.CTA_CORRIENTE_ID
      INNER JOIN CLIENTES c ON cta.CLIENTE_ID = c.CLIENTE_ID
      LEFT JOIN USUARIOS u ON p.USUARIO_ID = u.USUARIO_ID
      WHERE 1=1 ${dateFilter} ${searchFilter}
      ORDER BY p.FECHA DESC, p.PAGO_ID DESC
    `);

    return result.recordset;
  },

  // ── Get customer list for cobranza selector ─────
  async getClientesConCtaCorriente(search?: string): Promise<{ CLIENTE_ID: number; CTA_CORRIENTE_ID: number; NOMBRE: string; CODIGOPARTICULAR: string; NUMERO_DOC: string; SALDO_ACTUAL: number }[]> {
    const pool = await getPool();
    const req = pool.request();

    let searchFilter = '';
    if (search) {
      searchFilter = ' AND (c.NOMBRE LIKE @search OR c.CODIGOPARTICULAR LIKE @search OR c.NUMERO_DOC LIKE @search)';
      req.input('search', sql.NVarChar, `%${search}%`);
    }

    const result = await req.query(`
      SELECT 
        c.CLIENTE_ID,
        cta.CTA_CORRIENTE_ID,
        c.NOMBRE,
        c.CODIGOPARTICULAR,
        c.NUMERO_DOC,
        ISNULL((
          SELECT SUM(DEBE - HABER) 
          FROM VENTAS_CTA_CORRIENTE vc 
          WHERE vc.CTA_CORRIENTE_ID = cta.CTA_CORRIENTE_ID
        ), 0) AS SALDO_ACTUAL
      FROM CLIENTES c
      INNER JOIN CTA_CORRIENTE_C cta ON c.CLIENTE_ID = cta.CLIENTE_ID
      WHERE c.ACTIVO = 1 AND c.CTA_CORRIENTE = 1 ${searchFilter}
      ORDER BY c.NOMBRE
    `);

    return result.recordset;
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
};
