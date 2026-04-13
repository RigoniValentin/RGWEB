import { getPool, sql } from '../database/connection.js';
import { registrarHistorialStock, getCurrentStock } from './stockHistorial.helper.js';
import { facturacionService } from './facturacion.service.js';
import { config } from '../config/index.js';
import {
  CBTE_TIPOS, CONCEPTO, IVA_IDS,
  feCAESolicitar, feCompUltimoAutorizado,
  type FEAuthRequest, type FEComprobante, type FEAlicuotaIva,
} from './arca/wsfev1.js';
import { getWSAACredentials, type WSAAConfig } from './arca/wsaa.js';
import path from 'path';
import { rootDir } from '../config/paths.js';

// ═══════════════════════════════════════════════════
//  NC Ventas Service — Credit Notes for Sales
//  Mirror of ncCompras.service but for sales flow
//  with ARCA fiscal emission support
// ═══════════════════════════════════════════════════

// ── Interfaces ──────────────────────────────────

export interface NCVentaFilter {
  clienteId?: number;
  fechaDesde?: string;
  fechaHasta?: string;
  motivo?: string;
  anulada?: boolean;
}

export interface NCVentaItemInput {
  PRODUCTO_ID: number;
  CANTIDAD_DEVUELTA: number;
  PRECIO_UNITARIO: number;
  DEPOSITO_ID?: number | null;
}

export interface NCVentaInput {
  VENTA_ID: number;
  CLIENTE_ID: number;
  MOTIVO: 'POR DEVOLUCION' | 'POR ANULACION' | 'POR DESCUENTO' | 'POR DIFERENCIA PRECIO';
  MEDIO_PAGO: 'CN' | 'CC';
  MONTO?: number;
  DESCUENTO?: number;
  DESCRIPCION?: string;
  PUNTO_VENTA_ID?: number;
  DESTINO_PAGO?: 'CAJA_CENTRAL' | 'CAJA';
  EMITIR_FISCAL?: boolean;
  items?: NCVentaItemInput[];
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

// ── Stock helpers (restore stock for sales NC = product comes back) ────

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
  if (!prod.recordset.length || !prod.recordset[0].DESCUENTA_STOCK) return;

  const esConjunto = prod.recordset[0].ES_CONJUNTO;

  if (esConjunto) {
    // Restore children
    const children = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT PRODUCTO_ID_HIJO, DEPOSITO_ID, CANTIDAD
              FROM PRODUCTO_CONJUNTO_DEPOSITO WHERE PRODUCTO_ID = @pid`);
    for (const child of children.recordset) {
      const childQty = cantidad * child.CANTIDAD;
      const prevStock = await getCurrentStock(tx, child.PRODUCTO_ID_HIJO, child.DEPOSITO_ID);
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
      await registrarHistorialStock(tx, {
        productoId: child.PRODUCTO_ID_HIJO, depositoId: child.DEPOSITO_ID,
        cantidadAnterior: prevStock, cantidadNueva: prevStock + childQty,
        tipoOperacion: 'NC_VENTA', referenciaId, referenciaDetalle: `NC Venta #${referenciaId || ''}`, usuarioId,
      });
    }
  }

  // Main product stock
  await tx.request()
    .input('pid', sql.Int, productoId)
    .input('cant', sql.Decimal(18, 4), cantidad)
    .query('UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @pid');

  if (depositoId) {
    const prevStock = await getCurrentStock(tx, productoId, depositoId);
    const dep = await tx.request()
      .input('pid', sql.Int, productoId)
      .input('did', sql.Int, depositoId)
      .query('SELECT CANTIDAD FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did');
    if (dep.recordset.length > 0) {
      await tx.request()
        .input('pid', sql.Int, productoId)
        .input('did', sql.Int, depositoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query('UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did');
    } else {
      await tx.request()
        .input('pid', sql.Int, productoId)
        .input('did', sql.Int, depositoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@pid, @did, @cant)');
    }
    await registrarHistorialStock(tx, {
      productoId, depositoId,
      cantidadAnterior: prevStock, cantidadNueva: prevStock + cantidad,
      tipoOperacion: 'NC_VENTA', referenciaId, referenciaDetalle: `NC Venta #${referenciaId || ''}`, usuarioId,
    });
  }
}

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
  if (!prod.recordset.length || !prod.recordset[0].DESCUENTA_STOCK) return;

  const esConjunto = prod.recordset[0].ES_CONJUNTO;

  if (esConjunto) {
    const children = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT PRODUCTO_ID_HIJO, DEPOSITO_ID, CANTIDAD
              FROM PRODUCTO_CONJUNTO_DEPOSITO WHERE PRODUCTO_ID = @pid`);
    for (const child of children.recordset) {
      const childQty = cantidad * child.CANTIDAD;
      const prevStock = await getCurrentStock(tx, child.PRODUCTO_ID_HIJO, child.DEPOSITO_ID);
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
      await registrarHistorialStock(tx, {
        productoId: child.PRODUCTO_ID_HIJO, depositoId: child.DEPOSITO_ID,
        cantidadAnterior: prevStock, cantidadNueva: prevStock - childQty,
        tipoOperacion: 'ND_VENTA', referenciaId, referenciaDetalle: `Anulación NC Venta #${referenciaId || ''}`, usuarioId,
      });
    }
  }

  await tx.request()
    .input('pid', sql.Int, productoId)
    .input('cant', sql.Decimal(18, 4), cantidad)
    .query('UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @pid');

  if (depositoId) {
    const prevStock = await getCurrentStock(tx, productoId, depositoId);
    await tx.request()
      .input('pid', sql.Int, productoId)
      .input('did', sql.Int, depositoId)
      .input('cant', sql.Decimal(18, 4), cantidad)
      .query('UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did');
    await registrarHistorialStock(tx, {
      productoId, depositoId,
      cantidadAnterior: prevStock, cantidadNueva: prevStock - cantidad,
      tipoOperacion: 'ND_VENTA', referenciaId, referenciaDetalle: `Anulación NC Venta #${referenciaId || ''}`, usuarioId,
    });
  }
}

// ── ARCA helpers ────────────────────────────────

function getWSAAConfig(): WSAAConfig {
  return {
    privateKeyPath: path.resolve(rootDir, config.arca.keyPath),
    certPath: path.resolve(rootDir, config.arca.certPath),
    environment: config.arca.environment,
    cuit: config.arca.cuit,
  };
}

async function getAuth(): Promise<FEAuthRequest> {
  const wsaaConfig = getWSAAConfig();
  const { token, sign } = await getWSAACredentials('wsfe', wsaaConfig);
  return { Token: token, Sign: sign, Cuit: config.arca.cuit };
}

