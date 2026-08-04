import { sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  Stock Validator — Central helper that enforces the
//  PERMITE_STOCK_NEGATIVO flag from PRODUCTOS.
//
//  All services that decrement stock (sales, remitos SALIDA,
//  NC, manual adjustments, mobile) must call
//  assertStockDisponible() inside the same transaction,
//  BEFORE issuing the UPDATE, so concurrent operations
//  inside the same TX are serialized and the rollback
//  path is honored.
// ═══════════════════════════════════════════════════

export interface StockValidationContext {
  /** Tipo de operación, usado en el mensaje de error. */
  operacion: 'VENTA' | 'COMPRA' | 'AJUSTE_MANUAL' | 'REMITO' | 'NC_COMPRA' | 'NC_VENTA' | 'ND_VENTA' | 'TRANSFERENCIA' | 'PRODUCTO_EDIT';
  /** ID de la operación (venta, compra, etc.) para el mensaje. */
  referenciaId?: number | null;
  /** Descripción corta adicional (ej: "Venta #123"). */
  referenciaDetalle?: string | null;
}

/**
 * Looks up PERMITE_STOCK_NEGATIVO for the product and, if the operation would
 * leave the stock below zero, throws a structured error that the frontend
 * can translate into a friendly notification.
 *
 * Returns without doing anything when:
 *  - product is a service (ES_SERVICIO = 1)
 *  - product is a kit (ES_CONJUNTO = 1) — caller validates children
 *  - product allows negative stock (PERMITE_STOCK_NEGATIVO = 1)
 *  - delta is not a decrease (≤ 0)
 *
 * NOTE: Se debe llamar DENTRO de la misma transacción (tx) que ejecuta el
 * UPDATE, para evitar race conditions.
 */
export async function assertStockDisponible(
  tx: any,
  productoId: number,
  depositoId: number | null,
  deltaNegativo: number,
  contexto: StockValidationContext,
): Promise<void> {
  if (deltaNegativo <= 0) return;

  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query(`SELECT
              NOMBRE,
              ES_CONJUNTO,
              ES_SERVICIO,
              ISNULL(PERMITE_STOCK_NEGATIVO, 0) AS PERMITE_STOCK_NEGATIVO
            FROM PRODUCTOS WHERE PRODUCTO_ID = @pid`);

  if (prod.recordset.length === 0) {
    throw Object.assign(
      new Error(`Producto ${productoId} no encontrado al validar stock`),
      { name: 'ValidationError', code: 'PRODUCTO_NO_ENCONTRADO' },
    );
  }

  const { NOMBRE, ES_CONJUNTO, ES_SERVICIO, PERMITE_STOCK_NEGATIVO } = prod.recordset[0];

  if (ES_SERVICIO) return;
  if (ES_CONJUNTO) return;
  if (PERMITE_STOCK_NEGATIVO) return;

  // Validamos contra STOCK_DEPOSITOS cuando hay un depósito específico.
  // Si no hay depósito, validamos contra el agregado en PRODUCTOS.CANTIDAD
  // (caso de productos "globales" o remitos sin depósito).
  let stockActual: number;
  let origenValidacion: string;

  if (depositoId !== null && depositoId !== undefined) {
    const dep = await tx.request()
      .input('pid', sql.Int, productoId)
      .input('did', sql.Int, depositoId)
      .query(`SELECT ISNULL(SUM(CANTIDAD),0) AS CANT
              FROM STOCK_DEPOSITOS
              WHERE PRODUCTO_ID = @pid AND DEPOSITO_ID = @did`);
    stockActual = Number(dep.recordset[0]?.CANT ?? 0);

    const depNameRes = await tx.request()
      .input('did', sql.Int, depositoId)
      .query(`SELECT TOP 1 NOMBRE FROM DEPOSITOS WHERE DEPOSITO_ID = @did`);
    const depNombre = depNameRes.recordset[0]?.NOMBRE || `#${depositoId}`;
    origenValidacion = `depósito ${depNombre}`;
  } else {
    const tot = await tx.request()
      .input('pid', sql.Int, productoId)
      .query(`SELECT ISNULL(CANTIDAD, 0) AS CANT FROM PRODUCTOS WHERE PRODUCTO_ID = @pid`);
    stockActual = Number(tot.recordset[0]?.CANT ?? 0);
    origenValidacion = 'stock total';
  }

  const stockResultante = stockActual - deltaNegativo;
  if (stockResultante < 0) {
    const refTxt = contexto.referenciaDetalle
      || `${contexto.operacion}${contexto.referenciaId ? ' #' + contexto.referenciaId : ''}`;
    throw Object.assign(
      new Error(
        `Stock insuficiente para "${NOMBRE}" en ${origenValidacion}. ` +
        `Disponible: ${stockActual}, requerido: ${deltaNegativo}. ` +
        `(${refTxt})`,
      ),
      {
        name: 'StockInsuficienteError',
        code: 'STOCK_INSUFICIENTE',
        status: 409,
        detalles: {
          PRODUCTO_ID: productoId,
          PRODUCTO_NOMBRE: NOMBRE,
          DEPOSITO_ID: depositoId ?? null,
          STOCK_ACTUAL: stockActual,
          CANTIDAD_REQUERIDA: deltaNegativo,
          OPERACION: contexto.operacion,
          REFERENCIA_ID: contexto.referenciaId ?? null,
        },
      },
    );
  }
}

/**
 * Valida que un valor absoluto de stock (usado en ajustes manuales) no
 * deje el stock en negativo cuando el producto no lo permite.
 *
 * A diferencia de assertStockDisponible, este valida el valor final
 * (no el delta), porque updateStock setea el stock absoluto.
 */
export async function assertStockNoNegativo(
  tx: any,
  productoId: number,
  depositoId: number,
  cantidadNueva: number,
  contexto: StockValidationContext,
): Promise<void> {
  if (cantidadNueva >= 0) return;

  const prod = await tx.request()
    .input('pid', sql.Int, productoId)
    .query(`SELECT
              NOMBRE,
              ES_CONJUNTO,
              ES_SERVICIO,
              ISNULL(PERMITE_STOCK_NEGATIVO, 0) AS PERMITE_STOCK_NEGATIVO
            FROM PRODUCTOS WHERE PRODUCTO_ID = @pid`);

  if (prod.recordset.length === 0) {
    throw Object.assign(
      new Error(`Producto ${productoId} no encontrado al validar stock`),
      { name: 'ValidationError', code: 'PRODUCTO_NO_ENCONTRADO' },
    );
  }

  const { NOMBRE, ES_CONJUNTO, ES_SERVICIO, PERMITE_STOCK_NEGATIVO } = prod.recordset[0];

  if (ES_SERVICIO) return;
  if (ES_CONJUNTO) return;
  if (PERMITE_STOCK_NEGATIVO) return;

  const depNameRes = await tx.request()
    .input('did', sql.Int, depositoId)
    .query(`SELECT TOP 1 NOMBRE FROM DEPOSITOS WHERE DEPOSITO_ID = @did`);
  const depNombre = depNameRes.recordset[0]?.NOMBRE || `#${depositoId}`;

  throw Object.assign(
    new Error(
      `No se puede dejar stock negativo (${cantidadNueva}) para "${NOMBRE}" en depósito ${depNombre}. ` +
      `Active "Permite stock negativo" en el producto o ingrese un valor >= 0.`,
    ),
    {
      name: 'StockInsuficienteError',
      code: 'STOCK_INSUFICIENTE',
      status: 409,
      detalles: {
        PRODUCTO_ID: productoId,
        PRODUCTO_NOMBRE: NOMBRE,
        DEPOSITO_ID: depositoId,
        STOCK_ACTUAL: cantidadNueva,
        CANTIDAD_REQUERIDA: 0,
        OPERACION: contexto.operacion,
        REFERENCIA_ID: contexto.referenciaId ?? null,
      },
    },
  );
}
