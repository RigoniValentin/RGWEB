// ════════════════════════════════════════════════════
//  Servicio — Pedidos de Tienda Online (Tienda Orders)
//
//  Reglas:
//   • Estados en MAYÚSCULAS (PENDIENTE/PROCESADO/FACTURADO/CANCELADO)
//     alineados con el CHECK constraint en TIENDA_ORDERS.
//   • Idempotencia: UNIQUE (TIENDA_ORIGEN, EXTERNAL_ORDER_ID).
//     - Si el pedido ya existe, devolvemos el existente (status=DUPLICATE).
//     - Si dos requests entran simultáneamente, capturamos la violación
//       UNIQUE (error 2627 / 2601 de SQL Server) y devolvemos el existente.
//   • Transacción explícita para insertar cabecera + items.
// ════════════════════════════════════════════════════

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
  TiendaOrderReceiveResult,
  TiendaOrderCounts,
} from '../types/tiendaOrders.js';

// ───────────────────────── helpers ─────────────────────────

const r2 = (n: number): number => Math.round(n * 100) / 100;
const nz = <T>(v: T | undefined | null): T | null => (v === undefined || v === null ? null : v);

const isUniqueViolation = (err: unknown): boolean => {
  const code = (err as { number?: number; code?: string })?.number;
  // 2627 = PK / UNIQUE constraint violation; 2601 = unique index duplicate.
  return code === 2627 || code === 2601;
};

async function fetchOrderById(id: number): Promise<TiendaOrderWithItems | null> {
  const pool = await getPool();
  const head = await pool.request()
    .input('id', sql.Int, id)
    .query('SELECT * FROM TIENDA_ORDERS WHERE TIENDA_ORDER_ID = @id');
  if (head.recordset.length === 0) return null;

  const items = await pool.request()
    .input('id', sql.Int, id)
    .query(`
      SELECT * FROM TIENDA_ORDERS_ITEMS
      WHERE TIENDA_ORDER_ID = @id
      ORDER BY LINEA, ITEM_ID
    `);

  return {
    ...(head.recordset[0] as TiendaOrder),
    items: items.recordset as TiendaOrderItem[],
  };
}

async function findExisting(
  tiendaOrigen: string,
  externalOrderId: string,
): Promise<TiendaOrder | null> {
  const pool = await getPool();
  const r = await pool.request()
    .input('tienda', sql.NVarChar(60), tiendaOrigen)
    .input('ext', sql.NVarChar(120), externalOrderId)
    .query(`
      SELECT TOP 1 *
      FROM TIENDA_ORDERS
      WHERE TIENDA_ORIGEN = @tienda AND EXTERNAL_ORDER_ID = @ext
    `);
  return r.recordset.length > 0 ? (r.recordset[0] as TiendaOrder) : null;
}

async function getCajaAbierta(pool: any, usuarioId: number): Promise<{ CAJA_ID: number } | null> {
  const result = await pool.request()
    .input('uid', sql.Int, usuarioId)
    .query(`SELECT CAJA_ID FROM CAJA WHERE USUARIO_ID = @uid AND ESTADO = 'ACTIVA'`);
  return result.recordset.length > 0 ? result.recordset[0] : null;
}

// ───────────────────────── public API ──────────────────────

