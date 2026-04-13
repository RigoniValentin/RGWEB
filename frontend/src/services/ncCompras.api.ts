import api from './api';

// ═══════════════════════════════════════════════════
//  NC Compras — API Service
// ═══════════════════════════════════════════════════

export interface NCCompra {
  NC_ID: number;
  COMPRA_ID: number;
  PROVEEDOR_ID: number;
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
  PROVEEDOR_NOMBRE?: string;
  USUARIO_NOMBRE?: string;
}

export interface NCCompraItem {
  NC_ITEM_ID: number;
  NC_ID: number;
  COMPRA_ID: number;
  PRODUCTO_ID: number;
  CANTIDAD_DEVUELTA: number;
  PRECIO_COMPRA: number;
  DEPOSITO_ID: number | null;
  PRODUCTO_NOMBRE?: string;
  PRODUCTO_CODIGO?: string;
  UNIDAD_ABREVIACION?: string;
  IVA_ALICUOTA?: number;
  PORCENTAJE_DESCUENTO?: number;
}

export interface NCCompraDetalle extends NCCompra {
  COMPRA_TIPO_COMPROBANTE?: string;
  items: NCCompraItem[];
  metodos_pago?: { METODO_PAGO_ID: number; NOMBRE: string; CATEGORIA: string; IMAGEN_BASE64?: string; TOTAL: number }[];
}

export interface CompraParaNC {
  COMPRA_ID: number;
  FECHA_COMPRA: string;
  TOTAL: number;
  TIPO_COMPROBANTE: string | null;
  PTO_VTA: string;
  NRO_COMPROBANTE: string;
  ES_CTA_CORRIENTE: boolean;
  COBRADA: boolean;
  PRECIOS_SIN_IVA: boolean;
  PROVEEDOR_NOMBRE?: string;
}

export interface ItemCompraParaNC {
  COMPRA_ID: number;
  PRODUCTO_ID: number;
  PRECIO_COMPRA: number;
  CANTIDAD: number;
  TOTAL_PRODUCTO: number;
  DEPOSITO_ID: number | null;
  PORCENTAJE_DESCUENTO: number;
  DESCUENTO_IMPORTE: number;
  IVA_ALICUOTA: number;
  PRODUCTO_NOMBRE: string;
  PRODUCTO_CODIGO: string;
  UNIDAD_ABREVIACION: string;
  CANTIDAD_YA_DEVUELTA: number;
}

export interface NCCompraItemInput {
  PRODUCTO_ID: number;
  CANTIDAD_DEVUELTA: number;
  PRECIO_COMPRA: number;
  DEPOSITO_ID?: number | null;
}

export interface NCCompraInput {
  COMPRA_ID: number;
  PROVEEDOR_ID: number;
  MOTIVO: 'POR DEVOLUCION' | 'POR ANULACION' | 'POR DESCUENTO' | 'POR DIFERENCIA PRECIO';
  MEDIO_PAGO: 'CN' | 'CC';
  MONTO?: number;
  DESCUENTO?: number;
  DESCRIPCION?: string;
  PTO_VTA?: string;
  NRO_COMPROBANTE?: string;
  PUNTO_VENTA_ID?: number;
  DESTINO_PAGO?: 'CAJA_CENTRAL' | 'CAJA';
  items?: NCCompraItemInput[];
  metodos_pago?: { METODO_PAGO_ID: number; MONTO: number }[];
}

export const ncComprasApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<NCCompra[]>('/nc-compras', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<NCCompraDetalle>(`/nc-compras/${id}`).then(r => r.data),

  getComprasParaNC: (proveedorId: number, params?: { fechaDesde?: string; fechaHasta?: string }) =>
    api.get<CompraParaNC[]>(`/nc-compras/compras-para-nc/${proveedorId}`, { params }).then(r => r.data),

  getItemsCompra: (compraId: number) =>
    api.get<ItemCompraParaNC[]>(`/nc-compras/items-compra/${compraId}`).then(r => r.data),

  existeNC: (compraId: number) =>
    api.get<{ existe: boolean; notas: any[] }>(`/nc-compras/existe/${compraId}`).then(r => r.data),

  create: (data: NCCompraInput) =>
    api.post<{ NC_ID: number; MONTO: number }>('/nc-compras', data).then(r => r.data),

  anular: (id: number) =>
    api.put<{ ND_ID: number; NC_ID: number }>(`/nc-compras/${id}/anular`).then(r => r.data),
};
