import api from './api';
import type { Cheque, ChequeEstado, PaginatedResponse } from '../types';

export interface ChequeFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  estado?: ChequeEstado | 'TODOS';
  desde?: string;
  hasta?: string;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface ChequeInput {
  BANCO_ID?: number | null;
  BANCO: string;
  LIBRADOR: string;
  NUMERO: string;
  IMPORTE: number;
  PORTADOR?: string | null;
  FECHA_PRESENTACION?: string | null;
  OBSERVACIONES?: string | null;
}

export interface ChequeResumen {
  enCarteraCount: number;
  enCarteraTotal: number;
  egresadoTotal: number;
  depositadoTotal: number;
}

export interface SalidaPayload {
  chequeIds: number[];
  estadoDestino: 'DEPOSITADO' | 'ANULADO';
  descripcion?: string;
  destinoDesc?: string;
}

export const chequesApi = {
  getAll: (params?: ChequeFilter) =>
    api.get<PaginatedResponse<Cheque>>('/cheques', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<Cheque & { historial: Array<{ ESTADO_ANTERIOR: string | null; ESTADO_NUEVO: string; DESCRIPCION: string | null; FECHA: string; USUARIO_NOMBRE: string | null }> }>(`/cheques/${id}`).then(r => r.data),

  getEnCartera: () =>
    api.get<Cheque[]>('/cheques/cartera').then(r => r.data),

  getResumen: () =>
    api.get<ChequeResumen>('/cheques/resumen').then(r => r.data),

  create: (data: ChequeInput) =>
    api.post<{ CHEQUE_ID: number }>('/cheques', data).then(r => r.data),

  update: (id: number, data: Partial<ChequeInput>) =>
    api.put<{ ok: true }>(`/cheques/${id}`, data).then(r => r.data),

  cambiarEstado: (id: number, payload: { estado: ChequeEstado; descripcion?: string; destinoTipo?: string; destinoId?: number; destinoDesc?: string }) =>
    api.put<{ ok: true }>(`/cheques/${id}/estado`, payload).then(r => r.data),

  salidaMasiva: (payload: SalidaPayload) =>
    api.post<{ procesados: number; total: number }>('/cheques/salida', payload).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ mode: 'soft' }>(`/cheques/${id}`).then(r => r.data),
};
