import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { getPool } from '../database/connection.js';
import sql from 'mssql';

export interface AuthRequest extends Request {
  user?: {
    id: number;
    nombre: string;
    _permisos?: string[]; // lazy-loaded effective permissions cache
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

/**
 * Loads and caches the effective permissions for the authenticated user.
 * Returns the array of LLAVE strings, or null when the view doesn't exist yet.
 */
export async function loadUserPermisos(req: AuthRequest): Promise<string[] | null> {
  if (req.user!._permisos) return req.user!._permisos;
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input('uid', sql.Int, req.user!.id)
      .query('SELECT LLAVE FROM VW_PERMISOS_EFECTIVOS WHERE USUARIO_ID = @uid');
    req.user!._permisos = result.recordset.map((r: any) => r.LLAVE as string);
    return req.user!._permisos;
  } catch {
    // View doesn't exist yet (pre-migration)
    return null;
  }
}

/**
 * Middleware factory: verifies the authenticated user has ALL of the supplied
 * permission keys (checked against VW_PERMISOS_EFECTIVOS).
 *
 * Usage:
 *   router.post('/abrir', requirePermiso('caja.abrir'), handler);
 *   router.post('/transfer', requirePermiso('caja.egreso', 'caja.ingreso'), handler);
 *
 * Falls back gracefully when the permissions tables don't exist yet (allows
 * access) so the system keeps working before the migration is applied.
 */
export function requirePermiso(...llaves: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'No autenticado' });
      return;
    }

    try {
      const permisos = await loadUserPermisos(req);
      if (permisos === null) {
        // View doesn't exist yet (pre-migration) → skip permission check
        next();
        return;
      }

      const missing = llaves.filter(l => !permisos.includes(l));
      if (missing.length > 0) {
        res.status(403).json({
          error: 'Sin permisos suficientes',
          required: llaves,
          missing,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
