import { getPool, sql } from '../database/connection.js';
import type { Caja, CajaItem, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Caja (Cash Register) Service
// ═══════════════════════════════════════════════════

export interface CajaFilter {
  page?: number;
  pageSize?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  estado?: string;
  puntoVentaIds?: number[];
}

export interface AbrirCajaInput {
  MONTO_APERTURA: number;
  PUNTO_VENTA_ID: number;
  OBSERVACIONES?: string;
}

export interface CerrarCajaInput {
  MONTO_CIERRE: number;
  OBSERVACIONES?: string;
}

export interface IngresoEgresoInput {
  tipo: 'INGRESO' | 'EGRESO';
  monto: number;
  descripcion: string;
}

export const cajaService = {
  // ── List cajas with pagination & filters ───────
  async getAll(filter: CajaFilter = {}): Promise<PaginatedResult<Caja>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.fechaDesde) {
      where += ' AND c.FECHA_APERTURA >= @fechaDesde';
      params.push({ name: 'fechaDesde', type: sql.DateTime, value: new Date(filter.fechaDesde) });
    }
    if (filter.fechaHasta) {
      where += ' AND c.FECHA_APERTURA <= @fechaHasta';
      params.push({ name: 'fechaHasta', type: sql.DateTime, value: new Date(filter.fechaHasta + 'T23:59:59') });
    }
    if (filter.estado) {
      where += ' AND c.ESTADO = @estado';
      params.push({ name: 'estado', type: sql.VarChar(20), value: filter.estado });
    }
    if (filter.puntoVentaIds && filter.puntoVentaIds.length > 0) {
      const pvPlaceholders = filter.puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      where += ` AND c.PUNTO_VENTA_ID IN (${pvPlaceholders})`;
      filter.puntoVentaIds.forEach((id, i) => {
        params.push({ name: `pv${i}`, type: sql.Int, value: id });
      });
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    const countResult = await bind(pool.request()).query(
      `SELECT COUNT(*) AS total FROM CAJA c ${where}`
    );

    const dataResult = await bind(pool.request()).query(`
      SELECT c.*, 
        u.NOMBRE AS USUARIO_NOMBRE,
        pv.NOMBRE AS PUNTO_VENTA_NOMBRE
      FROM CAJA c
      LEFT JOIN USUARIOS u ON c.USUARIO_ID = u.USUARIO_ID
      LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
      ${where}
      ORDER BY c.FECHA_APERTURA DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `.replace('@offset', String(offset)).replace('@pageSize', String(pageSize)));

    return {
      data: dataResult.recordset,
      total: countResult.recordset[0].total,
      page,
      pageSize,
    };
  },

  // ── Get caja by ID with items ──────────────────
  async getById(id: number) {
    const pool = await getPool();

    const cajaResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT c.*, 
          u.NOMBRE AS USUARIO_NOMBRE,
          pv.NOMBRE AS PUNTO_VENTA_NOMBRE
        FROM CAJA c
        LEFT JOIN USUARIOS u ON c.USUARIO_ID = u.USUARIO_ID
        LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
        WHERE c.CAJA_ID = @id
      `);

    if (cajaResult.recordset.length === 0) return null;

    const itemsResult = await pool.request()
      .input('cajaId', sql.Int, id)
      .query(`
        SELECT ci.*,
          u.NOMBRE AS USUARIO_NOMBRE
        FROM CAJA_ITEMS ci
        LEFT JOIN USUARIOS u ON ci.USUARIO_ID = u.USUARIO_ID
        WHERE ci.CAJA_ID = @cajaId
        ORDER BY ci.FECHA DESC
      `);

    const caja = cajaResult.recordset[0];

    // Calculate totals from items
    const totals = { efectivo: 0, digital: 0, ingresos: 0, egresos: 0 };
    for (const item of itemsResult.recordset) {
      const ef = item.MONTO_EFECTIVO || 0;
      const dg = item.MONTO_DIGITAL || 0;
      if (item.ORIGEN_TIPO === 'EGRESO') {
        totals.egresos += ef + dg;
      } else {
        totals.ingresos += ef + dg;
      }
      totals.efectivo += ef;
      totals.digital += dg;
    }

    return {
      ...caja,
      items: itemsResult.recordset,
      totales: totals,
    };
  },

  // ── Check if user already has an open caja ─────
  async getCajaAbierta(usuarioId: number) {
    const pool = await getPool();
    const result = await pool.request()
      .input('uid', sql.Int, usuarioId)
      .query(`
        SELECT c.*, 
          u.NOMBRE AS USUARIO_NOMBRE,
          pv.NOMBRE AS PUNTO_VENTA_NOMBRE
        FROM CAJA c
        LEFT JOIN USUARIOS u ON c.USUARIO_ID = u.USUARIO_ID
        LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
        WHERE c.USUARIO_ID = @uid AND c.ESTADO = 'ACTIVA'
      `);
    return result.recordset.length > 0 ? result.recordset[0] : null;
  },

  // ── Open a new caja ────────────────────────────
  async abrir(input: AbrirCajaInput, usuarioId: number) {
    const pool = await getPool();

    // Check no other active caja for this user
    const existing = await pool.request()
      .input('uid', sql.Int, usuarioId)
      .query(`SELECT CAJA_ID FROM CAJA WHERE USUARIO_ID = @uid AND ESTADO = 'ACTIVA'`);

    if (existing.recordset.length > 0) {
      throw new ValidationError('Ya tiene una caja abierta. Debe cerrarla antes de abrir otra.');
    }

    // Check fondo de cambio for retiro on open
    const fondoSaldo = await this.getSaldoFondoCambio(input.PUNTO_VENTA_ID);

    const transaction = (pool as any).transaction();
    await transaction.begin();

    try {
      // Insert caja
      const insertResult = await transaction.request()
        .input('uid', sql.Int, usuarioId)
        .input('monto', sql.Decimal(18, 2), input.MONTO_APERTURA)
        .input('pvId', sql.Int, input.PUNTO_VENTA_ID)
        .input('obs', sql.NVarChar(255), input.OBSERVACIONES || null)
        .query(`
          INSERT INTO CAJA (USUARIO_ID, FECHA_APERTURA, MONTO_APERTURA, ESTADO, PUNTO_VENTA_ID, OBSERVACIONES)
          OUTPUT INSERTED.CAJA_ID
          VALUES (@uid, GETDATE(), @monto, 'ACTIVA', @pvId, @obs)
        `);

      const cajaId = insertResult.recordset[0].CAJA_ID;

      // If monto > 0, register retiro from fondo de cambio
      if (input.MONTO_APERTURA > 0 && fondoSaldo > 0) {
        const retiro = Math.min(input.MONTO_APERTURA, fondoSaldo);
        await transaction.request()
          .input('cajaId', sql.Int, cajaId)
          .input('monto', sql.Decimal(18, 2), -retiro)
          .input('saldo', sql.Decimal(18, 2), fondoSaldo - retiro)
          .input('uid', sql.Int, usuarioId)
          .input('pvId', sql.Int, input.PUNTO_VENTA_ID)
          .query(`
            INSERT INTO FONDO_CAMBIO (CAJA_ID, TIPO_MOVIMIENTO, MONTO, SALDO_RESULTANTE, USUARIO_ID, PUNTO_VENTA_ID, OBSERVACIONES)
            VALUES (@cajaId, 'RETIRO', @monto, @saldo, @uid, @pvId, 'Retiro por apertura de caja')
          `);

        // Register the incoming cash as a CAJA_ITEMS entry
        await transaction.request()
          .input('cajaId', sql.Int, cajaId)
          .input('origenTipo', sql.VarChar(30), 'FONDO_CAMBIO')
          .input('efectivo', sql.Decimal(18, 2), retiro)
          .input('desc', sql.NVarChar(255), 'Retiro de fondo de cambio por apertura')
          .input('uid', sql.Int, usuarioId)
          .query(`
            INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
            VALUES (@cajaId, GETDATE(), @origenTipo, @efectivo, 0, @desc, @uid)
          `);
      }

      await transaction.commit();
      return { CAJA_ID: cajaId };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  // ── Close a caja ───────────────────────────────
  async cerrar(cajaId: number, input: CerrarCajaInput, usuarioId: number) {
    const pool = await getPool();

    const cajaResult = await pool.request()
      .input('id', sql.Int, cajaId)
      .query(`SELECT * FROM CAJA WHERE CAJA_ID = @id`);

    if (cajaResult.recordset.length === 0) {
      throw new ValidationError('Caja no encontrada');
    }

    const caja = cajaResult.recordset[0];
    if (caja.ESTADO !== 'ACTIVA') {
      throw new ValidationError('La caja no está activa');
    }
    if (caja.USUARIO_ID !== usuarioId) {
      throw new ValidationError('Solo el usuario que abrió la caja puede cerrarla');
    }

    const transaction = (pool as any).transaction();
    await transaction.begin();

    try {
      // Calculate actual totals from items
      const itemsResult = await transaction.request()
        .input('cajaId', sql.Int, cajaId)
        .query(`
          SELECT
            ISNULL(SUM(CASE WHEN ORIGEN_TIPO != 'EGRESO' THEN ISNULL(MONTO_EFECTIVO, 0) + ISNULL(MONTO_DIGITAL, 0) ELSE 0 END), 0) AS TOTAL_INGRESOS,
            ISNULL(SUM(CASE WHEN ORIGEN_TIPO = 'EGRESO' THEN ISNULL(MONTO_EFECTIVO, 0) + ISNULL(MONTO_DIGITAL, 0) ELSE 0 END), 0) AS TOTAL_EGRESOS,
            ISNULL(SUM(ISNULL(MONTO_EFECTIVO, 0)), 0) AS TOTAL_EFECTIVO,
            ISNULL(SUM(ISNULL(MONTO_DIGITAL, 0)), 0) AS TOTAL_DIGITAL
          FROM CAJA_ITEMS WHERE CAJA_ID = @cajaId
        `);

      const { TOTAL_EFECTIVO } = itemsResult.recordset[0];
      const montoCierre = input.MONTO_CIERRE ?? TOTAL_EFECTIVO;

      // Close the caja
      await transaction.request()
        .input('id', sql.Int, cajaId)
        .input('montoCierre', sql.Decimal(18, 2), montoCierre)
        .input('obs', sql.NVarChar(255), input.OBSERVACIONES || null)
        .query(`
          UPDATE CAJA 
          SET FECHA_CIERRE = GETDATE(), 
              MONTO_CIERRE = @montoCierre, 
              ESTADO = 'CERRADA',
              OBSERVACIONES = ISNULL(@obs, OBSERVACIONES)
          WHERE CAJA_ID = @id
        `);

      // Deposit remaining cash to fondo de cambio if positive
      if (montoCierre > 0) {
        const fondoSaldo = await this.getSaldoFondoCambioTx(transaction, caja.PUNTO_VENTA_ID);
        await transaction.request()
          .input('cajaId', sql.Int, cajaId)
          .input('monto', sql.Decimal(18, 2), montoCierre)
          .input('saldo', sql.Decimal(18, 2), fondoSaldo + montoCierre)
          .input('uid', sql.Int, usuarioId)
          .input('pvId', sql.Int, caja.PUNTO_VENTA_ID)
          .query(`
            INSERT INTO FONDO_CAMBIO (CAJA_ID, TIPO_MOVIMIENTO, MONTO, SALDO_RESULTANTE, USUARIO_ID, PUNTO_VENTA_ID, OBSERVACIONES)
            VALUES (@cajaId, 'DEPOSITO', @monto, @saldo, @uid, @pvId, 'Depósito por cierre de caja')
          `);

        // Register the outgoing cash as a CAJA_ITEMS entry
        await transaction.request()
          .input('cajaId', sql.Int, cajaId)
          .input('origenTipo', sql.VarChar(30), 'FONDO_CAMBIO')
          .input('efectivo', sql.Decimal(18, 2), -montoCierre)
          .input('desc', sql.NVarChar(255), 'Depósito a fondo de cambio por cierre')
          .input('uid', sql.Int, usuarioId)
          .query(`
            INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
            VALUES (@cajaId, GETDATE(), @origenTipo, @efectivo, 0, @desc, @uid)
          `);
      }

      await transaction.commit();
      return { success: true };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  // ── Add income/expense item to caja ────────────
  async addIngresoEgreso(cajaId: number, input: IngresoEgresoInput, usuarioId: number) {
    const pool = await getPool();

    // Validate caja is active
    const cajaResult = await pool.request()
      .input('id', sql.Int, cajaId)
      .query(`SELECT * FROM CAJA WHERE CAJA_ID = @id AND ESTADO = 'ACTIVA'`);

    if (cajaResult.recordset.length === 0) {
      throw new ValidationError('Caja no encontrada o no está activa');
    }

    const monto = input.tipo === 'EGRESO' ? -Math.abs(input.monto) : Math.abs(input.monto);

    const transaction = (pool as any).transaction();
    await transaction.begin();

    try {
      // Insert caja item
      const itemResult = await transaction.request()
        .input('cajaId', sql.Int, cajaId)
        .input('origenTipo', sql.VarChar(30), input.tipo)
        .input('efectivo', sql.Decimal(18, 2), monto)
        .input('desc', sql.NVarChar(255), input.descripcion)
        .input('uid', sql.Int, usuarioId)
        .query(`
          INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
          OUTPUT INSERTED.ITEM_ID
          VALUES (@cajaId, GETDATE(), @origenTipo, @efectivo, 0, @desc, @uid)
        `);

      const itemId = itemResult.recordset[0].ITEM_ID;

      // Insert into MOVIMIENTOS_CAJA
      const caja = cajaResult.recordset[0];
      const esIngreso = input.tipo === 'INGRESO';
      await transaction.request()
        .input('idEntidad', sql.Int, itemId)
        .input('cajaId', sql.Int, cajaId)
        .input('tipoEntidad', sql.VarChar(20), input.tipo)
        .input('movimiento', sql.NVarChar(500), input.descripcion)
        .input('uid', sql.Int, usuarioId)
        .input('efectivo', sql.Decimal(18, 2), esIngreso ? Math.abs(input.monto) : -Math.abs(input.monto))
        .input('total', sql.Decimal(18, 2), esIngreso ? Math.abs(input.monto) : -Math.abs(input.monto))
        .input('pvId', sql.Int, caja.PUNTO_VENTA_ID)
        .query(`
          INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, CAJA_ID, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
          VALUES (@idEntidad, @cajaId, @tipoEntidad, @movimiento, @uid, @efectivo, 0, 0, 0, @total, @pvId, 1)
        `);

      await transaction.commit();
      return { ITEM_ID: itemId };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  // ── Delete a manually added item ───────────────
  async deleteItem(cajaId: number, itemId: number) {
    const pool = await getPool();

    // Validate it's a manual ingreso/egreso
    const itemResult = await pool.request()
      .input('itemId', sql.Int, itemId)
      .input('cajaId', sql.Int, cajaId)
      .query(`
        SELECT * FROM CAJA_ITEMS 
        WHERE ITEM_ID = @itemId AND CAJA_ID = @cajaId 
          AND ORIGEN_TIPO IN ('INGRESO', 'EGRESO')
      `);

    if (itemResult.recordset.length === 0) {
      throw new ValidationError('Ítem no encontrado o no es un ingreso/egreso manual');
    }

    // Check caja is active
    const cajaResult = await pool.request()
      .input('cajaId', sql.Int, cajaId)
      .query(`SELECT ESTADO FROM CAJA WHERE CAJA_ID = @cajaId`);

    if (cajaResult.recordset.length === 0 || cajaResult.recordset[0].ESTADO !== 'ACTIVA') {
      throw new ValidationError('Solo se pueden eliminar ítems de cajas activas');
    }

    const transaction = (pool as any).transaction();
    await transaction.begin();

    try {
      // Delete from MOVIMIENTOS_CAJA
      await transaction.request()
        .input('itemId', sql.Int, itemId)
        .input('tipo', sql.VarChar(20), itemResult.recordset[0].ORIGEN_TIPO)
        .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @itemId AND TIPO_ENTIDAD = @tipo`);

      // Delete from CAJA_ITEMS
      await transaction.request()
        .input('itemId', sql.Int, itemId)
        .query(`DELETE FROM CAJA_ITEMS WHERE ITEM_ID = @itemId`);

      await transaction.commit();
      return { success: true };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  // ── Get fondo de cambio saldo ──────────────────
  async getSaldoFondoCambio(puntoVentaId?: number): Promise<number> {
    const pool = await getPool();
    return this._getSaldoFC(pool, puntoVentaId);
  },

  async getSaldoFondoCambioTx(transaction: any, puntoVentaId?: number): Promise<number> {
    return this._getSaldoFC(transaction, puntoVentaId);
  },

  async _getSaldoFC(ctx: any, puntoVentaId?: number): Promise<number> {
    let query: string;
    const req = ctx.request();
    if (puntoVentaId) {
      req.input('pvId', sql.Int, puntoVentaId);
      query = `
        SELECT TOP 1 SALDO_RESULTANTE 
        FROM FONDO_CAMBIO 
        WHERE PUNTO_VENTA_ID = @pvId
        ORDER BY ID DESC
      `;
    } else {
      query = `
        SELECT TOP 1 SALDO_RESULTANTE 
        FROM FONDO_CAMBIO 
        ORDER BY ID DESC
      `;
    }
    const result = await req.query(query);
    return result.recordset.length > 0 ? result.recordset[0].SALDO_RESULTANTE : 0;
  },

  // ── Get fondo de cambio history ────────────────
  async getFondoCambioHistory(puntoVentaId?: number, limit = 50) {
    const pool = await getPool();
    const req = pool.request().input('limit', sql.Int, limit);
    let pvFilter = '';
    if (puntoVentaId) {
      pvFilter = ' WHERE fc.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, puntoVentaId);
    }

    const result = await req.query(`
      SELECT TOP (@limit) fc.*, u.NOMBRE AS USUARIO_NOMBRE
      FROM FONDO_CAMBIO fc
      LEFT JOIN USUARIOS u ON fc.USUARIO_ID = u.USUARIO_ID
      ${pvFilter}
      ORDER BY fc.ID DESC
    `);

    return result.recordset;
  },

  // ── List open cajas (for fund transfer selector) ──
  async getCajasAbiertas(puntoVentaId?: number) {
    const pool = await getPool();
    const req = pool.request();
    let pvFilter = '';
    if (puntoVentaId) {
      pvFilter = ' AND c.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, puntoVentaId);
    }

    const result = await req.query(`
      SELECT c.CAJA_ID, c.USUARIO_ID, c.FECHA_APERTURA, c.MONTO_APERTURA, c.PUNTO_VENTA_ID,
        u.NOMBRE AS USUARIO_NOMBRE,
        pv.NOMBRE AS PUNTO_VENTA_NOMBRE,
        ISNULL(SUM(ci.MONTO_EFECTIVO), 0) AS EFECTIVO_DISPONIBLE
      FROM CAJA c
      LEFT JOIN USUARIOS u ON c.USUARIO_ID = u.USUARIO_ID
      LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
      LEFT JOIN CAJA_ITEMS ci ON ci.CAJA_ID = c.CAJA_ID
      WHERE c.ESTADO = 'ACTIVA' ${pvFilter}
      GROUP BY c.CAJA_ID, c.USUARIO_ID, c.FECHA_APERTURA, c.MONTO_APERTURA, c.PUNTO_VENTA_ID,
        u.NOMBRE, pv.NOMBRE
      ORDER BY c.CAJA_ID
    `);

    return result.recordset;
  },

  // ── Get effective cash in a specific caja ──────
  async getEfectivoCaja(cajaId: number): Promise<number> {
    const pool = await getPool();
    const result = await pool.request()
      .input('cajaId', sql.Int, cajaId)
      .query(`
        SELECT ISNULL(SUM(ci.MONTO_EFECTIVO), 0) AS EFECTIVO
        FROM CAJA c
        LEFT JOIN CAJA_ITEMS ci ON ci.CAJA_ID = c.CAJA_ID
        WHERE c.CAJA_ID = @cajaId AND c.ESTADO = 'ACTIVA'
        GROUP BY c.CAJA_ID
      `);
    if (result.recordset.length === 0) throw new ValidationError('Caja no encontrada o no está activa');
    return result.recordset[0].EFECTIVO;
  },

  // ── Transfer between Fondo de Cambio and CC/Caja ──
  async transferirFondoCambio(input: {
    origen: 'CAJA_CENTRAL' | 'FONDO_CAMBIO' | 'CAJA';
    destino: 'CAJA_CENTRAL' | 'FONDO_CAMBIO' | 'CAJA';
    monto: number;
    observaciones?: string;
    cajaId?: number;
  }, usuarioId: number, puntoVentaId?: number) {
    const pool = await getPool();
    const { origen, destino, monto, observaciones, cajaId } = input;

    // Validate
    if (monto <= 0) throw new ValidationError('El monto debe ser mayor a cero');
    if (origen === destino) throw new ValidationError('Origen y destino no pueden ser el mismo');
    if (origen !== 'FONDO_CAMBIO' && destino !== 'FONDO_CAMBIO') {
      throw new ValidationError('Las transferencias deben pasar por el Fondo de Cambio');
    }
    if ((origen === 'CAJA' || destino === 'CAJA') && !cajaId) {
      throw new ValidationError('Debe seleccionar una caja');
    }

    const transaction = (pool as any).transaction();
    await transaction.begin();

    try {
      const fondoSaldo = await this.getSaldoFondoCambioTx(transaction, puntoVentaId);

      // ── FC is the source (retiro from fund) ────
      if (origen === 'FONDO_CAMBIO') {
        if (fondoSaldo < monto) {
          throw new ValidationError(`Saldo insuficiente en el fondo. Disponible: $${fondoSaldo.toFixed(2)}`);
        }

        // 1. Register RETIRO in FONDO_CAMBIO
        await transaction.request()
          .input('cajaId', sql.Int, cajaId || null)
          .input('monto', sql.Decimal(18, 2), -monto)
          .input('saldo', sql.Decimal(18, 2), fondoSaldo - monto)
          .input('uid', sql.Int, usuarioId)
          .input('pvId', sql.Int, puntoVentaId || null)
          .input('obs', sql.NVarChar(500), observaciones || `Retiro de fondo → ${destino === 'CAJA_CENTRAL' ? 'Caja Central' : `Caja #${cajaId}`}`)
          .query(`
            INSERT INTO FONDO_CAMBIO (CAJA_ID, TIPO_MOVIMIENTO, MONTO, SALDO_RESULTANTE, USUARIO_ID, PUNTO_VENTA_ID, OBSERVACIONES)
            VALUES (@cajaId, 'RETIRO', @monto, @saldo, @uid, @pvId, @obs)
          `);

        // 2. Counterpart in destination
        if (destino === 'CAJA_CENTRAL') {
          await transaction.request()
            .input('cajaId', sql.Int, cajaId || null)
            .input('tipoEntidad', sql.VarChar(20), 'TRANSFERENCIA_FC')
            .input('movimiento', sql.NVarChar(500), observaciones || 'Ingreso desde Fondo de Cambio')
            .input('uid', sql.Int, usuarioId)
            .input('efectivo', sql.Decimal(18, 2), monto)
            .input('total', sql.Decimal(18, 2), monto)
            .input('pvId', sql.Int, puntoVentaId || null)
            .query(`
              INSERT INTO MOVIMIENTOS_CAJA (CAJA_ID, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
              VALUES (@cajaId, @tipoEntidad, @movimiento, @uid, @efectivo, 0, 0, 0, @total, @pvId, 1)
            `);
        } else if (destino === 'CAJA') {
          await transaction.request()
            .input('cajaId', sql.Int, cajaId)
            .input('origenTipo', sql.VarChar(30), 'FONDO_CAMBIO')
            .input('efectivo', sql.Decimal(18, 2), monto)
            .input('desc', sql.NVarChar(255), observaciones || 'Ingreso desde Fondo de Cambio')
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @efectivo, 0, @desc, @uid)
            `);
        }
      }

      // ── FC is the destination (deposit to fund) ──
      if (destino === 'FONDO_CAMBIO') {
        // Validate source has enough cash
        if (origen === 'CAJA' && cajaId) {
          const efectivoCaja = await this._getEfectivoCajaTx(transaction, cajaId);
          if (efectivoCaja < monto) {
            throw new ValidationError(`Efectivo insuficiente en la caja. Disponible: $${efectivoCaja.toFixed(2)}`);
          }
        }
        if (origen === 'CAJA_CENTRAL') {
          const efectivoCC = await this._getEfectivoCajaCentralTx(transaction, puntoVentaId);
          if (efectivoCC < monto) {
            throw new ValidationError(`Efectivo insuficiente en Caja Central. Disponible: $${efectivoCC.toFixed(2)}`);
          }
        }

        // 1. Register DEPOSITO in FONDO_CAMBIO
        await transaction.request()
          .input('cajaId', sql.Int, cajaId || null)
          .input('monto', sql.Decimal(18, 2), monto)
          .input('saldo', sql.Decimal(18, 2), fondoSaldo + monto)
          .input('uid', sql.Int, usuarioId)
          .input('pvId', sql.Int, puntoVentaId || null)
          .input('obs', sql.NVarChar(500), observaciones || `Depósito al fondo ← ${origen === 'CAJA_CENTRAL' ? 'Caja Central' : `Caja #${cajaId}`}`)
          .query(`
            INSERT INTO FONDO_CAMBIO (CAJA_ID, TIPO_MOVIMIENTO, MONTO, SALDO_RESULTANTE, USUARIO_ID, PUNTO_VENTA_ID, OBSERVACIONES)
            VALUES (@cajaId, 'DEPOSITO', @monto, @saldo, @uid, @pvId, @obs)
          `);

        // 2. Counterpart in source
        if (origen === 'CAJA_CENTRAL') {
          await transaction.request()
            .input('cajaId', sql.Int, cajaId || null)
            .input('tipoEntidad', sql.VarChar(20), 'TRANSFERENCIA_FC')
            .input('movimiento', sql.NVarChar(500), observaciones || 'Egreso hacia Fondo de Cambio')
            .input('uid', sql.Int, usuarioId)
            .input('efectivo', sql.Decimal(18, 2), -monto)
            .input('total', sql.Decimal(18, 2), -monto)
            .input('pvId', sql.Int, puntoVentaId || null)
            .query(`
              INSERT INTO MOVIMIENTOS_CAJA (CAJA_ID, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
              VALUES (@cajaId, @tipoEntidad, @movimiento, @uid, @efectivo, 0, 0, 0, @total, @pvId, 1)
            `);
        } else if (origen === 'CAJA') {
          await transaction.request()
            .input('cajaId', sql.Int, cajaId)
            .input('origenTipo', sql.VarChar(30), 'FONDO_CAMBIO')
            .input('efectivo', sql.Decimal(18, 2), -monto)
            .input('desc', sql.NVarChar(255), observaciones || 'Egreso hacia Fondo de Cambio')
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @efectivo, 0, @desc, @uid)
            `);
        }
      }

      await transaction.commit();
      return { success: true, nuevoSaldoFondo: destino === 'FONDO_CAMBIO' ? fondoSaldo + monto : fondoSaldo - monto };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  // ── Helper: get effective cash in caja within transaction ──
  async _getEfectivoCajaTx(transaction: any, cajaId: number): Promise<number> {
    const result = await transaction.request()
      .input('cajaId', sql.Int, cajaId)
      .query(`
        SELECT ISNULL(SUM(ci.MONTO_EFECTIVO), 0) AS EFECTIVO
        FROM CAJA c
        LEFT JOIN CAJA_ITEMS ci ON ci.CAJA_ID = c.CAJA_ID
        WHERE c.CAJA_ID = @cajaId AND c.ESTADO = 'ACTIVA'
        GROUP BY c.CAJA_ID
      `);
    return result.recordset.length > 0 ? result.recordset[0].EFECTIVO : 0;
  },

  // ── Helper: get effective cash in Caja Central within transaction ──
  async _getEfectivoCajaCentralTx(transaction: any, puntoVentaId?: number): Promise<number> {
    const req = transaction.request();
    let pvFilter = '';
    if (puntoVentaId) {
      pvFilter = 'WHERE PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, puntoVentaId);
    }
    const result = await req.query(`
      SELECT ISNULL(SUM(EFECTIVO), 0) AS efectivo
      FROM MOVIMIENTOS_CAJA
      ${pvFilter}
    `);
    return result.recordset[0]?.efectivo ?? 0;
  },

  // ── Get effective cash in Caja Central (public, no transaction) ──
  async getEfectivoCajaCentral(puntoVentaId?: number): Promise<number> {
    const pool = await getPool();
    const req = pool.request();
    let pvFilter = '';
    if (puntoVentaId) {
      pvFilter = 'WHERE PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, puntoVentaId);
    }
    const result = await req.query(`
      SELECT ISNULL(SUM(EFECTIVO), 0) AS efectivo
      FROM MOVIMIENTOS_CAJA
      ${pvFilter}
    `);
    return result.recordset[0]?.efectivo ?? 0;
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
