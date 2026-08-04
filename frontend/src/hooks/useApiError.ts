import { extractErrorMessage } from '../utils/notify';

/**
 * Códigos de error emitidos por el backend, compartidos con el frontend.
 * Estos códigos viven en objetos `Error.code` que los helpers de validación
 * (`stockValidator.helper.ts`) agregan al hacer throw.
 */
export type BackendErrorCode =
  | 'STOCK_INSUFICIENTE'
  | 'PRODUCTO_NO_ENCONTRADO'
  | 'VALIDATION_ERROR'
  | string;

export interface BackendErrorShape {
  response?: {
    data?: {
      error?: string;
      message?: string;
      code?: BackendErrorCode;
      detalles?: any;
    };
  };
  message?: string;
  code?: BackendErrorCode;
}

/**
 * Devuelve el código de error del backend si lo encuentra, sino null.
 */
export function getBackendErrorCode(err: unknown): BackendErrorCode | null {
  if (err == null) return null;
  if (typeof err !== 'object') return null;
  const e = err as BackendErrorShape;
  return e.response?.data?.code || e.code || null;
}

/**
 * Devuelve el campo `detalles` que el backend incluye en errores
 * de stock (PRODUCTO_ID, STOCK_ACTUAL, CANTIDAD_REQUERIDA, etc.).
 */
export function getBackendErrorDetalles(err: unknown): any | null {
  if (err == null) return null;
  if (typeof err !== 'object') return null;
  const e = err as BackendErrorShape;
  return e.response?.data?.detalles ?? null;
}

/**
 * Devuelve un mensaje amigable para el usuario según el código de error.
 * Si no hay código conocido, devuelve el mensaje que vino del backend
 * (o el fallback).
 */
export function translateApiError(err: unknown, fallback = 'Ocurrió un error'): string {
  const code = getBackendErrorCode(err);
  if (code === 'STOCK_INSUFICIENTE') {
    const d = getBackendErrorDetalles(err);
    if (d) {
      const parts: string[] = [];
      if (d.PRODUCTO_NOMBRE) parts.push(`"${d.PRODUCTO_NOMBRE}"`);
      if (d.STOCK_ACTUAL != null) parts.push(`Disponible: ${d.STOCK_ACTUAL}`);
      if (d.CANTIDAD_REQUERIDA != null) parts.push(`Requerido: ${d.CANTIDAD_REQUERIDA}`);
      if (parts.length > 0) return `Stock insuficiente. ${parts.join(', ')}.`;
    }
    return 'Stock insuficiente para realizar la operación.';
  }
  return extractErrorMessage(err, fallback);
}
