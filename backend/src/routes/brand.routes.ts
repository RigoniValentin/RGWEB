import { Router, Request, Response } from 'express';
import { brandService } from '../services/brand.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/brands
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await brandService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      search: req.query.search as string | undefined,
      activa: req.query.activa !== undefined ? req.query.activa === 'true' : undefined,
      orderBy: req.query.orderBy as string | undefined,
      orderDir: (req.query.orderDir as 'ASC' | 'DESC') || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brands/next-code
router.get('/next-code', async (_req: Request, res: Response) => {
  try {
    const code = await brandService.getNextCode();
    res.json({ code });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brands/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const brand = await brandService.getById(parseInt(req.params.id as string));
    res.json(brand);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/brands
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await brandService.create(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/brands/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await brandService.update(parseInt(req.params.id as string), req.body);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/brands/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await brandService.delete(parseInt(req.params.id as string));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
