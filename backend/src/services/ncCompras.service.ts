import { getPool, sql } from '../database/connection.js';
import { registrarHistorialStock, getCurrentStock } from './stockHistorial.helper.js';

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
  PTO_VTA?: string;
  NRO_COMPROBANTE?: string;
  PUNTO_VENTA_ID?: number;
  DESTINO_PAGO?: 'CAJA_CENTRAL' | 'CAJA';
  items?: NCCompraItemInput[];
  metodos_pago?: { METODO_PAGO_ID: number; MONTO: number }[];
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

// ── Stock helpers (mirror purchases.service) ────

async function decrementarStockTx(
  tx: any,
  productoId: number,
  cantidad: number,
  depositoId: number | null,
  referenciaId?: number,
  usuarioId?: number
) {
  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query('SELECT ES_CONJUNTO, DESCUENTA_STOCK FROM PRODUCTOS WHERE PRODUCTO_ID = @pid');
  if (!prod.recordset.length) return;

  const esConjunto = prod.recordset[0].ES_CONJUNTO;
  const descuentaStock = prod.recordset[0].DESCUENTA_STOCK;

  if (esConjunto) {
    const children = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT PRODUCTO_ID_HIJO, DEPOSITO_ID, CANTIDAD
              FROM PRODUCTO_CONJUNTO_DEPOSITO WHERE PRODUCTO_ID = @pid`);
    for (const child of children.recordset) {
      const childQty = cantidad * child.CANTIDAD;
      const prevStock = await getCurrentStock(tx, child.PRODUCTO_ID_HIJO, child.DEPOSITO_ID);
      const existsC = await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('depId', sql.Int, child.DEPOSITO_ID)
        .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      if (existsC.recordset.length > 0) {
        await tx.request()
          .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
          .input('depId', sql.Int, child.DEPOSITO_ID)
          .input('cant', sql.Decimal(18, 2), childQty)
          .query('UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      } else {
        await tx.request()
          .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
          .input('depId', sql.Int, child.DEPOSITO_ID)
          .input('cant', sql.Decimal(18, 2), childQty)
          .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@prodId, @depId, -@cant)');
      }
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('cant', sql.Decimal(18, 2), childQty)
        .query('UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId');
      await registrarHistorialStock(tx, {
        productoId: child.PRODUCTO_ID_HIJO, depositoId: child.DEPOSITO_ID,
        cantidadAnterior: prevStock, cantidadNueva: prevStock - childQty,
        tipoOperacion: 'NC_COMPRA', referenciaId, referenciaDetalle: `NC Compra #${referenciaId || ''}`, usuarioId,
      });
    }
    if (descuentaStock && depositoId) {
      const prevStock = await getCurrentStock(tx, productoId, depositoId);
      const existsP = await tx.request()
        .input('prodId', sql.Int, productoId).input('depId', sql.Int, depositoId)
        .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      if (existsP.recordset.length > 0) {
        await tx.request().input('prodId', sql.Int, productoId).input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 2), cantidad)
          .query('UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      } else {
        await tx.request().input('prodId', sql.Int, productoId).input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 2), cantidad)
          .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@prodId, @depId, -@cant)');
      }
      await tx.request().input('prodId', sql.Int, productoId).input('cant', sql.Decimal(18, 2), cantidad)
        .query('UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId');
      await registrarHistorialStock(tx, {
        productoId, depositoId, cantidadAnterior: prevStock, cantidadNueva: prevStock - cantidad,
        tipoOperacion: 'NC_COMPRA', referenciaId, referenciaDetalle: `NC Compra #${referenciaId || ''}`, usuarioId,
      });
    }
  } else if (descuentaStock) {
    // Main stock
    await tx.request()
      .input('pid', sql.Int, productoId)
      .input('cant', sql.Decimal(18, 2), cantidad)
      .query('UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @pid');
    // Deposit stock
    if (depositoId) {
      const prevStock = await getCurrentStock(tx, productoId, depositoId);
      const dep = await tx.request()
        .input('pid', sql.Int, productoId)
        .input('did', sql.Int, depositoId)
        .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did');
      if (dep.recordset.length > 0) {
        await tx.request()
          .input('pid', sql.Int, productoId)
          .input('did', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 2), cantidad)
          .query('UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did');
      } else {
        await tx.request()
          .input('pid', sql.Int, productoId)
          .input('did', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 2), cantidad)
          .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@pid, @did, -@cant)');
      }
      await registrarHistorialStock(tx, {
        productoId, depositoId,
        cantidadAnterior: prevStock, cantidadNueva: prevStock - cantidad,
        tipoOperacion: 'NC_COMPRA', referenciaId, referenciaDetalle: `NC Compra #${referenciaId || ''}`, usuarioId,
      });
    }
  }
}

