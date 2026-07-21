import { Router, Response } from 'express';
import { authMiddleware, requirePermiso, AuthRequest } from '../middleware/auth.js';
import { tunnelManager } from '../services/tunnelManager.service.js';
import { integracionesService } from '../services/integraciones.service.js';
import { config } from '../config/index.js';

// ═══════════════════════════════════════════════════
//  Rutas de gestión del Cloudflare Tunnel para RG MOBILE.
//
//  Prefijo: /api/integraciones/tunnel
//
//  Permisos:
//    - integraciones.ver           para lecturas (status, logs, qr, check)
//    - integraciones.administrar   para start/stop
// ═══════════════════════════════════════════════════

const router = Router();
router.use(authMiddleware);

// ── GET /status ─────────────────────────────────────
router.get('/status', requirePermiso('integraciones.ver'), (_req: AuthRequest, res: Response) => {
  res.json(tunnelManager.getInfo());
});

// ── POST /start ─────────────────────────────────────
router.post('/start', requirePermiso('integraciones.administrar'), async (_req: AuthRequest, res: Response) => {
  try {
    const info = await tunnelManager.start();
    res.json(info);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? 'Error al iniciar el túnel' });
  }
});

// ── POST /stop ──────────────────────────────────────
router.post('/stop', requirePermiso('integraciones.administrar'), async (_req: AuthRequest, res: Response) => {
  try {
    await tunnelManager.stop();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Error al detener el túnel' });
  }
});

// ── GET /logs?tail=N ────────────────────────────────
router.get('/logs', requirePermiso('integraciones.ver'), (req: AuthRequest, res: Response) => {
  const tail = parseInt((req.query.tail as string) || '50', 10);
  res.json({ lines: tunnelManager.getLogs(tail) });
});

// ── GET /check ──────────────────────────────────────
router.get('/check', requirePermiso('integraciones.ver'), async (_req: AuthRequest, res: Response) => {
  const result = await tunnelManager.checkReachability();
  res.json(result);
});

// ── GET /qr-payload ─────────────────────────────────
//   Devuelve el JSON listo para meter en el QR.
//   Genera un registration token (one-time). Cada device que escanee
//   el QR lo canjea por su propia API key vía /api/mobile/register-device.
router.get('/qr-payload', requirePermiso('integraciones.ver'), async (req: AuthRequest, res: Response) => {
  try {
    const info = tunnelManager.getInfo();
    if (info.status !== 'running' || !info.publicUrl) {
      res.status(400).json({ error: 'El túnel no está activo. Iniciá el túnel antes de generar el QR.' });
      return;
    }

    const { apiKey, expiresAt } = await integracionesService.createRegistrationToken(
      req.user?.id ?? null,
    );

    const issuedAt = new Date().toISOString();
    const payload = {
      v: 2,
      type: 'rg-tunnel',
      name: config.app.nombreFantasia || config.app.nombreCliente || 'Río Gestión',
      url: info.publicUrl,
      issuedAt,
      expiresAt: expiresAt.toISOString(),
      regToken: apiKey.RAW_KEY,
    };
    res.json(payload);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Error al generar el payload del QR' });
  }
});

// ── POST /rotate-token ──────────────────────────────
//   Invalida TODOS los registration tokens vigentes (los QRs viejos dejan de
//   poder registrar devices). Los devices ya registrados NO se ven afectados.
//   Útil cuando querés "cerrar la inscripción" sin tocar a los ya conectados.
router.post('/rotate-token', requirePermiso('integraciones.administrar'), async (_req: AuthRequest, res: Response) => {
  try {
    const revoked = await integracionesService.revokeMobileKeysExcept(null);
    res.json({
      ok: true,
      revokedCount: revoked,
      message: `${revoked} registration token(s) revocados. Devices ya registrados NO se ven afectados.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Error al rotar tokens' });
  }
});

// ── GET /devices ────────────────────────────────────
//   Lista todos los devices mobile registrados (activos + revocados).
router.get('/devices', requirePermiso('integraciones.ver'), async (_req: AuthRequest, res: Response) => {
  try {
    const devices = await integracionesService.listMobileDevices();
    res.json(devices);
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Error al listar devices' });
  }
});

// ── POST /devices/:id/revoke ────────────────────────
router.post('/devices/:id/revoke', requirePermiso('integraciones.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    await integracionesService.revokeMobileDevice(id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Error al revocar device' });
  }
});

// ── POST /devices/:id/unlink ────────────────────────
//   Quita la asociación device ↔ API key sin eliminar el device row.
//   La API key queda revocada pero el row del device se conserva
//   con API_KEY_ID = NULL para mantener el historial.
router.post('/devices/:id/unlink', requirePermiso('integraciones.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    await integracionesService.unlinkMobileDevice(id);
    res.json({ ok: true, message: 'Device desvinculado. Su API key fue revocada y el row queda en historial.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Error al desvincular device' });
  }
});

// ── DELETE /devices/:id ─────────────────────────────
//   Elimina físicamente el row de un device (limpieza de huérfanos).
router.delete('/devices/:id', requirePermiso('integraciones.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    await integracionesService.deleteMobileDevice(id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Error al eliminar device' });
  }
});

// ── GET /keys/:id/devices ───────────────────────────
//   Devuelve la cantidad de devices vinculados a una API key.
//   Usado por la UI antes de borrar una key para advertir.
router.get('/keys/:id/devices', requirePermiso('integraciones.ver'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    const count = await integracionesService.countActiveDevicesForKey(id);
    res.json({ count });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Error al contar devices' });
  }
});

export default router;
