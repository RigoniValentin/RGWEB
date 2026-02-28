import api from './api';

// ── Types ─────────────────────────────────────────
export interface CtaCorrienteListItem {
  CTA_CORRIENTE_ID: number;
  CLIENTE_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  NUMERO_DOC: string;
  TELEFONO: string | null;
  PROVINCIA: string | null;
  ESTADO_CUENTA: 'SIN_CREAR' | 'CREADA_SIN_MOV' | 'ACTIVA';
  SALDO_ACTUAL: number;
  ULTIMA_TRANSACCION: string | null;
  CANTIDAD_MOVIMIENTOS: number;
}

export interface MovimientoCtaCte {
  COMPROBANTE_ID: number;
  FECHA: string;
  CONCEPTO: string;
  TIPO_COMPROBANTE: string;
  DEBE: number;
  HABER: number;
  SALDO: number;
}

export interface CtaCorrienteTotales {
  TOTAL_DEBE: number;
  TOTAL_HABER: number;
  SALDO: number;
}

export interface MovimientosResponse {
  movimientos: MovimientoCtaCte[];
  saldoAnterior: number;
  totales: CtaCorrienteTotales;
}

export interface CobranzaItem {
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

export interface CobranzaInput {
  clienteId: number;
  FECHA: string;
  EFECTIVO: number;
  DIGITAL: number;
  CHEQUES: number;
  CONCEPTO: string;
}

// ── API ───────────────────────────────────────────
export const ctaCorrienteApi = {
  // List all customers with CTA_CORRIENTE flag
  getAll: (search?: string) =>
    api.get<CtaCorrienteListItem[]>('/cta-corriente', { params: { search } }).then(r => r.data),

  // Create cta corriente for a customer
  crearCuenta: (clienteId: number) =>
    api.post<{ CTA_CORRIENTE_ID: number }>(`/cta-corriente/${clienteId}/crear`).then(r => r.data),

  // Get movements (detalle)
  getMovimientos: (ctaId: number, fechaDesde?: string, fechaHasta?: string) =>
    api.get<MovimientosResponse>(`/cta-corriente/${ctaId}/movimientos`, {
      params: { fechaDesde, fechaHasta },
    }).then(r => r.data),

  // Get cobranzas
  getCobranzas: (ctaId: number, fechaDesde?: string, fechaHasta?: string) =>
    api.get<CobranzaItem[]>(`/cta-corriente/${ctaId}/cobranzas`, {
      params: { fechaDesde, fechaHasta },
    }).then(r => r.data),

  // Get single cobranza for editing
  getCobranzaById: (pagoId: number) =>
    api.get<CobranzaItem>(`/cta-corriente/cobranza/${pagoId}`).then(r => r.data),

  // Create cobranza
  crearCobranza: (ctaId: number, data: CobranzaInput) =>
    api.post<{ PAGO_ID: number }>(`/cta-corriente/${ctaId}/cobranza`, data).then(r => r.data),

  // Update cobranza
  actualizarCobranza: (ctaId: number, pagoId: number, data: CobranzaInput) =>
    api.put(`/cta-corriente/${ctaId}/cobranza/${pagoId}`, data).then(r => r.data),

  // Delete cobranza
  eliminarCobranza: (pagoId: number) =>
    api.delete(`/cta-corriente/cobranza/${pagoId}`).then(r => r.data),
};
