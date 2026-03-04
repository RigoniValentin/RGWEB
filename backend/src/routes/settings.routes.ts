import { Router, Response } from 'express';
import { settingsService } from '../services/settings.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// All settings routes require authentication
router.use(authMiddleware);

// ── GET /api/settings — Get all resolved settings for the logged-in user ──
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const settings = await settingsService.getForUser(req.user!.id);
    res.json(settings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/settings/parametros — Get parameter definitions (for admin) ──
router.get('/parametros', async (_req: AuthRequest, res: Response) => {
  try {
    const params = await settingsService.getParametros();
    res.json(params);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/settings/value/:clave — Get a single resolved value ──────────
router.get('/value/:clave', async (req: AuthRequest, res: Response) => {
  try {
    const value = await settingsService.getValue(req.user!.id, req.params.clave as string);
    res.json({ clave: req.params.clave, valor: value });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/settings/user — Save user-level settings (batch) ─────────────
router.put('/user', async (req: AuthRequest, res: Response) => {
  try {
    const { settings } = req.body;
    if (!Array.isArray(settings)) {
      res.status(400).json({ error: 'Se requiere un array de settings' });
      return;
    }
    await settingsService.saveForUser(req.user!.id, settings);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/settings/global — Save global settings (admin only) ──────────
router.put('/global', async (req: AuthRequest, res: Response) => {
  try {
    const { settings } = req.body;
    if (!Array.isArray(settings)) {
      res.status(400).json({ error: 'Se requiere un array de settings' });
      return;
    }
    await settingsService.saveGlobal(settings);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/settings/user/:parametroId — Reset one user setting ───────
router.delete('/user/:parametroId', async (req: AuthRequest, res: Response) => {
  try {
    await settingsService.resetForUser(req.user!.id, Number(req.params.parametroId));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/settings/user — Reset ALL user settings ───────────────────
router.delete('/user', async (req: AuthRequest, res: Response) => {
  try {
    await settingsService.resetAllForUser(req.user!.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
