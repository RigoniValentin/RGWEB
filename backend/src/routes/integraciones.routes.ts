import { Router, Response } from 'express';
import { authMiddleware, requirePermiso, AuthRequest } from '../middleware/auth.js';
import { integracionesService } from '../services/integraciones.service.js';
import { webhookDispatcher } from '../services/webhook.dispatcher.js';

// ═══════════════════════════════════════════════════
//  Rutas administrativas del módulo Integraciones.
//  Prefijo: /api/integraciones
//
//  Autenticación: JWT del panel + permiso
//    - integraciones.ver           (lectura)
//    - integraciones.administrar   (escritura)
// ═══════════════════════════════════════════════════

const router = Router();
router.use(authMiddleware);

// ── API Keys ─────────────────────────────────────────────
router.get('/api-keys', requirePermiso('integraciones.ver'), async (_req: AuthRequest, res: Response) => {
  try {
    const data = await integracionesService.listApiKeys();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api-keys', requirePermiso('integraciones.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const { nombre, scopes, notas } = req.body ?? {};
    const created = await integracionesService.createApiKey(
      String(nombre || '').trim(),
      scopes ? String(scopes) : null,
      notas ? String(notas) : null,
      req.user?.id ?? null,
    );
    res.status(201).json(created);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

router.post('/api-keys/:id/revoke', requirePermiso('integraciones.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    await integracionesService.revokeApiKey(id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/api-keys/:id', requirePermiso('integraciones.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    await integracionesService.deleteApiKey(id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Configuración (webhook) ──────────────────────────────
router.get('/config', requirePermiso('integraciones.ver'), async (_req: AuthRequest, res: Response) => {
  try {
    const config = await integracionesService.getConfig();
    // Nunca devolvemos el secret completo al frontend (sólo "configurado o no")
    res.json({
      ...config,
      webhook_secret_set: !!config.webhook_secret,
      webhook_secret: undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config', requirePermiso('integraciones.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const updated = await integracionesService.setConfig(req.body ?? {}, req.user?.id ?? null);
    res.json({
      ...updated,
      webhook_secret_set: !!updated.webhook_secret,
      webhook_secret: undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhook/test', requirePermiso('integraciones.administrar'), async (_req: AuthRequest, res: Response) => {
  try {
    const result = await webhookDispatcher.testWebhook();
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/webhook/push-stock', requirePermiso('integraciones.administrar'), async (_req: AuthRequest, res: Response) => {
  try {
    const result = await webhookDispatcher.pushFullStock();
    res.status(result.ok ? 200 : 502).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Logs de sincronización ───────────────────────────────
router.get('/logs', requirePermiso('integraciones.ver'), async (req: AuthRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 10;
    const data = await integracionesService.listLogs(limit);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
