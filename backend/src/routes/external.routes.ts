import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { externalAuthMiddleware, ExternalRequest } from '../middleware/externalAuth.js';
import { integracionesService } from '../services/integraciones.service.js';
import { salesService, VentaInput, VentaItemInput } from '../services/sales.service.js';
import { tiendaOrdersService } from '../services/tiendaOrders.service.js';
import {
  TIPOS_DOCUMENTO_AR,
  CONDICIONES_IVA_AR,
  METODOS_PAGO,
  ESTADOS_PAGO,
  METODOS_ENVIO,
  MONEDAS,
} from '../types/tiendaOrders.js';
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
//   con stock consolidado y el precio de la lista por defecto.
router.get('/sync-stock', async (req: ExternalRequest, res: Response, next: NextFunction) => {
  const started = Date.now();
  try {
    const items = await integracionesService.getStockParaTienda({ incluirNombre: true });
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

    // Resolver precios faltantes leyendo la lista por defecto desde DB
    const prodIds = parsedBody.items.map((i) => i.productoId);
    const reqDb = pool.request();
    prodIds.forEach((id, i) => reqDb.input(`p${i}`, sql.Int, id));
    const prodResult = await reqDb.query(`
      SELECT PRODUCTO_ID,
             ISNULL((SELECT TOP 1 plp.PRECIO FROM PRODUCTO_LISTA_PRECIOS plp WHERE plp.PRODUCTO_ID = PRODUCTOS.PRODUCTO_ID AND plp.LISTA_ID = ISNULL(LISTA_DEFECTO, 1)), 0) AS PRECIO,
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
//   Buzón estándar de pedidos de tienda online. Persiste el pedido en
//   TIENDA_ORDERS con estado PENDIENTE; no crea Venta inmediatamente
//   (eso lo hace el operador desde el panel admin).
//
//   Seguridad: x-api-key validado por `externalAuthMiddleware`
//   (bcrypt en INTEGRACIONES_API_KEYS, scopes y rate-limit incluidos).
//   El valor "config simple" `tienda_orders_api_key` de INTEGRACIONES_CONFIG
//   queda disponible como fallback heredado para integraciones legacy.
//
//   Idempotencia: clave única (tiendaOrigen, externalOrderId).
//     · 201 Created  + status='RECEIVED'  → primer ingreso
//     · 200 OK       + status='DUPLICATE' → ya existía (devuelve el actual)
//
//   Contrato completo: docs/TIENDA_ORDERS_CONTRACT.md

const tiendaOrderItemSchema = z
  .object({
    productoId: z.number().int().positive().optional(),
    sku: z.string().min(1).max(60).optional(),
    nombre: z.string().max(300).optional(),
    cantidad: z.number().positive(),
    precioUnitario: z.number().nonnegative(),
    descuento: z.number().min(0).max(100).optional(),
    ivaAlicuota: z.number().min(0).max(100).optional(),
    subtotal: z.number().nonnegative().optional(),
  })
  .refine((it) => it.productoId !== undefined || (it.sku && it.sku.length > 0), {
    message: 'Cada ítem requiere productoId o sku',
  });

const tiendaOrderSchema = z
  .object({
    externalOrderId: z.string().trim().min(1).max(120),
    tiendaOrigen: z.string().trim().min(1).max(60),
    fechaPedido: z.string().datetime({ offset: true }).optional(),
    moneda: z.enum(MONEDAS).optional(),
    cliente: z
      .object({
        nombre: z.string().max(200).optional(),
        tipoDocumento: z.enum(TIPOS_DOCUMENTO_AR).optional(),
        documento: z.string().max(20).regex(/^[A-Za-z0-9]*$/, 'Documento sin separadores').optional(),
        condicionIva: z.enum(CONDICIONES_IVA_AR).optional(),
        email: z.string().email().max(200).optional(),
        telefono: z.string().max(50).optional(),
        direccion: z.string().max(500).optional(),
        localidad: z.string().max(120).optional(),
        provincia: z.string().max(120).optional(),
        cp: z.string().max(20).optional(),
        pais: z.string().length(2).optional(),
      })
      .strict()
      .optional(),
    items: z.array(tiendaOrderItemSchema).min(1).max(200),
    pago: z
      .object({
        metodo: z.enum(METODOS_PAGO).optional(),
        estado: z.enum(ESTADOS_PAGO).optional(),
        referencia: z.string().max(200).optional(),
        fechaAprobacion: z.string().datetime({ offset: true }).optional(),
      })
      .strict()
      .optional(),
    envio: z
      .object({
        metodo: z.enum(METODOS_ENVIO).optional(),
        direccion: z.string().max(500).optional(),
        transporte: z.string().max(80).optional(),
        tracking: z.string().max(120).optional(),
      })
      .strict()
      .optional(),
    totales: z
      .object({
        subtotal: z.number().nonnegative().optional(),
        descuentos: z.number().nonnegative().optional(),
        costoEnvio: z.number().nonnegative().optional(),
        ivaTotal: z.number().nonnegative().optional(),
        total: z.number().nonnegative().optional(),
      })
      .strict()
      .optional(),
    observaciones: z.string().max(1000).optional(),
  })
  .strict();

router.post('/tienda-orders', async (req: ExternalRequest, res: Response, next: NextFunction) => {
  const started = Date.now();
  let parsedBody: z.infer<typeof tiendaOrderSchema> | undefined;
  try {
    const parsed = tiendaOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      const detalles = parsed.error.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      const summary = detalles.map((d) => `${d.path}: ${d.message}`).join('; ');
      await logInbound(req, 'tienda.order.received', 'ERROR', 400, Date.now() - started, req.body, summary);
      res.status(400).json({
        status: 'INVALID',
        error: 'Datos inválidos',
        detalles,
      });
      return;
    }
    parsedBody = parsed.data;

    const result = await tiendaOrdersService.receiveOrder(parsedBody, req.external?.apiKeyId ?? null);

    const isDuplicate = result.status === 'DUPLICATE';
    const httpStatus = isDuplicate ? 200 : 201;

    res.status(httpStatus).json({
      status: result.status,
      tiendaOrderId: result.tiendaOrderId,
      estado: result.estado,
    });

    await logInbound(req, 'tienda.order.received', 'SUCCESS', httpStatus, Date.now() - started, {
      externalOrderId: parsedBody.externalOrderId,
      tiendaOrigen: parsedBody.tiendaOrigen,
      itemsCount: parsedBody.items.length,
      total: parsedBody.totales?.total ?? null,
      status: result.status,
      tiendaOrderId: result.tiendaOrderId,
    });
  } catch (err) {
    const e = err as Error & { name?: string };
    const isValidation = e.name === 'ValidationError';
    const status = isValidation ? 422 : 500;
    await logInbound(req, 'tienda.order.received', 'ERROR', status, Date.now() - started, parsedBody, e.message);
    if (isValidation) {
      res.status(status).json({ status: 'ERROR', error: e.message });
      return;
    }
    next(err);
  }
});

export default router;
