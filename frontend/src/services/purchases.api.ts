import api from './api';
import type {
  Compra, CompraDetalle, CompraInput,
  PaginatedResponse, ProductoSearchCompra, ProductoSearch, ProveedorCompra, Deposito, MetodoPago,
} from '../types';

/** Precio de un producto en una lista, con su margen individual override. */
export interface PrecioEnCheck {
  LISTA_ID: number;
  PRECIO: number;
  MARGEN_INDIVIDUAL: number | null;
}

export interface PriceCheckProduct {
  PRODUCTO_ID: number;
  CODIGO: string;
  DESCRIPCION: string;
  COSTO: number;
  IMP_INTERNO: number;
  IVA_ALICUOTA: number;
  LISTA_DEFECTO: number | null;
  /** Precios por lista (dinámico, soporta N listas). */
  precios: PrecioEnCheck[];
  /** True si el producto tiene al menos un MARGEN_INDIVIDUAL != null. */
  TIENE_MARGENES_INDIV: boolean;
}

export interface PriceCheckData {
  products: PriceCheckProduct[];
  listNames: Record<number, string>;
  listMargins: Record<number, number>;
  preciosSinIva: boolean;
  impIntGravaIva: boolean;
}

export interface PriceCheckUpdate {
  PRODUCTO_ID: number;
  precios: { LISTA_ID: number; PRECIO: number }[];
}

export const purchasesApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Compra>>('/purchases', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<CompraDetalle>(`/purchases/${id}`).then(r => r.data),

  create: (data: CompraInput) =>
    api.post<{ COMPRA_ID: number; TOTAL: number; MONTO_ANTICIPO?: number; COBRADA?: boolean }>('/purchases', data).then(r => r.data),

  update: (id: number, data: CompraInput) =>
    api.put(`/purchases/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    api.delete(`/purchases/${id}`).then(r => r.data),

  searchProducts: (search: string) =>
    api.get<ProductoSearchCompra[]>('/purchases/search-products', { params: { search } }).then(r => r.data),

  searchProductsAdvanced: (params: {
    search?: string; marca?: string; categoria?: string; codigo?: string;
    soloActivos?: boolean; soloConStock?: boolean; limit?: number; busquedaMultiEntidad?: boolean;
  }) =>
    api.get<ProductoSearch[]>('/purchases/search-products-advanced', { params }).then(r => r.data),

  getProveedores: () =>
    api.get<ProveedorCompra[]>('/purchases/proveedores').then(r => r.data),

  getDepositos: () =>
    api.get<Deposito[]>('/purchases/depositos').then(r => r.data),

  getActivePaymentMethods: () =>
    api.get<MetodoPago[]>('/purchases/active-payment-methods').then(r => r.data),

  getSaldoCtaCteP: (proveedorId: number) =>
    api.get<{ saldo: number; ctaCorrienteId: number | null }>(`/purchases/saldo-cta-cte/${proveedorId}`).then(r => r.data),

  getPriceCheckData: (compraId: number) =>
    api.get<PriceCheckData>(`/purchases/price-check/${compraId}`).then(r => r.data),

  savePriceCheck: (updates: PriceCheckUpdate[]) =>
    api.post<{ updated: number }>('/purchases/price-check', { updates }).then(r => r.data),
};
