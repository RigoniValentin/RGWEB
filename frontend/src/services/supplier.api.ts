import api from './api';
import type { Proveedor, PaginatedResponse } from '../types';

export const supplierApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Proveedor>>('/suppliers', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<Proveedor>(`/suppliers/${id}`).then(r => r.data),
};
