import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { externalAuthMiddleware, ExternalRequest } from '../middleware/externalAuth.js';
import { integracionesService } from '../services/integraciones.service.js';
import { salesService, VentaInput, VentaItemInput } from '../services/sales.service.js';
import { tiendaOrdersService } from '../services/tiendaOrders.service.js';
import { getPool, sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  External API — endpoints expuestos vía Cloudflare
//  Tunnel para la tienda online (x-api-key) y la app
//  móvil (Bearer JWT).
//
//  Prefijo: /api/external
// ═══════════════════════════════════════════════════

const router = Router();
router.use(externalAuthMiddleware);

// ── Helper: logging genérico inbound ─────────────────────
async function logInbound(
  req: ExternalRequest,
  eventType: string,
  status: 'SUCCESS' | 'ERROR',
  httpStatus: number,
  durationMs: number,
  reqBody?: unknown,
  errorMessage?: string,
): Promise<void> {
  await integracionesService.log({
    eventType,
    direction: 'INBOUND',
    status,
    httpStatus,
    targetUrl: req.originalUrl,
    requestBody: reqBody,
    errorMessage: errorMessage ?? null,
    durationMs,
    apiKeyId: req.external?.apiKeyId ?? null,
  });
}

// ── GET /api/external/health ───────────────────────────
router.get('/health', (req: ExternalRequest, res: Response) => {
  res.json({ status: 'ok', auth: req.external?.method, timestamp: new Date().toISOString() });
});

// ── GET /api/external/sync-stock ───────────────────────
//   Devuelve el catálogo de productos marcados como VENTA_WEB
//   con stock consolidado y precio de lista 1.
router.get('/sync-stock', async (req: ExternalRequest, res: Response, next: NextFunction) => {
  const started = Date.now();
  try {
    const items = await integracionesService.getStockParaTienda();
    res.json({ count: items.length, items });
    await logInbound(req, 'sync.stock', 'SUCCESS', 200, Date.now() - started, { count: items.length });
  } catch (err) {
    await logInbound(req, 'sync.stock', 'ERROR', 500, Date.now() - started, undefined, (err as Error).message);
    next(err);
  }
});

// ── POST /api/external/orders ──────────────────────────
//   Recibe un pedido desde la tienda online y lo integra
//   como Venta en el sistema.

const orderItemSchema = z.object({
  productoId: z.number().int().positive(),
  cantidad: z.number().positive(),
  precioUnitario: z.number().nonnegative().optional(),
  descuento: z.number().min(0).max(100).optional(),
});

const orderSchema = z.object({
  externalOrderId: z.string().min(1).max(80),
  cliente: z
    .object({
      nombre: z.string().max(200).optional(),
      documento: z.string().max(50).optional(),
      email: z.string().email().max(200).optional(),
      telefono: z.string().max(50).optional(),
    })
    .optional(),
  items: z.array(orderItemSchema).min(1).max(100),
  observaciones: z.string().max(500).optional(),
  metodoPago: z.enum(['EFECTIVO', 'DIGITAL', 'CTA_CORRIENTE']).optional(),
});

router.post('/orders', async (req: ExternalRequest, res: Response, next: NextFunction) => {
  const started = Date.now();
  let parsedBody: z.infer<typeof orderSchema> | undefined;
  try {
    const parsed = orderSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      await logInbound(req, 'order.received', 'ERROR', 400, Date.now() - started, req.body, message);
      res.status(400).json({ error: 'Datos inválidos', detalles: parsed.error.errors });
      return;
    }
    parsedBody = parsed.data;

    const config = await integracionesService.getConfig();
    const defaultClienteId = config.orders_default_cliente_id;
    const defaultPvId = config.orders_default_punto_venta_id;
    if (!defaultClienteId || !defaultPvId) {
      await logInbound(req, 'order.received', 'ERROR', 412, Date.now() - started, parsedBody,
        'Falta configurar cliente/punto de venta por defecto para pedidos externos');
      res.status(412).json({
        error: 'El sistema no está configurado para recibir pedidos externos. '
             + 'Configurá un cliente y punto de venta por defecto desde Integraciones.',
      });
      return;
    }

    // Idempotencia: si ya existe una venta con este externalOrderId la devolvemos
    const pool = await getPool();
    const dup = await pool.request()
      .input('ext', sql.NVarChar(120), parsedBody.externalOrderId)
      .query(`SELECT TOP 1 VENTA_ID FROM VENTAS
              WHERE OBSERVACIONES LIKE '%[EXT:' + @ext + ']%'`);
    if (dup.recordset.length > 0) {
      res.status(200).json({
        status: 'duplicate',
        ventaId: dup.recordset[0].VENTA_ID,
        message: 'Pedido ya procesado previamente',
      });
      await logInbound(req, 'order.received', 'SUCCESS', 200, Date.now() - started,
        { externalOrderId: parsedBody.externalOrderId, duplicate: true });
      return;
    }

    // Resolver precios faltantes leyendo LISTA_1 desde DB
    const prodIds = parsedBody.items.map((i) => i.productoId);
    const reqDb = pool.request();
    prodIds.forEach((id, i) => reqDb.input(`p${i}`, sql.Int, id));
    const prodResult = await reqDb.query(`
      SELECT PRODUCTO_ID, ISNULL(LISTA_1, 0) AS PRECIO,
             ISNULL(PRECIO_COMPRA, 0) AS PRECIO_COMPRA,
             VENTA_WEB, ACTIVO
      FROM PRODUCTOS
      WHERE PRODUCTO_ID IN (${prodIds.map((_, i) => `@p${i}`).join(',')})
    `);
    const prodMap = new Map<number, any>();
    for (const r of prodResult.recordset) prodMap.set(r.PRODUCTO_ID, r);

    const items: VentaItemInput[] = [];
    for (const it of parsedBody.items) {
      const p = prodMap.get(it.productoId);
      if (!p) {
        res.status(400).json({ error: `Producto ${it.productoId} no encontrado` });
        await logInbound(req, 'order.received', 'ERROR', 400, Date.now() - started, parsedBody,
          `Producto inexistente: ${it.productoId}`);
        return;
      }
      if (!p.VENTA_WEB) {
        res.status(400).json({ error: `Producto ${it.productoId} no está habilitado para venta web` });
        await logInbound(req, 'order.received', 'ERROR', 400, Date.now() - started, parsedBody,
          `Producto no VENTA_WEB: ${it.productoId}`);
        return;
      }
      items.push({
        PRODUCTO_ID: it.productoId,
        PRECIO_UNITARIO: it.precioUnitario ?? Number(p.PRECIO),
        CANTIDAD: it.cantidad,
        DESCUENTO: it.descuento ?? 0,
        PRECIO_COMPRA: Number(p.PRECIO_COMPRA || 0),
      });
    }

    const obsTag = `[EXT:${parsedBody.externalOrderId}]`;
    const observaciones = parsedBody.observaciones ? `${obsTag} ${parsedBody.observaciones}` : obsTag;

    const ventaInput: VentaInput & { OBSERVACIONES?: string } = {
      CLIENTE_ID: defaultClienteId,
      PUNTO_VENTA_ID: defaultPvId,
      items,
      ES_CTA_CORRIENTE: parsedBody.metodoPago === 'CTA_CORRIENTE',
      COBRADA: parsedBody.metodoPago !== 'CTA_CORRIENTE',
      OBSERVACIONES: observaciones,
    };

    // Usuario "sistema" (id=0 → registrado como NULL en auditorías por el service)
    const usuarioId = req.external?.method === 'jwt' ? req.external.userId! : 0;

    const result: any = await salesService.create(ventaInput, usuarioId);

    res.status(201).json({
      status: 'created',
      ventaId: result?.VENTA_ID ?? result?.id ?? result,
      externalOrderId: parsedBody.externalOrderId,
    });
    await logInbound(req, 'order.received', 'SUCCESS', 201, Date.now() - started, {
      externalOrderId: parsedBody.externalOrderId,
      itemsCount: items.length,
    });
  } catch (err) {
    await logInbound(req, 'order.received', 'ERROR', 500, Date.now() - started, parsedBody, (err as Error).message);
    next(err);
  }
});

