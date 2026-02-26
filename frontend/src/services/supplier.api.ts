import api from './api';
import type { Proveedor, PaginatedResponse } from '../types';

export interface ProveedorInput {
  CODIGOPARTICULAR?: string;
  NOMBRE: string;
  TELEFONO?: string | null;
  EMAIL?: string | null;
  DIRECCION?: string | null;
  CIUDAD?: string | null;
  CP?: string | null;
  TIPO_DOCUMENTO?: string;
  NUMERO_DOC?: string;
  CTA_CORRIENTE?: boolean;
  ACTIVO?: boolean;
}

export const supplierApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Proveedor>>('/suppliers', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<Proveedor>(`/suppliers/${id}`).then(r => r.data),

  getNextCode: () =>
    api.get<{ code: string }>('/suppliers/next-code').then(r => r.data.code),

  create: (data: ProveedorInput) =>
    api.post<{ PROVEEDOR_ID: number }>('/suppliers', data).then(r => r.data),

  update: (id: number, data: ProveedorInput) =>
    api.put('/suppliers/' + id, data).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ mode: 'soft' | 'hard' }>('/suppliers/' + id).then(r => r.data),
};
