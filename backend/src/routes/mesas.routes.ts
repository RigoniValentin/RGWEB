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
//  Listado de Comandas
// ══════════════════════════════════════════════════

router.get('/comandas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { puntoVentaId, fechaDesde, fechaHasta, estado, mesaId } = req.query;
    if (!puntoVentaId || !fechaDesde || !fechaHasta) {
      return res.status(400).json({ error: 'puntoVentaId, fechaDesde y fechaHasta son requeridos' });
    }
    const data = await mesasService.getListadoComandas({
      puntoVentaId: Number(puntoVentaId),
      fechaDesde: String(fechaDesde),
      fechaHasta: String(fechaHasta),
      estado: estado ? String(estado) : undefined,
      mesaId: mesaId ? Number(mesaId) : undefined,
    });
    res.json(data);
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

// ── Advanced search products for orders ──────────
router.get('/search-products-advanced', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const results = await mesasService.searchProductosAdvanced({
      search: req.query.search as string,
      marca: req.query.marca as string,
      categoria: req.query.categoria as string,
      codigo: req.query.codigo as string,
      soloActivos: req.query.soloActivos !== 'false',
      soloConStock: req.query.soloConStock === 'true',
      listaId: req.query.listaId ? Number(req.query.listaId) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json(results);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════
//  Tipos de Servicio Comanda
// ══════════════════════════════════════════════════

router.get('/tipos-servicio/search-productos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const search = (req.query.search as string) || '';
    const pvId = Number(req.query.puntoVentaId);
    const tsId = Number(req.query.tipoServicioId) || 0;
    if (!pvId) { res.status(400).json({ error: 'puntoVentaId requerido' }); return; }
    const results = await mesasService.searchProductosParaAsignar(search, pvId, tsId);
    res.json(results);
  } catch (err) { next(err); }
});

router.get('/tipos-servicio', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const tipos = await mesasService.getTiposServicioComanda(pvId);
    res.json(tipos);
  } catch (err) { next(err); }
});

router.post('/tipos-servicio', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tipo = await mesasService.createTipoServicioComanda(req.body);
    res.status(201).json(tipo);
  } catch (err) { next(err); }
});

router.put('/tipos-servicio/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.updateTipoServicioComanda(Number(req.params.id), req.body);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/tipos-servicio/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await mesasService.deleteTipoServicioComanda(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Producto ↔ Tipo Servicio association ─────────

router.get('/tipos-servicio/:id/productos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = Number(req.query.puntoVentaId);
    if (!pvId) { res.status(400).json({ error: 'puntoVentaId requerido' }); return; }
    const productos = await mesasService.getProductosByTipoServicio(Number(req.params.id), pvId);
    res.json(productos);
  } catch (err) { next(err); }
});

router.post('/tipos-servicio/:id/productos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = Number(req.body.PUNTO_VENTA_ID);
    const prodId = Number(req.body.PRODUCTO_ID);
    if (!pvId || !prodId) { res.status(400).json({ error: 'PRODUCTO_ID y PUNTO_VENTA_ID requeridos' }); return; }
    await mesasService.asignarProductoTipoServicio(prodId, pvId, Number(req.params.id));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/tipos-servicio/:id/productos/:productoId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = Number(req.query.puntoVentaId);
    if (!pvId) { res.status(400).json({ error: 'puntoVentaId requerido' }); return; }
    await mesasService.desasignarProductoTipoServicio(Number(req.params.productoId), pvId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Print data ──────────────────────────────────

router.get('/pedidos/:id/tipos-servicio', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = Number(req.query.puntoVentaId);
    if (!pvId) { res.status(400).json({ error: 'puntoVentaId requerido' }); return; }
    const tipos = await mesasService.getTiposServicioEnPedido(Number(req.params.id), pvId);
    res.json(tipos);
  } catch (err) { next(err); }
});

router.get('/pedidos/:id/comanda', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tsId = req.query.tipoServicioId ? Number(req.query.tipoServicioId) : undefined;
    const data = await mesasService.getComandaData(Number(req.params.id), tsId);
    if (!data) { res.status(404).json({ error: 'Pedido no encontrado' }); return; }
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/pedidos/:id/cuenta-cliente', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await mesasService.getCuentaClienteData(Number(req.params.id));
    if (!data) { res.status(404).json({ error: 'Pedido no encontrado' }); return; }
    res.json(data);
  } catch (err) { next(err); }
});

export default router;
