import api from './api';
import type { Venta, VentaDetalle, PaginatedResponse } from '../types';

export const salesApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Venta>>('/sales', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<VentaDetalle>(`/sales/${id}`).then(r => r.data),
};
