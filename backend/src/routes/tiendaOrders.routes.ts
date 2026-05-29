// ═══════════════════════════════════════════════════
//  Rutas admin — Pedidos de Tienda Online
//
//  Prefijo: /api/tienda-orders
//  Auth: JWT del panel + permisos tienda_orders.*
// ═══════════════════════════════════════════════════

import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, requirePermiso, AuthRequest } from '../middleware/auth.js';
import { tiendaOrdersService } from '../services/tiendaOrders.service.js';
import type { TiendaOrderEstado, TiendaOrderListFilters } from '../types/tiendaOrders.js';

const router = Router();
router.use(authMiddleware);

// ── GET /api/tienda-orders ───────────────────────
router.get('/', requirePermiso('tienda_orders.ver'), async (req: AuthRequest, res: Response) => {
  try {
    const filters: TiendaOrderListFilters = {
      estado: req.query.estado as TiendaOrderEstado | 'todos' | undefined,
      tienda: req.query.tienda as string | undefined,
      search: req.query.search as string | undefined,
      desde: req.query.desde as string | undefined,
      hasta: req.query.hasta as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    };
    const result = await tiendaOrdersService.list(filters);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tienda-orders/counts ─────────────────
router.get('/counts', requirePermiso('tienda_orders.ver'), async (_req: AuthRequest, res: Response) => {
  try {
    const counts = await tiendaOrdersService.getCounts();
    res.json(counts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/tienda-orders/:id ────────────────────
router.get('/:id', requirePermiso('tienda_orders.ver'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    const order = await tiendaOrdersService.getById(id);
    if (!order) {
      res.status(404).json({ error: 'Pedido no encontrado' });
      return;
    }
    res.json(order);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/tienda-orders/:id/procesar ──────────
const procesarSchema = z.object({
  clienteId: z.number().int().positive().optional(),
  puntoVentaId: z.number().int().positive().optional(),
  metodoPago: z.enum(['EFECTIVO', 'DIGITAL', 'CTA_CORRIENTE']).optional(),
  itemsOverride: z
    .array(
      z.object({
        productoId: z.number().int().positive(),
        cantidad: z.number().positive(),
        precioUnitario: z.number().nonnegative().optional(),
        descuento: z.number().min(0).max(100).optional(),
      }),
    )
    .optional(),
});

router.post('/:id/procesar', requirePermiso('tienda_orders.procesar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    const parsed = procesarSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos inválidos', detalles: parsed.error.errors });
      return;
    }
    const result = await tiendaOrdersService.procesar(id, req.user?.id ?? 0, parsed.data);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── POST /api/tienda-orders/:id/facturar ──────────
router.post('/:id/facturar', requirePermiso('tienda_orders.facturar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    const result = await tiendaOrdersService.facturar(id, req.user?.id ?? 0);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── POST /api/tienda-orders/:id/cancelar ──────────
router.post('/:id/cancelar', requirePermiso('tienda_orders.cancelar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    const motivo = String(req.body?.motivo ?? '').trim();
    await tiendaOrdersService.cancelar(id, req.user?.id ?? 0, motivo);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// ── POST /api/tienda-orders/:id/reenviar-mail ─────
router.post('/:id/reenviar-mail', requirePermiso('tienda_orders.facturar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (!id) {
      res.status(400).json({ error: 'ID inválido' });
      return;
    }
    const email = req.body?.email ? String(req.body.email) : undefined;
    await tiendaOrdersService.reenviarComprobante(id, email);
    res.json({ ok: true });
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
