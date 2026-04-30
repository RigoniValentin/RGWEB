import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Card, Row, Col, Statistic,
  Button, Input, Select, Switch, Tabs, Tooltip, Modal, Form,
  Popconfirm, Drawer, Checkbox, Divider, Badge, Alert,
  InputNumber, Collapse, App,
} from 'antd';
import {
  UserOutlined, LockOutlined, UnlockOutlined, DeleteOutlined,
  EditOutlined, PlusOutlined, ReloadOutlined, SafetyOutlined,
  AuditOutlined, SettingOutlined, KeyOutlined,
  CheckCircleOutlined, StopOutlined, TeamOutlined, EnvironmentOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { usuariosApi, type UpdateUsuarioInput } from '../services/usuarios.api';
import { catalogApi } from '../services/catalog.api';
import { useTabStore } from '../store/tabStore';
import type {
  UsuarioDetalle, Rol, PermisoWeb,
  PermisoConEstado, PoliticaSeguridad, PuntoVenta,
} from '../types';
import { PuntoVentaFilter } from '../components/PuntoVentaFilter';
import { DateFilterPopover, getPresetRange, type DatePreset } from '../components/DateFilterPopover';

const { Title, Text } = Typography;
const { Option } = Select;

// ─── colour helpers ───────────────────────────────────────────────────────────
const RIESGO_COLOR: Record<string, string> = { BAJO: 'green', MEDIO: 'blue', ALTO: 'orange', CRITICO: 'red' };
const EVT_COLOR: Record<string, string> = {
  LOGIN_OK: 'green', LOGIN_FAIL: 'red', LOCKOUT: 'red', LOGOUT: 'default',
  PASSWORD_CHANGE: 'blue', USUARIO_CREADO: 'cyan', USUARIO_BLOQUEADO: 'orange',
  USUARIO_DESBLOQUEADO: 'green', USUARIO_ELIMINADO: 'red',
  ROL_ASIGNADO: 'purple', ROL_REVOCADO: 'orange',
  PERMISO_CAMBIO: 'blue', SESION_REVOCADA: 'orange',
};

function fmtDate(d?: string | null) {
  if (!d) return '—';
  // SQL Server returns SYSUTCDATETIME() without timezone indicator — append 'Z'
  // so the browser parses it as UTC and converts to local time automatically.
  const iso = d.endsWith('Z') || d.includes('+') ? d : d + 'Z';
  return dayjs(iso).format('DD/MM/YY HH:mm');
}

// ─── sub-components ───────────────────────────────────────────────────────────

// ─ Permissions drawer for a specific user ────────────────────────────────────
function PermisosDrawer({ userId, nombre, open, onClose }: {
  userId: number; nombre: string; open: boolean; onClose: () => void;
}) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const [modulo, setModulo] = useState<string | undefined>();

  const { data: permisos = [], isLoading } = useQuery({
    queryKey: ['user-permisos', userId],
    queryFn: () => usuariosApi.getPermisosUsuario(userId),
    enabled: open,
  });

  const overrideMutation = useMutation({
    mutationFn: ({ permisoId, activo }: { permisoId: number; activo: boolean | null }) =>
      usuariosApi.setPermisoOverride(userId, permisoId, activo),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-permisos', userId] }),
    onError: () => message.error('Error al actualizar permiso'),
  });

  const clearOverridesMutation = useMutation({
    mutationFn: () => usuariosApi.clearPermisoOverrides(userId),
    onSuccess: () => {
      message.success('Permisos restablecidos al rol');
      qc.invalidateQueries({ queryKey: ['user-permisos', userId] });
    },
    onError: () => message.error('Error al restablecer permisos'),
  });

  const hasOverrides = permisos.some(p => p.OVERRIDE !== null);

  const handleClearOverrides = () => {
    modal.confirm({
      title: 'Restablecer permisos al rol',
      content: `Se eliminarán todas las sobreescrituras individuales de ${nombre}. Los permisos quedarán definidos únicamente por su rol asignado.`,
      okText: 'Restablecer',
      okButtonProps: { danger: true },
      cancelText: 'Cancelar',
      onOk: () => clearOverridesMutation.mutateAsync(),
    });
  };

  const modulos = useMemo(() => [...new Set(permisos.map(p => p.MODULO).filter(Boolean))].sort(), [permisos]);
  const filtered = modulo ? permisos.filter(p => p.MODULO === modulo) : permisos;
  const [activePanel, setActivePanel] = useState<string | undefined>();

  const grouped = useMemo(() => {
    const g: Record<string, PermisoConEstado[]> = {};
    for (const p of filtered) { const k = p.MODULO || 'general'; (g[k] ??= []).push(p); }
    return g;
  }, [filtered]);

  return (
    <Drawer
      title={<Space><SafetyOutlined /> Permisos de <Text strong>{nombre}</Text></Space>}
      open={open} onClose={onClose} width={640}
      extra={
        <Space>
          <Tooltip title="Eliminar todas las sobreescrituras individuales y restablecer según el rol">
            <Button
              danger
              size="small"
              disabled={!hasOverrides}
              loading={clearOverridesMutation.isPending}
              onClick={handleClearOverrides}
            >
              Restablecer al rol
            </Button>
          </Tooltip>
          <Select allowClear placeholder="Filtrar módulo" style={{ width: 160 }} onChange={v => { setModulo(v); setActivePanel(undefined); }}>
            {modulos.map(m => <Option key={m} value={m}>{m}</Option>)}
          </Select>
        </Space>
      }
    >
      {isLoading ? <Text type="secondary">Cargando…</Text> : (
        <Collapse
          accordion
          activeKey={activePanel}
          onChange={key => setActivePanel(Array.isArray(key) ? key[0] : key)}
          style={{ background: 'transparent' }}
          items={Object.entries(grouped).map(([mod, items]) => {
            const grantedCount = items.filter(p => p.GRANTED).length;
            return {
              key: mod,
              label: (
                <Space>
                  <Text strong style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.5 }}>{mod}</Text>
                  <Badge
                    count={`${grantedCount}/${items.length}`}
                    style={{ backgroundColor: grantedCount > 0 ? '#52c41a' : '#d9d9d9', color: grantedCount > 0 ? '#fff' : '#666', fontSize: 10 }}
                  />
                </Space>
              ),
              children: (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {items.map(p => {
                    const isOverrideGrant = p.OVERRIDE === true;
                    const isOverrideDeny  = p.OVERRIDE === false;
                    const viaRol          = p.GRANTED && p.OVERRIDE === null;
                    return (
                      <div key={p.PERMISO_ID} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 12px', borderRadius: 8,
                        background: p.GRANTED ? 'rgba(82,196,26,0.05)' : 'rgba(0,0,0,0.02)',
                        border: `1px solid ${p.GRANTED ? '#b7eb8f' : '#f0f0f0'}`,
                      }}>
                        <Space size={6}>
                          <Tag color={RIESGO_COLOR[p.RIESGO] ?? 'default'} style={{ fontSize: 10, lineHeight: '16px', padding: '0 5px' }}>
                            {p.RIESGO}
                          </Tag>
                          <div>
                            <Text style={{ fontSize: 13 }}>{p.DESCRIPCION}</Text>
                            <br />
                            <Text type="secondary" style={{ fontSize: 11 }}>{p.LLAVE}</Text>
                          </div>
                        </Space>
                        <Space size={4}>
                          {viaRol && <Tag color="purple" style={{ fontSize: 10 }}>via rol</Tag>}
                          {isOverrideGrant && <Tag color="green" style={{ fontSize: 10 }}>grant</Tag>}
                          {isOverrideDeny  && <Tag color="red"   style={{ fontSize: 10 }}>deny</Tag>}
                          <Tooltip title="Permitir explícitamente">
                            <Button size="small" type={isOverrideGrant ? 'primary' : 'default'}
                              icon={<CheckCircleOutlined />}
                              onClick={() => overrideMutation.mutate({ permisoId: p.PERMISO_ID, activo: isOverrideGrant ? null : true })}
                            />
                          </Tooltip>
                          <Tooltip title="Denegar explícitamente">
                            <Button size="small" danger={isOverrideDeny}
                              icon={<StopOutlined />}
                              onClick={() => overrideMutation.mutate({ permisoId: p.PERMISO_ID, activo: isOverrideDeny ? null : false })}
                            />
                          </Tooltip>
                        </Space>
                      </div>
                    );
                  })}
                </div>
              ),
            };
          })}
        />
      )}
    </Drawer>
  );
}

