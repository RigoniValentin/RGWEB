import api from './api';

export interface ReportFilter {
  fechaDesde: string;
  fechaHasta: string;
  puntoVentaId?: number;
  categoriaId?: number;
  marcaId?: number;
  clienteId?: number;
  proveedorId?: number;
  incluirNc?: boolean;
  limit?: number;
}

export interface RevenueByDimensionRow {
  ID: number | null;
  NOMBRE: string;
  CANTIDAD_VENTAS: number;
  UNIDADES_VENDIDAS: number;
  TOTAL_VENDIDO: number;
  PARTICIPACION_PCT: number;
  CODIGOPARTICULAR?: string | null;
  CATEGORIA?: string | null;
}

export interface SalesByClientRow {
  CLIENTE_ID: number | null;
  CODIGOPARTICULAR: string | null;
  CLIENTE: string;
  CANTIDAD_VENTAS: number;
  TOTAL: number;
  TICKET_PROMEDIO: number;
  ULTIMA_VENTA: string | null;
}

export interface SalesByProductRow {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  PRODUCTO: string;
  CATEGORIA: string;
  MARCA: string;
  CANTIDAD_VENDIDA: number;
  VENTAS_DISTINTAS: number;
  TOTAL_INGRESOS: number;
  PRECIO_PROMEDIO: number;
}

export interface SalesGeneralRow {
  VENTA_ID: number;
  FECHA_VENTA: string;
  CLIENTE: string;
  PRODUCTOS: string;
  TOTAL: number;
  GANANCIA: number;
  EFECTIVO: number;
  DIGITAL: number;
  TIPO_COMPROBANTE: string | null;
}

export interface SalesBySucursalRow {
  PUNTO_VENTA_ID: number | null;
  SUCURSAL: string;
  CANTIDAD_VENTAS: number;
  TOTAL_VENDIDO: number;
  GANANCIA: number;
  TICKET_PROMEDIO: number;
}

export interface SalesTimelineRow {
  BUCKET: string;
  VENTAS: number;
  TOTAL: number;
  GANANCIA: number;
}

export interface SalesHeatmapRow {
  DOW: number;
  HOUR: number;
  VENTAS: number;
  TOTAL: number;
}

export interface TopProductRow {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  NOMBRE: string;
  CATEGORIA: string;
  UNIDADES_VENDIDAS: number;
  TOTAL_VENDIDO: number;
  VENTAS_DISTINTAS: number;
}

export interface PurchasesBySupplierRow {
  PROVEEDOR_ID: number;
  CODIGOPARTICULAR: string | null;
  PROVEEDOR: string;
  CANTIDAD_COMPROBANTES: number;
  TOTAL: number;
  IVA_TOTAL: number;
  PERCEPCIONES: number;
}

export interface PurchasesByProductRow {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  PRODUCTO: string;
  CANTIDAD_COMPRADA: number;
  COMPRAS_DISTINTAS: number;
  TOTAL_COMPRADO: number;
  PRECIO_PROMEDIO: number;
}

export interface PurchasesGeneralRow {
  COMPROBANTE_ID: number;
  FECHA: string;
  TIPO_COMPROBANTE: string | null;
  PROVEEDOR: string;
  PRODUCTOS: string;
  TOTAL: number;
  COBRADA: boolean | number | null;
}

export interface ClientListRow {
  CLIENTE_ID: number;
  CODIGOPARTICULAR: string | null;
  NOMBRE: string;
  EMAIL: string | null;
  TELEFONO: string | null;
  NUMERO_DOC: string | null;
  CONDICION_IVA: string | null;
  CIUDAD: string | null;
  ACTIVO: boolean | number | null;
  TOTAL_VENTAS: number;
  ULTIMA_VENTA: string | null;
}

export interface ClienteTipoRow {
  TIPO: 'Nuevo' | 'Recurrente';
  CANTIDAD_CLIENTES: number;
  CANTIDAD_VENTAS: number;
  TOTAL: number;
}

export interface ProductMixRow {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  NOMBRE: string;
  CATEGORIA: string | null;
  MARCA: string | null;
  UNIDADES: number;
  TOTAL: number;
}

