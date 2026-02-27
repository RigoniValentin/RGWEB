import api from './api';
import type { Categoria, PaginatedResponse } from '../types';

export interface CategoriaInput {
  CODIGOPARTICULAR?: string;
  NOMBRE: string;
  GUARDA_VENCIMIENTO?: boolean;
  ACTIVA?: boolean;
}

export const categoryApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Categoria>>('/categories', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<Categoria>(`/categories/${id}`).then(r => r.data),

  getNextCode: () =>
    api.get<{ code: string }>('/categories/next-code').then(r => r.data.code),

  create: (data: CategoriaInput) =>
    api.post<{ CATEGORIA_ID: number }>('/categories', data).then(r => r.data),

  update: (id: number, data: CategoriaInput) =>
    api.put('/categories/' + id, data).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ mode: 'soft' | 'hard' }>('/categories/' + id).then(r => r.data),
};
