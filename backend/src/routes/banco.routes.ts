import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { bancoService } from '../services/banco.service.js';

const router = Router();
router.use(authMiddleware);

// GET /api/bancos
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await bancoService.getAll({
      search: req.query.search as string | undefined,
      activo: req.query.activo !== undefined ? req.query.activo === 'true' : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bancos/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const banco = await bancoService.getById(parseInt(req.params.id as string));
    res.json(banco);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/bancos
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await bancoService.create(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/bancos/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await bancoService.update(parseInt(req.params.id as string), req.body);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/bancos/:id (soft-delete: ACTIVO=0)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await bancoService.delete(parseInt(req.params.id as string));
    res.json({ ok: true, mode: 'soft' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
