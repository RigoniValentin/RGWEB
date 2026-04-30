import api from './api';
import type {
  Venta, VentaDetalle, VentaInput, PaymentInput,
  PaginatedResponse, ProductoSearch, ClienteVenta, Deposito,
  MetodoPago, VentaMetodoPago, EmpresaData,
} from '../types';

export interface DepositoPV extends Deposito {
  ES_PREFERIDO: boolean;
}

export interface FacturaDataVenta {
  VENTA_ID: number;
  FECHA_VENTA: string;
  TOTAL: number;
  SUBTOTAL: number | null;
  DTO_GRAL: number | null;
  NUMERO_FISCAL: string;
  CAE: string;
  PUNTO_VENTA: string;
  TIPO_COMPROBANTE: string;
  NETO_GRAVADO: number | null;
  NETO_NO_GRAVADO: number | null;
  NETO_EXENTO: number | null;
  IVA_TOTAL: number | null;
  CLIENTE_NOMBRE: string;
  CLIENTE_NUMERO_DOC: string | null;
  CLIENTE_TIPO_DOC: string | null;
  CLIENTE_CONDICION_IVA: string | null;
  CLIENTE_DOMICILIO: string | null;
  items: FacturaDataItem[];
}

export interface FacturaDataItem {
  PRECIO_UNITARIO: number;
  CANTIDAD: number;
  DESCUENTO: number;
  PRECIO_UNITARIO_DTO: number | null;
  IVA_ALICUOTA: number;
  IVA_MONTO: number;
  PRODUCTO_NOMBRE: string;
  PRODUCTO_CODIGO: string;
  UNIDAD_ABREVIACION: string;
}

export interface FacturaData {
  venta: FacturaDataVenta;
  feResp: {
    CAE: string;
    VENCIMIENTO_CAE: string;
    COMPROBANTE_NRO: string;
    COMPROBANTE_TIPO: string;
  } | null;
  empresa: EmpresaData;
}

export const salesApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Venta>>('/sales', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<VentaDetalle>(`/sales/${id}`).then(r => r.data),

  create: (data: VentaInput) =>
    api.post<{ VENTA_ID: number; TOTAL: number; MONTO_ANTICIPO?: number; COBRADA?: boolean }>('/sales', data).then(r => r.data),

  update: (id: number, data: VentaInput) =>
    api.put(`/sales/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    api.delete(`/sales/${id}`).then(r => r.data),

  pay: (id: number, data: PaymentInput) =>
    api.post<{ ok: boolean; cobrada: boolean }>(`/sales/${id}/pay`, data).then(r => r.data),

  unpay: (id: number) =>
    api.post(`/sales/${id}/unpay`).then(r => r.data),

  searchProducts: (search: string, listaId?: number, signal?: AbortSignal) =>
    api.get<ProductoSearch[]>('/sales/search-products', { params: { search, listaId }, signal }).then(r => r.data),

  searchProductsAdvanced: (params: {
    search?: string; marca?: string; categoria?: string; codigo?: string;
    soloActivos?: boolean; soloConStock?: boolean; listaId?: number; limit?: number;
  }, signal?: AbortSignal) =>
    api.get<ProductoSearch[]>('/sales/search-products-advanced', { params, signal }).then(r => r.data),

  getBalanzaProduct: (code: string, listaId?: number, signal?: AbortSignal) =>
    api.get<{ product: ProductoSearch; cantidad: number }>(`/sales/balanza-product/${code}`, { params: { listaId }, signal }).then(r => r.data),

  getSaldoCtaCte: (clienteId: number) =>
    api.get<{ saldo: number; ctaCorrienteId: number | null }>(`/sales/saldo-cta-cte/${clienteId}`).then(r => r.data),

  getClientes: () =>
    api.get<ClienteVenta[]>('/sales/clientes').then(r => r.data),

  getDepositos: () =>
    api.get<Deposito[]>('/sales/depositos').then(r => r.data),

  getDepositosPV: (pvId: number) =>
    api.get<DepositoPV[]>(`/sales/depositos-pv/${pvId}`).then(r => r.data),

  getEmpresaIva: () =>
    api.get<{ CONDICION_IVA: string | null }>('/sales/empresa-iva').then(r => r.data),

  getEmpresaInfo: () =>
    api.get<{
      NOMBRE_FANTASIA: string;
      RAZON_SOCIAL: string;
      DOMICILIO_FISCAL: string;
      CONDICION_IVA: string;
      CUIT: string;
      TELEFONO_CLIENTE: string;
    }>('/sales/empresa-info').then(r => r.data),

  sendWhatsApp: (ventaId: number, telefono: string, nombreCliente: string) =>
    api.post<{ success: boolean }>(`/sales/${ventaId}/whatsapp`, { telefono, nombreCliente }).then(r => r.data),

  // ── Facturación Electrónica ──
  getFEConfig: () =>
    api.get<{ utilizaFE: boolean }>('/sales/fe-config').then(r => r.data),

  facturar: (ventaId: number) =>
    api.post<{
      success: boolean;
      comprobante_nro: string;
      cae: string;
      cae_vto: string;
      tipo_comprobante: string;
      errores?: string[];
    }>(`/sales/${ventaId}/facturar`).then(r => r.data),

  getFERespuesta: (ventaId: number) =>
    api.get(`/sales/${ventaId}/fe-respuesta`).then(r => r.data),

  getFacturaData: (ventaId: number) =>
    api.get<FacturaData>(`/sales/${ventaId}/factura-data`).then(r => r.data),

  getActivePaymentMethods: () =>
    api.get<MetodoPago[]>('/sales/active-payment-methods').then(r => r.data),

  getMetodosPagoVenta: (ventaId: number) =>
    api.get<VentaMetodoPago[]>(`/sales/${ventaId}/metodos-pago`).then(r => r.data),
};