// ─ Role permissions drawer ────────────────────────────────────────────────────
function RolPermisoDrawer({ rolId, open, onClose }: { rolId: number | null; open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [dirty, setDirty] = useState(false);
  const [sobreescribirUsuarios, setSobreescribirUsuarios] = useState(false);

  const { data: rol, isLoading: loadingRol } = useQuery({
    queryKey: ['rol-detail', rolId],
    queryFn: () => usuariosApi.getRolById(rolId!),
    enabled: !!rolId && open,
  });

  const { data: allPermisos = [] } = useQuery({
    queryKey: ['permisos-list'],
    queryFn: () => usuariosApi.getPermisos(),
    staleTime: 5 * 60_000,
  });

  // Sync selection when rol loads
  useState(() => {
    if (rol) { setSelectedIds(rol.permisos.map(p => p.PERMISO_ID)); setDirty(false); }
  });

  useMemo(() => {
    if (rol) { setSelectedIds(rol.permisos.map(p => p.PERMISO_ID)); setDirty(false); setSobreescribirUsuarios(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rol]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await usuariosApi.setRolPermisos(rolId!, selectedIds);
      if (sobreescribirUsuarios) await usuariosApi.clearRoleUserOverrides(rolId!);
    },
    onSuccess: () => {
      message.success(sobreescribirUsuarios
        ? 'Permisos del rol actualizados y sobreescrituras individuales eliminadas'
        : 'Permisos del rol actualizados');
      setDirty(false);
      setSobreescribirUsuarios(false);
      qc.invalidateQueries({ queryKey: ['rol-detail', rolId] });
    },
    onError: () => message.error('Error al guardar'),
  });

  const grouped = useMemo(() => {
    const g: Record<string, PermisoWeb[]> = {};
    for (const p of allPermisos) { const k = p.MODULO || 'general'; (g[k] ??= []).push(p); }
    return g;
  }, [allPermisos]);

  const [activeRolPanel, setActiveRolPanel] = useState<string | undefined>();

  const toggle = (id: number, checked: boolean) => {
    setSelectedIds(prev => checked ? [...prev, id] : prev.filter(x => x !== id));
    setDirty(true);
  };

  const selectAll = (ids: number[]) => { setSelectedIds(prev => [...new Set([...prev, ...ids])]); setDirty(true); };
  const clearAll  = (ids: number[]) => { setSelectedIds(prev => prev.filter(x => !ids.includes(x))); setDirty(true); };

  return (
    <Drawer
      title={<Space><SafetyOutlined /> {rol ? `Permisos: ${rol.NOMBRE}` : 'Permisos del Rol'}</Space>}
      open={open} onClose={onClose} width={680}
      extra={
        <Button type="primary" className="btn-gold" disabled={!dirty} loading={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}>
          Guardar cambios
        </Button>
      }
    >
      {(loadingRol || !rol) ? <Text type="secondary">Cargando…</Text> : (
        <>
          {rol.ES_SISTEMA && <Alert type="warning" message="Rol de sistema — los permisos pueden modificarse pero el rol no puede eliminarse." showIcon style={{ marginBottom: 16 }} />}
          <div style={{ marginBottom: 12 }}>
            <Checkbox
              checked={sobreescribirUsuarios}
              onChange={e => setSobreescribirUsuarios(e.target.checked)}
            >
              Sobreescribir permisos individuales de todos los usuarios de este rol
            </Checkbox>
            {sobreescribirUsuarios && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#faad14', paddingLeft: 24 }}>
                Al guardar, se eliminarán las sobreescrituras individuales de todos los usuarios que tengan este rol asignado.
              </div>
            )}
          </div>
          <Collapse
            accordion
            activeKey={activeRolPanel}
            onChange={key => setActiveRolPanel(Array.isArray(key) ? key[0] : key)}
            style={{ background: 'transparent' }}
            items={Object.entries(grouped).map(([mod, perms]) => {
              const allSelected = perms.every(p => selectedIds.includes(p.PERMISO_ID));
              const selectedCount = perms.filter(p => selectedIds.includes(p.PERMISO_ID)).length;
              return {
                key: mod,
                label: (
                  <Space>
                    <Text strong style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.5 }}>{mod}</Text>
                    <Badge
                      count={`${selectedCount}/${perms.length}`}
                      style={{ backgroundColor: selectedCount > 0 ? '#1677ff' : '#d9d9d9', color: selectedCount > 0 ? '#fff' : '#666', fontSize: 10 }}
                    />
                  </Space>
                ),
                extra: (
                  <Button size="small" type="link" style={{ padding: 0, fontSize: 11 }}
                    onClick={e => { e.stopPropagation(); allSelected ? clearAll(perms.map(p => p.PERMISO_ID)) : selectAll(perms.map(p => p.PERMISO_ID)); }}>
                    {allSelected ? 'Todos' : 'Ninguno'}
                  </Button>
                ),
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {perms.map(p => (
                      <div key={p.PERMISO_ID} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '5px 10px', borderRadius: 6, background: '#fafafa',
                      }}>
                        <Checkbox
                          checked={selectedIds.includes(p.PERMISO_ID)}
                          onChange={e => toggle(p.PERMISO_ID, e.target.checked)}
                        />
                        <Tag color={RIESGO_COLOR[p.RIESGO] ?? 'default'} style={{ fontSize: 10, padding: '0 5px' }}>{p.RIESGO}</Tag>
                        <div>
                          <Text style={{ fontSize: 13 }}>{p.DESCRIPCION}</Text>
                          <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>{p.LLAVE}</Text>
                        </div>
                      </div>
                    ))}
                  </div>
                ),
              };
            })}
          />
        </>
      )}
    </Drawer>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────
