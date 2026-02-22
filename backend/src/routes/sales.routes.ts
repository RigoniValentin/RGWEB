import { Router, Request, Response } from 'express';
import { salesService } from '../services/sales.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

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
      cobrada: req.query.cobrada !== undefined ? req.query.cobrada === 'true' : undefined,
      usuarioId: req.query.usuarioId ? parseInt(req.query.usuarioId as string) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/clientes  (before :id to avoid conflict)
router.get('/clientes', async (_req: Request, res: Response) => {
  try {
    const data = await salesService.getClientes();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/depositos
router.get('/depositos', async (_req: Request, res: Response) => {
  try {
    const data = await salesService.getDepositos();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/search-products
router.get('/search-products', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;
    if (!search || search.length < 1) {
      res.json([]);
      return;
    }
    const listaId = parseInt(req.query.listaId as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const data = await salesService.searchProducts(search, listaId, limit);
    res.json(data);
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

// POST /api/sales
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    const result = await salesService.create(req.body, usuarioId);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/sales/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const result = await salesService.update(parseInt(req.params.id), req.body);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/sales/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await salesService.delete(parseInt(req.params.id));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/sales/:id/pay
router.post('/:id/pay', async (req: Request, res: Response) => {
  try {
    const result = await salesService.markAsPaid(parseInt(req.params.id), req.body);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/sales/:id/unpay
router.post('/:id/unpay', async (req: Request, res: Response) => {
  try {
    const result = await salesService.removePaid(parseInt(req.params.id));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