// ── POST /api/external/tienda-orders ───────────────────
//   Buzón de pedidos: persiste el pedido en TIENDA_ORDERS (estado=pendiente).
//   No crea Venta inmediatamente; el operador la procesa desde el panel.
//   Idempotente por (tiendaOrigen, externalOrderId).
//
//   Este es el contrato ESTÁNDAR para integrar cualquier tienda online
//   con RG WEB; ver docs/TIENDA_ORDERS_CONTRACT.md.
const tiendaOrderItemSchema = z.object({
  productoId: z.number().int().positive().optional(),
  sku: z.string().max(60).optional(),
  nombre: z.string().max(300).optional(),
  cantidad: z.number().positive(),
  precioUnitario: z.number().nonnegative(),
  descuento: z.number().min(0).max(100).optional(),
  subtotal: z.number().nonnegative().optional(),
});

const tiendaOrderSchema = z.object({
  externalOrderId: z.string().min(1).max(120),
  tiendaOrigen: z.string().min(1).max(60),
  fechaPedido: z.string().datetime().optional(),
  cliente: z
    .object({
      nombre: z.string().max(200).optional(),
      documento: z.string().max(50).optional(),
      tipoDocumento: z.string().max(20).optional(),
      email: z.string().email().max(200).optional(),
      telefono: z.string().max(50).optional(),
      direccion: z.string().max(500).optional(),
      localidad: z.string().max(120).optional(),
      provincia: z.string().max(120).optional(),
      cp: z.string().max(20).optional(),
    })
    .optional(),
  items: z.array(tiendaOrderItemSchema).min(1).max(200),
  pago: z
    .object({
      metodo: z.string().max(60).optional(),
      estado: z.string().max(30).optional(),
      referencia: z.string().max(200).optional(),
    })
    .optional(),
  envio: z
    .object({
      metodo: z.enum(['retiro', 'envio']).optional(),
      direccion: z.string().max(500).optional(),
      costo: z.number().nonnegative().optional(),
    })
    .optional(),
  totales: z
    .object({
      subtotal: z.number().nonnegative().optional(),
      descuentos: z.number().nonnegative().optional(),
      envio: z.number().nonnegative().optional(),
      total: z.number().nonnegative().optional(),
    })
    .optional(),
  observaciones: z.string().max(1000).optional(),
});