function formatFechaARCA(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/**
 * Maps internal factura type to the corresponding NC ARCA CbteTipo.
 * Fa.A → NC A (3), Fa.B → NC B (8), Fa.C → NC C (13)
 */
function mapFacturaToNCTipo(tipoComprobante: string): number {
  switch (tipoComprobante) {
    case 'Fa.A': return CBTE_TIPOS['NOTA DE CREDITO A'];
    case 'Fa.B': return CBTE_TIPOS['NOTA DE CREDITO B'];
    case 'Fa.C': return CBTE_TIPOS['NOTA DE CREDITO C'];
    default: return CBTE_TIPOS['NOTA DE CREDITO B'];
  }
}

function mapNCTipoToInterno(cbteTipo: number): string {
  switch (cbteTipo) {
    case CBTE_TIPOS['NOTA DE CREDITO A']: return 'NC.A';
    case CBTE_TIPOS['NOTA DE CREDITO B']: return 'NC.B';
    case CBTE_TIPOS['NOTA DE CREDITO C']: return 'NC.C';
    default: return `NC.Tipo${cbteTipo}`;
  }
}

function getDocTipoForCondicion(condicionIva: string, documentoTipo: string): number {
  const c = (condicionIva || '').toUpperCase().trim();
  if (c === 'RESPONSABLE INSCRIPTO' || c === 'MONOTRIBUTO') return 80; // CUIT
  const dt = (documentoTipo || '').toUpperCase().trim();
  if (dt === 'CUIT') return 80;
  if (dt === 'CUIL') return 86;
  if (dt === 'DNI') return 96;
  return 99; // SIN_IDENTIFICAR
}

function getCondicionIvaReceptorId(condicionIva: string): number {
  const c = (condicionIva || '').toUpperCase().trim();
  switch (c) {
    case 'RESPONSABLE INSCRIPTO': return 1;
    case 'EXENTO':
    case 'IVA EXENTO': return 4;
    case 'CONSUMIDOR FINAL': return 5;
    case 'MONOTRIBUTO':
    case 'RESPONSABLE MONOTRIBUTO': return 6;
    default: return 5;
  }
}

function calcularNetoEIva(precioFinal: number, alicuota: number): { iva: number; neto: number } {
  if (alicuota <= 0 || precioFinal <= 0) return { iva: 0, neto: precioFinal };
  const iva = Math.round(precioFinal * (alicuota / (1 + alicuota)) * 100) / 100;
  const neto = precioFinal - iva;
  return { iva, neto };
}

// ══════════════════════════════════════════════════
//  Auto-migration: ensure NC_VENTAS tables exist
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

  // Create NC_VENTAS if not exists
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NC_VENTAS')
    CREATE TABLE NC_VENTAS (
      NC_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      VENTA_ID INT NOT NULL,
      CLIENTE_ID INT NULL,
      MONTO DECIMAL(18,2) NOT NULL,
      DESCUENTO DECIMAL(18,2) NULL,
      FECHA DATETIME NOT NULL,
      MOTIVO NVARCHAR(100) NOT NULL,
      MEDIO_PAGO NVARCHAR(100) NOT NULL,
      DESCRIPCION NVARCHAR(250) NULL,
      ANULADA BIT NOT NULL DEFAULT 0,
      NUMERO_FISCAL NVARCHAR(100) NULL,
      CAE NVARCHAR(100) NULL,
      CAE_VTO NVARCHAR(20) NULL,
      PUNTO_VENTA NVARCHAR(100) NULL,
      TIPO_COMPROBANTE NVARCHAR(50) NULL,
      NRO_COMPROBANTE NVARCHAR(100) NULL,
      USUARIO_ID INT NULL,
      PUNTO_VENTA_ID INT NULL,
      DESTINO_PAGO VARCHAR(20) NULL DEFAULT 'CAJA_CENTRAL',
      EMITIDA_FISCAL BIT NOT NULL DEFAULT 0
    );
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NC_VENTAS_ITEMS')
    CREATE TABLE NC_VENTAS_ITEMS (
      NC_ITEM_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      NC_ID INT NOT NULL,
      VENTA_ID INT NOT NULL,
      PRODUCTO_ID INT NOT NULL,
      CANTIDAD_DEVUELTA DECIMAL(18,2) NOT NULL,
      PRECIO_UNITARIO DECIMAL(18,2) NOT NULL,
      DEPOSITO_ID INT NULL
    );
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NC_VENTAS_HISTORIAL')
    CREATE TABLE NC_VENTAS_HISTORIAL (
      HISTORIAL_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      VENTA_ID INT NOT NULL,
      NC_ID INT NOT NULL,
      FECHA DATETIME NOT NULL,
      PRODUCTO_ID INT NOT NULL,
      CANTIDAD_ORIGINAL DECIMAL(18,2) NOT NULL,
      CANTIDAD_MODIFICADO DECIMAL(18,2) NOT NULL,
      PRECIO_ORIGINAL DECIMAL(18,2) NOT NULL,
      PRECIO_MODIFICADO DECIMAL(18,2) NOT NULL,
      TOTAL_PRODUCTO_ORIGINAL DECIMAL(18,2) NOT NULL,
      TOTAL_PRODUCTO_MODIFICADO DECIMAL(18,2) NOT NULL,
      TOTAL_VENTA_ORIGINAL DECIMAL(18,2) NOT NULL,
      TOTAL_VENTA_MODIFICADO DECIMAL(18,2) NOT NULL,
      MOTIVO VARCHAR(50) NOT NULL,
      DEPOSITO_ID INT NULL
    );
  `);

  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ND_VENTAS')
    CREATE TABLE ND_VENTAS (
      ND_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
      VENTA_ID INT NOT NULL,
      NC_ID INT NULL,
      CLIENTE_ID INT NULL,
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
      USUARIO_ID INT NULL,
      PUNTO_VENTA_ID INT NULL
    );
  `);

  // Ensure columns that may be missing on older tables
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS' AND COLUMN_NAME = 'DESTINO_PAGO')
      ALTER TABLE NC_VENTAS ADD DESTINO_PAGO VARCHAR(20) NULL DEFAULT 'CAJA_CENTRAL';
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS' AND COLUMN_NAME = 'EMITIDA_FISCAL')
      ALTER TABLE NC_VENTAS ADD EMITIDA_FISCAL BIT NOT NULL DEFAULT 0;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS' AND COLUMN_NAME = 'CAE_VTO')
      ALTER TABLE NC_VENTAS ADD CAE_VTO NVARCHAR(20) NULL;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS' AND COLUMN_NAME = 'NRO_COMPROBANTE')
      ALTER TABLE NC_VENTAS ADD NRO_COMPROBANTE NVARCHAR(100) NULL;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS' AND COLUMN_NAME = 'PUNTO_VENTA_ID')
      ALTER TABLE NC_VENTAS ADD PUNTO_VENTA_ID INT NULL;
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS' AND COLUMN_NAME = 'USUARIO_ID')
      ALTER TABLE NC_VENTAS ADD USUARIO_ID INT NULL;
  `);

  // Fix NC_VENTAS_ITEMS: ensure PRECIO_UNITARIO exists (old tables may only have PRECIO_COMPRA)
  await pool.request().query(`
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS_ITEMS' AND COLUMN_NAME = 'PRECIO_COMPRA')
    AND NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS_ITEMS' AND COLUMN_NAME = 'PRECIO_UNITARIO')
      EXEC sp_rename 'NC_VENTAS_ITEMS.PRECIO_COMPRA', 'PRECIO_UNITARIO', 'COLUMN';
    -- If both columns exist (from a partial migration), drop the old one
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS_ITEMS' AND COLUMN_NAME = 'PRECIO_COMPRA')
    AND EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS_ITEMS' AND COLUMN_NAME = 'PRECIO_UNITARIO')
      ALTER TABLE NC_VENTAS_ITEMS DROP COLUMN PRECIO_COMPRA;
  `);

  // Fix NC_VENTAS_ITEMS: make extra columns nullable
  await pool.request().query(`
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS_ITEMS' AND COLUMN_NAME = 'PRODUCTO_ITEM_ID' AND IS_NULLABLE = 'NO')
      ALTER TABLE NC_VENTAS_ITEMS ALTER COLUMN PRODUCTO_ITEM_ID INT NULL;
  `);

  // Fix NC_VENTAS_HISTORIAL: make extra columns nullable (old tables have NOT NULL columns we don't use)
  await pool.request().query(`
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS_HISTORIAL' AND COLUMN_NAME = 'PRODUCTO_ITEM_ID' AND IS_NULLABLE = 'NO')
      ALTER TABLE NC_VENTAS_HISTORIAL ALTER COLUMN PRODUCTO_ITEM_ID INT NULL;
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS_HISTORIAL' AND COLUMN_NAME = 'DESCUENTO' AND IS_NULLABLE = 'NO')
      ALTER TABLE NC_VENTAS_HISTORIAL ALTER COLUMN DESCUENTO DECIMAL(18,2) NULL;
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS_HISTORIAL' AND COLUMN_NAME = 'GANANCIA_ORIGINAL' AND IS_NULLABLE = 'NO')
      ALTER TABLE NC_VENTAS_HISTORIAL ALTER COLUMN GANANCIA_ORIGINAL DECIMAL(18,2) NULL;
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_VENTAS_HISTORIAL' AND COLUMN_NAME = 'GANANCIA_MODIFICADO' AND IS_NULLABLE = 'NO')
      ALTER TABLE NC_VENTAS_HISTORIAL ALTER COLUMN GANANCIA_MODIFICADO DECIMAL(18,2) NULL;
  `);

  // Ensure NC_ID is IDENTITY (existing tables may have plain INT NOT NULL)
  await pool.request().query(`
    IF NOT EXISTS (
      SELECT 1 FROM sys.identity_columns
      WHERE object_id = OBJECT_ID('NC_VENTAS') AND name = 'NC_ID'
    )
    BEGIN
      CREATE TABLE NC_VENTAS_TMP (
        NC_ID INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        VENTA_ID INT NOT NULL,
        CLIENTE_ID INT NULL,
        MONTO DECIMAL(18,2) NOT NULL,
        DESCUENTO DECIMAL(18,2) NULL,
        FECHA DATETIME NOT NULL,
        MOTIVO NVARCHAR(100) NOT NULL,
        MEDIO_PAGO NVARCHAR(100) NOT NULL,
        DESCRIPCION NVARCHAR(250) NULL,
        ANULADA BIT NOT NULL DEFAULT 0,
        NUMERO_FISCAL NVARCHAR(100) NULL,
        CAE NVARCHAR(100) NULL,
        CAE_VTO NVARCHAR(20) NULL,
        PUNTO_VENTA NVARCHAR(100) NULL,
        TIPO_COMPROBANTE NVARCHAR(50) NULL,
        NRO_COMPROBANTE NVARCHAR(100) NULL,
        USUARIO_ID INT NULL,
        PUNTO_VENTA_ID INT NULL,
        DESTINO_PAGO VARCHAR(20) NULL DEFAULT 'CAJA_CENTRAL',
        EMITIDA_FISCAL BIT NOT NULL DEFAULT 0
      );

      SET IDENTITY_INSERT NC_VENTAS_TMP ON;
      INSERT INTO NC_VENTAS_TMP (
        NC_ID, VENTA_ID, CLIENTE_ID, MONTO, DESCUENTO, FECHA, MOTIVO, MEDIO_PAGO,
        DESCRIPCION, ANULADA, NUMERO_FISCAL, CAE, CAE_VTO, PUNTO_VENTA,
        TIPO_COMPROBANTE, NRO_COMPROBANTE, DESTINO_PAGO, EMITIDA_FISCAL
      )
      SELECT
        NC_ID, VENTA_ID, CLIENTE_ID, MONTO, DESCUENTO, FECHA, MOTIVO, MEDIO_PAGO,
        DESCRIPCION, ANULADA, NUMERO_FISCAL, CAE, CAE_VTO, PUNTO_VENTA,
        TIPO_COMPROBANTE, NRO_COMPROBANTE,
        ISNULL(DESTINO_PAGO, 'CAJA_CENTRAL'),
        ISNULL(EMITIDA_FISCAL, 0)
      FROM NC_VENTAS;
      SET IDENTITY_INSERT NC_VENTAS_TMP OFF;

      DECLARE @maxId INT = (SELECT ISNULL(MAX(NC_ID), 0) FROM NC_VENTAS_TMP);

      DROP TABLE NC_VENTAS;
      EXEC sp_rename 'NC_VENTAS_TMP', 'NC_VENTAS';

      IF @maxId > 0
        DBCC CHECKIDENT('NC_VENTAS', RESEED, @maxId);
    END
  `);

}

// ══════════════════════════════════════════════════
//  Service
// ══════════════════════════════════════════════════

export const ncVentasService = {

  // ── List all NCs ────────────────────────────────
  async getAll(filter: NCVentaFilter) {
    await ensureMigrations();
    const pool = await getPool();
    const req = pool.request();
    const conditions: string[] = [];

    if (filter.clienteId) {
      req.input('cliId', sql.Int, filter.clienteId);
      conditions.push('nc.CLIENTE_ID = @cliId');
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
        nc.VENTA_ID,
        nc.CLIENTE_ID,
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
        nc.NUMERO_FISCAL,
        nc.CAE,
        nc.TIPO_COMPROBANTE,
        nc.PUNTO_VENTA AS PUNTO_VENTA_FISCAL,
        nc.EMITIDA_FISCAL,
        c.NOMBRE AS CLIENTE_NOMBRE,
        u.NOMBRE AS USUARIO_NOMBRE,
        v.NUMERO_FISCAL AS VENTA_NUMERO_FISCAL,
        v.TIPO_COMPROBANTE AS VENTA_TIPO_COMPROBANTE,
        v.PUNTO_VENTA AS VENTA_PUNTO_VENTA
      FROM NC_VENTAS nc
      LEFT JOIN CLIENTES c ON c.CLIENTE_ID = nc.CLIENTE_ID
      LEFT JOIN USUARIOS u ON u.USUARIO_ID = nc.USUARIO_ID
      LEFT JOIN VENTAS v ON v.VENTA_ID = nc.VENTA_ID
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
          nc.VENTA_ID,
          nc.CLIENTE_ID,
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
          nc.NUMERO_FISCAL,
          nc.CAE,
          nc.CAE_VTO,
          nc.TIPO_COMPROBANTE,
          nc.PUNTO_VENTA AS PUNTO_VENTA_FISCAL,
          nc.EMITIDA_FISCAL,
          c.NOMBRE AS CLIENTE_NOMBRE,
          u.NOMBRE AS USUARIO_NOMBRE,
          v.TIPO_COMPROBANTE AS VENTA_TIPO_COMPROBANTE
        FROM NC_VENTAS nc
        LEFT JOIN CLIENTES c ON c.CLIENTE_ID = nc.CLIENTE_ID
        LEFT JOIN USUARIOS u ON u.USUARIO_ID = nc.USUARIO_ID
        LEFT JOIN VENTAS v ON v.VENTA_ID = nc.VENTA_ID
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
          i.VENTA_ID,
          i.PRODUCTO_ID,
          i.CANTIDAD_DEVUELTA,
          i.PRECIO_UNITARIO,
          i.DEPOSITO_ID,
          ISNULL(vi.IVA_ALICUOTA, 0) AS IVA_ALICUOTA,
          ISNULL(vi.DESCUENTO, 0) AS PORCENTAJE_DESCUENTO,
          pr.NOMBRE AS PRODUCTO_NOMBRE,
          pr.CODIGOPARTICULAR AS PRODUCTO_CODIGO,
          u.ABREVIACION AS UNIDAD_ABREVIACION
        FROM NC_VENTAS_ITEMS i
        JOIN PRODUCTOS pr ON pr.PRODUCTO_ID = i.PRODUCTO_ID
        LEFT JOIN UNIDADES_MEDIDA u ON u.UNIDAD_ID = pr.UNIDAD_ID
        LEFT JOIN VENTAS_ITEMS vi ON vi.VENTA_ID = i.VENTA_ID AND vi.PRODUCTO_ID = i.PRODUCTO_ID
        WHERE i.NC_ID = @id
      `);

    // Fetch payment method breakdown from MOVIMIENTOS_CAJA
    let metodos_pago: any[] = [];
    try {
      const movRes = await pool.request()
        .input('ncId', sql.Int, id)
        .input('tipoEntidad', sql.VarChar(20), 'NC_VENTA')
        .query(`
          SELECT TOP 1 ID FROM MOVIMIENTOS_CAJA
          WHERE TIPO_ENTIDAD = @tipoEntidad
            AND MOVIMIENTO LIKE 'NC Venta #' + CAST(@ncId AS VARCHAR) + ' -%'
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

  // ── Sales available for NC ──────────────────────
  async getVentasParaNC(clienteId: number, fechaDesde?: string, fechaHasta?: string) {
    await ensureMigrations();
    const pool = await getPool();
    const req = pool.request();
    req.input('cliId', sql.Int, clienteId);

    const dateConds: string[] = [];
    if (fechaDesde) {
      req.input('fDesde', sql.VarChar(10), fechaDesde);
      dateConds.push('v.FECHA_VENTA >= @fDesde');
    }
    if (fechaHasta) {
      req.input('fHasta', sql.VarChar(10), fechaHasta);
      dateConds.push('v.FECHA_VENTA <= DATEADD(DAY, 1, CAST(@fHasta AS DATE))');
    }
    const dateWhere = dateConds.length > 0 ? `AND ${dateConds.join(' AND ')}` : '';

    const result = await req.query(`
      SELECT
        v.VENTA_ID,
        v.FECHA_VENTA,
        v.TOTAL,
        v.TIPO_COMPROBANTE,
        v.PUNTO_VENTA,
        v.NUMERO_FISCAL,
        v.ES_CTA_CORRIENTE,
        v.COBRADA,
        v.CAE,
        c.NOMBRE AS CLIENTE_NOMBRE
      FROM VENTAS v
      LEFT JOIN CLIENTES c ON c.CLIENTE_ID = v.CLIENTE_ID
      WHERE v.CLIENTE_ID = @cliId
        ${dateWhere}
      ORDER BY v.FECHA_VENTA DESC
    `);
    return result.recordset;
  },

  // ── Items from a sale for devolution grid ───────
  async getItemsVenta(ventaId: number) {
    await ensureMigrations();
    const pool = await getPool();
    const result = await pool.request()
      .input('vid', sql.Int, ventaId)
      .query(`
        SELECT
          vi.VENTA_ID,
          vi.PRODUCTO_ID,
          vi.PRECIO_UNITARIO,
          vi.PRECIO_UNITARIO_DTO,
          vi.CANTIDAD,
          vi.DESCUENTO,
          vi.DEPOSITO_ID,
          ISNULL(vi.IVA_ALICUOTA, 0) AS IVA_ALICUOTA,
          ISNULL(vi.IVA_MONTO, 0) AS IVA_MONTO,
          pr.NOMBRE   AS PRODUCTO_NOMBRE,
          pr.CODIGOPARTICULAR AS PRODUCTO_CODIGO,
          u.ABREVIACION AS UNIDAD_ABREVIACION,
          ISNULL((
            SELECT SUM(nci.CANTIDAD_DEVUELTA)
            FROM NC_VENTAS_ITEMS nci
            JOIN NC_VENTAS nc ON nc.NC_ID = nci.NC_ID
            WHERE nci.VENTA_ID = vi.VENTA_ID
              AND nci.PRODUCTO_ID = vi.PRODUCTO_ID
              AND nc.ANULADA = 0
          ), 0) AS CANTIDAD_YA_DEVUELTA
        FROM VENTAS_ITEMS vi
        JOIN PRODUCTOS pr ON pr.PRODUCTO_ID = vi.PRODUCTO_ID
        LEFT JOIN UNIDADES_MEDIDA u ON u.UNIDAD_ID = pr.UNIDAD_ID
        WHERE vi.VENTA_ID = @vid
      `);
    return result.recordset;
  },

  // ── Check if NCs exist for a sale ───────────────
  async existeNCParaVenta(ventaId: number) {
    await ensureMigrations();
    const pool = await getPool();
    const result = await pool.request()
      .input('vid', sql.Int, ventaId)
      .query(`
        SELECT NC_ID, MONTO, MOTIVO, ANULADA, FECHA, NUMERO_FISCAL, EMITIDA_FISCAL
        FROM NC_VENTAS
        WHERE VENTA_ID = @vid
        ORDER BY FECHA DESC
      `);
    return {
      existe: result.recordset.length > 0,
      notas: result.recordset,
    };
  },

  // ── Create NC ───────────────────────────────────
  async create(input: NCVentaInput, usuarioId: number) {
    await ensureMigrations();
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // 1) Validate sale exists
      const ventaRes = await tx.request()
        .input('vid', sql.Int, input.VENTA_ID)
        .query(`
          SELECT v.VENTA_ID, v.TOTAL, v.CLIENTE_ID, v.ES_CTA_CORRIENTE, v.COBRADA,
                 v.TIPO_COMPROBANTE, v.NUMERO_FISCAL, v.CAE, v.PUNTO_VENTA
          FROM VENTAS v
          WHERE v.VENTA_ID = @vid
        `);
      if (ventaRes.recordset.length === 0) {
        throw validationError('La venta indicada no existe');
      }
      const venta = ventaRes.recordset[0];

      // 2) Calculate amount based on motivo
      let monto: number;
      const motivo = input.MOTIVO;
      const esConItems = motivo === 'POR DEVOLUCION' || motivo === 'POR ANULACION';

      if (esConItems) {
        if (!input.items || input.items.length === 0) {
          throw validationError('Se requieren ítems para este tipo de NC');
        }
        // Validate amounts
        const ventaItems = await tx.request()
          .input('vid', sql.Int, input.VENTA_ID)
          .query(`
            SELECT vi.PRODUCTO_ID, vi.CANTIDAD, vi.PRECIO_UNITARIO, vi.PRECIO_UNITARIO_DTO,
                   vi.DESCUENTO, vi.DEPOSITO_ID
            FROM VENTAS_ITEMS vi
            WHERE vi.VENTA_ID = @vid
          `);
        const viMap = new Map(ventaItems.recordset.map((r: any) => [r.PRODUCTO_ID, r]));

        for (const item of input.items) {
          const vi = viMap.get(item.PRODUCTO_ID) as any;
          if (!vi) throw validationError(`Producto ID ${item.PRODUCTO_ID} no pertenece a la venta`);

          const alreadyDev = await tx.request()
            .input('vid', sql.Int, input.VENTA_ID)
            .input('pid', sql.Int, item.PRODUCTO_ID)
            .query(`
              SELECT ISNULL(SUM(nci.CANTIDAD_DEVUELTA), 0) AS ya
              FROM NC_VENTAS_ITEMS nci
              JOIN NC_VENTAS nc ON nc.NC_ID = nci.NC_ID
              WHERE nci.VENTA_ID = @vid AND nci.PRODUCTO_ID = @pid AND nc.ANULADA = 0
            `);
          const ya = alreadyDev.recordset[0].ya;
          const disponible = r2(vi.CANTIDAD - ya);
          if (item.CANTIDAD_DEVUELTA > disponible + 0.001) {
            throw validationError(
              `Producto ${item.PRODUCTO_ID}: cantidad a devolver (${item.CANTIDAD_DEVUELTA}) supera disponible (${disponible})`
            );
          }
        }

        // Use frontend-calculated MONTO if provided
        if (input.MONTO && input.MONTO > 0) {
          monto = r2(input.MONTO);
        } else {
          // Fallback: calculate from items using PRECIO_UNITARIO_DTO
          monto = r2(input.items.reduce((s, item) => {
            return s + r2(item.CANTIDAD_DEVUELTA * item.PRECIO_UNITARIO);
          }, 0));
        }
      } else {
        // POR DESCUENTO / POR DIFERENCIA PRECIO
        if (!input.MONTO || input.MONTO <= 0) {
          throw validationError('Debe indicar un monto para este tipo de NC');
        }
        monto = r2(input.MONTO);
      }

      // 3) Get caja info
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      const puntoVentaId = input.PUNTO_VENTA_ID ?? caja?.PUNTO_VENTA_ID ?? null;

      // 4) Insert NC_VENTAS
      const ncInsert = await tx.request()
        .input('ventaId', sql.Int, input.VENTA_ID)
        .input('clienteId', sql.Int, input.CLIENTE_ID)
        .input('monto', sql.Decimal(18, 2), monto)
        .input('descuento', sql.Decimal(18, 2), input.DESCUENTO ?? null)
        .input('fecha', sql.DateTime, new Date())
        .input('motivo', sql.NVarChar(100), input.MOTIVO)
        .input('medioPago', sql.NVarChar(100), input.MEDIO_PAGO)
        .input('descripcion', sql.NVarChar(250), input.DESCRIPCION ?? null)
        .input('anulada', sql.Bit, 0)
        .input('usuarioId', sql.Int, usuarioId)
        .input('puntoVentaId', sql.Int, puntoVentaId)
        .input('destinoPago', sql.NVarChar(20), input.DESTINO_PAGO ?? null)
        .query(`
          INSERT INTO NC_VENTAS (
            VENTA_ID, CLIENTE_ID, MONTO, DESCUENTO, FECHA, MOTIVO, MEDIO_PAGO,
            DESCRIPCION, ANULADA, USUARIO_ID, PUNTO_VENTA_ID, DESTINO_PAGO
          )
          OUTPUT INSERTED.NC_ID
          VALUES (
            @ventaId, @clienteId, @monto, @descuento, @fecha, @motivo, @medioPago,
            @descripcion, @anulada, @usuarioId, @puntoVentaId, @destinoPago
          )
        `);
      const ncId: number = ncInsert.recordset[0].NC_ID;

      // 5) Store total BEFORE NC for historial
      const totalVentaOriginal = venta.TOTAL;

      // 6) Items + Historial + Stock
      if (esConItems && input.items) {
        for (const item of input.items) {
          const viRes = await tx.request()
            .input('vid', sql.Int, input.VENTA_ID)
            .input('pid', sql.Int, item.PRODUCTO_ID)
            .query(`
              SELECT CANTIDAD, PRECIO_UNITARIO, PRECIO_UNITARIO_DTO, DEPOSITO_ID
              FROM VENTAS_ITEMS
              WHERE VENTA_ID = @vid AND PRODUCTO_ID = @pid
            `);
          const vi = viRes.recordset[0];
          const depId = item.DEPOSITO_ID ?? vi.DEPOSITO_ID ?? null;

          // Insert NC item
          await tx.request()
            .input('ncId', sql.Int, ncId)
            .input('ventaId', sql.Int, input.VENTA_ID)
            .input('productoId', sql.Int, item.PRODUCTO_ID)
            .input('cantDevuelta', sql.Decimal(18, 2), item.CANTIDAD_DEVUELTA)
            .input('precioUnit', sql.Decimal(18, 2), item.PRECIO_UNITARIO)
            .input('depositoId', sql.Int, depId)
            .query(`
              INSERT INTO NC_VENTAS_ITEMS (NC_ID, VENTA_ID, PRODUCTO_ID, CANTIDAD_DEVUELTA, PRECIO_UNITARIO, DEPOSITO_ID)
              VALUES (@ncId, @ventaId, @productoId, @cantDevuelta, @precioUnit, @depositoId)
            `);

          // Calculate modified values
          const cantidadModificada = r2(vi.CANTIDAD - item.CANTIDAD_DEVUELTA);
          const totalProductoModificado = r2(cantidadModificada * (vi.PRECIO_UNITARIO_DTO || vi.PRECIO_UNITARIO));
          const totalVentaModificado = r2(totalVentaOriginal - monto);

          // Insert historial row
          await tx.request()
            .input('ventaId', sql.Int, input.VENTA_ID)
            .input('ncId', sql.Int, ncId)
            .input('fecha', sql.DateTime, new Date())
            .input('productoId', sql.Int, item.PRODUCTO_ID)
            .input('cantOriginal', sql.Decimal(18, 2), vi.CANTIDAD)
            .input('cantModificado', sql.Decimal(18, 2), cantidadModificada)
            .input('precioOriginal', sql.Decimal(18, 2), vi.PRECIO_UNITARIO)
            .input('precioModificado', sql.Decimal(18, 2), vi.PRECIO_UNITARIO)
            .input('totalProdOriginal', sql.Decimal(18, 2), r2(vi.CANTIDAD * (vi.PRECIO_UNITARIO_DTO || vi.PRECIO_UNITARIO)))
            .input('totalProdModificado', sql.Decimal(18, 2), totalProductoModificado)
            .input('totalVentaOriginal', sql.Decimal(18, 2), totalVentaOriginal)
            .input('totalVentaModificado', sql.Decimal(18, 2), totalVentaModificado)
            .input('motivo', sql.VarChar(50), input.MOTIVO)
            .input('depositoId', sql.Int, depId)
            .query(`
              INSERT INTO NC_VENTAS_HISTORIAL (
                VENTA_ID, NC_ID, FECHA, PRODUCTO_ID,
                CANTIDAD_ORIGINAL, CANTIDAD_MODIFICADO,
                PRECIO_ORIGINAL, PRECIO_MODIFICADO,
                TOTAL_PRODUCTO_ORIGINAL, TOTAL_PRODUCTO_MODIFICADO,
                TOTAL_VENTA_ORIGINAL, TOTAL_VENTA_MODIFICADO,
                MOTIVO, DEPOSITO_ID
              ) VALUES (
                @ventaId, @ncId, @fecha, @productoId,
                @cantOriginal, @cantModificado,
                @precioOriginal, @precioModificado,
                @totalProdOriginal, @totalProdModificado,
                @totalVentaOriginal, @totalVentaModificado,
                @motivo, @depositoId
              )
            `);

          // Increment stock (devolution = customer returns product → increase OUR stock)
          await incrementarStockTx(tx, item.PRODUCTO_ID, item.CANTIDAD_DEVUELTA, depId, ncId, usuarioId);
        }
      } else {
        // For DESCUENTO / DIFERENCIA PRECIO — no items, just a single historial entry
        const totalVentaModificado = r2(totalVentaOriginal - monto);
        await tx.request()
          .input('ventaId', sql.Int, input.VENTA_ID)
          .input('ncId', sql.Int, ncId)
          .input('fecha', sql.DateTime, new Date())
          .input('productoId', sql.Int, 0)
          .input('cantOriginal', sql.Decimal(18, 2), 0)
          .input('cantModificado', sql.Decimal(18, 2), 0)
          .input('precioOriginal', sql.Decimal(18, 2), 0)
          .input('precioModificado', sql.Decimal(18, 2), 0)
          .input('totalProdOriginal', sql.Decimal(18, 2), 0)
          .input('totalProdModificado', sql.Decimal(18, 2), 0)
          .input('totalVentaOriginal', sql.Decimal(18, 2), totalVentaOriginal)
          .input('totalVentaModificado', sql.Decimal(18, 2), totalVentaModificado)
          .input('motivo', sql.VarChar(50), input.MOTIVO)
          .input('depositoId', sql.Int, null)
          .query(`
            INSERT INTO NC_VENTAS_HISTORIAL (
              VENTA_ID, NC_ID, FECHA, PRODUCTO_ID,
              CANTIDAD_ORIGINAL, CANTIDAD_MODIFICADO,
              PRECIO_ORIGINAL, PRECIO_MODIFICADO,
              TOTAL_PRODUCTO_ORIGINAL, TOTAL_PRODUCTO_MODIFICADO,
              TOTAL_VENTA_ORIGINAL, TOTAL_VENTA_MODIFICADO,
              MOTIVO, DEPOSITO_ID
            ) VALUES (
              @ventaId, @ncId, @fecha, @productoId,
              @cantOriginal, @cantModificado,
              @precioOriginal, @precioModificado,
              @totalProdOriginal, @totalProdModificado,
              @totalVentaOriginal, @totalVentaModificado,
              @motivo, @depositoId
            )
          `);
      }

      // 7) Update sale total
      await tx.request()
        .input('vid', sql.Int, input.VENTA_ID)
        .input('monto', sql.Decimal(18, 2), monto)
        .query('UPDATE VENTAS SET TOTAL = TOTAL - @monto WHERE VENTA_ID = @vid');

      // 8) Handle payment side-effects (CC balance / Caja)
      if (input.MEDIO_PAGO === 'CC') {
        // Register in VENTAS_CTA_CORRIENTE (HABER = reduces what customer owes)
        const ctaCteRes = await tx.request()
          .input('cid', sql.Int, input.CLIENTE_ID)
          .query('SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @cid');
        if (ctaCteRes.recordset.length > 0) {
          const ctaCteId = ctaCteRes.recordset[0].CTA_CORRIENTE_ID;
          await tx.request()
            .input('comprobanteId', sql.Int, ncId)
            .input('ctaCteId', sql.Int, ctaCteId)
            .input('fecha', sql.DateTime, new Date())
            .input('concepto', sql.NVarChar(255), `NC Venta #${ncId} - ${input.MOTIVO}`)
            .input('tipoComp', sql.NVarChar(50), 'NCA')
            .input('debe', sql.Decimal(18, 2), 0)
            .input('haber', sql.Decimal(18, 2), monto)
            .query(`
              INSERT INTO VENTAS_CTA_CORRIENTE
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
            // Fetch method categories
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
              .input('origenTipo', sql.VarChar(30), 'NC_VENTA')
              .input('efectivo', sql.Decimal(18, 2), -r2(montoEfectivo))
              .input('digital', sql.Decimal(18, 2), -r2(montoDigital))
              .input('descr', sql.NVarChar(255), `NC Venta #${ncId} - ${input.MOTIVO}`)
              .input('uid', sql.Int, usuarioId)
              .query(`
                INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
                VALUES (@cajaId, GETDATE(), @origenTipo, @efectivo, @digital, @descr, @uid)
              `);
          } else {
            // CAJA_CENTRAL
            const totalEgreso = r2(montoEfectivo + montoDigital);
            const movResult = await tx.request()
              .input('tipoEntidad', sql.VarChar(20), 'NC_VENTA')
              .input('movimiento', sql.NVarChar(500), `NC Venta #${ncId} - ${input.MOTIVO}`)
              .input('uid', sql.Int, usuarioId)
              .input('efectivo', sql.Decimal(18, 2), -r2(montoEfectivo))
              .input('digital', sql.Decimal(18, 2), -r2(montoDigital))
              .input('total', sql.Decimal(18, 2), -totalEgreso)
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
                  .input('monto', sql.Decimal(18, 2), -r2(mp.MONTO))
                  .query(`INSERT INTO MOVIMIENTOS_CAJA_METODOS_PAGO (MOVIMIENTO_ID, METODO_PAGO_ID, MONTO) VALUES (@movId, @mpId, @monto)`);
              }
            }
          }
        }
      }

      await tx.commit();

      // 9) Emit fiscal NC if requested and FE is enabled
      let fiscalResult: any = null;
      if (input.EMITIR_FISCAL && venta.NUMERO_FISCAL) {
        try {
          fiscalResult = await this.emitirNCFiscal(ncId);
        } catch (err: any) {
          // Don't fail the NC creation if fiscal emission fails
          console.error('Error emitting fiscal NC:', err.message);
          fiscalResult = { success: false, error: err.message };
        }
      }

      return { NC_ID: ncId, MONTO: monto, fiscal: fiscalResult };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Emit fiscal NC via ARCA ─────────────────────
  async emitirNCFiscal(ncId: number) {
    if (!facturacionService.isEnabled() || !facturacionService.isArcaConfigured()) {
      throw validationError('La facturación electrónica no está habilitada o configurada');
    }

    const pool = await getPool();

    // Get NC data
    const ncRes = await pool.request()
      .input('ncId', sql.Int, ncId)
      .query(`
        SELECT nc.*, v.TIPO_COMPROBANTE AS VENTA_TIPO_COMPROBANTE,
               v.NUMERO_FISCAL AS VENTA_NUMERO_FISCAL, v.CAE AS VENTA_CAE,
               v.PUNTO_VENTA AS VENTA_PUNTO_VENTA, v.FECHA_VENTA,
               v.CLIENTE_ID AS VENTA_CLIENTE_ID
        FROM NC_VENTAS nc
        JOIN VENTAS v ON v.VENTA_ID = nc.VENTA_ID
        WHERE nc.NC_ID = @ncId
      `);
    if (ncRes.recordset.length === 0) throw validationError('NC no encontrada');
    const nc = ncRes.recordset[0];

    if (nc.EMITIDA_FISCAL) {
      throw validationError('Esta NC ya fue emitida fiscalmente');
    }

    if (!nc.VENTA_NUMERO_FISCAL) {
      throw validationError('La venta asociada no tiene factura emitida. No se puede emitir NC fiscal.');
    }

    // Get client data
    const clienteData = await facturacionService.getClienteData(nc.CLIENTE_ID || nc.VENTA_CLIENTE_ID);

    // Determine NC comprobante type based on original factura
    const ventaTipoComp = nc.VENTA_TIPO_COMPROBANTE || 'Fa.B';
    const ncCbteTipo = mapFacturaToNCTipo(ventaTipoComp);
    const esNCConIVA = ncCbteTipo === CBTE_TIPOS['NOTA DE CREDITO A'] || ncCbteTipo === CBTE_TIPOS['NOTA DE CREDITO B'];

    // Get fiscal punto de venta
    const puntoVenta = parseInt(await facturacionService.getPuntoVentaFiscal(), 10);

    // Authenticate with ARCA
    const auth = await getAuth();

    // Get last authorized receipt number for this NC type
    const ultimoNro = await feCompUltimoAutorizado(auth, puntoVenta, ncCbteTipo, config.arca.environment);
    const cbteNro = ultimoNro + 1;

    const fecha = formatFechaARCA(new Date());
    const impTotal = nc.MONTO;

    // Calculate IVA breakdown from NC items (or use simple approach for non-item NCs)
    let totalNeto = 0;
    let totalIVA = 0;
    let totalExentos = 0;
    const ivaMap = new Map<number, { baseImp: number; importe: number }>();

    const ncItems = await pool.request()
      .input('ncId', sql.Int, ncId)
      .query(`
        SELECT nci.*, vi.IVA_ALICUOTA, vi.DESCUENTO, vi.PRECIO_UNITARIO_DTO
        FROM NC_VENTAS_ITEMS nci
        LEFT JOIN VENTAS_ITEMS vi ON vi.VENTA_ID = nci.VENTA_ID AND vi.PRODUCTO_ID = nci.PRODUCTO_ID
        WHERE nci.NC_ID = @ncId
      `);

    if (ncItems.recordset.length > 0 && esNCConIVA) {
      for (const item of ncItems.recordset) {
        const lineTotal = r2(item.CANTIDAD_DEVUELTA * item.PRECIO_UNITARIO);
        const alicuotaDecimal = item.IVA_ALICUOTA || 0;

        if (alicuotaDecimal > 0) {
          const { neto, iva } = calcularNetoEIva(lineTotal, alicuotaDecimal);
          totalNeto += neto;
          totalIVA += iva;
          const alicPct = Math.round(alicuotaDecimal * 10000) / 100;
          const existing = ivaMap.get(alicPct) || { baseImp: 0, importe: 0 };
          existing.baseImp += neto;
          existing.importe += iva;
          ivaMap.set(alicPct, existing);
        } else {
          totalNeto += lineTotal;
        }
      }
    } else {
      // For non-item NCs or Factura C, everything is neto
      totalNeto = impTotal;
    }

    // Build IVA array for ARCA
    const ivaArray: FEAlicuotaIva[] = [];
    for (const [alicPct, values] of ivaMap) {
      const ivaId = IVA_IDS[alicPct];
      if (!ivaId) {
        throw validationError(`Alícuota de IVA ${alicPct}% no reconocida por ARCA`);
      }
      ivaArray.push({
        Id: ivaId,
        BaseImp: r2(values.baseImp),
        Importe: r2(values.importe),
      });
    }

    totalNeto = r2(totalNeto);
    totalIVA = r2(totalIVA);

    // Build CbtesAsoc — reference to the original factura
    const originalCbteTipo = (() => {
      switch (ventaTipoComp) {
        case 'Fa.A': return CBTE_TIPOS['FACTURA A'];
        case 'Fa.B': return CBTE_TIPOS['FACTURA B'];
        case 'Fa.C': return CBTE_TIPOS['FACTURA C'];
        default: return CBTE_TIPOS['FACTURA B'];
      }
    })();

    const cbtesAsoc = [{
      Tipo: originalCbteTipo,
      PtoVta: parseInt(nc.VENTA_PUNTO_VENTA || '1', 10),
      Nro: parseInt(nc.VENTA_NUMERO_FISCAL || '0', 10),
      Cuit: config.arca.cuit,
      CbteFch: formatFechaARCA(new Date(nc.FECHA_VENTA)),
    }];

    // Build ARCA comprobante
    const comprobante: FEComprobante = {
      CbteTipo: ncCbteTipo,
      Concepto: CONCEPTO.PRODUCTOS,
      DocTipo: clienteData.docTipo,
      DocNro: clienteData.docNro,
      CbteDesde: cbteNro,
      CbteHasta: cbteNro,
      CbteFch: fecha,
      ImpTotal: impTotal,
      ImpTotConc: 0,
      ImpNeto: esNCConIVA ? totalNeto : impTotal - totalExentos,
      ImpOpEx: totalExentos,
      ImpIVA: totalIVA,
      ImpTrib: 0,
      MonId: 'PES',
      MonCotiz: 1,
      Iva: ivaArray.length > 0 ? ivaArray : undefined,
      CbtesAsoc: cbtesAsoc,
      CondicionIvaReceptor: getCondicionIvaReceptorId(clienteData.condicionIva),
    };

    // Call ARCA
    const respuesta = await feCAESolicitar(auth, puntoVenta, comprobante, config.arca.environment);

    const detResp = respuesta.FeDetResp?.[0];
    const resultado = detResp?.Resultado || respuesta.FeCabResp?.Resultado || 'R';

    if (resultado === 'A') {
      const cae = detResp?.CAE || '';
      const caeVto = detResp?.CAEFchVto || '';
      const numeroFiscal = String(cbteNro).padStart(8, '0');
      const tipoInterno = mapNCTipoToInterno(ncCbteTipo);
      const ptoVtaStr = String(puntoVenta).padStart(5, '0');

      // Update NC_VENTAS with fiscal data
      await pool.request()
        .input('ncId', sql.Int, ncId)
        .input('nf', sql.NVarChar, numeroFiscal)
        .input('cae', sql.NVarChar, cae)
        .input('caeVto', sql.NVarChar, caeVto)
        .input('pv', sql.NVarChar, ptoVtaStr)
        .input('tc', sql.NVarChar, tipoInterno)
        .input('nroComp', sql.NVarChar, numeroFiscal)
        .query(`
          UPDATE NC_VENTAS
          SET NUMERO_FISCAL = @nf, CAE = @cae, CAE_VTO = @caeVto,
              PUNTO_VENTA = @pv, TIPO_COMPROBANTE = @tc, NRO_COMPROBANTE = @nroComp,
              EMITIDA_FISCAL = 1
          WHERE NC_ID = @ncId
        `);

      // Update MOVIMIENTOS_CAJA / CAJA_ITEMS description with fiscal number
      const fiscalDesc = `NC Venta ${tipoInterno} ${ptoVtaStr}-${numeroFiscal}`;
      const oldDescPattern = `NC Venta #${ncId} -%`;
      try {
        await pool.request()
          .input('newDesc', sql.NVarChar(500), fiscalDesc + ' - ' + (nc.MOTIVO || ''))
          .input('ncId', sql.Int, ncId)
          .input('pattern', sql.NVarChar(500), oldDescPattern)
          .query(`
            UPDATE MOVIMIENTOS_CAJA SET MOVIMIENTO = @newDesc
            WHERE TIPO_ENTIDAD = 'NC_VENTA' AND MOVIMIENTO LIKE @pattern
          `);
        await pool.request()
          .input('newDesc', sql.NVarChar(255), fiscalDesc + ' - ' + (nc.MOTIVO || ''))
          .input('pattern', sql.NVarChar(255), oldDescPattern)
          .query(`
            UPDATE CAJA_ITEMS SET DESCRIPCION = @newDesc
            WHERE ORIGEN_TIPO = 'NC_VENTA' AND DESCRIPCION LIKE @pattern
          `);
      } catch { /* non-critical */ }

      return {
        success: true,
        comprobante_nro: `${ptoVtaStr}-${numeroFiscal}`,
        cae,
        cae_vto: caeVto,
        tipo_comprobante: tipoInterno,
      };
    } else {
      const errores: string[] = [];
      if (respuesta.Errors) {
        errores.push(...respuesta.Errors.map(e => `[${e.Code}] ${e.Msg}`));
      }
      if (detResp?.Observaciones) {
        errores.push(...detResp.Observaciones.map(o => `[${o.Code}] ${o.Msg}`));
      }

      return {
        success: false,
        comprobante_nro: '',
        cae: '',
        cae_vto: '',
        tipo_comprobante: '',
        errores,
      };
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
          SELECT NC_ID, VENTA_ID, MONTO, MOTIVO, MEDIO_PAGO, CLIENTE_ID,
                 ANULADA, DESCRIPCION, DESTINO_PAGO
          FROM NC_VENTAS
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
        .query('UPDATE NC_VENTAS SET ANULADA = 1 WHERE NC_ID = @ncId');

      // 3) Insert ND_VENTAS (Nota de Débito — reversal)
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      const puntoVentaId = caja?.PUNTO_VENTA_ID ?? null;

      const ndRes = await tx.request()
        .input('ventaId', sql.Int, nc.VENTA_ID)
        .input('ncId', sql.Int, ncId)
        .input('clienteId', sql.Int, nc.CLIENTE_ID)
        .input('monto', sql.Decimal(18, 2), nc.MONTO)
        .input('fecha', sql.DateTime, new Date())
        .input('motivo', sql.NVarChar(100), `Anulación NC #${ncId}`)
        .input('medioPago', sql.NVarChar(100), nc.MEDIO_PAGO)
        .input('descripcion', sql.NVarChar(250), `Anulación automática de NC #${ncId}`)
        .input('anulada', sql.Bit, 0)
        .input('usuarioId', sql.Int, usuarioId)
        .input('puntoVentaId', sql.Int, puntoVentaId)
        .query(`
          INSERT INTO ND_VENTAS (
            VENTA_ID, NC_ID, CLIENTE_ID, MONTO, FECHA, MOTIVO, MEDIO_PAGO,
            DESCRIPCION, ANULADA, USUARIO_ID, PUNTO_VENTA_ID
          )
          OUTPUT INSERTED.ND_ID
          VALUES (
            @ventaId, @ncId, @clienteId, @monto, @fecha, @motivo, @medioPago,
            @descripcion, @anulada, @usuarioId, @puntoVentaId
          )
        `);
      const ndId = ndRes.recordset[0].ND_ID;

      // 4) Restore sale total
      await tx.request()
        .input('vid', sql.Int, nc.VENTA_ID)
        .input('monto', sql.Decimal(18, 2), nc.MONTO)
        .query('UPDATE VENTAS SET TOTAL = TOTAL + @monto WHERE VENTA_ID = @vid');

      // 5) Reverse stock if devolution/anulacion
      const esConItems = nc.MOTIVO === 'POR DEVOLUCION' || nc.MOTIVO === 'POR ANULACION';
      if (esConItems) {
        const ncItems = await tx.request()
          .input('ncId', sql.Int, ncId)
          .query(`
            SELECT PRODUCTO_ID, CANTIDAD_DEVUELTA, DEPOSITO_ID
            FROM NC_VENTAS_ITEMS
            WHERE NC_ID = @ncId
          `);
        for (const item of ncItems.recordset) {
          await decrementarStockTx(tx, item.PRODUCTO_ID, parseFloat(item.CANTIDAD_DEVUELTA), item.DEPOSITO_ID, ncId, usuarioId);
        }
      }

      // 6) Reverse payment effects
      if (nc.MEDIO_PAGO === 'CC') {
        const ctaCteRes = await tx.request()
          .input('cid', sql.Int, nc.CLIENTE_ID)
          .query('SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @cid');
        if (ctaCteRes.recordset.length > 0) {
          const ctaCteId = ctaCteRes.recordset[0].CTA_CORRIENTE_ID;
          await tx.request()
            .input('comprobanteId', sql.Int, ndId)
            .input('ctaCteId', sql.Int, ctaCteId)
            .input('fecha', sql.DateTime, new Date())
            .input('concepto', sql.NVarChar(255), `ND Venta (anulación NC #${ncId})`)
            .input('tipoComp', sql.NVarChar(50), 'NDA')
            .input('debe', sql.Decimal(18, 2), nc.MONTO)
            .input('haber', sql.Decimal(18, 2), 0)
            .query(`
              INSERT INTO VENTAS_CTA_CORRIENTE
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
              .input('origenTipo', sql.VarChar(30), 'ND_VENTA')
              .input('efectivo', sql.Decimal(18, 2), nc.MONTO)
              .input('descr', sql.NVarChar(255), `ND (anulación NC #${ncId})`)
              .input('uid', sql.Int, usuarioId)
              .query(`
                INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
                VALUES (@cajaId, GETDATE(), @origenTipo, @efectivo, 0, @descr, @uid)
              `);
          } else {
            await tx.request()
              .input('tipoEntidad', sql.VarChar(20), 'ND_VENTA')
              .input('movimiento', sql.NVarChar(500), `ND (anulación NC #${ncId})`)
              .input('uid', sql.Int, usuarioId)
              .input('efectivo', sql.Decimal(18, 2), nc.MONTO)
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
