import { getPool, sql } from '../database/connection.js';
import type { Cheque, ChequeEstado, ChequeInput, ChequePayload, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Cheques Service
//
//  Maneja el ciclo de vida de cheques recibidos:
//    EN_CARTERA → EGRESADO | DEPOSITADO | ANULADO
//
//  Auditoría doble:
//    1) Llama a SP_REGISTRAR_AUDITORIA (sistema general).
//    2) Inserta fila en CHEQUES_HISTORIAL (bitácora propia).
// ═══════════════════════════════════════════════════

const VALID_ESTADOS: ChequeEstado[] = ['EN_CARTERA', 'EGRESADO', 'DEPOSITADO', 'ANULADO'];

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function validate<T extends string>(value: any, name: string, max?: number): T {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw Object.assign(new Error(`${name} es requerido`), { name: 'ValidationError' });
  }
  const str = String(value).trim();
  if (max && str.length > max) {
    throw Object.assign(new Error(`${name} excede el máximo de ${max} caracteres`), { name: 'ValidationError' });
  }
  return str as T;
}

let _tablesReady = false;

async function ensureTables(poolOrTx: any): Promise<void> {
  if (_tablesReady) return;
  await poolOrTx.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CHEQUES]') AND type = N'U')
    BEGIN
      CREATE TABLE CHEQUES (
        CHEQUE_ID            INT IDENTITY(1,1) PRIMARY KEY,
        BANCO                NVARCHAR(120) NOT NULL,
        LIBRADOR             NVARCHAR(180) NOT NULL,
        NUMERO               NVARCHAR(40)  NOT NULL,
        IMPORTE              DECIMAL(18,2) NOT NULL,
        PORTADOR             NVARCHAR(180) NULL,
        FECHA_INGRESO        DATETIME      NOT NULL DEFAULT GETDATE(),
        FECHA_PRESENTACION   DATE          NULL,
        FECHA_SALIDA         DATETIME      NULL,
        ESTADO               NVARCHAR(20)  NOT NULL DEFAULT 'EN_CARTERA',
        ORIGEN_TIPO          NVARCHAR(20)  NULL,
        ORIGEN_ID            INT           NULL,
        DESTINO_TIPO         NVARCHAR(20)  NULL,
        DESTINO_ID           INT           NULL,
        DESTINO_DESC         NVARCHAR(255) NULL,
        OBSERVACIONES        NVARCHAR(500) NULL,
        USUARIO_ID           INT           NULL,
        USUARIO_NOMBRE       NVARCHAR(100) NULL,
        FECHA_CREACION       DATETIME      NOT NULL DEFAULT GETDATE(),
        FECHA_ACTUALIZACION  DATETIME      NULL,
        CONSTRAINT CK_CHEQUES_ESTADO CHECK (ESTADO IN ('EN_CARTERA','EGRESADO','DEPOSITADO','ANULADO'))
      );
      CREATE INDEX IX_CHEQUES_ESTADO         ON CHEQUES(ESTADO);
      CREATE INDEX IX_CHEQUES_FECHA_INGRESO  ON CHEQUES(FECHA_INGRESO DESC);
      CREATE INDEX IX_CHEQUES_NUMERO         ON CHEQUES(NUMERO);
      CREATE INDEX IX_CHEQUES_ORIGEN         ON CHEQUES(ORIGEN_TIPO, ORIGEN_ID);
      CREATE INDEX IX_CHEQUES_DESTINO        ON CHEQUES(DESTINO_TIPO, DESTINO_ID);
    END
  `);

  await poolOrTx.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CHEQUES_HISTORIAL]') AND type = N'U')
    BEGIN
      CREATE TABLE CHEQUES_HISTORIAL (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        CHEQUE_ID       INT           NOT NULL,
        ESTADO_ANTERIOR NVARCHAR(20)  NULL,
        ESTADO_NUEVO    NVARCHAR(20)  NOT NULL,
        DESCRIPCION     NVARCHAR(500) NULL,
        USUARIO_ID      INT           NULL,
        USUARIO_NOMBRE  NVARCHAR(100) NULL,
        FECHA           DATETIME      NOT NULL DEFAULT GETDATE()
      );
      CREATE INDEX IX_CHEQUES_HISTORIAL_CHEQUE ON CHEQUES_HISTORIAL(CHEQUE_ID, FECHA DESC);
    END
  `);

  // Migración in-place: agrega BANCO_ID si falta + FK opcional a BANCOS
  await poolOrTx.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CHEQUES]') AND name = 'BANCO_ID')
    BEGIN
      ALTER TABLE CHEQUES ADD BANCO_ID INT NULL;
    END
  `);
  await poolOrTx.request().query(`
    IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BANCOS]') AND type = N'U')
       AND NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CHEQUES_BANCO')
    BEGIN
      ALTER TABLE CHEQUES ADD CONSTRAINT FK_CHEQUES_BANCO
        FOREIGN KEY (BANCO_ID) REFERENCES BANCOS(BANCO_ID);
    END
  `);
  _tablesReady = true;
}

async function registrarAuditoria(
  tx: any,
  chequeId: number,
  tipoMovimiento: string,
  usuarioId: number | null,
  monto: number,
  descripcion: string
): Promise<void> {
  try {
    await tx.request()
      .input('TipoEntidad', sql.NVarChar(50), 'CHEQUE')
      .input('EntidadId', sql.Int, chequeId)
      .input('TipoMovimiento', sql.NVarChar(50), tipoMovimiento)
      .input('UsuarioId', sql.Int, usuarioId)
      .input('PuntoVentaId', sql.Int, null)
      .input('CajaId', sql.Int, null)
      .input('Descripcion', sql.NVarChar(500), descripcion)
      .input('Monto', sql.Decimal(18, 2), monto)
      .output('AuditoriaId', sql.BigInt)
      .execute('SP_REGISTRAR_AUDITORIA');
  } catch {
    /* SP_REGISTRAR_AUDITORIA may not exist — auditoría liviana en CHEQUES_HISTORIAL siempre se registra */
  }
}

async function insertHistorial(
  tx: any,
  chequeId: number,
  estadoAnterior: ChequeEstado | null,
  estadoNuevo: ChequeEstado,
  descripcion: string,
  usuarioId: number | null,
  usuarioNombre: string | null
): Promise<void> {
  await tx.request()
    .input('chequeId', sql.Int, chequeId)
    .input('estAnt', sql.NVarChar(20), estadoAnterior)
    .input('estNue', sql.NVarChar(20), estadoNuevo)
    .input('desc', sql.NVarChar(500), descripcion)
    .input('uid', sql.Int, usuarioId)
    .input('uname', sql.NVarChar(100), usuarioNombre)
    .query(`
      INSERT INTO CHEQUES_HISTORIAL (CHEQUE_ID, ESTADO_ANTERIOR, ESTADO_NUEVO, DESCRIPCION, USUARIO_ID, USUARIO_NOMBRE)
      VALUES (@chequeId, @estAnt, @estNue, @desc, @uid, @uname)
    `);
}

/**
 * Inserta un MOVIMIENTOS_CAJA reflejando una salida de cheque de cartera.
 * Reglas:
 *  - DEPOSITADO: CHEQUES = -importe, DIGITAL = +importe (transfer interno a banco), TOTAL = 0.
 *  - ANULADO   : CHEQUES = -importe, TOTAL = -importe (write-off / rechazo).
 *  - EGRESADO  : CHEQUES = -importe, TOTAL = -importe (entrega a tercero, ej. orden de pago manual).
 */
async function insertMovimientoCajaCheque(
  tx: any,
  chequeId: number,
  importe: number,
  estadoNuevo: 'DEPOSITADO' | 'ANULADO' | 'EGRESADO',
  numeroCheque: string,
  destinoDesc: string | null,
  usuarioId: number | null,
): Promise<void> {
  const importeAbs = r2(Math.abs(importe));
  let efectivo = 0;
  let digital = 0;
  let cheques = -importeAbs;
  let total = -importeAbs;
  let descripcion: string;
  if (estadoNuevo === 'DEPOSITADO') {
    digital = importeAbs;
    total = 0;
    descripcion = destinoDesc
      ? `Depósito cheque #${numeroCheque} — ${destinoDesc}`
      : `Depósito cheque #${numeroCheque}`;
  } else if (estadoNuevo === 'ANULADO') {
    descripcion = destinoDesc
      ? `Anulación cheque #${numeroCheque} — ${destinoDesc}`
      : `Anulación cheque #${numeroCheque}`;
  } else {
    descripcion = destinoDesc
      ? `Egreso cheque #${numeroCheque} — ${destinoDesc}`
      : `Egreso cheque #${numeroCheque}`;
  }
  await tx.request()
    .input('idEntidad', sql.Int, chequeId)
    .input('tipoEntidad', sql.VarChar(20), 'CHEQUE')
    .input('movimiento', sql.NVarChar(500), descripcion)
    .input('uid', sql.Int, usuarioId)
    .input('efectivo', sql.Decimal(18, 2), efectivo)
    .input('digital', sql.Decimal(18, 2), digital)
    .input('cheques', sql.Decimal(18, 2), cheques)
    .input('total', sql.Decimal(18, 2), total)
    .query(`
      INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
      VALUES (@idEntidad, @tipoEntidad, @movimiento, @uid, @efectivo, @digital, @cheques, 0, @total, NULL, 1)
    `);
}