export const tiendaOrdersService = {
  /**
   * Recibe un pedido desde la tienda online y lo persiste en estado PENDIENTE.
   * Idempotente: si ya existe (mismo TIENDA_ORIGEN + EXTERNAL_ORDER_ID) devuelve
   * el existente con status='DUPLICATE'.
   */
  async receiveOrder(
    payload: TiendaOrderInput,
    apiKeyId: number | null,
  ): Promise<TiendaOrderReceiveResult> {
    // 1. Check explícito para minimizar costo cuando es duplicado claro
    const existing = await findExisting(payload.tiendaOrigen, payload.externalOrderId);
    if (existing) {
      return {
        status: 'DUPLICATE',
        tiendaOrderId: existing.TIENDA_ORDER_ID,
        estado: existing.ESTADO,
      };
    }

    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      const cli = payload.cliente ?? {};
      const pago = payload.pago ?? {};
      const envio = payload.envio ?? {};
      const tot = payload.totales ?? {};

      const headReq = tx.request()
        .input('tienda',      sql.NVarChar(60),  payload.tiendaOrigen)
        .input('ext',         sql.NVarChar(120), payload.externalOrderId)
        .input('fecha',       sql.DateTime2,     payload.fechaPedido ? new Date(payload.fechaPedido) : new Date())
        .input('cliNombre',   sql.NVarChar(200), nz(cli.nombre))
        .input('cliTipoDoc',  sql.NVarChar(10),  nz(cli.tipoDocumento))
        .input('cliDoc',      sql.NVarChar(20),  nz(cli.documento))
        .input('cliCondIva',  sql.NVarChar(40),  nz(cli.condicionIva))
        .input('cliEmail',    sql.NVarChar(200), nz(cli.email))
        .input('cliTel',      sql.NVarChar(50),  nz(cli.telefono))
        .input('cliDir',      sql.NVarChar(500), nz(cli.direccion))
        .input('cliLoc',      sql.NVarChar(120), nz(cli.localidad))
        .input('cliProv',     sql.NVarChar(120), nz(cli.provincia))
        .input('cliCp',       sql.NVarChar(20),  nz(cli.cp))
        .input('cliPais',     sql.NVarChar(60),  cli.pais ?? 'AR')
        .input('pagoMet',     sql.NVarChar(60),  nz(pago.metodo))
        .input('pagoEst',     sql.NVarChar(30),  nz(pago.estado))
        .input('pagoRef',     sql.NVarChar(200), nz(pago.referencia))
        .input('pagoFecha',   sql.DateTime2,     pago.fechaAprobacion ? new Date(pago.fechaAprobacion) : null)
        .input('envioMet',    sql.NVarChar(30),  nz(envio.metodo))
        .input('envioTrans',  sql.NVarChar(80),  nz(envio.transporte))
        .input('envioTrack',  sql.NVarChar(120), nz(envio.tracking))
        .input('subtotal',    sql.Decimal(18, 2), tot.subtotal ?? null)
        .input('descuentos',  sql.Decimal(18, 2), tot.descuentos ?? null)
        .input('costoEnvio',  sql.Decimal(18, 2), tot.costoEnvio ?? null)
        .input('ivaTotal',    sql.Decimal(18, 2), tot.ivaTotal ?? null)
        .input('total',       sql.Decimal(18, 2), tot.total ?? null)
        .input('moneda',      sql.NVarChar(3),   payload.moneda ?? 'ARS')
        .input('obs',         sql.NVarChar(1000), nz(payload.observaciones))
        .input('payload',     sql.NVarChar(sql.MAX), JSON.stringify(payload))
        .input('apiKey',      sql.Int,           apiKeyId);

      const insertRes = await headReq.query(`
        INSERT INTO TIENDA_ORDERS (
          TIENDA_ORIGEN, EXTERNAL_ORDER_ID, ESTADO, FECHA_PEDIDO,
          CLIENTE_NOMBRE, CLIENTE_TIPO_DOC, CLIENTE_DOCUMENTO, CLIENTE_CONDICION_IVA,
          CLIENTE_EMAIL, CLIENTE_TELEFONO, CLIENTE_DIRECCION,
          CLIENTE_LOCALIDAD, CLIENTE_PROVINCIA, CLIENTE_CP, CLIENTE_PAIS,
          PAGO_METODO, PAGO_ESTADO, PAGO_REFERENCIA, PAGO_FECHA_APROB,
          ENVIO_METODO, ENVIO_TRANSPORTE, ENVIO_TRACKING,
          SUBTOTAL, DESCUENTOS, COSTO_ENVIO, IVA_TOTAL, TOTAL, MONEDA,
          OBSERVACIONES, PAYLOAD_RAW, API_KEY_ID
        )
        OUTPUT INSERTED.TIENDA_ORDER_ID
        VALUES (
          @tienda, @ext, 'PENDIENTE', @fecha,
          @cliNombre, @cliTipoDoc, @cliDoc, @cliCondIva,
          @cliEmail, @cliTel, @cliDir,
          @cliLoc, @cliProv, @cliCp, @cliPais,
          @pagoMet, @pagoEst, @pagoRef, @pagoFecha,
          @envioMet, @envioTrans, @envioTrack,
          @subtotal, @descuentos, @costoEnvio, @ivaTotal, @total, @moneda,
          @obs, @payload, @apiKey
        );
      `);

      const tiendaOrderId: number = insertRes.recordset[0].TIENDA_ORDER_ID;

      // Items
      let linea = 1;
      for (const it of payload.items) {
        const cantidad = Number(it.cantidad);
        const precio = Number(it.precioUnitario);
        const desc = Number(it.descuento ?? 0);
        const subtotalLinea =
          it.subtotal != null ? r2(Number(it.subtotal)) : r2(cantidad * precio * (1 - desc / 100));

        await tx.request()
          .input('order',    sql.Int,            tiendaOrderId)
          .input('linea',    sql.Int,            linea)
          .input('pid',      sql.Int,            it.productoId ?? null)
          .input('sku',      sql.NVarChar(60),   nz(it.sku))
          .input('nombre',   sql.NVarChar(300),  nz(it.nombre))
          .input('cant',     sql.Decimal(18, 3), cantidad)
          .input('precio',   sql.Decimal(18, 2), r2(precio))
          .input('desc',     sql.Decimal(5, 2),  r2(desc))
          .input('iva',      sql.Decimal(5, 2),  it.ivaAlicuota ?? null)
          .input('sub',      sql.Decimal(18, 2), subtotalLinea)
          .query(`
            INSERT INTO TIENDA_ORDERS_ITEMS (
              TIENDA_ORDER_ID, LINEA, PRODUCTO_ID, SKU, NOMBRE,
              CANTIDAD, PRECIO_UNITARIO, DESCUENTO_PORC, IVA_ALICUOTA, SUBTOTAL
            )
            VALUES (
              @order, @linea, @pid, @sku, @nombre,
              @cant, @precio, @desc, @iva, @sub
            );
          `);
        linea += 1;
      }

      await tx.commit();
      return { status: 'RECEIVED', tiendaOrderId, estado: 'PENDIENTE' };
    } catch (err) {
      try { await tx.rollback(); } catch { /* noop */ }

      // Race condition: dos requests entraron a la vez con el mismo (tienda, ext).
      if (isUniqueViolation(err)) {
        const exists = await findExisting(payload.tiendaOrigen, payload.externalOrderId);
        if (exists) {
          return {
            status: 'DUPLICATE',
            tiendaOrderId: exists.TIENDA_ORDER_ID,
            estado: exists.ESTADO,
          };
        }
      }
      throw err;
    }
  },

  async list(filters: TiendaOrderListFilters = {}): Promise<TiendaOrderListResult> {
    const pool = await getPool();
    const where: string[] = [];
    const req = pool.request();

    if (filters.estado && filters.estado !== 'TODOS') {
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

  getById(id: number): Promise<TiendaOrderWithItems | null> {
    return fetchOrderById(id);
  },

  async procesar(
    tiendaOrderId: number,
    usuarioId: number,
    input: ProcesarOrderInput = {},
  ): Promise<ProcesarOrderResult> {
    const order = await fetchOrderById(tiendaOrderId);
    if (!order) {
      throw Object.assign(new Error('Pedido no encontrado'), { name: 'ValidationError' });
    }
    if (order.ESTADO !== 'PENDIENTE') {
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
        new Error(
          'Faltan defaults de cliente y/o punto de venta. Configurelos en Integraciones o pase clienteId/puntoVentaId.',
        ),
        { name: 'ValidationError' },
      );
    }

    const sourceItems = input.itemsOverride
      ? input.itemsOverride.map((i) => ({
          PRODUCTO_ID: i.productoId,
          CANTIDAD: i.cantidad,
          PRECIO_UNITARIO: i.precioUnitario ?? 0,
          DESCUENTO: i.descuento ?? 0,
          DEPOSITO_ID: input.depositoId ?? undefined,
        }))
      : order.items
          .filter((i) => i.PRODUCTO_ID != null)
          .map((i) => ({
            PRODUCTO_ID: i.PRODUCTO_ID as number,
            CANTIDAD: Number(i.CANTIDAD),
            PRECIO_UNITARIO: Number(i.PRECIO_UNITARIO),
            DESCUENTO: Number(i.DESCUENTO_PORC),
            DEPOSITO_ID: input.depositoId ?? undefined,
          }));

    if (sourceItems.length === 0) {
      throw Object.assign(
        new Error('El pedido no contiene items con productoId resoluble. Vinculá los productos antes de procesar.'),
        { name: 'ValidationError' },
      );
    }

    const pool = await getPool();
    const reqDb = pool.request();
    const ids = sourceItems.map((i) => i.PRODUCTO_ID);
    ids.forEach((id, i) => reqDb.input(`p${i}`, sql.Int, id));
    const prodResult = await reqDb.query(`
      SELECT PRODUCTO_ID, ISNULL(PRECIO_COMPRA, 0) AS PRECIO_COMPRA
      FROM PRODUCTOS WHERE PRODUCTO_ID IN (${ids.map((_, i) => `@p${i}`).join(',')})
    `);
    const costMap = new Map<number, number>();
    for (const r of prodResult.recordset) costMap.set(r.PRODUCTO_ID, Number(r.PRECIO_COMPRA));

    const items: VentaItemInput[] = sourceItems.map((i) => ({
      PRODUCTO_ID: i.PRODUCTO_ID,
      CANTIDAD: i.CANTIDAD,
      PRECIO_UNITARIO: i.PRECIO_UNITARIO,
      DESCUENTO: i.DESCUENTO,
      PRECIO_COMPRA: costMap.get(i.PRODUCTO_ID) ?? 0,
      DEPOSITO_ID: i.DEPOSITO_ID,
    }));

    const totalVenta = order.TOTAL != null
      ? Number(order.TOTAL)
      : items.reduce((sum, item) => sum + item.PRECIO_UNITARIO * item.CANTIDAD * (1 - item.DESCUENTO / 100), 0);

    const caja = await getCajaAbierta(pool, usuarioId);
    if (!caja) {
      throw Object.assign(new Error('No hay caja abierta. Abra una caja antes de procesar el pedido.'), { name: 'ValidationError' });
    }

    const obsTag = `[TIENDA:${order.TIENDA_ORIGEN}#${order.EXTERNAL_ORDER_ID}]`;
    const observaciones = order.OBSERVACIONES ? `${obsTag} ${order.OBSERVACIONES}` : obsTag;

    const usaBreakdownPago = !!(input.metodos_pago && input.metodos_pago.length > 0);
    const metodoPago = input.metodoPago ?? 'EFECTIVO';

    const ventaInput: VentaInput & { OBSERVACIONES?: string } = {
      CLIENTE_ID: clienteId,
      PUNTO_VENTA_ID: puntoVentaId,
      items,
      ES_CTA_CORRIENTE: usaBreakdownPago ? false : metodoPago === 'CTA_CORRIENTE',
      COBRADA: usaBreakdownPago ? true : metodoPago !== 'CTA_CORRIENTE',
      MONTO_EFECTIVO: usaBreakdownPago ? 0 : (metodoPago === 'EFECTIVO' ? totalVenta : 0),
      MONTO_DIGITAL: usaBreakdownPago ? 0 : (metodoPago === 'DIGITAL' ? totalVenta : 0),
      OBSERVACIONES: observaciones,
      CLIENT_REQUEST_ID: `tienda-order-${tiendaOrderId}`,
      metodos_pago: input.metodos_pago,
    };

    if (usaBreakdownPago) {
      ventaInput.ES_CTA_CORRIENTE = false;
      ventaInput.COBRADA = true;
    }

    const venta = await salesService.create(ventaInput, usuarioId);
    const ventaId: number = (venta as { VENTA_ID: number }).VENTA_ID;

    await pool.request()
      .input('id', sql.Int, tiendaOrderId)
      .input('venta', sql.Int, ventaId)
      .input('cli', sql.Int, clienteId)
      .input('user', sql.Int, usuarioId || null)
      .query(`
        UPDATE TIENDA_ORDERS
        SET ESTADO = 'PROCESADO',
            VENTA_ID = @venta,
            CLIENTE_ID = @cli,
            PROCESADO_AT = SYSDATETIME(),
            PROCESADO_POR = @user
        WHERE TIENDA_ORDER_ID = @id;
      `);

    return { tiendaOrderId, ventaId, estado: 'PROCESADO' };
  },

  async facturar(tiendaOrderId: number, usuarioId: number): Promise<FacturarOrderResult> {
    const order = await fetchOrderById(tiendaOrderId);
    if (!order) throw Object.assign(new Error('Pedido no encontrado'), { name: 'ValidationError' });
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
      .input('caeVto', sql.Date, fe.cae_vto ? new Date(fe.cae_vto) : null)
      .input('numero', sql.NVarChar(50), fe.comprobante_nro)
      .input('user', sql.Int, usuarioId || null)
      .query(`
        UPDATE TIENDA_ORDERS
        SET ESTADO = 'FACTURADO',
            FACTURADO = 1,
            CAE = @cae,
            CAE_VENCIMIENTO = @caeVto,
            COMPROBANTE_NUMERO = @numero,
            FACTURADO_AT = SYSDATETIME(),
            FACTURADO_POR = @user
        WHERE TIENDA_ORDER_ID = @id;
      `);

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
          .query(`
            UPDATE TIENDA_ORDERS
            SET EMAIL_ENVIADO_AT = SYSDATETIME(),
                EMAIL_INTENTOS = EMAIL_INTENTOS + 1
            WHERE TIENDA_ORDER_ID = @id;
          `);
        emailEnviado = true;
      } catch (mailErr) {
        await pool.request()
          .input('id', sql.Int, tiendaOrderId)
          .query('UPDATE TIENDA_ORDERS SET EMAIL_INTENTOS = EMAIL_INTENTOS + 1 WHERE TIENDA_ORDER_ID = @id;');
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

  async cancelar(tiendaOrderId: number, usuarioId: number, motivo: string): Promise<void> {
    const order = await fetchOrderById(tiendaOrderId);
    if (!order) throw Object.assign(new Error('Pedido no encontrado'), { name: 'ValidationError' });
    if (order.ESTADO === 'CANCELADO') return;
    if (order.ESTADO === 'FACTURADO') {
      throw Object.assign(
        new Error('No se puede cancelar un pedido ya facturado. Emití una nota de crédito.'),
        { name: 'ValidationError' },
      );
    }

    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, tiendaOrderId)
      .input('motivo', sql.NVarChar(500), motivo || null)
      .input('user', sql.Int, usuarioId || null)
      .query(`
        UPDATE TIENDA_ORDERS
        SET ESTADO = 'CANCELADO',
            CANCELADO_AT = SYSDATETIME(),
            CANCELADO_POR = @user,
            CANCELACION_MOTIVO = @motivo
        WHERE TIENDA_ORDER_ID = @id;
      `);
  },

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
      .query(`
        UPDATE TIENDA_ORDERS
        SET EMAIL_ENVIADO_AT = SYSDATETIME(),
            EMAIL_INTENTOS = EMAIL_INTENTOS + 1
        WHERE TIENDA_ORDER_ID = @id;
      `);
  },

  async getCounts(): Promise<TiendaOrderCounts> {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT ESTADO, COUNT(*) AS C
      FROM TIENDA_ORDERS
      GROUP BY ESTADO;
    `);
    const out: TiendaOrderCounts = { pendientes: 0, procesados: 0, facturados: 0, cancelados: 0 };
    for (const row of r.recordset) {
      switch (String(row.ESTADO)) {
        case 'PENDIENTE': out.pendientes = row.C; break;
        case 'PROCESADO': out.procesados = row.C; break;
        case 'FACTURADO': out.facturados = row.C; break;
        case 'CANCELADO': out.cancelados = row.C; break;
      }
    }
    return out;
  },
};

// ──────────────────── Email de comprobante ────────────────────
// Implementación mínima auditada: registra el intento en INTEGRACIONES_SYNC_LOGS.
// El envío SMTP real se enchufa a través del proveedor configurado en
// INTEGRACIONES_CONFIG (claves smtp_host/smtp_port/...); cuando no hay
// proveedor configurado, queda registrado como `stub:not-sent` para que el
// operador lo reenvíe manualmente desde la UI.
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
}
