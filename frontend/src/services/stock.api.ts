import api from './api';
import type { PaginatedResponse, Deposito } from '../types';

// ── Stock types ──────────────────────────────────
export interface StockProducto {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string;
  NOMBRE: string;
  CANTIDAD: number;
  STOCK_MINIMO: number | null;
  UNIDAD_ABREVIACION: string | null;
  CATEGORIA_NOMBRE: string | null;
  MARCA_NOMBRE: string | null;
  stockDepositos: StockDepositoItem[];
}

export interface StockDepositoItem {
  ITEM_ID: number;
  PRODUCTO_ID: number;
  DEPOSITO_ID: number;
  CANTIDAD: number;
  DEPOSITO_NOMBRE: string;
}

export interface StockHistorialItem {
  HISTORIAL_ID: number;
  PRODUCTO_ID: number;
  DEPOSITO_ID: number;
  CANTIDAD_ANTERIOR: number;
  CANTIDAD_NUEVA: number;
  DIFERENCIA: number;
  TIPO_OPERACION: string;
  REFERENCIA_ID: number | null;
  REFERENCIA_DETALLE: string | null;
  USUARIO_ID: number | null;
  FECHA: string;
  OBSERVACIONES: string | null;
  DEPOSITO_NOMBRE: string;
  USUARIO_NOMBRE: string | null;
}

export interface StockProductDetail {
  product: {
    PRODUCTO_ID: number;
    CODIGOPARTICULAR: string;
    NOMBRE: string;
    CANTIDAD: number;
    STOCK_MINIMO: number | null;
    UNIDAD_ABREVIACION: string | null;
  };
  stockDepositos: StockDepositoItem[];
}

export const stockApi = {
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<StockProducto>>('/stock', { params }).then(r => r.data),

  getDepositos: (params?: { puntoVentaId?: number }) =>
    api.get<Deposito[]>('/stock/depositos', { params }).then(r => r.data),

  getProductStock: (productoId: number) =>
    api.get<StockProductDetail>(`/stock/${productoId}`).then(r => r.data),

  getHistory: (productoId: number, params?: Record<string, any>) =>
    api.get<PaginatedResponse<StockHistorialItem>>(`/stock/${productoId}/history`, { params }).then(r => r.data),

  updateStock: (data: { PRODUCTO_ID: number; DEPOSITO_ID: number; CANTIDAD_NUEVA: number; OBSERVACIONES?: string }) =>
    api.put<{ ok: boolean; cantidadAnterior: number; cantidadNueva: number; diferencia: number }>('/stock/update', data).then(r => r.data),
};
