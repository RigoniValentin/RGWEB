import { getPool, sql } from '../database/connection.js';
import type { PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Remitos Service — Delivery Notes (Entrada/Salida)
// ═══════════════════════════════════════════════════

export interface RemitoFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  tipo?: 'ENTRADA' | 'SALIDA';
  fechaDesde?: string;
  fechaHasta?: string;
  clienteId?: number;
  proveedorId?: number;
  anulado?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface RemitoItemInput {
  PRODUCTO_ID: number;
  CANTIDAD: number;
  PRECIO_UNITARIO?: number;
  DEPOSITO_ID?: number;
}

export interface RemitoInput {
  TIPO: 'ENTRADA' | 'SALIDA';
  FECHA?: string;
  PTO_VTA?: string;
  CLIENTE_ID?: number;
  PROVEEDOR_ID?: number;
  DEPOSITO_ID?: number;
  OBSERVACIONES?: string;
  items: RemitoItemInput[];
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Ensure tables exist ──────────────────────────

let _remitosTableReady = false;

async function ensureRemitosTable(pool: any): Promise<void> {
  if (_remitosTableReady) return;
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'REMITOS')
    BEGIN
      CREATE TABLE REMITOS (
        REMITO_ID       INT IDENTITY(1,1) PRIMARY KEY,
        TIPO            VARCHAR(10)       NOT NULL,
        FECHA           DATETIME          NOT NULL DEFAULT GETDATE(),
        PTO_VTA         NVARCHAR(5)       NOT NULL DEFAULT '0001',
        NRO_REMITO      NVARCHAR(10)      NOT NULL DEFAULT '00000001',
        CLIENTE_ID      INT               NULL,
        PROVEEDOR_ID    INT               NULL,
        DEPOSITO_ID     INT               NULL,
        OBSERVACIONES   NVARCHAR(500)     NULL,
        SUBTOTAL        DECIMAL(18,2)     NOT NULL DEFAULT 0,
        TOTAL           DECIMAL(18,2)     NOT NULL DEFAULT 0,
        ANULADO         BIT               NOT NULL DEFAULT 0,
        USUARIO_ID      INT               NULL,
        FECHA_CREACION  DATETIME          NOT NULL DEFAULT GETDATE()
      )
    END
  `);
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'REMITOS_ITEMS')
    BEGIN
      CREATE TABLE REMITOS_ITEMS (
        ITEM_ID         INT IDENTITY(1,1) PRIMARY KEY,
        REMITO_ID       INT               NOT NULL,
        PRODUCTO_ID     INT               NOT NULL,
        CANTIDAD        DECIMAL(18,4)     NOT NULL,
        PRECIO_UNITARIO DECIMAL(18,4)     NOT NULL DEFAULT 0,
        TOTAL_PRODUCTO  DECIMAL(18,4)     NOT NULL DEFAULT 0,
        DEPOSITO_ID     INT               NULL
      )
    END
  `);
  _remitosTableReady = true;
}

// ── Stock helpers ────────────────────────────────

