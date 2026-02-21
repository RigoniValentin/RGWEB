import api from './api';
import type { Producto, PaginatedResponse, StockDeposito } from '../types';

export interface ProductInput {
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  DESCRIPCION?: string | null;
  CATEGORIA_ID?: number | null;
  MARCA_ID?: number | null;
  UNIDAD_ID?: number | null;
  PRECIO_COMPRA?: number | null;
  COSTO_USD?: number | null;
  PRECIO_COMPRA_BASE?: number;
  STOCK_MINIMO?: number | null;
  TASA_IVA_ID?: number | null;
  IMP_INT?: number;
  ES_CONJUNTO?: boolean | null;
  DESCUENTA_STOCK?: boolean;
  ACTIVO?: boolean;
  LISTA_1?: number;
  LISTA_2?: number;
  LISTA_3?: number;
  LISTA_4?: number;
  LISTA_5?: number;
  LISTA_DEFECTO?: number | null;
  FECHA_VENCIMIENTO?: string | null;
  MARGEN_INDIVIDUAL?: boolean | null;
  codigosBarras?: string[];
  depositos?: { DEPOSITO_ID: number; CANTIDAD: number }[];
  proveedores?: number[];
}

export interface ProductDetail extends Producto {
  codigosBarras: string[];
  proveedores: { PRODUCTOS_PROVEEDORES_ID: number; PROVEEDOR_ID: number; PROVEEDOR_NOMBRE: string }[];
  stockDepositos: (StockDeposito & { DEPOSITO_NOMBRE: string })[];
  TASA_IVA_NOMBRE?: string;
  TASA_IVA_PORCENTAJE?: number;
}

export interface TasaImpuesto {
  TASA_ID: number;
  NOMBRE: string;
  PORCENTAJE: number;
  PREDETERMINADA: boolean;
  ACTIVA: boolean;
}

export const productApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Producto>>('/products', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<ProductDetail>(`/products/${id}`).then(r => r.data),

  getStock: (id: number) =>
    api.get<StockDeposito[]>(`/products/${id}/stock`).then(r => r.data),

  getTasasImpuestos: () =>
    api.get<TasaImpuesto[]>('/products/tasas-impuestos').then(r => r.data),

  create: (data: ProductInput) =>
    api.post<{ PRODUCTO_ID: number }>('/products', data).then(r => r.data),

  update: (id: number, data: ProductInput) =>
    api.put('/products/' + id, data).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ mode: 'soft' | 'hard' }>('/products/' + id).then(r => r.data),

  inlineEdit: (data: { PRODUCTO_ID: number; campo: string; valor: any }) =>
    api.patch('/products/inline-edit', data).then(r => r.data),

  copy: (id: number) =>
    api.post<{ PRODUCTO_ID: number }>(`/products/${id}/copy`).then(r => r.data),

  bulkAssign: (data: { productoIds: number[]; campo: string; valor: any }) =>
    api.post<{ affected: number }>('/products/bulk-assign', data).then(r => r.data),

  bulkDelete: (productoIds: number[]) =>
    api.post<{ deleted: number; deactivated: number }>('/products/bulk-delete', { productoIds }).then(r => r.data),

  bulkGeneratePrices: (data: {
    productoIds: number[];
    listaId: number;
    margen: number;
    fuente: 'ARS' | 'USD';
    redondeo?: string;
  }) => api.post<{ affected: number }>('/products/bulk-prices', data).then(r => r.data),
};