router.post('/tienda-orders', async (req: ExternalRequest, res: Response, next: NextFunction) => {
  const started = Date.now();
  let parsedBody: z.infer<typeof tiendaOrderSchema> | undefined;
  try {
    const parsed = tiendaOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
      await logInbound(req, 'tienda.order.received', 'ERROR', 400, Date.now() - started, req.body, message);
      res.status(400).json({ error: 'Datos inválidos', detalles: parsed.error.errors });
      return;
    }
    parsedBody = parsed.data;

    const result = await tiendaOrdersService.receiveOrder(parsedBody, req.external?.apiKeyId ?? null);

    res.status(result.duplicate ? 200 : 201).json({
      status: result.duplicate ? 'duplicate' : 'received',
      tiendaOrderId: result.tiendaOrderId,
      estado: result.estado,
    });
    await logInbound(
      req,
      'tienda.order.received',
      'SUCCESS',
      result.duplicate ? 200 : 201,
      Date.now() - started,
      {
        externalOrderId: parsedBody.externalOrderId,
        tiendaOrigen: parsedBody.tiendaOrigen,
        items: parsedBody.items.length,
        duplicate: result.duplicate,
      },
    );
  } catch (err) {
    await logInbound(req, 'tienda.order.received', 'ERROR', 500, Date.now() - started, parsedBody, (err as Error).message);
    next(err);
  }
});

export default router;
