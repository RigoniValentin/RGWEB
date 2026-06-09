import api from './api';
import type { MetodoPagoItem } from '../types';

// ═══════════════════════════════════════════════════
//  Cliente API — Pedidos de Tienda Online
// ═══════════════════════════════════════════════════

export type TiendaOrderEstado =
  | 'PENDIENTE'
  | 'PROCESADO'
  | 'FACTURADO'
  | 'CANCELADO';

export interface TiendaOrder {
  TIENDA_ORDER_ID: number;
  EXTERNAL_ORDER_ID: string;
  TIENDA_ORIGEN: string;
  ESTADO: TiendaOrderEstado;
  FECHA_PEDIDO: string;

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
  EMAIL_ENVIADO_AT: string | null;

  CREATED_AT: string;
  PROCESADO_AT: string | null;
  FACTURADO_AT: string | null;
  CANCELADO_AT: string | null;
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

export interface TiendaOrderListFilters {
  estado?: TiendaOrderEstado | 'TODOS';
  tienda?: string;
  search?: string;
  desde?: string;
  hasta?: string;
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

export interface ProcesarOrderInput {
  clienteId?: number;
  puntoVentaId?: number;
  depositoId?: number;
  metodoPago?: 'EFECTIVO' | 'DIGITAL' | 'CTA_CORRIENTE';
  metodos_pago?: MetodoPagoItem[];
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

export const tiendaOrdersApi = {
  list: (filters: TiendaOrderListFilters = {}) =>
    api.get<TiendaOrderListResult>('/tienda-orders', { params: filters }).then(r => r.data),

  counts: () =>
    api.get<TiendaOrderCounts>('/tienda-orders/counts').then(r => r.data),

  get: (id: number) =>
    api.get<TiendaOrderWithItems>(`/tienda-orders/${id}`).then(r => r.data),

  procesar: (id: number, input: ProcesarOrderInput = {}) =>
    api.post<ProcesarOrderResult>(`/tienda-orders/${id}/procesar`, input).then(r => r.data),

  facturar: (id: number) =>
    api.post<FacturarOrderResult>(`/tienda-orders/${id}/facturar`).then(r => r.data),

  cancelar: (id: number, motivo: string) =>
    api.post<{ ok: true }>(`/tienda-orders/${id}/cancelar`, { motivo }).then(r => r.data),

  reenviarMail: (id: number, email?: string) =>
    api.post<{ ok: true }>(`/tienda-orders/${id}/reenviar-mail`, { email }).then(r => r.data),
};
