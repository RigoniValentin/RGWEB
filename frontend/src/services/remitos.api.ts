import api from './api';
import type {
  Remito, RemitoDetalle, RemitoInput,
  PaginatedResponse, ProductoSearchRemito, ProductoSearch, Deposito, EmpresaData,
  RemitoPendiente, RemitoItemParaVenta,
} from '../types';

export const remitosApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Remito>>('/remitos', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<RemitoDetalle>(`/remitos/${id}`).then(r => r.data),

  create: (data: RemitoInput) =>
    api.post<{ REMITO_ID: number; NRO_REMITO: string; PTO_VTA: string; TOTAL: number }>('/remitos', data).then(r => r.data),

  anular: (id: number) =>
    api.put<{ ok: boolean; REMITO_ID: number }>(`/remitos/${id}/anular`).then(r => r.data),

  delete: (id: number) =>
    api.delete(`/remitos/${id}`).then(r => r.data),

  searchProducts: (search: string) =>
    api.get<ProductoSearchRemito[]>('/remitos/search-products', { params: { search } }).then(r => r.data),

  searchProductsAdvanced: (params: {
    search?: string; marca?: string; categoria?: string; codigo?: string;
    soloActivos?: boolean; soloConStock?: boolean; limit?: number;
  }) =>
    api.get<ProductoSearch[]>('/remitos/search-products-advanced', { params }).then(r => r.data),

  getClientes: () =>
    api.get<any[]>('/remitos/clientes').then(r => r.data),

  getProveedores: () =>
    api.get<any[]>('/remitos/proveedores').then(r => r.data),

  getDepositos: () =>
    api.get<Deposito[]>('/remitos/depositos').then(r => r.data),

  getEmpresaData: () =>
    api.get<EmpresaData>('/remitos/empresa').then(r => r.data),

  getPendientesCliente: (clienteId: number) =>
    api.get<RemitoPendiente[]>(`/remitos/pendientes-cliente/${clienteId}`).then(r => r.data),

  getItemsParaVenta: (remitoId: number) =>
    api.get<RemitoItemParaVenta[]>(`/remitos/items-para-venta/${remitoId}`).then(r => r.data),
};
