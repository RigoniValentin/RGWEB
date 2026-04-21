import api from './api';
import type { MetodoPago, MetodoPagoItem } from '../types';

// ── Types ─────────────────────────────────────────

export interface CobranzaGeneralItem {
  PAGO_ID: number;
  CTA_CORRIENTE_ID: number;
  FECHA: string;
  TOTAL: number;
  CONCEPTO: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  USUARIO: string;
  CLIENTE_ID: number;
  CLIENTE_NOMBRE: string;
}

export interface CobranzaGeneralInput {
  clienteId: number;
  FECHA: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  CONCEPTO: string;
  DESTINO_COBRO?: 'CAJA_CENTRAL' | 'CAJA';
  metodos_pago?: MetodoPagoItem[];
}

export interface CobranzaEditData extends CobranzaGeneralItem {
  metodos_pago: MetodoPagoItem[];
}

export interface ClienteCtaCorriente {
  CLIENTE_ID: number;
  CTA_CORRIENTE_ID: number;
  NOMBRE: string;
  CODIGOPARTICULAR: string;
  NUMERO_DOC: string;
  SALDO_ACTUAL: number;
}

export interface ReciboMetodoPago {
  METODO_PAGO_ID: number;
  MONTO: number;
  METODO_NOMBRE: string;
  CATEGORIA: string;
}

export interface ReciboData {
  PAGO_ID: number;
  CTA_CORRIENTE_ID: number;
  FECHA: string;
  TOTAL: number;
  CONCEPTO: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  USUARIO: string;
  CLIENTE_ID: number;
  CLIENTE_NOMBRE: string;
  CLIENTE_CODIGO: string;
  CLIENTE_DOMICILIO: string | null;
  CLIENTE_LOCALIDAD: string | null;
  CLIENTE_DOCUMENTO: string | null;
  SALDO_ACTUAL: number;
  metodos_pago: ReciboMetodoPago[];
  empresa: {
    NOMBRE_FANTASIA?: string;
    RAZON_SOCIAL?: string;
    DOMICILIO_FISCAL?: string;
    CUIT?: string;
    CONDICION_IVA?: string;
  };
}

// ── API ───────────────────────────────────────────
export const cobranzasApi = {
  // List all cobranzas (general)
  getAll: (fechaDesde?: string, fechaHasta?: string, search?: string) =>
    api.get<CobranzaGeneralItem[]>('/cobranzas', {
      params: { fechaDesde, fechaHasta, search },
    }).then(r => r.data),

  // List customers with cta corriente for selector
  getClientes: (search?: string) =>
    api.get<ClienteCtaCorriente[]>('/cobranzas/clientes', {
      params: { search },
    }).then(r => r.data),

  // Get active payment methods
  getActivePaymentMethods: () =>
    api.get<MetodoPago[]>('/cobranzas/active-payment-methods').then(r => r.data),

  // Get aggregated payment method totals
  getMetodosTotales: (fechaDesde?: string, fechaHasta?: string, search?: string) =>
    api.get<{ METODO_NOMBRE: string; CATEGORIA: string; IMAGEN_BASE64: string; TOTAL: number }[]>(
      '/cobranzas/metodos-totales', { params: { fechaDesde, fechaHasta, search } },
    ).then(r => r.data),

  // Get single cobranza for editing
  getCobranzaById: (pagoId: number) =>
    api.get<CobranzaEditData>(`/cobranzas/${pagoId}`).then(r => r.data),

  // Get full recibo data for printing
  getReciboData: (pagoId: number) =>
    api.get<ReciboData>(`/cobranzas/${pagoId}/recibo`).then(r => r.data),

  // Create cobranza
  crearCobranza: (ctaId: number, data: CobranzaGeneralInput) =>
    api.post<{ PAGO_ID: number }>(`/cobranzas/${ctaId}`, data).then(r => r.data),

  // Update cobranza
  actualizarCobranza: (ctaId: number, pagoId: number, data: CobranzaGeneralInput) =>
    api.put(`/cobranzas/${ctaId}/${pagoId}`, data).then(r => r.data),

  // Delete cobranza
  eliminarCobranza: (pagoId: number) =>
    api.delete(`/cobranzas/${pagoId}`).then(r => r.data),
};
