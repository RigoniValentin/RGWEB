import api from './api';
import type { Caja, CajaDetalle, PaginatedResponse, AbrirCajaInput, CerrarCajaInput, IngresoEgresoInput, FondoCambio, TransferFCInput, CajaAbierta, DesgloseMetodo } from '../types';

export const cajaApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Caja>>('/caja', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<CajaDetalle>(`/caja/${id}`).then(r => r.data),

  getMiCaja: () =>
    api.get<Caja | null>('/caja/mi-caja').then(r => r.data),

  abrir: (data: AbrirCajaInput) =>
    api.post<{ CAJA_ID: number }>('/caja/abrir', data).then(r => r.data),

  cerrar: (id: number, data: CerrarCajaInput) =>
    api.post<{ success: boolean }>(`/caja/${id}/cerrar`, data).then(r => r.data),

  addIngresoEgreso: (cajaId: number, data: IngresoEgresoInput) =>
    api.post<{ ITEM_ID: number }>(`/caja/${cajaId}/ingreso-egreso`, data).then(r => r.data),

  deleteItem: (cajaId: number, itemId: number) =>
    api.delete(`/caja/${cajaId}/items/${itemId}`).then(r => r.data),

  getFondoCambioSaldo: (puntoVentaId?: number) =>
    api.get<{ saldo: number }>('/caja/fondo-cambio', { params: { puntoVentaId } }).then(r => r.data),

  getFondoCambioHistory: (puntoVentaId?: number, limit?: number) =>
    api.get<FondoCambio[]>('/caja/fondo-cambio/history', { params: { puntoVentaId, limit } }).then(r => r.data),

  getCajasAbiertas: (puntoVentaId?: number) =>
    api.get<CajaAbierta[]>('/caja/cajas-abiertas', { params: { puntoVentaId } }).then(r => r.data),

  getEfectivoCajaCentral: (puntoVentaId?: number) =>
    api.get<{ efectivo: number }>('/caja/efectivo-caja-central', { params: { puntoVentaId } }).then(r => r.data),

  transferirFondoCambio: (data: TransferFCInput) =>
    api.post<{ success: boolean; nuevoSaldoFondo: number }>('/caja/fondo-cambio/transferir', data).then(r => r.data),

  getDesgloseMetodos: (cajaId: number) =>
    api.get<DesgloseMetodo[]>(`/caja/${cajaId}/desglose-metodos`).then(r => r.data),
};