async function incrementarStockTx(
  tx: any,
  productoId: number,
  cantidad: number,
  depositoId: number | null,
  referenciaId?: number,
  usuarioId?: number
) {
  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query('SELECT ES_CONJUNTO, DESCUENTA_STOCK FROM PRODUCTOS WHERE PRODUCTO_ID = @pid');
  if (!prod.recordset.length) return;

  const esConjunto = prod.recordset[0].ES_CONJUNTO;
  const descuentaStock = prod.recordset[0].DESCUENTA_STOCK;

  if (esConjunto) {
    const children = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT PRODUCTO_ID_HIJO, DEPOSITO_ID, CANTIDAD
              FROM PRODUCTO_CONJUNTO_DEPOSITO WHERE PRODUCTO_ID = @pid`);
    for (const child of children.recordset) {
      const childQty = cantidad * child.CANTIDAD;
      const prevStock = await getCurrentStock(tx, child.PRODUCTO_ID_HIJO, child.DEPOSITO_ID);
      const existsC = await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('depId', sql.Int, child.DEPOSITO_ID)
        .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      if (existsC.recordset.length > 0) {
        await tx.request()
          .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
          .input('depId', sql.Int, child.DEPOSITO_ID)
          .input('cant', sql.Decimal(18, 2), childQty)
          .query('UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      } else {
        await tx.request()
          .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
          .input('depId', sql.Int, child.DEPOSITO_ID)
          .input('cant', sql.Decimal(18, 2), childQty)
          .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@prodId, @depId, @cant)');
      }
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('cant', sql.Decimal(18, 2), childQty)
        .query('UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId');
      await registrarHistorialStock(tx, {
        productoId: child.PRODUCTO_ID_HIJO, depositoId: child.DEPOSITO_ID,
        cantidadAnterior: prevStock, cantidadNueva: prevStock + childQty,
        tipoOperacion: 'NC_COMPRA', referenciaId, referenciaDetalle: `Anulación NC Compra #${referenciaId || ''}`, usuarioId,
      });
    }
    if (descuentaStock && depositoId) {
      const prevStock = await getCurrentStock(tx, productoId, depositoId);
      const existsP = await tx.request()
        .input('prodId', sql.Int, productoId).input('depId', sql.Int, depositoId)
        .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      if (existsP.recordset.length > 0) {
        await tx.request().input('prodId', sql.Int, productoId).input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 2), cantidad)
          .query('UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      } else {
        await tx.request().input('prodId', sql.Int, productoId).input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 2), cantidad)
          .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@prodId, @depId, @cant)');
      }
      await tx.request().input('prodId', sql.Int, productoId).input('cant', sql.Decimal(18, 2), cantidad)
        .query('UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId');
      await registrarHistorialStock(tx, {
        productoId, depositoId, cantidadAnterior: prevStock, cantidadNueva: prevStock + cantidad,
        tipoOperacion: 'NC_COMPRA', referenciaId, referenciaDetalle: `Anulación NC Compra #${referenciaId || ''}`, usuarioId,
      });
    }
  } else if (descuentaStock) {
    await tx.request()
      .input('pid', sql.Int, productoId)
      .input('cant', sql.Decimal(18, 2), cantidad)
      .query('UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @pid');
    if (depositoId) {
      const prevStock = await getCurrentStock(tx, productoId, depositoId);
      const dep = await tx.request()
        .input('pid', sql.Int, productoId)
        .input('did', sql.Int, depositoId)
        .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did');
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
      await registrarHistorialStock(tx, {
        productoId, depositoId,
        cantidadAnterior: prevStock, cantidadNueva: prevStock + cantidad,
        tipoOperacion: 'NC_COMPRA', referenciaId, referenciaDetalle: `Anulación NC Compra #${referenciaId || ''}`, usuarioId,
      });
    }
  }
}

