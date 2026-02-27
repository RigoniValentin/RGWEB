import api from './api';
import type { Marca, PaginatedResponse } from '../types';

export interface MarcaInput {
  CODIGOPARTICULAR?: string;
  NOMBRE: string;
  ACTIVA?: boolean;
}

export const brandApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Marca>>('/brands', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<Marca>(`/brands/${id}`).then(r => r.data),

  getNextCode: () =>
    api.get<{ code: string }>('/brands/next-code').then(r => r.data.code),

  create: (data: MarcaInput) =>
    api.post<{ MARCA_ID: number }>('/brands', data).then(r => r.data),

  update: (id: number, data: MarcaInput) =>
    api.put('/brands/' + id, data).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ mode: 'soft' | 'hard' }>('/brands/' + id).then(r => r.data),
};
