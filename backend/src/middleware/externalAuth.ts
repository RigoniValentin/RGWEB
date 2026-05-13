import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { integracionesService } from '../services/integraciones.service.js';

// ═══════════════════════════════════════════════════
//  External Auth Middleware
//
//  Acepta DOS modos de autenticación:
//    1) Header  x-api-key: <raw_key>        (tienda online / VPS)
//    2) Header  Authorization: Bearer <jwt> (app móvil)
//
//  Adjunta el método utilizado a req.external para que
//  los handlers puedan auditar o reaccionar diferente.
// ═══════════════════════════════════════════════════

export interface ExternalRequest extends Request {
  external?: {
    method: 'api_key' | 'jwt';
    apiKeyId?: number;
    userId?: number;
    userName?: string;
  };
}

export async function externalAuthMiddleware(
  req: ExternalRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // ── 1) API Key (preferida para integraciones server-to-server) ──
  const rawKey = req.header('x-api-key');
  if (rawKey) {
    try {
      const apiKeyId = await integracionesService.verifyApiKey(rawKey);
      if (!apiKeyId) {
        res.status(401).json({ error: 'API key inválida o revocada' });
        return;
      }
      req.external = { method: 'api_key', apiKeyId };
      next();
      return;
    } catch (err) {
      console.error('[externalAuth] api-key error:', (err as Error).message);
      res.status(500).json({ error: 'Error verificando credenciales' });
      return;
    }
  }

  // ── 2) JWT (app móvil) ────────────────────────────────────────
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, config.jwt.secret) as { id: number; nombre: string };
      req.external = { method: 'jwt', userId: decoded.id, userName: decoded.nombre };
      next();
      return;
    } catch {
      res.status(401).json({ error: 'Token JWT inválido o expirado' });
      return;
    }
  }

  res.status(401).json({ error: 'Credenciales requeridas (x-api-key o Bearer token)' });
}