function buildParams(f: ReportFilter): Record<string, string> {
  const p: Record<string, string> = {
    fechaDesde: f.fechaDesde,
    fechaHasta: f.fechaHasta,
  };
  if (f.puntoVentaId) p.puntoVentaId = String(f.puntoVentaId);
  if (f.categoriaId) p.categoriaId = String(f.categoriaId);
  if (f.marcaId) p.marcaId = String(f.marcaId);
  if (f.clienteId) p.clienteId = String(f.clienteId);
  if (f.proveedorId) p.proveedorId = String(f.proveedorId);
  if (f.incluirNc) p.incluirNc = 'true';
  if (f.limit) p.limit = String(f.limit);
  return p;
}

export const reportsApi = {
  getRevenueByCategories: (f: ReportFilter) =>
    api.get<RevenueByDimensionRow[]>('/reports/revenue/by-categories', { params: buildParams(f) }).then(r => r.data),
  getRevenueByBrands: (f: ReportFilter) =>
    api.get<RevenueByDimensionRow[]>('/reports/revenue/by-brands', { params: buildParams(f) }).then(r => r.data),
  getRevenueByProducts: (f: ReportFilter) =>
    api.get<RevenueByDimensionRow[]>('/reports/revenue/by-products', { params: buildParams(f) }).then(r => r.data),

  getSalesByClient: (f: ReportFilter) =>
    api.get<SalesByClientRow[]>('/reports/sales/by-client', { params: buildParams(f) }).then(r => r.data),
  getSalesByProduct: (f: ReportFilter) =>
    api.get<SalesByProductRow[]>('/reports/sales/by-product', { params: buildParams(f) }).then(r => r.data),
  getSalesBySucursal: (f: ReportFilter) =>
    api.get<SalesBySucursalRow[]>('/reports/sales/by-sucursal', { params: buildParams(f) }).then(r => r.data),
  getSalesGeneral: (f: ReportFilter) =>
    api.get<SalesGeneralRow[]>('/reports/sales/general', { params: buildParams(f) }).then(r => r.data),
  getSalesTimeline: (f: ReportFilter, granularity: 'day' | 'week' | 'month') =>
    api.get<SalesTimelineRow[]>('/reports/sales/timeline', { params: { ...buildParams(f), granularity } }).then(r => r.data),
  getSalesHeatmap: (f: ReportFilter) =>
    api.get<SalesHeatmapRow[]>('/reports/sales/heatmap', { params: buildParams(f) }).then(r => r.data),

  getTopProductsByUnidades: (f: ReportFilter) =>
    api.get<TopProductRow[]>('/reports/products/top-unidades', { params: buildParams(f) }).then(r => r.data),
  getTopProductsByIngresos: (f: ReportFilter) =>
    api.get<TopProductRow[]>('/reports/products/top-ingresos', { params: buildParams(f) }).then(r => r.data),
  getProductMix: (f: ReportFilter, dimension: 'categoria' | 'marca') =>
    api.get<ProductMixRow[]>('/reports/products/mix', { params: { ...buildParams(f), dimension } }).then(r => r.data),

  getPurchasesBySupplier: (f: ReportFilter) =>
    api.get<PurchasesBySupplierRow[]>('/reports/purchases/by-supplier', { params: buildParams(f) }).then(r => r.data),
  getPurchasesByProduct: (f: ReportFilter) =>
    api.get<PurchasesByProductRow[]>('/reports/purchases/by-product', { params: buildParams(f) }).then(r => r.data),
  getPurchasesGeneral: (f: ReportFilter) =>
    api.get<PurchasesGeneralRow[]>('/reports/purchases/general', { params: buildParams(f) }).then(r => r.data),

  getClientList: (params: { search?: string; activo?: boolean }) =>
    api.get<ClientListRow[]>('/reports/clients/list', { params }).then(r => r.data),
  getClientesNuevosVsRecurrentes: (f: ReportFilter) =>
    api.get<ClienteTipoRow[]>('/reports/clients/nuevos-vs-recurrentes', { params: buildParams(f) }).then(r => r.data),
};