// ═══════════════════════════════════════════════════
//  Helpers reutilizables por sales/purchases
// ═══════════════════════════════════════════════════

/**
 * Crea un cheque EN_CARTERA dentro de la transacción de un cobro.
 * Llamado por sales.service / cobranzas / etc. cuando un método de
 * pago de categoría CHEQUES se selecciona.
 */
export async function crearChequeEnCartera(
  tx: any,
  payload: ChequePayload,
  importe: number,
  origenTipo: string,
  origenId: number,
  usuarioId: number | null,
  usuarioNombre: string | null
): Promise<number> {
  await ensureTables(tx);
  if (!payload) {
    throw Object.assign(
      new Error('Faltan datos del cheque'),
      { name: 'ValidationError' }
    );
  }

  // Resolver BANCO (texto) desde BANCO_ID si únicamente vino el ID
  let bancoNombre = payload.BANCO;
  if ((!bancoNombre || !bancoNombre.trim()) && payload.BANCO_ID) {
    const r: any = await (tx.request() as any)
      .input('id', sql.Int, payload.BANCO_ID)
      .query('SELECT NOMBRE FROM BANCOS WHERE BANCO_ID = @id');
    if (r.recordset[0]) bancoNombre = r.recordset[0].NOMBRE;
  }

  if (!bancoNombre || !payload.LIBRADOR || !payload.NUMERO) {
    throw Object.assign(
      new Error('Faltan datos obligatorios del cheque (banco, librador, número)'),
      { name: 'ValidationError' }
    );
  }
  if (!(importe > 0)) {
    throw Object.assign(new Error('El importe del cheque debe ser mayor a 0'), { name: 'ValidationError' });
  }

  const result = await tx.request()
    .input('bancoId', sql.Int, payload.BANCO_ID ?? null)
    .input('banco', sql.NVarChar(120), validate(bancoNombre, 'Banco', 120))
    .input('librador', sql.NVarChar(180), validate(payload.LIBRADOR, 'Librador', 180))
    .input('numero', sql.NVarChar(40), validate(payload.NUMERO, 'Número', 40))
    .input('importe', sql.Decimal(18, 2), r2(importe))
    .input('portador', sql.NVarChar(180), payload.PORTADOR || null)
    .input('fpres', sql.Date, payload.FECHA_PRESENTACION ? new Date(payload.FECHA_PRESENTACION) : null)
    .input('origTipo', sql.NVarChar(20), origenTipo)
    .input('origId', sql.Int, origenId)
    .input('uid', sql.Int, usuarioId)
    .input('uname', sql.NVarChar(100), usuarioNombre)
    .query(`
      INSERT INTO CHEQUES (BANCO_ID, BANCO, LIBRADOR, NUMERO, IMPORTE, PORTADOR,
        FECHA_PRESENTACION, ESTADO, ORIGEN_TIPO, ORIGEN_ID, USUARIO_ID, USUARIO_NOMBRE)
      OUTPUT INSERTED.CHEQUE_ID
      VALUES (@bancoId, @banco, @librador, @numero, @importe, @portador,
        @fpres, 'EN_CARTERA', @origTipo, @origId, @uid, @uname)
    `);
  const chequeId: number = result.recordset[0].CHEQUE_ID;

  await insertHistorial(tx, chequeId, null, 'EN_CARTERA',
    `Ingreso por ${origenTipo} #${origenId}`, usuarioId, usuarioNombre);
  await registrarAuditoria(tx, chequeId, 'INGRESO', usuarioId, r2(importe),
    `Cheque ${payload.NUMERO} ingresado a cartera (${origenTipo} #${origenId})`);

  return chequeId;
}

