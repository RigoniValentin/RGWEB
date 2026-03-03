import { Router, Request, Response } from 'express';
import { ctaCorrienteProvService } from '../services/ctaCorrienteProv.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/cta-corriente-prov — list all suppliers with CTA_CORRIENTE flag
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteProvService.getAll(req.query.search as string | undefined);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cta-corriente-prov/:proveedorId/crear — create account for a supplier
router.post('/:proveedorId/crear', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteProvService.crearCuenta(parseInt(req.params.proveedorId as string));
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cta-corriente-prov/:ctaId/movimientos — account detail (debit/credit/balance)
router.get('/:ctaId/movimientos', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteProvService.getMovimientos(
      parseInt(req.params.ctaId as string),
      req.query.fechaDesde as string | undefined,
      req.query.fechaHasta as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cta-corriente-prov/:ctaId/ordenes-pago — list payment orders
router.get('/:ctaId/ordenes-pago', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteProvService.getOrdenesPago(
      parseInt(req.params.ctaId as string),
      req.query.fechaDesde as string | undefined,
      req.query.fechaHasta as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cta-corriente-prov/orden-pago/:pagoId — single payment order for editing
router.get('/orden-pago/:pagoId', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteProvService.getOrdenPagoById(parseInt(req.params.pagoId as string));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/cta-corriente-prov/:ctaId/orden-pago — create payment order
router.post('/:ctaId/orden-pago', async (req: AuthRequest, res: Response) => {
  try {
    const ctaId = parseInt(req.params.ctaId as string);
    const proveedorId = parseInt(req.body.proveedorId);
    const result = await ctaCorrienteProvService.crearOrdenPago(
      ctaId, proveedorId, req.body, req.user!.id,
    );
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/cta-corriente-prov/:ctaId/orden-pago/:pagoId — update payment order
router.put('/:ctaId/orden-pago/:pagoId', async (req: AuthRequest, res: Response) => {
  try {
    const ctaId = parseInt(req.params.ctaId as string);
    const pagoId = parseInt(req.params.pagoId as string);
    const proveedorId = parseInt(req.body.proveedorId);
    await ctaCorrienteProvService.actualizarOrdenPago(
      pagoId, ctaId, proveedorId, req.body, req.user!.id,
    );
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/cta-corriente-prov/orden-pago/:pagoId — delete payment order
router.delete('/orden-pago/:pagoId', async (req: Request, res: Response) => {
  try {
    await ctaCorrienteProvService.eliminarOrdenPago(parseInt(req.params.pagoId as string));
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
