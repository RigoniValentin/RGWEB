import api from './api';
import type { MovimientoCaja, CajaCentralTotales, NuevoMovimientoInput, DesgloseMetodo } from '../types';

export const cajaCentralApi = {
  getMovimientos: (params?: Record<string, any>) =>
    api.get<{ ingresos: MovimientoCaja[]; egresos: MovimientoCaja[] }>('/caja-central/movimientos', { params }).then(r => r.data),

  getTotales: (params?: Record<string, any>) =>
    api.get<CajaCentralTotales>('/caja-central/totales', { params }).then(r => r.data),

  getBalanceHistorico: (puntoVentaIds?: string) =>
    api.get<CajaCentralTotales>('/caja-central/balance-historico', { params: { puntoVentaIds } }).then(r => r.data),

  getFondoCambioSaldo: (puntoVentaIds?: string) =>
    api.get<{ saldo: number }>('/caja-central/fondo-cambio', { params: { puntoVentaIds } }).then(r => r.data),

  crearMovimiento: (data: NuevoMovimientoInput) =>
    api.post<{ ID: number }>('/caja-central/movimiento', data).then(r => r.data),

  eliminarMovimiento: (id: number) =>
    api.delete(`/caja-central/movimiento/${id}`).then(r => r.data),

  getDesgloseMetodos: (params?: Record<string, any>) =>
    api.get<DesgloseMetodo[]>('/caja-central/desglose-metodos', { params }).then(r => r.data),

  getDesgloseMovimiento: (movimientoId: number) =>
    api.get<DesgloseMetodo[]>(`/caja-central/movimiento/${movimientoId}/desglose-metodos`).then(r => r.data),
};
