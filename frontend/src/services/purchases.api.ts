import api from './api';
import type {
  Compra, CompraDetalle, CompraInput,
  PaginatedResponse, ProductoSearchCompra, ProductoSearch, ProveedorCompra, Deposito, MetodoPago,
} from '../types';

/** Precio de un producto en una lista, con su margen individual override. */
export interface PrecioEnCheck {
  LISTA_ID: number;
  PRECIO: number;
  MARGEN_INDIVIDUAL: number | null;
}

export interface PriceCheckProduct {
  PRODUCTO_ID: number;
  CODIGO: string;
  DESCRIPCION: string;
  COSTO: number;
  IMP_INTERNO: number;
  IVA_ALICUOTA: number;
  LISTA_DEFECTO: number | null;
  /** Precios por lista (dinámico, soporta N listas). */
  precios: PrecioEnCheck[];
  /** True si el producto tiene al menos un MARGEN_INDIVIDUAL != null. */
  TIENE_MARGENES_INDIV: boolean;
}

export interface PriceCheckData {
  products: PriceCheckProduct[];
  listNames: Record<number, string>;
  listMargins: Record<number, number>;
  /** 'M' = Markup sobre costo, 'U' = Utilidad sobre venta. */
  listTypes: Record<number, 'M' | 'U'>;
  preciosSinIva: boolean;
  impIntGravaIva: boolean;
}

export interface PriceCheckUpdate {
  PRODUCTO_ID: number;
  precios: { LISTA_ID: number; PRECIO: number }[];
}

// ── IA — Cargar comprobante por imagen ─────────────────────────────────
export type MatchStatus =
  | 'vinculado'
  | 'candidatos_multiples'
  | 'crear_nuevo'
  | 'omitir'
  | 'sin_match';

export interface ProductoCandidato {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  NOMBRE: string;
  STOCK_ACTUAL: number | null;
  PRECIO_COMPRA: number | null;
  PRECIO_VENTA: number | null;
  TASA_IVA_ID: number | null;
  UNIDAD_ABREVIACION: string | null;
  IVA_PORCENTAJE: number | null;
}

export interface EnrichedReceiptItem {
  codigo_proveedor: string | null;
  descripcion_proveedor: string;
  cantidad: number;
  unidad_medida: string | null;
  /** Precio unitario bruto publicado por el proveedor (sin descontar bonificación global). */
  precio_unitario: number;
  /** Precio unitario luego de descontar la bonificación global prorrateada por línea. */
  precio_unitario_neto?: number;
  descuento_porcentaje: number;
  subtotal_linea: number;
  /** Subtotal_linea × (1 - bonificación_pct) — equivale a la suma del carrito al cerrar. */
  subtotal_linea_neto?: number;
  /** Porcentaje de bonificación aplicado a la factura (0 si no hay). */
  porcentaje_bonificacion_aplicado?: number;
  sugerencia_accion: 'VINCULAR' | 'CREAR_NUEVO' | 'OMITIR';
  motivo_sugerencia: string;
  match_status: MatchStatus;
  linked_producto_id?: number;
  linked_producto?: ProductoCandidato;
  candidatos: ProductoCandidato[];
}

export interface ProveedorMatch {
  PROVEEDOR_ID: number;
  NOMBRE: string;
  CUIT: string | null;
}

export interface ParsedReceiptTotales {
  subtotal: number | null;
  bonificacion_total: number | null;
  iva_total: number | null;
  percepciones: number | null;
  total_final: number | null;
}

