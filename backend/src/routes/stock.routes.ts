import { Router, Request, Response } from 'express';
import { stockService } from '../services/stock.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/stock — list products with stock per deposit
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await stockService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 25,
      search: req.query.search as string | undefined,
      depositoId: req.query.depositoId ? parseInt(req.query.depositoId as string) : undefined,
      soloConStock: req.query.soloConStock === 'true',
      soloBajoMinimo: req.query.soloBajoMinimo === 'true',
      orderBy: req.query.orderBy as string | undefined,
      orderDir: (req.query.orderDir as 'ASC' | 'DESC') || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stock/depositos — list deposits
router.get('/depositos', async (_req: Request, res: Response) => {
  try {
    const data = await stockService.getDepositos();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stock/:productoId — stock detail for a product
router.get('/:productoId', async (req: Request, res: Response) => {
  try {
    const data = await stockService.getProductStock(parseInt(req.params.productoId as string));
    res.json(data);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/stock/:productoId/history — stock change history
router.get('/:productoId/history', async (req: Request, res: Response) => {
  try {
    const data = await stockService.getHistory({
      productoId: parseInt(req.params.productoId as string),
      depositoId: req.query.depositoId ? parseInt(req.query.depositoId as string) : undefined,
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/stock/update — update stock for a product in a deposit
router.put('/update', async (req: AuthRequest, res: Response) => {
  try {
    const result = await stockService.updateStock(req.body, req.user?.id);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
