import api from './api';
import type { DashboardStats, VentaDiaria, DesgloseMetodo } from '../types';

export const dashboardApi = {
  getStats: (puntoVentaId?: number) =>
    api.get<DashboardStats>('/dashboard/stats', { params: { puntoVentaId } }).then(r => r.data),

  getVentasPorDia: (dias?: number, puntoVentaId?: number) =>
    api.get<VentaDiaria[]>('/dashboard/ventas-por-dia', { params: { dias, puntoVentaId } }).then(r => r.data),

  getDesgloseHoy: (puntoVentaId?: number) =>
    api.get<DesgloseMetodo[]>('/dashboard/desglose-hoy', { params: { puntoVentaId } }).then(r => r.data),

  getLogo: async (): Promise<string | null> => {
    try {
      const res = await api.get('/dashboard/logo', { responseType: 'blob' });
      return URL.createObjectURL(res.data);
    } catch {
      return null;
    }
  },
};
