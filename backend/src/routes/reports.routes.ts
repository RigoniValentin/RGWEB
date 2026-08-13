import { Router, Request, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { productListingService } from '../services/productListing.service.js';
import { reportsService, type ReportFilter } from '../services/reports.service.js';

const router = Router();
router.use(authMiddleware);

function parseOptionalPositiveInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseListaPrecio(value: unknown): number {
  const parsed = parseInt(String(value ?? '0'), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 5 ? parsed : 0;
}

function parseDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return value;
}

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return String(value) === 'true' || value === '1';
}

function buildFilter(req: AuthRequest): ReportFilter | { error: string } {
  const fechaDesde = parseDate(req.query.fechaDesde);
  const fechaHasta = parseDate(req.query.fechaHasta);
  if (!fechaDesde || !fechaHasta) {
    return { error: 'Se requieren fechaDesde y fechaHasta (YYYY-MM-DD)' };
  }
  return {
    fechaDesde,
    fechaHasta,
    puntoVentaId: parseOptionalPositiveInt(req.query.puntoVentaId),
    categoriaId: parseOptionalPositiveInt(req.query.categoriaId),
    marcaId: parseOptionalPositiveInt(req.query.marcaId),
    clienteId: parseOptionalPositiveInt(req.query.clienteId),
    proveedorId: parseOptionalPositiveInt(req.query.proveedorId),
    incluirNc: parseBool(req.query.incluirNc),
    limit: parseOptionalPositiveInt(req.query.limit),
  };
}

function run<T>(req: AuthRequest, res: Response, fn: (filter: ReportFilter) => Promise<T>) {
  const filter = buildFilter(req);
  if ('error' in filter) {
    res.status(400).json({ error: filter.error });
    return;
  }
  fn(filter)
    .then(data => res.json(data))
    .catch((err: any) => res.status(500).json({ error: err.message }));
}

router.get('/listings/products', async (req: Request, res: Response) => {
  try {
    const data = await productListingService.getProductos({
      listaPrecio: parseListaPrecio(req.query.listaPrecio),
      categoriaId: parseOptionalPositiveInt(req.query.categoriaId),
      marcaId: parseOptionalPositiveInt(req.query.marcaId),
      soloActivos: req.query.soloActivos !== 'false',
      soloConStock: req.query.soloConStock === 'true',
      search: req.query.search as string | undefined,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/revenue/by-categories', (req: AuthRequest, res) => run(req, res, f => reportsService.getRevenueByCategories(f)));
router.get('/revenue/by-brands', (req: AuthRequest, res) => run(req, res, f => reportsService.getRevenueByBrands(f)));
router.get('/revenue/by-products', (req: AuthRequest, res) => run(req, res, f => reportsService.getRevenueByProducts(f)));

router.get('/sales/by-client', (req: AuthRequest, res) => run(req, res, f => reportsService.getSalesByClient(f)));
router.get('/sales/by-product', (req: AuthRequest, res) => run(req, res, f => reportsService.getSalesByProduct(f)));
router.get('/sales/by-sucursal', (req: AuthRequest, res) => run(req, res, f => reportsService.getSalesBySucursal(f)));
router.get('/sales/general', (req: AuthRequest, res) => run(req, res, f => reportsService.getSalesGeneral(f)));

router.get('/sales/timeline', async (req: AuthRequest, res: Response) => {
  const filter = buildFilter(req);
  if ('error' in filter) {
    res.status(400).json({ error: filter.error });
    return;
  }
  const granularity = String(req.query.granularity ?? 'day');
  if (granularity !== 'day' && granularity !== 'week' && granularity !== 'month') {
    res.status(400).json({ error: 'granularity debe ser day | week | month' });
    return;
  }
  try {
    const data = await reportsService.getSalesTimeline(filter, granularity as 'day' | 'week' | 'month');
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sales/heatmap', (req: AuthRequest, res) => run(req, res, f => reportsService.getSalesHeatmap(f)));

router.get('/products/top-unidades', (req: AuthRequest, res) => run(req, res, f => reportsService.getTopProductsByUnidades(f)));
router.get('/products/top-ingresos', (req: AuthRequest, res) => run(req, res, f => reportsService.getTopProductsByIngresos(f)));
router.get('/products/mix', async (req: AuthRequest, res: Response) => {
  const filter = buildFilter(req);
  if ('error' in filter) {
    res.status(400).json({ error: filter.error });
    return;
  }
  const dim = String(req.query.dimension ?? 'categoria');
  if (dim !== 'categoria' && dim !== 'marca') {
    res.status(400).json({ error: 'dimension debe ser categoria | marca' });
    return;
  }
  try {
    const data = await reportsService.getProductMix(filter, dim as 'categoria' | 'marca');
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/purchases/by-supplier', (req: AuthRequest, res) => run(req, res, f => reportsService.getPurchasesBySupplier(f)));
router.get('/purchases/by-product', (req: AuthRequest, res) => run(req, res, f => reportsService.getPurchasesByProduct(f)));
router.get('/purchases/general', (req: AuthRequest, res) => run(req, res, f => reportsService.getPurchasesGeneral(f)));

router.get('/clients/list', async (req: AuthRequest, res: Response) => {
  try {
    const data = await reportsService.getClientList({
      search: req.query.search as string | undefined,
      activo: parseBool(req.query.activo),
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/clients/nuevos-vs-recurrentes', (req: AuthRequest, res) => run(req, res, f => reportsService.getClientesNuevosVsRecurrentes(f)));

export default router;