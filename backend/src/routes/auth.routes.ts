import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

function getRequestContext(req: Request) {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.socket?.remoteAddress,
    userAgent: req.headers['user-agent'] ?? undefined,
  };
}

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
      return;
    }
    const { ip, userAgent } = getRequestContext(req);
    const result    = await authService.login({ username, password, ip, userAgent });
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'LicenseError' ? 403 : err.name === 'LockoutError' ? 423 : err.name === 'ValidationError' ? 401 : 500;
    res.status(status).json({ error: err.message, code: err.code, license: err.license });
  }
});

// POST /api/auth/license/request-code
router.post('/license/request-code', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
      return;
    }
    const { ip, userAgent } = getRequestContext(req);
    const result = await authService.requestLicenseActivationCode({ username, password, ip, userAgent });
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'CooldownError' ? 429 : err.name === 'LockoutError' ? 423 : err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message, retryAfterSeconds: err.retryAfterSeconds });
  }
});

// POST /api/auth/license/activate
router.post('/license/activate', async (req: Request, res: Response) => {
  try {
    const { activationId, code } = req.body;
    if (!activationId || !code) {
      res.status(400).json({ error: 'Codigo de activacion requerido' });
      return;
    }
    const { ip, userAgent } = getRequestContext(req);
    const result = await authService.activateLicense({ activationId, code }, ip, userAgent);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { ip } = getRequestContext(req);
    await authService.logout(req.user!.id, ip);
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

// GET /api/auth/profile
router.get('/profile', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = await authService.getProfile(req.user!.id);
    res.json(user);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/auth/users  (list all for admin)
router.get('/users', authMiddleware, async (_req: Request, res: Response) => {
  try {
    const users = await authService.getAll();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

