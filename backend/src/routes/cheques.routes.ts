import { Router, Response } from 'express';
import { chequesService } from '../services/cheques.service.js';
import { authMiddleware, requirePermiso, AuthRequest } from '../middleware/auth.js';
import type { ChequeEstado } from '../types/index.js';

const router = Router();
router.use(authMiddleware);

// GET /api/cheques
router.get('/', requirePermiso('cheques.ver'), async (req: AuthRequest, res: Response) => {
  try {
    const estadoRaw = (req.query.estado as string | undefined)?.toUpperCase();
    const estado = estadoRaw === 'TODOS' || estadoRaw === 'EN_CARTERA' || estadoRaw === 'EGRESADO'
      || estadoRaw === 'DEPOSITADO' || estadoRaw === 'ANULADO'
      ? (estadoRaw as ChequeEstado | 'TODOS')
      : undefined;

    const result = await chequesService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 25,
      search: req.query.search as string | undefined,
      estado,
      desde: req.query.desde as string | undefined,
      hasta: req.query.hasta as string | undefined,
      orderBy: req.query.orderBy as string | undefined,
      orderDir: (req.query.orderDir as 'ASC' | 'DESC') || undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cheques/resumen
router.get('/resumen', requirePermiso('cheques.ver'), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await chequesService.getResumen();
    res.json(r);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cheques/cartera — atajo para selectores en pagos
router.get('/cartera', requirePermiso('cheques.ver'), async (_req: AuthRequest, res: Response) => {
  try {
    const list = await chequesService.getEnCartera();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cheques/:id
router.get('/:id', requirePermiso('cheques.ver'), async (req: AuthRequest, res: Response) => {
  try {
    const item = await chequesService.getById(parseInt(req.params.id as string));
    res.json(item);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/cheques  — alta manual
router.post('/', requirePermiso('cheques.editar'), async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user!.id;
    const usuarioNombre = req.user!.nombre || null;
    const result = await chequesService.create(req.body, usuarioId, usuarioNombre);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/cheques/:id — edición de campos descriptivos (sólo EN_CARTERA)
router.put('/:id', requirePermiso('cheques.editar'), async (req: AuthRequest, res: Response) => {
  try {
    await chequesService.update(parseInt(req.params.id as string), req.body, req.user!.id);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/cheques/:id/estado
router.put('/:id/estado', requirePermiso('cheques.editar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string);
    const { estado, descripcion, destinoTipo, destinoId, destinoDesc } = req.body || {};
    await chequesService.cambiarEstado(
      id, estado, { descripcion, destinoTipo, destinoId, destinoDesc },
      req.user!.id, req.user!.nombre || null
    );
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/cheques/salida — salida masiva (depositar o anular varios)
router.post('/salida', requirePermiso('cheques.editar'), async (req: AuthRequest, res: Response) => {
  try {
    const { chequeIds, estadoDestino, descripcion, destinoDesc } = req.body || {};
    if (!Array.isArray(chequeIds)) {
      res.status(400).json({ error: 'chequeIds debe ser un arreglo' });
      return;
    }
    const result = await chequesService.salidaMasiva(
      chequeIds, estadoDestino, descripcion || '', destinoDesc || null,
      req.user!.id, req.user!.nombre || null
    );
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/cheques/:id  → anula (soft delete)
router.delete('/:id', requirePermiso('cheques.editar'), async (req: AuthRequest, res: Response) => {
  try {
    const result = await chequesService.delete(
      parseInt(req.params.id as string),
      req.user!.id, req.user!.nombre || null
    );
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
