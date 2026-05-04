import { getPool, sql } from '../database/connection.js';
import { config } from '../config/index.js';
import type { Venta, VentaItem, VentaMetodoPago, PaginatedResult } from '../types/index.js';
import { registrarHistorialStock, getCurrentStock } from './stockHistorial.helper.js';
import { crearChequeEnCartera } from './cheques.service.js';

// ═══════════════════════════════════════════════════
//  Sales Service — Full CRUD + Payment Management
// ═══════════════════════════════════════════════════

export interface VentaFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  clienteId?: number;
  puntoVentaId?: number;
  cobrada?: boolean;
  usuarioId?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface VentaItemInput {
  PRODUCTO_ID: number;
  PRECIO_UNITARIO: number;
  CANTIDAD: number;
  DESCUENTO: number;
  PRECIO_COMPRA: number;
  DEPOSITO_ID?: number;
  LISTA_ID?: number;
  PROMOCION_ID?: number | null;
  CANTIDAD_PROMO?: number | null;
  PRECIO_PROMOCION?: number | null;
  IMPUESTO_INTERNO_PORCENTAJE?: number;
  IMPUESTO_INTERNO_MONTO?: number;
  IMPUESTO_INTERNO_TIPO?: number;
  IVA_ALICUOTA?: number;
  IVA_MONTO?: number;
  CANTIDAD_PRODUCTOS_PROMO?: number;
  DESDE_REMITO?: boolean;
}

export interface MetodoPagoItem {
  METODO_PAGO_ID: number;
  MONTO: number;
  /** Datos del cheque cuando el método seleccionado es de categoría CHEQUES.
   *  Si está presente, el backend crea automáticamente un registro en la
   *  tabla CHEQUES en estado EN_CARTERA. */
  cheque?: {
    BANCO: string;
    LIBRADOR: string;
    NUMERO: string;
    PORTADOR?: string | null;
    FECHA_PRESENTACION?: string | null;
  };
}

export interface VentaInput {
  CLIENTE_ID: number;
  FECHA_VENTA?: string;
  TIPO_COMPROBANTE?: string;
  PUNTO_VENTA_ID: number;
  ES_CTA_CORRIENTE?: boolean;
  MONTO_EFECTIVO?: number;
  MONTO_DIGITAL?: number;
  VUELTO?: number;
  DTO_GRAL?: number;
  COBRADA?: boolean;
  items: VentaItemInput[];
  metodos_pago?: MetodoPagoItem[];
  PEDIDO_ID?: number;
  MESA_ID?: number;
  REMITO_IDS?: number[];
}

export interface PaymentInput {
  MONTO_EFECTIVO: number;
  MONTO_DIGITAL: number;
  VUELTO: number;
  parcial?: boolean;
  metodos_pago?: MetodoPagoItem[];
}

// ── Stock helpers ────────────────────────────────

/**
 * Decrement stock for a product.
 * - Conjuntos (kits): decrements children via PRODUCTO_CONJUNTO_DEPOSITO,
 *   then parent if DESCUENTA_STOCK is true.
 * - Normal products: only decrements if DESCUENTA_STOCK is true.
 */
async function decrementarStock(
  tx: any,
  productoId: number,
  cantidad: number,
  depositoId: number | null,
  referenciaId?: number,
  usuarioId?: number
) {
  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query(`SELECT ES_CONJUNTO, DESCUENTA_STOCK FROM PRODUCTOS WHERE PRODUCTO_ID = @pid`);
  if (prod.recordset.length === 0) return;

  const esConjunto = prod.recordset[0].ES_CONJUNTO;
  const descuentaStock = prod.recordset[0].DESCUENTA_STOCK;

  if (esConjunto) {
    // Decrement children
    const children = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT PRODUCTO_ID_HIJO, DEPOSITO_ID, CANTIDAD
              FROM PRODUCTO_CONJUNTO_DEPOSITO WHERE PRODUCTO_ID = @pid`);

    for (const child of children.recordset) {
      const childQty = cantidad * child.CANTIDAD;
      const prevStock = await getCurrentStock(tx, child.PRODUCTO_ID_HIJO, child.DEPOSITO_ID);
      const childExists = await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('depId', sql.Int, child.DEPOSITO_ID)
        .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      if (childExists.recordset.length > 0) {
        await tx.request()
          .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
          .input('depId', sql.Int, child.DEPOSITO_ID)
          .input('cant', sql.Decimal(18, 4), childQty)
          .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant
                  WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      } else {
        await tx.request()
          .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
          .input('depId', sql.Int, child.DEPOSITO_ID)
          .input('cant', sql.Decimal(18, 4), childQty)
          .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@prodId, @depId, -@cant)');
      }
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('cant', sql.Decimal(18, 4), childQty)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
      await registrarHistorialStock(tx, {
        productoId: child.PRODUCTO_ID_HIJO, depositoId: child.DEPOSITO_ID,
        cantidadAnterior: prevStock, cantidadNueva: prevStock - childQty,
        tipoOperacion: 'VENTA', referenciaId, referenciaDetalle: `Venta #${referenciaId || ''}`, usuarioId,
      });
    }

    // Also decrement parent if DESCUENTA_STOCK
    if (descuentaStock) {
      if (depositoId) {
        const prevStock = await getCurrentStock(tx, productoId, depositoId);
        const parentExists = await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
        if (parentExists.recordset.length > 0) {
          await tx.request()
            .input('prodId', sql.Int, productoId)
            .input('depId', sql.Int, depositoId)
            .input('cant', sql.Decimal(18, 4), cantidad)
            .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant
                    WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
        } else {
          await tx.request()
            .input('prodId', sql.Int, productoId)
            .input('depId', sql.Int, depositoId)
            .input('cant', sql.Decimal(18, 4), cantidad)
            .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@prodId, @depId, -@cant)');
        }
        await registrarHistorialStock(tx, {
          productoId, depositoId,
          cantidadAnterior: prevStock, cantidadNueva: prevStock - cantidad,
          tipoOperacion: 'VENTA', referenciaId, referenciaDetalle: `Venta #${referenciaId || ''}`, usuarioId,
        });
      }
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
    }
  } else if (descuentaStock) {
    if (depositoId) {
      const prevStock = await getCurrentStock(tx, productoId, depositoId);
      const depExists = await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('depId', sql.Int, depositoId)
        .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      if (depExists.recordset.length > 0) {
        await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 4), cantidad)
          .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD - @cant
                  WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      } else {
        await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 4), cantidad)
          .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@prodId, @depId, -@cant)');
      }
      await registrarHistorialStock(tx, {
        productoId, depositoId,
        cantidadAnterior: prevStock, cantidadNueva: prevStock - cantidad,
        tipoOperacion: 'VENTA', referenciaId, referenciaDetalle: `Venta #${referenciaId || ''}`, usuarioId,
      });
    }
    await tx.request()
      .input('prodId', sql.Int, productoId)
      .input('cant', sql.Decimal(18, 4), cantidad)
      .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD - @cant WHERE PRODUCTO_ID = @prodId`);
  }
}

/**
 * Restore stock for a product (reverse of decrementarStock).
 */
async function restaurarStock(
  tx: any,
  productoId: number,
  cantidad: number,
  depositoId: number | null,
  referenciaId?: number,
  usuarioId?: number
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
      const prevStock = await getCurrentStock(tx, child.PRODUCTO_ID_HIJO, child.DEPOSITO_ID);
      const childExistsR = await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('depId', sql.Int, child.DEPOSITO_ID)
        .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      if (childExistsR.recordset.length > 0) {
        await tx.request()
          .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
          .input('depId', sql.Int, child.DEPOSITO_ID)
          .input('cant', sql.Decimal(18, 4), childQty)
          .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant
                  WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      } else {
        await tx.request()
          .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
          .input('depId', sql.Int, child.DEPOSITO_ID)
          .input('cant', sql.Decimal(18, 4), childQty)
          .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@prodId, @depId, @cant)');
      }
      await tx.request()
        .input('prodId', sql.Int, child.PRODUCTO_ID_HIJO)
        .input('cant', sql.Decimal(18, 4), childQty)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
      await registrarHistorialStock(tx, {
        productoId: child.PRODUCTO_ID_HIJO, depositoId: child.DEPOSITO_ID,
        cantidadAnterior: prevStock, cantidadNueva: prevStock + childQty,
        tipoOperacion: 'VENTA', referenciaId, referenciaDetalle: `Anulación Venta #${referenciaId || ''}`, usuarioId,
      });
    }

    if (descuentaStock) {
      if (depositoId) {
        const prevStock = await getCurrentStock(tx, productoId, depositoId);
        const parentExistsR = await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
        if (parentExistsR.recordset.length > 0) {
          await tx.request()
            .input('prodId', sql.Int, productoId)
            .input('depId', sql.Int, depositoId)
            .input('cant', sql.Decimal(18, 4), cantidad)
            .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant
                    WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
        } else {
          await tx.request()
            .input('prodId', sql.Int, productoId)
            .input('depId', sql.Int, depositoId)
            .input('cant', sql.Decimal(18, 4), cantidad)
            .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@prodId, @depId, @cant)');
        }
        await registrarHistorialStock(tx, {
          productoId, depositoId,
          cantidadAnterior: prevStock, cantidadNueva: prevStock + cantidad,
          tipoOperacion: 'VENTA', referenciaId, referenciaDetalle: `Anulación Venta #${referenciaId || ''}`, usuarioId,
        });
      }
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('cant', sql.Decimal(18, 4), cantidad)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
    }
  } else if (descuentaStock) {
    if (depositoId) {
      const prevStock = await getCurrentStock(tx, productoId, depositoId);
      const depExistsR = await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('depId', sql.Int, depositoId)
        .query('SELECT 1 AS E FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId');
      if (depExistsR.recordset.length > 0) {
        await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 4), cantidad)
          .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = CANTIDAD + @cant
                  WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      } else {
        await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 4), cantidad)
          .query('INSERT INTO STOCK_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@prodId, @depId, @cant)');
      }
      await registrarHistorialStock(tx, {
        productoId, depositoId,
        cantidadAnterior: prevStock, cantidadNueva: prevStock + cantidad,
        tipoOperacion: 'VENTA', referenciaId, referenciaDetalle: `Anulación Venta #${referenciaId || ''}`, usuarioId,
      });
    }
    await tx.request()
      .input('prodId', sql.Int, productoId)
      .input('cant', sql.Decimal(18, 4), cantidad)
      .query(`UPDATE PRODUCTOS SET CANTIDAD = CANTIDAD + @cant WHERE PRODUCTO_ID = @prodId`);
  }
}

// ── Audit helper ─────────────────────────────────

async function registrarAuditoria(
  tx: any,
  tipoEntidad: string,
  entidadId: number,
  tipoMovimiento: string,
  usuarioId: number,
  puntoVentaId: number | null,
  cajaId: number | null,
  monto: number,
  descripcion: string
) {
  try {
    await tx.request()
      .input('TipoEntidad', sql.NVarChar(50), tipoEntidad)
      .input('EntidadId', sql.Int, entidadId)
      .input('TipoMovimiento', sql.NVarChar(50), tipoMovimiento)
      .input('UsuarioId', sql.Int, usuarioId)
      .input('PuntoVentaId', sql.Int, puntoVentaId)
      .input('CajaId', sql.Int, cajaId)
      .input('Descripcion', sql.NVarChar(500), descripcion)
      .input('Monto', sql.Decimal(18, 2), monto)
      .output('AuditoriaId', sql.BigInt)
      .execute('SP_REGISTRAR_AUDITORIA');
  } catch {
    // Audit failure should not abort the transaction
    console.warn(`Audit registration failed for ${tipoEntidad} ${entidadId} (${tipoMovimiento})`);
  }
}

// ── Caja helper ──────────────────────────────────

async function getCajaAbiertaTx(
  tx: any,
  usuarioId: number
): Promise<{ CAJA_ID: number } | null> {
  const result = await tx.request()
    .input('uid', sql.Int, usuarioId)
    .query(`SELECT CAJA_ID FROM CAJA WHERE USUARIO_ID = @uid AND ESTADO = 'ACTIVA'`);
  return result.recordset.length > 0 ? result.recordset[0] : null;
}

// ── CTA Corriente helper ─────────────────────────

async function ensureCtaCorriente(tx: any, clienteId: number): Promise<number> {
  const existing = await tx.request()
    .input('cid', sql.Int, clienteId)
    .query(`SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @cid`);

  if (existing.recordset.length > 0) {
    return existing.recordset[0].CTA_CORRIENTE_ID;
  }

  // Create new CTA_CORRIENTE_C row
  const result = await tx.request()
    .input('cid', sql.Int, clienteId)
    .query(`
      INSERT INTO CTA_CORRIENTE_C (CLIENTE_ID, FECHA) VALUES (@cid, GETDATE());
      SELECT SCOPE_IDENTITY() AS CTA_CORRIENTE_ID;
    `);
  return result.recordset[0].CTA_CORRIENTE_ID;
}

// ── Round helper ─────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── NETO_EXENTO column helper ────────────────────

let _netoExentoColumnReady = false;

