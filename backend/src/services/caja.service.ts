import { getPool, sql } from '../database/connection.js';
import type { Caja, CajaSesion, CajaItem, CajaUsuario, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Caja (Cash Register) Service
//
//  Modelo: Caja persistente (1 por (cajero, PV) o N por PV con N usuarios)
//          + Sesiones de apertura/cierre
//          + Transferencias directas CC ↔ Caja
//          SIN Fondo de Cambio
// ═══════════════════════════════════════════════════

export interface CajaFilter {
  page?: number;
  pageSize?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  estado?: string;
  puntoVentaIds?: number[];
  usuarioId?: number;
  activa?: boolean;
}

export interface SesionFilter {
  page?: number;
  pageSize?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  estado?: string;
  cajaId?: number;
  usuarioId?: number;
  puntoVentaIds?: number[];
}

export interface AbrirSesionInput {
  cajaId: number;
  fuente: 'USAR_RETENIDO' | 'APORTE_CC' | 'MIXTO' | 'NINGUNO';
  montoApertura: number;
  obs?: string;
}

export interface CerrarSesionInput {
  saldoRetenido: number;
  deposito: 'TOTAL' | 'PARCIAL' | 'NINGUNO';
  depositoMonto?: number;
  obs?: string;
}

export interface TransferirInput {
  origen: 'CAJA_CENTRAL' | 'CAJA';
  destino: 'CAJA_CENTRAL' | 'CAJA';
  monto: number;
  cajaId?: number;
  observaciones?: string;
}

export interface IngresoEgresoInput {
  tipo: 'INGRESO' | 'EGRESO';
  monto: number;
  descripcion: string;
}

// Tipos de MOVIMIENTOS_CAJA que se excluyen del balance operativo.
// `DEPOSITO_CIERRE` NO se excluye: es un movimiento real de efectivo
// desde la caja hacia Caja Central al cerrar la sesión, y debe impactar
// el saldo (tal como lo hacía la versión anterior con `CIERRE_CAJA`).
// `DEPOSITO_FONDO` y `REINTEGRO_FONDO` SÍ se excluyen: son movimientos
// legacy de Fondo de Cambio (TOTAL=0) que sólo trasladan saldo dentro de CC.
const INTERNAL_TYPES_SQL = `('TRANSFERENCIA_CC', 'APERTURA_CAJA', 'DEPOSITO_FONDO', 'REINTEGRO_FONDO')`;

export const cajaService = {
  // ════════════════════════════════════════════════════════════════
  //  ABM DE CAJAS PERSISTENTES
  // ════════════════════════════════════════════════════════════════

  async listarCajas(filter: CajaFilter = {}): Promise<Caja[]> {
    const pool = await getPool();
    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.puntoVentaIds && filter.puntoVentaIds.length > 0) {
      const ph = filter.puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      where += ` AND c.PUNTO_VENTA_ID IN (${ph})`;
      filter.puntoVentaIds.forEach((id, i) => params.push({ name: `pv${i}`, type: sql.Int, value: id }));
    }
    if (filter.activa !== undefined) {
      where += ' AND c.ACTIVA = @activa';
      params.push({ name: 'activa', type: sql.Bit, value: filter.activa ? 1 : 0 });
    }
    if (filter.usuarioId) {
      where += ' AND EXISTS (SELECT 1 FROM CAJA_USUARIOS cu WHERE cu.CAJA_ID = c.CAJA_ID AND cu.USUARIO_ID = @uid)';
      params.push({ name: 'uid', type: sql.Int, value: filter.usuarioId });
    }

    const req = pool.request();
    for (const p of params) req.input(p.name, p.type, p.value);

    const result = await req.query(`
      SELECT c.*,
        pv.NOMBRE AS PUNTO_VENTA_NOMBRE,
        (SELECT COUNT(*) FROM CAJA_SESIONES cs WHERE cs.CAJA_ID = c.CAJA_ID) AS TOTAL_SESIONES,
        (SELECT TOP 1 cs.SESION_ID FROM CAJA_SESIONES cs WHERE cs.CAJA_ID = c.CAJA_ID AND cs.ESTADO = 'ACTIVA') AS SESION_ACTIVA_ID,
        ISNULL((SELECT COUNT(*) FROM CAJA_USUARIOS cu WHERE cu.CAJA_ID = c.CAJA_ID), 0) AS CANT_USUARIOS,
        ISNULL((SELECT STRING_AGG(CONVERT(VARCHAR(20), cu.USUARIO_ID), ',') WITHIN GROUP (ORDER BY cu.USUARIO_ID)
                FROM CAJA_USUARIOS cu WHERE cu.CAJA_ID = c.CAJA_ID), '') AS USUARIOS_IDS
      FROM CAJA c
      LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
      ${where}
      ORDER BY c.CAJA_ID
    `);

    // Normalizar a la forma esperada por el frontend: USUARIOS_ASIGNADOS = [{ USUARIO_ID }]
    for (const row of result.recordset) {
      const ids = row.USUARIOS_IDS ? String(row.USUARIOS_IDS).split(',').filter(Boolean).map(Number) : [];
      row.USUARIOS_ASIGNADOS = ids.map((id: number) => ({ USUARIO_ID: id }));
      delete row.USUARIOS_IDS;
    }
    return result.recordset;
  },

  async getCajaById(id: number) {
    const pool = await getPool();
    const cajaResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT c.*,
          pv.NOMBRE AS PUNTO_VENTA_NOMBRE,
          uc.NOMBRE AS CREADA_POR_NOMBRE
        FROM CAJA c
        LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
        LEFT JOIN USUARIOS uc ON c.CREADA_POR = uc.USUARIO_ID
        WHERE c.CAJA_ID = @id
      `);
    if (cajaResult.recordset.length === 0) return null;
    const caja = cajaResult.recordset[0];

    const usuariosResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT cu.*, u.NOMBRE AS USUARIO_NOMBRE
        FROM CAJA_USUARIOS cu
        LEFT JOIN USUARIOS u ON cu.USUARIO_ID = u.USUARIO_ID
        WHERE cu.CAJA_ID = @id
        ORDER BY cu.ES_PREFERIDO DESC, u.NOMBRE
      `);
    caja.USUARIOS_ASIGNADOS = usuariosResult.recordset;

    const sesionesResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT cs.*, u.NOMBRE AS USUARIO_NOMBRE,
          ISNULL((SELECT SUM(ci.MONTO_EFECTIVO) FROM CAJA_ITEMS ci WHERE ci.SESION_ID = cs.SESION_ID), 0) AS EFECTIVO_DISPONIBLE,
          ISNULL((SELECT SUM(ci.MONTO_DIGITAL) FROM CAJA_ITEMS ci WHERE ci.SESION_ID = cs.SESION_ID AND ci.ORIGEN_TIPO = 'VENTA'), 0) AS DIGITAL_DISPONIBLE,
          ISNULL((SELECT SUM(ci.MONTO_EFECTIVO) FROM CAJA_ITEMS ci WHERE ci.SESION_ID = cs.SESION_ID AND ci.ORIGEN_TIPO = 'VENTA'), 0) AS VENTA_EFECTIVO
        FROM CAJA_SESIONES cs
        LEFT JOIN USUARIOS u ON cs.USUARIO_ID = u.USUARIO_ID
        WHERE cs.CAJA_ID = @id
        ORDER BY cs.NRO_SESION DESC
      `);
    caja.SESIONES = sesionesResult.recordset;

    return caja;
  },

  async crearCaja(input: { nombre?: string; puntoVentaId: number; usuariosIds: number[]; observaciones?: string }, usuarioCreador: number) {
    const pool = await getPool();
    const transaction = (pool as any).transaction();
    await transaction.begin();
    try {
      const result = await transaction.request()
        .input('nombre', sql.NVarChar(100), input.nombre || null)
        .input('pvId', sql.Int, input.puntoVentaId)
        .input('creador', sql.Int, usuarioCreador)
        .query(`
          INSERT INTO CAJA (
            NOMBRE, PUNTO_VENTA_ID, ACTIVA, SALDO_RETENIDO, CREADA_EN, CREADA_POR,
            USUARIO_ID, FECHA_APERTURA, MONTO_APERTURA, ESTADO
          )
          OUTPUT INSERTED.CAJA_ID
          VALUES (
            @nombre, @pvId, 1, 0, GETDATE(), @creador,
            @creador, GETDATE(), 0, N'CERRADA'
          )
        `);
      const cajaId = result.recordset[0].CAJA_ID;

      // Asignar usuarios
      for (const uid of input.usuariosIds) {
        await transaction.request()
          .input('cid', sql.Int, cajaId)
          .input('uid', sql.Int, uid)
          .query(`INSERT INTO CAJA_USUARIOS (CAJA_ID, USUARIO_ID, ES_PREFERIDO) VALUES (@cid, @uid, 0)`);
      }

      await transaction.commit();
      return { CAJA_ID: cajaId };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async editarCaja(id: number, input: { nombre?: string; activa?: boolean; observaciones?: string }) {
    const pool = await getPool();
    const sets: string[] = [];
    const params: { name: string; type: any; value: any }[] = [];
    if (input.nombre !== undefined) { sets.push('NOMBRE = @nombre'); params.push({ name: 'nombre', type: sql.NVarChar(100), value: input.nombre }); }
    if (input.activa !== undefined) { sets.push('ACTIVA = @activa'); params.push({ name: 'activa', type: sql.Bit, value: input.activa ? 1 : 0 }); }
    if (sets.length === 0) return { success: true };

    const req = pool.request();
    for (const p of params) req.input(p.name, p.type, p.value);
    req.input('id', sql.Int, id);
    await req.query(`UPDATE CAJA SET ${sets.join(', ')} WHERE CAJA_ID = @id`);
    return { success: true };
  },

  async asignarUsuarios(cajaId: number, usuariosIds: number[]) {
    const pool = await getPool();
    const transaction = (pool as any).transaction();
    await transaction.begin();
    try {
      await transaction.request()
        .input('cid', sql.Int, cajaId)
        .query(`DELETE FROM CAJA_USUARIOS WHERE CAJA_ID = @cid`);
      for (const uid of usuariosIds) {
        await transaction.request()
          .input('cid', sql.Int, cajaId)
          .input('uid', sql.Int, uid)
          .query(`INSERT INTO CAJA_USUARIOS (CAJA_ID, USUARIO_ID, ES_PREFERIDO) VALUES (@cid, @uid, 0)`);
      }
      await transaction.commit();
      return { success: true };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async quitarUsuario(cajaId: number, usuarioId: number) {
    const pool = await getPool();
    await pool.request()
      .input('cid', sql.Int, cajaId)
      .input('uid', sql.Int, usuarioId)
      .query(`DELETE FROM CAJA_USUARIOS WHERE CAJA_ID = @cid AND USUARIO_ID = @uid`);
    return { success: true };
  },

  // ════════════════════════════════════════════════════════════════
  //  SESIONES
  // ════════════════════════════════════════════════════════════════

  async getMisCajas(usuarioId: number): Promise<Caja[]> {
    const pool = await getPool();
    const result = await pool.request()
      .input('uid', sql.Int, usuarioId)
      .query(`
        SELECT c.*,
          pv.NOMBRE AS PUNTO_VENTA_NOMBRE,
          (SELECT COUNT(*) FROM CAJA_SESIONES cs WHERE cs.CAJA_ID = c.CAJA_ID) AS TOTAL_SESIONES,
          (SELECT TOP 1 cs.SESION_ID FROM CAJA_SESIONES cs WHERE cs.CAJA_ID = c.CAJA_ID AND cs.ESTADO = 'ACTIVA') AS SESION_ACTIVA_ID,
          CASE WHEN EXISTS (SELECT 1 FROM CAJA_SESIONES cs2 WHERE cs2.CAJA_ID = c.CAJA_ID AND cs2.ESTADO = 'ACTIVA') THEN 1 ELSE 0 END AS TIENE_SESION_ACTIVA
        FROM CAJA c
        INNER JOIN CAJA_USUARIOS cu ON cu.CAJA_ID = c.CAJA_ID AND cu.USUARIO_ID = @uid
        LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
        WHERE c.ACTIVA = 1
        ORDER BY pv.NOMBRE, c.NOMBRE
      `);
    return result.recordset;
  },

  async getMiSesionActiva(usuarioId: number): Promise<CajaSesion | null> {
    const pool = await getPool();
    const result = await pool.request()
      .input('uid', sql.Int, usuarioId)
      .query(`
        SELECT cs.*, u.NOMBRE AS USUARIO_NOMBRE,
          c.PUNTO_VENTA_ID, pv.NOMBRE AS PUNTO_VENTA_NOMBRE,
          ISNULL((SELECT SUM(ci.MONTO_EFECTIVO) FROM CAJA_ITEMS ci WHERE ci.SESION_ID = cs.SESION_ID), 0) AS EFECTIVO_DISPONIBLE,
          ISNULL((SELECT SUM(ci.MONTO_DIGITAL) FROM CAJA_ITEMS ci WHERE ci.SESION_ID = cs.SESION_ID AND ci.ORIGEN_TIPO = 'VENTA'), 0) AS DIGITAL_DISPONIBLE,
          ISNULL((SELECT SUM(ci.MONTO_EFECTIVO) FROM CAJA_ITEMS ci WHERE ci.SESION_ID = cs.SESION_ID AND ci.ORIGEN_TIPO = 'VENTA'), 0) AS VENTA_EFECTIVO
        FROM CAJA_SESIONES cs
        INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
        LEFT JOIN USUARIOS u ON cs.USUARIO_ID = u.USUARIO_ID
        LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
        WHERE cs.USUARIO_ID = @uid AND cs.ESTADO = 'ACTIVA'
      `);
    return result.recordset.length > 0 ? result.recordset[0] : null;
  },

  async getSesionById(sesionId: number) {
    const pool = await getPool();
    const sesionResult = await pool.request()
      .input('id', sql.Int, sesionId)
      .query(`
        SELECT cs.*, u.NOMBRE AS USUARIO_NOMBRE,
          c.PUNTO_VENTA_ID, pv.NOMBRE AS PUNTO_VENTA_NOMBRE,
          c.NOMBRE AS CAJA_NOMBRE,
          ISNULL((
            SELECT SUM(ci.MONTO_EFECTIVO)
            FROM CAJA_ITEMS ci
            WHERE ci.SESION_ID = cs.SESION_ID
          ), 0) AS EFECTIVO_DISPONIBLE,
          ISNULL((
            SELECT SUM(ci.MONTO_DIGITAL)
            FROM CAJA_ITEMS ci
            WHERE ci.SESION_ID = cs.SESION_ID AND ci.ORIGEN_TIPO = 'VENTA'
          ), 0) AS DIGITAL_DISPONIBLE,
          ISNULL((
            SELECT SUM(ci.MONTO_EFECTIVO)
            FROM CAJA_ITEMS ci
            WHERE ci.SESION_ID = cs.SESION_ID AND ci.ORIGEN_TIPO = 'VENTA'
          ), 0) AS VENTA_EFECTIVO
        FROM CAJA_SESIONES cs
        INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
        LEFT JOIN USUARIOS u ON cs.USUARIO_ID = u.USUARIO_ID
        LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
        WHERE cs.SESION_ID = @id
      `);
    if (sesionResult.recordset.length === 0) return null;
    const sesion = sesionResult.recordset[0];

    const itemsResult = await pool.request()
      .input('sid', sql.Int, sesionId)
      .query(`
        SELECT ci.*, u.NOMBRE AS USUARIO_NOMBRE
        FROM CAJA_ITEMS ci
        LEFT JOIN USUARIOS u ON ci.USUARIO_ID = u.USUARIO_ID
        WHERE ci.SESION_ID = @sid
        ORDER BY ci.FECHA DESC
      `);

    // Calcular totales
    let efectivo = 0, digital = 0, ingresos = 0, egresos = 0;
    for (const it of itemsResult.recordset) {
      const ef = Number(it.MONTO_EFECTIVO) || 0;
      const dg = Number(it.MONTO_DIGITAL) || 0;
      efectivo += ef;
      digital += dg;
      if (it.ORIGEN_TIPO === 'EGRESO') {
        egresos += Math.abs(ef) + Math.abs(dg);
      } else if (it.ORIGEN_TIPO !== 'APERTURA') {
        ingresos += ef + dg;
      }
    }

    return {
      ...sesion,
      items: itemsResult.recordset,
      totales: { efectivo, digital, ingresos, egresos },
    };
  },

  async getSesiones(filter: SesionFilter = {}): Promise<PaginatedResult<CajaSesion>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.fechaDesde) {
      where += ' AND cs.FECHA_APERTURA >= @fechaDesde';
      params.push({ name: 'fechaDesde', type: sql.DateTime, value: new Date(filter.fechaDesde + 'T00:00:00') });
    }
    if (filter.fechaHasta) {
      where += ' AND cs.FECHA_APERTURA <= @fechaHasta';
      params.push({ name: 'fechaHasta', type: sql.DateTime, value: new Date(filter.fechaHasta + 'T23:59:59') });
    }
    if (filter.estado) {
      where += ' AND cs.ESTADO = @estado';
      params.push({ name: 'estado', type: sql.VarChar(20), value: filter.estado });
    }
    if (filter.cajaId) {
      where += ' AND cs.CAJA_ID = @cajaId';
      params.push({ name: 'cajaId', type: sql.Int, value: filter.cajaId });
    }
    if (filter.usuarioId) {
      where += ' AND cs.USUARIO_ID = @usuarioId';
      params.push({ name: 'usuarioId', type: sql.Int, value: filter.usuarioId });
    }
    if (filter.puntoVentaIds && filter.puntoVentaIds.length > 0) {
      const ph = filter.puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      where += ` AND c.PUNTO_VENTA_ID IN (${ph})`;
      filter.puntoVentaIds.forEach((id, i) => params.push({ name: `pv${i}`, type: sql.Int, value: id }));
    }

    const req = pool.request();
    for (const p of params) req.input(p.name, p.type, p.value);

    const countResult = await req.query(`SELECT COUNT(*) AS total FROM CAJA_SESIONES cs INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID ${where}`);
    const total = countResult.recordset[0].total;

    const dataReq = pool.request();
    for (const p of params) dataReq.input(p.name, p.type, p.value);
    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query(`
      SELECT cs.*, u.NOMBRE AS USUARIO_NOMBRE,
        c.PUNTO_VENTA_ID, pv.NOMBRE AS PUNTO_VENTA_NOMBRE,
        c.NOMBRE AS CAJA_NOMBRE
      FROM CAJA_SESIONES cs
      INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
      LEFT JOIN USUARIOS u ON cs.USUARIO_ID = u.USUARIO_ID
      LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
      ${where}
      ORDER BY cs.FECHA_APERTURA DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    const activasResult = await pool.request()
      .query(`SELECT COUNT(*) AS activas FROM CAJA_SESIONES WHERE ESTADO = 'ACTIVA'`);

    return {
      data: dataResult.recordset,
      total,
      page,
      pageSize,
      activas: activasResult.recordset[0].activas,
    };
  },

  // ════════════════════════════════════════════════════════════════
  //  APERTURA / CIERRE DE SESIÓN
  // ════════════════════════════════════════════════════════════════

  async abrirSesion(usuarioId: number, input: AbrirSesionInput) {
    if (input.montoApertura < 0) {
      throw new ValidationError('El monto de apertura no puede ser negativo');
    }

    const pool = await getPool();
    const transaction = (pool as any).transaction();
    await transaction.begin();
    try {
      // 1) Verificar que la caja existe y está activa
      const cajaResult = await transaction.request()
        .input('cid', sql.Int, input.cajaId)
        .query(`SELECT c.*, pv.PUNTO_VENTA_ID AS PV FROM CAJA c INNER JOIN PUNTO_VENTAS pv ON pv.PUNTO_VENTA_ID = c.PUNTO_VENTA_ID WHERE c.CAJA_ID = @cid AND c.ACTIVA = 1`);
      if (cajaResult.recordset.length === 0) {
        throw new ValidationError('Caja no encontrada o inactiva');
      }
      const caja = cajaResult.recordset[0];

      // 2) Verificar que el usuario está asignado a la caja
      const asignResult = await transaction.request()
        .input('cid', sql.Int, input.cajaId)
        .input('uid', sql.Int, usuarioId)
        .query(`SELECT 1 FROM CAJA_USUARIOS WHERE CAJA_ID = @cid AND USUARIO_ID = @uid`);
      if (asignResult.recordset.length === 0) {
        throw new ValidationError('El usuario no está asignado a esta caja');
      }

      // 3) Verificar que la caja no tiene sesión activa
      const sesionActiva = await transaction.request()
        .input('cid', sql.Int, input.cajaId)
        .query(`SELECT TOP 1 SESION_ID, USUARIO_ID FROM CAJA_SESIONES WHERE CAJA_ID = @cid AND ESTADO = 'ACTIVA'`);
      if (sesionActiva.recordset.length > 0) {
        const otroUsuario = sesionActiva.recordset[0].USUARIO_ID;
        if (otroUsuario !== usuarioId) {
          throw new ValidationError('La caja ya está abierta por otro usuario. Debe cerrarla antes de abrir otra sesión.');
        }
        throw new ValidationError('Ya tiene una sesión activa en esta caja');
      }

      // 4) Verificar que el usuario no tiene otra sesión activa
      const miSesion = await transaction.request()
        .input('uid', sql.Int, usuarioId)
        .query(`SELECT TOP 1 cs.SESION_ID, c.NOMBRE FROM CAJA_SESIONES cs INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID WHERE cs.USUARIO_ID = @uid AND cs.ESTADO = 'ACTIVA'`);
      if (miSesion.recordset.length > 0) {
        throw new ValidationError(`Ya tiene una sesión activa en otra caja (${miSesion.recordset[0].NOMBRE || 'Caja #' + miSesion.recordset[0].SESION_ID})`);
      }

      // 5) Calcular aporte según fuente.
      //    Si la caja tiene saldo retenido, DEBE incluirse en la apertura
      //    (el dinero está físicamente en la caja). No se permite ignorarlo.
      //    'NINGUNO' permite abrir la caja con $0 cuando no hay retenido,
      //    para que el efectivo se cargue después como Ingreso de caja.
      const saldoRetenidoCaja = Number(caja.SALDO_RETENIDO) || 0;
      let retenidoUsado = 0;
      let aporteCC = 0;

      if (input.fuente === 'NINGUNO') {
        if (input.montoApertura !== 0) {
          throw new ValidationError('Para abrir sin aporte inicial, el monto de apertura debe ser $0.');
        }
        if (saldoRetenidoCaja > 0) {
          throw new ValidationError(
            `La caja tiene $${saldoRetenidoCaja.toFixed(2)} retenido que debe incluirse en la apertura. Use "Usar saldo retenido" o "Mixto".`
          );
        }
        retenidoUsado = 0;
        aporteCC = 0;
      } else if (saldoRetenidoCaja > 0) {
        if (input.fuente === 'APORTE_CC') {
          throw new ValidationError(
            `La caja tiene $${saldoRetenidoCaja.toFixed(2)} retenido que debe incluirse en la apertura. Use "Usar saldo retenido" o "Mixto".`
          );
        }
        if (input.montoApertura < saldoRetenidoCaja) {
          throw new ValidationError(
            `La caja tiene $${saldoRetenidoCaja.toFixed(2)} retenido. El monto de apertura mínimo es $${saldoRetenidoCaja.toFixed(2)}.`
          );
        }
        retenidoUsado = saldoRetenidoCaja;
        aporteCC = input.montoApertura - retenidoUsado;
      } else if (input.montoApertura === 0) {
        retenidoUsado = 0;
        aporteCC = 0;
      } else if (input.fuente === 'USAR_RETENIDO') {
        retenidoUsado = Math.min(saldoRetenidoCaja, input.montoApertura);
        aporteCC = input.montoApertura - retenidoUsado;
      } else if (input.fuente === 'APORTE_CC') {
        retenidoUsado = 0;
        aporteCC = input.montoApertura;
      } else { // MIXTO
        retenidoUsado = Math.min(saldoRetenidoCaja, input.montoApertura);
        aporteCC = input.montoApertura - retenidoUsado;
      }

      // 6) Validar CC si hay aporte
      if (aporteCC > 0) {
        const ccEfectivo = await this._getEfectivoCajaCentralTx(transaction, caja.PV);
        if (ccEfectivo < aporteCC) {
          throw new ValidationError(`Efectivo insuficiente en Caja Central. Disponible: $${ccEfectivo.toFixed(2)}`);
        }
      }

      // 7) Calcular NRO_SESION
      const nroResult = await transaction.request()
        .input('cid', sql.Int, input.cajaId)
        .query(`SELECT ISNULL(MAX(NRO_SESION), 0) + 1 AS next FROM CAJA_SESIONES WHERE CAJA_ID = @cid`);
      const nroSesion = nroResult.recordset[0].next;

      // 8) Insertar CAJA_SESIONES
      const insertResult = await transaction.request()
        .input('cid', sql.Int, input.cajaId)
        .input('uid', sql.Int, usuarioId)
        .input('nro', sql.Int, nroSesion)
        .input('monto', sql.Decimal(18, 2), input.montoApertura)
        .input('aporte', sql.Decimal(18, 2), aporteCC)
        .input('retenido', sql.Decimal(18, 2), retenidoUsado)
        .input('obs', sql.NVarChar(500), input.obs || null)
        .query(`
          INSERT INTO CAJA_SESIONES (CAJA_ID, USUARIO_ID, NRO_SESION, FECHA_APERTURA, MONTO_APERTURA, APORTE_CC, RETENIDO_USADO, ESTADO, OBS_APERTURA)
          OUTPUT INSERTED.SESION_ID
          VALUES (@cid, @uid, @nro, GETDATE(), @monto, @aporte, @retenido, 'ACTIVA', @obs)
        `);
      const sesionId = insertResult.recordset[0].SESION_ID;

      // 9) Actualizar SALDO_RETENIDO de la caja
      await transaction.request()
        .input('cid', sql.Int, input.cajaId)
        .input('delta', sql.Decimal(18, 2), -retenidoUsado)
        .query(`UPDATE CAJA SET SALDO_RETENIDO = SALDO_RETENIDO + @delta WHERE CAJA_ID = @cid`);

      // 10) Si hay aporte de CC, registrar movimiento
      if (aporteCC > 0) {
        await transaction.request()
          .input('cid', sql.Int, input.cajaId)
          .input('sid', sql.Int, sesionId)
          .input('tipo', sql.VarChar(20), 'APERTURA_CAJA')
          .input('uid', sql.Int, usuarioId)
          .input('efectivo', sql.Decimal(18, 2), -aporteCC)
          .input('pvId', sql.Int, caja.PV)
          .query(`
            INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, CAJA_ID, TIPO_ENTIDAD, FECHA, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
            VALUES (@sid, @cid, @tipo, GETDATE(), N'Aporte de Caja Central para apertura de sesión #${nroSesion}', @uid, @efectivo, 0, 0, 0, @efectivo, @pvId, 0)
          `);
      }

      // 11) Insertar CAJA_ITEMS con el monto de apertura
      if (input.montoApertura > 0) {
        const descItem = aporteCC > 0 && retenidoUsado > 0
          ? `Apertura sesión #${nroSesion} (Retenido: $${retenidoUsado.toFixed(2)} + Aporte CC: $${aporteCC.toFixed(2)})`
          : aporteCC > 0
            ? `Apertura sesión #${nroSesion} (Aporte CC: $${aporteCC.toFixed(2)})`
            : `Apertura sesión #${nroSesion} (Retenido: $${retenidoUsado.toFixed(2)})`;

        await transaction.request()
          .input('sid', sql.Int, sesionId)
          .input('cid', sql.Int, input.cajaId)
          .input('efectivo', sql.Decimal(18, 2), input.montoApertura)
          .input('desc', sql.NVarChar(500), descItem)
          .input('uid', sql.Int, usuarioId)
          .query(`
            INSERT INTO CAJA_ITEMS (SESION_ID, CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
            VALUES (@sid, @cid, GETDATE(), 'APERTURA', @efectivo, 0, @desc, @uid)
          `);
      }

      await transaction.commit();
      return { SESION_ID: sesionId, CAJA_ID: input.cajaId, NRO_SESION: nroSesion, APORTE_CC: aporteCC, RETENIDO_USADO: retenidoUsado };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  async cerrarSesion(usuarioId: number, sesionId: number, input: CerrarSesionInput) {
    if (input.saldoRetenido < 0) {
      throw new ValidationError('El saldo retenido no puede ser negativo');
    }
    if (input.depositoMonto !== undefined && input.depositoMonto < 0) {
      throw new ValidationError('El monto de depósito no puede ser negativo');
    }

    const pool = await getPool();
    const transaction = (pool as any).transaction();
    await transaction.begin();
    try {
      // 1) Obtener sesión y caja
      const sesionResult = await transaction.request()
        .input('sid', sql.Int, sesionId)
        .query(`
          SELECT cs.SESION_ID, cs.CAJA_ID, cs.USUARIO_ID, cs.NRO_SESION,
            cs.FECHA_APERTURA, cs.FECHA_CIERRE, cs.MONTO_APERTURA,
            cs.APORTE_CC, cs.RETENIDO_USADO, cs.MONTO_CIERRE,
            cs.SALDO_RETENIDO_FIN, cs.ESTADO, cs.OBS_APERTURA, cs.OBS_CIERRE,
            c.PUNTO_VENTA_ID
          FROM CAJA_SESIONES cs
          INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
          WHERE cs.SESION_ID = @sid
        `);
      if (sesionResult.recordset.length === 0) {
        throw new ValidationError('Sesión no encontrada');
      }
      const sesion = sesionResult.recordset[0];
      if (sesion.ESTADO !== 'ACTIVA') {
        throw new ValidationError('La sesión no está activa');
      }
      if (sesion.USUARIO_ID !== usuarioId) {
        throw new ValidationError('Solo el usuario que abrió la sesión puede cerrarla');
      }

      // 2) Calcular efectivo y digital en caja.
      //    `efectivoEnCaja` se computa como la suma neta de MONTO_EFECTIVO de
      //    todos los items, excluyendo los movimientos de egreso manual y
      //    depósito de cierre. Esto YA incluye el item de APERTURA, por lo
      //    que NO se debe volver a sumar `sesion.MONTO_APERTURA`.
      //    `digitalEnCaja` es la suma de MONTO_DIGITAL de las ventas de la
      //    sesión (no incluye egresos manuales). El digital se registra en
      //    el mismo MOVIMIENTOS_CAJA del cierre para que impacte en el
      //    balance y desglose de Caja Central (modelo heredado de CIERRE_CAJA).
      const itemsResult = await transaction.request()
        .input('sid', sql.Int, sesionId)
        .query(`
          SELECT
            ISNULL(SUM(CASE WHEN ORIGEN_TIPO NOT IN ('EGRESO', 'DEPOSITO_CIERRE') THEN MONTO_EFECTIVO ELSE 0 END), 0) AS efectivoBruto,
            ISNULL(SUM(CASE WHEN ORIGEN_TIPO IN ('EGRESO', 'DEPOSITO_CIERRE') THEN ABS(MONTO_EFECTIVO) ELSE 0 END), 0) AS egresos,
            ISNULL(SUM(CASE WHEN ORIGEN_TIPO = 'VENTA' THEN MONTO_DIGITAL ELSE 0 END), 0) AS digitalVentas,
            ISNULL(SUM(CASE WHEN ORIGEN_TIPO = 'VENTA' THEN MONTO_EFECTIVO ELSE 0 END), 0) AS ventaEfectivo,
            ISNULL(SUM(CASE WHEN ORIGEN_TIPO = 'INGRESO' THEN MONTO_EFECTIVO ELSE 0 END), 0) AS ingresoEfectivo,
            ISNULL(SUM(CASE WHEN ORIGEN_TIPO = 'TRANSFERENCIA_CC' AND MONTO_EFECTIVO > 0 THEN MONTO_EFECTIVO ELSE 0 END), 0) AS transferenciaIn
          FROM CAJA_ITEMS
          WHERE SESION_ID = @sid
        `);
      const efectivoBruto = Number(itemsResult.recordset[0].efectivoBruto) || 0;
      const egresos = Number(itemsResult.recordset[0].egresos) || 0;
      const digitalEnCaja = Number(itemsResult.recordset[0].digitalVentas) || 0;
      const ventaEfectivo = Number(itemsResult.recordset[0].ventaEfectivo) || 0;
      const ingresoEfectivo = Number(itemsResult.recordset[0].ingresoEfectivo) || 0;
      const transferenciaIn = Number(itemsResult.recordset[0].transferenciaIn) || 0;
      const efectivoEnCaja = efectivoBruto - egresos;
      // "Dinero nuevo" que entró a la caja durante la sesión: ventas + ingresos.
      // Las transferencias CC→Caja NO se cuentan acá porque son movimientos
      // de CC (registrados en TRANSFERENCIA_CC, que se excluye del balance de CC).
      const totalNuevoEfectivo = ventaEfectivo + ingresoEfectivo;
      const egresoDeNuevo = Math.min(egresos, totalNuevoEfectivo);
      const egresoDeApertura = Math.max(0, egresos - egresoDeNuevo);

      // Inversión total de CC en esta sesión: apertura + transferencias CC→Caja.
      // DEPOSITO_CIERRE acumula todo el impacto neto (las TRANSFERENCIA_CC
      // y APERTURA_CAJA no impactan el balance porque están en INTERNAL_TYPES).
      const aperturaFromCC = Number(sesion.APORTE_CC) || 0;
      const aperturaFromRetenido = Number(sesion.RETENIDO_USADO) || 0;
      const inversionCC = aperturaFromCC + aperturaFromRetenido + transferenciaIn;

      // 3) Calcular depósito y retenido
      let deposito = 0;
      if (input.deposito === 'TOTAL') {
        deposito = Math.max(efectivoEnCaja, 0);
      } else if (input.deposito === 'PARCIAL') {
        deposito = Math.min(input.depositoMonto || 0, efectivoEnCaja);
      }
      const retenido = input.saldoRetenido;

      // 4) Validar ecuación: deposito + retenido == efectivoEnCaja
      // Nota: por redondeo, permitir tolerancia de 0.01
      const diferencia = Math.abs((deposito + retenido) - efectivoEnCaja);
      if (diferencia > 0.01) {
        throw new ValidationError(
          `La ecuación no cuadra. Efectivo en caja: $${efectivoEnCaja.toFixed(2)}, Retenido: $${retenido.toFixed(2)}, Depósito: $${deposito.toFixed(2)}. Debe sumar $${efectivoEnCaja.toFixed(2)}`
        );
      }

      // 5) Cerrar sesión
      await transaction.request()
        .input('sid', sql.Int, sesionId)
        .input('deposito', sql.Decimal(18, 2), deposito)
        .input('retenido', sql.Decimal(18, 2), retenido)
        .input('obs', sql.NVarChar(500), input.obs || null)
        .query(`
          UPDATE CAJA_SESIONES
          SET FECHA_CIERRE = GETDATE(),
              MONTO_CIERRE = @deposito,
              SALDO_RETENIDO_FIN = @retenido,
              ESTADO = 'CERRADA',
              OBS_CIERRE = @obs
          WHERE SESION_ID = @sid
        `);

      // 6) Actualizar SALDO_RETENIDO de la caja
      await transaction.request()
        .input('cid', sql.Int, sesion.CAJA_ID)
        .input('retenido', sql.Decimal(18, 2), retenido)
        .query(`UPDATE CAJA SET SALDO_RETENIDO = @retenido WHERE CAJA_ID = @cid`);

      // 7) Registrar movimiento en MOVIMIENTOS_CAJA con el IMPACTO NETO de la
      //    sesión sobre el balance de Caja Central. La caja se considera una
      //    sub-cuenta de CC: aunque el efectivo quede físicamente retenido en
      //    la caja, los ingresos y egresos reales de la sesión deben imputarse
      //    para que el balance y el desglose por método reflejen la realidad.
      //
      //    Como TRANSFERENCIA_CC y APERTURA_CAJA están excluidas del balance
      //    de CC (INTERNAL_TYPES_SQL), el DEPOSITO_CIERRE acumula TODO el
      //    impacto neto de la sesión sobre CC:
      //
      //      inversionCC = APORTE_CC + RETENIDO_USADO + transferenciasIn
      //                    (todo el efectivo que vino de CC a la caja)
      //      loQueVuelve = deposito + retenido + digitalVentas
      //                    (todo lo que vuelve / queda en CC desde la caja)
      //      movEfectivo = deposito + retenido − inversionCC
      //      movDigital  = digitalVentas
      //      movTotal    = movEfectivo + movDigital
      //
      //    Casos:
      //      - Caja abre con $0, transfiere $12500 de CC, vende $2500 dig,
      //        gasta $15000 → inversionCC=12500, devoluciones=0+0+2500=2500
      //        movEfectivo = -12500, movDigital = +2500, movTotal = -10000
      //      - Caja abre con $12500 de CC, vende $2500 dig, gasta $15000
      //        → inversionCC=12500, devoluciones=0+0+2500=2500
      //        movEfectivo = -12500, movDigital = +2500, movTotal = -10000
      //      - Caja abre con $12500, vende $2500 ef + $2500 dig, gasta $0,
      //        deposita $5000, retiene $0
      //        → movEfectivo = 5000 − 12500 = -7500, movDigital = +2500,
      //          movTotal = -5000 (CC perdió 7500 + recuperó 2500 digital)
      const newEfectivo = Math.max(0, efectivoEnCaja - aperturaFromRetenido - aperturaFromCC);
      const depositoEfectivoNuevo = Math.max(0, Math.min(deposito, newEfectivo));
      const devolucionInterna = Math.max(0, deposito - depositoEfectivoNuevo);

      // Solo emitir movimiento si hay algo que reportar
      const hayQueReportar = ventaEfectivo > 0 || digitalEnCaja > 0 || egresoDeApertura > 0;
      if (hayQueReportar) {
        const movEfectivo = deposito + retenido - inversionCC;
        const movDigital = digitalEnCaja;
        const movTotal = movEfectivo + movDigital;

        // Contar movimientos (items) de la sesión para la descripción corta
        const cantMovResult = await transaction.request()
          .input('sid', sql.Int, sesionId)
          .query(`SELECT COUNT(*) AS cant FROM CAJA_ITEMS WHERE SESION_ID = @sid`);
        const cantMovimientos = Number(cantMovResult.recordset[0]?.cant) || 0;
        const descMov = `Cierre de sesión de caja - ${cantMovimientos} movimiento${cantMovimientos === 1 ? '' : 's'}`;

        await transaction.request()
          .input('sid', sql.Int, sesionId)
          .input('cid', sql.Int, sesion.CAJA_ID)
          .input('uid', sql.Int, usuarioId)
          .input('efectivo', sql.Decimal(18, 2), movEfectivo)
          .input('digital', sql.Decimal(18, 2), movDigital)
          .input('total', sql.Decimal(18, 2), movTotal)
          .input('desc', sql.NVarChar(500), descMov)
          .input('pvId', sql.Int, sesion.PUNTO_VENTA_ID)
          .query(`
            INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, CAJA_ID, TIPO_ENTIDAD, FECHA, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
            VALUES (@sid, @cid, 'DEPOSITO_CIERRE', GETDATE(), @desc,
              @uid, @efectivo, @digital, 0, 0, @total, @pvId, 0)
          `);
      }

      // 8) Registrar como TRANSFERENCIA_CC (excluida del balance) la parte
      //    del depósito físico que es devolución de dinero que ya estaba
      //    contabilizado en CC o en la caja (RETENIDO_USADO + APORTE_CC).
      //    Esto preserva la trazabilidad del flujo sin impactar el balance.
      //    El egresoDeApertura ya está incorporado en el TOTAL del cierre
      //    (paso 7), por lo que NO se genera un EGRESO_CAJA separado.
      if (devolucionInterna > 0) {
        const obsTransfer = `Retorno a Caja Central por cierre de sesión #${sesionId}`;
        await transaction.request()
          .input('sid', sql.Int, sesionId)
          .input('cid', sql.Int, sesion.CAJA_ID)
          .input('uid', sql.Int, usuarioId)
          .input('efectivo', sql.Decimal(18, 2), devolucionInterna)
          .input('pvId', sql.Int, sesion.PUNTO_VENTA_ID)
          .input('obs', sql.NVarChar(500), obsTransfer)
          .query(`
            INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, CAJA_ID, TIPO_ENTIDAD, FECHA, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
            VALUES (@sid, @cid, 'TRANSFERENCIA_CC', GETDATE(), @obs,
              @uid, @efectivo, 0, 0, 0, @efectivo, @pvId, 0)
          `);
      }

      await transaction.commit();
      return {
        SESION_ID: sesionId,
        MONTO_CIERRE: deposito,
        SALDO_RETENIDO_FIN: retenido,
        EFECTIVO_EN_CAJA: efectivoEnCaja,
      };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  // ════════════════════════════════════════════════════════════════
  //  TRANSFERENCIA CC ↔ CAJA DIRECTA
  // ════════════════════════════════════════════════════════════════

  async transferir(usuarioId: number, input: TransferirInput, permisos: string[] | null = null) {
    if (input.monto <= 0) throw new ValidationError('El monto debe ser mayor a cero');
    if (input.origen === input.destino) throw new ValidationError('Origen y destino no pueden ser iguales');
    if ((input.origen === 'CAJA' || input.destino === 'CAJA') && !input.cajaId) {
      throw new ValidationError('Debe especificar la caja');
    }

    const pool = await getPool();
    const transaction = (pool as any).transaction();
    await transaction.begin();
    try {
      let pvId: number | null = null;
      let sesionId: number | null = null;
      let saldoRetenido: number = 0;

      if (input.cajaId) {
        const cajaResult = await transaction.request()
          .input('cid', sql.Int, input.cajaId)
          .query(`
            SELECT c.CAJA_ID, c.PUNTO_VENTA_ID, ISNULL(c.SALDO_RETENIDO, 0) AS SALDO_RETENIDO,
              (SELECT TOP 1 SESION_ID FROM CAJA_SESIONES WHERE CAJA_ID = c.CAJA_ID AND ESTADO = 'ACTIVA') AS SESION_ACTIVA
            FROM CAJA c WHERE c.CAJA_ID = @cid AND c.ACTIVA = 1
          `);
        if (cajaResult.recordset.length === 0) {
          throw new ValidationError('Caja no encontrada o inactiva');
        }
        const caja = cajaResult.recordset[0];
        pvId = caja.PUNTO_VENTA_ID;
        sesionId = caja.SESION_ACTIVA;
        saldoRetenido = Number(caja.SALDO_RETENIDO) || 0;
      }

      // Si la caja NO tiene sesión activa se está retirando retenido sin
      // cajero presente. Se exige permiso `caja.administrar` explícitamente.
      if (!sesionId && permisos !== null && !permisos.includes('caja.administrar')) {
        throw new ValidationError('Sin sesión activa se requiere permiso caja.administrar para retirar el saldo retenido');
      }

      // Restricciones por modo:
      //   - Sin sesión activa: sólo se permite retirar el SALDO_RETENIDO de la
      //     caja hacia Caja Central (CAJA → CAJA_CENTRAL).
      //   - Con sesión activa: cualquier dirección CC ↔ CAJA.
      if (!sesionId) {
        if (input.origen !== 'CAJA' || input.destino !== 'CAJA_CENTRAL') {
          throw new ValidationError('Sin sesión activa sólo se permite transferir el retenido de la caja a Caja Central');
        }
        if (saldoRetenido <= 0) {
          throw new ValidationError('La caja no tiene saldo retenido para transferir');
        }
      }

      // Validar saldos
      if (input.origen === 'CAJA_CENTRAL') {
        const ccEfectivo = await this._getEfectivoCajaCentralTx(transaction, pvId || undefined);
        if (ccEfectivo < input.monto) {
          throw new ValidationError(`Efectivo insuficiente en Caja Central. Disponible: $${ccEfectivo.toFixed(2)}`);
        }
      } else if (input.origen === 'CAJA' && sesionId) {
        const cajaEfectivo = await this._getEfectivoSesionTx(transaction, sesionId);
        if (cajaEfectivo < input.monto) {
          throw new ValidationError(`Efectivo insuficiente en la caja. Disponible: $${cajaEfectivo.toFixed(2)}`);
        }
      } else if (input.origen === 'CAJA' && !sesionId) {
        if (input.monto > saldoRetenido) {
          throw new ValidationError(`Saldo retenido insuficiente. Disponible: $${saldoRetenido.toFixed(2)}`);
        }
      }

      const obs = input.observaciones || `Transferencia CC ↔ Caja #${input.cajaId || ''}`;

      if (input.origen === 'CAJA_CENTRAL' && input.destino === 'CAJA' && sesionId) {
        // CC → CAJA con sesión activa: NO se registra un MOVIMIENTO_CAJA
        // TRANSFERENCIA_CC en este momento. El impacto en CC se acumula
        // en el DEPOSITO_CIERRE al cerrar la sesión, donde se imputa
        // correctamente el débito de CC (ver cerrarSesion → paso 7).
        // Aquí solo dejamos constancia del ingreso a la caja en CAJA_ITEMS,
        // que es el input necesario para calcular el cierre.
        await transaction.request()
          .input('sid', sql.Int, sesionId)
          .input('cid', sql.Int, input.cajaId)
          .input('efectivo', sql.Decimal(18, 2), input.monto)
          .input('uid', sql.Int, usuarioId)
          .input('desc', sql.NVarChar(500), 'Transferencia desde Caja Central')
          .query(`
            INSERT INTO CAJA_ITEMS (SESION_ID, CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
            VALUES (@sid, @cid, GETDATE(), 'TRANSFERENCIA_CC', @efectivo, 0, @desc, @uid)
          `);
      } else if (input.origen === 'CAJA' && input.destino === 'CAJA_CENTRAL' && sesionId) {
        // CAJA → CC con sesión activa: egreso de caja, ingreso CC
        await transaction.request()
          .input('sid', sql.Int, sesionId)
          .input('cid', sql.Int, input.cajaId)
          .input('efectivo', sql.Decimal(18, 2), -input.monto)
          .input('uid', sql.Int, usuarioId)
          .input('desc', sql.NVarChar(500), 'Transferencia a Caja Central')
          .query(`
            INSERT INTO CAJA_ITEMS (SESION_ID, CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
            VALUES (@sid, @cid, GETDATE(), 'TRANSFERENCIA_CC', @efectivo, 0, @desc, @uid)
          `);

        await transaction.request()
          .input('sid', sql.Int, sesionId)
          .input('cid', sql.Int, input.cajaId)
          .input('uid', sql.Int, usuarioId)
          .input('efectivo', sql.Decimal(18, 2), input.monto)
          .input('pvId', sql.Int, pvId)
          .input('obs', sql.NVarChar(500), obs)
          .query(`
            INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, CAJA_ID, TIPO_ENTIDAD, FECHA, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
            VALUES (@sid, @cid, 'TRANSFERENCIA_CC', GETDATE(), @obs, @uid, @efectivo, 0, 0, 0, @efectivo, @pvId, 0)
          `);
      } else if (input.origen === 'CAJA' && input.destino === 'CAJA_CENTRAL' && !sesionId) {
        // CAJA → CC sin sesión activa: descuento de SALDO_RETENIDO + ingreso CC
        const descItem = `Retiro de retenido a Caja Central${input.observaciones ? ` — ${input.observaciones}` : ''}`;

        await transaction.request()
          .input('cid', sql.Int, input.cajaId)
          .input('delta', sql.Decimal(18, 2), -input.monto)
          .query(`
            UPDATE CAJA SET SALDO_RETENIDO = ISNULL(SALDO_RETENIDO, 0) + @delta
            WHERE CAJA_ID = @cid
          `);

        await transaction.request()
          .input('cid', sql.Int, input.cajaId)
          .input('uid', sql.Int, usuarioId)
          .input('efectivo', sql.Decimal(18, 2), input.monto)
          .input('pvId', sql.Int, pvId)
          .input('obs', sql.NVarChar(500), descItem)
          .query(`
            INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, CAJA_ID, TIPO_ENTIDAD, FECHA, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
            VALUES (NULL, @cid, 'TRANSFERENCIA_CC', GETDATE(), @obs, @uid, @efectivo, 0, 0, 0, @efectivo, @pvId, 0)
          `);
      }

      await transaction.commit();
      return { success: true };
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  },

  // ════════════════════════════════════════════════════════════════
  //  INGRESO / EGRESO MANUAL EN SESIÓN ACTIVA
  // ════════════════════════════════════════════════════════════════

  async addIngresoEgreso(sesionId: number, input: IngresoEgresoInput, usuarioId: number) {
    const pool = await getPool();

    // Validar sesión activa
    const sesionResult = await pool.request()
      .input('id', sql.Int, sesionId)
      .query(`
        SELECT cs.SESION_ID, cs.CAJA_ID
        FROM CAJA_SESIONES cs
        WHERE cs.SESION_ID = @id AND cs.ESTADO = 'ACTIVA'
      `);
    if (sesionResult.recordset.length === 0) {
      throw new ValidationError('Sesión no encontrada o no está activa');
    }
    const sesion = sesionResult.recordset[0];

    const monto = input.tipo === 'EGRESO' ? -Math.abs(input.monto) : Math.abs(input.monto);

    const result = await pool.request()
      .input('sid', sql.Int, sesionId)
      .input('cid', sql.Int, sesion.CAJA_ID)
      .input('origenTipo', sql.VarChar(30), input.tipo)
      .input('efectivo', sql.Decimal(18, 2), monto)
      .input('desc', sql.NVarChar(500), input.descripcion)
      .input('uid', sql.Int, usuarioId)
      .query(`
        INSERT INTO CAJA_ITEMS (SESION_ID, CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
        OUTPUT INSERTED.ITEM_ID
        VALUES (@sid, @cid, GETDATE(), @origenTipo, @efectivo, 0, @desc, @uid)
      `);

    return { ITEM_ID: result.recordset[0].ITEM_ID, SESION_ID: sesionId, CAJA_ID: sesion.CAJA_ID };
  },

  async deleteItem(sesionId: number, itemId: number) {
    const pool = await getPool();

    const itemResult = await pool.request()
      .input('itemId', sql.Int, itemId)
      .input('sid', sql.Int, sesionId)
      .query(`
        SELECT * FROM CAJA_ITEMS
        WHERE ITEM_ID = @itemId AND SESION_ID = @sid
          AND ORIGEN_TIPO IN ('INGRESO', 'EGRESO')
      `);

    if (itemResult.recordset.length === 0) {
      throw new ValidationError('Ítem no encontrado o no es un ingreso/egreso manual');
    }

    // Verificar que la sesión está activa
    const sesionResult = await pool.request()
      .input('sid', sql.Int, sesionId)
      .query(`SELECT ESTADO FROM CAJA_SESIONES WHERE SESION_ID = @sid`);

    if (sesionResult.recordset.length === 0 || sesionResult.recordset[0].ESTADO !== 'ACTIVA') {
      throw new ValidationError('Solo se pueden eliminar ítems de sesiones activas');
    }

    await pool.request()
      .input('itemId', sql.Int, itemId)
      .query(`DELETE FROM CAJA_ITEMS WHERE ITEM_ID = @itemId`);

    // Limpieza legacy
    await pool.request()
      .input('itemId', sql.Int, itemId)
      .input('tipo', sql.VarChar(20), itemResult.recordset[0].ORIGEN_TIPO)
      .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @itemId AND TIPO_ENTIDAD = @tipo`);

    return { success: true };
  },

  // ════════════════════════════════════════════════════════════════
  //  LISTADOS PARA TRANSFERENCIAS
  // ════════════════════════════════════════════════════════════════

  async getSesionesActivas(puntoVentaId?: number) {
    const pool = await getPool();
    const req = pool.request();
    let pvFilter = '';
    if (puntoVentaId) {
      pvFilter = ' AND c.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, puntoVentaId);
    }

    const result = await req.query(`
      SELECT cs.SESION_ID, cs.CAJA_ID, cs.USUARIO_ID, cs.FECHA_APERTURA, cs.MONTO_APERTURA,
        c.PUNTO_VENTA_ID, c.NOMBRE AS CAJA_NOMBRE,
        u.NOMBRE AS USUARIO_NOMBRE,
        pv.NOMBRE AS PUNTO_VENTA_NOMBRE,
        ISNULL((SELECT SUM(ci.MONTO_EFECTIVO) FROM CAJA_ITEMS ci WHERE ci.SESION_ID = cs.SESION_ID), 0) AS EFECTIVO_DISPONIBLE,
        ISNULL((SELECT SUM(ci.MONTO_DIGITAL) FROM CAJA_ITEMS ci WHERE ci.SESION_ID = cs.SESION_ID AND ci.ORIGEN_TIPO = 'VENTA'), 0) AS DIGITAL_DISPONIBLE,
        ISNULL((SELECT SUM(ci.MONTO_EFECTIVO) FROM CAJA_ITEMS ci WHERE ci.SESION_ID = cs.SESION_ID AND ci.ORIGEN_TIPO = 'VENTA'), 0) AS VENTA_EFECTIVO
      FROM CAJA_SESIONES cs
      INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
      LEFT JOIN USUARIOS u ON cs.USUARIO_ID = u.USUARIO_ID
      LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
      WHERE cs.ESTADO = 'ACTIVA' AND c.ACTIVA = 1 ${pvFilter}
      ORDER BY c.PUNTO_VENTA_ID, c.CAJA_ID
    `);

    return result.recordset;
  },

  async getEfectivoSesion(sesionId: number): Promise<number> {
    const pool = await getPool();
    const result = await pool.request()
      .input('sid', sql.Int, sesionId)
      .query(`
        SELECT ISNULL(SUM(MONTO_EFECTIVO), 0) AS EFECTIVO
        FROM CAJA_ITEMS
        WHERE SESION_ID = @sid
      `);
    return result.recordset[0]?.EFECTIVO || 0;
  },

  // ════════════════════════════════════════════════════════════════
  //  CAJA CENTRAL — EFECTIVO DISPONIBLE
  //  (Excluye movimientos internos: transferencias CC↔Caja, apertura/cierre)
  // ════════════════════════════════════════════════════════════════

  async getEfectivoCajaCentral(puntoVentaId?: number): Promise<number> {
    const pool = await getPool();
    return this._getEfectivoCajaCentralTx(pool, puntoVentaId);
  },

  async _getEfectivoCajaCentralTx(ctx: any, puntoVentaId?: number): Promise<number> {
    const req = ctx.request();
    let pvFilter = '';
    if (puntoVentaId) {
      pvFilter = ' AND PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, puntoVentaId);
    }
    const result = await req.query(`
      SELECT ISNULL(SUM(EFECTIVO), 0) AS efectivo
      FROM MOVIMIENTOS_CAJA
      WHERE TIPO_ENTIDAD NOT IN ${INTERNAL_TYPES_SQL} ${pvFilter}
    `);
    return result.recordset[0]?.efectivo ?? 0;
  },

  async _getEfectivoSesionTx(ctx: any, sesionId: number): Promise<number> {
    const result = await ctx.request()
      .input('sid', sql.Int, sesionId)
      .query(`SELECT ISNULL(SUM(MONTO_EFECTIVO), 0) AS efectivo FROM CAJA_ITEMS WHERE SESION_ID = @sid`);
    return result.recordset[0]?.efectivo ?? 0;
  },

  // ════════════════════════════════════════════════════════════════
  //  CAJAS DISPONIBLES PARA TRANSFERENCIA
  //  Devuelve TODAS las cajas activas (con o sin sesión), su SALDO_RETENIDO
  //  y, si tienen sesión activa, el efectivo disponible en la misma.
  //  Usado por el modal de transferencia para permitir retirar el
  //  retenido de una caja sin sesión activa.
  // ════════════════════════════════════════════════════════════════

  async getCajasConSaldo(puntoVentaId?: number) {
    const pool = await getPool();
    const req = pool.request();
    let pvFilter = '';
    if (puntoVentaId) {
      pvFilter = ' AND c.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, puntoVentaId);
    }
    const result = await req.query(`
      SELECT
        c.CAJA_ID,
        c.NOMBRE AS CAJA_NOMBRE,
        c.PUNTO_VENTA_ID,
        pv.NOMBRE AS PUNTO_VENTA_NOMBRE,
        c.ACTIVA,
        ISNULL(c.SALDO_RETENIDO, 0) AS SALDO_RETENIDO,
        cs.SESION_ID,
        cs.USUARIO_ID,
        u.NOMBRE AS USUARIO_NOMBRE,
        ISNULL((SELECT SUM(ci.MONTO_EFECTIVO) FROM CAJA_ITEMS ci WHERE ci.SESION_ID = cs.SESION_ID), 0) AS EFECTIVO_SESION
      FROM CAJA c
      LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
      LEFT JOIN CAJA_SESIONES cs ON cs.SESION_ID = (
        SELECT TOP 1 s.SESION_ID FROM CAJA_SESIONES s WHERE s.CAJA_ID = c.CAJA_ID AND s.ESTADO = 'ACTIVA' ORDER BY s.SESION_ID DESC
      )
      LEFT JOIN USUARIOS u ON cs.USUARIO_ID = u.USUARIO_ID
      WHERE c.ACTIVA = 1 ${pvFilter}
      ORDER BY pv.NOMBRE, c.NOMBRE, c.CAJA_ID
    `);
    return result.recordset;
  },

  // ════════════════════════════════════════════════════════════════
  //  DESGLOSE DE MÉTODOS DE PAGO
  // ════════════════════════════════════════════════════════════════

  async getDesgloseItem(origenTipo: string, origenId: number, categoria?: 'EFECTIVO' | 'DIGITAL') {
    const pool = await getPool();
    let tableName: string | null = null;
    let fkColumn = 'PAGO_ID';

    switch (origenTipo) {
      case 'COBRANZA':
        tableName = 'COBRANZAS_METODOS_PAGO';
        break;
      case 'ORDEN_PAGO':
        tableName = 'ORDENES_PAGO_METODOS_PAGO';
        break;
      case 'VENTA':
        tableName = 'VENTAS_METODOS_PAGO';
        fkColumn = 'VENTA_ID';
        break;
      case 'NC_COMPRA':
      case 'NC_VENTA':
      case 'ND_COMPRA':
      case 'ND_VENTA':
      case 'COMPRA':
        // Estos también pueden tener métodos de pago asociados en sus tablas respectivas
        // Por ahora devolvemos vacío si la tabla no existe
        return [];
      default:
        return [];
    }

    try {
      const req = pool.request()
        .input('origenId', sql.Int, origenId);
      let catFilter = '';
      if (categoria) {
        req.input('cat', sql.NVarChar(20), categoria);
        catFilter = ' AND mp.CATEGORIA = @cat';
      }
      const result = await req.query(`
        SELECT mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64,
               t.MONTO AS TOTAL
        FROM ${tableName} t
        JOIN METODOS_PAGO mp ON t.METODO_PAGO_ID = mp.METODO_PAGO_ID
        WHERE t.${fkColumn} = @origenId${catFilter}
        ORDER BY CASE WHEN mp.CATEGORIA = 'EFECTIVO' THEN 0 ELSE 1 END, mp.NOMBRE
      `);
      return result.recordset;
    } catch {
      return [];
    }
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
