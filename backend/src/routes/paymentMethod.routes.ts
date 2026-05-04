import { Router, Request, Response } from 'express';
import { paymentMethodService } from '../services/paymentMethod.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/payment-methods
router.get('/', async (req: Request, res: Response) => {
  try {
    const catRaw = req.query.categoria as string | undefined;
    const categoria = catRaw?.toUpperCase();

    const result = await paymentMethodService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 50,
      search: req.query.search as string | undefined,
      categoria: (categoria === 'DIGITAL' || categoria === 'EFECTIVO' || categoria === 'CHEQUES') ? categoria : undefined,
      activa: req.query.activa !== undefined ? req.query.activa === 'true' : undefined,
      orderBy: req.query.orderBy as string | undefined,
      orderDir: (req.query.orderDir as 'ASC' | 'DESC') || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/payment-methods/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const item = await paymentMethodService.getById(parseInt(req.params.id as string));
    res.json(item);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/payment-methods
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await paymentMethodService.create(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/payment-methods/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await paymentMethodService.update(parseInt(req.params.id as string), req.body);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/payment-methods/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await paymentMethodService.delete(parseInt(req.params.id as string));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