async function ensureNetoExentoColumn(pool: any): Promise<void> {
  if (_netoExentoColumnReady) return;
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('VENTAS') AND name = 'NETO_EXENTO')
      ALTER TABLE VENTAS ADD NETO_EXENTO DECIMAL(18,2) NULL DEFAULT 0
  `);
  _netoExentoColumnReady = true;
}

// ── DESDE_REMITO column helper ───────────────────

let _desdeRemitoColumnReady = false;

async function ensureDesdeRemitoColumn(pool: any): Promise<void> {
  if (_desdeRemitoColumnReady) return;
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('VENTAS_ITEMS') AND name = 'DESDE_REMITO')
      ALTER TABLE VENTAS_ITEMS ADD DESDE_REMITO BIT NOT NULL DEFAULT 0
  `);
  _desdeRemitoColumnReady = true;
}

// ── VENTAS_METODOS_PAGO table helper ─────────────

let _metodosPagoTableReady = false;

async function ensureVentasMetodosPagoTable(pool: any): Promise<void> {
  if (_metodosPagoTableReady) return;
  await pool.request().query(`
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'VENTAS_METODOS_PAGO')
    BEGIN
      CREATE TABLE VENTAS_METODOS_PAGO (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        VENTA_ID        INT           NOT NULL,
        METODO_PAGO_ID  INT           NOT NULL,
        MONTO           DECIMAL(18,2) NOT NULL
      )
    END
  `);
  _metodosPagoTableReady = true;
}

/** Insert payment method breakdown rows within a transaction */
async function insertMetodosPago(
  tx: any,
  ventaId: number,
  metodosPago: MetodoPagoItem[]
): Promise<void> {
  for (const mp of metodosPago) {
    if (mp.MONTO <= 0) continue;
    await tx.request()
      .input('ventaId', sql.Int, ventaId)
      .input('metodoId', sql.Int, mp.METODO_PAGO_ID)
      .input('monto', sql.Decimal(18, 2), r2(mp.MONTO))
      .query(`
        INSERT INTO VENTAS_METODOS_PAGO (VENTA_ID, METODO_PAGO_ID, MONTO)
        VALUES (@ventaId, @metodoId, @monto)
      `);
  }
}

/** Crea registros en CHEQUES (estado EN_CARTERA) para cada método de pago
 *  cuyo método sea categoría CHEQUES y traiga payload `cheque`. */
async function crearChequesIngreso(
  tx: any,
  origenTipo: 'VENTA' | 'COBRANZA',
  origenId: number,
  metodosPago: MetodoPagoItem[],
  usuarioId: number,
  usuarioNombre: string | null,
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
      origenTipo,
      origenId,
      usuarioId,
      usuarioNombre,
    );
  }
}

/** Derive MONTO_EFECTIVO/MONTO_DIGITAL/MONTO_CHEQUES from payment methods.
 *  Los cheques NO suman a efectivo ni digital (van en flujo separado). */
async function derivarCategorias(
  tx: any,
  metodosPago: MetodoPagoItem[]
): Promise<{ montoEfectivo: number; montoDigital: number; montoCheques: number }> {
  let montoEfectivo = 0;
  let montoDigital = 0;
  let montoCheques = 0;
  for (const mp of metodosPago) {
    if (mp.MONTO <= 0) continue;
    const cat = await tx.request()
      .input('mid', sql.Int, mp.METODO_PAGO_ID)
      .query(`SELECT CATEGORIA FROM METODOS_PAGO WHERE METODO_PAGO_ID = @mid`);
    const categoria = cat.recordset[0]?.CATEGORIA || 'EFECTIVO';
    if (categoria === 'DIGITAL') {
      montoDigital += mp.MONTO;
    } else if (categoria === 'CHEQUES') {
      montoCheques += mp.MONTO;
    } else {
      montoEfectivo += mp.MONTO;
    }
  }
  return {
    montoEfectivo: r2(montoEfectivo),
    montoDigital: r2(montoDigital),
    montoCheques: r2(montoCheques),
  };
}

// ═══════════════════════════════════════════════════

