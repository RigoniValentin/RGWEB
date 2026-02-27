import api from './api';
import type {
  Venta, VentaDetalle, VentaInput, PaymentInput,
  PaginatedResponse, ProductoSearch, ClienteVenta, Deposito,
} from '../types';

export interface DepositoPV extends Deposito {
  ES_PREFERIDO: boolean;
}

export const salesApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Venta>>('/sales', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<VentaDetalle>(`/sales/${id}`).then(r => r.data),

  create: (data: VentaInput) =>
    api.post<{ VENTA_ID: number; TOTAL: number }>('/sales', data).then(r => r.data),

  update: (id: number, data: VentaInput) =>
    api.put(`/sales/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    api.delete(`/sales/${id}`).then(r => r.data),

  pay: (id: number, data: PaymentInput) =>
    api.post<{ ok: boolean; cobrada: boolean }>(`/sales/${id}/pay`, data).then(r => r.data),

  unpay: (id: number) =>
    api.post(`/sales/${id}/unpay`).then(r => r.data),

  searchProducts: (search: string, listaId?: number) =>
    api.get<ProductoSearch[]>('/sales/search-products', { params: { search, listaId } }).then(r => r.data),

  getClientes: () =>
    api.get<ClienteVenta[]>('/sales/clientes').then(r => r.data),

  getDepositos: () =>
    api.get<Deposito[]>('/sales/depositos').then(r => r.data),

  getDepositosPV: (pvId: number) =>
    api.get<DepositoPV[]>(`/sales/depositos-pv/${pvId}`).then(r => r.data),

  getEmpresaIva: () =>
    api.get<{ CONDICION_IVA: string | null }>('/sales/empresa-iva').then(r => r.data),
};