/**
 * Marca cheques EN_CARTERA como EGRESADOS al confirmar un pago.
 * Devuelve el importe total egresado (suma de los cheques).
 *
 * Lanza ValidationError si:
 *  - algún cheque no existe
 *  - algún cheque NO está EN_CARTERA
 */
export async function marcarChequesEgresados(
  tx: any,
  chequesIds: number[],
  destinoTipo: string,
  destinoId: number,
  destinoDesc: string,
  usuarioId: number | null,
  usuarioNombre: string | null
): Promise<{ chequeIds: number[]; total: number }> {
  await ensureTables(tx);
  if (!chequesIds || chequesIds.length === 0) {
    return { chequeIds: [], total: 0 };
  }

  // Validar todos antes de modificar (lock)
  const ids = Array.from(new Set(chequesIds.filter(n => Number.isInteger(n) && n > 0)));
  if (ids.length === 0) return { chequeIds: [], total: 0 };

  const placeholders = ids.map((_, i) => `@id${i}`).join(',');
  const reqCheck = tx.request();
  ids.forEach((id, i) => reqCheck.input(`id${i}`, sql.Int, id));
  const check = await reqCheck.query(`
    SELECT CHEQUE_ID, ESTADO, IMPORTE, NUMERO
    FROM CHEQUES WITH (UPDLOCK, HOLDLOCK)
    WHERE CHEQUE_ID IN (${placeholders})
  `);
  if (check.recordset.length !== ids.length) {
    throw Object.assign(new Error('Uno o más cheques no existen'), { name: 'ValidationError' });
  }
  const noCartera = check.recordset.find((r: any) => r.ESTADO !== 'EN_CARTERA');
  if (noCartera) {
    throw Object.assign(
      new Error(`El cheque ${noCartera.NUMERO} no está en cartera (estado: ${noCartera.ESTADO})`),
      { name: 'ValidationError' }
    );
  }

  let total = 0;
  for (const row of check.recordset) {
    total += Number(row.IMPORTE) || 0;
    await tx.request()
      .input('id', sql.Int, row.CHEQUE_ID)
      .input('destTipo', sql.NVarChar(20), destinoTipo)
      .input('destId', sql.Int, destinoId)
      .input('destDesc', sql.NVarChar(255), destinoDesc)
      .query(`
        UPDATE CHEQUES SET
          ESTADO = 'EGRESADO',
          FECHA_SALIDA = GETDATE(),
          FECHA_ACTUALIZACION = GETDATE(),
          DESTINO_TIPO = @destTipo,
          DESTINO_ID = @destId,
          DESTINO_DESC = @destDesc
        WHERE CHEQUE_ID = @id
      `);
    await insertHistorial(tx, row.CHEQUE_ID, 'EN_CARTERA', 'EGRESADO',
      `Egreso por ${destinoTipo} #${destinoId} - ${destinoDesc}`, usuarioId, usuarioNombre);
    await registrarAuditoria(tx, row.CHEQUE_ID, 'EGRESO', usuarioId, Number(row.IMPORTE) || 0,
      `Cheque ${row.NUMERO} egresado (${destinoTipo} #${destinoId})`);
  }
  return { chequeIds: ids, total: r2(total) };
}

