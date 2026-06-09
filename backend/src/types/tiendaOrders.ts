// ════════════════════════════════════════════════════════════════════
//  Contrato — Pedidos de Tienda Online (Tienda Orders)
//
//  Tipos y constantes únicos para front, back y validación Zod.
//  Mantener sincronizado 1:1 con database/migrate-tienda-orders.sql.
//
//  Convención: los valores de enums se persisten en MAYÚSCULAS para
//  alinear con la convención de RG WEB y los CHECK constraints de SQL.
// ════════════════════════════════════════════════════════════════════

// ────────────────────── Enums (const + type) ──────────────────────

export const TIENDA_ORDER_ESTADOS = [
  'PENDIENTE',
  'PROCESADO',
  'FACTURADO',
  'CANCELADO',
] as const;
export type TiendaOrderEstado = (typeof TIENDA_ORDER_ESTADOS)[number];

export const TIPOS_DOCUMENTO_AR = [
  'DNI',
  'CUIT',
  'CUIL',
  'CF',         // consumidor final sin identificación
  'PASAPORTE',
  'LE',
  'LC',
] as const;
export type TipoDocumentoAR = (typeof TIPOS_DOCUMENTO_AR)[number];

export const CONDICIONES_IVA_AR = [
  'RESPONSABLE INSCRIPTO',
  'MONOTRIBUTO',
  'CONSUMIDOR FINAL',
  'EXENTO',
  'NO RESPONSABLE',
] as const;
export type CondicionIVA = (typeof CONDICIONES_IVA_AR)[number];

export const METODOS_PAGO = [
  'EFECTIVO',
  'MERCADOPAGO',
  'TRANSFERENCIA',
  'TARJETA',
  'OTRO',
] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export const ESTADOS_PAGO = [
  'PENDIENTE',
  'APROBADO',
  'RECHAZADO',
  'REEMBOLSADO',
] as const;
export type EstadoPago = (typeof ESTADOS_PAGO)[number];

export const METODOS_ENVIO = ['RETIRO', 'ENVIO'] as const;
export type MetodoEnvio = (typeof METODOS_ENVIO)[number];

export const MONEDAS = ['ARS', 'USD'] as const;
export type Moneda = (typeof MONEDAS)[number];

export const METODOS_PAGO_VENTA = ['EFECTIVO', 'DIGITAL', 'CTA_CORRIENTE'] as const;
export type MetodoPagoVenta = (typeof METODOS_PAGO_VENTA)[number];

// ─────────────── INPUT (lo que envía la tienda) ────────────────────

export interface TiendaOrderItemInput {
  /** ID del producto en `PRODUCTOS` de RG WEB (preferido). */
  productoId?: number;
  /** SKU alterno si la tienda no conoce el ID interno. */
  sku?: string;
  /** Snapshot descriptivo: lo que vio el cliente al comprar. */
  nombre?: string;
  /** Cantidad (admite hasta 3 decimales). */
  cantidad: number;
  /** Precio unitario cobrado por la tienda. */
  precioUnitario: number;
  /** Descuento porcentual (0–100). */
  descuento?: number;
  /** Alícuota IVA informativa (0 | 10.5 | 21). */
  ivaAlicuota?: number;
  /** Subtotal final de la línea (cantidad * precioUnitario * (1 - desc/100)). */
  subtotal?: number;
}

export interface TiendaOrderClienteInput {
  nombre?: string;
  tipoDocumento?: TipoDocumentoAR;
  /** Documento sin separadores (solo dígitos para DNI/CUIT/CUIL). */
  documento?: string;
  condicionIva?: CondicionIVA;
  email?: string;
  telefono?: string;
  direccion?: string;
  localidad?: string;
  provincia?: string;
  cp?: string;
  /** ISO 3166-1 alpha-2. Default: 'AR'. */
  pais?: string;
}

export interface TiendaOrderPagoInput {
  metodo?: MetodoPago;
  estado?: EstadoPago;
  /** ID externo del pago (MercadoPago payment_id, etc.). */
  referencia?: string;
  /** ISO date — cuándo se aprobó el pago. */
  fechaAprobacion?: string;
}

export interface TiendaOrderEnvioInput {
  metodo?: MetodoEnvio;
  direccion?: string;
  transporte?: string;
  tracking?: string;
}

export interface TiendaOrderTotalesInput {
  subtotal?: number;
  descuentos?: number;
  costoEnvio?: number;
  ivaTotal?: number;
  total?: number;
}

