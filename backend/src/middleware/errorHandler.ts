import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('❌ Error:', err.message);

  if (err.name === 'ValidationError') {
    res.status(400).json({ error: err.message });
    return;
  }

  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Error interno del servidor'
      : err.message,
  });
}
