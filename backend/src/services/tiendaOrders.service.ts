// ═══════════════════════════════════════════════════
//  Servicio: Pedidos de Tienda Online (Tienda Orders)
//
//  Encapsula:
//   • Recepción y persistencia de pedidos (api-key)
//   • Listado con filtros (panel admin)
//   • Conversión pedido → venta (reutiliza salesService.create)
//   • Emisión de factura (reutiliza facturacionService.emitirFactura)
//   • Cancelación con motivo
//   • Hook de envío de comprobante por email
//
//  Idempotencia: UNIQUE (TIENDA_ORIGEN, EXTERNAL_ORDER_ID)
// ═══════════════════════════════════════════════════

import { getPool, sql } from '../database/connection.js';
import { salesService, VentaInput, VentaItemInput } from './sales.service.js';
import { facturacionService } from './facturacion.service.js';
import { integracionesService } from './integraciones.service.js';
import type {
  TiendaOrder,
  TiendaOrderInput,
  TiendaOrderItem,
  TiendaOrderListFilters,
  TiendaOrderListResult,
  TiendaOrderWithItems,
  ProcesarOrderInput,
  ProcesarOrderResult,
  FacturarOrderResult,
} from '../types/tiendaOrders.js';

// ───────────────────────────── helpers ─────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nz<T>(v: T | undefined | null): T | null {
  return v === undefined ? null : v;
}

async function fetchOrderById(id: number): Promise<TiendaOrderWithItems | null> {
  const pool = await getPool();
  const head = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM TIENDA_ORDERS WHERE TIENDA_ORDER_ID = @id');

  if (head.recordset.length === 0) return null;

  const items = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM TIENDA_ORDERS_ITEMS WHERE TIENDA_ORDER_ID = @id ORDER BY ITEM_ID');

  return { ...(head.recordset[0] as TiendaOrder), items: items.recordset as TiendaOrderItem[] };
}

// ───────────────────────────── public API ──────────────────────────

