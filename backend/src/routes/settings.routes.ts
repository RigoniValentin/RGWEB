import { Router, Response } from 'express';
import express from 'express';
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
    const { modulo } = req.query;
    if (typeof modulo === 'string' && modulo) {
      await settingsService.resetModuleForUser(req.user!.id, modulo);
    } else {
      await settingsService.resetAllForUser(req.user!.id);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/settings/logo — Get company logo ───────────────────────────
router.get('/logo', async (_req: AuthRequest, res: Response) => {
  try {
    const logo = await settingsService.getLogo();
    if (!logo) {
      res.status(404).json({ error: 'Logo no encontrado' });
      return;
    }
    res.set('Content-Type', logo.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(logo.data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/settings/logo — Upload company logo ────────────────────────
const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

router.put('/logo',
  express.raw({ type: ALLOWED_TYPES, limit: MAX_LOGO_SIZE }),
  async (req: AuthRequest, res: Response) => {
    try {
      const contentType = req.headers['content-type'] || '';
      if (!ALLOWED_TYPES.some(t => contentType.startsWith(t))) {
        res.status(400).json({ error: 'Formato no soportado. Use PNG, JPG, GIF o WebP.' });
        return;
      }
      const buffer = req.body as Buffer;
      if (!buffer || buffer.length === 0) {
        res.status(400).json({ error: 'No se recibió ninguna imagen' });
        return;
      }
      if (buffer.length > MAX_LOGO_SIZE) {
        res.status(400).json({ error: 'La imagen supera el límite de 2 MB' });
        return;
      }
      await settingsService.saveLogo(buffer, contentType.split(';')[0]);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── DELETE /api/settings/logo — Remove company logo ─────────────────────
router.delete('/logo', async (_req: AuthRequest, res: Response) => {
  try {
    await settingsService.deleteLogo();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
