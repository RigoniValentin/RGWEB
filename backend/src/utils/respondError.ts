import { Response } from 'express';

/**
 * Helper para responder errores en endpoints REST de forma consistente.
 * Si el `err` trae `code` y/o `detalles`, los propaga para que el frontend
 * pueda traducirlos a mensajes amigables.
 *
 * Uso en rutas:
 *   try { ... } catch (err) { return respondError(res, err); }
 */
export function respondError(res: Response, err: any, fallbackStatus = 500): Response {
  const status = err?.status || (err?.name === 'ValidationError' ? 400 : fallbackStatus);
  const body: Record<string, any> = {
    error: status === 500 && process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : (err?.message || 'Error'),
  };
  if (err?.code) body.code = err.code;
  if (err?.detalles) body.detalles = err.detalles;
  return res.status(status).json(body);
}
