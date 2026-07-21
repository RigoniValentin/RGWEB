import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { integracionesService } from '../services/integraciones.service.js';

// ═══════════════════════════════════════════════════
//  Mobile Auth Middleware
//
//  Acepta DOS modos de autenticación:
//
//    1) Authorization: Bearer <api_key>  (registrado vía QR)
//       → resuelve a un device en INTEGRACIONES_MOBILE_DEVICES
//       → setea req.mobile = { apiKeyId, deviceId, deviceName, deviceUuid }
//       → actualiza last_seen_at best-effort
//
//    2) Authorization: Bearer <jwt>      (login user/pass existente)
//       → resuelve vía authService vía JWT
//       → setea req.user = { id, nombre }
//
//  Se prioriza API key si el token empieza con "rg_".
// ═══════════════════════════════════════════════════

export interface MobileAuthRequest extends Request {
  user?: {
    id: number;
    nombre: string;
    _permisos?: string[];
  };
  mobile?: {
    apiKeyId: number;
    deviceId: number;
    deviceName: string;
    deviceUuid: string;
  };
  _authMethod?: 'api_key' | 'jwt';
}

export async function mobileAuthMiddleware(
  req: MobileAuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token requerido (Authorization: Bearer ...)' });
    return;
  }
  const token = authHeader.split(' ')[1];

  // ── 1) API key (device registrado vía QR) ────────────────
  if (token.startsWith('rg_')) {
    try {
      const apiKeyId = await integracionesService.verifyApiKey(token);
      if (apiKeyId) {
        const device = await integracionesService.getDeviceByApiKeyId(apiKeyId);
        if (!device || device.REVOKED_AT || !device.KEY_ACTIVA || device.KEY_REVOKED_AT) {
          res.status(401).json({ error: 'API key del device revocada' });
          return;
        }
        req.mobile = {
          apiKeyId,
          deviceId: device.DEVICE_ID,
          deviceName: device.DEVICE_NAME,
          deviceUuid: device.DEVICE_UUID,
        };
        req.user = { id: 0, nombre: device.DEVICE_NAME };
        req._authMethod = 'api_key';
        // best-effort: no bloqueamos si falla
        integracionesService
          .recordDeviceSeen(apiKeyId, req.ip ?? null)
          .catch(() => undefined);
        next();
        return;
      }
      res.status(401).json({ error: 'API key inválida o revocada' });
      return;
    } catch (err) {
      console.error('[mobileAuth] api-key error:', (err as Error).message);
      res.status(500).json({ error: 'Error verificando credenciales' });
      return;
    }
  }

  // ── 2) JWT (login user/pass) ──────────────────────────────
  try {
    const decoded = jwt.verify(token, config.jwt.secret) as {
      id: number;
      nombre: string;
    };
    req.user = decoded;
    req._authMethod = 'jwt';
    next();
  } catch {
    res.status(401).json({ error: 'Token JWT inválido o expirado' });
  }
}
