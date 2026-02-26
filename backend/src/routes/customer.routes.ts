import { Router, Request, Response } from 'express';
import { customerService } from '../services/customer.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/customers
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await customerService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      search: req.query.search as string | undefined,
      activo: req.query.activo !== undefined ? req.query.activo === 'true' : undefined,
      orderBy: req.query.orderBy as string | undefined,
      orderDir: (req.query.orderDir as 'ASC' | 'DESC') || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers/next-code
router.get('/next-code', async (_req: Request, res: Response) => {
  try {
    const code = await customerService.getNextCode();
    res.json({ code });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const customer = await customerService.getById(parseInt(req.params.id as string));
    res.json(customer);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/customers/:id/cta-corriente
router.get('/:id/cta-corriente', async (req: Request, res: Response) => {
  try {
    const saldo = await customerService.getCtaCorrienteSaldo(parseInt(req.params.id as string));
    res.json(saldo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/customers
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await customerService.create(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/customers/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await customerService.update(parseInt(req.params.id as string), req.body);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/customers/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await customerService.delete(parseInt(req.params.id as string));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
