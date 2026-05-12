import api from './api';
import type { ListaPrecio, PaginatedResponse, Producto } from '../types';

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
  MARGEN_REAL?: number | null;
  ACTIVA?: boolean;
}

export interface PriceListProduct extends Producto {
  PRECIO_LISTA: number;
  MARGEN_LISTA: number | null;
}

export interface ApplyPercentageInput {
  porcentaje: number;
  incluirInactivos?: boolean;
  redondeo?: 'ninguno' | 'entero' | '50' | '100';
}

export interface ApplyPercentageResult {
  affected: number;
  before: PriceListStats;
  after: PriceListStats;
}

export const priceListApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<PriceListWithStats>>('/price-lists', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<PriceListWithStats>(`/price-lists/${id}`).then(r => r.data),

  update: (id: number, data: PriceListInput) =>
    api.put('/price-lists/' + id, data).then(r => r.data),

  getProducts: (id: number, params?: Record<string, any>) =>
    api.get<PaginatedResponse<PriceListProduct>>(`/price-lists/${id}/products`, { params }).then(r => r.data),

  updateProductPrice: (id: number, productId: number, precio: number) =>
    api.patch(`/price-lists/${id}/products/${productId}`, { precio }).then(r => r.data),

  applyPercentage: (id: number, data: ApplyPercentageInput) =>
    api.post<ApplyPercentageResult>(`/price-lists/${id}/apply-percentage`, data).then(r => r.data),
};