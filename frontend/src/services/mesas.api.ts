import api from './api';
import type { Sector, Mesa, Pedido, PedidoDetalle, PedidoItem, ProductoSearchMesa } from '../types';

const BASE = '/mesas';

// ── Sectores ─────────────────────────────────────

export const getSectores = (puntoVentaId?: number) =>
  api.get<Sector[]>(`${BASE}/sectores`, { params: { puntoVentaId } }).then(r => r.data);

export const createSector = (data: { NOMBRE: string; PUNTO_VENTA_ID: number }) =>
  api.post<Sector>(`${BASE}/sectores`, data).then(r => r.data);

export const updateSector = (id: number, data: { NOMBRE: string }) =>
  api.put(`${BASE}/sectores/${id}`, data).then(r => r.data);

export const deleteSector = (id: number) =>
  api.delete(`${BASE}/sectores/${id}`).then(r => r.data);

// ── Mesas ────────────────────────────────────────

export const getMesas = (sectorId: number, puntoVentaId?: number) =>
  api.get<Mesa[]>(`${BASE}/mesas`, { params: { sectorId, puntoVentaId } }).then(r => r.data);

export const createMesa = (data: { NUMERO_MESA: string; SECTOR_ID: number; CAPACIDAD: number; PUNTO_VENTA_ID: number }) =>
  api.post<Mesa>(`${BASE}/mesas`, data).then(r => r.data);

export const updateMesa = (id: number, data: { NUMERO_MESA?: string; CAPACIDAD?: number; SECTOR_ID?: number; POSICION_X?: number; POSICION_Y?: number }) =>
  api.put(`${BASE}/mesas/${id}`, data).then(r => r.data);

export const deleteMesa = (id: number) =>
  api.delete(`${BASE}/mesas/${id}`).then(r => r.data);

export const cambiarEstadoMesa = (id: number, estado: 'LIBRE' | 'OCUPADA' | 'RESERVADA') =>
  api.patch(`${BASE}/mesas/${id}/estado`, { estado }).then(r => r.data);

// ── Pedidos ──────────────────────────────────────

export const getPedidosMesa = (mesaId: number) =>
  api.get<Pedido[]>(`${BASE}/pedidos/mesa/${mesaId}`).then(r => r.data);

export const getPedidoActivoMesa = (mesaId: number) =>
  api.get<PedidoDetalle | null>(`${BASE}/pedidos/mesa/${mesaId}/activo`).then(r => r.data);

export const getPedidoById = (id: number) =>
  api.get<PedidoDetalle>(`${BASE}/pedidos/${id}`).then(r => r.data);

export const crearPedido = (data: { MESA_ID: number; PUNTO_VENTA_ID: number }) =>
  api.post<Pedido>(`${BASE}/pedidos`, data).then(r => r.data);

export const agregarItemPedido = (pedidoId: number, data: {
  PRODUCTO_ID?: number;
  CANTIDAD: number;
  PRECIO_UNITARIO: number;
  PUNTO_VENTA_ID?: number;
  LISTA_PRECIO_SELECCIONADA?: number;
}) => api.post<PedidoItem>(`${BASE}/pedidos/${pedidoId}/items`, data).then(r => r.data);

export const actualizarCantidadItem = (itemId: number, cantidad: number) =>
  api.patch(`${BASE}/pedidos/items/${itemId}`, { CANTIDAD: cantidad }).then(r => r.data);

export const eliminarItemPedido = (itemId: number) =>
  api.delete(`${BASE}/pedidos/items/${itemId}`).then(r => r.data);

export const cerrarPedido = (pedidoId: number) =>
  api.post(`${BASE}/pedidos/${pedidoId}/cerrar`).then(r => r.data);

export const reabrirPedido = (pedidoId: number) =>
  api.post(`${BASE}/pedidos/${pedidoId}/reabrir`).then(r => r.data);

export const pasarPedidoAVenta = (pedidoId: number, data: {
  CLIENTE_ID: number;
  PUNTO_VENTA_ID: number;
  MONTO_EFECTIVO: number;
  MONTO_DIGITAL: number;
  VUELTO: number;
  TIPO_COMPROBANTE?: string;
}) => api.post<{ ventaId: number }>(`${BASE}/pedidos/${pedidoId}/pasar-a-venta`, data).then(r => r.data);

// ── Search ───────────────────────────────────────

export const searchProductosMesa = (search: string, puntoVentaId?: number) =>
  api.get<ProductoSearchMesa[]>(`${BASE}/search-products`, { params: { search, puntoVentaId } }).then(r => r.data);
