import { Router, Request, Response } from 'express';
import { priceListService } from '../services/priceList.service.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

function parseOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// GET /api/price-lists
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await priceListService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      search: req.query.search as string | undefined,
      activa: req.query.activa !== undefined ? req.query.activa === 'true' : undefined,
      orderBy: req.query.orderBy as string | undefined,
      orderDir: (req.query.orderDir as 'ASC' | 'DESC') || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/price-lists/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const data = await priceListService.getById(parseInt(req.params.id as string, 10));
    res.json(data);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/price-lists/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
      await priceListService.update(parseInt(req.params.id as string, 10), req.body);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/price-lists/:id/products
router.get('/:id/products', async (req: Request, res: Response) => {
  try {
      const result = await priceListService.getProducts(parseInt(req.params.id as string, 10), {
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 25,
      search: req.query.search as string | undefined,
      categoriaId: parseOptionalInt(req.query.categoriaId),
      marcaId: parseOptionalInt(req.query.marcaId),
      activo: req.query.activo !== undefined ? req.query.activo === 'true' : undefined,
      orderBy: req.query.orderBy as string | undefined,
      orderDir: (req.query.orderDir as 'ASC' | 'DESC') || undefined,
    });
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PATCH /api/price-lists/:id/products/:productId
router.patch('/:id/products/:productId', async (req: Request, res: Response) => {
  try {
    await priceListService.updateProductPrice(
        parseInt(req.params.id as string, 10),
        parseInt(req.params.productId as string, 10),
      Number(req.body.precio)
    );
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/price-lists/:id/apply-percentage
router.post('/:id/apply-percentage', async (req: Request, res: Response) => {
  try {
      const result = await priceListService.applyPercentage(parseInt(req.params.id as string, 10), req.body);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;