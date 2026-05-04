import api from './api';
import type { MetodoPago, MetodoPagoItem } from '../types';

// ── Types ─────────────────────────────────────────

export interface GastoServicioItem {
  GASTO_ID: number;
  ENTIDAD: string;
  DESCRIPCION: string | null;
  CATEGORIA: string | null;
  MONTO: number;
  FECHA: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  CTA_CTE: number;
  USUARIO_ID: number | null;
  USUARIO_NOMBRE: string | null;
  PUNTO_VENTA_ID: number | null;
  MOVIMIENTO_CAJA_ID: number | null;
}

export interface GastoServicioDetail extends GastoServicioItem {
  metodos_pago: MetodoPagoItem[];
  cheques_ids: number[];
}

export interface GastoServicioInput {
  ENTIDAD: string;
  DESCRIPCION?: string;
  CATEGORIA?: string;
  FECHA: string;
  metodos_pago: MetodoPagoItem[];
  /** IDs de cheques EN_CARTERA a egresar (categoría CHEQUES). */
  cheques_ids?: number[];
  puntoVentaId?: number;
}

export interface GastoMetodoTotal {
  METODO_NOMBRE: string;
  CATEGORIA: string;
  IMAGEN_BASE64: string;
  TOTAL: number;
}

// ── API ───────────────────────────────────────────
export const expensesApi = {
  getAll: (fechaDesde?: string, fechaHasta?: string, search?: string, puntoVentaIds?: string) =>
    api.get<GastoServicioItem[]>('/expenses', {
      params: { fechaDesde, fechaHasta, search, puntoVentaIds },
    }).then(r => r.data),

  getById: (gastoId: number) =>
    api.get<GastoServicioDetail>(`/expenses/${gastoId}`).then(r => r.data),

  getActivePaymentMethods: () =>
    api.get<MetodoPago[]>('/expenses/active-payment-methods').then(r => r.data),

  getMetodosTotales: (fechaDesde?: string, fechaHasta?: string, search?: string, puntoVentaIds?: string) =>
    api.get<GastoMetodoTotal[]>('/expenses/metodos-totales', {
      params: { fechaDesde, fechaHasta, search, puntoVentaIds },
    }).then(r => r.data),

  getEntidades: () =>
    api.get<string[]>('/expenses/entidades').then(r => r.data),

  crear: (data: GastoServicioInput) =>
    api.post<{ GASTO_ID: number }>('/expenses', data).then(r => r.data),

  actualizar: (gastoId: number, data: GastoServicioInput) =>
    api.put(`/expenses/${gastoId}`, data).then(r => r.data),

  eliminar: (gastoId: number) =>
    api.delete(`/expenses/${gastoId}`).then(r => r.data),
};
