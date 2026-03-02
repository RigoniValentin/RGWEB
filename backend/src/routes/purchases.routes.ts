import { Router, Request, Response } from 'express';
import { purchasesService } from '../services/purchases.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/purchases
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await purchasesService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      search: req.query.search as string | undefined,
      fechaDesde: req.query.fechaDesde as string | undefined,
      fechaHasta: req.query.fechaHasta as string | undefined,
      proveedorId: req.query.proveedorId ? parseInt(req.query.proveedorId as string) : undefined,
      cobrada: req.query.cobrada !== undefined ? req.query.cobrada === 'true' : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/proveedores  (before :id to avoid conflict)
router.get('/proveedores', async (_req: Request, res: Response) => {
  try {
    const data = await purchasesService.getProveedores();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/depositos
router.get('/depositos', async (_req: Request, res: Response) => {
  try {
    const data = await purchasesService.getDepositos();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/saldo-cta-cte/:proveedorId
router.get('/saldo-cta-cte/:proveedorId', async (req: Request, res: Response) => {
  try {
    const proveedorId = parseInt(req.params.proveedorId as string);
    const data = await purchasesService.getSaldoCtaCteP(proveedorId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/search-products
router.get('/search-products', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;
    if (!search || search.length < 1) {
      res.json([]);
      return;
    }
    const limit = parseInt(req.query.limit as string) || 20;
    const data = await purchasesService.searchProducts(search, limit);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const purchase = await purchasesService.getById(parseInt(req.params.id as string));
    res.json(purchase);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/purchases
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    const result = await purchasesService.create(req.body, usuarioId);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/purchases/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    const result = await purchasesService.update(parseInt(req.params.id as string), req.body, usuarioId);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/purchases/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    const result = await purchasesService.delete(parseInt(req.params.id as string), usuarioId);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