export interface ParsedReceiptResponse {
  ok: boolean;
  saved_path: string;
  public_url: string;
  tipo_comprobante_interno: string;
  comprobante: {
    tipo_comprobante: 'FACTURA A' | 'FACTURA B' | 'REMITO' | 'TICKET' | 'OTRO';
    numero_comprobante: string | null;
    fecha_emision: string | null;
    proveedor: { razon_social: string | null; cuit: string | null };
    cliente: { razon_social: string | null; cuit: string | null };
  };
  items: EnrichedReceiptItem[];
  totales: ParsedReceiptTotales;
  proveedor_match: ProveedorMatch | null;
  proveedores_candidatos: ProveedorMatch[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export const purchasesApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<Compra>>('/purchases', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<CompraDetalle>(`/purchases/${id}`).then(r => r.data),

  create: (data: CompraInput) =>
    api.post<{ COMPRA_ID: number; TOTAL: number; MONTO_ANTICIPO?: number; COBRADA?: boolean }>('/purchases', data).then(r => r.data),

  update: (id: number, data: CompraInput) =>
    api.put(`/purchases/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    api.delete(`/purchases/${id}`).then(r => r.data),

  searchProducts: (search: string) =>
    api.get<ProductoSearchCompra[]>('/purchases/search-products', { params: { search } }).then(r => r.data),

  searchProductsAdvanced: (params: {
    search?: string; marca?: string; categoria?: string; codigo?: string;
    soloActivos?: boolean; soloConStock?: boolean; limit?: number; busquedaMultiEntidad?: boolean;
  }) =>
    api.get<ProductoSearch[]>('/purchases/search-products-advanced', { params }).then(r => r.data),

  getProveedores: () =>
    api.get<ProveedorCompra[]>('/purchases/proveedores').then(r => r.data),

  getDepositos: () =>
    api.get<Deposito[]>('/purchases/depositos').then(r => r.data),

  getActivePaymentMethods: () =>
    api.get<MetodoPago[]>('/purchases/active-payment-methods').then(r => r.data),

  getSaldoCtaCteP: (proveedorId: number) =>
    api.get<{ saldo: number; ctaCorrienteId: number | null }>(`/purchases/saldo-cta-cte/${proveedorId}`).then(r => r.data),

  getPriceCheckData: (compraId: number) =>
    api.get<PriceCheckData>(`/purchases/price-check/${compraId}`).then(r => r.data),

  savePriceCheck: (updates: PriceCheckUpdate[]) =>
    api.post<{ updated: number }>('/purchases/price-check', { updates }).then(r => r.data),

  /** Remitos de entrada sin compra asociada, para selector en Nueva Compra.
   *  Si se pasa proveedorId, filtra solo los remitos de ese proveedor. */
  getRemitosSinCompraAsociada: (proveedorId?: number) =>
    api
      .get<
        {
          REMITO_ID: number;
          TIPO: string;
          FECHA: string;
          PTO_VTA: string;
          NRO_REMITO: string;
          PROVEEDOR_ID: number | null;
          TOTAL: number;
          OBSERVACIONES: string | null;
          PROVEEDOR_NOMBRE: string | null;
        }[]
      >('/remitos/sin-compra', { params: proveedorId ? { proveedorId } : {} })
      .then(r => r.data),

  /** Items de un remito, listos para auto-cargar en el cart de una compra. */
  getRemitoItemsParaCompra: (remitoId: number) =>
    api
      .get<
        {
          PRODUCTO_ID: number;
          CANTIDAD: number;
          PRECIO_UNITARIO: number;
          PRODUCTO_NOMBRE: string;
          PRODUCTO_CODIGO: string;
          IVA_ALICUOTA: number;
          PRECIO_COMPRA: number;
          STOCK: number;
          IMP_INT: number;
          TASA_IVA_ID: number | null;
          UNIDAD_ID: number | null;
          UNIDAD_NOMBRE: string;
          UNIDAD_ABREVIACION: string;
        }[]
      >(`/remitos/${remitoId}/items-para-compra`)
      .then(r => r.data),

  /** Sube una imagen de comprobante, la IA devuelve encabezado + items
   *  estructurados con matches sugeridos contra PRODUCTOS / PROVEEDORES.
   *  Si el usuario ya eligió un proveedor en el modal padre, se manda
   *  `proveedorId` como hint para que el matcher priorice CODIGO_PROVEEDOR
   *  contra ese proveedor (aunque la IA no haya podido detectarlo por
   *  CUIT/razón social). */
  parseReceipt: (file: File, proveedorId?: number | null) => {
    const form = new FormData();
    form.append('image', file);
    if (proveedorId != null) form.append('proveedorId', String(proveedorId));
    return api
      .post<ParsedReceiptResponse>('/purchases/parse-image', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then(r => r.data);
  },

  /** Borra una imagen guardada por parseReceipt cuando el usuario cancela
   *  la revisión sin confirmar la compra. */
  discardParsedImage: (savedPath: string) => {
    // saved_path viene en formato "uploads/comprobantes/2026-08/usuario_ts_hash.ext"
    const parts = savedPath.split('/');
    const filename = parts[parts.length - 1] || '';
    const folder = parts[parts.length - 2] || '';
    if (!folder || !filename) return Promise.resolve({ ok: false });
    return api
      .delete<{ ok: boolean }>(`/purchases/parse-image/${folder}/${filename}`)
      .then(r => r.data);
  },
};
