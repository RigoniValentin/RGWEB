import { Router, Request, Response } from 'express';
import { productService } from '../services/product.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/products
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await productService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      search: req.query.search as string | undefined,
      categoriaId: req.query.categoriaId ? parseInt(req.query.categoriaId as string) : undefined,
      marcaId: req.query.marcaId ? parseInt(req.query.marcaId as string) : undefined,
      activo: req.query.activo !== undefined ? req.query.activo === 'true' : undefined,
      stockBajo: req.query.stockBajo === 'true',
      orderBy: req.query.orderBy as string | undefined,
      orderDir: (req.query.orderDir as 'ASC' | 'DESC') || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/tasas-impuestos
router.get('/tasas-impuestos', async (_req: Request, res: Response) => {
  try {
    const data = await productService.getTasasImpuestos();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/for-labels  — lightweight list with barcodes for label printing
router.get('/for-labels', async (req: Request, res: Response) => {
  try {
    const result = await productService.getForLabels({
      search: req.query.search as string | undefined,
      categoriaId: req.query.categoriaId ? parseInt(req.query.categoriaId as string) : undefined,
      marcaId: req.query.marcaId ? parseInt(req.query.marcaId as string) : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const product = await productService.getById(parseInt(req.params.id as string));
    res.json(product);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/products/:id/stock
router.get('/:id/stock', async (req: Request, res: Response) => {
  try {
    const stock = await productService.getStockByProduct(parseInt(req.params.id as string));
    res.json(stock);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const result = await productService.create(req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /api/products/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    await productService.update(parseInt(req.params.id as string), req.body);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/products/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const result = await productService.delete(parseInt(req.params.id as string));
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/products/inline-edit
router.patch('/inline-edit', async (req: Request, res: Response) => {
  try {
    await productService.inlineEdit(req.body);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/products/bulk-assign
router.post('/bulk-assign', async (req: Request, res: Response) => {
  try {
    const result = await productService.bulkAssign(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/products/bulk-delete
router.post('/bulk-delete', async (req: Request, res: Response) => {
  try {
    const result = await productService.bulkDelete(req.body.productoIds);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products/bulk-prices
router.post('/bulk-prices', async (req: Request, res: Response) => {
  try {
    const result = await productService.bulkGeneratePrices(req.body);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/products/:id/copy
router.post('/:id/copy', async (req: Request, res: Response) => {
  try {
    const result = await productService.copy(parseInt(req.params.id as string));
    res.status(201).json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
