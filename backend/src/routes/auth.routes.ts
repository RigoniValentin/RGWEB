import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
      return;
    }
    const result = await authService.login({ username, password });
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
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
