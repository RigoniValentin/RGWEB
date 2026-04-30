import { Router, Request, Response } from 'express';
import { puntoVentaService } from '../services/puntoVenta.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/puntos-venta — paginated list
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await puntoVentaService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      search: req.query.search as string | undefined,
      soloActivos: req.query.soloActivos === 'true',
      orderBy: req.query.orderBy as string | undefined,
      orderDir: (req.query.orderDir as 'ASC' | 'DESC') || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/puntos-venta/selector — light list for combos
router.get('/selector', async (_req: Request, res: Response) => {
  try {
    const data = await puntoVentaService.getSelector();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/puntos-venta/:id — detail with assignments
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const data = await puntoVentaService.getById(parseInt(req.params.id as string));
    res.json(data);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/puntos-venta
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await puntoVentaService.create(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/puntos-venta/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await puntoVentaService.update(parseInt(req.params.id as string), req.body);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/puntos-venta/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await puntoVentaService.delete(parseInt(req.params.id as string));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
