import { Router, Request, Response } from 'express';
import { categoryService } from '../services/category.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/categories
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await categoryService.getAll({
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

// GET /api/categories/next-code
router.get('/next-code', async (_req: Request, res: Response) => {
  try {
    const code = await categoryService.getNextCode();
    res.json({ code });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/categories/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const category = await categoryService.getById(parseInt(req.params.id as string));
    res.json(category);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/categories
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await categoryService.create(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/categories/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await categoryService.update(parseInt(req.params.id as string), req.body);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/categories/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await categoryService.delete(parseInt(req.params.id as string));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
