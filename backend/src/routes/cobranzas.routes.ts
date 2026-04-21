import { Router, Request, Response } from 'express';
import { ctaCorrienteService } from '../services/ctaCorriente.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/cobranzas — list all cobranzas across all accounts
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteService.getAllCobranzas(
      req.query.fechaDesde as string | undefined,
      req.query.fechaHasta as string | undefined,
      req.query.search as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cobranzas/clientes — list customers with cta corriente for selector
router.get('/clientes', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteService.getClientesConCtaCorriente(
      req.query.search as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cobranzas/active-payment-methods — active payment methods
router.get('/active-payment-methods', async (req: Request, res: Response) => {
  try {
    const data = await ctaCorrienteService.getActivePaymentMethods();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cobranzas/metodos-totales — aggregated payment method totals
router.get('/metodos-totales', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteService.getCobranzasMetodosTotales(
      req.query.fechaDesde as string | undefined,
      req.query.fechaHasta as string | undefined,
      req.query.search as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cobranzas/:pagoId/recibo — full recibo data for printing
router.get('/:pagoId/recibo', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteService.getReciboData(parseInt(req.params.pagoId as string));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/cobranzas/:pagoId — single cobranza for editing
router.get('/:pagoId', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteService.getCobranzaById(parseInt(req.params.pagoId as string));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/cobranzas/:ctaId — create cobranza
router.post('/:ctaId', async (req: AuthRequest, res: Response) => {
  try {
    const ctaId = parseInt(req.params.ctaId as string);
    const clienteId = parseInt(req.body.clienteId);
    const result = await ctaCorrienteService.crearCobranza(
      ctaId, clienteId, req.body, req.user!.id,
    );
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/cobranzas/:ctaId/:pagoId — update cobranza
router.put('/:ctaId/:pagoId', async (req: AuthRequest, res: Response) => {
  try {
    const ctaId = parseInt(req.params.ctaId as string);
    const pagoId = parseInt(req.params.pagoId as string);
    const clienteId = parseInt(req.body.clienteId);
    await ctaCorrienteService.actualizarCobranza(
      pagoId, ctaId, clienteId, req.body, req.user!.id,
    );
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/cobranzas/:pagoId — delete cobranza
router.delete('/:pagoId', async (req: Request, res: Response) => {
  try {
    await ctaCorrienteService.eliminarCobranza(parseInt(req.params.pagoId as string));
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
