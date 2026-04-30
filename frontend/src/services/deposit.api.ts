import api from './api';
import type { Deposito, PaginatedResponse } from '../types';

export interface DepositoInput {
  CODIGOPARTICULAR?: string;
  NOMBRE: string;
  puntosVenta?: number[];
  puntoVentaPreferido?: number | null;
}

export const depositApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Deposito>>('/deposits', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<Deposito>(`/deposits/${id}`).then(r => r.data),

  getNextCode: () =>
    api.get<{ code: string }>('/deposits/next-code').then(r => r.data.code),

  create: (data: DepositoInput) =>
    api.post<{ DEPOSITO_ID: number }>('/deposits', data).then(r => r.data),

  update: (id: number, data: DepositoInput) =>
    api.put('/deposits/' + id, data).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ mode: 'hard' }>('/deposits/' + id).then(r => r.data),
};
