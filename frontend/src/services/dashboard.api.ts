import api from './api';
import type { DashboardStats, VentaDiaria } from '../types';

export const dashboardApi = {
  getStats: (puntoVentaId?: number) =>
    api.get<DashboardStats>('/dashboard/stats', { params: { puntoVentaId } }).then(r => r.data),

  getVentasPorDia: (dias?: number, puntoVentaId?: number) =>
    api.get<VentaDiaria[]>('/dashboard/ventas-por-dia', { params: { dias, puntoVentaId } }).then(r => r.data),
};