async function incrementarStock(
  tx: any, productoId: number, cantidad: number, depositoId: number | null
) {
  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query(`SELECT ES_CONJUNTO, DESCUENTA_STOCK FROM PRODUCTOS WHERE PRODUCTO_ID = @pid`);
  if (prod.recordset.length === 0) return;

  const esConjunto = prod.recordset[0].ES_CONJUNTO;
  const descuentaStock = prod.recordset[0].DESCUENTA_STOCK;

  if (esConjunto) {
    const children = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT PRODUCTO_ID_HIJO, DEPOSITO_ID, CANTIDAD
              FROM PRODUCTO_CONJUNTO_DEPOSITO WHERE PRODUCTO_ID = @pid`);
    for (const child of children.recordset) {
      const childQty = cantidad * child.CANTIDAD;
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('depId', sql.Int, child.DEPOSITO_ID)
        .input('cant', sql.Decimal(18, 4), childQty)
        .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant
                WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('cant', sql.Decimal(18, 4), childQty)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
    }
    if (descuentaStock) {
      if (depositoId) {
        await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 4), cantidad)
          .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant
                  WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      }
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
    }
  } else if (descuentaStock) {
    if (depositoId) {
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('depId', sql.Int, depositoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant
                WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
    }
    await tx.request()
      .input('prodId', sql.Int, productoId)
      .input('cant', sql.Decimal(18, 4), cantidad)
      .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
  }
}

async function decrementarStock(
  tx: any, productoId: number, cantidad: number, depositoId: number | null
) {
  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query(`SELECT ES_CONJUNTO, DESCUENTA_STOCK FROM PRODUCTOS WHERE PRODUCTO_ID = @pid`);
  if (prod.recordset.length === 0) return;

  const esConjunto = prod.recordset[0].ES_CONJUNTO;
  const descuentaStock = prod.recordset[0].DESCUENTA_STOCK;

  if (esConjunto) {
    const children = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT PRODUCTO_ID_HIJO, DEPOSITO_ID, CANTIDAD
              FROM PRODUCTO_CONJUNTO_DEPOSITO WHERE PRODUCTO_ID = @pid`);
    for (const child of children.recordset) {
      const childQty = cantidad * child.CANTIDAD;
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('depId', sql.Int, child.DEPOSITO_ID)
        .input('cant', sql.Decimal(18, 4), childQty)
        .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant
                WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('cant', sql.Decimal(18, 4), childQty)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
    }
    if (descuentaStock) {
      if (depositoId) {
        await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 4), cantidad)
          .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant
                  WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      }
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
    }
  } else if (descuentaStock) {
    if (depositoId) {
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('depId', sql.Int, depositoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant
                WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
    }
    await tx.request()
      .input('prodId', sql.Int, productoId)
      .input('cant', sql.Decimal(18, 4), cantidad)
      .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
  }
}

// ── Audit helper ─────────────────────────────────

async function registrarAuditoria(
  tx: any, entidadId: number, tipoMovimiento: string,
  usuarioId: number, monto: number, descripcion: string
) {
  try {
    await tx.request()
      .input('TipoEntidad', sql.NVarChar(50), 'REMITO')
      .input('EntidadId', sql.Int, entidadId)
      .input('TipoMovimiento', sql.NVarChar(50), tipoMovimiento)
      .input('UsuarioId', sql.Int, usuarioId)
      .input('PuntoVentaId', sql.Int, null)
      .input('CajaId', sql.Int, null)
      .input('Descripcion', sql.NVarChar(500), descripcion)
      .input('Monto', sql.Decimal(18, 2), monto)
      .output('AuditoriaId', sql.BigInt)
      .execute('SP_REGISTRAR_AUDITORIA');
  } catch {
    console.warn(`Audit registration failed for REMITO ${entidadId} (${tipoMovimiento})`);
  }
}

// ── Next number helper ───────────────────────────

async function getNextNroRemito(tx: any, ptoVta: string, tipo: string): Promise<string> {
  const result = await tx.request()
    .input('ptoVta', sql.NVarChar(5), ptoVta)
    .input('tipo', sql.VarChar(10), tipo)
    .query(`
      SELECT ISNULL(MAX(CAST(NRO_REMITO AS INT)), 0) + 1 AS NEXT_NRO
      FROM REMITOS WITH (UPDLOCK, HOLDLOCK)
      WHERE PTO_VTA = @ptoVta AND TIPO = @tipo
    `);
  const nextNro = result.recordset[0].NEXT_NRO;
  return String(nextNro).padStart(8, '0');
}

// ═══════════════════════════════════════════════════