// ══════════════════════════════════════════════════
//  Auto-migration: ensure COMPRAS.ANULADA exists
// ══════════════════════════════════════════════════

let _migrationPromise: Promise<void> | null = null;
function ensureMigrations(): Promise<void> {
  if (!_migrationPromise) _migrationPromise = _runMigrations().catch(err => {
    _migrationPromise = null;
    throw err;
  });
  return _migrationPromise;
}
async function _runMigrations() {
  const pool = await getPool();

  // Ensure NC_COMPRAS table exists
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NC_COMPRAS')
    CREATE TABLE NC_COMPRAS (
      NC_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      COMPRA_ID INT NOT NULL,
      MONTO DECIMAL(18,2) NOT NULL,
      DESCUENTO DECIMAL(18,2) NULL,
      FECHA DATETIME NOT NULL,
      MOTIVO NVARCHAR(100) NOT NULL,
      MEDIO_PAGO NVARCHAR(100) NOT NULL,
      DESCRIPCION NVARCHAR(250) NULL,
      ANULADA BIT NOT NULL DEFAULT 0,
      NUMERO_FISCAL NVARCHAR(100) NULL,
      CAE NVARCHAR(100) NULL,
      PUNTO_VENTA NVARCHAR(100) NULL,
      TIPO_COMPROBANTE NVARCHAR(50) NULL,
      PROVEEDOR_ID INT NULL,
      USUARIO_ID INT NULL,
      PUNTO_VENTA_ID INT NULL,
      DESTINO_PAGO VARCHAR(20) NULL,
      NRO_COMPROBANTE NVARCHAR(100) NULL
    );
  `);

  // Ensure NC_COMPRAS_ITEMS table exists
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NC_COMPRAS_ITEMS')
    CREATE TABLE NC_COMPRAS_ITEMS (
      NC_ITEM_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      NC_ID INT NOT NULL,
      COMPRA_ID INT NOT NULL,
      PRODUCTO_ID INT NOT NULL,
      CANTIDAD_DEVUELTA DECIMAL(18,2) NOT NULL,
      PRECIO_COMPRA DECIMAL(18,2) NOT NULL,
      DEPOSITO_ID INT NULL
    );
  `);

  // Ensure NC_COMPRAS_HISTORIAL table exists
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NC_COMPRAS_HISTORIAL')
    CREATE TABLE NC_COMPRAS_HISTORIAL (
      HISTORIAL_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      COMPRA_ID INT NOT NULL,
      NC_ID INT NOT NULL,
      FECHA DATETIME NOT NULL,
      PRODUCTO_ID INT NOT NULL,
      CANTIDAD_ORIGINAL DECIMAL(18,2) NOT NULL,
      CANTIDAD_MODIFICADO DECIMAL(18,2) NOT NULL,
      PRECIO_ORIGINAL DECIMAL(18,2) NOT NULL,
      PRECIO_MODIFICADO DECIMAL(18,2) NOT NULL,
      TOTAL_PRODUCTO_ORIGINAL DECIMAL(18,2) NOT NULL,
      TOTAL_PRODUCTO_MODIFICADO DECIMAL(18,2) NOT NULL,
      TOTAL_COMPRA_ORIGINAL DECIMAL(18,2) NOT NULL,
      TOTAL_COMPRA_MODIFICADO DECIMAL(18,2) NOT NULL,
      MOTIVO VARCHAR(50) NOT NULL,
      DEPOSITO_ID INT NULL
    );
  `);

  // Ensure ND_COMPRAS table exists
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ND_COMPRAS')
    CREATE TABLE ND_COMPRAS (
      ND_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      COMPRA_ID INT NOT NULL,
      MONTO DECIMAL(18,2) NOT NULL,
      FECHA DATETIME NOT NULL,
      MOTIVO NVARCHAR(100) NOT NULL,
      MEDIO_PAGO NVARCHAR(100) NOT NULL,
      DESCRIPCION NVARCHAR(250) NULL,
      ANULADA BIT NOT NULL DEFAULT 0,
      NUMERO_FISCAL NVARCHAR(100) NULL,
      CAE NVARCHAR(100) NULL,
      PUNTO_VENTA NVARCHAR(100) NULL,
      TIPO_COMPROBANTE NVARCHAR(50) NULL,
      PROVEEDOR_ID INT NULL,
      NC_ID INT NULL,
      USUARIO_ID INT NULL,
      PUNTO_VENTA_ID INT NULL
    );
  `);

  // Ensure COMPRAS.ANULADA column exists
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'COMPRAS' AND COLUMN_NAME = 'ANULADA')
      ALTER TABLE COMPRAS ADD ANULADA BIT NOT NULL DEFAULT 0;
  `);

  // Ensure columns that may be missing on older tables
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_COMPRAS' AND COLUMN_NAME = 'DESTINO_PAGO')
      ALTER TABLE NC_COMPRAS ADD DESTINO_PAGO VARCHAR(20) NULL;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_COMPRAS' AND COLUMN_NAME = 'NRO_COMPROBANTE')
      ALTER TABLE NC_COMPRAS ADD NRO_COMPROBANTE NVARCHAR(100) NULL;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_COMPRAS' AND COLUMN_NAME = 'PUNTO_VENTA_ID')
      ALTER TABLE NC_COMPRAS ADD PUNTO_VENTA_ID INT NULL;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_COMPRAS' AND COLUMN_NAME = 'USUARIO_ID')
      ALTER TABLE NC_COMPRAS ADD USUARIO_ID INT NULL;
  `);

  // Ensure NC_ID is IDENTITY (existing tables may have plain INT NOT NULL)
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.identity_columns
      WHERE object_id = OBJECT_ID('NC_COMPRAS') AND name = 'NC_ID'
    )
    BEGIN
      CREATE TABLE NC_COMPRAS_TMP (
        NC_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        COMPRA_ID INT NOT NULL,
        MONTO DECIMAL(18,2) NOT NULL,
        DESCUENTO DECIMAL(18,2) NULL,
        FECHA DATETIME NOT NULL,
        MOTIVO NVARCHAR(100) NOT NULL,
        MEDIO_PAGO NVARCHAR(100) NOT NULL,
        DESCRIPCION NVARCHAR(250) NULL,
        ANULADA BIT NOT NULL DEFAULT 0,
        NUMERO_FISCAL NVARCHAR(100) NULL,
        CAE NVARCHAR(100) NULL,
        PUNTO_VENTA NVARCHAR(100) NULL,
        TIPO_COMPROBANTE NVARCHAR(50) NULL,
        PROVEEDOR_ID INT NULL,
        USUARIO_ID INT NULL,
        PUNTO_VENTA_ID INT NULL,
        DESTINO_PAGO VARCHAR(20) NULL,
        NRO_COMPROBANTE NVARCHAR(100) NULL
      );

      SET IDENTITY_INSERT NC_COMPRAS_TMP ON;
      INSERT INTO NC_COMPRAS_TMP (
        NC_ID, COMPRA_ID, MONTO, DESCUENTO, FECHA, MOTIVO, MEDIO_PAGO,
        DESCRIPCION, ANULADA, NUMERO_FISCAL, CAE, PUNTO_VENTA,
        TIPO_COMPROBANTE, PROVEEDOR_ID, DESTINO_PAGO, NRO_COMPROBANTE
      )
      SELECT
        NC_ID, COMPRA_ID, MONTO, DESCUENTO, FECHA, MOTIVO, MEDIO_PAGO,
        DESCRIPCION, ANULADA, NUMERO_FISCAL, CAE, PUNTO_VENTA,
        TIPO_COMPROBANTE, PROVEEDOR_ID, DESTINO_PAGO, NRO_COMPROBANTE
      FROM NC_COMPRAS;
      SET IDENTITY_INSERT NC_COMPRAS_TMP OFF;

      DECLARE @maxId INT = (SELECT ISNULL(MAX(NC_ID), 0) FROM NC_COMPRAS_TMP);

      DROP TABLE NC_COMPRAS;
      EXEC sp_rename 'NC_COMPRAS_TMP', 'NC_COMPRAS';

      IF @maxId > 0
        DBCC CHECKIDENT('NC_COMPRAS', RESEED, @maxId);
    END
  `);

}

// ══════════════════════════════════════════════════
//  Service
// ══════════════════════════════════════════════════

export const ncComprasService = {

  // ── List all NCs ────────────────────────────────
  async getAll(filter: NCCompraFilter) {
    await ensureMigrations();
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
    await ensureMigrations();
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
          u.NOMBRE AS USUARIO_NOMBRE,
          c.TIPO_COMPROBANTE AS COMPRA_TIPO_COMPROBANTE
        FROM NC_COMPRAS nc
        LEFT JOIN PROVEEDORES p ON p.PROVEEDOR_ID = nc.PROVEEDOR_ID
        LEFT JOIN USUARIOS u ON u.USUARIO_ID = nc.USUARIO_ID
        LEFT JOIN COMPRAS c ON c.COMPRA_ID = nc.COMPRA_ID
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
          ISNULL(ci.IVA_ALICUOTA, 0) AS IVA_ALICUOTA,
          ISNULL(ci.PORCENTAJE_DESCUENTO, 0) AS PORCENTAJE_DESCUENTO,
          pr.NOMBRE AS PRODUCTO_NOMBRE,
          pr.CODIGOPARTICULAR AS PRODUCTO_CODIGO,
          u.ABREVIACION AS UNIDAD_ABREVIACION
        FROM NC_COMPRAS_ITEMS i
        JOIN PRODUCTOS pr ON pr.PRODUCTO_ID = i.PRODUCTO_ID
        LEFT JOIN UNIDADES_MEDIDA u ON u.UNIDAD_ID = pr.UNIDAD_ID
        LEFT JOIN COMPRAS_ITEMS ci ON ci.COMPRA_ID = i.COMPRA_ID AND ci.PRODUCTO_ID = i.PRODUCTO_ID
        WHERE i.NC_ID = @id
      `);

    // Fetch payment method breakdown from MOVIMIENTOS_CAJA
    let metodos_pago: any[] = [];
    try {
      const movRes = await pool.request()
        .input('ncId', sql.Int, id)
        .input('tipoEntidad', sql.VarChar(20), 'NC_COMPRA')
        .query(`
          SELECT TOP 1 ID FROM MOVIMIENTOS_CAJA
          WHERE TIPO_ENTIDAD = @tipoEntidad
            AND MOVIMIENTO LIKE 'NC Compra #' + CAST(@ncId AS VARCHAR) + ' -%'
          ORDER BY ID DESC
        `);
      if (movRes.recordset.length > 0) {
        const movId = movRes.recordset[0].ID;
        const mpRes = await pool.request()
          .input('movId', sql.Int, movId)
          .query(`
            SELECT mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64,
                   mcm.MONTO AS TOTAL
            FROM MOVIMIENTOS_CAJA_METODOS_PAGO mcm
            JOIN METODOS_PAGO mp ON mcm.METODO_PAGO_ID = mp.METODO_PAGO_ID
            WHERE mcm.MOVIMIENTO_ID = @movId
            ORDER BY CASE WHEN mp.CATEGORIA = 'EFECTIVO' THEN 0 ELSE 1 END, mp.NOMBRE
          `);
        metodos_pago = mpRes.recordset;
      }
    } catch { /* table may not exist yet */ }

    return {
      ...header.recordset[0],
      items: items.recordset,
      metodos_pago,
    };
  },

  // ── Purchases available for NC ──────────────────
  async getComprasParaNC(proveedorId: number, fechaDesde?: string, fechaHasta?: string) {
    await ensureMigrations();
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
    await ensureMigrations();
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
          ISNULL(ci.IVA_ALICUOTA, 0) AS IVA_ALICUOTA,
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
    await ensureMigrations();
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
    await ensureMigrations();
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

        // Use frontend-calculated MONTO if provided (includes discount + IVA)
        if (input.MONTO && input.MONTO > 0) {
          monto = r2(input.MONTO);
        } else {
          // Fallback: calculate with discount + IVA from DB
          const tipoComprobanteRes = await tx.request()
            .input('cid', sql.Int, input.COMPRA_ID)
            .query(`SELECT TIPO_COMPROBANTE FROM COMPRAS WHERE COMPRA_ID = @cid`);
          const tipoComprobante = tipoComprobanteRes.recordset[0]?.TIPO_COMPROBANTE;
          const isFA = tipoComprobante === 'FA';

          // Fetch discount + IVA per item
          const itemDetailsRes = await tx.request()
            .input('cid', sql.Int, input.COMPRA_ID)
            .query(`
              SELECT PRODUCTO_ID, ISNULL(PORCENTAJE_DESCUENTO, 0) AS PORCENTAJE_DESCUENTO,
                     ISNULL(IVA_ALICUOTA, 0) AS IVA_ALICUOTA
              FROM COMPRAS_ITEMS WHERE COMPRA_ID = @cid
            `);
          const detailMap = new Map(itemDetailsRes.recordset.map((r: any) => [r.PRODUCTO_ID, r]));

          let neto = 0;
          let iva = 0;
          for (const item of input.items) {
            const det = detailMap.get(item.PRODUCTO_ID) as any;
            const desc = det?.PORCENTAJE_DESCUENTO || 0;
            const bruto = r2(item.CANTIDAD_DEVUELTA * item.PRECIO_COMPRA);
            const lineNeto = r2(bruto * (1 - desc / 100));
            neto += lineNeto;
            if (isFA) {
              const ivaAliq = det?.IVA_ALICUOTA || 0;
              iva += r2(lineNeto * ivaAliq);
            }
          }
          monto = r2(neto + iva);
        }
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
        .input('ptoVta', sql.NVarChar(100), input.PTO_VTA || null)
        .input('nroComprobante', sql.NVarChar(100), input.NRO_COMPROBANTE || null)
        .input('proveedorId', sql.Int, input.PROVEEDOR_ID)
        .input('usuarioId', sql.Int, usuarioId)
        .input('puntoVentaId', sql.Int, puntoVentaId)
        .input('destinoPago', sql.NVarChar(20), input.DESTINO_PAGO ?? null)
        .query(`
          INSERT INTO NC_COMPRAS (
            COMPRA_ID, MONTO, DESCUENTO, FECHA, MOTIVO, MEDIO_PAGO,
            DESCRIPCION, ANULADA, NUMERO_FISCAL, CAE, PUNTO_VENTA, TIPO_COMPROBANTE,
            PROVEEDOR_ID, USUARIO_ID, PUNTO_VENTA_ID, DESTINO_PAGO, NRO_COMPROBANTE
          )
          OUTPUT INSERTED.NC_ID
          VALUES (
            @compraId, @monto, @descuento, @fecha, @motivo, @medioPago,
            @descripcion, @anulada, NULL, NULL, @ptoVta, NULL,
            @proveedorId, @usuarioId, @puntoVentaId, @destinoPago, @nroComprobante
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
          await decrementarStockTx(tx, item.PRODUCTO_ID, item.CANTIDAD_DEVUELTA, depId, ncId, usuarioId);
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
        // Register in COMPRAS_CTA_CORRIENTE (HABER = reduces what we owe)
        const ctaCteRes = await tx.request()
          .input('pid', sql.Int, input.PROVEEDOR_ID)
          .query('SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_P WHERE PROVEEDOR_ID = @pid');
        if (ctaCteRes.recordset.length > 0) {
          const ctaCteId = ctaCteRes.recordset[0].CTA_CORRIENTE_ID;
          await tx.request()
            .input('comprobanteId', sql.Int, ncId)
            .input('ctaCteId', sql.Int, ctaCteId)
            .input('fecha', sql.DateTime, new Date())
            .input('concepto', sql.NVarChar(255), `NC Compra #${ncId} - ${input.MOTIVO}`)
            .input('tipoComp', sql.NVarChar(50), 'NCA')
            .input('debe', sql.Decimal(18, 2), 0)
            .input('haber', sql.Decimal(18, 2), monto)
            .query(`
              INSERT INTO COMPRAS_CTA_CORRIENTE
                (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
              VALUES
                (@comprobanteId, @ctaCteId, @fecha, @concepto, @tipoComp, @debe, @haber)
            `);
        }
      } else if (input.MEDIO_PAGO === 'CN') {
        // Register movement in caja if open
        if (caja) {
          // Calculate EFECTIVO / DIGITAL split from payment methods
          let montoEfectivo = monto;
          let montoDigital = 0;
          if (input.metodos_pago && input.metodos_pago.length > 0) {
            const metodosRes = await tx.request().query(`SELECT METODO_PAGO_ID, CATEGORIA FROM METODOS_PAGO`);
            const catMap = new Map(metodosRes.recordset.map((r: any) => [r.METODO_PAGO_ID, r.CATEGORIA]));
            montoEfectivo = 0;
            montoDigital = 0;
            for (const mp of input.metodos_pago) {
              if (mp.MONTO <= 0) continue;
              const cat = catMap.get(mp.METODO_PAGO_ID) || 'EFECTIVO';
              if (cat === 'EFECTIVO') montoEfectivo += mp.MONTO;
              else montoDigital += mp.MONTO;
            }
          }

          const destino = input.DESTINO_PAGO ?? 'CAJA';
          if (destino === 'CAJA') {
            await tx.request()
              .input('cajaId', sql.Int, caja.CAJA_ID)
              .input('origenTipo', sql.VarChar(30), 'NC_COMPRA')
              .input('efectivo', sql.Decimal(18, 2), r2(montoEfectivo))
              .input('digital', sql.Decimal(18, 2), r2(montoDigital))
              .input('descr', sql.NVarChar(255), `NC Compra #${ncId} - ${input.MOTIVO}`)
              .input('uid', sql.Int, usuarioId)
              .query(`
                INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
                VALUES (@cajaId, GETDATE(), @origenTipo, @efectivo, @digital, @descr, @uid)
              `);
          } else {
            // CAJA_CENTRAL
            const totalIngreso = r2(montoEfectivo + montoDigital);
            const movResult = await tx.request()
              .input('tipoEntidad', sql.VarChar(20), 'NC_COMPRA')
              .input('movimiento', sql.NVarChar(500), `NC Compra #${ncId} - ${input.MOTIVO}`)
              .input('uid', sql.Int, usuarioId)
              .input('efectivo', sql.Decimal(18, 2), r2(montoEfectivo))
              .input('digital', sql.Decimal(18, 2), r2(montoDigital))
              .input('total', sql.Decimal(18, 2), totalIngreso)
              .input('pvId', sql.Int, puntoVentaId)
              .query(`
                INSERT INTO MOVIMIENTOS_CAJA (TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
                OUTPUT INSERTED.ID
                VALUES (@tipoEntidad, @movimiento, @uid, @efectivo, @digital, 0, 0, @total, @pvId, 0)
              `);

            // Insert payment method breakdown
            if (input.metodos_pago && input.metodos_pago.length > 0) {
              const movId = movResult.recordset[0].ID;
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
    await ensureMigrations();
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
          await incrementarStockTx(tx, item.PRODUCTO_ID, parseFloat(item.CANTIDAD_DEVUELTA), item.DEPOSITO_ID, ncId, usuarioId);
        }
      }

      // 6) Reverse payment effects
      if (nc.MEDIO_PAGO === 'CC') {
        // Reverse COMPRAS_CTA_CORRIENTE entry (DEBE = restores what we owe)
        const ctaCteRes = await tx.request()
          .input('pid', sql.Int, nc.PROVEEDOR_ID)
          .query('SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_P WHERE PROVEEDOR_ID = @pid');
        if (ctaCteRes.recordset.length > 0) {
          const ctaCteId = ctaCteRes.recordset[0].CTA_CORRIENTE_ID;
          await tx.request()
            .input('comprobanteId', sql.Int, ndId)
            .input('ctaCteId', sql.Int, ctaCteId)
            .input('fecha', sql.DateTime, new Date())
            .input('concepto', sql.NVarChar(255), `ND Compra (anulación NC #${ncId})`)
            .input('tipoComp', sql.NVarChar(50), 'NDA')
            .input('debe', sql.Decimal(18, 2), nc.MONTO)
            .input('haber', sql.Decimal(18, 2), 0)
            .query(`
              INSERT INTO COMPRAS_CTA_CORRIENTE
                (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
              VALUES
                (@comprobanteId, @ctaCteId, @fecha, @concepto, @tipoComp, @debe, @haber)
            `);
        }
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
