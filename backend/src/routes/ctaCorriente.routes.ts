import { Router, Request, Response } from 'express';
import { ctaCorrienteService } from '../services/ctaCorriente.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/cta-corriente — list all customers with CTA_CORRIENTE flag
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteService.getAll(req.query.search as string | undefined);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cta-corriente/:clienteId/crear — create account for a customer
router.post('/:clienteId/crear', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteService.crearCuenta(parseInt(req.params.clienteId as string));
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cta-corriente/:ctaId/movimientos — account detail (debit/credit/balance)
router.get('/:ctaId/movimientos', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteService.getMovimientos(
      parseInt(req.params.ctaId as string),
      req.query.fechaDesde as string | undefined,
      req.query.fechaHasta as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cta-corriente/:ctaId/cobranzas — list payments
router.get('/:ctaId/cobranzas', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteService.getCobranzas(
      parseInt(req.params.ctaId as string),
      req.query.fechaDesde as string | undefined,
      req.query.fechaHasta as string | undefined,
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cta-corriente/cobranza/:pagoId — single collection for editing
router.get('/cobranza/:pagoId', async (req: Request, res: Response) => {
  try {
    const result = await ctaCorrienteService.getCobranzaById(parseInt(req.params.pagoId as string));
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/cta-corriente/:ctaId/cobranza — create collection
router.post('/:ctaId/cobranza', async (req: AuthRequest, res: Response) => {
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

// PUT /api/cta-corriente/:ctaId/cobranza/:pagoId — update collection
router.put('/:ctaId/cobranza/:pagoId', async (req: AuthRequest, res: Response) => {
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

// DELETE /api/cta-corriente/cobranza/:pagoId — delete collection
router.delete('/cobranza/:pagoId', async (req: Request, res: Response) => {
  try {
    await ctaCorrienteService.eliminarCobranza(parseInt(req.params.pagoId as string));
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
