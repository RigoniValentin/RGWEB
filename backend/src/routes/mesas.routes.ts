import { Router, Response, NextFunction } from 'express';
import { mesasService } from '../services/mesas.service.js';
import { AuthRequest, authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware as any);

// ══════════════════════════════════════════════════
//  Sectores
// ══════════════════════════════════════════════════

router.get('/sectores', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const sectores = await mesasService.getSectores(pvId);
    res.json(sectores);
  } catch (err) { next(err); }
});

router.post('/sectores', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sector = await mesasService.createSector(req.body);
    res.status(201).json(sector);
  } catch (err) { next(err); }
});

router.put('/sectores/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.updateSector(Number(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/sectores/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.deleteSector(Number(req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ══════════════════════════════════════════════════
//  Mesas
// ══════════════════════════════════════════════════

router.get('/mesas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sectorId = Number(req.query.sectorId);
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    if (!sectorId) { res.status(400).json({ error: 'sectorId requerido' }); return; }
    const mesas = await mesasService.getMesas(sectorId, pvId);
    res.json(mesas);
  } catch (err) { next(err); }
});

router.post('/mesas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const mesa = await mesasService.createMesa(req.body);
    res.status(201).json(mesa);
  } catch (err) { next(err); }
});

router.put('/mesas/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.updateMesa(Number(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/mesas/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.deleteMesa(Number(req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

router.patch('/mesas/:id/estado', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.cambiarEstadoMesa(Number(req.params.id), req.body.estado);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════
//  Pedidos
// ══════════════════════════════════════════════════

router.get('/pedidos/mesa/:mesaId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pedidos = await mesasService.getPedidosMesa(Number(req.params.mesaId));
    res.json(pedidos);
  } catch (err) { next(err); }
});

router.get('/pedidos/mesa/:mesaId/activo', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pedido = await mesasService.getPedidoActivoMesa(Number(req.params.mesaId));
    res.json(pedido);
  } catch (err) { next(err); }
});

router.get('/pedidos/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pedido = await mesasService.getPedidoById(Number(req.params.id));
    if (!pedido) { res.status(404).json({ error: 'Pedido no encontrado' }); return; }
    res.json(pedido);
  } catch (err) { next(err); }
});

router.post('/pedidos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pedido = await mesasService.crearPedido({
      MESA_ID: req.body.MESA_ID,
      PUNTO_VENTA_ID: req.body.PUNTO_VENTA_ID,
      MOZO: req.user!.nombre,
    });
    res.status(201).json(pedido);
  } catch (err) { next(err); }
});

router.post('/pedidos/:id/items', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const item = await mesasService.agregarItemPedido(Number(req.params.id), req.body);
    res.status(201).json(item);
  } catch (err) { next(err); }
});

router.patch('/pedidos/items/:itemId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.actualizarCantidadItem(Number(req.params.itemId), req.body.CANTIDAD);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/pedidos/items/:itemId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.eliminarItemPedido(Number(req.params.itemId));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/pedidos/:id/cerrar', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.cerrarPedido(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/pedidos/:id/reabrir', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.reabrirPedido(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/pedidos/:id/pasar-a-venta', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ventaId = await mesasService.pasarPedidoAVenta(Number(req.params.id), {
      ...req.body,
      USUARIO_ID: req.user!.id,
    });
    res.json({ ventaId });
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── Search products for orders ───────────────────
router.get('/search-products', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const search = (req.query.search as string) || '';
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const results = await mesasService.searchProductos(search, pvId);
    res.json(results);
  } catch (err) { next(err); }
});

export default router;
