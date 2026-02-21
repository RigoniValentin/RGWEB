import { Router, Request, Response } from 'express';
import { salesService } from '../services/sales.service.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/sales
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await salesService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      search: req.query.search as string | undefined,
      fechaDesde: req.query.fechaDesde as string | undefined,
      fechaHasta: req.query.fechaHasta as string | undefined,
      clienteId: req.query.clienteId ? parseInt(req.query.clienteId as string) : undefined,
      puntoVentaId: req.query.puntoVentaId ? parseInt(req.query.puntoVentaId as string) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const sale = await salesService.getById(parseInt(req.params.id as string));
    res.json(sale);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
