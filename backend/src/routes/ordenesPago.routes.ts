import { Router, Request, Response } from 'express';
import { ctaCorrienteProvService } from '../services/ctaCorrienteProv.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/ordenes-pago — list all ordenes de pago across all accounts
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteProvService.getAllOrdenesPago(
      req.query.fechaDesde as string | undefined,
      req.query.fechaHasta as string | undefined,
      req.query.search as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ordenes-pago/proveedores — list suppliers with cta corriente for selector
router.get('/proveedores', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteProvService.getProveedoresConCtaCorriente(
      req.query.search as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ordenes-pago/active-payment-methods — active payment methods
router.get('/active-payment-methods', async (req: Request, res: Response) => {
  try {
    const data = await ctaCorrienteProvService.getActivePaymentMethods();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ordenes-pago/metodos-totales — aggregated payment method totals
router.get('/metodos-totales', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteProvService.getOrdenesPagoMetodosTotales(
      req.query.fechaDesde as string | undefined,
      req.query.fechaHasta as string | undefined,
      req.query.search as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ordenes-pago/:pagoId/recibo — full recibo data for printing
router.get('/:pagoId/recibo', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteProvService.getOrdenPagoReciboData(parseInt(req.params.pagoId as string));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/ordenes-pago/:pagoId — single orden de pago for editing
router.get('/:pagoId', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteProvService.getOrdenPagoById(parseInt(req.params.pagoId as string));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/ordenes-pago/:ctaId — create orden de pago
router.post('/:ctaId', async (req: AuthRequest, res: Response) => {
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

// PUT /api/ordenes-pago/:ctaId/:pagoId — update orden de pago
router.put('/:ctaId/:pagoId', async (req: AuthRequest, res: Response) => {
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

// DELETE /api/ordenes-pago/:pagoId — delete orden de pago
router.delete('/:pagoId', async (req: Request, res: Response) => {
  try {
    await ctaCorrienteProvService.eliminarOrdenPago(parseInt(req.params.pagoId as string));
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
