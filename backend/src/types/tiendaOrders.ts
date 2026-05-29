// ═══════════════════════════════════════════════════
//  Tipos — Pedidos de Tienda Online (Tienda Orders)
//
//  Contrato estándar para que cualquier tienda (Tricarios,
//  futuros clientes) envíe pedidos al sistema RG WEB.
// ═══════════════════════════════════════════════════

export type TiendaOrderEstado =
  | 'pendiente'
  | 'procesado'
  | 'facturado'
  | 'cancelado';

// ── Payload recibido desde la tienda online ────────────
export interface TiendaOrderItemInput {
  /** ID del producto en PRODUCTOS (RG WEB). Opcional si se envía SKU. */
  productoId?: number;
  /** Código alterno si la tienda no conoce el ID interno. */
  sku?: string;
  /** Descripción que la tienda mostró al cliente (snapshot). */
  nombre?: string;
  cantidad: number;
  precioUnitario: number;
  /** Descuento porcentual (0–100). */
  descuento?: number;
  subtotal?: number;
}

export interface TiendaOrderClienteInput {
  nombre?: string;
  documento?: string;
  tipoDocumento?: string;       // DNI | CUIT | CF | ...
  email?: string;
  telefono?: string;
  direccion?: string;
  localidad?: string;
  provincia?: string;
  cp?: string;
}

export interface TiendaOrderPagoInput {
  metodo?: string;              // EFECTIVO | MERCADOPAGO | TRANSFERENCIA | ...
  estado?: string;              // pendiente | aprobado | rechazado
  referencia?: string;
}

export interface TiendaOrderEnvioInput {
  metodo?: 'retiro' | 'envio';
  direccion?: string;
  costo?: number;
}

export interface TiendaOrderTotalesInput {
  subtotal?: number;
  descuentos?: number;
  envio?: number;
  total?: number;
}

export interface TiendaOrderInput {
  externalOrderId: string;
  tiendaOrigen: string;
  fechaPedido?: string;          // ISO. Si no, se usa SYSDATETIME() del backend.
  cliente?: TiendaOrderClienteInput;
  items: TiendaOrderItemInput[];
  pago?: TiendaOrderPagoInput;
  envio?: TiendaOrderEnvioInput;
  totales?: TiendaOrderTotalesInput;
  observaciones?: string;
}

// ── Fila persistida (DB shape) ─────────────────────────
export interface TiendaOrder {
  TIENDA_ORDER_ID: number;
  EXTERNAL_ORDER_ID: string;
  TIENDA_ORIGEN: string;
  ESTADO: TiendaOrderEstado;
  FECHA_PEDIDO: Date;

  CLIENTE_NOMBRE: string | null;
  CLIENTE_DOCUMENTO: string | null;
  CLIENTE_TIPO_DOC: string | null;
  CLIENTE_EMAIL: string | null;
  CLIENTE_TELEFONO: string | null;
  CLIENTE_DIRECCION: string | null;
  CLIENTE_LOCALIDAD: string | null;
  CLIENTE_PROVINCIA: string | null;
  CLIENTE_CP: string | null;

  PAGO_METODO: string | null;
  PAGO_ESTADO: string | null;
  PAGO_REFERENCIA: string | null;

  ENVIO_METODO: string | null;
  ENVIO_COSTO: number | null;

  SUBTOTAL: number | null;
  DESCUENTOS: number | null;
  TOTAL: number | null;

  OBSERVACIONES: string | null;
  PAYLOAD_RAW: string | null;

  VENTA_ID: number | null;
  CLIENTE_ID: number | null;
  FACTURADO: boolean;
  CAE: string | null;
  COMPROBANTE_NUMERO: string | null;
  EMAIL_ENVIADO_AT: Date | null;

  API_KEY_ID: number | null;
  CREATED_AT: Date;
  PROCESADO_AT: Date | null;
  PROCESADO_POR: number | null;
  FACTURADO_AT: Date | null;
  FACTURADO_POR: number | null;
  CANCELADO_AT: Date | null;
  CANCELADO_POR: number | null;
  CANCELACION_MOTIVO: string | null;
}

export interface TiendaOrderItem {
  ITEM_ID: number;
  TIENDA_ORDER_ID: number;
  PRODUCTO_ID: number | null;
  SKU: string | null;
  NOMBRE: string | null;
  CANTIDAD: number;
  PRECIO_UNITARIO: number;
  DESCUENTO: number;
  SUBTOTAL: number | null;
}

export interface TiendaOrderWithItems extends TiendaOrder {
  items: TiendaOrderItem[];
}

// ── Filtros de listado ─────────────────────────────────
export interface TiendaOrderListFilters {
  estado?: TiendaOrderEstado | 'todos';
  tienda?: string;
  search?: string;               // busca por external_order_id / cliente
  desde?: string;                // ISO
  hasta?: string;                // ISO
  limit?: number;
  offset?: number;
}

export interface TiendaOrderListResult {
  items: TiendaOrder[];
  total: number;
}

// ── Inputs para acciones del operador ──────────────────
export interface ProcesarOrderInput {
  /** Cliente de RG WEB al que se asigna la venta. Si no, se usa el default de config. */
  clienteId?: number;
  /** Punto de venta. Si no, se usa el default de config. */
  puntoVentaId?: number;
  /** Método de pago de la venta (efectivo / cta cte / etc.). */
  metodoPago?: 'EFECTIVO' | 'DIGITAL' | 'CTA_CORRIENTE';
  /** Permite override de items (cambiar precios, cantidades) antes de crear la venta. */
  itemsOverride?: Array<{
    productoId: number;
    cantidad: number;
    precioUnitario?: number;
    descuento?: number;
  }>;
}

export interface ProcesarOrderResult {
  ventaId: number;
  tiendaOrderId: number;
  estado: TiendaOrderEstado;
}

export interface FacturarOrderResult {
  tiendaOrderId: number;
  ventaId: number;
  cae: string;
  caeVto: string;
  comprobanteNumero: string;
  tipoComprobante: string;
  emailEnviado: boolean;
  emailDestinatario: string | null;
}
