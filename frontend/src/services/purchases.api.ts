import api from './api';
import type {
  Compra, CompraDetalle, CompraInput,
  PaginatedResponse, ProductoSearchCompra, ProductoSearch, ProveedorCompra, Deposito, MetodoPago,
} from '../types';

export interface PriceCheckProduct {
  PRODUCTO_ID: number;
  CODIGO: string;
  DESCRIPCION: string;
  COSTO: number;
  IMP_INTERNO: number;
  IVA_ALICUOTA: number;
  MARGEN_1: number;
  MARGEN_2: number;
  MARGEN_3: number;
  MARGEN_4: number;
  MARGEN_5: number;
  LISTA_1: number;
  LISTA_2: number;
  LISTA_3: number;
  LISTA_4: number;
  LISTA_5: number;
  TIENE_MARGENES_INDIV: boolean | number;
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
  LISTA_1: number;
  LISTA_2: number;
  LISTA_3: number;
  LISTA_4: number;
  LISTA_5: number;
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
    soloActivos?: boolean; soloConStock?: boolean; limit?: number;
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