export interface TiendaOrderInput {
  externalOrderId: string;
  tiendaOrigen: string;
  /** ISO date. Default: now. */
  fechaPedido?: string;
  moneda?: Moneda;
  cliente?: TiendaOrderClienteInput;
  items: TiendaOrderItemInput[];
  pago?: TiendaOrderPagoInput;
  envio?: TiendaOrderEnvioInput;
  totales?: TiendaOrderTotalesInput;
  observaciones?: string;
}

// ─────────────── PERSISTED (shape exacto de DB) ────────────────────

export interface TiendaOrder {
  TIENDA_ORDER_ID: number;
  TIENDA_ORIGEN: string;
  EXTERNAL_ORDER_ID: string;
  ESTADO: TiendaOrderEstado;
  FECHA_PEDIDO: Date;

  CLIENTE_NOMBRE: string | null;
  CLIENTE_TIPO_DOC: TipoDocumentoAR | null;
  CLIENTE_DOCUMENTO: string | null;
  CLIENTE_CONDICION_IVA: CondicionIVA | null;
  CLIENTE_EMAIL: string | null;
  CLIENTE_TELEFONO: string | null;
  CLIENTE_DIRECCION: string | null;
  CLIENTE_LOCALIDAD: string | null;
  CLIENTE_PROVINCIA: string | null;
  CLIENTE_CP: string | null;
  CLIENTE_PAIS: string | null;

  PAGO_METODO: string | null;
  PAGO_ESTADO: string | null;
  PAGO_REFERENCIA: string | null;
  PAGO_FECHA_APROB: Date | null;

  ENVIO_METODO: MetodoEnvio | null;
  ENVIO_TRANSPORTE: string | null;
  ENVIO_TRACKING: string | null;

  SUBTOTAL: number | null;
  DESCUENTOS: number | null;
  COSTO_ENVIO: number | null;
  IVA_TOTAL: number | null;
  TOTAL: number | null;
  MONEDA: Moneda;

  OBSERVACIONES: string | null;
  PAYLOAD_RAW: string | null;

  VENTA_ID: number | null;
  CLIENTE_ID: number | null;
  FACTURADO: boolean;
  CAE: string | null;
  CAE_VENCIMIENTO: Date | null;
  COMPROBANTE_NUMERO: string | null;
  EMAIL_ENVIADO_AT: Date | null;
  EMAIL_INTENTOS: number;

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
  LINEA: number;
  PRODUCTO_ID: number | null;
  SKU: string | null;
  NOMBRE: string | null;
  CANTIDAD: number;
  PRECIO_UNITARIO: number;
  DESCUENTO_PORC: number;
  IVA_ALICUOTA: number | null;
  SUBTOTAL: number;
}

export interface TiendaOrderWithItems extends TiendaOrder {
  items: TiendaOrderItem[];
}

// ─────────────── Filtros & resultados ──────────────────────────────

export interface TiendaOrderListFilters {
  estado?: TiendaOrderEstado | 'TODOS';
  tienda?: string;
  search?: string;        // por externalOrderId / nombre / email
  desde?: string;         // ISO
  hasta?: string;         // ISO
  limit?: number;
  offset?: number;
}

export interface TiendaOrderListResult {
  items: TiendaOrder[];
  total: number;
}

export interface TiendaOrderCounts {
  pendientes: number;
  procesados: number;
  facturados: number;
  cancelados: number;
}

// ─────────────── Acciones del operador ─────────────────────────────

export interface ProcesarOrderInput {
  clienteId?: number;
  puntoVentaId?: number;
  depositoId?: number;
  metodoPago?: MetodoPagoVenta;
  metodos_pago?: Array<{
    METODO_PAGO_ID: number;
    MONTO: number;
  }>;
  itemsOverride?: Array<{
    productoId: number;
    cantidad: number;
    precioUnitario?: number;
    descuento?: number;
  }>;
}

export interface ProcesarOrderResult {
  tiendaOrderId: number;
  ventaId: number;
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

// ─────────────── Respuesta del endpoint público ────────────────────

export type TiendaOrderReceiveStatus = 'RECEIVED' | 'DUPLICATE';

export interface TiendaOrderReceiveResult {
  status: TiendaOrderReceiveStatus;
  tiendaOrderId: number;
  estado: TiendaOrderEstado;
}
