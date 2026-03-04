import { Router, Request, Response } from 'express';
import { ncComprasService } from '../services/ncCompras.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/nc-compras  — List all NCs with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await ncComprasService.getAll({
      proveedorId: req.query.proveedorId ? parseInt(req.query.proveedorId as string) : undefined,
      fechaDesde: req.query.fechaDesde as string | undefined,
      fechaHasta: req.query.fechaHasta as string | undefined,
      motivo: req.query.motivo as string | undefined,
      anulada: req.query.anulada !== undefined ? req.query.anulada === 'true' : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nc-compras/compras-para-nc/:proveedorId  — Purchases available for NC
router.get('/compras-para-nc/:proveedorId', async (req: Request, res: Response) => {
  try {
    const proveedorId = parseInt(req.params.proveedorId as string);
    const result = await ncComprasService.getComprasParaNC(
      proveedorId,
      req.query.fechaDesde as string | undefined,
      req.query.fechaHasta as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nc-compras/items-compra/:compraId  — Items from a purchase for devolution grid
router.get('/items-compra/:compraId', async (req: Request, res: Response) => {
  try {
    const compraId = parseInt(req.params.compraId as string);
    const result = await ncComprasService.getItemsCompra(compraId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nc-compras/existe/:compraId  — Check if NCs exist for a purchase
router.get('/existe/:compraId', async (req: Request, res: Response) => {
  try {
    const compraId = parseInt(req.params.compraId as string);
    const result = await ncComprasService.existeNCParaCompra(compraId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nc-compras/:id  — Get NC detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const result = await ncComprasService.getById(id);
    res.json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nc-compras  — Create NC
router.post('/', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const usuarioId = authReq.user!.id;
    const result = await ncComprasService.create(req.body, usuarioId);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error creating NC Compra:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/nc-compras/:id/anular  — Void an NC (generates ND)
router.put('/:id/anular', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const usuarioId = authReq.user!.id;
    const id = parseInt(req.params.id as string);
    const result = await ncComprasService.anular(id, usuarioId);
    res.json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error anulando NC Compra:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
