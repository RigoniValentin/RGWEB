import api from './api';
import type { PuntoVenta, PuntoVentaDetalle, PaginatedResponse } from '../types';

export interface PuntoVentaInput {
  NOMBRE: string;
  DIRECCION?: string | null;
  COMENTARIOS?: string | null;
  ACTIVO?: boolean;
  depositos?: number[];
  depositoPreferido?: number | null;
  usuarios?: number[];
  usuarioPreferido?: number | null;
}

export const puntoVentaApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<PuntoVenta>>('/puntos-venta', { params }).then(r => r.data),

  getSelector: () =>
    api.get<Pick<PuntoVenta, 'PUNTO_VENTA_ID' | 'NOMBRE' | 'ACTIVO'>[]>('/puntos-venta/selector').then(r => r.data),

  getById: (id: number) =>
    api.get<PuntoVentaDetalle>(`/puntos-venta/${id}`).then(r => r.data),

  create: (data: PuntoVentaInput) =>
    api.post<{ PUNTO_VENTA_ID: number }>('/puntos-venta', data).then(r => r.data),

  update: (id: number, data: PuntoVentaInput) =>
    api.put('/puntos-venta/' + id, data).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ mode: 'hard' }>('/puntos-venta/' + id).then(r => r.data),
};
