import { Router, Request, Response } from 'express';
import { catalogService } from '../services/catalog.service.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/catalog/categorias
router.get('/categorias', async (_req: Request, res: Response) => {
  try {
    const data = await catalogService.getCategorias();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog/marcas
router.get('/marcas', async (_req: Request, res: Response) => {
  try {
    const data = await catalogService.getMarcas();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog/unidades
router.get('/unidades', async (_req: Request, res: Response) => {
  try {
    const data = await catalogService.getUnidades();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog/listas-precios
router.get('/listas-precios', async (_req: Request, res: Response) => {
  try {
    const data = await catalogService.getListasPrecios();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog/depositos
router.get('/depositos', async (_req: Request, res: Response) => {
  try {
    const data = await catalogService.getDepositos();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/catalog/puntos-venta
router.get('/puntos-venta', async (_req: Request, res: Response) => {
  try {
    const data = await catalogService.getPuntosVenta();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