export const tiendaOrdersService = {
  /**
   * Recibe un pedido desde la tienda online y lo persiste en estado=pendiente.
   * Idempotente por (tiendaOrigen, externalOrderId): si ya existe, devuelve el existente.
   */
  async receiveOrder(
    payload: TiendaOrderInput,
    apiKeyId: number | null,
  ): Promise<{ tiendaOrderId: number; estado: string; duplicate: boolean }> {
    const pool = await getPool();

    // Dedupe
    const dup = await pool.request()
      .input('ext', sql.NVarChar(120), payload.externalOrderId)
      .input('tienda', sql.NVarChar(60), payload.tiendaOrigen)
      .query(`SELECT TOP 1 TIENDA_ORDER_ID, ESTADO FROM TIENDA_ORDERS
              WHERE TIENDA_ORIGEN = @tienda AND EXTERNAL_ORDER_ID = @ext`);
    if (dup.recordset.length > 0) {
      return {
        tiendaOrderId: dup.recordset[0].TIENDA_ORDER_ID,
        estado: dup.recordset[0].ESTADO,
        duplicate: true,
      };
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      const cli = payload.cliente ?? {};
      const pago = payload.pago ?? {};
      const envio = payload.envio ?? {};
      const tot = payload.totales ?? {};

      const insertHead = await tx.request()
        .input('ext', sql.NVarChar(120), payload.externalOrderId)
        .input('tienda', sql.NVarChar(60), payload.tiendaOrigen)
        .input('fecha', sql.DateTime2, payload.fechaPedido ? new Date(payload.fechaPedido) : new Date())
        .input('nombre', sql.NVarChar(200), nz(cli.nombre))
        .input('doc', sql.NVarChar(50), nz(cli.documento))
        .input('tipoDoc', sql.NVarChar(20), nz(cli.tipoDocumento))
        .input('email', sql.NVarChar(200), nz(cli.email))
        .input('tel', sql.NVarChar(50), nz(cli.telefono))
        .input('dir', sql.NVarChar(500), nz(cli.direccion))
        .input('loc', sql.NVarChar(120), nz(cli.localidad))
        .input('prov', sql.NVarChar(120), nz(cli.provincia))
        .input('cp', sql.NVarChar(20), nz(cli.cp))
        .input('pagoMet', sql.NVarChar(60), nz(pago.metodo))
        .input('pagoEst', sql.NVarChar(30), nz(pago.estado))
        .input('pagoRef', sql.NVarChar(200), nz(pago.referencia))
        .input('envioMet', sql.NVarChar(30), nz(envio.metodo))
        .input('envioCosto', sql.Decimal(18, 2), envio.costo ?? null)
        .input('subtotal', sql.Decimal(18, 2), tot.subtotal ?? null)
        .input('descuentos', sql.Decimal(18, 2), tot.descuentos ?? null)
        .input('total', sql.Decimal(18, 2), tot.total ?? null)
        .input('obs', sql.NVarChar(1000), nz(payload.observaciones))
        .input('payload', sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .input('apiKey', sql.Int, apiKeyId)
        .query(`
          INSERT INTO TIENDA_ORDERS (
            EXTERNAL_ORDER_ID, TIENDA_ORIGEN, ESTADO, FECHA_PEDIDO,
            CLIENTE_NOMBRE, CLIENTE_DOCUMENTO, CLIENTE_TIPO_DOC,
            CLIENTE_EMAIL, CLIENTE_TELEFONO, CLIENTE_DIRECCION,
            CLIENTE_LOCALIDAD, CLIENTE_PROVINCIA, CLIENTE_CP,
            PAGO_METODO, PAGO_ESTADO, PAGO_REFERENCIA,
            ENVIO_METODO, ENVIO_COSTO,
            SUBTOTAL, DESCUENTOS, TOTAL,
            OBSERVACIONES, PAYLOAD_RAW, API_KEY_ID
          )
          OUTPUT INSERTED.TIENDA_ORDER_ID
          VALUES (
            @ext, @tienda, 'pendiente', @fecha,
            @nombre, @doc, @tipoDoc,
            @email, @tel, @dir,
            @loc, @prov, @cp,
            @pagoMet, @pagoEst, @pagoRef,
            @envioMet, @envioCosto,
            @subtotal, @descuentos, @total,
            @obs, @payload, @apiKey
          );
        `);

      const tiendaOrderId: number = insertHead.recordset[0].TIENDA_ORDER_ID;

      for (const it of payload.items) {
        const cantidad = Number(it.cantidad);
        const precio = Number(it.precioUnitario);
        const desc = Number(it.descuento ?? 0);
        const subtotal = r2(cantidad * precio * (1 - desc / 100));
        await tx.request()
          .input('order', sql.Int, tiendaOrderId)
          .input('pid', sql.Int, it.productoId ?? null)
          .input('sku', sql.NVarChar(60), nz(it.sku))
          .input('nombre', sql.NVarChar(300), nz(it.nombre))
          .input('cantidad', sql.Decimal(18, 3), cantidad)
          .input('precio', sql.Decimal(18, 2), precio)
          .input('desc', sql.Decimal(5, 2), desc)
          .input('sub', sql.Decimal(18, 2), subtotal)
          .query(`
            INSERT INTO TIENDA_ORDERS_ITEMS
              (TIENDA_ORDER_ID, PRODUCTO_ID, SKU, NOMBRE, CANTIDAD, PRECIO_UNITARIO, DESCUENTO, SUBTOTAL)
            VALUES (@order, @pid, @sku, @nombre, @cantidad, @precio, @desc, @sub);
          `);
      }

      await tx.commit();
      return { tiendaOrderId, estado: 'pendiente', duplicate: false };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  /**
   * Lista pedidos para el panel admin.
   */
  async list(filters: TiendaOrderListFilters = {}): Promise<TiendaOrderListResult> {
    const pool = await getPool();
    const where: string[] = [];
    const req = pool.request();

    if (filters.estado && filters.estado !== 'todos') {
      where.push('ESTADO = @estado');
      req.input('estado', sql.NVarChar(20), filters.estado);
    }
    if (filters.tienda) {
      where.push('TIENDA_ORIGEN = @tienda');
      req.input('tienda', sql.NVarChar(60), filters.tienda);
    }
    if (filters.search) {
      where.push('(EXTERNAL_ORDER_ID LIKE @q OR CLIENTE_NOMBRE LIKE @q OR CLIENTE_EMAIL LIKE @q)');
      req.input('q', sql.NVarChar(200), `%${filters.search}%`);
    }
    if (filters.desde) {
      where.push('CREATED_AT >= @desde');
      req.input('desde', sql.DateTime2, new Date(filters.desde));
    }
    if (filters.hasta) {
      where.push('CREATED_AT <= @hasta');
      req.input('hasta', sql.DateTime2, new Date(filters.hasta));
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = Math.max(filters.offset ?? 0, 0);

    // Una sola query devuelve la página + el total (ventana COUNT(*) OVER()).
    const result = await req.query(`
      SELECT *, COUNT(*) OVER() AS _TOTAL
      FROM TIENDA_ORDERS
      ${whereSql}
      ORDER BY CREATED_AT DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;
    `);

    const rows = result.recordset as Array<TiendaOrder & { _TOTAL: number }>;
    const total = rows.length > 0 ? Number(rows[0]._TOTAL) : 0;
    const items: TiendaOrder[] = rows.map(({ _TOTAL, ...rest }) => rest as TiendaOrder);
    return { items, total };
  },

  /**
   * Devuelve cabecera + items.
   */
  async getById(id: number): Promise<TiendaOrderWithItems | null> {
    return fetchOrderById(id);
  },

  /**
   * Convierte un pedido pendiente en VENTA usando salesService.create.
   * Permite override del operador (cliente, punto de venta, ajustes de items).
   */
  async procesar(
    tiendaOrderId: number,
    usuarioId: number,
    input: ProcesarOrderInput = {},
  ): Promise<ProcesarOrderResult> {
    const order = await fetchOrderById(tiendaOrderId);
    if (!order) {
      throw Object.assign(new Error('Pedido no encontrado'), { name: 'ValidationError' });
    }
    if (order.ESTADO !== 'pendiente') {
      throw Object.assign(
        new Error(`El pedido ya está en estado "${order.ESTADO}"; solo se procesan los pendientes.`),
        { name: 'ValidationError' },
      );
    }

    const config = await integracionesService.getConfig();
    const clienteId = input.clienteId ?? config.orders_default_cliente_id;
    const puntoVentaId = input.puntoVentaId ?? config.orders_default_punto_venta_id;

    if (!clienteId || !puntoVentaId) {
      throw Object.assign(
        new Error('Faltan defaults de cliente y/o punto de venta. Configurelos en Integraciones o pase clienteId/puntoVentaId.'),
        { name: 'ValidationError' },
      );
    }

    // Items: usar override si vino; si no, los del pedido (con productoId resuelto)
    const sourceItems = input.itemsOverride
      ? input.itemsOverride.map(i => ({
          PRODUCTO_ID: i.productoId,
          CANTIDAD: i.cantidad,
          PRECIO_UNITARIO: i.precioUnitario ?? 0,
          DESCUENTO: i.descuento ?? 0,
        }))
      : order.items
          .filter(i => i.PRODUCTO_ID != null)
          .map(i => ({
            PRODUCTO_ID: i.PRODUCTO_ID as number,
            CANTIDAD: Number(i.CANTIDAD),
            PRECIO_UNITARIO: Number(i.PRECIO_UNITARIO),
            DESCUENTO: Number(i.DESCUENTO),
          }));

    if (sourceItems.length === 0) {
      throw Object.assign(
        new Error('El pedido no contiene items con productoId resoluble. Vinculá los productos antes de procesar.'),
        { name: 'ValidationError' },
      );
    }

    // Resolver PRECIO_COMPRA de cada producto en una sola query
    const pool = await getPool();
    const reqDb = pool.request();
    const ids = sourceItems.map(i => i.PRODUCTO_ID);
    ids.forEach((id, i) => reqDb.input(`p${i}`, sql.Int, id));
    const prodResult = await reqDb.query(`
      SELECT PRODUCTO_ID, ISNULL(PRECIO_COMPRA, 0) AS PRECIO_COMPRA
      FROM PRODUCTOS WHERE PRODUCTO_ID IN (${ids.map((_, i) => `@p${i}`).join(',')})
    `);
    const costMap = new Map<number, number>();
    for (const r of prodResult.recordset) costMap.set(r.PRODUCTO_ID, Number(r.PRECIO_COMPRA));

    const items: VentaItemInput[] = sourceItems.map(i => ({
      PRODUCTO_ID: i.PRODUCTO_ID,
      CANTIDAD: i.CANTIDAD,
      PRECIO_UNITARIO: i.PRECIO_UNITARIO,
      DESCUENTO: i.DESCUENTO,
      PRECIO_COMPRA: costMap.get(i.PRODUCTO_ID) ?? 0,
    }));

    const metodoPago = input.metodoPago ?? 'EFECTIVO';
    const obsTag = `[TIENDA:${order.TIENDA_ORIGEN}#${order.EXTERNAL_ORDER_ID}]`;
    const observaciones = order.OBSERVACIONES ? `${obsTag} ${order.OBSERVACIONES}` : obsTag;

    const ventaInput: VentaInput & { OBSERVACIONES?: string } = {
      CLIENTE_ID: clienteId,
      PUNTO_VENTA_ID: puntoVentaId,
      items,
      ES_CTA_CORRIENTE: metodoPago === 'CTA_CORRIENTE',
      COBRADA: metodoPago !== 'CTA_CORRIENTE',
      OBSERVACIONES: observaciones,
      CLIENT_REQUEST_ID: `tienda-order-${tiendaOrderId}`,
    } as VentaInput;

    const venta = await salesService.create(ventaInput, usuarioId);
    const ventaId: number = (venta as { VENTA_ID: number }).VENTA_ID;

    await pool.request()
      .input('id', sql.Int, tiendaOrderId)
      .input('venta', sql.Int, ventaId)
      .input('cli', sql.Int, clienteId)
      .input('user', sql.Int, usuarioId || null)
      .query(`
        UPDATE TIENDA_ORDERS
        SET ESTADO = 'procesado',
            VENTA_ID = @venta,
            CLIENTE_ID = @cli,
            PROCESADO_AT = SYSDATETIME(),
            PROCESADO_POR = @user
        WHERE TIENDA_ORDER_ID = @id;
      `);

    return { ventaId, tiendaOrderId, estado: 'procesado' };
  },

  /**
   * Emite factura electrónica para la venta vinculada al pedido y registra
   * los datos del comprobante. Opcionalmente dispara envío de email.
   */
  async facturar(tiendaOrderId: number, usuarioId: number): Promise<FacturarOrderResult> {
    const order = await fetchOrderById(tiendaOrderId);
    if (!order) {
      throw Object.assign(new Error('Pedido no encontrado'), { name: 'ValidationError' });
    }
    if (!order.VENTA_ID) {
      throw Object.assign(
        new Error('El pedido aún no fue convertido en venta. Procesalo primero.'),
        { name: 'ValidationError' },
      );
    }
    if (order.FACTURADO) {
      throw Object.assign(
        new Error(`El pedido ya fue facturado (CAE ${order.CAE ?? '?'}).`),
        { name: 'ValidationError' },
      );
    }

    const fe = await facturacionService.emitirFactura(order.VENTA_ID);

    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, tiendaOrderId)
      .input('cae', sql.NVarChar(20), fe.cae)
      .input('numero', sql.NVarChar(50), fe.comprobante_nro)
      .input('user', sql.Int, usuarioId || null)
      .query(`
        UPDATE TIENDA_ORDERS
        SET ESTADO = 'facturado',
            FACTURADO = 1,
            CAE = @cae,
            COMPROBANTE_NUMERO = @numero,
            FACTURADO_AT = SYSDATETIME(),
            FACTURADO_POR = @user
        WHERE TIENDA_ORDER_ID = @id;
      `);

    // Envío de comprobante por mail (gancho — actualmente best-effort/logging).
    let emailEnviado = false;
    const destinatario = order.CLIENTE_EMAIL || null;
    if (destinatario) {
      try {
        await sendComprobanteEmail({
          to: destinatario,
          tiendaOrderId,
          ventaId: order.VENTA_ID,
          cae: fe.cae,
          comprobanteNumero: fe.comprobante_nro,
          tipoComprobante: fe.tipo_comprobante,
        });
        await pool.request()
          .input('id', sql.Int, tiendaOrderId)
          .query('UPDATE TIENDA_ORDERS SET EMAIL_ENVIADO_AT = SYSDATETIME() WHERE TIENDA_ORDER_ID = @id;');
        emailEnviado = true;
      } catch (mailErr) {
        // No bloqueamos la facturación si falla el mail; queda registrado en logs.
        await integracionesService.log({
          eventType: 'tienda.email.comprobante',
          direction: 'OUTBOUND',
          status: 'ERROR',
          targetUrl: destinatario,
          errorMessage: (mailErr as Error).message,
        });
      }
    }

    return {
      tiendaOrderId,
      ventaId: order.VENTA_ID,
      cae: fe.cae,
      caeVto: fe.cae_vto,
      comprobanteNumero: fe.comprobante_nro,
      tipoComprobante: fe.tipo_comprobante,
      emailEnviado,
      emailDestinatario: destinatario,
    };
  },

  /**
   * Cancela un pedido (solo si está pendiente o procesado-no-facturado).
   */
  async cancelar(tiendaOrderId: number, usuarioId: number, motivo: string): Promise<void> {
    const order = await fetchOrderById(tiendaOrderId);
    if (!order) {
      throw Object.assign(new Error('Pedido no encontrado'), { name: 'ValidationError' });
    }
    if (order.ESTADO === 'cancelado') return;
    if (order.ESTADO === 'facturado') {
      throw Object.assign(
        new Error('No se puede cancelar un pedido ya facturado. Emití una nota de crédito.'),
        { name: 'ValidationError' },
      );
    }

    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, tiendaOrderId)
      .input('motivo', sql.NVarChar(500), motivo ?? null)
      .input('user', sql.Int, usuarioId || null)
      .query(`
        UPDATE TIENDA_ORDERS
        SET ESTADO = 'cancelado',
            CANCELADO_AT = SYSDATETIME(),
            CANCELADO_POR = @user,
            CANCELACION_MOTIVO = @motivo
        WHERE TIENDA_ORDER_ID = @id;
      `);
  },

  /**
   * Reenvío manual del comprobante por email (útil cuando falla el automático).
   */
  async reenviarComprobante(tiendaOrderId: number, emailOverride?: string): Promise<void> {
    const order = await fetchOrderById(tiendaOrderId);
    if (!order) throw Object.assign(new Error('Pedido no encontrado'), { name: 'ValidationError' });
    if (!order.FACTURADO || !order.CAE) {
      throw Object.assign(new Error('El pedido no tiene comprobante emitido.'), { name: 'ValidationError' });
    }
    const to = emailOverride || order.CLIENTE_EMAIL;
    if (!to) throw Object.assign(new Error('No hay email destinatario.'), { name: 'ValidationError' });

    await sendComprobanteEmail({
      to,
      tiendaOrderId,
      ventaId: order.VENTA_ID!,
      cae: order.CAE!,
      comprobanteNumero: order.COMPROBANTE_NUMERO ?? '',
      tipoComprobante: '',
    });

    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, tiendaOrderId)
      .query('UPDATE TIENDA_ORDERS SET EMAIL_ENVIADO_AT = SYSDATETIME() WHERE TIENDA_ORDER_ID = @id;');
  },

  /**
   * Contadores rápidos para badges del menú.
   */
  async getCounts(): Promise<{ pendientes: number; procesados: number; facturados: number; cancelados: number }> {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT ESTADO, COUNT(*) AS C
      FROM TIENDA_ORDERS
      GROUP BY ESTADO;
    `);
    const out = { pendientes: 0, procesados: 0, facturados: 0, cancelados: 0 };
    for (const row of r.recordset) {
      const k = String(row.ESTADO);
      if (k === 'pendiente') out.pendientes = row.C;
      else if (k === 'procesado') out.procesados = row.C;
      else if (k === 'facturado') out.facturados = row.C;
      else if (k === 'cancelado') out.cancelados = row.C;
    }
    return out;
  },
};

// ───────────────────────── Email gancho ─────────────────────────
// Implementación stub: registra en INTEGRACIONES_SYNC_LOGS.
// TODO: cuando se incorpore nodemailer / proveedor SMTP, reemplazar
// este cuerpo por el envío real (con PDF adjunto si aplica).
async function sendComprobanteEmail(params: {
  to: string;
  tiendaOrderId: number;
  ventaId: number;
  cae: string;
  comprobanteNumero: string;
  tipoComprobante: string;
}): Promise<void> {
  await integracionesService.log({
    eventType: 'tienda.email.comprobante',
    direction: 'OUTBOUND',
    status: 'SUCCESS',
    targetUrl: params.to,
    requestBody: {
      tiendaOrderId: params.tiendaOrderId,
      ventaId: params.ventaId,
      cae: params.cae,
      comprobanteNumero: params.comprobanteNumero,
      tipoComprobante: params.tipoComprobante,
    },
    responseBody: 'stub:not-sent',
  });
  // No-op: el método real debe integrarse con el proveedor SMTP del proyecto.
}
