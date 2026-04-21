import api from './api';
import type { MetodoPago, MetodoPagoItem } from '../types';

// ── Types ─────────────────────────────────────────

export interface OrdenPagoGeneralItem {
  PAGO_ID: number;
  CTA_CORRIENTE_ID: number;
  FECHA: string;
  TOTAL: number;
  CONCEPTO: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  USUARIO: string;
  PROVEEDOR_ID: number;
  PROVEEDOR_NOMBRE: string;
}

export interface OrdenPagoGeneralInput {
  proveedorId: number;
  FECHA: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  CONCEPTO: string;
  DESTINO_PAGO?: 'CAJA_CENTRAL' | 'CAJA';
  metodos_pago?: MetodoPagoItem[];
}

export interface OrdenPagoEditData extends OrdenPagoGeneralItem {
  metodos_pago: MetodoPagoItem[];
}

export interface ProveedorCtaCorriente {
  PROVEEDOR_ID: number;
  CTA_CORRIENTE_ID: number;
  NOMBRE: string;
  CODIGOPARTICULAR: string;
  NUMERO_DOC: string;
  SALDO_ACTUAL: number;
}

export interface OrdenPagoReciboMetodoPago {
  METODO_PAGO_ID: number;
  MONTO: number;
  METODO_NOMBRE: string;
  CATEGORIA: string;
}

export interface OrdenPagoReciboData {
  PAGO_ID: number;
  CTA_CORRIENTE_ID: number;
  FECHA: string;
  TOTAL: number;
  CONCEPTO: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  USUARIO: string;
  PROVEEDOR_ID: number;
  PROVEEDOR_NOMBRE: string;
  PROVEEDOR_CODIGO: string;
  PROVEEDOR_DOMICILIO: string | null;
  PROVEEDOR_LOCALIDAD: string | null;
  PROVEEDOR_DOCUMENTO: string | null;
  SALDO_ACTUAL: number;
  metodos_pago: OrdenPagoReciboMetodoPago[];
  empresa: {
    NOMBRE_FANTASIA?: string;
    RAZON_SOCIAL?: string;
    DOMICILIO_FISCAL?: string;
    CUIT?: string;
    CONDICION_IVA?: string;
  };
}

// ── API ───────────────────────────────────────────
export const ordenesPagoApi = {
  // List all ordenes de pago (general)
  getAll: (fechaDesde?: string, fechaHasta?: string, search?: string) =>
    api.get<OrdenPagoGeneralItem[]>('/ordenes-pago', {
      params: { fechaDesde, fechaHasta, search },
    }).then(r => r.data),

  // List suppliers with cta corriente for selector
  getProveedores: (search?: string) =>
    api.get<ProveedorCtaCorriente[]>('/ordenes-pago/proveedores', {
      params: { search },
    }).then(r => r.data),

  // Get active payment methods
  getActivePaymentMethods: () =>
    api.get<MetodoPago[]>('/ordenes-pago/active-payment-methods').then(r => r.data),

  // Get aggregated payment method totals
  getMetodosTotales: (fechaDesde?: string, fechaHasta?: string, search?: string) =>
    api.get<{ METODO_NOMBRE: string; CATEGORIA: string; IMAGEN_BASE64: string; TOTAL: number }[]>(
      '/ordenes-pago/metodos-totales', { params: { fechaDesde, fechaHasta, search } },
    ).then(r => r.data),

  // Get single orden de pago for editing
  getOrdenPagoById: (pagoId: number) =>
    api.get<OrdenPagoEditData>(`/ordenes-pago/${pagoId}`).then(r => r.data),

  // Get full recibo data for printing
  getReciboData: (pagoId: number) =>
    api.get<OrdenPagoReciboData>(`/ordenes-pago/${pagoId}/recibo`).then(r => r.data),

  // Create orden de pago
  crearOrdenPago: (ctaId: number, data: OrdenPagoGeneralInput) =>
    api.post<{ PAGO_ID: number }>(`/ordenes-pago/${ctaId}`, data).then(r => r.data),

  // Update orden de pago
  actualizarOrdenPago: (ctaId: number, pagoId: number, data: OrdenPagoGeneralInput) =>
    api.put(`/ordenes-pago/${ctaId}/${pagoId}`, data).then(r => r.data),

  // Delete orden de pago
  eliminarOrdenPago: (pagoId: number) =>
    api.delete(`/ordenes-pago/${pagoId}`).then(r => r.data),
};