export function UsuariosPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  // ── Tab ────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('usuarios');

  // ── Users tab state ────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [filtroActivo, setFiltroActivo] = useState<boolean | undefined>();
  const [filtroRol, setFiltroRol] = useState<number | undefined>();
  const [filtroPV, setFiltroPV] = useState<number | undefined>();

  // User form modal
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [userForm] = Form.useForm();
  const [sobreescribirPermisos, setSobreescribirPermisos] = useState(false);

  // Permissions drawer
  const [permDrawerUser, setPermDrawerUser] = useState<{ id: number; nombre: string } | null>(null);

  // ── Roles tab state ────────────────────────────────────────────────────────
  const [rolDrawerId, setRolDrawerId] = useState<number | null>(null);

  // ── Audit tab state ────────────────────────────────────────────────────────
  const [auditPage, setAuditPage] = useState(1);
  const [auditEvento, setAuditEvento]  = useState<string | undefined>();
  const [auditResult, setAuditResult]  = useState<string | undefined>();
  const [auditUid] = useState<number | undefined>();
  const [auditPreset, setAuditPreset]  = useState<DatePreset>('mes');
  const [auditDesde, setAuditDesde]    = useState<string | undefined>(() => getPresetRange('mes')[0]);
  const [auditHasta, setAuditHasta]    = useState<string | undefined>(() => getPresetRange('mes')[1]);

  // ── Policy tab state ───────────────────────────────────────────────────────
  const [policyForm] = Form.useForm();
  const [policySaving, setPolicySaving] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: usuarios = [], isLoading: loadingUsers, refetch: refetchUsers } = useQuery({
    queryKey: ['usuarios', search, filtroActivo, filtroRol, filtroPV],
    queryFn: () => usuariosApi.getAll({ search: search || undefined, activo: filtroActivo, rolId: filtroRol, puntoVentaId: filtroPV }),
  });

  const { data: allPuntosVenta = [] } = useQuery({
    queryKey: ['puntos-venta-all'],
    queryFn: () => catalogApi.getPuntosVenta(),
    staleTime: 5 * 60_000,
  });

  const { data: roles = [], refetch: refetchRoles } = useQuery({
    queryKey: ['roles-list'],
    queryFn: () => usuariosApi.getRoles(),
    staleTime: 2 * 60_000,
  });

  const { data: editUser } = useQuery({
    queryKey: ['usuario-edit', editUserId],
    queryFn: () => usuariosApi.getById(editUserId!),
    enabled: !!editUserId && userModalOpen,
  });

  const { data: auditData, isLoading: loadingAudit } = useQuery({
    queryKey: ['auditoria', auditPage, auditEvento, auditResult, auditUid, auditDesde, auditHasta],
    queryFn: () => usuariosApi.getAuditoria({
      page: auditPage, pageSize: 50,
      evento: auditEvento, resultado: auditResult,
      usuarioId: auditUid, fechaDesde: auditDesde, fechaHasta: auditHasta,
    }),
  });

  const { data: politica } = useQuery({
    queryKey: ['politica-seguridad'],
    queryFn: () => usuariosApi.getPolitica(),
    staleTime: 5 * 60_000,
  });

  // Populate policy form
  useMemo(() => {
    if (politica) policyForm.setFieldsValue(politica);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [politica]);

  // Populate user edit form
  useMemo(() => {
    if (editUser && userModalOpen && editUserId) {
      userForm.setFieldsValue({
        nombre:         editUser.NOMBRE,
        nombreCompleto: editUser.NOMBRE_COMPLETO ?? '',
        email:          editUser.EMAIL ?? '',
        telefono:       editUser.TELEFONO ?? '',
        activo:         editUser.ACTIVO,
        debeCambiarClave: editUser.DEBE_CAMBIAR_CLAVE,
        rolIds:         editUser.roles.map(r => r.ROL_ID),
        pvIds:          (editUser.puntosVenta ?? []).map(p => p.PUNTO_VENTA_ID),
        pvPreferido:    (editUser.puntosVenta ?? []).find(p => p.ES_PREFERIDO)?.PUNTO_VENTA_ID ?? null,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editUser, userModalOpen, editUserId]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidateUsers = () => qc.invalidateQueries({ queryKey: ['usuarios'] });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateUsuarioInput }) => usuariosApi.update(id, data),
    onError: (e: any) => message.error(e.response?.data?.error || 'Error al actualizar'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => usuariosApi.delete(id),
    onSuccess: () => { message.success('Usuario eliminado'); invalidateUsers(); },
    onError: () => message.error('Error al eliminar usuario'),
  });

  const bloqueoMutation = useMutation({
    mutationFn: ({ id, bloquear }: { id: number; bloquear: boolean }) => usuariosApi.toggleBloqueo(id, bloquear),
    onSuccess: (_, { bloquear }) => { message.success(bloquear ? 'Usuario bloqueado' : 'Usuario desbloqueado'); invalidateUsers(); },
    onError: () => message.error('Error'),
  });

  const policyMutation = useMutation({
    mutationFn: (data: Partial<PoliticaSeguridad>) => usuariosApi.updatePolitica(data),
    onSuccess: () => { message.success('Política actualizada'); qc.invalidateQueries({ queryKey: ['politica-seguridad'] }); setPolicySaving(false); },
    onError: () => { message.error('Error al guardar política'); setPolicySaving(false); },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────
  const openCreateModal = () => { setEditUserId(null); userForm.resetFields(); setSobreescribirPermisos(false); setUserModalOpen(true); };
  const openEditModal   = (u: UsuarioDetalle) => { setEditUserId(u.USUARIO_ID); setSobreescribirPermisos(false); setUserModalOpen(true); };
  const closeUserModal  = () => { setUserModalOpen(false); setEditUserId(null); userForm.resetFields(); setSobreescribirPermisos(false); };

  // '+' key shortcut → Nuevo Usuario
  useEffect(() => {
    const handler = () => { if (useTabStore.getState().activeKey === '/users/users') openCreateModal(); };
    window.addEventListener('rg:nuevo', handler);
    return () => window.removeEventListener('rg:nuevo', handler);
  }, []);

  const handleUserSubmit = async () => {
    try {
      const values = await userForm.validateFields();
      const { rolIds, pvIds, pvPreferido, nombre: _n, password, ...rest } = values;
      if (editUserId) {
        const data: UpdateUsuarioInput = { ...rest, ...(password ? { newPassword: password } : {}) };
        await updateMutation.mutateAsync({ id: editUserId, data });
        if (rolIds !== undefined) await usuariosApi.setRoles(editUserId, rolIds);
        if (sobreescribirPermisos) await usuariosApi.clearPermisoOverrides(editUserId);
        await usuariosApi.setPuntosVenta(editUserId, { pvIds: pvIds ?? [], preferidoId: pvPreferido ?? null });
        message.success('Usuario actualizado');
        closeUserModal();
        invalidateUsers();
      } else {
        const result = await usuariosApi.create({ nombre: values.nombre, password, nombreCompleto: rest.nombreCompleto, email: rest.email, telefono: rest.telefono, rolIds });
        if (pvIds?.length) {
          await usuariosApi.setPuntosVenta(result.USUARIO_ID, { pvIds, preferidoId: pvPreferido ?? null });
        }
        message.success('Usuario creado');
        closeUserModal();
        invalidateUsers();
      }
    } catch { /* validation */ }
  };

  const savePolicy = async () => {
    try {
      const values = await policyForm.validateFields();
      setPolicySaving(true);
      policyMutation.mutate(values);
    } catch { /* */ }
  };

  // ── Stats ──────────────────────────────────────────────────────────────────
  const totalActivos   = usuarios.filter(u => u.ACTIVO).length;
  const totalBloqueados = usuarios.filter(u => u.BLOQUEADO).length;

  // ── Column definitions ─────────────────────────────────────────────────────
  const userColumns = [
    { title: 'ID', dataIndex: 'USUARIO_ID', key: 'id', width: 65, align: 'center' as const },
    {
      title: 'Usuario', key: 'nombre', render: (_: any, u: UsuarioDetalle) => (
        <Space size={8} align="center">
          <Text strong>{u.NOMBRE}</Text>
          {u.NOMBRE_COMPLETO && <Text type="secondary" style={{ fontSize: 12 }}>{u.NOMBRE_COMPLETO}</Text>}
        </Space>
      ),
    },
    {
      title: 'Email', dataIndex: 'EMAIL', key: 'email', ellipsis: true, width: 200,
      render: (v: string) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Roles', key: 'roles', width: 220,
      render: (_: any, u: UsuarioDetalle) => (
        <Space size={4} wrap>
          {u.roles.length === 0
            ? <Tag color="default">sin rol</Tag>
            : u.roles.map(r => <Tag key={r.ROL_ID} color="purple">{r.NOMBRE}</Tag>)
          }
        </Space>
      ),
    },
    {
      title: 'Puntos de Venta', key: 'pvs', width: 180,
      render: (_: any, u: UsuarioDetalle) => (
        <Space size={2} wrap>
          {(u.puntosVenta ?? []).length === 0
            ? <Text type="secondary" style={{ fontSize: 11 }}>—</Text>
            : (u.puntosVenta ?? []).map(pv => (
                <Tag
                  key={pv.PUNTO_VENTA_ID}
                  color={pv.ES_PREFERIDO ? 'blue' : 'default'}
                  icon={pv.ES_PREFERIDO ? <EnvironmentOutlined /> : undefined}
                  style={{ fontSize: 11 }}
                >
                  {pv.NOMBRE}
                </Tag>
              ))
          }
        </Space>
      ),
    },
    {
      title: 'Estado', key: 'estado', width: 160, align: 'center' as const,
      render: (_: any, u: UsuarioDetalle) => (
        <Space direction="vertical" size={2} style={{ alignItems: 'center' }}>
          {u.BLOQUEADO
            ? <Tag color="red" icon={<LockOutlined />}>Bloqueado</Tag>
            : <Tag color={u.ACTIVO ? 'green' : 'default'} icon={u.ACTIVO ? <CheckCircleOutlined /> : <StopOutlined />}>
                {u.ACTIVO ? 'Activo' : 'Inactivo'}
              </Tag>
          }
          {u.DEBE_CAMBIAR_CLAVE && <Tag color="orange" style={{ fontSize: 10 }}>cambiar clave</Tag>}
        </Space>
      ),
    },
    {
      title: 'Último login', dataIndex: 'ULTIMO_LOGIN', key: 'login', width: 145, align: 'center' as const,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
    },
    {
      title: '', key: 'actions', width: 140, align: 'center' as const,
      render: (_: any, u: UsuarioDetalle) => (
        <Space size={4}>
          <Tooltip title="Editar">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(u)} />
          </Tooltip>
          <Tooltip title="Permisos">
            <Button size="small" icon={<SafetyOutlined />}
              onClick={() => setPermDrawerUser({ id: u.USUARIO_ID, nombre: u.NOMBRE })} />
          </Tooltip>
          <Tooltip title={u.BLOQUEADO ? 'Desbloquear' : 'Bloquear'}>
            <Button size="small"
              danger={!u.BLOQUEADO}
              icon={u.BLOQUEADO ? <UnlockOutlined /> : <LockOutlined />}
              onClick={() => bloqueoMutation.mutate({ id: u.USUARIO_ID, bloquear: !u.BLOQUEADO })}
            />
          </Tooltip>
          <Popconfirm
            title="¿Eliminar este usuario?" okText="Sí" cancelText="No" okButtonProps={{ danger: true }}
            onConfirm={() => deleteMutation.mutate(u.USUARIO_ID)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const rolColumns = [
    { title: 'ID', dataIndex: 'ROL_ID', key: 'id', width: 65, align: 'center' as const },
    { title: 'Nombre', dataIndex: 'NOMBRE', key: 'nombre', render: (v: string) => <Text strong>{v}</Text> },
    { title: 'Descripción', dataIndex: 'DESCRIPCION', key: 'desc', ellipsis: true },
    {
      title: 'Prioridad', dataIndex: 'PRIORIDAD', key: 'prio', width: 110, align: 'center' as const,
      render: (v: number) => <Tag>{v}</Tag>,
    },
    {
      title: 'Tipo', dataIndex: 'ES_SISTEMA', key: 'sys', width: 110, align: 'center' as const,
      render: (v: boolean) => v ? <Tag color="blue">Sistema</Tag> : <Tag>Personalizado</Tag>,
    },
    {
      title: 'Estado', dataIndex: 'ACTIVO', key: 'activo', width: 90, align: 'center' as const,
      render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? 'Activo' : 'Inactivo'}</Tag>,
    },
    {
      title: '', key: 'actions', width: 80, align: 'center' as const,
      render: (_: any, r: Rol) => (
        <Tooltip title="Editar permisos del rol">
          <Button size="small" icon={<KeyOutlined />} onClick={() => setRolDrawerId(r.ROL_ID)} />
        </Tooltip>
      ),
    },
  ];

  const auditColumns = [
    {
      title: 'Fecha', dataIndex: 'FECHA', key: 'fecha', width: 145, align: 'center' as const,
      render: (v: string) => <Text style={{ fontSize: 12 }}>{fmtDate(v)}</Text>,
    },
    {
      title: 'Usuario', dataIndex: 'ACTOR_NOMBRE', key: 'actor', width: 140, ellipsis: true,
      render: (v: string | null) => v || <Text type="secondary">Anónimo</Text>,
    },
    {
      title: 'Evento', dataIndex: 'EVENTO', key: 'evt', width: 180,
      render: (v: string) => <Tag color={EVT_COLOR[v] ?? 'default'}>{v}</Tag>,
    },
    {
      title: 'Resultado', dataIndex: 'RESULTADO', key: 'res', width: 120, align: 'center' as const,
      render: (v: string) => <Tag color={v === 'OK' ? 'green' : v === 'FAIL' ? 'red' : 'orange'}>{v}</Tag>,
    },
    {
      title: 'IP', dataIndex: 'IP', key: 'ip', width: 130,
      render: (v: string | null) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title: 'Detalle', dataIndex: 'DETALLE', key: 'det', ellipsis: true,
      render: (v: string | null) => v
        ? <Tooltip title={v}><Text style={{ fontSize: 12 }} ellipsis>{v}</Text></Tooltip>
        : <Text type="secondary">—</Text>,
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page-enter">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="page-header">
        <Title level={3}>Usuarios y Permisos</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => { refetchUsers(); refetchRoles(); }} />
        </Space>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────────── */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" className="rg-card">
            <Statistic title="Total usuarios" value={usuarios.length}
              prefix={<UserOutlined />} valueStyle={{ fontSize: 18 }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" className="rg-card">
            <Statistic title="Activos" value={totalActivos}
              valueStyle={{ color: '#52c41a', fontSize: 18 }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" className="rg-card">
            <Statistic title="Bloqueados" value={totalBloqueados}
              valueStyle={{ color: totalBloqueados > 0 ? '#ff4d4f' : '#333', fontSize: 18 }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" className="rg-card">
            <Statistic title="Roles" value={roles.length}
              prefix={<TeamOutlined />} valueStyle={{ fontSize: 18 }} />
          </Card>
        </Col>
      </Row>

      {/* ── Tabs ───────────────────────────────────────────────────────────── */}
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[

        // ── TAB: Usuarios ──────────────────────────────────────────────────
        {
          key: 'usuarios',
          label: <span><UserOutlined /> Usuarios</span>,
          children: (
            <>
              {/* Filters */}
              <Space wrap style={{ marginBottom: 12 }}>
                <Input.Search
                  placeholder="Buscar nombre / email…"
                  style={{ width: 240 }}
                  allowClear
                  onSearch={v => setSearch(v)}
                  onChange={e => !e.target.value && setSearch('')}
                />
                <Select allowClear placeholder="Estado" style={{ width: 130 }}
                  onChange={v => setFiltroActivo(v === undefined ? undefined : v === 'true')}>
                  <Option value="true">Activos</Option>
                  <Option value="false">Inactivos</Option>
                </Select>
                <Select allowClear placeholder="Rol" style={{ width: 160 }}
                  onChange={v => setFiltroRol(v ?? undefined)}>
                  {roles.map(r => <Option key={r.ROL_ID} value={r.ROL_ID}>{r.NOMBRE}</Option>)}
                </Select>
                <PuntoVentaFilter
                  value={filtroPV}
                  onChange={v => setFiltroPV(v || undefined)}
                  overridePuntosVenta={allPuntosVenta}
                />
                <Button type="primary" className="btn-gold" icon={<PlusOutlined />} onClick={openCreateModal}>
                  Nuevo Usuario
                </Button>
              </Space>

              <Table
                className="rg-table"
                columns={userColumns}
                dataSource={usuarios}
                rowKey="USUARIO_ID"
                loading={loadingUsers}
                size="small"
                scroll={{ x: 1200 }}
                pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10','20','50','100'], showTotal: t => `${t} usuarios` }}
              />
            </>
          ),
        },

        // ── TAB: Roles ─────────────────────────────────────────────────────
        {
          key: 'roles',
          label: <span><TeamOutlined /> Roles <Badge count={roles.length} showZero color="purple" /></span>,
          children: (
            <Table
              className="rg-table"
              columns={rolColumns}
              dataSource={roles}
              rowKey="ROL_ID"
              size="small"
              pagination={false}
              scroll={{ x: 700 }}
            />
          ),
        },

        // ── TAB: Auditoría ─────────────────────────────────────────────────
        {
          key: 'auditoria',
          label: <span><AuditOutlined /> Auditoría</span>,
          children: (
            <>
              <Space wrap style={{ marginBottom: 12 }}>
                <DateFilterPopover
                  preset={auditPreset}
                  fechaDesde={auditDesde}
                  fechaHasta={auditHasta}
                  onPresetChange={(p, d, h) => { setAuditPreset(p); setAuditDesde(d); setAuditHasta(h); setAuditPage(1); }}
                  onRangeChange={(d, h) => { setAuditPreset(undefined as any); setAuditDesde(d); setAuditHasta(h); setAuditPage(1); }}
                />
                <Select allowClear placeholder="Evento" style={{ width: 200 }} onChange={v => { setAuditEvento(v); setAuditPage(1); }}>
                  {['LOGIN_OK','LOGIN_FAIL','LOCKOUT','LOGOUT','USUARIO_CREADO','USUARIO_BLOQUEADO','USUARIO_DESBLOQUEADO','USUARIO_ELIMINADO','ROL_ASIGNADO','PERMISO_CAMBIO','SESION_REVOCADA'].map(e => (
                    <Option key={e} value={e}><Tag color={EVT_COLOR[e]}>{e}</Tag></Option>
                  ))}
                </Select>
                <Select allowClear placeholder="Resultado" style={{ width: 120 }} onChange={v => { setAuditResult(v); setAuditPage(1); }}>
                  <Option value="OK"><Tag color="green">OK</Tag></Option>
                  <Option value="FAIL"><Tag color="red">FAIL</Tag></Option>
                  <Option value="DENIED"><Tag color="orange">DENIED</Tag></Option>
                </Select>
                <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['auditoria'] })} />
              </Space>

              <Table
                className="rg-table"
                columns={auditColumns}
                dataSource={auditData?.data ?? []}
                rowKey="AUDIT_ID"
                loading={loadingAudit}
                size="small"
                scroll={{ x: 900 }}
                pagination={{
                  current: auditPage,
                  pageSize: 50,
                  total: auditData?.total ?? 0,
                  onChange: setAuditPage,
                  showTotal: t => `${t} eventos`,
                }}
              />
            </>
          ),
        },

        // ── TAB: Política ──────────────────────────────────────────────────
        {
          key: 'politica',
          label: <span><SettingOutlined /> Política</span>,
          children: (
            <Row gutter={24}>
              <Col xs={24} md={14}>
                <Card title="Política de Seguridad" className="rg-card" size="small"
                  extra={
                    <Button type="primary" className="btn-gold" loading={policySaving} onClick={savePolicy}>
                      Guardar
                    </Button>
                  }
                >
                  {!politica
                    ? <Alert type="info" message="La tabla POLITICA_SEGURIDAD aún no existe. Ejecute la migración primero." />
                    : (
                      <Form form={policyForm} layout="vertical" size="small">
                        <Divider orientation="left">Contraseñas</Divider>
                        <Row gutter={12}>
                          <Col span={8}>
                            <Form.Item label="Longitud mínima" name="CLAVE_LONGITUD_MIN">
                              <InputNumber min={6} max={64} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="Historial" name="CLAVE_HISTORIAL">
                              <InputNumber min={0} max={24} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="Expira (días, 0=nunca)" name="CLAVE_EXPIRA_DIAS">
                              <InputNumber min={0} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Row gutter={12}>
                          <Col span={6}><Form.Item label="Mayúsculas" name="CLAVE_REQUIERE_MAYUS" valuePropName="checked"><Switch /></Form.Item></Col>
                          <Col span={6}><Form.Item label="Minúsculas" name="CLAVE_REQUIERE_MINUS" valuePropName="checked"><Switch /></Form.Item></Col>
                          <Col span={6}><Form.Item label="Números"    name="CLAVE_REQUIERE_NUMERO" valuePropName="checked"><Switch /></Form.Item></Col>
                          <Col span={6}><Form.Item label="Símbolos"   name="CLAVE_REQUIERE_SIMBOLO" valuePropName="checked"><Switch /></Form.Item></Col>
                        </Row>

                        <Divider orientation="left">Bloqueo de cuenta</Divider>
                        <Row gutter={12}>
                          <Col span={12}>
                            <Form.Item label="Intentos antes de bloqueo" name="LOCKOUT_INTENTOS">
                              <InputNumber min={1} max={20} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={12}>
                            <Form.Item label="Duración del bloqueo (min)" name="LOCKOUT_MINUTOS">
                              <InputNumber min={1} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Divider orientation="left">Sesión</Divider>
                        <Row gutter={12}>
                          <Col span={8}>
                            <Form.Item label="Duración token (min)" name="SESION_DURACION_MINUTOS">
                              <InputNumber min={5} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="Refresh (días)" name="REFRESH_DURACION_DIAS">
                              <InputNumber min={1} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item label="Inactividad (min)" name="SESION_INACTIVIDAD_MIN">
                              <InputNumber min={1} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>

                        <Divider orientation="left">MFA</Divider>
                        <Row gutter={12}>
                          <Col span={12}><Form.Item label="Obligatorio para Admin" name="MFA_OBLIGATORIO_ADMIN" valuePropName="checked"><Switch /></Form.Item></Col>
                          <Col span={12}><Form.Item label="Obligatorio para todos" name="MFA_OBLIGATORIO_TODOS" valuePropName="checked"><Switch /></Form.Item></Col>
                        </Row>
                      </Form>
                    )
                  }
                </Card>
              </Col>
              <Col xs={24} md={10}>
                <Card title="Última modificación" className="rg-card" size="small">
                  {politica ? (
                    <Space direction="vertical" size={4}>
                      <Text><Text strong>Fecha: </Text>{fmtDate(politica.FECHA_MODIFICACION)}</Text>
                      <Text><Text strong>ID usuario: </Text>{politica.MODIFICADO_POR ?? '—'}</Text>
                    </Space>
                  ) : <Text type="secondary">—</Text>}
                </Card>
              </Col>
            </Row>
          ),
        },
      ]} />

      {/* ── User create/edit modal ─────────────────────────────────────────── */}
      <Modal
        title={editUserId ? 'Editar Usuario' : 'Nuevo Usuario'}
        open={userModalOpen}
        onCancel={closeUserModal}
        onOk={handleUserSubmit}
        confirmLoading={updateMutation.isPending}
        okText={editUserId ? 'Guardar' : 'Crear'}
        okButtonProps={{ className: 'btn-gold' }}
        width={560}
        className="rg-modal"
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        <Form form={userForm} layout="vertical" size="small">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Nombre de usuario" name="nombre"
                rules={[{ required: true, message: 'Requerido' }]}>
                <Input disabled={!!editUserId} placeholder="ej. jperez" autoFocus />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Email" name="email" rules={[{ type: 'email', message: 'Email inválido' }]}>
                <Input placeholder="usuario@empresa.com" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Nombre completo" name="nombreCompleto">
                <Input placeholder="Juan Pérez" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Teléfono" name="telefono">
                <Input placeholder="+54 11 0000-0000" />
              </Form.Item>
            </Col>
          </Row>

          {/* Password — required on create, optional on edit */}
          <Form.Item
            label={editUserId ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña'}
            name="password"
            rules={!editUserId ? [{ required: true, min: 6, message: 'Mínimo 6 caracteres' }] : [{ min: 6, message: 'Mínimo 6 caracteres' }]}
          >
            <Input.Password placeholder={editUserId ? '(sin cambios)' : 'Contraseña segura…'} />
          </Form.Item>

          <Form.Item label="Roles" name="rolIds">
            <Select mode="multiple" placeholder="Sin rol" allowClear optionFilterProp="label"
              options={roles.map(r => ({ value: r.ROL_ID, label: r.NOMBRE }))} />
          </Form.Item>

          {editUserId && (
            <Form.Item style={{ marginBottom: 4 }}>
              <Checkbox
                checked={sobreescribirPermisos}
                onChange={e => setSobreescribirPermisos(e.target.checked)}
              >
                Sobreescribir permisos individuales con los del rol
              </Checkbox>
              {sobreescribirPermisos && (
                <div style={{ marginTop: 4, fontSize: 12, color: '#faad14' }}>
                  Se eliminarán todas las sobreescrituras individuales del usuario. Los permisos quedarán definidos únicamente por el rol asignado.
                </div>
              )}
            </Form.Item>
          )}

          <Divider orientation="left" style={{ fontSize: 12, margin: '8px 0' }}>Puntos de Venta</Divider>
          <Form.Item label="Puntos de venta asignados" name="pvIds">
            <Select
              mode="multiple"
              placeholder="Sin asignación"
              allowClear
              optionFilterProp="label"
              options={(allPuntosVenta as PuntoVenta[]).map(pv => ({ value: pv.PUNTO_VENTA_ID, label: pv.NOMBRE }))}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.pvIds !== curr.pvIds}>
            {({ getFieldValue }) => {
              const selectedPvIds: number[] = getFieldValue('pvIds') ?? [];
              const selectedPvs = (allPuntosVenta as PuntoVenta[]).filter(pv => selectedPvIds.includes(pv.PUNTO_VENTA_ID));
              return (
                <Form.Item label="Punto de venta preferido" name="pvPreferido">
                  <Select
                    placeholder="(ninguno)"
                    allowClear
                    optionFilterProp="label"
                    disabled={selectedPvs.length === 0}
                    options={selectedPvs.map(pv => ({ value: pv.PUNTO_VENTA_ID, label: pv.NOMBRE }))}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>

          {editUserId && (
            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label="Activo" name="activo" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label="Debe cambiar clave" name="debeCambiarClave" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          )}
        </Form>
      </Modal>

      {/* ── Permissions drawer ─────────────────────────────────────────────── */}
      {permDrawerUser && (
        <PermisosDrawer
          userId={permDrawerUser.id}
          nombre={permDrawerUser.nombre}
          open={!!permDrawerUser}
          onClose={() => setPermDrawerUser(null)}
        />
      )}

      {/* ── Role permissions drawer ────────────────────────────────────────── */}
      <RolPermisoDrawer
        rolId={rolDrawerId}
        open={rolDrawerId !== null}
        onClose={() => setRolDrawerId(null)}
      />
    </div>
  );
}