export const remitosService = {

  // ── List with pagination & filters ─────────────
  async getAll(filter: RemitoFilter = {}): Promise<PaginatedResult<any>> {
    const pool = await getPool();
    await ensureRemitosTable(pool);

    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.tipo) {
      where += ' AND r.TIPO = @tipo';
      params.push({ name: 'tipo', type: sql.VarChar(10), value: filter.tipo });
    }
    if (filter.fechaDesde) {
      where += ' AND CAST(r.FECHA AS DATE) >= @fechaDesde';
      params.push({ name: 'fechaDesde', type: sql.VarChar(10), value: filter.fechaDesde });
    }
    if (filter.fechaHasta) {
      where += ' AND CAST(r.FECHA AS DATE) <= @fechaHasta';
      params.push({ name: 'fechaHasta', type: sql.VarChar(10), value: filter.fechaHasta });
    }
    if (filter.clienteId) {
      where += ' AND r.CLIENTE_ID = @clienteId';
      params.push({ name: 'clienteId', type: sql.Int, value: filter.clienteId });
    }
    if (filter.proveedorId) {
      where += ' AND r.PROVEEDOR_ID = @proveedorId';
      params.push({ name: 'proveedorId', type: sql.Int, value: filter.proveedorId });
    }
    if (filter.anulado !== undefined) {
      where += ' AND r.ANULADO = @anulado';
      params.push({ name: 'anulado', type: sql.Bit, value: filter.anulado ? 1 : 0 });
    }
    if (filter.search) {
      where += ` AND (
        ISNULL(cl.NOMBRE, '') LIKE @search
        OR ISNULL(p.NOMBRE, '') LIKE @search
        OR CAST(r.REMITO_ID AS VARCHAR) LIKE @search
        OR r.NRO_REMITO LIKE @search
      )`;
      params.push({ name: 'search', type: sql.NVarChar, value: `%${filter.search}%` });
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    const countResult = await bind(pool.request()).query(`
      SELECT COUNT(*) as total FROM REMITOS r
      LEFT JOIN CLIENTES cl ON r.CLIENTE_ID = cl.CLIENTE_ID
      LEFT JOIN PROVEEDORES p ON r.PROVEEDOR_ID = p.PROVEEDOR_ID
      ${where}
    `);
    const total = countResult.recordset[0].total;

    const validCols: Record<string, string> = {
      fecha: 'r.FECHA', total: 'r.TOTAL', id: 'r.REMITO_ID',
      tipo: 'r.TIPO',
    };
    const orderCol = validCols[(filter.orderBy || 'fecha').toLowerCase()] || 'r.FECHA';
    const orderDir = filter.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const dataReq = bind(pool.request());
    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query(`
      SELECT
        r.REMITO_ID, r.TIPO, r.FECHA, r.PTO_VTA, r.NRO_REMITO,
        r.CLIENTE_ID, r.PROVEEDOR_ID, r.DEPOSITO_ID,
        r.OBSERVACIONES, r.SUBTOTAL, r.TOTAL,
        r.ANULADO, r.USUARIO_ID, r.FECHA_CREACION,
        cl.NOMBRE AS CLIENTE_NOMBRE,
        p.NOMBRE AS PROVEEDOR_NOMBRE,
        d.NOMBRE AS DEPOSITO_NOMBRE,
        u.NOMBRE AS USUARIO_NOMBRE
      FROM REMITOS r
      LEFT JOIN CLIENTES cl ON r.CLIENTE_ID = cl.CLIENTE_ID
      LEFT JOIN PROVEEDORES p ON r.PROVEEDOR_ID = p.PROVEEDOR_ID
      LEFT JOIN DEPOSITOS d ON r.DEPOSITO_ID = d.DEPOSITO_ID
      LEFT JOIN USUARIOS u ON r.USUARIO_ID = u.USUARIO_ID
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  // ── Get by ID ──────────────────────────────────
  async getById(id: number) {
    const pool = await getPool();
    await ensureRemitosTable(pool);

    const remitoResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT
          r.REMITO_ID, r.TIPO, r.FECHA, r.PTO_VTA, r.NRO_REMITO,
          r.CLIENTE_ID, r.PROVEEDOR_ID, r.DEPOSITO_ID,
          r.OBSERVACIONES, r.SUBTOTAL, r.TOTAL,
          r.ANULADO, r.USUARIO_ID, r.FECHA_CREACION,
          cl.NOMBRE AS CLIENTE_NOMBRE,
          cl.DOMICILIO AS CLIENTE_DOMICILIO,
          cl.TIPO_DOCUMENTO AS CLIENTE_TIPO_DOC,
          cl.NUMERO_DOC AS CLIENTE_NUMERO_DOC,
          cl.CONDICION_IVA AS CLIENTE_CONDICION_IVA,
          p.NOMBRE AS PROVEEDOR_NOMBRE,
          p.DIRECCION AS PROVEEDOR_DOMICILIO,
          p.TIPO_DOCUMENTO AS PROVEEDOR_TIPO_DOC,
          p.NUMERO_DOC AS PROVEEDOR_NUMERO_DOC,
          d.NOMBRE AS DEPOSITO_NOMBRE,
          u.NOMBRE AS USUARIO_NOMBRE
        FROM REMITOS r
        LEFT JOIN CLIENTES cl ON r.CLIENTE_ID = cl.CLIENTE_ID
        LEFT JOIN PROVEEDORES p ON r.PROVEEDOR_ID = p.PROVEEDOR_ID
        LEFT JOIN DEPOSITOS d ON r.DEPOSITO_ID = d.DEPOSITO_ID
        LEFT JOIN USUARIOS u ON r.USUARIO_ID = u.USUARIO_ID
        WHERE r.REMITO_ID = @id
      `);

    if (remitoResult.recordset.length === 0) {
      throw Object.assign(new Error('Remito no encontrado'), { name: 'ValidationError' });
    }

    const itemsResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT ri.ITEM_ID, ri.REMITO_ID, ri.PRODUCTO_ID,
               ri.CANTIDAD, ri.PRECIO_UNITARIO, ri.TOTAL_PRODUCTO,
               ri.DEPOSITO_ID,
               pr.NOMBRE AS PRODUCTO_NOMBRE,
               pr.CODIGOPARTICULAR AS PRODUCTO_CODIGO,
               ISNULL(um.ABREVIACION, 'u') AS UNIDAD_ABREVIACION
        FROM REMITOS_ITEMS ri
        JOIN PRODUCTOS pr ON ri.PRODUCTO_ID = pr.PRODUCTO_ID
        LEFT JOIN UNIDADES_MEDIDA um ON pr.UNIDAD_ID = um.UNIDAD_ID
        WHERE ri.REMITO_ID = @id
        ORDER BY ri.ITEM_ID
      `);

    return {
      ...remitoResult.recordset[0],
      items: itemsResult.recordset,
    };
  },

  // ── Create remito ─────────────────────────────
  async create(input: RemitoInput, usuarioId: number) {
    const pool = await getPool();
    await ensureRemitosTable(pool);
    const tx = pool.transaction();
    await tx.begin();

    try {
      if (!input.items || input.items.length === 0) {
        throw Object.assign(new Error('El remito debe tener al menos un ítem'), { name: 'ValidationError' });
      }

      if (input.TIPO !== 'ENTRADA' && input.TIPO !== 'SALIDA') {
        throw Object.assign(new Error('El tipo debe ser ENTRADA o SALIDA'), { name: 'ValidationError' });
      }

      const ptoVta = input.PTO_VTA || '0001';
      const nroRemito = await getNextNroRemito(tx, ptoVta, input.TIPO);

      // Calculate totals
      let subtotal = 0;
      for (const item of input.items) {
        const precio = item.PRECIO_UNITARIO || 0;
        subtotal += r2(precio * item.CANTIDAD);
      }
      const total = r2(subtotal);

      // INSERT REMITO
      const insertResult = await tx.request()
        .input('tipo', sql.VarChar(10), input.TIPO)
        .input('fecha', sql.DateTime, input.FECHA ? new Date(input.FECHA) : new Date())
        .input('ptoVta', sql.NVarChar(5), ptoVta)
        .input('nroRemito', sql.NVarChar(10), nroRemito)
        .input('clienteId', sql.Int, input.CLIENTE_ID || null)
        .input('proveedorId', sql.Int, input.PROVEEDOR_ID || null)
        .input('depositoId', sql.Int, input.DEPOSITO_ID || null)
        .input('observaciones', sql.NVarChar(500), input.OBSERVACIONES || null)
        .input('subtotal', sql.Decimal(18, 2), subtotal)
        .input('total', sql.Decimal(18, 2), total)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
          INSERT INTO REMITOS (
            TIPO, FECHA, PTO_VTA, NRO_REMITO,
            CLIENTE_ID, PROVEEDOR_ID, DEPOSITO_ID,
            OBSERVACIONES, SUBTOTAL, TOTAL, USUARIO_ID
          )
          OUTPUT INSERTED.REMITO_ID
          VALUES (
            @tipo, @fecha, @ptoVta, @nroRemito,
            @clienteId, @proveedorId, @depositoId,
            @observaciones, @subtotal, @total, @usuarioId
          )
        `);

      const remitoId = insertResult.recordset[0].REMITO_ID;

      // INSERT ITEMS + modify stock
      for (const item of input.items) {
        const precio = item.PRECIO_UNITARIO || 0;
        const totalProducto = r2(precio * item.CANTIDAD);
        const depositoId = item.DEPOSITO_ID || input.DEPOSITO_ID || null;

        await tx.request()
          .input('remitoId', sql.Int, remitoId)
          .input('productoId', sql.Int, item.PRODUCTO_ID)
          .input('cantidad', sql.Decimal(18, 4), item.CANTIDAD)
          .input('precioUnitario', sql.Decimal(18, 4), precio)
          .input('totalProducto', sql.Decimal(18, 4), totalProducto)
          .input('depositoId', sql.Int, depositoId)
          .query(`
            INSERT INTO REMITOS_ITEMS (
              REMITO_ID, PRODUCTO_ID, CANTIDAD, PRECIO_UNITARIO, TOTAL_PRODUCTO, DEPOSITO_ID
            ) VALUES (
              @remitoId, @productoId, @cantidad, @precioUnitario, @totalProducto, @depositoId
            )
          `);

        // ENTRADA = incrementar stock, SALIDA = decrementar stock
        if (input.TIPO === 'ENTRADA') {
          await incrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, depositoId);
        } else {
          await decrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, depositoId);
        }
      }

      // AUDITORIA
      await registrarAuditoria(
        tx, remitoId, 'CREACION', usuarioId,
        total, `Remito ${input.TIPO} #${ptoVta}-${nroRemito} creado`
      );

      await tx.commit();
      return { REMITO_ID: remitoId, NRO_REMITO: nroRemito, PTO_VTA: ptoVta, TOTAL: total };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Anular remito (reverse stock) ──────────────
  async anular(id: number, usuarioId: number) {
    const pool = await getPool();
    await ensureRemitosTable(pool);
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT REMITO_ID, TIPO, TOTAL, ANULADO FROM REMITOS WHERE REMITO_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Remito no encontrado'), { name: 'ValidationError' });
      }
      if (existing.recordset[0].ANULADO) {
        throw Object.assign(new Error('El remito ya está anulado'), { name: 'ValidationError' });
      }

      const remito = existing.recordset[0];

      // Reverse stock
      const items = await tx.request()
        .input('remitoId', sql.Int, id)
        .query(`SELECT PRODUCTO_ID, CANTIDAD, DEPOSITO_ID FROM REMITOS_ITEMS WHERE REMITO_ID = @remitoId`);

      for (const item of items.recordset) {
        // Reverse: if it was ENTRADA, decrement; if SALIDA, increment
        if (remito.TIPO === 'ENTRADA') {
          await decrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID);
        } else {
          await incrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID);
        }
      }

      // Mark as anulado
      await tx.request()
        .input('id', sql.Int, id)
        .query(`UPDATE REMITOS SET ANULADO = 1 WHERE REMITO_ID = @id`);

      await registrarAuditoria(
        tx, id, 'ANULACION', usuarioId,
        remito.TOTAL, `Remito #${id} anulado`
      );

      await tx.commit();
      return { ok: true, REMITO_ID: id };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete remito ──────────────────────────────
  async delete(id: number, usuarioId: number) {
    const pool = await getPool();
    await ensureRemitosTable(pool);
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT REMITO_ID, TIPO, TOTAL, ANULADO FROM REMITOS WHERE REMITO_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Remito no encontrado'), { name: 'ValidationError' });
      }

      const remito = existing.recordset[0];

      // Reverse stock only if not already anulado
      if (!remito.ANULADO) {
        const items = await tx.request()
          .input('remitoId', sql.Int, id)
          .query(`SELECT PRODUCTO_ID, CANTIDAD, DEPOSITO_ID FROM REMITOS_ITEMS WHERE REMITO_ID = @remitoId`);

        for (const item of items.recordset) {
          if (remito.TIPO === 'ENTRADA') {
            await decrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID);
          } else {
            await incrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID);
          }
        }
      }

      // Delete items then remito
      await tx.request().input('remitoId', sql.Int, id)
        .query(`DELETE FROM REMITOS_ITEMS WHERE REMITO_ID = @remitoId`);
      await tx.request().input('id', sql.Int, id)
        .query(`DELETE FROM REMITOS WHERE REMITO_ID = @id`);

      await registrarAuditoria(
        tx, id, 'ELIMINACION', usuarioId,
        remito.TOTAL, `Remito #${id} eliminado`
      );

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Search products ────────────────────────────
  async searchProducts(search: string, limit: number = 20) {
    const pool = await getPool();

    const tokens = search.trim().split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return [];

    const tokenConditions = tokens.map((_, i) =>
      `(p.NOMBRE LIKE @t${i} OR p.CODIGOPARTICULAR LIKE @t${i}
        OR p.DESCRIPCION LIKE @t${i} OR cb.CODIGO_BARRAS LIKE @t${i}
        OR c.NOMBRE LIKE @t${i} OR m.NOMBRE LIKE @t${i})`
    ).join(' AND ');

    const req = pool.request();
    tokens.forEach((token, i) => req.input(`t${i}`, sql.NVarChar, `%${token}%`));
    req.input('limit', sql.Int, limit);

    const result = await req.query(`
      SELECT DISTINCT TOP (@limit)
        p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE,
        ISNULL(p.PRECIO_COMPRA, 0) AS PRECIO_COMPRA,
        ISNULL(p.LISTA_1, 0) AS PRECIO_VENTA,
        p.CANTIDAD AS STOCK,
        p.ES_CONJUNTO, p.ES_SERVICIO, p.DESCUENTA_STOCK, p.ACTIVO,
        p.UNIDAD_ID,
        ISNULL(u.NOMBRE, '') AS UNIDAD_NOMBRE,
        ISNULL(u.ABREVIACION, 'u') AS UNIDAD_ABREVIACION
      FROM PRODUCTOS p
      LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
      LEFT JOIN PRODUCTOS_COD_BARRAS cb ON p.PRODUCTO_ID = cb.PRODUCTO_ID
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
      WHERE p.ACTIVO = 1
        AND ${tokenConditions}
      ORDER BY p.NOMBRE
    `);

    return result.recordset;
  },

  // ── Advanced product search (for ProductSearchModal) ──
  async searchProductsAdvanced(params: {
    search?: string;
    marca?: string;
    categoria?: string;
    codigo?: string;
    soloActivos?: boolean;
    soloConStock?: boolean;
    limit?: number;
  }) {
    const pool = await getPool();
    const limit = params.limit || 50;

    const conditions: string[] = [];
    const req = pool.request();

    if (params.soloActivos !== false) {
      conditions.push('p.ACTIVO = 1');
    }

    if (params.soloConStock) {
      conditions.push('ISNULL(p.CANTIDAD, 0) > 0');
    }

    if (params.search) {
      const tokens = params.search.trim().split(/\s+/).filter(t => t.length > 0);
      tokens.forEach((token, i) => {
        conditions.push(
          `(p.NOMBRE LIKE @t${i} OR p.CODIGOPARTICULAR LIKE @t${i}
            OR p.DESCRIPCION LIKE @t${i} OR cb.CODIGO_BARRAS LIKE @t${i}
            OR c.NOMBRE LIKE @t${i} OR m.NOMBRE LIKE @t${i})`
        );
        req.input(`t${i}`, sql.NVarChar, `%${token}%`);
      });
    }

    if (params.marca) {
      conditions.push('m.NOMBRE LIKE @marca');
      req.input('marca', sql.NVarChar, `%${params.marca.trim()}%`);
    }

    if (params.categoria) {
      conditions.push('c.NOMBRE LIKE @categoria');
      req.input('categoria', sql.NVarChar, `%${params.categoria.trim()}%`);
    }

    if (params.codigo) {
      const codigo = params.codigo.trim();
      if (/^\d{6,}$/.test(codigo)) {
        conditions.push('cb.CODIGO_BARRAS = @codExact');
        req.input('codExact', sql.NVarChar, codigo);
      } else {
        conditions.push('(p.CODIGOPARTICULAR LIKE @cod OR cb.CODIGO_BARRAS LIKE @cod)');
        req.input('cod', sql.NVarChar, `%${codigo}%`);
      }
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    req.input('limit', sql.Int, limit);

    const result = await req.query(`
        SELECT DISTINCT TOP (@limit)
          p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE,
          ISNULL(m.NOMBRE, '') AS MARCA,
          ISNULL(c.NOMBRE, '') AS CATEGORIA,
          CASE
            WHEN ISNULL(p.PRECIO_COMPRA_BASE, 0) > 0 THEN p.PRECIO_COMPRA_BASE
            ELSE ISNULL(p.PRECIO_COMPRA, 0)
          END AS PRECIO_COMPRA,
          ISNULL(p.LISTA_1, 0) AS PRECIO_VENTA,
          p.CANTIDAD AS STOCK,
          p.ES_CONJUNTO, p.ES_SERVICIO, p.DESCUENTA_STOCK,
          ISNULL(p.IMP_INT, 0) AS IMP_INT,
          p.TASA_IVA_ID, p.UNIDAD_ID,
          ISNULL(u.NOMBRE, '') AS UNIDAD_NOMBRE,
          ISNULL(u.ABREVIACION, 'u') AS UNIDAD_ABREVIACION,
          ISNULL(ti.PORCENTAJE, 0) AS IVA_PORCENTAJE
        FROM PRODUCTOS p
        LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
        LEFT JOIN TASAS_IMPUESTOS ti ON p.TASA_IVA_ID = ti.TASA_ID
        LEFT JOIN PRODUCTOS_COD_BARRAS cb ON p.PRODUCTO_ID = cb.PRODUCTO_ID
        LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
        LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
        ${whereClause}
        ORDER BY p.NOMBRE
      `);

    return result.recordset;
  },

  // ── Clientes ───────────────────────────────────
  async getClientes() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CLIENTE_ID, CODIGOPARTICULAR, NOMBRE,
             TIPO_DOCUMENTO, NUMERO_DOC, DOMICILIO, CONDICION_IVA
      FROM CLIENTES WHERE ACTIVO = 1 ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Proveedores ────────────────────────────────
  async getProveedores() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT PROVEEDOR_ID, CODIGOPARTICULAR, NOMBRE,
             TIPO_DOCUMENTO, NUMERO_DOC, DIRECCION
      FROM PROVEEDORES WHERE ACTIVO = 1 ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Depositos ──────────────────────────────────
  async getDepositos() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT DEPOSITO_ID, CODIGOPARTICULAR, NOMBRE FROM DEPOSITOS ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Company data for PDF ───────────────────────
  async getEmpresaData() {
    const pool = await getPool();
    const empresa: any = {};

    // Get data from EMPRESA table
    try {
      const result = await pool.request().query(`
        SELECT TOP 1
          ISNULL(RAZON_SOCIAL, '') AS RAZON_SOCIAL,
          ISNULL(NOMBRE_FANTASIA, '') AS NOMBRE_FANTASIA,
          ISNULL(DOMICILIO, '') AS DOMICILIO,
          ISNULL(CUIT, '') AS CUIT,
          ISNULL(INGRESOS_BRUTOS, '') AS INGRESOS_BRUTOS,
          ISNULL(CONDICION_IVA, '') AS CONDICION_IVA,
          ISNULL(INICIO_ACTIVIDADES, '') AS INICIO_ACTIVIDADES,
          ISNULL(LOCALIDAD, '') AS LOCALIDAD
        FROM EMPRESA
      `);
      Object.assign(empresa, result.recordset[0] || {});
    } catch { /* EMPRESA table may not exist */ }

    // Get PUNTO_VENTA, RAZON_SOCIAL, DOMICILIO_FISCAL, CONDICION_IVA from EMPRESA_CLIENTE
    try {
      const pvResult = await pool.request().query(`
        SELECT TOP 1
          PUNTO_VENTA,
          ISNULL(RAZON_SOCIAL, '') AS EC_RAZON_SOCIAL,
          ISNULL(DOMICILIO_FISCAL, '') AS EC_DOMICILIO,
          ISNULL(CONDICION_IVA, '') AS EC_CONDICION_IVA,
          ISNULL(CUIT, '') AS EC_CUIT
        FROM EMPRESA_CLIENTE
      `);
      const ec = pvResult.recordset[0];
      if (ec) {
        empresa.PUNTO_VENTA = ec.PUNTO_VENTA?.toString() || '';
        if (ec.EC_RAZON_SOCIAL) empresa.RAZON_SOCIAL = ec.EC_RAZON_SOCIAL;
        if (ec.EC_DOMICILIO) empresa.DOMICILIO = ec.EC_DOMICILIO;
        if (ec.EC_CONDICION_IVA) empresa.CONDICION_IVA = ec.EC_CONDICION_IVA;
        if (ec.EC_CUIT) empresa.CUIT = ec.EC_CUIT;
      }
    } catch {
      empresa.PUNTO_VENTA = '';
    }

    return empresa;
  },
};
