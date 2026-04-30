import api from './api';
import type { Cliente, PaginatedResponse } from '../types';

export interface ClienteInput {
  CODIGOPARTICULAR?: string;
  NOMBRE: string;
  DOMICILIO?: string | null;
  CIUDAD?: string | null;
  CP?: string | null;
  PROVINCIA?: string | null;
  TELEFONO?: string | null;
  EMAIL?: string | null;
  TIPO_DOCUMENTO?: string;
  NUMERO_DOC?: string;
  CONDICION_IVA?: string | null;
  RUBRO?: string | null;
  FECHA_NACIMIENTO?: string | null;
  CTA_CORRIENTE?: boolean;
  ACTIVO?: boolean;
}

export const customerApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Cliente>>('/customers', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<Cliente>(`/customers/${id}`).then(r => r.data),

  getCtaCorriente: (id: number) =>
    api.get(`/customers/${id}/cta-corriente`).then(r => r.data),

  getNextCode: () =>
    api.get<{ code: string }>('/customers/next-code').then(r => r.data.code),

  create: (data: ClienteInput) =>
    api.post<{ CLIENTE_ID: number }>('/customers', data).then(r => r.data),

  update: (id: number, data: ClienteInput) =>
    api.put('/customers/' + id, data).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ mode: 'soft' | 'hard' }>('/customers/' + id).then(r => r.data),
};
