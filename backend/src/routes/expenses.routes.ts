import { Router, Response, NextFunction } from 'express';
import { expensesService } from '../services/expenses.service.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware as any);

// Helper to parse comma-separated PV IDs
function parsePvIds(raw: unknown): number[] | undefined {
  if (!raw) return undefined;
  const ids = String(raw).split(',').map(Number).filter(n => !isNaN(n));
  return ids.length > 0 ? ids : undefined;
}

// ── GET /api/expenses ─────────────────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fechaDesde, fechaHasta, search, puntoVentaIds } = req.query;
    const result = await expensesService.getAll({
      fechaDesde: fechaDesde as string | undefined,
      fechaHasta: fechaHasta as string | undefined,
      search:     search     as string | undefined,
      puntoVentaIds: parsePvIds(puntoVentaIds),
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/expenses/active-payment-methods ──────
router.get('/active-payment-methods', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await expensesService.getActivePaymentMethods();
    res.json(data);
  } catch (err) { next(err); }
});

// ── GET /api/expenses/metodos-totales ─────────────
router.get('/metodos-totales', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fechaDesde, fechaHasta, search, puntoVentaIds } = req.query;
    const result = await expensesService.getMetodosTotales({
      fechaDesde: fechaDesde as string | undefined,
      fechaHasta: fechaHasta as string | undefined,
      search:     search     as string | undefined,
      puntoVentaIds: parsePvIds(puntoVentaIds),
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/expenses/entidades — distinct list ───
router.get('/entidades', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await expensesService.getEntidades();
    res.json(data);
  } catch (err) { next(err); }
});

// ── GET /api/expenses/:id — single gasto ──────────
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await expensesService.getById(Number(req.params.id));
    res.json(data);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(404).json({ error: err.message }); return; }
    next(err);
  }
});

// ── POST /api/expenses — new gasto ────────────────
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await expensesService.crear(req.body, req.user!.id);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── PUT /api/expenses/:id — update gasto ──────────
router.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await expensesService.actualizar(Number(req.params.id), req.body, req.user!.id);
    res.json({ ok: true });
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── DELETE /api/expenses/:id — delete gasto ───────
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await expensesService.eliminar(Number(req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

export default router;
