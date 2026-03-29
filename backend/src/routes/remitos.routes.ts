import { Router, Request, Response } from 'express';
import { remitosService } from '../services/remitos.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/remitos
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await remitosService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      search: req.query.search as string | undefined,
      tipo: req.query.tipo as 'ENTRADA' | 'SALIDA' | undefined,
      fechaDesde: req.query.fechaDesde as string | undefined,
      fechaHasta: req.query.fechaHasta as string | undefined,
      clienteId: req.query.clienteId ? parseInt(req.query.clienteId as string) : undefined,
      proveedorId: req.query.proveedorId ? parseInt(req.query.proveedorId as string) : undefined,
      anulado: req.query.anulado !== undefined ? req.query.anulado === 'true' : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remitos/clientes (before :id)
router.get('/clientes', async (_req: Request, res: Response) => {
  try {
    const data = await remitosService.getClientes();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remitos/proveedores
router.get('/proveedores', async (_req: Request, res: Response) => {
  try {
    const data = await remitosService.getProveedores();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remitos/depositos
router.get('/depositos', async (_req: Request, res: Response) => {
  try {
    const data = await remitosService.getDepositos();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remitos/empresa
router.get('/empresa', async (_req: Request, res: Response) => {
  try {
    const data = await remitosService.getEmpresaData();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remitos/search-products
router.get('/search-products', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;
    if (!search || search.length < 1) {
      res.json([]);
      return;
    }
    const limit = parseInt(req.query.limit as string) || 20;
    const data = await remitosService.searchProducts(search, limit);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remitos/pendientes-cliente/:clienteId
router.get('/pendientes-cliente/:clienteId', async (req: Request, res: Response) => {
  try {
    const clienteId = parseInt(req.params.clienteId as string);
    if (!clienteId || isNaN(clienteId)) {
      res.json([]);
      return;
    }
    const data = await remitosService.getRemitosPendientesCliente(clienteId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remitos/items-para-venta/:remitoId
router.get('/items-para-venta/:remitoId', async (req: Request, res: Response) => {
  try {
    const remitoId = parseInt(req.params.remitoId as string);
    if (!remitoId || isNaN(remitoId)) {
      res.status(400).json({ error: 'ID de remito inválido' });
      return;
    }
    const data = await remitosService.getRemitoItemsParaVenta(remitoId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remitos/search-products-advanced
router.get('/search-products-advanced', async (req: Request, res: Response) => {
  try {
    const data = await remitosService.searchProductsAdvanced({
      search: req.query.search as string,
      marca: req.query.marca as string,
      categoria: req.query.categoria as string,
      codigo: req.query.codigo as string,
      soloActivos: req.query.soloActivos !== 'false',
      soloConStock: req.query.soloConStock === 'true',
      limit: parseInt(req.query.limit as string) || 50,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/remitos/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const remito = await remitosService.getById(parseInt(req.params.id as string));
    res.json(remito);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/remitos
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    const result = await remitosService.create(req.body, usuarioId);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/remitos/:id/anular
router.put('/:id/anular', async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    const result = await remitosService.anular(parseInt(req.params.id as string), usuarioId);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/remitos/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    const result = await remitosService.delete(parseInt(req.params.id as string), usuarioId);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
