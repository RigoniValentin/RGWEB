import api from './api';

// ═══════════════════════════════════════════════════
//  Libro IVA Compras API
// ═══════════════════════════════════════════════════

export interface LibroIvaComprasComprobante {
  COMPRA_ID: number;
  FECHA: string;
  TIPO_COMPROBANTE: string;
  TIPO_COMPROBANTE_DESCRIPCION: string;
  CODIGO_COMPROBANTE_AFIP: number;
  PUNTO_VENTA_ID: number;
  NUMERO_FISCAL: string;
  CAE: string | null;
  PROVEEDOR_ID: number;
  PROVEEDOR_NOMBRE: string;
  PROVEEDOR_CUIT: string;
  PROVEEDOR_CONDICION_IVA: string;
  TIPO_DOC_PROVEEDOR: number;
  NETO_NO_GRAVADO: number;
  NETO_GRAVADO: number;
  IVA_TOTAL: number;
  IMPUESTO_INTERNO: number;
  PERCEPCION_IVA: number;
  PERCEPCION_IIBB: number;
  TOTAL: number;
  COBRADA: boolean;
  ALICUOTA_IVA_ESTIMADA: number;
}

export interface LibroIvaComprasTotales {
  CANTIDAD_COMPROBANTES: number;
  CANTIDAD_FACTURAS: number;
  CANTIDAD_NC: number;
  TOTAL_NETO_NO_GRAVADO: number;
  TOTAL_NETO_GRAVADO: number;
  TOTAL_IVA: number;
  TOTAL_IMPUESTO_INTERNO: number;
  TOTAL_PERCEPCION_IVA: number;
  TOTAL_PERCEPCION_IIBB: number;
  TOTAL_GENERAL: number;
}

export interface LibroIvaComprasAlicuota {
  ALICUOTA: number;
  ALICUOTA_DESCRIPCION: string;
  CANTIDAD_COMPROBANTES: number;
  BASE_IMPONIBLE: number;
  CREDITO_FISCAL: number;
}

export interface PuntoVentaOption {
  PUNTO_VENTA_ID: number;
  NOMBRE: string;
}

export interface LibroIvaComprasFilter {
  fechaDesde: string;
  fechaHasta: string;
  puntoVentaId?: number;
  tipoComprobante?: string;
  incluirNoCobradas?: boolean;
}

function buildParams(filter: LibroIvaComprasFilter) {
  const params: Record<string, string> = {
    fechaDesde: filter.fechaDesde,
    fechaHasta: filter.fechaHasta,
  };
  if (filter.puntoVentaId)    params.puntoVentaId    = String(filter.puntoVentaId);
  if (filter.tipoComprobante) params.tipoComprobante = filter.tipoComprobante;
  if (filter.incluirNoCobradas) params.incluirNoCobradas = 'true';
  return params;
}

export const libroIvaComprasApi = {
  getComprobantes: (filter: LibroIvaComprasFilter) =>
    api.get<LibroIvaComprasComprobante[]>('/libro-iva-compras/comprobantes', { params: buildParams(filter) }).then(r => r.data),

  getTotales: (filter: LibroIvaComprasFilter) =>
    api.get<LibroIvaComprasTotales>('/libro-iva-compras/totales', { params: buildParams(filter) }).then(r => r.data),

  getAlicuotas: (filter: LibroIvaComprasFilter) =>
    api.get<LibroIvaComprasAlicuota[]>('/libro-iva-compras/alicuotas', { params: buildParams(filter) }).then(r => r.data),

  getPuntosDeVenta: () =>
    api.get<PuntoVentaOption[]>('/libro-iva-compras/puntos-venta').then(r => r.data),

  exportCiti: (filter: LibroIvaComprasFilter) =>
    api.get<{ comprobantes: string; alicuotas: string }>('/libro-iva-compras/export-citi', { params: buildParams(filter) }).then(r => r.data),
};
