import api from './api';
import type {
  Compra, CompraDetalle, CompraInput,
  PaginatedResponse, ProductoSearchCompra, ProveedorCompra, Deposito,
} from '../types';

export const purchasesApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Compra>>('/purchases', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<CompraDetalle>(`/purchases/${id}`).then(r => r.data),

  create: (data: CompraInput) =>
    api.post<{ COMPRA_ID: number; TOTAL: number; COBRADA?: boolean }>('/purchases', data).then(r => r.data),

  update: (id: number, data: CompraInput) =>
    api.put(`/purchases/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    api.delete(`/purchases/${id}`).then(r => r.data),

  searchProducts: (search: string) =>
    api.get<ProductoSearchCompra[]>('/purchases/search-products', { params: { search } }).then(r => r.data),

  getProveedores: () =>
    api.get<ProveedorCompra[]>('/purchases/proveedores').then(r => r.data),

  getDepositos: () =>
    api.get<Deposito[]>('/purchases/depositos').then(r => r.data),

  getSaldoCtaCteP: (proveedorId: number) =>
    api.get<{ saldo: number; ctaCorrienteId: number | null }>(`/purchases/saldo-cta-cte/${proveedorId}`).then(r => r.data),
};
