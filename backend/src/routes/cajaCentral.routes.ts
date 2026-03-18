import { Router, Response, NextFunction } from 'express';
import { cajaCentralService } from '../services/cajaCentral.service.js';
import { salesService } from '../services/sales.service.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware as any);

// Helper to parse comma-separated PV IDs
function parsePvIds(raw: unknown): number[] | undefined {
  if (!raw) return undefined;
  const ids = String(raw).split(',').map(Number).filter(n => !isNaN(n));
  return ids.length > 0 ? ids : undefined;
}

// ── GET /api/caja-central/movimientos ────────────
router.get('/movimientos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaIds, cajaId } = req.query;
    const result = await cajaCentralService.getMovimientos({
      fechaDesde: fechaDesde as string | undefined,
      fechaHasta: fechaHasta as string | undefined,
      puntoVentaIds: parsePvIds(puntoVentaIds),
      cajaId: cajaId ? Number(cajaId) : undefined,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/caja-central/totales ────────────────
router.get('/totales', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaIds } = req.query;
    const result = await cajaCentralService.getTotales({
      fechaDesde: fechaDesde as string | undefined,
      fechaHasta: fechaHasta as string | undefined,
      puntoVentaIds: parsePvIds(puntoVentaIds),
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/caja-central/balance-historico ──────
router.get('/balance-historico', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvIds = parsePvIds(req.query.puntoVentaIds);
    const result = await cajaCentralService.getBalanceHistorico(pvIds);
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/caja-central/fondo-cambio ───────────
router.get('/fondo-cambio', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvIds = parsePvIds(req.query.puntoVentaIds);
    const saldo = await cajaCentralService.getSaldoFondoCambio(pvIds);
    res.json({ saldo });
  } catch (err) { next(err); }
});

// ── GET /api/caja-central/desglose-metodos — payment method breakdown for period ──
router.get('/desglose-metodos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaIds } = req.query;
    const data = await salesService.getDesgloseMetodosCajaCentral({
      fechaDesde: fechaDesde as string | undefined,
      fechaHasta: fechaHasta as string | undefined,
      puntoVentaIds: parsePvIds(puntoVentaIds),
    });
    res.json(data);
  } catch (err) { next(err); }
});

// ── POST /api/caja-central/movimiento — new manual movement ──
router.post('/movimiento', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.body.puntoVentaId ? Number(req.body.puntoVentaId) : undefined;
    const result = await cajaCentralService.crearMovimiento(req.body, req.user!.id, pvId);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── GET /api/caja-central/movimiento/:id/desglose-metodos ──
router.get('/movimiento/:id/desglose-metodos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await cajaCentralService.getDesgloseMovimiento(Number(req.params.id));
    res.json(data);
  } catch (err) { next(err); }
});

// ── DELETE /api/caja-central/movimiento/:id — delete manual movement ──
router.delete('/movimiento/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaCentralService.eliminarMovimiento(Number(req.params.id));
    res.json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

export default router;
