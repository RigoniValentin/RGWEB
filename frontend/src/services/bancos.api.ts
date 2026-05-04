import api from './api';
import type { Banco } from '../types';

export interface BancoInput {
  NOMBRE: string;
  CUIT?: string | null;
  CODIGO_BCRA?: string | null;
  ACTIVO?: boolean;
}

export interface BancoFilter {
  search?: string;
  activo?: boolean;
}

export const bancosApi = {
  getAll: (params?: BancoFilter) =>
    api.get<Banco[]>('/bancos', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<Banco>(`/bancos/${id}`).then(r => r.data),

  create: (data: BancoInput) =>
    api.post<Banco>('/bancos', data).then(r => r.data),

  update: (id: number, data: Partial<BancoInput>) =>
    api.put<Banco>(`/bancos/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ ok: true }>(`/bancos/${id}`).then(r => r.data),
};
