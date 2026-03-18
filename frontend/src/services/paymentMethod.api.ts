import api from './api';
import type { MetodoPago, PaginatedResponse } from '../types';

export interface MetodoPagoInput {
  NOMBRE: string;
  CATEGORIA: 'EFECTIVO' | 'DIGITAL';
  IMAGEN_BASE64?: string | null;
  ACTIVA?: boolean;
}

export const paymentMethodApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<MetodoPago>>('/payment-methods', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<MetodoPago>(`/payment-methods/${id}`).then(r => r.data),

  create: (data: MetodoPagoInput) =>
    api.post<{ METODO_PAGO_ID: number }>('/payment-methods', data).then(r => r.data),

  update: (id: number, data: MetodoPagoInput) =>
    api.put('/payment-methods/' + id, data).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ mode: 'hard' }>('/payment-methods/' + id).then(r => r.data),
};
