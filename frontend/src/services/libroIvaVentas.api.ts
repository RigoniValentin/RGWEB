import api from './api';

// ═══════════════════════════════════════════════════
//  Libro IVA Ventas API
// ═══════════════════════════════════════════════════

export interface LibroIvaComprobante {
  VENTA_ID: number;
  FECHA: string;
  TIPO_COMPROBANTE: string;
  TIPO_COMPROBANTE_DESCRIPCION: string;
  CODIGO_COMPROBANTE_AFIP: number;
  PUNTO_VENTA_ID: number;
  PUNTO_VENTA_NOMBRE: string;
  NUMERO_FISCAL: string;
  CAE: string;
  CLIENTE_ID: number;
  CLIENTE_NOMBRE: string;
  CLIENTE_CUIT: string;
  CLIENTE_CONDICION_IVA: string;
  TIPO_DOC_CLIENTE: number;
  NETO_NO_GRAVADO: number;
  NETO_GRAVADO: number;
  IVA_TOTAL: number;
  IMPUESTO_INTERNO: number;
  TOTAL: number;
  COBRADA: boolean;
  ALICUOTA_IVA_ESTIMADA: number;
}

export interface LibroIvaTotales {
  CANTIDAD_COMPROBANTES: number;
  CANTIDAD_FACTURAS: number;
  CANTIDAD_NC: number;
  TOTAL_NETO_NO_GRAVADO: number;
  TOTAL_NETO_GRAVADO: number;
  TOTAL_IVA: number;
  TOTAL_IMPUESTO_INTERNO: number;
  TOTAL_GENERAL: number;
}

export interface LibroIvaAlicuota {
  ALICUOTA: number;
  ALICUOTA_DESCRIPCION: string;
  CANTIDAD_COMPROBANTES: number;
  BASE_IMPONIBLE: number;
  DEBITO_FISCAL: number;
}

export interface PuntoVentaOption {
  PUNTO_VENTA_ID: number;
  NOMBRE: string;
}

export interface LibroIvaFilter {
  fechaDesde: string;
  fechaHasta: string;
  puntoVentaId?: number;
  tipoComprobante?: string;
  incluirNoCobradas?: boolean;
}

function buildParams(filter: LibroIvaFilter) {
  const params: Record<string, string> = {
    fechaDesde: filter.fechaDesde,
    fechaHasta: filter.fechaHasta,
  };
  if (filter.puntoVentaId) params.puntoVentaId = String(filter.puntoVentaId);
  if (filter.tipoComprobante) params.tipoComprobante = filter.tipoComprobante;
  if (filter.incluirNoCobradas) params.incluirNoCobradas = 'true';
  return params;
}

export const libroIvaVentasApi = {
  getComprobantes: (filter: LibroIvaFilter) =>
    api.get<LibroIvaComprobante[]>('/libro-iva-ventas/comprobantes', { params: buildParams(filter) }).then(r => r.data),

  getTotales: (filter: LibroIvaFilter) =>
    api.get<LibroIvaTotales>('/libro-iva-ventas/totales', { params: buildParams(filter) }).then(r => r.data),

  getAlicuotas: (filter: LibroIvaFilter) =>
    api.get<LibroIvaAlicuota[]>('/libro-iva-ventas/alicuotas', { params: buildParams(filter) }).then(r => r.data),

  getPuntosDeVenta: () =>
    api.get<PuntoVentaOption[]>('/libro-iva-ventas/puntos-venta').then(r => r.data),

  exportCiti: (filter: LibroIvaFilter) =>
    api.get<{ comprobantes: string; alicuotas: string }>('/libro-iva-ventas/export-citi', { params: buildParams(filter) }).then(r => r.data),
};
