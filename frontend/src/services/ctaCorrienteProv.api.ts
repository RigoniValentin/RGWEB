import api from './api';import type { MetodoPago, MetodoPagoItem } from '../types';
// ── Types ─────────────────────────────────────────
export interface CtaCorrienteProvListItem {
  CTA_CORRIENTE_ID: number;
  PROVEEDOR_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  NUMERO_DOC: string;
  TELEFONO: string | null;
  ESTADO_CUENTA: 'SIN_CREAR' | 'CREADA_SIN_MOV' | 'ACTIVA';
  SALDO_ACTUAL: number;
  ULTIMA_TRANSACCION: string | null;
  CANTIDAD_MOVIMIENTOS: number;
}

export interface MovimientoCtaCteProv {
  COMPROBANTE_ID: number;
  FECHA: string;
  CONCEPTO: string;
  TIPO_COMPROBANTE: string;
  DEBE: number;
  HABER: number;
  SALDO: number;
}

export interface CtaCorrienteProvTotales {
  TOTAL_DEBE: number;
  TOTAL_HABER: number;
  SALDO: number;
}

export interface MovimientosProvResponse {
  movimientos: MovimientoCtaCteProv[];
  saldoAnterior: number;
  totales: CtaCorrienteProvTotales;
}

export interface OrdenPagoItem {
  PAGO_ID: number;
  CTA_CORRIENTE_ID: number;
  FECHA: string;
  TOTAL: number;
  CONCEPTO: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  USUARIO: string;
}

export interface OrdenPagoInput {
  proveedorId: number;
  FECHA: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  CONCEPTO: string;
  DESTINO_PAGO?: 'CAJA_CENTRAL' | 'CAJA';
  metodos_pago?: MetodoPagoItem[];
}

export interface OrdenPagoEditData extends OrdenPagoItem {
  metodos_pago: MetodoPagoItem[];
}

// ── API ───────────────────────────────────────────
export const ctaCorrienteProvApi = {
  // List all suppliers with CTA_CORRIENTE flag
  getAll: (search?: string) =>
    api.get<CtaCorrienteProvListItem[]>('/cta-corriente-prov', { params: { search } }).then(r => r.data),

  // Create cta corriente for a supplier
  crearCuenta: (proveedorId: number) =>
    api.post<{ CTA_CORRIENTE_ID: number }>(`/cta-corriente-prov/${proveedorId}/crear`).then(r => r.data),

  // Get movements (detalle)
  getMovimientos: (ctaId: number, fechaDesde?: string, fechaHasta?: string) =>
    api.get<MovimientosProvResponse>(`/cta-corriente-prov/${ctaId}/movimientos`, {
      params: { fechaDesde, fechaHasta },
    }).then(r => r.data),

  // Get ordenes de pago
  getOrdenesPago: (ctaId: number, fechaDesde?: string, fechaHasta?: string) =>
    api.get<OrdenPagoItem[]>(`/cta-corriente-prov/${ctaId}/ordenes-pago`, {
      params: { fechaDesde, fechaHasta },
    }).then(r => r.data),

  // Get single orden de pago for editing
  getOrdenPagoById: (pagoId: number) =>
    api.get<OrdenPagoEditData>(`/cta-corriente-prov/orden-pago/${pagoId}`).then(r => r.data),

  // Get active payment methods
  getActivePaymentMethods: () =>
    api.get<MetodoPago[]>('/cta-corriente-prov/active-payment-methods').then(r => r.data),

  // Create orden de pago
  crearOrdenPago: (ctaId: number, data: OrdenPagoInput) =>
    api.post<{ PAGO_ID: number }>(`/cta-corriente-prov/${ctaId}/orden-pago`, data).then(r => r.data),

  // Update orden de pago
  actualizarOrdenPago: (ctaId: number, pagoId: number, data: OrdenPagoInput) =>
    api.put(`/cta-corriente-prov/${ctaId}/orden-pago/${pagoId}`, data).then(r => r.data),

  // Delete orden de pago
  eliminarOrdenPago: (pagoId: number) =>
    api.delete(`/cta-corriente-prov/orden-pago/${pagoId}`).then(r => r.data),
};
