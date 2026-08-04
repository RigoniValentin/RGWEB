import api from './api';
import type {
  Caja, CajaSesion, CajaDetalle, PaginatedResponse,
  AbrirCajaInput, CerrarCajaInput, IngresoEgresoInput,
  TransferirCCInput, CajaAbierta, CajaConSaldo, DesgloseMetodo,
} from '../types';

export const cajaApi = {
  // ── ABM de cajas persistentes ──
  listarCajas: (params?: { puntoVentaIds?: number[]; activa?: boolean; usuarioId?: number }) =>
    api.get<Caja[]>('/caja/cajas', { params }).then(r => r.data),

  getCajaById: (id: number) =>
    api.get<Caja>(`/caja/cajas/${id}`).then(r => r.data),

  crearCaja: (data: { nombre?: string; puntoVentaId: number; usuariosIds: number[] }) =>
    api.post<{ CAJA_ID: number }>('/caja/cajas', data).then(r => r.data),

  editarCaja: (id: number, data: { nombre?: string; activa?: boolean }) =>
    api.put<{ success: boolean }>(`/caja/cajas/${id}`, data).then(r => r.data),

  asignarUsuarios: (id: number, usuariosIds: number[]) =>
    api.post<{ success: boolean }>(`/caja/cajas/${id}/usuarios`, { usuariosIds }).then(r => r.data),

  quitarUsuario: (id: number, usuarioId: number) =>
    api.delete<{ success: boolean }>(`/caja/cajas/${id}/usuarios/${usuarioId}`).then(r => r.data),

  // ── Sesiones ──
  getSesiones: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<CajaSesion>>('/caja/sesiones', { params }).then(r => r.data),

  getSesionById: (id: number) =>
    api.get<CajaDetalle>(`/caja/sesiones/${id}`).then(r => r.data),

  getMisCajas: () =>
    api.get<Caja[]>('/caja/mis-cajas').then(r => r.data),

  getMiSesionActiva: () =>
    api.get<CajaSesion | null>('/caja/mi-sesion-activa').then(r => r.data),

  abrirSesion: (data: AbrirCajaInput) =>
    api.post<{ SESION_ID: number; CAJA_ID: number; NRO_SESION: number; APORTE_CC: number; RETENIDO_USADO: number }>('/caja/sesiones/abrir', data).then(r => r.data),

  cerrarSesion: (sesionId: number, data: CerrarCajaInput) =>
    api.post<{ SESION_ID: number; MONTO_CIERRE: number; SALDO_RETENIDO_FIN: number; EFECTIVO_EN_CAJA: number }>(`/caja/sesiones/${sesionId}/cerrar`, data).then(r => r.data),

  addIngresoEgreso: (sesionId: number, data: IngresoEgresoInput) =>
    api.post<{ ITEM_ID: number }>(`/caja/sesiones/${sesionId}/ingreso-egreso`, data).then(r => r.data),

  deleteItem: (sesionId: number, itemId: number) =>
    api.delete(`/caja/sesiones/${sesionId}/items/${itemId}`).then(r => r.data),

  // ── Transferencia CC ↔ Caja ──
  transferir: (data: TransferirCCInput) =>
    api.post<{ success: boolean }>('/caja/transferir', data).then(r => r.data),

  // ── Auxiliares ──
  getSesionesActivas: (puntoVentaId?: number) =>
    api.get<CajaAbierta[]>('/caja/sesiones-activas', { params: { puntoVentaId } }).then(r => r.data),

  getCajasConSaldo: (puntoVentaId?: number) =>
    api.get<CajaConSaldo[]>('/caja/cajas-con-saldo', { params: { puntoVentaId } }).then(r => r.data),

  getEfectivoCajaCentral: (puntoVentaId?: number) =>
    api.get<{ efectivo: number }>('/caja/efectivo-caja-central', { params: { puntoVentaId } }).then(r => r.data),

  // ── Compatibilidad legacy (deprecated) ──
  /** @deprecated Usar getMiSesionActiva */
  getMiCaja: () =>
    api.get<CajaSesion | null>('/caja/mi-caja').then(r => r.data),

  /** @deprecated Usar getSesiones */
  getAll: (params?: Record<string, any>) =>
    api.get<PaginatedResponse<CajaSesion>>('/caja', { params }).then(r => r.data),

  /** @deprecated Usar getSesionById */
  getById: (id: number) =>
    api.get<CajaDetalle>(`/caja/${id}`).then(r => r.data),

  /** @deprecated Usar getSesionesActivas */
  getCajasAbiertas: (puntoVentaId?: number) =>
    api.get<CajaAbierta[]>('/caja/cajas-abiertas', { params: { puntoVentaId } }).then(r => r.data),

  getDesgloseMetodos: (sesionId: number) =>
    api.get<DesgloseMetodo[]>(`/caja/${sesionId}/desglose-metodos`).then(r => r.data),

  getDesgloseItem: (origenTipo: string, origenId: number, categoria?: 'EFECTIVO' | 'DIGITAL') =>
    api.get<DesgloseMetodo[]>(`/caja/desglose-item/${origenTipo}/${origenId}`, { params: categoria ? { categoria } : {} }).then(r => r.data),
};