/** Revertir el egreso de cheques (al borrar/anular una compra que los usó). */
export async function revertirEgresoCheques(
  tx: any,
  destinoTipo: string,
  destinoId: number,
  usuarioId: number | null,
  usuarioNombre: string | null
): Promise<void> {
  await ensureTables(tx);
  const found = await tx.request()
    .input('dt', sql.NVarChar(20), destinoTipo)
    .input('di', sql.Int, destinoId)
    .query(`
      SELECT CHEQUE_ID, NUMERO, IMPORTE FROM CHEQUES
      WHERE DESTINO_TIPO = @dt AND DESTINO_ID = @di AND ESTADO = 'EGRESADO'
    `);
  for (const row of found.recordset) {
    await tx.request()
      .input('id', sql.Int, row.CHEQUE_ID)
      .query(`
        UPDATE CHEQUES SET
          ESTADO = 'EN_CARTERA',
          FECHA_SALIDA = NULL,
          FECHA_ACTUALIZACION = GETDATE(),
          DESTINO_TIPO = NULL,
          DESTINO_ID = NULL,
          DESTINO_DESC = NULL
        WHERE CHEQUE_ID = @id
      `);
    await insertHistorial(tx, row.CHEQUE_ID, 'EGRESADO', 'EN_CARTERA',
      `Reversión de egreso (${destinoTipo} #${destinoId})`, usuarioId, usuarioNombre);
  }
}

// ═══════════════════════════════════════════════════
//  Service público (listado, salida masiva, anular...)
// ═══════════════════════════════════════════════════

export interface ChequeFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  estado?: ChequeEstado | 'TODOS';
  desde?: string;
  hasta?: string;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

const VALID_ORDER_BY = new Set([
  'CHEQUE_ID', 'BANCO', 'LIBRADOR', 'NUMERO', 'IMPORTE',
  'FECHA_INGRESO', 'FECHA_PRESENTACION', 'FECHA_SALIDA', 'ESTADO',
]);

