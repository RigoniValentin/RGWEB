import { getPool, sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  NC Compras Service — Credit Notes for Purchases
//  Matches REAL desktop SesamoDB schema
// ═══════════════════════════════════════════════════
//
// Tables (desktop):
// ┌──────────────────────────────────────────────────────────┐
// │ NC_COMPRAS: NC_ID (manual PK), COMPRA_ID, MONTO,        │
// │   DESCUENTO, FECHA, MOTIVO, MEDIO_PAGO, DESCRIPCION,    │
// │   ANULADA, NUMERO_FISCAL, CAE, PUNTO_VENTA,             │
// │   TIPO_COMPROBANTE, PROVEEDOR_ID                        │
// │ Web extensions: USUARIO_ID, PUNTO_VENTA_ID, DESTINO_PAGO│
// ├──────────────────────────────────────────────────────────┤
// │ NC_COMPRAS_ITEMS: NC_ITEM_ID (identity), NC_ID,         │
// │   COMPRA_ID, PRODUCTO_ID, CANTIDAD_DEVUELTA,            │
// │   PRECIO_COMPRA, DEPOSITO_ID                            │
// ├──────────────────────────────────────────────────────────┤
// │ NC_COMPRAS_HISTORIAL: HISTORIAL_ID (identity), COMPRA_ID│
// │   NC_ID, FECHA, PRODUCTO_ID, CANTIDAD_ORIGINAL,         │
// │   CANTIDAD_MODIFICADO, PRECIO_ORIGINAL, PRECIO_MODIFICADO│
// │   TOTAL_PRODUCTO_ORIGINAL, TOTAL_PRODUCTO_MODIFICADO,   │
// │   TOTAL_COMPRA_ORIGINAL, TOTAL_COMPRA_MODIFICADO,       │
// │   MOTIVO, DEPOSITO_ID                                   │
// ├──────────────────────────────────────────────────────────┤
// │ ND_COMPRAS: ND_ID (identity), COMPRA_ID, MONTO, FECHA,  │
// │   MOTIVO, MEDIO_PAGO, DESCRIPCION, ANULADA,             │
// │   NUMERO_FISCAL, CAE, PUNTO_VENTA, TIPO_COMPROBANTE,    │
// │   PROVEEDOR_ID                                          │
// │ Web extensions: NC_ID, USUARIO_ID, PUNTO_VENTA_ID       │
// └──────────────────────────────────────────────────────────┘

// ── Interfaces ──────────────────────────────────

export interface NCCompraFilter {
  proveedorId?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  motivo?: string;
  anulada?: boolean;
}

export interface NCCompraItemInput {
  PRODUCTO_ID: number;
  CANTIDAD_DEVUELTA: number;
  PRECIO_COMPRA: number;
  DEPOSITO_ID?: number | null;
}

export interface NCCompraInput {
  COMPRA_ID: number;
  PROVEEDOR_ID: number;
  MOTIVO: 'POR DEVOLUCION' | 'POR ANULACION' | 'POR DESCUENTO' | 'POR DIFERENCIA PRECIO';
  MEDIO_PAGO: 'CN' | 'CC';
  MONTO?: number;
  DESCUENTO?: number;
  DESCRIPCION?: string;
  PUNTO_VENTA_ID?: number;
  DESTINO_PAGO?: 'CAJA_CENTRAL' | 'CAJA';
  items?: NCCompraItemInput[];
}

// ── Helpers ─────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function validationError(msg: string): Error {
  const err = new Error(msg);
  err.name = 'ValidationError';
  return err;
}

async function getCajaAbiertaTx(
  tx: any,
  usuarioId: number
): Promise<{ CAJA_ID: number; PUNTO_VENTA_ID: number | null } | null> {
  const result = await tx.request()
    .input('uid', sql.Int, usuarioId)
    .query(`SELECT CAJA_ID, PUNTO_VENTA_ID FROM CAJA WHERE USUARIO_ID = @uid AND ESTADO = 'ACTIVA'`);
  return result.recordset.length > 0 ? result.recordset[0] : null;
}

// ── Stock helpers (mirror purchases.service) ────

