import api from './api';
import type { Cliente, PaginatedResponse } from '../types';

export const customerApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Cliente>>('/customers', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<Cliente>(`/customers/${id}`).then(r => r.data),

  getCtaCorriente: (id: number) =>
    api.get(`/customers/${id}/cta-corriente`).then(r => r.data),
};
