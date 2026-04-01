import { sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  Stock History Helper — Shared utility for logging
//  stock changes across all services.
// ═══════════════════════════════════════════════════

export interface HistorialStockParams {
  productoId: number;
  depositoId: number;
  cantidadAnterior: number;
  cantidadNueva: number;
  tipoOperacion: 'VENTA' | 'COMPRA' | 'AJUSTE_MANUAL' | 'REMITO' | 'NC_COMPRA' | 'TRANSFERENCIA' | 'PRODUCTO_EDIT';
  referenciaId?: number | null;
  referenciaDetalle?: string | null;
  usuarioId?: number | null;
  observaciones?: string | null;
}

/**
 * Logs a stock change into STOCK_HISTORIAL.
 * Receives a transaction (tx) so it participates in the same transaction.
 * Silently fails if the table doesn't exist yet (graceful degradation).
 */
export async function registrarHistorialStock(
  tx: any,
  params: HistorialStockParams
): Promise<void> {
  try {
    const diferencia = params.cantidadNueva - params.cantidadAnterior;
    await tx.request()
      .input('prodId', sql.Int, params.productoId)
      .input('depId', sql.Int, params.depositoId)
      .input('cantAnt', sql.Decimal(18, 4), params.cantidadAnterior)
      .input('cantNueva', sql.Decimal(18, 4), params.cantidadNueva)
      .input('dif', sql.Decimal(18, 4), diferencia)
      .input('tipo', sql.VarChar(30), params.tipoOperacion)
      .input('refId', sql.Int, params.referenciaId ?? null)
      .input('detalle', sql.VarChar(200), params.referenciaDetalle ?? null)
      .input('userId', sql.Int, params.usuarioId ?? null)
      .input('obs', sql.VarChar(500), params.observaciones ?? null)
      .query(`
        INSERT INTO STOCK_HISTORIAL
          (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD_ANTERIOR, CANTIDAD_NUEVA, DIFERENCIA,
           TIPO_OPERACION, REFERENCIA_ID, REFERENCIA_DETALLE, USUARIO_ID, OBSERVACIONES)
        VALUES
          (@prodId, @depId, @cantAnt, @cantNueva, @dif, @tipo, @refId, @detalle, @userId, @obs)
      `);
  } catch {
    // Table might not exist yet — don't break the main operation
  }
}

/**
 * Helper to get current stock for a product in a deposit.
 * Returns 0 if no record found.
 */
export async function getCurrentStock(tx: any, productoId: number, depositoId: number): Promise<number> {
  const result = await tx.request()
    .input('prodId', sql.Int, productoId)
    .input('depId', sql.Int, depositoId)
    .query(`SELECT CANTIDAD FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
  return result.recordset.length > 0 ? result.recordset[0].CANTIDAD : 0;
}
