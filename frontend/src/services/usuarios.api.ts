import api from './api';
import type {
  UsuarioDetalle, Rol, RolConPermisos, PermisoWeb,
  PermisoConEstado, AuditoriaEvento, PoliticaSeguridad, SesionActiva,
} from '../types';

export interface CreateUsuarioInput {
  nombre: string;
  password: string;
  nombreCompleto?: string;
  email?: string;
  telefono?: string;
  rolIds?: number[];
}

export interface UpdateUsuarioInput {
  nombreCompleto?: string;
  email?: string;
  telefono?: string;
  debeCambiarClave?: boolean;
  activo?: boolean;
  newPassword?: string;
}

export const usuariosApi = {
  // ── Users ────────────────────────────────────────────────────────────────
  getAll: (params?: { search?: string; activo?: boolean; rolId?: number; puntoVentaId?: number }) =>
    api.get<UsuarioDetalle[]>('/usuarios', { params }).then(r => r.data),

  getById: (id: number) =>
    api.get<UsuarioDetalle>(`/usuarios/${id}`).then(r => r.data),

  create: (data: CreateUsuarioInput) =>
    api.post<{ USUARIO_ID: number }>('/usuarios', data).then(r => r.data),

  update: (id: number, data: UpdateUsuarioInput) =>
    api.put<{ USUARIO_ID: number }>(`/usuarios/${id}`, data).then(r => r.data),

  delete: (id: number) =>
    api.delete(`/usuarios/${id}`).then(r => r.data),

  toggleBloqueo: (id: number, bloquear: boolean) =>
    api.post(`/usuarios/${id}/bloqueo`, { bloquear }).then(r => r.data),

  setRoles: (id: number, rolIds: number[]) =>
    api.put(`/usuarios/${id}/roles`, { rolIds }).then(r => r.data),

  setPuntosVenta: (id: number, data: { pvIds: number[]; preferidoId: number | null }) =>
    api.put(`/usuarios/${id}/puntos-venta`, { pvIds: data.pvIds, preferidoId: data.preferidoId }).then(r => r.data),

  // ── Permissions for one user ─────────────────────────────────────────────
  getPermisosUsuario: (id: number) =>
    api.get<PermisoConEstado[]>(`/usuarios/${id}/permisos`).then(r => r.data),

  setPermisoOverride: (userId: number, permisoId: number, activo: boolean | null) =>
    api.put(`/usuarios/${userId}/permisos/${permisoId}`, { activo }).then(r => r.data),

  clearPermisoOverrides: (userId: number) =>
    api.delete(`/usuarios/${userId}/permisos`).then(r => r.data),

  // ── Sesiones ─────────────────────────────────────────────────────────────
  getSesionesUsuario: (id: number) =>
    api.get<SesionActiva[]>(`/usuarios/${id}/sesiones`).then(r => r.data),

  // ── Roles ────────────────────────────────────────────────────────────────
  getRoles: () =>
    api.get<Rol[]>('/usuarios/roles/list').then(r => r.data),

  getRolById: (id: number) =>
    api.get<RolConPermisos>(`/usuarios/roles/${id}`).then(r => r.data),

  setRolPermisos: (rolId: number, permisoIds: number[]) =>
    api.put(`/usuarios/roles/${rolId}/permisos`, { permisoIds }).then(r => r.data),

  clearRoleUserOverrides: (rolId: number) =>
    api.delete(`/usuarios/roles/${rolId}/permisos-overrides`).then(r => r.data),

  // ── Catálogo de permisos web ──────────────────────────────────────────────────────
  getPermisos: () =>
    api.get<PermisoWeb[]>('/usuarios/permisos/list').then(r => r.data),

  // ── Auditoría ────────────────────────────────────────────────────────────
  getAuditoria: (params?: {
    usuarioId?: number; evento?: string; resultado?: string;
    fechaDesde?: string; fechaHasta?: string; page?: number; pageSize?: number;
  }) =>
    api.get<{ data: AuditoriaEvento[]; total: number }>('/usuarios/auditoria/log', { params }).then(r => r.data),

  // ── Política ─────────────────────────────────────────────────────────────
  getPolitica: () =>
    api.get<PoliticaSeguridad>('/usuarios/politica/config').then(r => r.data),

  updatePolitica: (data: Partial<PoliticaSeguridad>) =>
    api.put('/usuarios/politica/config', data).then(r => r.data),

  // ── Sesiones globales ─────────────────────────────────────────────────────
  getSesionesAll: () =>
    api.get<SesionActiva[]>('/usuarios/sesiones/all').then(r => r.data),

  revocarSesion: (sesionId: string) =>
    api.delete(`/usuarios/sesiones/${sesionId}`).then(r => r.data),
};
