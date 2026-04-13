import api from './api';

// ═══════════════════════════════════════════════════
//  NC Ventas — API Service
// ═══════════════════════════════════════════════════

export interface NCVenta {
  NC_ID: number;
  VENTA_ID: number;
  CLIENTE_ID: number;
  FECHA: string;
  MOTIVO: string;
  MEDIO_PAGO: string;
  MONTO: number;
  DESCUENTO: number;
  DESCRIPCION: string | null;
  PUNTO_VENTA_ID: number | null;
  USUARIO_ID: number | null;
  ANULADA: boolean;
  DESTINO_PAGO: string | null;
  NUMERO_FISCAL: string | null;
  CAE: string | null;
  CAE_VTO: string | null;
  TIPO_COMPROBANTE: string | null;
  PUNTO_VENTA_FISCAL: string | null;
  EMITIDA_FISCAL: boolean;
  CLIENTE_NOMBRE?: string;
  USUARIO_NOMBRE?: string;
  VENTA_NUMERO_FISCAL?: string | null;
  VENTA_TIPO_COMPROBANTE?: string | null;
  VENTA_PUNTO_VENTA?: string | null;
}

export interface NCVentaItem {
  NC_ITEM_ID: number;
  NC_ID: number;
  VENTA_ID: number;
  PRODUCTO_ID: number;
  CANTIDAD_DEVUELTA: number;
  PRECIO_UNITARIO: number;
  DEPOSITO_ID: number | null;
  PRODUCTO_NOMBRE?: string;
  PRODUCTO_CODIGO?: string;
  UNIDAD_ABREVIACION?: string;
  IVA_ALICUOTA?: number;
  PORCENTAJE_DESCUENTO?: number;
}

export interface NCVentaDetalle extends NCVenta {
  VENTA_TIPO_COMPROBANTE?: string;
  items: NCVentaItem[];
  metodos_pago?: { METODO_PAGO_ID: number; NOMBRE: string; CATEGORIA: string; IMAGEN_BASE64?: string; TOTAL: number }[];
}

export interface VentaParaNC {
  VENTA_ID: number;
  FECHA_VENTA: string;
  TOTAL: number;
  TIPO_COMPROBANTE: string | null;
  PUNTO_VENTA: string | null;
  NUMERO_FISCAL: string | null;
  ES_CTA_CORRIENTE: boolean;
  COBRADA: boolean;
  CAE: string | null;
  CLIENTE_NOMBRE?: string;
}

export interface ItemVentaParaNC {
  VENTA_ID: number;
  PRODUCTO_ID: number;
  PRECIO_UNITARIO: number;
  PRECIO_UNITARIO_DTO: number;
  CANTIDAD: number;
  DESCUENTO: number;
  DEPOSITO_ID: number | null;
  IVA_ALICUOTA: number;
  IVA_MONTO: number;
  PRODUCTO_NOMBRE: string;
  PRODUCTO_CODIGO: string;
  UNIDAD_ABREVIACION: string;
  CANTIDAD_YA_DEVUELTA: number;
}

export interface NCVentaItemInput {
  PRODUCTO_ID: number;
  CANTIDAD_DEVUELTA: number;
  PRECIO_UNITARIO: number;
  DEPOSITO_ID?: number | null;
}

export interface NCVentaInput {
  VENTA_ID: number;
  CLIENTE_ID: number;
  MOTIVO: 'POR DEVOLUCION' | 'POR ANULACION' | 'POR DESCUENTO' | 'POR DIFERENCIA PRECIO';
  MEDIO_PAGO: 'CN' | 'CC';
  MONTO?: number;
  DESCUENTO?: number;
  DESCRIPCION?: string;
  PUNTO_VENTA_ID?: number;
  DESTINO_PAGO?: 'CAJA_CENTRAL' | 'CAJA';
  EMITIR_FISCAL?: boolean;
  items?: NCVentaItemInput[];
  metodos_pago?: { METODO_PAGO_ID: number; MONTO: number }[];
}

export interface FiscalResult {
  success: boolean;
  comprobante_nro?: string;
  cae?: string;
  cae_vto?: string;
  tipo_comprobante?: string;
  errores?: string[];
  error?: string;
}

export const ncVentasApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<NCVenta[]>('/nc-ventas', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<NCVentaDetalle>(`/nc-ventas/${id}`).then(r => r.data),

  getVentasParaNC: (clienteId: number, params?: { fechaDesde?: string; fechaHasta?: string }) =>
    api.get<VentaParaNC[]>(`/nc-ventas/ventas-para-nc/${clienteId}`, { params }).then(r => r.data),

  getItemsVenta: (ventaId: number) =>
    api.get<ItemVentaParaNC[]>(`/nc-ventas/items-venta/${ventaId}`).then(r => r.data),

  existeNC: (ventaId: number) =>
    api.get<{ existe: boolean; notas: any[] }>(`/nc-ventas/existe/${ventaId}`).then(r => r.data),

  create: (data: NCVentaInput) =>
    api.post<{ NC_ID: number; MONTO: number; fiscal: FiscalResult | null }>('/nc-ventas', data).then(r => r.data),

  emitirFiscal: (id: number) =>
    api.post<FiscalResult>(`/nc-ventas/${id}/emitir-fiscal`).then(r => r.data),

  anular: (id: number) =>
    api.put<{ ND_ID: number; NC_ID: number }>(`/nc-ventas/${id}/anular`).then(r => r.data),
};
