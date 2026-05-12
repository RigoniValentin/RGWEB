import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { productListingService } from '../services/productListing.service.js';

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

// GET /api/reports/listings/products
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

export default router;
