import api from './api';
import type { ListaPrecio, PaginatedResponse, Producto, TipoMargen } from '../types';

export interface PriceListStats {
  totalProductos: number;
  productosActivos: number;
  productosConPrecio: number;
  precioPromedio: number;
  precioMinimo: number;
  precioMaximo: number;
}

export type PriceListWithStats = ListaPrecio & PriceListStats;

export interface PriceListInput {
  CODIGOPARTICULAR?: string | null;
  NOMBRE: string;
  DESCRIPCION?: string | null;
  MARGEN?: number;
  /** 'M' = Markup sobre costo (default). 'U' = Utilidad sobre venta. */
  TIPO_MARGEN?: TipoMargen;
  ACTIVA?: boolean;
  /** Si true (default), al crear se generan precios para todos los productos
   *  con PRECIO_COMPRA > 0 aplicando el margen configurado. */
  aplicarMargenInicial?: boolean;
  /** Si true, al actualizar también se recalculan los precios de los productos
   *  ya asociados a la lista usando el nuevo MARGEN y TIPO_MARGEN. */
  recalcularPorMargen?: boolean;
  /** Paso de redondeo (ej. 50, 100, 500) aplicado después del recálculo. */
  redondeoStep?: number | null;
  /** Dirección del redondeo: 'arriba' (CEILING) o 'cercano' (ROUND a múltiplo). */
  redondeoDireccion?: 'arriba' | 'cercano' | null;
}

export interface PriceListProduct extends Producto {
  PRECIO_LISTA: number;
  MARGEN_LISTA: number | null;
}

export interface ApplyPercentageInput {
  porcentaje: number;
  incluirInactivos?: boolean;
  redondeo?: 'ninguno' | 'entero' | '50' | '100';
  actualizarMargen?: boolean;
}

export interface ApplyPercentageResult {
  affected: number;
  before: PriceListStats;
  after: PriceListStats;
  margenAnterior?: number | null;
  margenNuevo?: number | null;
  margenActualizado?: boolean;
}

export const priceListApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<PriceListWithStats>>('/price-lists', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<PriceListWithStats>(`/price-lists/${id}`).then(r => r.data),

  getNextCode: () =>
    api.get<{ code: string }>('/price-lists/next-code').then(r => r.data.code),

  create: (data: PriceListInput) =>
    api.post<{ LISTA_ID: number; productosConPrecio: number }>('/price-lists', data).then(r => r.data),

  update: (id: number, data: PriceListInput) =>
    api.put<{ ok: true; affected?: number }>('/price-lists/' + id, data).then(r => r.data),

  delete: (id: number) =>
    api.delete<{ mode: 'soft' | 'hard' }>('/price-lists/' + id).then(r => r.data),

  getProducts: (id: number, params?: Record<string, any>) =>
    api.get<PaginatedResponse<PriceListProduct>>(`/price-lists/${id}/products`, { params }).then(r => r.data),

  updateProductPrice: (id: number, productId: number, precio: number) =>
    api.patch(`/price-lists/${id}/products/${productId}`, { precio }).then(r => r.data),

  applyPercentage: (id: number, data: ApplyPercentageInput) =>
    api.post<ApplyPercentageResult>(`/price-lists/${id}/apply-percentage`, data).then(r => r.data),

  roundPrices: (id: number, step: number, direccion: 'arriba' | 'cercano') =>
    api.post<{ affected: number }>(`/price-lists/${id}/round`, { step, direccion }).then(r => r.data),
};