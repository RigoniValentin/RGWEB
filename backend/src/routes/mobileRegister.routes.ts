import { Router, Response, Request } from 'express';
import { integracionesService } from '../services/integraciones.service.js';

// ═══════════════════════════════════════════════════
//  Endpoint público para que un celular se registre
//  contra un QR (sin necesidad de JWT).
//
//  Auth: header `X-Registration-Token: rg_...`
//  Body: { deviceName: string, deviceUuid: string }
//
//  Devuelve: { deviceId, apiKey, expiresAt }
//
//  Side-effects:
//    - Crea INTEGRACIONES_MOBILE_DEVICES row
//    - Crea nueva API key scope 'mobile' para el device
//    - Revoca el registration token (one-time use)
// ═══════════════════════════════════════════════════

const router = Router();

router.post('/register-device', async (req: Request, res: Response) => {
  const regToken = req.header('x-registration-token');
  const { deviceName, deviceUuid } = req.body ?? {};

  if (!regToken) {
    res.status(401).json({ error: 'Header X-Registration-Token requerido' });
    return;
  }

  try {
    const result = await integracionesService.registerMobileDevice({
      registrationToken: regToken,
      deviceName: typeof deviceName === 'string' ? deviceName : '',
      deviceUuid: typeof deviceUuid === 'string' ? deviceUuid : '',
      ip: req.ip ?? null,
    });
    res.status(201).json({
      deviceId: result.deviceId,
      apiKey: result.apiKey.RAW_KEY,
      keyPrefix: result.apiKey.KEY_PREFIX,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (err: any) {
    const status = err?.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err?.message ?? 'Error al registrar el device' });
  }
});

export default router;
