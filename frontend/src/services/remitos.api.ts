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

  /** Confirma un remito PENDIENTE (proveniente de la app mobile): aplica el stock. */
  confirmar: (id: number) =>
    api.post<{ ok: boolean; REMITO_ID: number; ESTADO: string }>(`/remitos/${id}/confirmar`).then(r => r.data),

  /** Rechaza un remito PENDIENTE: lo marca como anulado sin tocar stock. */
  rechazar: (id: number) =>
    api.post<{ ok: boolean; REMITO_ID: number }>(`/remitos/${id}/rechazar`).then(r => r.data),

  delete: (id: number) =>
    api.delete(`/remitos/${id}`).then(r => r.data),

  searchProducts: (search: string) =>
    api.get<ProductoSearchRemito[]>('/remitos/search-products', { params: { search } }).then(r => r.data),

  searchProductsAdvanced: (params: {
    search?: string; marca?: string; categoria?: string; codigo?: string;
    soloActivos?: boolean; soloConStock?: boolean; limit?: number; busquedaMultiEntidad?: boolean;
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

  /** Remitos de entrada sin compra asociada. Si se pasa proveedorId, filtra por proveedor. */
  getSinCompraAsociada: (proveedorId?: number) =>
    api
      .get<
        {
          REMITO_ID: number;
          TIPO: string;
          FECHA: string;
          PTO_VTA: string;
          NRO_REMITO: string;
          PROVEEDOR_ID: number | null;
          TOTAL: number;
          OBSERVACIONES: string | null;
          PROVEEDOR_NOMBRE: string | null;
        }[]
      >('/remitos/sin-compra', { params: proveedorId ? { proveedorId } : {} })
      .then(r => r.data),
};