export const chequesService = {
  async ensureTable(): Promise<void> {
    const pool = await getPool();
    await ensureTables(pool);
  },

  async getAll(filter: ChequeFilter = {}): Promise<PaginatedResult<Cheque>> {
    const pool = await getPool();
    await ensureTables(pool);

    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? Math.min(filter.pageSize, 200) : 25;
    const orderBy = filter.orderBy && VALID_ORDER_BY.has(filter.orderBy) ? filter.orderBy : 'FECHA_INGRESO';
    const orderDir = filter.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const where: string[] = [];
    const req = pool.request();

    if (filter.estado && filter.estado !== 'TODOS' && VALID_ESTADOS.includes(filter.estado as ChequeEstado)) {
      where.push('ESTADO = @estado');
      req.input('estado', sql.NVarChar(20), filter.estado);
    }
    if (filter.search) {
      where.push('(NUMERO LIKE @s OR LIBRADOR LIKE @s OR BANCO LIKE @s)');
      req.input('s', sql.NVarChar(200), `%${filter.search}%`);
    }
    if (filter.desde) {
      where.push('FECHA_INGRESO >= @desde');
      req.input('desde', sql.DateTime, new Date(filter.desde));
    }
    if (filter.hasta) {
      where.push('FECHA_INGRESO <= @hasta');
      req.input('hasta', sql.DateTime, new Date(filter.hasta));
    }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await req.query(`SELECT COUNT(*) AS total FROM CHEQUES ${whereClause}`);
    const total: number = countResult.recordset[0].total;

    const offset = (page - 1) * pageSize;
    const dataReq = pool.request();
    if (filter.estado && filter.estado !== 'TODOS' && VALID_ESTADOS.includes(filter.estado as ChequeEstado)) {
      dataReq.input('estado', sql.NVarChar(20), filter.estado);
    }
    if (filter.search) dataReq.input('s', sql.NVarChar(200), `%${filter.search}%`);
    if (filter.desde) dataReq.input('desde', sql.DateTime, new Date(filter.desde));
    if (filter.hasta) dataReq.input('hasta', sql.DateTime, new Date(filter.hasta));
    dataReq.input('offset', sql.Int, offset).input('size', sql.Int, pageSize);

    const dataResult = await dataReq.query(`
      SELECT * FROM CHEQUES
      ${whereClause}
      ORDER BY ${orderBy} ${orderDir}, CHEQUE_ID DESC
      OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY
    `);

    return {
      data: dataResult.recordset,
      total,
      page,
      pageSize,
    };
  },

  async getById(id: number): Promise<Cheque & { historial: any[] }> {
    const pool = await getPool();
    await ensureTables(pool);
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM CHEQUES WHERE CHEQUE_ID = @id');
    if (!result.recordset[0]) {
      throw Object.assign(new Error('Cheque no encontrado'), { name: 'ValidationError' });
    }
    const hist = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT * FROM CHEQUES_HISTORIAL WHERE CHEQUE_ID = @id ORDER BY FECHA DESC, ID DESC');
    return { ...result.recordset[0], historial: hist.recordset };
  },

  async getEnCartera(): Promise<Cheque[]> {
    const pool = await getPool();
    await ensureTables(pool);
    const r = await pool.request()
      .query(`SELECT * FROM CHEQUES WHERE ESTADO = 'EN_CARTERA' ORDER BY FECHA_PRESENTACION ASC, FECHA_INGRESO ASC`);
    return r.recordset;
  },

  /** Alta manual (sin cobro asociado) */
  async create(input: ChequeInput, usuarioId: number, usuarioNombre: string | null): Promise<{ CHEQUE_ID: number }> {
    const pool = await getPool();
    await ensureTables(pool);
    const tx = pool.transaction();
    await tx.begin();
    try {
      const id = await crearChequeEnCartera(
        tx,
        {
          BANCO_ID: input.BANCO_ID ?? null,
          BANCO: input.BANCO, LIBRADOR: input.LIBRADOR, NUMERO: input.NUMERO,
          PORTADOR: input.PORTADOR ?? null, FECHA_PRESENTACION: input.FECHA_PRESENTACION ?? null,
        },
        input.IMPORTE,
        input.ORIGEN_TIPO || 'MANUAL',
        input.ORIGEN_ID || 0,
        usuarioId,
        usuarioNombre,
      );
      if (input.OBSERVACIONES) {
        await tx.request()
          .input('id', sql.Int, id)
          .input('obs', sql.NVarChar(500), input.OBSERVACIONES)
          .query('UPDATE CHEQUES SET OBSERVACIONES = @obs WHERE CHEQUE_ID = @id');
      }
      await tx.commit();
      return { CHEQUE_ID: id };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  /** Edición de campos descriptivos (sólo si EN_CARTERA) */
  async update(id: number, input: Partial<ChequeInput>, usuarioId: number): Promise<void> {
    const pool = await getPool();
    await ensureTables(pool);
    const cur = await pool.request().input('id', sql.Int, id)
      .query('SELECT ESTADO FROM CHEQUES WHERE CHEQUE_ID = @id');
    if (!cur.recordset[0]) {
      throw Object.assign(new Error('Cheque no encontrado'), { name: 'ValidationError' });
    }
    if (cur.recordset[0].ESTADO !== 'EN_CARTERA') {
      throw Object.assign(new Error('Sólo se pueden editar cheques EN_CARTERA'), { name: 'ValidationError' });
    }
    const sets: string[] = [];
    const req = pool.request().input('id', sql.Int, id);
    if (input.BANCO_ID !== undefined)           { sets.push('BANCO_ID = @bancoId');               req.input('bancoId', sql.Int, input.BANCO_ID); }
    if (input.BANCO !== undefined)              { sets.push('BANCO = @banco');                    req.input('banco', sql.NVarChar(120), input.BANCO); }
    if (input.LIBRADOR !== undefined)           { sets.push('LIBRADOR = @librador');              req.input('librador', sql.NVarChar(180), input.LIBRADOR); }
    if (input.NUMERO !== undefined)             { sets.push('NUMERO = @numero');                  req.input('numero', sql.NVarChar(40), input.NUMERO); }
    if (input.IMPORTE !== undefined)            { sets.push('IMPORTE = @importe');                req.input('importe', sql.Decimal(18, 2), r2(input.IMPORTE)); }
    if (input.PORTADOR !== undefined)           { sets.push('PORTADOR = @portador');              req.input('portador', sql.NVarChar(180), input.PORTADOR); }
    if (input.FECHA_PRESENTACION !== undefined) { sets.push('FECHA_PRESENTACION = @fpres');       req.input('fpres', sql.Date, input.FECHA_PRESENTACION ? new Date(input.FECHA_PRESENTACION) : null); }
    if (input.OBSERVACIONES !== undefined)      { sets.push('OBSERVACIONES = @obs');              req.input('obs', sql.NVarChar(500), input.OBSERVACIONES); }
    if (sets.length === 0) return;
    sets.push('FECHA_ACTUALIZACION = GETDATE()');
    await req.query(`UPDATE CHEQUES SET ${sets.join(', ')} WHERE CHEQUE_ID = @id`);
    void usuarioId;
  },

  /** Cambia estado (operación administrativa: depositar / anular). */
  async cambiarEstado(
    id: number,
    estadoNuevo: ChequeEstado,
    payload: { descripcion?: string; destinoTipo?: string; destinoId?: number; destinoDesc?: string },
    usuarioId: number,
    usuarioNombre: string | null
  ): Promise<void> {
    if (!VALID_ESTADOS.includes(estadoNuevo)) {
      throw Object.assign(new Error('Estado inválido'), { name: 'ValidationError' });
    }
    const pool = await getPool();
    await ensureTables(pool);
    const tx = pool.transaction();
    await tx.begin();
    try {
      const cur = await tx.request().input('id', sql.Int, id)
        .query('SELECT ESTADO, IMPORTE, NUMERO FROM CHEQUES WITH (UPDLOCK) WHERE CHEQUE_ID = @id');
      if (!cur.recordset[0]) {
        throw Object.assign(new Error('Cheque no encontrado'), { name: 'ValidationError' });
      }
      const estadoAnterior: ChequeEstado = cur.recordset[0].ESTADO;
      if (estadoAnterior === estadoNuevo) {
        await tx.commit();
        return;
      }
      // Reglas de transición simples
      // EN_CARTERA → DEPOSITADO | ANULADO | EGRESADO
      // EGRESADO   → ANULADO (rechazo)
      // DEPOSITADO → ANULADO (rechazo)
      // ANULADO    → (no se permite)
      if (estadoAnterior === 'ANULADO') {
        throw Object.assign(new Error('No se puede modificar un cheque anulado'), { name: 'ValidationError' });
      }
      if (estadoAnterior !== 'EN_CARTERA' && estadoNuevo === 'DEPOSITADO') {
        throw Object.assign(new Error('Sólo se pueden depositar cheques EN_CARTERA'), { name: 'ValidationError' });
      }
      if (estadoAnterior !== 'EN_CARTERA' && estadoNuevo === 'EGRESADO') {
        throw Object.assign(new Error('Sólo se pueden egresar cheques EN_CARTERA'), { name: 'ValidationError' });
      }

      const setSalida = (estadoNuevo === 'DEPOSITADO' || estadoNuevo === 'EGRESADO');
      const req = tx.request()
        .input('id', sql.Int, id)
        .input('estado', sql.NVarChar(20), estadoNuevo)
        .input('destTipo', sql.NVarChar(20), payload.destinoTipo || (estadoNuevo === 'DEPOSITADO' ? 'DEPOSITO_BANCO' : null))
        .input('destId', sql.Int, payload.destinoId ?? null)
        .input('destDesc', sql.NVarChar(255), payload.destinoDesc || null);

      await req.query(`
        UPDATE CHEQUES SET
          ESTADO = @estado,
          FECHA_ACTUALIZACION = GETDATE(),
          ${setSalida ? 'FECHA_SALIDA = GETDATE(),' : ''}
          DESTINO_TIPO = COALESCE(@destTipo, DESTINO_TIPO),
          DESTINO_ID   = COALESCE(@destId,   DESTINO_ID),
          DESTINO_DESC = COALESCE(@destDesc, DESTINO_DESC)
        WHERE CHEQUE_ID = @id
      `);

      const desc = payload.descripcion || `Cambio de estado a ${estadoNuevo}`;
      await insertHistorial(tx, id, estadoAnterior, estadoNuevo, desc, usuarioId, usuarioNombre);
      await registrarAuditoria(tx, id, `ESTADO_${estadoNuevo}`, usuarioId,
        Number(cur.recordset[0].IMPORTE) || 0,
        `Cheque ${cur.recordset[0].NUMERO}: ${estadoAnterior} → ${estadoNuevo}`);

      // Reflejar la salida en MOVIMIENTOS_CAJA si la transición saca el cheque de cartera.
      if (
        estadoAnterior === 'EN_CARTERA' &&
        (estadoNuevo === 'DEPOSITADO' || estadoNuevo === 'ANULADO' || estadoNuevo === 'EGRESADO')
      ) {
        await insertMovimientoCajaCheque(
          tx,
          id,
          Number(cur.recordset[0].IMPORTE) || 0,
          estadoNuevo,
          String(cur.recordset[0].NUMERO),
          payload.destinoDesc || null,
          usuarioId,
        );
      }

      // Reversal movement when a cheque that was already DEPOSITADO or EGRESADO is ANULADO (rechazado).
      // The original movement debited CHEQUES; we need to credit it back.
      if (
        estadoNuevo === 'ANULADO' &&
        (estadoAnterior === 'DEPOSITADO' || estadoAnterior === 'EGRESADO')
      ) {
        const importeRev = r2(Math.abs(Number(cur.recordset[0].IMPORTE) || 0));
        const descRev = payload.descripcion
          ? `Reversal cheque #${cur.recordset[0].NUMERO} (${estadoAnterior}→ANULADO) — ${payload.descripcion}`
          : `Reversal cheque #${cur.recordset[0].NUMERO} (${estadoAnterior}→ANULADO)`;
        // For DEPOSITADO: original movement was CHEQUES=-imp, DIGITAL=+imp, TOTAL=0
        //   Reversal: CHEQUES=+imp, DIGITAL=-imp, TOTAL=0
        // For EGRESADO: original movement was CHEQUES=-imp, TOTAL=-imp
        //   Reversal: CHEQUES=+imp, TOTAL=+imp
        const digitalRev = estadoAnterior === 'DEPOSITADO' ? -importeRev : 0;
        const totalRev = estadoAnterior === 'DEPOSITADO' ? 0 : importeRev;
        await tx.request()
          .input('idEntidad', sql.Int, id)
          .input('tipoEntidad', sql.VarChar(20), 'CHEQUE')
          .input('movimiento', sql.NVarChar(500), descRev)
          .input('uid', sql.Int, usuarioId)
          .input('digital', sql.Decimal(18, 2), digitalRev)
          .input('cheques', sql.Decimal(18, 2), importeRev)
          .input('total', sql.Decimal(18, 2), totalRev)
          .query(`
            INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
            VALUES (@idEntidad, @tipoEntidad, @movimiento, @uid, 0, @digital, @cheques, 0, @total, NULL, 1)
          `);
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  /** Salida masiva: marca un conjunto de cheques EN_CARTERA con un estado destino (DEPOSITADO o ANULADO). */
  async salidaMasiva(
    chequesIds: number[],
    estadoDestino: 'DEPOSITADO' | 'ANULADO',
    descripcion: string,
    destinoDesc: string | null,
    usuarioId: number,
    usuarioNombre: string | null
  ): Promise<{ procesados: number; total: number }> {
    if (!chequesIds || chequesIds.length === 0) {
      return { procesados: 0, total: 0 };
    }
    if (estadoDestino !== 'DEPOSITADO' && estadoDestino !== 'ANULADO') {
      throw Object.assign(new Error('Estado destino inválido para salida masiva'), { name: 'ValidationError' });
    }
    const pool = await getPool();
    await ensureTables(pool);
    const tx = pool.transaction();
    await tx.begin();
    try {
      const ids = Array.from(new Set(chequesIds.filter(n => Number.isInteger(n) && n > 0)));
      const placeholders = ids.map((_, i) => `@id${i}`).join(',');
      const reqCheck = tx.request();
      ids.forEach((id, i) => reqCheck.input(`id${i}`, sql.Int, id));
      const check = await reqCheck.query(`
        SELECT CHEQUE_ID, ESTADO, IMPORTE, NUMERO FROM CHEQUES WITH (UPDLOCK, HOLDLOCK)
        WHERE CHEQUE_ID IN (${placeholders})
      `);
      if (check.recordset.length !== ids.length) {
        throw Object.assign(new Error('Uno o más cheques no existen'), { name: 'ValidationError' });
      }
      const noCartera = check.recordset.find((r: any) => r.ESTADO !== 'EN_CARTERA');
      if (noCartera) {
        throw Object.assign(
          new Error(`El cheque ${noCartera.NUMERO} no está en cartera (estado: ${noCartera.ESTADO})`),
          { name: 'ValidationError' }
        );
      }

      let total = 0;
      for (const row of check.recordset) {
        total += Number(row.IMPORTE) || 0;
        await tx.request()
          .input('id', sql.Int, row.CHEQUE_ID)
          .input('estado', sql.NVarChar(20), estadoDestino)
          .input('destTipo', sql.NVarChar(20), estadoDestino === 'DEPOSITADO' ? 'DEPOSITO_BANCO' : 'ANULADO')
          .input('destDesc', sql.NVarChar(255), destinoDesc)
          .query(`
            UPDATE CHEQUES SET
              ESTADO = @estado,
              FECHA_SALIDA = GETDATE(),
              FECHA_ACTUALIZACION = GETDATE(),
              DESTINO_TIPO = @destTipo,
              DESTINO_DESC = @destDesc
            WHERE CHEQUE_ID = @id
          `);
        await insertHistorial(tx, row.CHEQUE_ID, 'EN_CARTERA', estadoDestino,
          descripcion || `Salida masiva → ${estadoDestino}`, usuarioId, usuarioNombre);
        await registrarAuditoria(tx, row.CHEQUE_ID, `ESTADO_${estadoDestino}`, usuarioId,
          Number(row.IMPORTE) || 0,
          `Cheque ${row.NUMERO}: EN_CARTERA → ${estadoDestino}`);
        await insertMovimientoCajaCheque(
          tx,
          row.CHEQUE_ID,
          Number(row.IMPORTE) || 0,
          estadoDestino,
          String(row.NUMERO),
          destinoDesc,
          usuarioId,
        );
      }
      await tx.commit();
      return { procesados: ids.length, total: r2(total) };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  /** Eliminar (soft → ANULADO). No se permite borrar fila si tiene historial. */
  async delete(id: number, usuarioId: number, usuarioNombre: string | null): Promise<{ mode: 'soft' }> {
    await this.cambiarEstado(id, 'ANULADO', { descripcion: 'Eliminado/Anulado por usuario' }, usuarioId, usuarioNombre);
    return { mode: 'soft' };
  },

  /** Resumen para dashboards / reportes financieros */
  async getResumen(): Promise<{ enCarteraCount: number; enCarteraTotal: number; egresadoTotal: number; depositadoTotal: number }> {
    const pool = await getPool();
    await ensureTables(pool);
    const r = await pool.request().query(`
      SELECT
        SUM(CASE WHEN ESTADO = 'EN_CARTERA' THEN 1 ELSE 0 END)            AS enCarteraCount,
        SUM(CASE WHEN ESTADO = 'EN_CARTERA' THEN IMPORTE ELSE 0 END)      AS enCarteraTotal,
        SUM(CASE WHEN ESTADO = 'EGRESADO'   THEN IMPORTE ELSE 0 END)      AS egresadoTotal,
        SUM(CASE WHEN ESTADO = 'DEPOSITADO' THEN IMPORTE ELSE 0 END)      AS depositadoTotal
      FROM CHEQUES
    `);
    const row = r.recordset[0] || {};
    return {
      enCarteraCount: Number(row.enCarteraCount) || 0,
      enCarteraTotal: Number(row.enCarteraTotal) || 0,
      egresadoTotal:  Number(row.egresadoTotal)  || 0,
      depositadoTotal: Number(row.depositadoTotal) || 0,
    };
  },
};