async function decrementarStockTx(
  tx: any,
  productoId: number,
  cantidad: number,
  depositoId: number | null
) {
  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query('SELECT DESCUENTA_STOCK FROM PRODUCTOS WHERE PRODUCTO_ID = @pid');
  if (!prod.recordset.length || !prod.recordset[0].DESCUENTA_STOCK) return;

  // Main stock
  await tx.request()
    .input('pid', sql.Int, productoId)
    .input('cant', sql.Decimal(18, 2), cantidad)
    .query('UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @pid');

  // Deposit stock
  if (depositoId) {
    const dep = await tx.request()
      .input('pid', sql.Int, productoId)
      .input('did', sql.Int, depositoId)
      .query('SELECT CANTIDAD FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did');
    if (dep.recordset.length > 0) {
      await tx.request()
        .input('pid', sql.Int, productoId)
        .input('did', sql.Int, depositoId)
        .input('cant', sql.Decimal(18, 2), cantidad)
        .query('UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did');
    }
  }
}

async function incrementarStockTx(
  tx: any,
  productoId: number,
  cantidad: number,
  depositoId: number | null
) {
  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query('SELECT DESCUENTA_STOCK FROM PRODUCTOS WHERE PRODUCTO_ID = @pid');
  if (!prod.recordset.length || !prod.recordset[0].DESCUENTA_STOCK) return;

  await tx.request()
    .input('pid', sql.Int, productoId)
    .input('cant', sql.Decimal(18, 2), cantidad)
    .query('UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @pid');

  if (depositoId) {
    const dep = await tx.request()
      .input('pid', sql.Int, productoId)
      .input('did', sql.Int, depositoId)
      .query('SELECT CANTIDAD FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did');
    if (dep.recordset.length > 0) {
      await tx.request()
        .input('pid', sql.Int, productoId)
        .input('did', sql.Int, depositoId)
        .input('cant', sql.Decimal(18, 2), cantidad)
        .query('UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did');
    } else {
      await tx.request()
        .input('pid', sql.Int, productoId)
        .input('did', sql.Int, depositoId)
        .input('cant', sql.Decimal(18, 2), cantidad)
        .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@pid, @did, @cant)');
    }
  }
}

// ══════════════════════════════════════════════════
//  Auto-migration: ensure COMPRAS.ANULADA exists
// ══════════════════════════════════════════════════

