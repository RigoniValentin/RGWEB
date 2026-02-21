import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    nombre: string;
  };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token no proporcionado' });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as {
      id: number;
      nombre: string;
    };
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