export const salesService = {
  // ── Get saldo CTA CTE for a customer ────────────
  async getSaldoCtaCte(clienteId: number): Promise<{ saldo: number; ctaCorrienteId: number | null }> {
    const pool = await getPool();
    const cta = await pool.request()
      .input('cid', sql.Int, clienteId)
      .query(`SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @cid`);

    if (cta.recordset.length === 0) {
      return { saldo: 0, ctaCorrienteId: null };
    }

    const ctaId = cta.recordset[0].CTA_CORRIENTE_ID;
    const result = await pool.request()
      .input('ctaId', sql.Int, ctaId)
      .query(`SELECT ISNULL(SUM(DEBE - HABER), 0) AS SALDO FROM VENTAS_CTA_CORRIENTE WHERE CTA_CORRIENTE_ID = @ctaId`);

    return { saldo: result.recordset[0]?.SALDO || 0, ctaCorrienteId: ctaId };
  },

  // ── List with pagination & filters ─────────────
  async getAll(filter: VentaFilter = {}): Promise<PaginatedResult<Venta>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.fechaDesde) {
      where += ' AND CAST(v.FECHA_VENTA AS DATE) >= @fechaDesde';
      params.push({ name: 'fechaDesde', type: sql.VarChar(10), value: filter.fechaDesde });
    }
    if (filter.fechaHasta) {
      where += ' AND CAST(v.FECHA_VENTA AS DATE) <= @fechaHasta';
      params.push({ name: 'fechaHasta', type: sql.VarChar(10), value: filter.fechaHasta });
    }
    if (filter.clienteId) {
      where += ' AND v.CLIENTE_ID = @clienteId';
      params.push({ name: 'clienteId', type: sql.Int, value: filter.clienteId });
    }
    if (filter.puntoVentaId) {
      where += ' AND v.PUNTO_VENTA_ID = @puntoVentaId';
      params.push({ name: 'puntoVentaId', type: sql.Int, value: filter.puntoVentaId });
    }
    if (filter.usuarioId) {
      where += ' AND v.USUARIO_ID = @usuarioId';
      params.push({ name: 'usuarioId', type: sql.Int, value: filter.usuarioId });
    }
    if (filter.cobrada !== undefined) {
      where += ' AND v.COBRADA = @cobrada';
      params.push({ name: 'cobrada', type: sql.Bit, value: filter.cobrada ? 1 : 0 });
    }
    if (filter.search) {
      where += ` AND (c.NOMBRE LIKE @search OR v.NUMERO_FISCAL LIKE @search 
                  OR CAST(v.VENTA_ID AS VARCHAR) LIKE @search
                  OR u.NOMBRE LIKE @search)`;
      params.push({ name: 'search', type: sql.NVarChar, value: `%${filter.search}%` });
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    const countResult = await bind(pool.request()).query(`
      SELECT COUNT(*) as total FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
      LEFT JOIN USUARIOS u ON v.USUARIO_ID = u.USUARIO_ID
      ${where}
    `);
    const total = countResult.recordset[0].total;

    const validCols: Record<string, string> = {
      fecha: 'v.FECHA_VENTA', total: 'v.TOTAL', cliente: 'c.NOMBRE',
      usuario: 'u.NOMBRE', id: 'v.VENTA_ID',
    };
    const orderCol = validCols[(filter.orderBy || 'fecha').toLowerCase()] || 'v.FECHA_VENTA';
    const orderDir = filter.orderDir === 'ASC' ? 'ASC' : 'DESC';

    const dataReq = bind(pool.request());
    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query(`
      SELECT 
        v.VENTA_ID, v.CLIENTE_ID, v.FECHA_VENTA, v.TOTAL, v.GANANCIAS,
        v.ES_CTA_CORRIENTE, v.MONTO_EFECTIVO, v.MONTO_DIGITAL, v.VUELTO,
        v.NUMERO_FISCAL, v.CAE, v.PUNTO_VENTA, v.TIPO_COMPROBANTE,
        v.COBRADA, v.PUNTO_VENTA_ID, v.USUARIO_ID,
        ISNULL(v.MONTO_ANTICIPO, 0) AS MONTO_ANTICIPO,
        ISNULL(v.DTO_GRAL, 0) AS DTO_GRAL,
        v.ERROR_FE, v.ERRORES,
        c.NOMBRE AS CLIENTE_NOMBRE,
        u.NOMBRE AS USUARIO_NOMBRE
      FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
      LEFT JOIN USUARIOS u ON v.USUARIO_ID = u.USUARIO_ID
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  // ── Get by ID (full detail with items) ─────────
  async getById(id: number): Promise<Venta & {
    items: VentaItem[];
    remitos_asociados: Array<{
      REMITO_ID: number;
      PTO_VTA: string;
      NRO_REMITO: string;
      FECHA: string;
      TOTAL: number;
    }>;
    metodos_pago: any[];
    nc_asociadas: any[];
  }> {
    const pool = await getPool();

    const ventaResult = await pool
      .request()
      .input('id', sql.Int, id)
      .query<Venta>(`
        SELECT v.*, 
          c.NOMBRE AS CLIENTE_NOMBRE, 
          u.NOMBRE AS USUARIO_NOMBRE
        FROM VENTAS v
        LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
        LEFT JOIN USUARIOS u ON v.USUARIO_ID = u.USUARIO_ID
        WHERE v.VENTA_ID = @id
      `);

    if (ventaResult.recordset.length === 0) {
      throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
    }

    const itemsResult = await pool
      .request()
      .input('id', sql.Int, id)
      .query<VentaItem>(`
        SELECT vi.ITEM_ID, vi.VENTA_ID, vi.PRODUCTO_ID, 
               vi.PRECIO_UNITARIO, vi.CANTIDAD, vi.PRECIO_UNITARIO_DTO, vi.DESCUENTO,
               vi.PROMOCION_ID, vi.CANTIDAD_PROMO, vi.PRECIO_PROMOCION,
               vi.PRECIO_COMPRA, vi.DEPOSITO_ID, vi.LISTA_ID,
               ISNULL(vi.IMPUESTO_INTERNO_PORCENTAJE, 0) AS IMPUESTO_INTERNO_PORCENTAJE,
               ISNULL(vi.IMPUESTO_INTERNO_MONTO, 0) AS IMPUESTO_INTERNO_MONTO,
               ISNULL(vi.IMPUESTO_INTERNO_TIPO, 1) AS IMPUESTO_INTERNO_TIPO,
               ISNULL(vi.IVA_ALICUOTA, 0) AS IVA_ALICUOTA,
               ISNULL(vi.IVA_MONTO, 0) AS IVA_MONTO,
               ISNULL(vi.CANTIDAD_PRODUCTOS_PROMO, 0) AS CANTIDAD_PRODUCTOS_PROMO,
               p.NOMBRE AS PRODUCTO_NOMBRE, 
               p.CODIGOPARTICULAR AS PRODUCTO_CODIGO,
               ISNULL(um.ABREVIACION, 'u') AS UNIDAD_ABREVIACION
        FROM VENTAS_ITEMS vi
        JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
        LEFT JOIN UNIDADES_MEDIDA um ON p.UNIDAD_ID = um.UNIDAD_ID
        WHERE vi.VENTA_ID = @id
        ORDER BY vi.ITEM_ID
      `);

    // ── Linked remitos ──
    let remitos_asociados: Array<{
      REMITO_ID: number;
      PTO_VTA: string;
      NRO_REMITO: string;
      FECHA: string;
      TOTAL: number;
    }> = [];
    try {
      const remitosResult = await pool.request()
        .input('ventaId', sql.Int, id)
        .query<{
          REMITO_ID: number;
          PTO_VTA: string;
          NRO_REMITO: string;
          FECHA: string;
          TOTAL: number;
        }>(`
          SELECT REMITO_ID, PTO_VTA, NRO_REMITO, FECHA, TOTAL
          FROM REMITOS
          WHERE VENTA_ID = @ventaId AND ANULADO = 0
          ORDER BY FECHA
        `);
      remitos_asociados = remitosResult.recordset;
    } catch { /* table may not exist yet */ }

    // ── Payment method breakdown ──
    let metodos_pago: any[] = [];
    try {
      const mpResult = await pool.request()
        .input('ventaId', sql.Int, id)
        .query(`
          SELECT mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64,
                 vmp.MONTO AS TOTAL
          FROM VENTAS_METODOS_PAGO vmp
          JOIN METODOS_PAGO mp ON vmp.METODO_PAGO_ID = mp.METODO_PAGO_ID
          WHERE vmp.VENTA_ID = @ventaId
          ORDER BY CASE WHEN mp.CATEGORIA = 'EFECTIVO' THEN 0 ELSE 1 END, mp.NOMBRE
        `);
      metodos_pago = mpResult.recordset;
    } catch { /* table may not exist yet */ }

    // ── Associated NCs (Notas de Crédito) ──
    let nc_asociadas: any[] = [];
    try {
      const ncResult = await pool.request()
        .input('ventaId', sql.Int, id)
        .query(`
          SELECT NC_ID, FECHA, MOTIVO, MONTO, ANULADA,
                 NUMERO_FISCAL, TIPO_COMPROBANTE, PUNTO_VENTA AS PUNTO_VENTA_FISCAL
          FROM NC_VENTAS
          WHERE VENTA_ID = @ventaId
          ORDER BY FECHA DESC
        `);
      nc_asociadas = ncResult.recordset;
    } catch { /* table may not exist yet */ }

    return {
      ...ventaResult.recordset[0],
      items: itemsResult.recordset,
      remitos_asociados,
      metodos_pago,
      nc_asociadas,
    };
  },

  // ── Create sale with items ─────────────────────
  async create(input: VentaInput, usuarioId: number) {
    const pool = await getPool();
    await ensureNetoExentoColumn(pool);
    await ensureDesdeRemitoColumn(pool);
    const tx = pool.transaction();
    await tx.begin();

    try {
      // ── 1. Batch-fetch IVA rates for all products ──
      const productIds = input.items.map(i => Number(i.PRODUCTO_ID));
      const ivaReq = tx.request();
      productIds.forEach((id, i) => ivaReq.input(`pid${i}`, sql.Int, id));
      const idList = productIds.map((_, i) => `@pid${i}`).join(', ');
      const ivaResult = await ivaReq.query(`
        SELECT p.PRODUCTO_ID, ISNULL(t.PORCENTAJE, 0) AS PORCENTAJE, ISNULL(t.NOMBRE, '') AS TASA_NOMBRE
        FROM PRODUCTOS p
        LEFT JOIN TASAS_IMPUESTOS t ON p.TASA_IVA_ID = t.TASA_ID AND t.ACTIVA = 1
        WHERE p.PRODUCTO_ID IN (${idList})
      `);
      const ivaMap = new Map<number, { porcentaje: number; esExento: boolean }>();
      for (const row of ivaResult.recordset) {
        ivaMap.set(row.PRODUCTO_ID, {
          porcentaje: row.PORCENTAJE,
          esExento: (row.TASA_NOMBRE || '').toUpperCase().includes('EXENTO'),
        });
      }

      // ── 2. Calculate totals from items ──
      let subtotal = 0;
      let ganancias = 0;
      let ivaTotal = 0;
      let impuestoInternoTotal = 0;
      let bonificaciones = 0;
      let netoGravado = 0;
      let netoNoGravado = 0;
      let netoExento = 0;
      const dtoGral = input.DTO_GRAL || 0;

      for (const item of input.items) {
        const precioConDto = item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO;
        const lineTotal = precioConDto * item.CANTIDAD;
        subtotal += lineTotal;
        ganancias += (precioConDto - (item.PRECIO_COMPRA || 0)) * item.CANTIDAD;

        if (item.DESCUENTO > 0) {
          bonificaciones += (item.PRECIO_UNITARIO - precioConDto) * item.CANTIDAD;
        }

        const ivaMonto = item.IVA_MONTO || 0;
        const ivaAlicuota = item.IVA_ALICUOTA || 0;
        ivaTotal += ivaMonto * item.CANTIDAD;
        impuestoInternoTotal += (item.IMPUESTO_INTERNO_MONTO || 0) * item.CANTIDAD;

        // NETO split: gravado vs no gravado vs exento
        const ivaInfo = ivaMap.get(item.PRODUCTO_ID);
        if (ivaInfo?.esExento) {
          netoExento += precioConDto * item.CANTIDAD;
        } else if (ivaAlicuota > 0) {
          netoGravado += (precioConDto - ivaMonto) * item.CANTIDAD;
        } else {
          netoNoGravado += precioConDto * item.CANTIDAD;
        }
      }

      // Apply general discount
      let total = subtotal;
      if (dtoGral > 0) {
        const montoDescuento = subtotal * (dtoGral / 100);
        total -= montoDescuento;
        ganancias -= montoDescuento;
        bonificaciones += montoDescuento;
        // Proportionally reduce neto amounts
        const factor = 1 - dtoGral / 100;
        netoGravado *= factor;
        netoNoGravado *= factor;
        netoExento *= factor;
      }

      let cobrada = input.COBRADA !== undefined ? input.COBRADA : !input.ES_CTA_CORRIENTE;
      let montoEfectivo = input.MONTO_EFECTIVO || 0;
      let montoDigital = input.MONTO_DIGITAL || 0;
      const vuelto = input.VUELTO || 0;
      let montoAnticipo = 0;
      let montoChequesAporte = 0;

      // If metodos_pago provided, derive category totals from methods
      if (input.metodos_pago && input.metodos_pago.length > 0) {
        const derived = await derivarCategorias(tx, input.metodos_pago);
        montoEfectivo = derived.montoEfectivo;
        montoDigital = derived.montoDigital;
        montoChequesAporte = derived.montoCheques;
      }

      // ── 2. CTA CTE: Check saldo and apply anticipo if available ──
      if (input.ES_CTA_CORRIENTE) {
        const ctaCheck = await tx.request()
          .input('cid', sql.Int, input.CLIENTE_ID)
          .query(`SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @cid`);

        if (ctaCheck.recordset.length > 0) {
          const ctaIdForSaldo = ctaCheck.recordset[0].CTA_CORRIENTE_ID;
          const saldoResult = await tx.request()
            .input('ctaId', sql.Int, ctaIdForSaldo)
            .query(`SELECT ISNULL(SUM(DEBE - HABER), 0) AS SALDO FROM VENTAS_CTA_CORRIENTE WHERE CTA_CORRIENTE_ID = @ctaId`);
          const saldo = saldoResult.recordset[0]?.SALDO || 0;

          // saldo < 0 means client has credit (HABER > DEBE)
          if (saldo < 0) {
            const creditoDisponible = Math.abs(saldo);
            if (creditoDisponible >= r2(total)) {
              // Full coverage: sale is fully paid via anticipo
              montoAnticipo = r2(total);
              cobrada = true;
            } else {
              // Partial coverage: use all available credit
              montoAnticipo = r2(creditoDisponible);
              cobrada = false;
            }
          }
        }
      }

      // ── 3. Get caja abierta ──
      const caja = await getCajaAbiertaTx(tx, usuarioId);

      // ── 4. INSERT into VENTAS ──
      const ventaResult = await tx.request()
        .input('clienteId', sql.Int, input.CLIENTE_ID)
        .input('total', sql.Decimal(18, 2), r2(total))
        .input('ganancias', sql.Decimal(18, 2), r2(ganancias))
        .input('esCtaCorriente', sql.Bit, input.ES_CTA_CORRIENTE ? 1 : 0)
        .input('montoEfectivo', sql.Decimal(18, 2), montoEfectivo)
        .input('montoDigital', sql.Decimal(18, 2), montoDigital)
        .input('vuelto', sql.Decimal(18, 2), vuelto)
        .input('tipoComprobante', sql.NVarChar, input.TIPO_COMPROBANTE || null)
        .input('cobrada', sql.Bit, cobrada ? 1 : 0)
        .input('puntoVentaId', sql.Int, input.PUNTO_VENTA_ID)
        .input('usuarioId', sql.Int, usuarioId)
        .input('dtoGral', sql.Decimal(18, 2), dtoGral)
        .input('subtotal', sql.Decimal(18, 2), r2(subtotal))
        .input('bonificaciones', sql.Decimal(18, 2), r2(bonificaciones))
        .input('impuestoInterno', sql.Decimal(18, 2), r2(impuestoInternoTotal))
        .input('ivaTotal', sql.Decimal(18, 2), r2(ivaTotal))
        .input('montoAnticipo', sql.Decimal(18, 2), montoAnticipo)
        .input('netoGravado', sql.Decimal(18, 2), r2(netoGravado))
        .input('netoNoGravado', sql.Decimal(18, 2), r2(netoNoGravado))
        .input('netoExento', sql.Decimal(18, 2), r2(netoExento))
        .query(`
          INSERT INTO VENTAS (
            CLIENTE_ID, FECHA_VENTA, TOTAL, GANANCIAS, ES_CTA_CORRIENTE,
            MONTO_EFECTIVO, MONTO_DIGITAL, VUELTO, TIPO_COMPROBANTE,
            COBRADA, PUNTO_VENTA_ID, USUARIO_ID, DTO_GRAL,
            SUBTOTAL, BONIFICACIONES, IMPUESTO_INTERNO, IVA_TOTAL, MONTO_ANTICIPO,
            NETO_GRAVADO, NETO_NO_GRAVADO, NETO_EXENTO
          ) VALUES (
            @clienteId, GETDATE(), @total, @ganancias, @esCtaCorriente,
            @montoEfectivo, @montoDigital, @vuelto, @tipoComprobante,
            @cobrada, @puntoVentaId, @usuarioId, @dtoGral,
            @subtotal, @bonificaciones, @impuestoInterno, @ivaTotal, @montoAnticipo,
            @netoGravado, @netoNoGravado, @netoExento
          );
          SELECT SCOPE_IDENTITY() AS VENTA_ID;
        `);

      const ventaId = ventaResult.recordset[0].VENTA_ID;

      // ── 4. INSERT VENTAS_ITEMS + decrement stock ──
      for (const item of input.items) {
        const precioConDto = item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO;

        await tx.request()
          .input('ventaId', sql.Int, ventaId)
          .input('productoId', sql.Int, item.PRODUCTO_ID)
          .input('precioUnitario', sql.Decimal(18, 4), item.PRECIO_UNITARIO)
          .input('cantidad', sql.Decimal(18, 4), item.CANTIDAD)
          .input('precioUnitarioDto', sql.Decimal(18, 4), Math.round(precioConDto * 10000) / 10000)
          .input('descuento', sql.Decimal(18, 2), item.DESCUENTO)
          .input('promocionId', sql.Int, item.PROMOCION_ID || null)
          .input('cantidadPromo', sql.Decimal(18, 4), item.CANTIDAD_PROMO || null)
          .input('precioPromocion', sql.Decimal(18, 4), item.PRECIO_PROMOCION || null)
          .input('precioCompra', sql.Decimal(18, 4), item.PRECIO_COMPRA || 0)
          .input('depositoId', sql.Int, item.DEPOSITO_ID || null)
          .input('listaId', sql.Int, item.LISTA_ID || 1)
          .input('impIntPorcentaje', sql.Decimal(18, 4), item.IMPUESTO_INTERNO_PORCENTAJE || 0)
          .input('impIntMonto', sql.Decimal(18, 4), item.IMPUESTO_INTERNO_MONTO || 0)
          .input('impIntTipo', sql.Int, item.IMPUESTO_INTERNO_TIPO || 1)
          .input('ivaAlicuota', sql.Decimal(18, 4), item.IVA_ALICUOTA || 0)
          .input('ivaMonto', sql.Decimal(18, 4), item.IVA_MONTO || 0)
          .input('cantidadProductosPromo', sql.Decimal(18, 2), item.CANTIDAD_PRODUCTOS_PROMO || 0)
          .input('desdeRemito', sql.Bit, item.DESDE_REMITO ? 1 : 0)
          .query(`
            INSERT INTO VENTAS_ITEMS (
              VENTA_ID, PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, PRECIO_UNITARIO_DTO,
              DESCUENTO, PROMOCION_ID, CANTIDAD_PROMO, PRECIO_PROMOCION,
              PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID,
              IMPUESTO_INTERNO_PORCENTAJE, IMPUESTO_INTERNO_MONTO, IMPUESTO_INTERNO_TIPO,
              IVA_ALICUOTA, IVA_MONTO, CANTIDAD_PRODUCTOS_PROMO, DESDE_REMITO
            ) VALUES (
              @ventaId, @productoId, @precioUnitario, @cantidad, @precioUnitarioDto,
              @descuento, @promocionId, @cantidadPromo, @precioPromocion,
              @precioCompra, @depositoId, @listaId,
              @impIntPorcentaje, @impIntMonto, @impIntTipo,
              @ivaAlicuota, @ivaMonto, @cantidadProductosPromo, @desdeRemito
            )
          `);

        // Decrement stock (handles DESCUENTA_STOCK flag + conjuntos)
        // Skip if item comes from a remito (stock already decremented when remito SALIDA was created)
        if (!item.DESDE_REMITO) {
          await decrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID || null, ventaId, usuarioId);
        }
      }

      // ── 5. CAJA_ITEMS (if not cta corriente and caja active) ──
      if (!input.ES_CTA_CORRIENTE && caja) {
        const efectivoNeto = Math.max(0, montoEfectivo - vuelto);
        if (efectivoNeto > 0 || montoDigital > 0) {
          await tx.request()
            .input('cajaId', sql.Int, caja.CAJA_ID)
            .input('origenTipo', sql.VarChar(30), 'VENTA')
            .input('origenId', sql.Int, ventaId)
            .input('efectivo', sql.Decimal(18, 2), efectivoNeto)
            .input('digital', sql.Decimal(18, 2), montoDigital)
            .input('desc', sql.NVarChar(255), `Venta #${ventaId}`)
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
                MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @origenId,
                @efectivo, @digital, @desc, @uid)
            `);
        }
      }

      // ── 5b. VENTAS_METODOS_PAGO (payment method breakdown) ──
      if (input.metodos_pago && input.metodos_pago.length > 0) {
        await ensureVentasMetodosPagoTable(pool);
        await insertMetodosPago(tx, ventaId, input.metodos_pago);
        // Crear cheques EN_CARTERA para los métodos de categoría CHEQUES
        await crearChequesIngreso(tx, 'VENTA', ventaId, input.metodos_pago, usuarioId, null);
        // ── 5c. MOVIMIENTOS_CAJA: registrar el ingreso de cheques en Caja Central ──
        // (los cheques son un instrumento de caja central, visibles inmediatamente)
        if (montoChequesAporte > 0) {
          await tx.request()
            .input('idEntidad', sql.Int, ventaId)
            .input('tipoEntidad', sql.VarChar(20), 'VENTA')
            .input('movimiento', sql.NVarChar(500), `Ingreso cheque(s) Venta #${ventaId}`)
            .input('uid', sql.Int, usuarioId)
            .input('cheques', sql.Decimal(18, 2), montoChequesAporte)
            .input('total', sql.Decimal(18, 2), montoChequesAporte)
            .input('pvId', sql.Int, input.PUNTO_VENTA_ID)
            .query(`
              INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
              VALUES (@idEntidad, @tipoEntidad, @movimiento, @uid, 0, 0, @cheques, 0, @total, @pvId, 0)
            `);
        }
      }

      // ── 6. CTA_CORRIENTE (if cuenta corriente sale) ──
      if (input.ES_CTA_CORRIENTE) {
        // Validate customer has CTA_CORRIENTE enabled
        const clienteCheck = await tx.request()
          .input('cid2', sql.Int, input.CLIENTE_ID)
          .query(`SELECT CTA_CORRIENTE FROM CLIENTES WHERE CLIENTE_ID = @cid2`);
        if (!clienteCheck.recordset[0]?.CTA_CORRIENTE) {
          throw Object.assign(
            new Error('El cliente no tiene habilitada la cuenta corriente'),
            { name: 'ValidationError' }
          );
        }
        const ctaCteId = await ensureCtaCorriente(tx, input.CLIENTE_ID);
        const tipoCompCtaCte = input.TIPO_COMPROBANTE || 'Fa.C';
        const fechaVenta = input.FECHA_VENTA ? new Date(input.FECHA_VENTA) : new Date();

        // Insert the sale movement (DEBE)
        await tx.request()
          .input('comprobanteId', sql.Int, ventaId)
          .input('ctaCteId', sql.Int, ctaCteId)
          .input('fecha', sql.DateTime, fechaVenta)
          .input('concepto', sql.NVarChar(255), `Venta ${tipoCompCtaCte} - ${ventaId}`)
          .input('tipoComp', sql.NVarChar(50), tipoCompCtaCte)
          .input('debe', sql.Decimal(18, 2), r2(total))
          .input('haber', sql.Decimal(18, 2), 0)
          .query(`
            INSERT INTO VENTAS_CTA_CORRIENTE
              (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
            VALUES
              (@comprobanteId, @ctaCteId, @fecha, @concepto, @tipoComp, @debe, @haber)
          `);

        // ── Consume anticipos if montoAnticipo > 0 ──
        if (montoAnticipo > 0) {
          // Get available anticipos for this client, oldest first
          const anticipos = await tx.request()
            .input('clienteId', sql.Int, input.CLIENTE_ID)
            .query(`
              SELECT ANTICIPO_ID, PAGO_ID, MONTO_DISPONIBLE
              FROM ANTICIPOS_CLIENTES
              WHERE CLIENTE_ID = @clienteId AND MONTO_DISPONIBLE > 0
              ORDER BY FECHA_ANTICIPO, ANTICIPO_ID
            `);

          let restante = montoAnticipo;
          for (const ant of anticipos.recordset) {
            if (restante <= 0.01) break;
            const consumir = Math.min(restante, ant.MONTO_DISPONIBLE);

            // Create IMPUTACIONES_PAGOS record
            await tx.request()
              .input('pagoId', sql.Int, ant.PAGO_ID)
              .input('ventaId', sql.Int, ventaId)
              .input('tipoComp', sql.NVarChar, tipoCompCtaCte)
              .input('monto', sql.Decimal(18, 2), consumir)
              .input('fecha', sql.DateTime, fechaVenta)
              .input('usuarioId', sql.Int, usuarioId)
              .query(`
                INSERT INTO IMPUTACIONES_PAGOS
                  (PAGO_ID, VENTA_ID, TIPO_COMPROBANTE, MONTO_IMPUTADO, FECHA_IMPUTACION, USUARIO_ID)
                VALUES (@pagoId, @ventaId, @tipoComp, @monto, @fecha, @usuarioId)
              `);

            // Reduce MONTO_DISPONIBLE in ANTICIPOS_CLIENTES
            const nuevoDisponible = r2(ant.MONTO_DISPONIBLE - consumir);
            if (nuevoDisponible <= 0.01) {
              // Fully consumed — delete the anticipo
              await tx.request()
                .input('anticipoId', sql.Int, ant.ANTICIPO_ID)
                .query('DELETE FROM ANTICIPOS_CLIENTES WHERE ANTICIPO_ID = @anticipoId');
            } else {
              await tx.request()
                .input('anticipoId', sql.Int, ant.ANTICIPO_ID)
                .input('nuevoMonto', sql.Decimal(18, 2), nuevoDisponible)
                .query('UPDATE ANTICIPOS_CLIENTES SET MONTO_DISPONIBLE = @nuevoMonto WHERE ANTICIPO_ID = @anticipoId');
            }

            restante = r2(restante - consumir);
          }
        }
      }

      // ── 7. AUDITORIA ──
      await registrarAuditoria(
        tx, 'VENTA', ventaId, 'CREACION', usuarioId,
        input.PUNTO_VENTA_ID, caja?.CAJA_ID || null,
        r2(total), `Venta #${ventaId} creada`
      );

      // ── 8. Close pedido + free mesa (if from Mesas flow) ──
      if (input.PEDIDO_ID) {
        // Close the pedido
        await tx.request()
          .input('pedidoId', sql.Int, input.PEDIDO_ID)
          .query(`UPDATE PEDIDOS SET ESTADO = 'CERRADO', FECHA_CIERRE = GETDATE() WHERE PEDIDO_ID = @pedidoId AND ESTADO <> 'CERRADO'`);

        // Link pedido to venta
        await tx.request()
          .input('pedidoId', sql.Int, input.PEDIDO_ID)
          .input('ventaId', sql.Int, ventaId)
          .query(`INSERT INTO PEDIDOS_VENTAS (PEDIDO_ID, VENTA_ID) VALUES (@pedidoId, @ventaId)`);

        // Free the mesa if no other active pedidos remain
        if (input.MESA_ID) {
          const activePedidos = await tx.request()
            .input('mesaId', sql.Int, input.MESA_ID)
            .input('pedidoId2', sql.Int, input.PEDIDO_ID)
            .query(`SELECT COUNT(*) as cnt FROM PEDIDOS WHERE MESA_ID = @mesaId AND ESTADO IN ('ABIERTO','EN_PREPARACION') AND PEDIDO_ID <> @pedidoId2`);
          if (activePedidos.recordset[0].cnt === 0) {
            await tx.request()
              .input('mesaId', sql.Int, input.MESA_ID)
              .query(`UPDATE MESAS SET ESTADO = 'LIBRE' WHERE MESA_ID = @mesaId`);
          }
        }
      }

      // ── 9. Link remitos to this sale ──
      if (input.REMITO_IDS && input.REMITO_IDS.length > 0) {
        for (let i = 0; i < input.REMITO_IDS.length; i++) {
          const rId = input.REMITO_IDS[i]!;
          await tx.request()
            .input(`remitoVentaId_${i}`, sql.Int, ventaId)
            .input(`remitoId_${i}`, sql.Int, rId)
            .query(`UPDATE REMITOS SET VENTA_ID = @remitoVentaId_${i} WHERE REMITO_ID = @remitoId_${i} AND VENTA_ID IS NULL`);
        }
      }

      await tx.commit();
      return { VENTA_ID: ventaId, TOTAL: r2(total), MONTO_ANTICIPO: montoAnticipo, COBRADA: cobrada };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update sale ────────────────────────────────
  async update(id: number, input: VentaInput, usuarioId: number) {
    const pool = await getPool();
    await ensureNetoExentoColumn(pool);
    await ensureDesdeRemitoColumn(pool);
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Check sale exists and is not invoiced
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, NUMERO_FISCAL, COBRADA, ES_CTA_CORRIENTE,
                       CLIENTE_ID, TOTAL, PUNTO_VENTA_ID
                FROM VENTAS WHERE VENTA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
      }
      if (existing.recordset[0].NUMERO_FISCAL) {
        throw Object.assign(new Error('No se puede modificar una venta con número fiscal emitido'), { name: 'ValidationError' });
      }

      const oldVenta = existing.recordset[0];

      // Block update if active NCs exist (stock was already adjusted by the NC)
      try {
        const ncCheckUpd = await tx.request()
          .input('ventaId', sql.Int, id)
          .query(`SELECT COUNT(*) AS CNT FROM NC_VENTAS WHERE VENTA_ID = @ventaId AND ANULADA = 0`);
        if (ncCheckUpd.recordset[0].CNT > 0) {
          throw Object.assign(
            new Error('No se puede modificar la venta porque tiene notas de crédito activas. Anule las NC primero.'),
            { name: 'ValidationError' }
          );
        }
      } catch (ncErrUpd: any) {
        if (ncErrUpd.name === 'ValidationError') throw ncErrUpd;
        // If NC_VENTAS table doesn't exist yet, ignore
      }

      // ── 1. Restore stock from old items (skip items that came from remitos) ──
      const oldItems = await tx.request()
        .input('ventaId', sql.Int, id)
        .query(`SELECT PRODUCTO_ID, CANTIDAD, DEPOSITO_ID, ISNULL(DESDE_REMITO, 0) AS DESDE_REMITO FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);

      for (const oldItem of oldItems.recordset) {
        if (oldItem.DESDE_REMITO) continue; // stock was never taken — don't restore
        await restaurarStock(tx, oldItem.PRODUCTO_ID, oldItem.CANTIDAD, oldItem.DEPOSITO_ID, id, usuarioId);
      }

      // ── 2. Delete old items ──
      await tx.request().input('ventaId', sql.Int, id)
        .query(`DELETE FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);

      // ── 3. Remove old CAJA_ITEMS for this sale ──
      await tx.request().input('origenId', sql.Int, id)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'VENTA'`);

      // ── 3b. Remove old VENTAS_METODOS_PAGO ──
      await ensureVentasMetodosPagoTable(pool);
      await tx.request().input('ventaId', sql.Int, id)
        .query(`DELETE FROM VENTAS_METODOS_PAGO WHERE VENTA_ID = @ventaId`);

      // ── 4. Remove old CTA_CORRIENTE records ──
      if (oldVenta.ES_CTA_CORRIENTE) {
        await tx.request().input('comprobanteId', sql.Int, id)
          .query(`DELETE FROM VENTAS_CTA_CORRIENTE WHERE COMPROBANTE_ID = @comprobanteId AND TIPO_COMPROBANTE = 'VENTA'`);
      }

      // ── 5. Batch-fetch IVA rates for all products ──
      const productIds = input.items.map(i => Number(i.PRODUCTO_ID));
      const ivaReq = tx.request();
      productIds.forEach((pid, i) => ivaReq.input(`pid${i}`, sql.Int, pid));
      const idList = productIds.map((_, i) => `@pid${i}`).join(', ');
      const ivaResult = await ivaReq.query(`
        SELECT p.PRODUCTO_ID, ISNULL(t.PORCENTAJE, 0) AS PORCENTAJE, ISNULL(t.NOMBRE, '') AS TASA_NOMBRE
        FROM PRODUCTOS p
        LEFT JOIN TASAS_IMPUESTOS t ON p.TASA_IVA_ID = t.TASA_ID AND t.ACTIVA = 1
        WHERE p.PRODUCTO_ID IN (${idList})
      `);
      const ivaMap = new Map<number, { porcentaje: number; esExento: boolean }>();
      for (const row of ivaResult.recordset) {
        ivaMap.set(row.PRODUCTO_ID, {
          porcentaje: row.PORCENTAJE,
          esExento: (row.TASA_NOMBRE || '').toUpperCase().includes('EXENTO'),
        });
      }

      // ── 5b. Calculate new totals ──
      let subtotal = 0;
      let ganancias = 0;
      let bonificaciones = 0;
      let ivaTotal = 0;
      let impuestoInternoTotal = 0;
      let netoGravado = 0;
      let netoNoGravado = 0;
      let netoExento = 0;
      const dtoGral = input.DTO_GRAL || 0;

      for (const item of input.items) {
        const precioConDto = item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO;
        const lineTotal = precioConDto * item.CANTIDAD;
        subtotal += lineTotal;
        ganancias += (precioConDto - (item.PRECIO_COMPRA || 0)) * item.CANTIDAD;

        if (item.DESCUENTO > 0) {
          bonificaciones += (item.PRECIO_UNITARIO - precioConDto) * item.CANTIDAD;
        }

        const ivaMonto = item.IVA_MONTO || 0;
        const ivaAlicuota = item.IVA_ALICUOTA || 0;
        ivaTotal += ivaMonto * item.CANTIDAD;
        impuestoInternoTotal += (item.IMPUESTO_INTERNO_MONTO || 0) * item.CANTIDAD;

        const ivaInfo = ivaMap.get(item.PRODUCTO_ID);
        if (ivaInfo?.esExento) {
          netoExento += precioConDto * item.CANTIDAD;
        } else if (ivaAlicuota > 0) {
          netoGravado += (precioConDto - ivaMonto) * item.CANTIDAD;
        } else {
          netoNoGravado += precioConDto * item.CANTIDAD;
        }
      }

      let total = subtotal;
      if (dtoGral > 0) {
        const montoDescuento = subtotal * (dtoGral / 100);
        total -= montoDescuento;
        ganancias -= montoDescuento;
        bonificaciones += montoDescuento;
        const factor = 1 - dtoGral / 100;
        netoGravado *= factor;
        netoNoGravado *= factor;
        netoExento *= factor;
      }

      const cobrada = input.COBRADA !== undefined ? input.COBRADA : oldVenta.COBRADA;

      // ── 6. UPDATE VENTAS ──
      await tx.request()
        .input('id', sql.Int, id)
        .input('clienteId', sql.Int, input.CLIENTE_ID)
        .input('fechaVenta', sql.DateTime, input.FECHA_VENTA ? new Date(input.FECHA_VENTA) : new Date())
        .input('total', sql.Decimal(18, 2), r2(total))
        .input('ganancias', sql.Decimal(18, 2), r2(ganancias))
        .input('esCtaCorriente', sql.Bit, input.ES_CTA_CORRIENTE ? 1 : 0)
        .input('montoEfectivo', sql.Decimal(18, 2), input.MONTO_EFECTIVO || 0)
        .input('montoDigital', sql.Decimal(18, 2), input.MONTO_DIGITAL || 0)
        .input('vuelto', sql.Decimal(18, 2), input.VUELTO || 0)
        .input('tipoComprobante', sql.NVarChar, input.TIPO_COMPROBANTE || null)
        .input('cobrada', sql.Bit, cobrada ? 1 : 0)
        .input('dtoGral', sql.Decimal(18, 2), dtoGral)
        .input('subtotal', sql.Decimal(18, 2), r2(subtotal))
        .input('bonificaciones', sql.Decimal(18, 2), r2(bonificaciones))
        .input('impuestoInterno', sql.Decimal(18, 2), r2(impuestoInternoTotal))
        .input('ivaTotal', sql.Decimal(18, 2), r2(ivaTotal))
        .input('netoGravado', sql.Decimal(18, 2), r2(netoGravado))
        .input('netoNoGravado', sql.Decimal(18, 2), r2(netoNoGravado))
        .input('netoExento', sql.Decimal(18, 2), r2(netoExento))
        .query(`
          UPDATE VENTAS SET
            CLIENTE_ID=@clienteId, FECHA_VENTA=@fechaVenta, TOTAL=@total,
            GANANCIAS=@ganancias, ES_CTA_CORRIENTE=@esCtaCorriente,
            MONTO_EFECTIVO=@montoEfectivo, MONTO_DIGITAL=@montoDigital, VUELTO=@vuelto,
            TIPO_COMPROBANTE=@tipoComprobante, COBRADA=@cobrada, DTO_GRAL=@dtoGral,
            SUBTOTAL=@subtotal, BONIFICACIONES=@bonificaciones,
            IMPUESTO_INTERNO=@impuestoInterno, IVA_TOTAL=@ivaTotal,
            NETO_GRAVADO=@netoGravado, NETO_NO_GRAVADO=@netoNoGravado,
            NETO_EXENTO=@netoExento
          WHERE VENTA_ID = @id
        `);

      // ── 7. Insert new items + decrement stock ──
      for (const item of input.items) {
        const precioConDto = item.DESCUENTO > 0
          ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
          : item.PRECIO_UNITARIO;

        await tx.request()
          .input('ventaId', sql.Int, id)
          .input('productoId', sql.Int, item.PRODUCTO_ID)
          .input('precioUnitario', sql.Decimal(18, 4), item.PRECIO_UNITARIO)
          .input('cantidad', sql.Decimal(18, 4), item.CANTIDAD)
          .input('precioUnitarioDto', sql.Decimal(18, 4), Math.round(precioConDto * 10000) / 10000)
          .input('descuento', sql.Decimal(18, 2), item.DESCUENTO)
          .input('promocionId', sql.Int, item.PROMOCION_ID || null)
          .input('cantidadPromo', sql.Decimal(18, 4), item.CANTIDAD_PROMO || null)
          .input('precioPromocion', sql.Decimal(18, 4), item.PRECIO_PROMOCION || null)
          .input('precioCompra', sql.Decimal(18, 4), item.PRECIO_COMPRA || 0)
          .input('depositoId', sql.Int, item.DEPOSITO_ID || null)
          .input('listaId', sql.Int, item.LISTA_ID || 1)
          .input('impIntPorcentaje', sql.Decimal(18, 4), item.IMPUESTO_INTERNO_PORCENTAJE || 0)
          .input('impIntMonto', sql.Decimal(18, 4), item.IMPUESTO_INTERNO_MONTO || 0)
          .input('impIntTipo', sql.Int, item.IMPUESTO_INTERNO_TIPO || 1)
          .input('ivaAlicuota', sql.Decimal(18, 4), item.IVA_ALICUOTA || 0)
          .input('ivaMonto', sql.Decimal(18, 4), item.IVA_MONTO || 0)
          .input('cantidadProductosPromo', sql.Decimal(18, 2), item.CANTIDAD_PRODUCTOS_PROMO || 0)
          .input('desdeRemito', sql.Bit, item.DESDE_REMITO ? 1 : 0)
          .query(`
            INSERT INTO VENTAS_ITEMS (
              VENTA_ID, PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, PRECIO_UNITARIO_DTO,
              DESCUENTO, PROMOCION_ID, CANTIDAD_PROMO, PRECIO_PROMOCION,
              PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID,
              IMPUESTO_INTERNO_PORCENTAJE, IMPUESTO_INTERNO_MONTO, IMPUESTO_INTERNO_TIPO,
              IVA_ALICUOTA, IVA_MONTO, CANTIDAD_PRODUCTOS_PROMO, DESDE_REMITO
            ) VALUES (
              @ventaId, @productoId, @precioUnitario, @cantidad, @precioUnitarioDto,
              @descuento, @promocionId, @cantidadPromo, @precioPromocion,
              @precioCompra, @depositoId, @listaId,
              @impIntPorcentaje, @impIntMonto, @impIntTipo,
              @ivaAlicuota, @ivaMonto, @cantidadProductosPromo, @desdeRemito
            )
          `);

        if (!item.DESDE_REMITO) {
          await decrementarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID || null, id, usuarioId);
        }
      }

      // ── 8. Re-create CAJA_ITEMS if applicable ──
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      if (!input.ES_CTA_CORRIENTE && caja) {
        const montoEfectivo = input.MONTO_EFECTIVO || 0;
        const montoDigital = input.MONTO_DIGITAL || 0;
        const vuelto = input.VUELTO || 0;
        const efectivoNeto = Math.max(0, montoEfectivo - vuelto);
        if (efectivoNeto > 0 || montoDigital > 0) {
          await tx.request()
            .input('cajaId', sql.Int, caja.CAJA_ID)
            .input('origenTipo', sql.VarChar(30), 'VENTA')
            .input('origenId', sql.Int, id)
            .input('efectivo', sql.Decimal(18, 2), efectivoNeto)
            .input('digital', sql.Decimal(18, 2), montoDigital)
            .input('desc', sql.NVarChar(255), `Venta #${id}`)
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
                MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @origenId,
                @efectivo, @digital, @desc, @uid)
            `);
        }
      }

      // ── 9. Re-create CTA_CORRIENTE if applicable ──
      if (input.ES_CTA_CORRIENTE) {
        const ctaCteId = await ensureCtaCorriente(tx, input.CLIENTE_ID);
        await tx.request()
          .input('comprobanteId', sql.Int, id)
          .input('ctaCteId', sql.Int, ctaCteId)
          .input('fecha', sql.DateTime, input.FECHA_VENTA ? new Date(input.FECHA_VENTA) : new Date())
          .input('concepto', sql.NVarChar(255), `Venta #${id}`)
          .input('tipoComp', sql.NVarChar(50), 'VENTA')
          .input('debe', sql.Decimal(18, 2), r2(total))
          .input('haber', sql.Decimal(18, 2), 0)
          .query(`
            INSERT INTO VENTAS_CTA_CORRIENTE
              (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
            VALUES
              (@comprobanteId, @ctaCteId, @fecha, @concepto, @tipoComp, @debe, @haber)
          `);
      }

      // ── 10. AUDITORIA ──
      await registrarAuditoria(
        tx, 'VENTA', id, 'MODIFICACION', usuarioId,
        input.PUNTO_VENTA_ID, caja?.CAJA_ID || null,
        r2(total), `Venta #${id} modificada`
      );

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete sale ────────────────────────────────
  async delete(id: number, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, NUMERO_FISCAL, ES_CTA_CORRIENTE, CLIENTE_ID,
                       TOTAL, COBRADA, PUNTO_VENTA_ID
                FROM VENTAS WHERE VENTA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
      }

      const venta = existing.recordset[0];

      if (venta.NUMERO_FISCAL) {
        throw Object.assign(
          new Error('No se puede eliminar una venta con número fiscal emitido. Debe generar una nota de crédito.'),
          { name: 'ValidationError' }
        );
      }

      // Block delete if active NCs exist (stock was already adjusted by the NC)
      try {
        const ncCheck = await tx.request()
          .input('ventaId', sql.Int, id)
          .query(`SELECT COUNT(*) AS CNT FROM NC_VENTAS WHERE VENTA_ID = @ventaId AND ANULADA = 0`);
        if (ncCheck.recordset[0].CNT > 0) {
          throw Object.assign(
            new Error('No se puede eliminar la venta porque tiene notas de crédito activas. Anule las NC primero.'),
            { name: 'ValidationError' }
          );
        }
      } catch (ncErr: any) {
        if (ncErr.name === 'ValidationError') throw ncErr;
        // If NC_VENTAS table doesn't exist yet, ignore
      }

      // ── 1. Restore stock from items (skip items that came from remitos) ──
      const items = await tx.request()
        .input('ventaId', sql.Int, id)
        .query(`SELECT PRODUCTO_ID, CANTIDAD, DEPOSITO_ID, ISNULL(DESDE_REMITO, 0) AS DESDE_REMITO FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);

      for (const item of items.recordset) {
        if (item.DESDE_REMITO) continue; // stock was never taken — don't restore
        await restaurarStock(tx, item.PRODUCTO_ID, item.CANTIDAD, item.DEPOSITO_ID, id, usuarioId);
      }

      // ── 2. Remove CAJA_ITEMS ──
      await tx.request().input('origenId', sql.Int, id)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'VENTA'`);

      // ── 3. Remove CTA_CORRIENTE records (both VENTA and PAGO entries) ──
      if (venta.ES_CTA_CORRIENTE) {
        // Restore anticipos from any imputaciones linked to this sale
        const imputaciones = await tx.request()
          .input('ventaId', sql.Int, id)
          .query(`
            SELECT ip.PAGO_ID, ip.MONTO_IMPUTADO
            FROM IMPUTACIONES_PAGOS ip
            WHERE ip.VENTA_ID = @ventaId
          `);

        for (const imp of imputaciones.recordset) {
          // Check if anticipo still exists for this pago
          const antCheck = await tx.request()
            .input('pagoId', sql.Int, imp.PAGO_ID)
            .input('clienteId', sql.Int, venta.CLIENTE_ID)
            .query('SELECT ANTICIPO_ID, MONTO_DISPONIBLE FROM ANTICIPOS_CLIENTES WHERE PAGO_ID = @pagoId AND CLIENTE_ID = @clienteId');

          if (antCheck.recordset.length > 0) {
            // Restore monto to existing anticipo
            await tx.request()
              .input('anticipoId', sql.Int, antCheck.recordset[0].ANTICIPO_ID)
              .input('monto', sql.Decimal(18, 2), imp.MONTO_IMPUTADO)
              .query('UPDATE ANTICIPOS_CLIENTES SET MONTO_DISPONIBLE = MONTO_DISPONIBLE + @monto WHERE ANTICIPO_ID = @anticipoId');
          } else {
            // Re-create the anticipo record
            await tx.request()
              .input('pagoId', sql.Int, imp.PAGO_ID)
              .input('clienteId', sql.Int, venta.CLIENTE_ID)
              .input('monto', sql.Decimal(18, 2), imp.MONTO_IMPUTADO)
              .input('usuarioId', sql.Int, usuarioId)
              .query(`
                INSERT INTO ANTICIPOS_CLIENTES (PAGO_ID, CLIENTE_ID, MONTO_DISPONIBLE, FECHA_ANTICIPO, USUARIO_ID)
                VALUES (@pagoId, @clienteId, @monto, GETDATE(), @usuarioId)
              `);
          }
        }

        // Delete imputaciones for this sale
        await tx.request()
          .input('ventaId', sql.Int, id)
          .query('DELETE FROM IMPUTACIONES_PAGOS WHERE VENTA_ID = @ventaId');

        await tx.request().input('comprobanteId', sql.Int, id)
          .query(`DELETE FROM VENTAS_CTA_CORRIENTE WHERE COMPROBANTE_ID = @comprobanteId`);
      }

      // ── 4. Delete metodos_pago, items, then sale ──
      await ensureVentasMetodosPagoTable(pool);
      await tx.request().input('ventaId', sql.Int, id)
        .query(`DELETE FROM VENTAS_METODOS_PAGO WHERE VENTA_ID = @ventaId`);
      // Limpiar MOVIMIENTOS_CAJA generados por cheques de esta venta
      await tx.request().input('ventaId', sql.Int, id)
        .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @ventaId AND TIPO_ENTIDAD = 'VENTA'`);
      // Cheques: block if any cheque is not EN_CARTERA (already cashed/deposited)
      try {
        const chequesNoCartera = await tx.request()
          .input('ventaId', sql.Int, id)
          .query(`SELECT COUNT(*) AS CNT FROM CHEQUES
                  WHERE ORIGEN_TIPO = 'VENTA' AND ORIGEN_ID = @ventaId AND ESTADO <> 'EN_CARTERA'`);
        if (chequesNoCartera.recordset[0].CNT > 0) {
          throw Object.assign(
            new Error('No se puede eliminar la venta porque tiene cheques ya procesados (depositados o egresados). Anule los cheques primero.'),
            { name: 'ValidationError' }
          );
        }
        // Delete EN_CARTERA cheques linked to this sale
        await tx.request().input('ventaId', sql.Int, id)
          .query(`DELETE ch FROM CHEQUES_HISTORIAL ch
                  INNER JOIN CHEQUES c ON ch.CHEQUE_ID = c.CHEQUE_ID
                  WHERE c.ORIGEN_TIPO = 'VENTA' AND c.ORIGEN_ID = @ventaId AND c.ESTADO = 'EN_CARTERA'`);
        await tx.request().input('ventaId', sql.Int, id)
          .query(`DELETE FROM CHEQUES WHERE ORIGEN_TIPO = 'VENTA' AND ORIGEN_ID = @ventaId AND ESTADO = 'EN_CARTERA'`);
      } catch (chqErr: any) {
        if (chqErr.name === 'ValidationError') throw chqErr;
        // If CHEQUES table doesn't exist yet, ignore
      }
      await tx.request().input('ventaId', sql.Int, id)
        .query(`DELETE FROM VENTAS_ITEMS WHERE VENTA_ID = @ventaId`);
      await tx.request().input('id', sql.Int, id)
        .query(`DELETE FROM VENTAS WHERE VENTA_ID = @id`);

      // ── 5. AUDITORIA ──
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      await registrarAuditoria(
        tx, 'VENTA', id, 'ELIMINACION', usuarioId,
        venta.PUNTO_VENTA_ID, caja?.CAJA_ID || null,
        venta.TOTAL, `Venta #${id} eliminada`
      );

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Mark as paid (total or partial) ────────────
  async markAsPaid(id: number, payment: PaymentInput, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, TOTAL, COBRADA, MONTO_EFECTIVO, MONTO_DIGITAL,
                       ES_CTA_CORRIENTE, CLIENTE_ID, PUNTO_VENTA_ID
                FROM VENTAS WHERE VENTA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
      }

      const venta = existing.recordset[0];
      const prevEfectivo = venta.MONTO_EFECTIVO || 0;
      const prevDigital = venta.MONTO_DIGITAL || 0;

      // Derive category amounts from metodos_pago if provided
      let payEfectivo = payment.MONTO_EFECTIVO;
      let payDigital = payment.MONTO_DIGITAL;
      let payCheques = 0;
      if (payment.metodos_pago && payment.metodos_pago.length > 0) {
        const derived = await derivarCategorias(tx, payment.metodos_pago);
        payEfectivo = derived.montoEfectivo;
        payDigital = derived.montoDigital;
        payCheques = derived.montoCheques;
      }

      const newEfectivo = prevEfectivo + payEfectivo;
      const newDigital = prevDigital + payDigital;
      const totalPaidNow = newEfectivo + newDigital;
      const cobrada = !payment.parcial && (totalPaidNow >= venta.TOTAL);

      // ── 1. Update VENTAS ──
      await tx.request()
        .input('id', sql.Int, id)
        .input('montoEfectivo', sql.Decimal(18, 2), newEfectivo)
        .input('montoDigital', sql.Decimal(18, 2), newDigital)
        .input('vuelto', sql.Decimal(18, 2), payment.VUELTO)
        .input('cobrada', sql.Bit, cobrada ? 1 : 0)
        .query(`
          UPDATE VENTAS SET 
            MONTO_EFECTIVO=@montoEfectivo, MONTO_DIGITAL=@montoDigital,
            VUELTO=@vuelto, COBRADA=@cobrada
          WHERE VENTA_ID = @id
        `);

      // ── 2. CAJA_ITEMS ──
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      if (caja) {
        const efectivoNeto = Math.max(0, payEfectivo - payment.VUELTO);
        if (efectivoNeto > 0 || payDigital > 0) {
          await tx.request()
            .input('cajaId', sql.Int, caja.CAJA_ID)
            .input('origenTipo', sql.VarChar(30), 'VENTA')
            .input('origenId', sql.Int, id)
            .input('efectivo', sql.Decimal(18, 2), efectivoNeto)
            .input('digital', sql.Decimal(18, 2), payDigital)
            .input('desc', sql.NVarChar(255), `Cobro Venta #${id}`)
            .input('uid', sql.Int, usuarioId)
            .query(`
              INSERT INTO CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
                MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID)
              VALUES (@cajaId, GETDATE(), @origenTipo, @origenId,
                @efectivo, @digital, @desc, @uid)
            `);
        }
      }

      // ── 2b. VENTAS_METODOS_PAGO ──
      if (payment.metodos_pago && payment.metodos_pago.length > 0) {
        await ensureVentasMetodosPagoTable(pool);
        await insertMetodosPago(tx, id, payment.metodos_pago);
        await crearChequesIngreso(tx, 'VENTA', id, payment.metodos_pago, usuarioId, null);
        // Registrar el ingreso de cheques en MOVIMIENTOS_CAJA (caja central)
        if (payCheques > 0) {
          await tx.request()
            .input('idEntidad', sql.Int, id)
            .input('tipoEntidad', sql.VarChar(20), 'VENTA')
            .input('movimiento', sql.NVarChar(500), `Cobro cheque(s) Venta #${id}`)
            .input('uid', sql.Int, usuarioId)
            .input('cheques', sql.Decimal(18, 2), payCheques)
            .input('total', sql.Decimal(18, 2), payCheques)
            .input('pvId', sql.Int, venta.PUNTO_VENTA_ID)
            .query(`
              INSERT INTO MOVIMIENTOS_CAJA (ID_ENTIDAD, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID, EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL)
              VALUES (@idEntidad, @tipoEntidad, @movimiento, @uid, 0, 0, @cheques, 0, @total, @pvId, 0)
            `);
        }
      }

      // ── 3. CTA_CORRIENTE: record payment as HABER ──
      if (venta.ES_CTA_CORRIENTE) {
        const ctaCteResult = await tx.request()
          .input('cid', sql.Int, venta.CLIENTE_ID)
          .query(`SELECT CTA_CORRIENTE_ID FROM CTA_CORRIENTE_C WHERE CLIENTE_ID = @cid`);

        if (ctaCteResult.recordset.length > 0) {
          const ctaCteId = ctaCteResult.recordset[0].CTA_CORRIENTE_ID;
          const totalPayment = r2(payEfectivo + payDigital - payment.VUELTO);
          await tx.request()
            .input('comprobanteId', sql.Int, id)
            .input('ctaCteId', sql.Int, ctaCteId)
            .input('concepto', sql.NVarChar(255), `Pago Venta #${id}`)
            .input('tipoComp', sql.NVarChar(50), 'PAGO')
            .input('haber', sql.Decimal(18, 2), totalPayment)
            .query(`
              INSERT INTO VENTAS_CTA_CORRIENTE
                (COMPROBANTE_ID, CTA_CORRIENTE_ID, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER)
              VALUES
                (@comprobanteId, @ctaCteId, GETDATE(), @concepto, @tipoComp, 0, @haber)
            `);
        }
      }

      // ── 4. AUDITORIA ──
      await registrarAuditoria(
        tx, 'VENTA', id, 'COBRO', usuarioId,
        venta.PUNTO_VENTA_ID, caja?.CAJA_ID || null,
        r2(payEfectivo + payDigital),
        `Cobro Venta #${id}`
      );

      await tx.commit();
      return { ok: true, cobrada };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Remove payment ─────────────────────────────
  async removePaid(id: number, usuarioId: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const existing = await tx.request()
        .input('id', sql.Int, id)
        .query(`SELECT VENTA_ID, TOTAL, COBRADA, ES_CTA_CORRIENTE, CLIENTE_ID,
                       PUNTO_VENTA_ID, MONTO_EFECTIVO, MONTO_DIGITAL
                FROM VENTAS WHERE VENTA_ID = @id`);

      if (existing.recordset.length === 0) {
        throw Object.assign(new Error('Venta no encontrada'), { name: 'ValidationError' });
      }

      const venta = existing.recordset[0];
      const oldMonto = (venta.MONTO_EFECTIVO || 0) + (venta.MONTO_DIGITAL || 0);

      // ── 1. Reset payment on VENTAS ──
      await tx.request()
        .input('id', sql.Int, id)
        .query(`UPDATE VENTAS SET MONTO_EFECTIVO=0, MONTO_DIGITAL=0, VUELTO=0, COBRADA=0
                WHERE VENTA_ID = @id`);

      // ── 2. Remove CAJA_ITEMS for this sale ──
      await tx.request().input('origenId', sql.Int, id)
        .query(`DELETE FROM CAJA_ITEMS WHERE ORIGEN_ID = @origenId AND ORIGEN_TIPO = 'VENTA'`);

      // ── 2b. Remove VENTAS_METODOS_PAGO ──
      await ensureVentasMetodosPagoTable(pool);
      await tx.request().input('ventaId', sql.Int, id)
        .query(`DELETE FROM VENTAS_METODOS_PAGO WHERE VENTA_ID = @ventaId`);

      // ── 2c. Clean up EN_CARTERA cheques from this sale's payment ──
      try {
        const chequesNoCartera2 = await tx.request()
          .input('ventaId', sql.Int, id)
          .query(`SELECT COUNT(*) AS CNT FROM CHEQUES
                  WHERE ORIGEN_TIPO = 'VENTA' AND ORIGEN_ID = @ventaId AND ESTADO <> 'EN_CARTERA'`);
        if (chequesNoCartera2.recordset[0].CNT > 0) {
          throw Object.assign(
            new Error('No se puede quitar el cobro porque hay cheques ya procesados (depositados o egresados). Anule los cheques primero.'),
            { name: 'ValidationError' }
          );
        }
        await tx.request().input('ventaId', sql.Int, id)
          .query(`DELETE ch FROM CHEQUES_HISTORIAL ch
                  INNER JOIN CHEQUES c ON ch.CHEQUE_ID = c.CHEQUE_ID
                  WHERE c.ORIGEN_TIPO = 'VENTA' AND c.ORIGEN_ID = @ventaId AND c.ESTADO = 'EN_CARTERA'`);
        await tx.request().input('ventaId', sql.Int, id)
          .query(`DELETE FROM CHEQUES WHERE ORIGEN_TIPO = 'VENTA' AND ORIGEN_ID = @ventaId AND ESTADO = 'EN_CARTERA'`);
        // Remove cheque MOVIMIENTOS_CAJA entries
        await tx.request().input('ventaId', sql.Int, id)
          .query(`DELETE FROM MOVIMIENTOS_CAJA WHERE ID_ENTIDAD = @ventaId AND TIPO_ENTIDAD = 'VENTA'`);
      } catch (chqErr2: any) {
        if (chqErr2.name === 'ValidationError') throw chqErr2;
        // If CHEQUES table doesn't exist yet, ignore
      }

      // ── 3. Remove CTA_CORRIENTE payment records ──
      if (venta.ES_CTA_CORRIENTE) {
        await tx.request().input('comprobanteId', sql.Int, id)
          .query(`DELETE FROM VENTAS_CTA_CORRIENTE
                  WHERE COMPROBANTE_ID = @comprobanteId AND TIPO_COMPROBANTE = 'PAGO'`);
      }

      // ── 4. AUDITORIA ──
      const caja = await getCajaAbiertaTx(tx, usuarioId);
      await registrarAuditoria(
        tx, 'VENTA', id, 'DESCOBRO', usuarioId,
        venta.PUNTO_VENTA_ID, caja?.CAJA_ID || null,
        oldMonto, `Descobro Venta #${id}`
      );

      await tx.commit();
      return { ok: true };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Search products for sale form ──────────────
  async searchProducts(search: string, listaId: number = 0, limit: number = 20) {
    const pool = await getPool();

    // If listaId is explicitly provided (>0), use that fixed list.
    // Otherwise (0), use each product's LISTA_DEFECTO.
    const precioExpr = listaId > 0
      ? `p.LISTA_${Math.max(1, Math.min(5, listaId))}`
      : `CASE ISNULL(p.LISTA_DEFECTO, 1)
           WHEN 1 THEN p.LISTA_1
           WHEN 2 THEN p.LISTA_2
           WHEN 3 THEN p.LISTA_3
           WHEN 4 THEN p.LISTA_4
           WHEN 5 THEN p.LISTA_5
           ELSE p.LISTA_1
         END`;

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
          ${precioExpr} AS PRECIO_VENTA,
          ISNULL(p.LISTA_DEFECTO, 1) AS LISTA_DEFECTO,
          p.LISTA_1, p.LISTA_2, p.LISTA_3, p.LISTA_4, p.LISTA_5,
          p.PRECIO_COMPRA, p.CANTIDAD AS STOCK,
          p.ES_CONJUNTO, p.ES_SERVICIO, p.DESCUENTA_STOCK, p.ACTIVO,
          p.IMP_INT, p.TASA_IVA_ID, p.UNIDAD_ID,
          ISNULL(u.NOMBRE, '') AS UNIDAD_NOMBRE,
          ISNULL(u.ABREVIACION, '') AS UNIDAD_ABREVIACION,
          ISNULL(ti.PORCENTAJE, 0) AS IVA_PORCENTAJE
        FROM PRODUCTOS p
        LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
        LEFT JOIN TASAS_IMPUESTOS ti ON p.TASA_IVA_ID = ti.TASA_ID
        LEFT JOIN PRODUCTOS_COD_BARRAS cb ON p.PRODUCTO_ID = cb.PRODUCTO_ID
        LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
        LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
        WHERE p.ACTIVO = 1
          AND ${tokenConditions}
        ORDER BY p.NOMBRE
      `);

    return result.recordset;
  },

  // ── Advanced product search for modal ──────────
  async searchProductsAdvanced(params: {
    search?: string;
    marca?: string;
    categoria?: string;
    codigo?: string;
    soloActivos?: boolean;
    soloConStock?: boolean;
    listaId?: number;
    limit?: number;
  }) {
    const pool = await getPool();
    const limit = params.limit || 50;
    const listaId = params.listaId || 0;

    const precioExpr = listaId > 0
      ? `p.LISTA_${Math.max(1, Math.min(5, listaId))}`
      : `CASE ISNULL(p.LISTA_DEFECTO, 1)
           WHEN 1 THEN p.LISTA_1
           WHEN 2 THEN p.LISTA_2
           WHEN 3 THEN p.LISTA_3
           WHEN 4 THEN p.LISTA_4
           WHEN 5 THEN p.LISTA_5
           ELSE p.LISTA_1
         END`;

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
          ${precioExpr} AS PRECIO_VENTA,
          ISNULL(p.LISTA_DEFECTO, 1) AS LISTA_DEFECTO,
          p.LISTA_1, p.LISTA_2, p.LISTA_3, p.LISTA_4, p.LISTA_5,
          p.PRECIO_COMPRA, p.CANTIDAD AS STOCK,
          p.ES_CONJUNTO, p.ES_SERVICIO, p.DESCUENTA_STOCK,
          p.IMP_INT, p.TASA_IVA_ID, p.UNIDAD_ID,
          ISNULL(u.NOMBRE, '') AS UNIDAD_NOMBRE,
          ISNULL(u.ABREVIACION, '') AS UNIDAD_ABREVIACION,
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

  // ── Barcode balance (código de balanza) ────────
  // Format: 13 digits → prefix "2" + 5-digit product ID (PLU) + 6-digit weight in grams + 1 control
  parseBalanzaBarcode(code: string): { productoId: number; cantidad: number } | null {
    if (!code || code.length !== 13) return null;
    if (code[0] !== '2') return null;
    if (!/^\d{13}$/.test(code)) return null;

    const productoId = parseInt(code.substring(1, 6), 10);
    const gramos = parseInt(code.substring(6, 12), 10);
    if (isNaN(productoId) || productoId <= 0 || isNaN(gramos)) return null;

    return { productoId, cantidad: gramos / 1000 };
  },

  async getProductByBalanzaCode(code: string, listaId: number = 0) {
    const parsed = this.parseBalanzaBarcode(code);
    if (!parsed) return null;

    const pool = await getPool();

    const precioExpr = listaId > 0
      ? `p.LISTA_${Math.max(1, Math.min(5, listaId))}`
      : `CASE ISNULL(p.LISTA_DEFECTO, 1)
           WHEN 1 THEN p.LISTA_1
           WHEN 2 THEN p.LISTA_2
           WHEN 3 THEN p.LISTA_3
           WHEN 4 THEN p.LISTA_4
           WHEN 5 THEN p.LISTA_5
           ELSE p.LISTA_1
         END`;

    const result = await pool.request()
      .input('pid', sql.Int, parsed.productoId)
      .query(`
        SELECT
          p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE,
          ${precioExpr} AS PRECIO_VENTA,
          ISNULL(p.LISTA_DEFECTO, 1) AS LISTA_DEFECTO,
          p.LISTA_1, p.LISTA_2, p.LISTA_3, p.LISTA_4, p.LISTA_5,
          p.PRECIO_COMPRA, p.CANTIDAD AS STOCK,
          p.ES_CONJUNTO, p.DESCUENTA_STOCK, p.ACTIVO,
          p.IMP_INT, p.TASA_IVA_ID, p.UNIDAD_ID,
          ISNULL(u.NOMBRE, '') AS UNIDAD_NOMBRE,
          ISNULL(u.ABREVIACION, '') AS UNIDAD_ABREVIACION,
          ISNULL(ti.PORCENTAJE, 0) AS IVA_PORCENTAJE
        FROM PRODUCTOS p
        LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
        LEFT JOIN TASAS_IMPUESTOS ti ON p.TASA_IVA_ID = ti.TASA_ID
        WHERE p.PRODUCTO_ID = @pid AND p.ACTIVO = 1
      `);

    if (result.recordset.length === 0) return null;

    return {
      product: result.recordset[0],
      cantidad: parsed.cantidad,
    };
  },

  // ── Clients for sale form ──────────────────────
  async getClientes() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CLIENTE_ID, CODIGOPARTICULAR, NOMBRE, CONDICION_IVA, 
             CTA_CORRIENTE, TIPO_DOCUMENTO, NUMERO_DOC
      FROM CLIENTES WHERE ACTIVO = 1 ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Depositos for sale form ────────────────────
  async getDepositos() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT DEPOSITO_ID, CODIGOPARTICULAR, NOMBRE FROM DEPOSITOS ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Depositos linked to a punto de venta ───────
  async getDepositosPuntoVenta(puntoVentaId: number) {
    const pool = await getPool();
    const result = await pool.request()
      .input('pvId', sql.Int, puntoVentaId)
      .query(`
        SELECT d.DEPOSITO_ID, d.CODIGOPARTICULAR, d.NOMBRE, pvd.ES_PREFERIDO
        FROM PUNTOS_VENTA_DEPOSITOS pvd
        JOIN DEPOSITOS d ON pvd.DEPOSITO_ID = d.DEPOSITO_ID
        WHERE pvd.PUNTO_VENTA_ID = @pvId
        ORDER BY pvd.ES_PREFERIDO DESC, d.NOMBRE
      `);
    return result.recordset;
  },

  // ── Empresa IVA condition ──────────────────────
  async getEmpresaIva() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT CONDICION_IVA FROM EMPRESA_CLIENTE
    `);
    return result.recordset.length > 0
      ? { CONDICION_IVA: result.recordset[0].CONDICION_IVA }
      : { CONDICION_IVA: null };
  },

  // ── Empresa info (for receipts) ────────────────
  async getEmpresaInfo() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT RAZON_SOCIAL, DOMICILIO_FISCAL, CONDICION_IVA, CUIT
      FROM EMPRESA_CLIENTE
    `);
    const row = result.recordset[0] || {};
    return {
      NOMBRE_FANTASIA: config.app.nombreFantasia || row.RAZON_SOCIAL || '',
      RAZON_SOCIAL: row.RAZON_SOCIAL || '',
      DOMICILIO_FISCAL: row.DOMICILIO_FISCAL || '',
      CONDICION_IVA: row.CONDICION_IVA || '',
      CUIT: row.CUIT || '',
      TELEFONO_CLIENTE: config.app.telefonoCliente || '',
    };
  },

  // ── Send WhatsApp message ──────────────────────
  async sendWhatsApp(telefono: string, mensaje: string) {
    const ipWsp = config.integrations.ipWsp;
    if (!ipWsp) {
      throw Object.assign(new Error('WhatsApp no configurado (ipWsp)'), { name: 'ValidationError' });
    }

    const url = `${ipWsp}/send-message`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: telefono, mensaje }),
    });

    if (!response.ok) {
      throw new Error(`Error al enviar WhatsApp: ${response.status}`);
    }

    return { success: true };
  },

  // ── Build WhatsApp sale detail message ─────────
  async buildWhatsAppMessage(ventaId: number) {
    const venta = await this.getById(ventaId);
    const empresa = await this.getEmpresaInfo();

    let msg = `*-------- ${empresa.NOMBRE_FANTASIA.toUpperCase()} --------*\n`;
    msg += `🗣️ \`\`\`Su compra.\`\`\`\n\n`;
    msg += `Estimado/a *${venta.CLIENTE_NOMBRE || 'Cliente'}*\n\n`;
    msg += `Le enviamos el detalle de su compra:\n\n`;

    for (const item of venta.items) {
      const unidad = (item as any).UNIDAD_ABREVIACION || 'u';
      const qtyStr = formatQtyWsp(item.CANTIDAD, unidad);
      const total = item.DESCUENTO > 0
        ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100) * item.CANTIDAD
        : item.PRECIO_UNITARIO * item.CANTIDAD;
      msg += `- _x ${qtyStr}_ *${item.PRODUCTO_NOMBRE}*   _total_ = _$${fmtDecimal(total)}_\n`;
    }

    msg += `\n- *TOTAL* = *$${fmtDecimal(venta.TOTAL)}*.\n\n`;
    msg += `Gracias por su compra.🫱🏻‍🫲🏼\n\n`;
    msg += `_Enviado desde *Río Gestión* Software_.`;

    return msg;
  },

  // ── Send sale detail notifications ─────────────
  async sendSaleWhatsApp(ventaId: number, telefonoCliente: string, nombreCliente: string) {
    const msg = await this.buildWhatsAppMessage(ventaId);

    // Normalize phone: ensure 549 prefix
    let phone = telefonoCliente.replace(/\D/g, '');
    if (phone.length === 10) phone = `549${phone}`;
    else if (phone.length === 12 && phone.startsWith('54')) phone = `549${phone.slice(2)}`;

    // 1. Send to customer
    await this.sendWhatsApp(phone, msg);

    // 2. Send notification to business owner
    const ownerPhone = config.app.telefonoCliente;
    if (ownerPhone) {
      let ownerNum = ownerPhone.replace(/\D/g, '');
      if (ownerNum.length === 10) ownerNum = `549${ownerNum}`;

      const ownerMsg = `*-------- RÍO GESTIÓN --------*\n` +
        `🗣️ \`\`\`Cliente notificado.\`\`\`\n\n` +
        `Se ha enviado el detalle de la venta a:\n` +
        `- Nombre: *${nombreCliente}* .\n` +
        `- Cel: *${telefonoCliente}* .\n\n` +
        `_Gestionamos con vos, crecemos juntos_.🫱🏻‍🫲🏼`;

      try {
        await this.sendWhatsApp(ownerNum, ownerMsg);
      } catch { /* don't fail main flow if owner notification fails */ }
    }

    // 3. Update venta record with send info
    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, ventaId)
      .input('nombre', sql.NVarChar, nombreCliente)
      .input('nro', sql.NVarChar, telefonoCliente)
      .query(`
        UPDATE VENTAS
        SET NOMBRE_ENVIO_DETALLE = @nombre, NRO_ENVIO_DETALLE = @nro
        WHERE VENTA_ID = @id
      `);

    return { success: true };
  },

  // ── Get payment method breakdown for a sale ────
  async getMetodosPagoVenta(ventaId: number): Promise<VentaMetodoPago[]> {
    const pool = await getPool();
    await ensureVentasMetodosPagoTable(pool);
    const result = await pool.request()
      .input('ventaId', sql.Int, ventaId)
      .query(`
        SELECT vmp.ID, vmp.VENTA_ID, vmp.METODO_PAGO_ID, vmp.MONTO,
               mp.NOMBRE AS METODO_NOMBRE, mp.CATEGORIA AS METODO_CATEGORIA
        FROM VENTAS_METODOS_PAGO vmp
        LEFT JOIN METODOS_PAGO mp ON vmp.METODO_PAGO_ID = mp.METODO_PAGO_ID
        WHERE vmp.VENTA_ID = @ventaId
      `);
    return result.recordset;
  },

  // ── Get aggregated payment method breakdown for a caja ─
  async getDesgloseMetodosCaja(cajaId: number) {
    const pool = await getPool();
    await ensureVentasMetodosPagoTable(pool);
    const result = await pool.request()
      .input('cajaId', sql.Int, cajaId)
      .query(`
        ;WITH CierreCaja AS (
          SELECT ISNULL(EFECTIVO, 0) AS EFECTIVO_CIERRE,
                 ISNULL(DIGITAL, 0)  AS DIGITAL_CIERRE
          FROM MOVIMIENTOS_CAJA
          WHERE CAJA_ID = @cajaId AND TIPO_ENTIDAD = 'CIERRE_CAJA'
        ),
        HasCierre AS (
          SELECT CASE WHEN EXISTS (SELECT 1 FROM CierreCaja) THEN 1 ELSE 0 END AS VAL
        ),
        VentasBruto AS (
          SELECT mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64,
                 SUM(vmp.MONTO) AS TOTAL
          FROM CAJA_ITEMS ci
          JOIN VENTAS_METODOS_PAGO vmp ON ci.ORIGEN_ID = vmp.VENTA_ID AND ci.ORIGEN_TIPO = 'VENTA'
          JOIN METODOS_PAGO mp ON vmp.METODO_PAGO_ID = mp.METODO_PAGO_ID
          WHERE ci.CAJA_ID = @cajaId
          GROUP BY mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64
        ),
        BrutosPorCat AS (
          SELECT ISNULL(SUM(CASE WHEN CATEGORIA = 'EFECTIVO' THEN TOTAL ELSE 0 END), 0) AS BRUTO_EF,
                 ISNULL(SUM(CASE WHEN CATEGORIA = 'DIGITAL'  THEN TOTAL ELSE 0 END), 0) AS BRUTO_DIG
          FROM VentasBruto
        ),
        MetodosAjustados AS (
          SELECT vb.METODO_PAGO_ID, vb.NOMBRE, vb.CATEGORIA, vb.IMAGEN_BASE64,
                 CASE
                   WHEN (SELECT VAL FROM HasCierre) = 0 THEN vb.TOTAL
                   WHEN vb.CATEGORIA = 'EFECTIVO' AND (SELECT BRUTO_EF FROM BrutosPorCat) > 0
                   THEN CAST(ROUND(vb.TOTAL * 1.0 * (SELECT EFECTIVO_CIERRE FROM CierreCaja) / (SELECT BRUTO_EF FROM BrutosPorCat), 2) AS DECIMAL(18,2))
                   WHEN vb.CATEGORIA = 'DIGITAL' AND (SELECT BRUTO_DIG FROM BrutosPorCat) > 0
                   THEN CAST(ROUND(vb.TOTAL * 1.0 * (SELECT DIGITAL_CIERRE FROM CierreCaja) / (SELECT BRUTO_DIG FROM BrutosPorCat), 2) AS DECIMAL(18,2))
                   ELSE vb.TOTAL
                 END AS TOTAL
          FROM VentasBruto vb
        ),
        DefaultEfectivo AS (
          SELECT TOP 1 METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64
          FROM METODOS_PAGO WHERE CATEGORIA = 'EFECTIVO' AND ACTIVA = 1
          ORDER BY POR_DEFECTO DESC, METODO_PAGO_ID ASC
        ),
        DefaultDigital AS (
          SELECT TOP 1 METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64
          FROM METODOS_PAGO WHERE CATEGORIA = 'DIGITAL' AND ACTIVA = 1
          ORDER BY POR_DEFECTO DESC, METODO_PAGO_ID ASC
        ),
        FallbackEfectivo AS (
          SELECT de.METODO_PAGO_ID, de.NOMBRE, de.CATEGORIA, de.IMAGEN_BASE64,
                 (SELECT EFECTIVO_CIERRE FROM CierreCaja) AS TOTAL
          FROM DefaultEfectivo de
          WHERE (SELECT VAL FROM HasCierre) = 1
            AND (SELECT BRUTO_EF FROM BrutosPorCat) = 0
            AND (SELECT EFECTIVO_CIERRE FROM CierreCaja) <> 0
        ),
        FallbackDigital AS (
          SELECT dd.METODO_PAGO_ID, dd.NOMBRE, dd.CATEGORIA, dd.IMAGEN_BASE64,
                 (SELECT DIGITAL_CIERRE FROM CierreCaja) AS TOTAL
          FROM DefaultDigital dd
          WHERE (SELECT VAL FROM HasCierre) = 1
            AND (SELECT BRUTO_DIG FROM BrutosPorCat) = 0
            AND (SELECT DIGITAL_CIERRE FROM CierreCaja) <> 0
        ),
        AllMetodos AS (
          SELECT * FROM MetodosAjustados
          UNION ALL SELECT * FROM FallbackEfectivo
          UNION ALL SELECT * FROM FallbackDigital
        )
        SELECT METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64,
               SUM(TOTAL) AS TOTAL
        FROM AllMetodos
        GROUP BY METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64
        HAVING SUM(TOTAL) <> 0
        ORDER BY CASE WHEN CATEGORIA = 'EFECTIVO' THEN 0 ELSE 1 END, NOMBRE
      `);
    return result.recordset;
  },

  // ── Get aggregated payment method breakdown for caja central period ─
  // Subtracts Fondo de Cambio deposits from EFECTIVO-category methods proportionally
  async getDesgloseMetodosCajaCentral(filter: { fechaDesde?: string; fechaHasta?: string; puntoVentaIds?: number[] }) {
    const pool = await getPool();
    await ensureVentasMetodosPagoTable(pool);
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MOVIMIENTOS_CAJA_METODOS_PAGO')
      CREATE TABLE MOVIMIENTOS_CAJA_METODOS_PAGO (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        MOVIMIENTO_ID INT NOT NULL,
        METODO_PAGO_ID INT NOT NULL,
        MONTO DECIMAL(18,2) NOT NULL
      )
    `);

    let commonWhere = '';
    const req = pool.request();

    if (filter.fechaDesde) {
      commonWhere += ' AND mc.FECHA >= @fechaDesde';
      req.input('fechaDesde', sql.DateTime, new Date(filter.fechaDesde + 'T00:00:00'));
    }
    if (filter.fechaHasta) {
      commonWhere += ' AND mc.FECHA <= @fechaHasta';
      req.input('fechaHasta', sql.DateTime, new Date(filter.fechaHasta + 'T23:59:59'));
    }
    if (filter.puntoVentaIds && filter.puntoVentaIds.length > 0) {
      const ph = filter.puntoVentaIds.map((_, i) => `@pv${i}`).join(', ');
      commonWhere += ` AND mc.PUNTO_VENTA_ID IN (${ph})`;
      filter.puntoVentaIds.forEach((id, i) => req.input(`pv${i}`, sql.Int, id));
    }

    const result = await req.query(`
      ;WITH CierresEfDig AS (
        SELECT ISNULL(SUM(mc.EFECTIVO), 0) AS EFECTIVO_CIERRE,
               ISNULL(SUM(mc.DIGITAL), 0)  AS DIGITAL_CIERRE
        FROM MOVIMIENTOS_CAJA mc
        WHERE mc.TIPO_ENTIDAD = 'CIERRE_CAJA' ${commonWhere}
      ),
      VentasBruto AS (
        SELECT mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64,
               ISNULL(SUM(vmp.MONTO), 0) AS TOTAL
        FROM MOVIMIENTOS_CAJA mc
        JOIN CAJA_ITEMS ci ON ci.CAJA_ID = mc.CAJA_ID AND ci.ORIGEN_TIPO = 'VENTA'
        JOIN VENTAS_METODOS_PAGO vmp ON ci.ORIGEN_ID = vmp.VENTA_ID
        JOIN METODOS_PAGO mp ON vmp.METODO_PAGO_ID = mp.METODO_PAGO_ID
        WHERE mc.TIPO_ENTIDAD = 'CIERRE_CAJA' ${commonWhere}
        GROUP BY mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64
      ),
      BrutosPorCat AS (
        SELECT ISNULL(SUM(CASE WHEN CATEGORIA = 'EFECTIVO' THEN TOTAL ELSE 0 END), 0) AS BRUTO_EF,
               ISNULL(SUM(CASE WHEN CATEGORIA = 'DIGITAL'  THEN TOTAL ELSE 0 END), 0) AS BRUTO_DIG
        FROM VentasBruto
      ),
      VentasPorMetodo AS (
        SELECT vb.METODO_PAGO_ID, vb.NOMBRE, vb.CATEGORIA, vb.IMAGEN_BASE64,
               CASE
                 WHEN vb.CATEGORIA = 'EFECTIVO' AND (SELECT BRUTO_EF FROM BrutosPorCat) > 0
                 THEN CAST(ROUND(vb.TOTAL * 1.0 * (SELECT EFECTIVO_CIERRE FROM CierresEfDig) / (SELECT BRUTO_EF FROM BrutosPorCat), 2) AS DECIMAL(18,2))
                 WHEN vb.CATEGORIA = 'DIGITAL' AND (SELECT BRUTO_DIG FROM BrutosPorCat) > 0
                 THEN CAST(ROUND(vb.TOTAL * 1.0 * (SELECT DIGITAL_CIERRE FROM CierresEfDig) / (SELECT BRUTO_DIG FROM BrutosPorCat), 2) AS DECIMAL(18,2))
                 ELSE vb.TOTAL
               END AS TOTAL
        FROM VentasBruto vb
      ),
      MovimientosConMetodosPago AS (
        SELECT mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64,
               ISNULL(SUM(mcmp.MONTO), 0) AS TOTAL
        FROM MOVIMIENTOS_CAJA mc
        JOIN MOVIMIENTOS_CAJA_METODOS_PAGO mcmp ON mc.ID = mcmp.MOVIMIENTO_ID
        JOIN METODOS_PAGO mp ON mcmp.METODO_PAGO_ID = mp.METODO_PAGO_ID
        WHERE mc.TIPO_ENTIDAD NOT IN ('CIERRE_CAJA', 'TRANSFERENCIA_FC', 'REINTEGRO_FONDO', 'DEPOSITO_FONDO') ${commonWhere}
        GROUP BY mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64
      ),
      MetodoTotales AS (
        SELECT METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64, SUM(TOTAL) AS TOTAL
        FROM (
          SELECT * FROM VentasPorMetodo
          UNION ALL
          SELECT * FROM MovimientosConMetodosPago
        ) t
        GROUP BY METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64
      ),
      AjusteEfectivo AS (
        SELECT ISNULL(SUM(mc.EFECTIVO), 0) AS NETO
        FROM MOVIMIENTOS_CAJA mc
        WHERE mc.TIPO_ENTIDAD NOT IN ('CIERRE_CAJA') ${commonWhere}
          AND (mc.ES_MANUAL = 0 OR mc.TIPO_ENTIDAD IN ('TRANSFERENCIA_FC', 'REINTEGRO_FONDO', 'DEPOSITO_FONDO'))
          AND NOT EXISTS (
            SELECT 1
            FROM MOVIMIENTOS_CAJA_METODOS_PAGO mcmp
            WHERE mcmp.MOVIMIENTO_ID = mc.ID
          )
      ),
      Resumen AS (
        SELECT
          ISNULL(SUM(CASE WHEN CATEGORIA = 'EFECTIVO' THEN TOTAL ELSE 0 END), 0) AS TOTAL_EF,
          COUNT(CASE WHEN CATEGORIA = 'EFECTIVO' THEN 1 END) AS CANT_EF
        FROM MetodoTotales
      ),
      DefaultEfectivo AS (
        SELECT TOP 1 METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64
        FROM METODOS_PAGO
        WHERE CATEGORIA = 'EFECTIVO' AND ACTIVA = 1
        ORDER BY POR_DEFECTO DESC, METODO_PAGO_ID
      ),
      AllMetodos AS (
        SELECT METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64, TOTAL FROM MetodoTotales
        UNION ALL
        SELECT de.METODO_PAGO_ID, de.NOMBRE, de.CATEGORIA, de.IMAGEN_BASE64, CAST(0 AS DECIMAL(18,2))
        FROM DefaultEfectivo de
        WHERE (SELECT CANT_EF FROM Resumen) = 0
          AND (SELECT NETO FROM AjusteEfectivo) != 0
          AND de.METODO_PAGO_ID NOT IN (SELECT METODO_PAGO_ID FROM MetodoTotales)
      )
      SELECT am.METODO_PAGO_ID, am.NOMBRE, am.CATEGORIA, am.IMAGEN_BASE64,
             CASE
               WHEN am.CATEGORIA = 'EFECTIVO' AND (SELECT TOTAL_EF FROM Resumen) > 0
               THEN am.TOTAL + ((SELECT NETO FROM AjusteEfectivo) * am.TOTAL / (SELECT TOTAL_EF FROM Resumen))
               WHEN am.CATEGORIA = 'EFECTIVO' AND (SELECT TOTAL_EF FROM Resumen) = 0
               THEN (SELECT NETO FROM AjusteEfectivo)
               ELSE am.TOTAL
             END AS TOTAL
      FROM AllMetodos am
      ORDER BY
        CASE
          WHEN am.CATEGORIA = 'EFECTIVO' THEN 0
          ELSE 1
        END,
        am.NOMBRE
    `);
    return result.recordset;
  },

  // ── Get active payment methods (for sales flow) ─
  async getActivePaymentMethods() {
    const pool = await getPool();
    // Ensure METODOS_PAGO table exists (paymentMethodService.ensureTable does this,
    // but we call a lightweight check here to avoid circular dependency)
    try {
      const result = await pool.request().query(`
        SELECT METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64
        FROM METODOS_PAGO
        WHERE ACTIVA = 1
        ORDER BY
          CASE
            WHEN CATEGORIA = 'EFECTIVO' AND ISNULL(POR_DEFECTO, 0) = 1 THEN 0
            WHEN CATEGORIA = 'EFECTIVO' THEN 1
            ELSE 2
          END,
          NOMBRE
      `);
      return result.recordset;
    } catch {
      return [];
    }
  },
};

// ── WhatsApp formatting helpers ──────────────────
function formatQtyWsp(cantidad: number, unidad: string): string {
  const u = (unidad || 'u').toLowerCase();
  if (u === 'kg') return `${cantidad.toFixed(3)} Kg`;
  if (u === 'lts' || u === 'lt') return `${cantidad.toFixed(2)} lts`;
  return `${cantidad.toFixed(2)} u`;
}

function fmtDecimal(n: number): string {
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