let _migrationDone = false;
async function ensureMigrations() {
  if (_migrationDone) return;
  const pool = await getPool();
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'COMPRAS' AND COLUMN_NAME = 'ANULADA')
      ALTER TABLE COMPRAS ADD ANULADA BIT NOT NULL DEFAULT 0;
  `);
  _migrationDone = true;
}

// ══════════════════════════════════════════════════
//  Service
// ══════════════════════════════════════════════════

export const ncComprasService = {

  // ── List all NCs ────────────────────────────────
  async getAll(filter: NCCompraFilter) {
    const pool = await getPool();
    const req = pool.request();
    const conditions: string[] = [];

    if (filter.proveedorId) {
      req.input('provId', sql.Int, filter.proveedorId);
      conditions.push('nc.PROVEEDOR_ID = @provId');
    }
    if (filter.fechaDesde) {
      req.input('fDesde', sql.VarChar(10), filter.fechaDesde);
      conditions.push('nc.FECHA >= @fDesde');
    }
    if (filter.fechaHasta) {
      req.input('fHasta', sql.VarChar(10), filter.fechaHasta);
      conditions.push('nc.FECHA <= DATEADD(DAY, 1, CAST(@fHasta AS DATE))');
    }
    if (filter.motivo) {
      req.input('motivo', sql.NVarChar(100), filter.motivo);
      conditions.push('nc.MOTIVO = @motivo');
    }
    if (filter.anulada !== undefined) {
      req.input('anulada', sql.Bit, filter.anulada ? 1 : 0);
      conditions.push('nc.ANULADA = @anulada');
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await req.query(`
      SELECT
        nc.NC_ID,
        nc.COMPRA_ID,
        nc.PROVEEDOR_ID,
        nc.FECHA,
        nc.MOTIVO,
        nc.MEDIO_PAGO,
        nc.MONTO,
        nc.DESCUENTO,
        nc.DESCRIPCION,
        nc.ANULADA,
        nc.DESTINO_PAGO,
        nc.USUARIO_ID,
        nc.PUNTO_VENTA_ID,
        p.NOMBRE AS PROVEEDOR_NOMBRE,
        u.NOMBRE AS USUARIO_NOMBRE
      FROM NC_COMPRAS nc
      LEFT JOIN PROVEEDORES p ON p.PROVEEDOR_ID = nc.PROVEEDOR_ID
      LEFT JOIN USUARIOS u ON u.USUARIO_ID = nc.USUARIO_ID
      ${where}
      ORDER BY nc.FECHA DESC, nc.NC_ID DESC
    `);

    return result.recordset;
  },

  // ── Get NC detail by ID ─────────────────────────
  async getById(id: number) {
    const pool = await getPool();

    const header = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT
          nc.NC_ID,
          nc.COMPRA_ID,
          nc.PROVEEDOR_ID,
          nc.FECHA,
          nc.MOTIVO,
          nc.MEDIO_PAGO,
          nc.MONTO,
          nc.DESCUENTO,
          nc.DESCRIPCION,
          nc.ANULADA,
          nc.DESTINO_PAGO,
          nc.USUARIO_ID,
          nc.PUNTO_VENTA_ID,
          p.NOMBRE AS PROVEEDOR_NOMBRE,
          u.NOMBRE AS USUARIO_NOMBRE
        FROM NC_COMPRAS nc
        LEFT JOIN PROVEEDORES p ON p.PROVEEDOR_ID = nc.PROVEEDOR_ID
        LEFT JOIN USUARIOS u ON u.USUARIO_ID = nc.USUARIO_ID
        WHERE nc.NC_ID = @id
      `);
    if (header.recordset.length === 0) {
      throw validationError(`Nota de Crédito #${id} no encontrada`);
    }

    const items = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT
          i.NC_ITEM_ID,
          i.NC_ID,
          i.COMPRA_ID,
          i.PRODUCTO_ID,
          i.CANTIDAD_DEVUELTA,
          i.PRECIO_COMPRA,
          i.DEPOSITO_ID,
          pr.NOMBRE AS PRODUCTO_NOMBRE,
          pr.CODIGOPARTICULAR AS PRODUCTO_CODIGO,
          u.ABREVIACION AS UNIDAD_ABREVIACION
        FROM NC_COMPRAS_ITEMS i
        JOIN PRODUCTOS pr ON pr.PRODUCTO_ID = i.PRODUCTO_ID
        LEFT JOIN UNIDADES_MEDIDA u ON u.UNIDAD_ID = pr.UNIDAD_ID
        WHERE i.NC_ID = @id
      `);

    return {
      ...header.recordset[0],
      items: items.recordset,
    };
  },

  // ── Purchases available for NC ──────────────────
  async getComprasParaNC(proveedorId: number, fechaDesde?: string, fechaHasta?: string) {
    const pool = await getPool();
    const req = pool.request();
    req.input('provId', sql.Int, proveedorId);

    const dateConds: string[] = [];
    if (fechaDesde) {
      req.input('fDesde', sql.VarChar(10), fechaDesde);
      dateConds.push('c.FECHA_COMPRA >= @fDesde');
    }
    if (fechaHasta) {
      req.input('fHasta', sql.VarChar(10), fechaHasta);
      dateConds.push('c.FECHA_COMPRA <= DATEADD(DAY, 1, CAST(@fHasta AS DATE))');
    }
    const dateWhere = dateConds.length > 0 ? `AND ${dateConds.join(' AND ')}` : '';

    const result = await req.query(`
      SELECT
        c.COMPRA_ID,
        c.FECHA_COMPRA,
        c.TOTAL,
        c.TIPO_COMPROBANTE,
        c.PTO_VTA,
        c.NRO_COMPROBANTE,
        c.ES_CTA_CORRIENTE,
        c.COBRADA,
        c.PRECIOS_SIN_IVA,
        p.NOMBRE AS PROVEEDOR_NOMBRE
      FROM COMPRAS c
      LEFT JOIN PROVEEDORES p ON p.PROVEEDOR_ID = c.PROVEEDOR_ID
      WHERE c.PROVEEDOR_ID = @provId
        AND c.ANULADA = 0
        ${dateWhere}
      ORDER BY c.FECHA_COMPRA DESC
    `);
    return result.recordset;
  },

  // ── Items from a purchase for devolution grid ───
  async getItemsCompra(compraId: number) {
    const pool = await getPool();
    const result = await pool.request()
      .input('cid', sql.Int, compraId)
      .query(`
        SELECT
          ci.COMPRA_ID,
          ci.PRODUCTO_ID,
          ci.PRECIO_COMPRA,
          ci.CANTIDAD,
          ci.TOTAL_PRODUCTO,
          ci.DEPOSITO_ID,
          ci.PORCENTAJE_DESCUENTO,
          ci.DESCUENTO_IMPORTE,
          pr.NOMBRE   AS PRODUCTO_NOMBRE,
          pr.CODIGOPARTICULAR AS PRODUCTO_CODIGO,
          u.ABREVIACION AS UNIDAD_ABREVIACION,
          ISNULL((
            SELECT SUM(nci.CANTIDAD_DEVUELTA)
            FROM NC_COMPRAS_ITEMS nci
            JOIN NC_COMPRAS nc ON nc.NC_ID = nci.NC_ID
            WHERE nci.COMPRA_ID = ci.COMPRA_ID
              AND nci.PRODUCTO_ID = ci.PRODUCTO_ID
              AND nc.ANULADA = 0
          ), 0) AS CANTIDAD_YA_DEVUELTA
        FROM COMPRAS_ITEMS ci
        JOIN PRODUCTOS pr ON pr.PRODUCTO_ID = ci.PRODUCTO_ID
        LEFT JOIN UNIDADES_MEDIDA u ON u.UNIDAD_ID = pr.UNIDAD_ID
        WHERE ci.COMPRA_ID = @cid
      `);
    return result.recordset;
  },

  // ── Check if NCs exist for a purchase ───────────
  async existeNCParaCompra(compraId: number) {
    const pool = await getPool();
    const result = await pool.request()
      .input('cid', sql.Int, compraId)
      .query(`
        SELECT NC_ID, MONTO, MOTIVO, ANULADA, FECHA
        FROM NC_COMPRAS
        WHERE COMPRA_ID = @cid
        ORDER BY FECHA DESC
      `);
    return {
      existe: result.recordset.length > 0,
      notas: result.recordset,
    };
  },

  // ── Create NC ───────────────────────────────────
  async create(input: NCCompraInput, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // 1) Validate purchase exists
      const compraRes = await tx.request()
        .input('cid', sql.Int, input.COMPRA_ID)
        .query(`
          SELECT c.COMPRA_ID, c.TOTAL, c.PROVEEDOR_ID, c.ES_CTA_CORRIENTE, c.COBRADA,
                 c.ANULADA
          FROM COMPRAS c
          WHERE c.COMPRA_ID = @cid
        `);
      if (compraRes.recordset.length === 0) {
        throw validationError('La compra indicada no existe');
      }
      const compra = compraRes.recordset[0];
      if (compra.ANULADA) {
        throw validationError('No se puede crear NC sobre una compra anulada');
      }

      // 2) Calculate amount based on motivo
      let monto: number;
      const motivo = input.MOTIVO;
      const esConItems = motivo === 'POR DEVOLUCION' || motivo === 'POR ANULACION';

      if (esConItems) {
        if (!input.items || input.items.length === 0) {
          throw validationError('Se requieren ítems para este tipo de NC');
        }
        // Validate amounts
        const compraItems = await tx.request()
          .input('cid', sql.Int, input.COMPRA_ID)
          .query(`
            SELECT ci.PRODUCTO_ID, ci.CANTIDAD, ci.PRECIO_COMPRA, ci.TOTAL_PRODUCTO, ci.DEPOSITO_ID
            FROM COMPRAS_ITEMS ci
            WHERE ci.COMPRA_ID = @cid
          `);
        const ciMap = new Map(compraItems.recordset.map((r: any) => [r.PRODUCTO_ID, r]));

        for (const item of input.items) {
          const ci = ciMap.get(item.PRODUCTO_ID) as any;
          if (!ci) throw validationError(`Producto ID ${item.PRODUCTO_ID} no pertenece a la compra`);

          // Check already returned quantities
          const alreadyDev = await tx.request()
            .input('cid', sql.Int, input.COMPRA_ID)
            .input('pid', sql.Int, item.PRODUCTO_ID)
            .query(`
              SELECT ISNULL(SUM(nci.CANTIDAD_DEVUELTA), 0) AS ya
              FROM NC_COMPRAS_ITEMS nci
              JOIN NC_COMPRAS nc ON nc.NC_ID = nci.NC_ID
              WHERE nci.COMPRA_ID = @cid AND nci.PRODUCTO_ID = @pid AND nc.ANULADA = 0
            `);
          const ya = alreadyDev.recordset[0].ya;
          const disponible = r2(ci.CANTIDAD - ya);
          if (item.CANTIDAD_DEVUELTA > disponible + 0.001) {
            throw validationError(
              `Producto ${item.PRODUCTO_ID}: cantidad a devolver (${item.CANTIDAD_DEVUELTA}) supera disponible (${disponible})`
            );
          }
        }

        monto = r2(input.items.reduce((s, it) => s + r2(it.CANTIDAD_DEVUELTA * it.PRECIO_COMPRA), 0));
      } else {
        // POR DESCUENTO / POR DIFERENCIA PRECIO
        if (!input.MONTO || input.MONTO <= 0) {
          throw validationError('Debe indicar un monto para este tipo de NC');
        }
        monto = r2(input.MONTO);
      }

      // 3) Get caja info for web extensions
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      const puntoVentaId = input.PUNTO_VENTA_ID ?? caja?.PUNTO_VENTA_ID ?? null;

      // 4) Insert NC_COMPRAS (let DB handle IDENTITY for NC_ID)
      const ncInsert = await tx.request()
        .input('compraId', sql.Int, input.COMPRA_ID)
        .input('monto', sql.Decimal(18, 2), monto)
        .input('descuento', sql.Decimal(18, 2), input.DESCUENTO ?? null)
        .input('fecha', sql.DateTime, new Date())
        .input('motivo', sql.NVarChar(100), input.MOTIVO)
        .input('medioPago', sql.NVarChar(100), input.MEDIO_PAGO)
        .input('descripcion', sql.NVarChar(250), input.DESCRIPCION ?? null)
        .input('anulada', sql.Bit, 0)
        .input('proveedorId', sql.Int, input.PROVEEDOR_ID)
        .input('usuarioId', sql.Int, usuarioId)
        .input('puntoVentaId', sql.Int, puntoVentaId)
        .input('destinoPago', sql.NVarChar(20), input.DESTINO_PAGO ?? null)
        .query(`
          INSERT INTO NC_COMPRAS (
            COMPRA_ID, MONTO, DESCUENTO, FECHA, MOTIVO, MEDIO_PAGO,
            DESCRIPCION, ANULADA, NUMERO_FISCAL, CAE, PUNTO_VENTA, TIPO_COMPROBANTE,
            PROVEEDOR_ID, USUARIO_ID, PUNTO_VENTA_ID, DESTINO_PAGO
          )
          OUTPUT INSERTED.NC_ID
          VALUES (
            @compraId, @monto, @descuento, @fecha, @motivo, @medioPago,
            @descripcion, @anulada, NULL, NULL, NULL, NULL,
            @proveedorId, @usuarioId, @puntoVentaId, @destinoPago
          )
        `);
      const ncId: number = ncInsert.recordset[0].NC_ID;

      // 6) Store total BEFORE NC for historial
      const totalCompraOriginal = compra.TOTAL;

      // 7) Items + Historial + Stock
      if (esConItems && input.items) {
        for (const item of input.items) {
          // Get original purchase item data
          const ciRes = await tx.request()
            .input('cid', sql.Int, input.COMPRA_ID)
            .input('pid', sql.Int, item.PRODUCTO_ID)
            .query(`
              SELECT CANTIDAD, PRECIO_COMPRA, TOTAL_PRODUCTO, DEPOSITO_ID
              FROM COMPRAS_ITEMS
              WHERE COMPRA_ID = @cid AND PRODUCTO_ID = @pid
            `);
          const ci = ciRes.recordset[0];
          const depId = item.DEPOSITO_ID ?? ci.DEPOSITO_ID ?? null;

          // Insert NC item
          await tx.request()
            .input('ncId', sql.Int, ncId)
            .input('compraId', sql.Int, input.COMPRA_ID)
            .input('productoId', sql.Int, item.PRODUCTO_ID)
            .input('cantDevuelta', sql.Decimal(18, 2), item.CANTIDAD_DEVUELTA)
            .input('precioCompra', sql.Decimal(18, 2), item.PRECIO_COMPRA)
            .input('depositoId', sql.Int, depId)
            .query(`
              INSERT INTO NC_COMPRAS_ITEMS (NC_ID, COMPRA_ID, PRODUCTO_ID, CANTIDAD_DEVUELTA, PRECIO_COMPRA, DEPOSITO_ID)
              VALUES (@ncId, @compraId, @productoId, @cantDevuelta, @precioCompra, @depositoId)
            `);

          // Calculate modified values
          const cantidadModificada = r2(ci.CANTIDAD - item.CANTIDAD_DEVUELTA);
          const totalProductoModificado = r2(cantidadModificada * ci.PRECIO_COMPRA);
          const totalCompraModificado = r2(totalCompraOriginal - monto);

          // Insert historial row (per item, desktop-compatible)
          await tx.request()
            .input('compraId', sql.Int, input.COMPRA_ID)
            .input('ncId', sql.Int, ncId)
            .input('fecha', sql.DateTime, new Date())
            .input('productoId', sql.Int, item.PRODUCTO_ID)
            .input('cantOriginal', sql.Decimal(18, 2), ci.CANTIDAD)
            .input('cantModificado', sql.Decimal(18, 2), cantidadModificada)
            .input('precioOriginal', sql.Decimal(18, 2), ci.PRECIO_COMPRA)
            .input('precioModificado', sql.Decimal(18, 2), ci.PRECIO_COMPRA)
            .input('totalProdOriginal', sql.Decimal(18, 2), ci.TOTAL_PRODUCTO)
            .input('totalProdModificado', sql.Decimal(18, 2), totalProductoModificado)
            .input('totalCompraOriginal', sql.Decimal(18, 2), totalCompraOriginal)
            .input('totalCompraModificado', sql.Decimal(18, 2), totalCompraModificado)
            .input('motivo', sql.VarChar(50), input.MOTIVO)
            .input('depositoId', sql.Int, depId)
            .query(`
              INSERT INTO NC_COMPRAS_HISTORIAL (
                COMPRA_ID, NC_ID, FECHA, PRODUCTO_ID,
                CANTIDAD_ORIGINAL, CANTIDAD_MODIFICADO,
                PRECIO_ORIGINAL, PRECIO_MODIFICADO,
                TOTAL_PRODUCTO_ORIGINAL, TOTAL_PRODUCTO_MODIFICADO,
                TOTAL_COMPRA_ORIGINAL, TOTAL_COMPRA_MODIFICADO,
                MOTIVO, DEPOSITO_ID
              ) VALUES (
                @compraId, @ncId, @fecha, @productoId,
                @cantOriginal, @cantModificado,
                @precioOriginal, @precioModificado,
                @totalProdOriginal, @totalProdModificado,
                @totalCompraOriginal, @totalCompraModificado,
                @motivo, @depositoId
              )
            `);

          // Decrement stock (devolution = product comes back, but for purchases devolution means
          // we returned goods to supplier → decrease OUR stock)
          await decrementarStockTx(tx, item.PRODUCTO_ID, item.CANTIDAD_DEVUELTA, depId);
        }
      } else {
        // For DESCUENTO / DIFERENCIA PRECIO — no items, just a single historial entry
        const totalCompraModificado = r2(totalCompraOriginal - monto);
        await tx.request()
          .input('compraId', sql.Int, input.COMPRA_ID)
          .input('ncId', sql.Int, ncId)
          .input('fecha', sql.DateTime, new Date())
          .input('productoId', sql.Int, 0)
          .input('cantOriginal', sql.Decimal(18, 2), 0)
          .input('cantModificado', sql.Decimal(18, 2), 0)
          .input('precioOriginal', sql.Decimal(18, 2), 0)
          .input('precioModificado', sql.Decimal(18, 2), 0)
          .input('totalProdOriginal', sql.Decimal(18, 2), 0)
          .input('totalProdModificado', sql.Decimal(18, 2), 0)
          .input('totalCompraOriginal', sql.Decimal(18, 2), totalCompraOriginal)
          .input('totalCompraModificado', sql.Decimal(18, 2), totalCompraModificado)
          .input('motivo', sql.VarChar(50), input.MOTIVO)
          .input('depositoId', sql.Int, null)
          .query(`
            INSERT INTO NC_COMPRAS_HISTORIAL (
              COMPRA_ID, NC_ID, FECHA, PRODUCTO_ID,
              CANTIDAD_ORIGINAL, CANTIDAD_MODIFICADO,
              PRECIO_ORIGINAL, PRECIO_MODIFICADO,
              TOTAL_PRODUCTO_ORIGINAL, TOTAL_PRODUCTO_MODIFICADO,
              TOTAL_COMPRA_ORIGINAL, TOTAL_COMPRA_MODIFICADO,
              MOTIVO, DEPOSITO_ID
            ) VALUES (
              @compraId, @ncId, @fecha, @productoId,
              @cantOriginal, @cantModificado,
              @precioOriginal, @precioModificado,
              @totalProdOriginal, @totalProdModificado,
              @totalCompraOriginal, @totalCompraModificado,
              @motivo, @depositoId
            )
          `);
      }

      // 8) Update purchase total
      await tx.request()
        .input('cid', sql.Int, input.COMPRA_ID)
        .input('monto', sql.Decimal(18, 2), monto)
        .query('UPDATE COMPRAS SET TOTAL = TOTAL - @monto WHERE COMPRA_ID = @cid');

      // 9) Handle payment side-effects (CC balance / Caja)
      if (input.MEDIO_PAGO === 'CC') {
        // Credit Cuenta Corriente Proveedor (reduce debt)
        await tx.request()
          .input('provId', sql.Int, input.PROVEEDOR_ID)
          .input('monto', sql.Decimal(18, 2), monto)
          .query('UPDATE PROVEEDORES SET SALDO_CC = ISNULL(SALDO_CC, 0) - @monto WHERE PROVEEDOR_ID = @provId');
      } else if (input.MEDIO_PAGO === 'CN') {
        // Register movement in caja if open
        if (caja) {
          const destino = input.DESTINO_PAGO ?? 'CAJA';
          if (destino === 'CAJA') {
            await tx.request()
              .input('cajaId', sql.Int, caja.CAJA_ID)
              .input('origenTipo', sql.VarChar(30), 'NC_COMPRA')
              .input('efectivo', sql.Decimal(18, 2), monto)
              .input('descr', sql.NVarChar(255), `NC Compra #${ncId} - ${input.MOTIVO}`)
              .input('uid', sql.Int, usuarioId)
              .query(`
                INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
                VALUES (@cajaId, GETDATE(), @origenTipo, @efectivo, 0, @descr, @uid)
              `);
          } else {
            // CAJA_CENTRAL
            await tx.request()
              .input('tipoEntidad', sql.VarChar(20), 'NC_COMPRA')
              .input('movimiento', sql.NVarChar(500), `NC Compra #${ncId} - ${input.MOTIVO}`)
              .input('uid', sql.Int, usuarioId)
              .input('efectivo', sql.Decimal(18, 2), monto)
              .input('pvId', sql.Int, puntoVentaId)
              .query(`
                INSERT INTO MOVIMIENTOS_CAJA (TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
                VALUES (@tipoEntidad, @movimiento, @uid, @efectivo, 0, 0, 0, @efectivo, @pvId, 0)
              `);
          }
        }
      }

      await tx.commit();
      return { NC_ID: ncId, MONTO: monto };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Void NC (generates ND) ─────────────────────
  async anular(ncId: number, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // 1) Fetch NC
      const ncRes = await tx.request()
        .input('ncId', sql.Int, ncId)
        .query(`
          SELECT NC_ID, COMPRA_ID, MONTO, MOTIVO, MEDIO_PAGO, PROVEEDOR_ID,
                 ANULADA, DESCRIPCION, DESTINO_PAGO
          FROM NC_COMPRAS
          WHERE NC_ID = @ncId
        `);
      if (ncRes.recordset.length === 0) {
        throw validationError('NC no encontrada');
      }
      const nc = ncRes.recordset[0];
      if (nc.ANULADA) {
        throw validationError('Esta NC ya fue anulada');
      }

      // 2) Mark NC as voided
      await tx.request()
        .input('ncId', sql.Int, ncId)
        .query('UPDATE NC_COMPRAS SET ANULADA = 1 WHERE NC_ID = @ncId');

      // 3) Insert ND_COMPRAS (Nota de Débito — reversal)
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      const puntoVentaId = caja?.PUNTO_VENTA_ID ?? null;

      const ndRes = await tx.request()
        .input('compraId', sql.Int, nc.COMPRA_ID)
        .input('monto', sql.Decimal(18, 2), nc.MONTO)
        .input('fecha', sql.DateTime, new Date())
        .input('motivo', sql.NVarChar(100), `Anulación NC #${ncId}`)
        .input('medioPago', sql.NVarChar(100), nc.MEDIO_PAGO)
        .input('descripcion', sql.NVarChar(250), `Anulación automática de NC #${ncId}`)
        .input('anulada', sql.Bit, 0)
        .input('proveedorId', sql.Int, nc.PROVEEDOR_ID)
        .input('ncId', sql.Int, ncId)
        .input('usuarioId', sql.Int, usuarioId)
        .input('puntoVentaId', sql.Int, puntoVentaId)
        .query(`
          INSERT INTO ND_COMPRAS (
            COMPRA_ID, MONTO, FECHA, MOTIVO, MEDIO_PAGO, DESCRIPCION, ANULADA,
            NUMERO_FISCAL, CAE, PUNTO_VENTA, TIPO_COMPROBANTE,
            PROVEEDOR_ID, NC_ID, USUARIO_ID, PUNTO_VENTA_ID
          )
          OUTPUT INSERTED.ND_ID
          VALUES (
            @compraId, @monto, @fecha, @motivo, @medioPago, @descripcion, @anulada,
            NULL, NULL, NULL, NULL,
            @proveedorId, @ncId, @usuarioId, @puntoVentaId
          )
        `);
      const ndId = ndRes.recordset[0].ND_ID;

      // 4) Restore purchase total
      await tx.request()
        .input('cid', sql.Int, nc.COMPRA_ID)
        .input('monto', sql.Decimal(18, 2), nc.MONTO)
        .query('UPDATE COMPRAS SET TOTAL = TOTAL + @monto WHERE COMPRA_ID = @cid');

      // 5) Reverse stock if devolution/anulacion
      const esConItems = nc.MOTIVO === 'POR DEVOLUCION' || nc.MOTIVO === 'POR ANULACION';
      if (esConItems) {
        const ncItems = await tx.request()
          .input('ncId', sql.Int, ncId)
          .query(`
            SELECT PRODUCTO_ID, CANTIDAD_DEVUELTA, DEPOSITO_ID
            FROM NC_COMPRAS_ITEMS
            WHERE NC_ID = @ncId
          `);
        for (const item of ncItems.recordset) {
          await incrementarStockTx(tx, item.PRODUCTO_ID, parseFloat(item.CANTIDAD_DEVUELTA), item.DEPOSITO_ID);
        }
      }

      // 6) Reverse payment effects
      if (nc.MEDIO_PAGO === 'CC') {
        await tx.request()
          .input('provId', sql.Int, nc.PROVEEDOR_ID)
          .input('monto', sql.Decimal(18, 2), nc.MONTO)
          .query('UPDATE PROVEEDORES SET SALDO_CC = ISNULL(SALDO_CC, 0) + @monto WHERE PROVEEDOR_ID = @provId');
      } else if (nc.MEDIO_PAGO === 'CN') {
        if (caja) {
          const destino = nc.DESTINO_PAGO ?? 'CAJA';
          if (destino === 'CAJA') {
            await tx.request()
              .input('cajaId', sql.Int, caja.CAJA_ID)
              .input('origenTipo', sql.VarChar(30), 'ND_COMPRA')
              .input('efectivo', sql.Decimal(18, 2), -nc.MONTO)
              .input('descr', sql.NVarChar(255), `ND (anulación NC #${ncId})`)
              .input('uid', sql.Int, usuarioId)
              .query(`
                INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
                VALUES (@cajaId, GETDATE(), @origenTipo, @efectivo, 0, @descr, @uid)
              `);
          } else {
            await tx.request()
              .input('tipoEntidad', sql.VarChar(20), 'ND_COMPRA')
              .input('movimiento', sql.NVarChar(500), `ND (anulación NC #${ncId})`)
              .input('uid', sql.Int, usuarioId)
              .input('efectivo', sql.Decimal(18, 2), -nc.MONTO)
              .input('pvId', sql.Int, puntoVentaId)
              .query(`
                INSERT INTO MOVIMIENTOS_CAJA (TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
                VALUES (@tipoEntidad, @movimiento, @uid, @efectivo, 0, 0, 0, @efectivo, @pvId, 0)
              `);
          }
        }
      }

      await tx.commit();
      return { ND_ID: ndId, NC_ID: ncId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },
};
