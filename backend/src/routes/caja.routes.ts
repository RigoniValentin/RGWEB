import { Router, Response, NextFunction } from 'express';
import { cajaService } from '../services/caja.service.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware as any);

// ── GET /api/caja — list cajas ───────────────────
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, fechaDesde, fechaHasta, estado, puntoVentaIds } = req.query;
    const pvIds = puntoVentaIds
      ? String(puntoVentaIds).split(',').map(Number).filter(n => !isNaN(n))
      : undefined;

    const result = await cajaService.getAll({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      fechaDesde: fechaDesde as string | undefined,
      fechaHasta: fechaHasta as string | undefined,
      estado: estado as string | undefined,
      puntoVentaIds: pvIds,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/caja/mi-caja — get current user's open caja ──
router.get('/mi-caja', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const caja = await cajaService.getCajaAbierta(req.user!.id);
    res.json(caja);
  } catch (err) { next(err); }
});

// ── GET /api/caja/fondo-cambio — fondo de cambio saldo ──
router.get('/fondo-cambio', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const saldo = await cajaService.getSaldoFondoCambio(pvId);
    res.json({ saldo });
  } catch (err) { next(err); }
});

// ── GET /api/caja/fondo-cambio/history — fondo de cambio history ──
router.get('/fondo-cambio/history', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const history = await cajaService.getFondoCambioHistory(pvId, limit);
    res.json(history);
  } catch (err) { next(err); }
});

// ── GET /api/caja/cajas-abiertas — list open cajas for selector ──
router.get('/cajas-abiertas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const cajas = await cajaService.getCajasAbiertas(pvId);
    res.json(cajas);
  } catch (err) { next(err); }
});

// ── GET /api/caja/efectivo-caja-central — CC cash available ──
router.get('/efectivo-caja-central', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const efectivo = await cajaService.getEfectivoCajaCentral(pvId);
    res.json({ efectivo });
  } catch (err) { next(err); }
});

// ── POST /api/caja/fondo-cambio/transferir — transfer between FC and CC/Caja ──
router.post('/fondo-cambio/transferir', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.body.puntoVentaId ? Number(req.body.puntoVentaId) : undefined;
    const result = await cajaService.transferirFondoCambio(req.body, req.user!.id, pvId);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── GET /api/caja/:id — get caja detail with items ──
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const caja = await cajaService.getById(Number(req.params.id));
    if (!caja) { res.status(404).json({ error: 'Caja no encontrada' }); return; }
    res.json(caja);
  } catch (err) { next(err); }
});

// ── POST /api/caja/abrir — open a new caja ──────
router.post('/abrir', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.abrir(req.body, req.user!.id);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── POST /api/caja/:id/cerrar — close a caja ────
router.post('/:id/cerrar', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.cerrar(Number(req.params.id), req.body, req.user!.id);
    res.json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── POST /api/caja/:id/ingreso-egreso — add income/expense ──
router.post('/:id/ingreso-egreso', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.addIngresoEgreso(Number(req.params.id), req.body, req.user!.id);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── DELETE /api/caja/:cajaId/items/:itemId — delete manual item ──
router.delete('/:cajaId/items/:itemId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.deleteItem(Number(req.params.cajaId), Number(req.params.itemId));
    res.json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

export default router;
