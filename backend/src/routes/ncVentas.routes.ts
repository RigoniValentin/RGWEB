import { Router, Request, Response } from 'express';
import { ncVentasService } from '../services/ncVentas.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/nc-ventas  — List all NCs with filters
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await ncVentasService.getAll({
      clienteId: req.query.clienteId ? parseInt(req.query.clienteId as string) : undefined,
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

// GET /api/nc-ventas/ventas-para-nc/:clienteId  — Sales available for NC
router.get('/ventas-para-nc/:clienteId', async (req: Request, res: Response) => {
  try {
    const clienteId = parseInt(req.params.clienteId as string);
    const result = await ncVentasService.getVentasParaNC(
      clienteId,
      req.query.fechaDesde as string | undefined,
      req.query.fechaHasta as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    console.error('[NC-VENTAS] ventas-para-nc error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nc-ventas/items-venta/:ventaId  — Items from a sale for devolution grid
router.get('/items-venta/:ventaId', async (req: Request, res: Response) => {
  try {
    const ventaId = parseInt(req.params.ventaId as string);
    const result = await ncVentasService.getItemsVenta(ventaId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nc-ventas/existe/:ventaId  — Check if NCs exist for a sale
router.get('/existe/:ventaId', async (req: Request, res: Response) => {
  try {
    const ventaId = parseInt(req.params.ventaId as string);
    const result = await ncVentasService.existeNCParaVenta(ventaId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/nc-ventas/:id  — Get NC detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const result = await ncVentasService.getById(id);
    res.json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nc-ventas  — Create NC
router.post('/', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const usuarioId = authReq.user!.id;
    const result = await ncVentasService.create(req.body, usuarioId);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error creating NC Venta:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/nc-ventas/:id/emitir-fiscal  — Emit fiscal NC via ARCA
router.post('/:id/emitir-fiscal', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const result = await ncVentasService.emitirNCFiscal(id);
    res.json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error emitting fiscal NC Venta:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/nc-ventas/:id/anular  — Void an NC (generates ND)
router.put('/:id/anular', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const usuarioId = authReq.user!.id;
    const id = parseInt(req.params.id as string);
    const result = await ncVentasService.anular(id, usuarioId);
    res.json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Error anulando NC Venta:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
