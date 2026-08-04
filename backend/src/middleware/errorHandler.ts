import { Request, Response, NextFunction } from 'express';

interface ErrorWithCode extends Error {
  code?: string;
  status?: number;
  detalles?: any;
}

export function errorHandler(err: ErrorWithCode, _req: Request, res: Response, _next: NextFunction): void {
  console.error('❌ Error:', err.message);

  const status = err.status || (err.name === 'ValidationError' ? 400 : 500);

  const body: Record<string, any> = {
    error: status === 500 && process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message,
  };

  if (err.code) body.code = err.code;
  if (err.detalles) body.detalles = err.detalles;

  res.status(status).json(body);
}
