import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography, Button, Space, Tag, Spin, Empty, message, Dropdown,
  Modal, Form, Input, InputNumber, Drawer, Table, Popconfirm, Tooltip,
  Segmented, Divider,
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined,
  ShoppingCartOutlined, CheckCircleOutlined, CoffeeOutlined, ClockCircleOutlined,
  UserOutlined, DollarOutlined, CloseOutlined, UndoOutlined,
  AppstoreOutlined, SearchOutlined, MinusOutlined, LockOutlined,
  LayoutOutlined, PrinterOutlined, SettingOutlined, FileTextOutlined,
  BellOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';
import { useTabStore } from '../store/tabStore';
import { useNavigationStore } from '../store/navigationStore';
import { fmtMoney } from '../utils/format';
import dayjs from 'dayjs';
import * as mesasApi from '../services/mesas.api';
import { NewSaleModal } from '../components/sales/NewSaleModal';
import type { PedidoParaVenta } from '../components/sales/NewSaleModal';
import type { Sector, Mesa, PedidoDetalle, ProductoSearchMesa, ProductoSearch, TipoServicioComanda } from '../types';
import { ProductSearchModal } from '../components/ProductSearchModal';

const { Title, Text } = Typography;

/* ═══════════════════════════════════════════════════
   MesasPage — Gestión de Mesas (Gastronomía)
   ═══════════════════════════════════════════════════ */

export function MesasPage() {
  const queryClient = useQueryClient();
  const { puntoVentaActivo } = useAuthStore();

  // ── State ─────────────────────────────────────
  const [sectorActivo, setSectorActivo] = useState<number | null>(null);
  const [sectorModalOpen, setSectorModalOpen] = useState(false);
  const [editingSector, setEditingSector] = useState<Sector | null>(null);
  const [mesaModalOpen, setMesaModalOpen] = useState(false);
  const [editingMesa, setEditingMesa] = useState<Mesa | null>(null);
  const [estadoModalMesa, setEstadoModalMesa] = useState<Mesa | null>(null);
  const [pedidoDrawerMesa, setPedidoDrawerMesa] = useState<Mesa | null>(null);
  const [historialDrawerMesa, setHistorialDrawerMesa] = useState<Mesa | null>(null);
  const [pasarVentaModal, setPasarVentaModal] = useState<PedidoParaVenta | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'layout'>('grid');
  const [tiposServicioDrawerOpen, setTiposServicioDrawerOpen] = useState(false);

  // ── Queries ───────────────────────────────────
  const { data: sectores = [], isLoading: loadingSectores } = useQuery({
    queryKey: ['mesas-sectores', puntoVentaActivo],
    queryFn: () => mesasApi.getSectores(puntoVentaActivo!),
    enabled: !!puntoVentaActivo,
  });

  const { data: mesas = [], isLoading: loadingMesas } = useQuery({
    queryKey: ['mesas-mesas', sectorActivo, puntoVentaActivo],
    queryFn: () => mesasApi.getMesas(sectorActivo!, puntoVentaActivo!),
    enabled: !!sectorActivo && !!puntoVentaActivo,
  });

  // ── Mutations ─────────────────────────────────
  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['mesas-sectores'] });
    queryClient.invalidateQueries({ queryKey: ['mesas-mesas'] });
  }, [queryClient]);

  const deleteSectorMut = useMutation({
    mutationFn: mesasApi.deleteSector,
    onSuccess: () => { message.success('Sector eliminado'); invalidate(); setSectorActivo(null); },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error al eliminar sector'),
  });
  const deleteMesaMut = useMutation({
    mutationFn: mesasApi.deleteMesa,
    onSuccess: () => { message.success('Mesa eliminada'); invalidate(); },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error al eliminar mesa'),
  });
  const cambiarEstadoMut = useMutation({
    mutationFn: ({ id, estado }: { id: number; estado: 'LIBRE' | 'OCUPADA' | 'RESERVADA' }) => mesasApi.cambiarEstadoMesa(id, estado),
    onSuccess: () => { message.success('Estado actualizado'); invalidate(); setEstadoModalMesa(null); },
  });

  // Auto-select first sector
  if (sectores.length > 0 && !sectorActivo && !loadingSectores && sectores[0]) {
    setSectorActivo(sectores[0].SECTOR_ID);
  }

  // ── Render ────────────────────────────────────
  return (
    <div className="page-enter">
      {/* ── Header ─────────────────────────────── */}
      <div className="page-header">
        <Title level={3}>Gestión de Mesas</Title>
        <Space wrap>
          <Segmented
            value={viewMode}
            onChange={(v) => setViewMode(v as 'grid' | 'layout')}
            options={[
              { value: 'grid', icon: <AppstoreOutlined />, label: 'Grilla' },
              { value: 'layout', icon: <LayoutOutlined />, label: 'Plano' },
            ]}
            size="small"
          />
          <Button icon={<PlusOutlined />} onClick={() => { setEditingSector(null); setSectorModalOpen(true); }}
            size="small">Nuevo Sector</Button>
          <Button icon={<PlusOutlined />} type="primary" onClick={() => { setEditingMesa(null); setMesaModalOpen(true); }}
            size="small" disabled={!sectorActivo}>Nueva Mesa</Button>
          <Button icon={<SettingOutlined />} size="small" onClick={() => setTiposServicioDrawerOpen(true)}>
            Tipos de Comanda
          </Button>
          <Button icon={<ReloadOutlined />} size="small" onClick={() => invalidate()} />
        </Space>
      </div>

      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        {/* ── Sidebar: Sectores ──────────────── */}
        <div style={{
          width: 200, minWidth: 200, background: '#f7f7f7', borderRadius: 10,
          border: '1px solid #e8e8e8',
          padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 4,
          overflowY: 'auto',
        }}>
          <Text strong style={{ color: '#999', fontSize: 11, textTransform: 'uppercase', padding: '0 8px', marginBottom: 4, letterSpacing: 0.5 }}>
            Sectores
          </Text>
          {loadingSectores ? <Spin size="small" style={{ margin: 'auto' }} /> :
            sectores.length === 0 ? <Text style={{ color: '#999', padding: 8, fontSize: 12 }}>Sin sectores</Text> :
            sectores.map(s => (
              <div
                key={s.SECTOR_ID}
                onClick={() => setSectorActivo(s.SECTOR_ID)}
                style={{
                  padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                  background: sectorActivo === s.SECTOR_ID ? 'rgba(234,189,35,0.12)' : 'transparent',
                  border: sectorActivo === s.SECTOR_ID ? '1px solid rgba(234,189,35,0.5)' : '1px solid transparent',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  transition: 'all 0.2s',
                }}
              >
                <Text style={{
                  color: sectorActivo === s.SECTOR_ID ? '#b8960e' : '#555',
                  fontWeight: sectorActivo === s.SECTOR_ID ? 600 : 400, fontSize: 13,
                }}>
                  <AppstoreOutlined style={{ marginRight: 6 }} />{s.NOMBRE}
                </Text>
                <Space size={2}>
                  <Button type="text" size="small" icon={<EditOutlined style={{ fontSize: 12 }} />}
                    onClick={(e) => { e.stopPropagation(); setEditingSector(s); setSectorModalOpen(true); }}
                    style={{ color: '#aaa', width: 24, height: 24 }} />
                  <Popconfirm title="¿Eliminar sector?" onConfirm={(e) => { e?.stopPropagation(); deleteSectorMut.mutate(s.SECTOR_ID); }}
                    onCancel={(e) => e?.stopPropagation()} okText="Sí" cancelText="No">
                    <Button type="text" size="small" icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: '#aaa', width: 24, height: 24 }} />
                  </Popconfirm>
                </Space>
              </div>
            ))
          }
        </div>

        {/* ── Main: Mesa grid / layout ──────── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {!sectorActivo ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Empty description="Seleccione un sector para ver las mesas"
                image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : loadingMesas ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Spin size="large" />
            </div>
          ) : mesas.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 12 }}>
              <Empty description="No hay mesas en este sector"
                image={Empty.PRESENTED_IMAGE_SIMPLE} />
              <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingMesa(null); setMesaModalOpen(true); }}>
                Crear primera mesa
              </Button>
            </div>
          ) : viewMode === 'grid' ? (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
              gap: 14, overflowY: 'auto', padding: '8px 4px 4px',
              maxHeight: 'calc(100vh - 200px)',
            }}>
              {mesas.map(mesa => (
                <MesaCard
                  key={mesa.MESA_ID}
                  mesa={mesa}
                  onPedido={() => setPedidoDrawerMesa(mesa)}
                  onEstado={() => setEstadoModalMesa(mesa)}
                  onHistorial={() => setHistorialDrawerMesa(mesa)}
                  onEditar={() => { setEditingMesa(mesa); setMesaModalOpen(true); }}
                  onEliminar={() => deleteMesaMut.mutate(mesa.MESA_ID)}
                />
              ))}
            </div>
          ) : (
            <MesaLayoutView
              mesas={mesas}
              onPedido={(mesa) => setPedidoDrawerMesa(mesa)}
              onEstado={(mesa) => setEstadoModalMesa(mesa)}
              onHistorial={(mesa) => setHistorialDrawerMesa(mesa)}
              onEditar={(mesa) => { setEditingMesa(mesa); setMesaModalOpen(true); }}
              onEliminar={(mesa) => deleteMesaMut.mutate(mesa.MESA_ID)}
              onPositionChange={(id, x, y) => {
                mesasApi.updateMesa(id, { POSICION_X: x, POSICION_Y: y }).then(() => invalidate());
              }}
            />
          )}
        </div>
      </div>

      {/* ── Modals & Drawers ─────────────────── */}
      <SectorModal
        open={sectorModalOpen}
        sector={editingSector}
        puntoVentaId={puntoVentaActivo!}
        onClose={() => { setSectorModalOpen(false); setEditingSector(null); }}
        onSuccess={invalidate}
      />
      <MesaModal
        open={mesaModalOpen}
        mesa={editingMesa}
        sectorId={sectorActivo!}
        puntoVentaId={puntoVentaActivo!}
        onClose={() => { setMesaModalOpen(false); setEditingMesa(null); }}
        onSuccess={invalidate}
      />
      <EstadoModal
        mesa={estadoModalMesa}
        onClose={() => setEstadoModalMesa(null)}
        onCambiar={(id, estado) => cambiarEstadoMut.mutate({ id, estado })}
      />
      <PedidoDrawer
        mesa={pedidoDrawerMesa}
        puntoVentaId={puntoVentaActivo!}
        onClose={() => { setPedidoDrawerMesa(null); invalidate(); }}
        onPasarAVenta={(pedido) => {
          setPedidoDrawerMesa(null);
          setPasarVentaModal({
            PEDIDO_ID: pedido.PEDIDO_ID,
            MESA_ID: pedido.MESA_ID ?? 0,
            items: (pedido.items || []).map(i => ({
              PRODUCTO_ID: i.PRODUCTO_ID || 0,
              NOMBRE: i.PRODUCTO_NOMBRE || `Producto #${i.PRODUCTO_ID}`,
              CODIGO: i.PRODUCTO_CODIGO || '',
              CANTIDAD: i.CANTIDAD,
              PRECIO_UNITARIO: i.PRECIO_UNITARIO,
              LISTA_PRECIO_SELECCIONADA: i.LISTA_PRECIO_SELECCIONADA,
            })),
          });
        }}
      />
      <HistorialDrawer
        mesa={historialDrawerMesa}
        onClose={() => setHistorialDrawerMesa(null)}
        onPasarAVenta={(pedido) => {
          setHistorialDrawerMesa(null);
          setPasarVentaModal({
            PEDIDO_ID: pedido.PEDIDO_ID,
            MESA_ID: pedido.MESA_ID ?? 0,
            items: (pedido.items || []).map(i => ({
              PRODUCTO_ID: i.PRODUCTO_ID || 0,
              NOMBRE: i.PRODUCTO_NOMBRE || `Producto #${i.PRODUCTO_ID}`,
              CODIGO: i.PRODUCTO_CODIGO || '',
              CANTIDAD: i.CANTIDAD,
              PRECIO_UNITARIO: i.PRECIO_UNITARIO,
              LISTA_PRECIO_SELECCIONADA: i.LISTA_PRECIO_SELECCIONADA,
            })),
          });
        }}
      />
      <NewSaleModal
        open={!!pasarVentaModal}
        pedido={pasarVentaModal}
        onClose={() => { setPasarVentaModal(null); invalidate(); }}
        onSuccess={() => { setPasarVentaModal(null); invalidate(); }}
      />
      <TiposServicioComandaDrawer
        open={tiposServicioDrawerOpen}
        puntoVentaId={puntoVentaActivo!}
        onClose={() => setTiposServicioDrawerOpen(false)}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MesaCard — Each table rendered as a card
   ═══════════════════════════════════════════════════ */

function MesaCard({ mesa, onPedido, onEstado, onHistorial, onEditar, onEliminar }: {
  mesa: Mesa;
  onPedido: () => void;
  onEstado: () => void;
  onHistorial: () => void;
  onEditar: () => void;
  onEliminar: () => void;
}) {
  const estadoColors: Record<string, { bg: string; border: string; accent: string }> = {
    LIBRE:     { bg: '#f0faf0', border: '#b7eb8f', accent: '#389e0d' },
    OCUPADA:   { bg: '#fff1f0', border: '#ffa39e', accent: '#cf1322' },
    RESERVADA: { bg: '#fffbe6', border: '#ffe58f', accent: '#d48806' },
  };
  const colors = estadoColors[mesa.ESTADO] ?? estadoColors.LIBRE!;
  const tienePedido = (mesa.PEDIDOS_ACTIVOS || 0) > 0;

  return (
    <div
      style={{
        background: colors.bg,
        border: `1.5px solid ${colors.border}`,
        borderRadius: 12,
        padding: '14px 14px 10px',
        cursor: 'pointer',
        transition: 'all 0.25s ease',
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        position: 'relative',
        minHeight: 160,
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={onPedido}
      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)'; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 6px 20px rgba(0,0,0,0.1)`; }}
      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.06)'; }}
    >
      {/* Active pedido indicator */}
      {tienePedido && (
        <Tooltip title="Pedido activo">
          <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
            <ShoppingCartOutlined style={{ fontSize: 12, color: '#b8960e' }} />
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#EABD23', boxShadow: '0 0 6px rgba(234,189,35,0.6)', animation: 'pulse-gold 2s infinite' }} />
          </div>
        </Tooltip>
      )}

      {/* Mesa number */}
      <div style={{ textAlign: 'center', marginBottom: 6 }}>
        <Text style={{ color: '#1E1F22', fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>
          {mesa.NUMERO_MESA}
        </Text>
      </div>

      {/* Status tag */}
      <div style={{ textAlign: 'center', marginBottom: 8 }}>
        <Tag color={mesa.ESTADO === 'LIBRE' ? 'success' : mesa.ESTADO === 'OCUPADA' ? 'error' : 'warning'}
          style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.5, borderRadius: 6, padding: '0 8px' }}>
          {mesa.ESTADO}
        </Tag>
      </div>

      {/* Capacity */}
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <Text style={{ color: '#888', fontSize: 11 }}>
          <UserOutlined style={{ marginRight: 3 }} />{mesa.CAPACIDAD} personas
        </Text>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 4, marginTop: 'auto', justifyContent: 'center' }}>
        <Tooltip title="Pedidos">
          <Button type="text" size="small" icon={<ShoppingCartOutlined />}
            onClick={(e) => { e.stopPropagation(); onPedido(); }}
            style={{ color: '#b8960e', fontSize: 13, width: 30, height: 28 }} />
        </Tooltip>
        <Tooltip title="Cambiar estado">
          <Button type="text" size="small" icon={<LockOutlined />}
            onClick={(e) => { e.stopPropagation(); onEstado(); }}
            style={{ color: colors.accent, fontSize: 13, width: 30, height: 28 }} />
        </Tooltip>
        <Tooltip title="Historial">
          <Button type="text" size="small" icon={<ClockCircleOutlined />}
            onClick={(e) => { e.stopPropagation(); onHistorial(); }}
            style={{ color: '#888', fontSize: 13, width: 30, height: 28 }} />
        </Tooltip>
        <Tooltip title="Editar">
          <Button type="text" size="small" icon={<EditOutlined />}
            onClick={(e) => { e.stopPropagation(); onEditar(); }}
            style={{ color: '#888', fontSize: 13, width: 30, height: 28 }} />
        </Tooltip>
        <Popconfirm title="¿Eliminar mesa?" onConfirm={(e) => { e?.stopPropagation(); onEliminar(); }}
          onCancel={(e) => e?.stopPropagation()} okText="Sí" cancelText="No">
          <Tooltip title="Eliminar">
            <Button type="text" size="small" icon={<DeleteOutlined />}
              onClick={(e) => e.stopPropagation()}
              style={{ color: '#ff7875', fontSize: 13, width: 30, height: 28 }} />
          </Tooltip>
        </Popconfirm>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   MesaLayoutView — Spatial / floor-plan view
   ═══════════════════════════════════════════════════ */

function MesaLayoutView({ mesas, onPedido, onEstado, onHistorial, onEditar, onEliminar, onPositionChange }: {
  mesas: Mesa[];
  onPedido: (mesa: Mesa) => void;
  onEstado: (mesa: Mesa) => void;
  onHistorial: (mesa: Mesa) => void;
  onEditar: (mesa: Mesa) => void;
  onEliminar: (mesa: Mesa) => void;
  onPositionChange: (id: number, x: number, y: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; offsetX: number; offsetY: number } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: number; x: number; y: number } | null>(null);
  const didDrag = useRef(false);

  const estadoColors: Record<string, { bg: string; border: string }> = {
    LIBRE:     { bg: '#f0faf0', border: '#52c41a' },
    OCUPADA:   { bg: '#fff1f0', border: '#ff4d4f' },
    RESERVADA: { bg: '#fffbe6', border: '#faad14' },
  };

  const handleMouseDown = (e: React.MouseEvent, mesa: Mesa) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const posX = mesa.POSICION_X ?? 0;
    const posY = mesa.POSICION_Y ?? 0;
    dragRef.current = {
      id: mesa.MESA_ID,
      offsetX: e.clientX - rect.left - posX,
      offsetY: e.clientY - rect.top - posY,
    };
    setDragPos({ id: mesa.MESA_ID, x: posX, y: posY });
    didDrag.current = false;

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current || !containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      const newX = Math.max(0, Math.min(r.width - 130, ev.clientX - r.left - dragRef.current.offsetX));
      const newY = Math.max(0, Math.min(r.height - 80, ev.clientY - r.top - dragRef.current.offsetY));
      didDrag.current = true;
      setDragPos({ id: dragRef.current.id, x: Math.round(newX), y: Math.round(newY) });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (dragRef.current && dragPos) {
        // Use the latest position from the ref callback in mousemove
      }
      const dp = dragRef.current;
      dragRef.current = null;
      // Save via a micro-task so we read the final dragPos from state
      setTimeout(() => {
        setDragPos(prev => {
          if (prev && dp) onPositionChange(dp.id, prev.x, prev.y);
          return null;
        });
      }, 0);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const getMenuItems = (mesa: Mesa) => ([
    { key: 'pedido', icon: <ShoppingCartOutlined />, label: 'Ver Pedido', onClick: () => onPedido(mesa) },
    { key: 'estado', icon: <LockOutlined />, label: 'Cambiar Estado', onClick: () => onEstado(mesa) },
    { key: 'historial', icon: <ClockCircleOutlined />, label: 'Historial', onClick: () => onHistorial(mesa) },
    { type: 'divider' as const },
    { key: 'editar', icon: <EditOutlined />, label: 'Editar Mesa', onClick: () => onEditar(mesa) },
    { key: 'eliminar', icon: <DeleteOutlined />, label: 'Eliminar Mesa', danger: true, onClick: () => onEliminar(mesa) },
  ]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 200px)',
        background: '#fafafa',
        border: '1px dashed #d9d9d9',
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: 8, left: 12, color: '#bbb', fontSize: 11 }}>
        Arrastrá las mesas para posicionarlas &middot; Doble click para pedido &middot; Click derecho para opciones
      </div>
      {mesas.map(mesa => {
        const isDragging = dragPos?.id === mesa.MESA_ID;
        const x = isDragging ? dragPos.x : (mesa.POSICION_X ?? 0);
        const y = isDragging ? dragPos.y : (mesa.POSICION_Y ?? 0);
        const c = estadoColors[mesa.ESTADO] ?? estadoColors.LIBRE!;
        const tienePedido = (mesa.PEDIDOS_ACTIVOS || 0) > 0;
        return (
          <Dropdown key={mesa.MESA_ID} menu={{ items: getMenuItems(mesa) }} trigger={['contextMenu']}>
            <div
              onMouseDown={(e) => { if (e.button === 0) handleMouseDown(e, mesa); }}
              onDoubleClick={() => { if (!didDrag.current) onPedido(mesa); }}
              style={{
                position: 'absolute',
                left: x,
                top: y + 28,
                width: 130,
                height: 80,
                background: c.bg,
                border: `2px solid ${c.border}`,
                borderRadius: 10,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isDragging ? 'grabbing' : 'grab',
                boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.18)' : '0 1px 4px rgba(0,0,0,0.08)',
                transition: isDragging ? 'none' : 'box-shadow 0.2s',
                zIndex: isDragging ? 10 : 1,
                userSelect: 'none',
              }}
            >
              {tienePedido && (
                <div style={{ position: 'absolute', top: 4, right: 6, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <ShoppingCartOutlined style={{ fontSize: 10, color: '#b8960e' }} />
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#EABD23', boxShadow: '0 0 5px rgba(234,189,35,0.6)', animation: 'pulse-gold 2s infinite' }} />
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 15, fontWeight: 700, color: '#1E1F22', lineHeight: 1.2 }}>
                  {mesa.NUMERO_MESA}
                </Text>
              </div>
              <Tag
                color={mesa.ESTADO === 'LIBRE' ? 'success' : mesa.ESTADO === 'OCUPADA' ? 'error' : 'warning'}
                style={{ fontSize: 9, marginTop: 4, borderRadius: 4, padding: '0 5px', lineHeight: '16px' }}
              >
                {mesa.ESTADO}
              </Tag>
            </div>
          </Dropdown>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   SectorModal — Create / Edit Sector
   ═══════════════════════════════════════════════════ */

function SectorModal({ open, sector, puntoVentaId, onClose, onSuccess }: {
  open: boolean; sector: Sector | null; puntoVentaId: number;
  onClose: () => void; onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      if (sector) {
        await mesasApi.updateSector(sector.SECTOR_ID, { NOMBRE: values.nombre });
        message.success('Sector actualizado');
      } else {
        await mesasApi.createSector({ NOMBRE: values.nombre, PUNTO_VENTA_ID: puntoVentaId });
        message.success('Sector creado');
      }
      onSuccess();
      onClose();
      form.resetFields();
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} title={sector ? 'Editar Sector' : 'Nuevo Sector'}
      onCancel={() => { onClose(); form.resetFields(); }} onOk={handleOk} confirmLoading={loading}
      destroyOnHidden width={360}
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}>
      <Form form={form} layout="vertical" initialValues={{ nombre: sector?.NOMBRE || '' }}>
        <Form.Item name="nombre" label="Nombre del Sector" rules={[{ required: true, message: 'Ingrese el nombre' }]}>
          <Input autoFocus placeholder="Ej: Salón Principal" maxLength={100} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════
   MesaModal — Create / Edit Mesa
   ═══════════════════════════════════════════════════ */

function MesaModal({ open, mesa, sectorId, puntoVentaId, onClose, onSuccess }: {
  open: boolean; mesa: Mesa | null; sectorId: number; puntoVentaId: number;
  onClose: () => void; onSuccess: () => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      if (mesa) {
        await mesasApi.updateMesa(mesa.MESA_ID, {
          NUMERO_MESA: values.numero,
          CAPACIDAD: values.capacidad,
        });
        message.success('Mesa actualizada');
      } else {
        await mesasApi.createMesa({
          NUMERO_MESA: values.numero,
          SECTOR_ID: sectorId,
          CAPACIDAD: values.capacidad,
          PUNTO_VENTA_ID: puntoVentaId,
        });
        message.success('Mesa creada');
      }
      onSuccess();
      onClose();
      form.resetFields();
    } catch (err: any) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || 'Error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open={open} title={mesa ? 'Editar Mesa' : 'Nueva Mesa'}
      onCancel={() => { onClose(); form.resetFields(); }} onOk={handleOk} confirmLoading={loading}
      destroyOnHidden width={380}
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}>
      <Form form={form} layout="vertical"
        initialValues={{ numero: mesa?.NUMERO_MESA || '', capacidad: mesa?.CAPACIDAD || 4 }}>
        <Form.Item name="numero" label="Número / Nombre de Mesa"
          rules={[{ required: true, message: 'Ingrese el número de mesa' }]}>
          <Input placeholder="Ej: 1, A1, Terraza 1" maxLength={20} />
        </Form.Item>
        <Form.Item name="capacidad" label="Capacidad (personas)"
          rules={[{ required: true, message: 'Ingrese la capacidad' }]}>
          <InputNumber min={1} max={100} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════
   EstadoModal — Change table state
   ═══════════════════════════════════════════════════ */

function EstadoModal({ mesa, onClose, onCambiar }: {
  mesa: Mesa | null;
  onClose: () => void;
  onCambiar: (id: number, estado: 'LIBRE' | 'OCUPADA' | 'RESERVADA') => void;
}) {
  const estados: { value: Mesa['ESTADO']; label: string; color: string; icon: React.ReactNode }[] = [
    { value: 'LIBRE', label: 'Libre', color: '#52c41a', icon: <CheckCircleOutlined /> },
    { value: 'OCUPADA', label: 'Ocupada', color: '#ff4d4f', icon: <CoffeeOutlined /> },
    { value: 'RESERVADA', label: 'Reservada', color: '#faad14', icon: <ClockCircleOutlined /> },
  ];

  return (
    <Modal open={!!mesa} title={`Cambiar Estado — Mesa ${mesa?.NUMERO_MESA}`}
      onCancel={onClose} footer={null} width={340} destroyOnHidden
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
        {estados.map(e => (
          <Button
            key={e.value}
            block
            size="large"
            icon={e.icon}
            disabled={mesa?.ESTADO === e.value}
            onClick={() => mesa && onCambiar(mesa.MESA_ID, e.value)}
            style={{
              borderColor: e.color,
              color: mesa?.ESTADO === e.value ? '#bbb' : e.color,
              background: mesa?.ESTADO === e.value ? '#f5f5f5' : 'transparent',
              fontWeight: 600,
              height: 48,
            }}
          >
            {e.label} {mesa?.ESTADO === e.value && '(actual)'}
          </Button>
        ))}
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════
   PedidoDrawer — Order management for a table
   ═══════════════════════════════════════════════════ */

function PedidoDrawer({ mesa, puntoVentaId, onClose, onPasarAVenta }: {
  mesa: Mesa | null;
  puntoVentaId: number;
  onClose: () => void;
  onPasarAVenta: (pedido: PedidoDetalle) => void;
}) {
  const [searchText, setSearchText] = useState('');
  const searchRef = useRef<any>(null);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchInitial, setProductSearchInitial] = useState('');
  const productSearchKey = useRef(0);
  const [printModalOpen, setPrintModalOpen] = useState(false);

  const { data: pedidoActivo, isLoading: loadingPedido, refetch: refetchPedido } = useQuery({
    queryKey: ['pedido-activo', mesa?.MESA_ID],
    queryFn: () => mesasApi.getPedidoActivoMesa(mesa!.MESA_ID),
    enabled: !!mesa,
  });

  const crearPedidoMut = useMutation({
    mutationFn: () => mesasApi.crearPedido({ MESA_ID: mesa!.MESA_ID, PUNTO_VENTA_ID: puntoVentaId }),
    onSuccess: () => { message.success('Pedido creado'); refetchPedido(); },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error'),
  });

  const agregarItemMut = useMutation({
    mutationFn: (data: { pedidoId: number; producto: ProductoSearchMesa }) =>
      mesasApi.agregarItemPedido(data.pedidoId, {
        PRODUCTO_ID: data.producto.PRODUCTO_ID,
        CANTIDAD: 1,
        PRECIO_UNITARIO: data.producto.PRECIO_VENTA,
        PUNTO_VENTA_ID: puntoVentaId,
        LISTA_PRECIO_SELECCIONADA: data.producto.LISTA_DEFECTO,
      }),
    onSuccess: () => { refetchPedido(); setSearchText(''); },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error al agregar'),
  });

  const actualizarQtyMut = useMutation({
    mutationFn: ({ itemId, cantidad }: { itemId: number; cantidad: number }) =>
      mesasApi.actualizarCantidadItem(itemId, cantidad),
    onSuccess: () => refetchPedido(),
  });

  const eliminarItemMut = useMutation({
    mutationFn: mesasApi.eliminarItemPedido,
    onSuccess: () => { message.success('Item eliminado'); refetchPedido(); },
  });

  const reabrirPedidoMut = useMutation({
    mutationFn: mesasApi.reabrirPedido,
    onSuccess: () => { message.success('Pedido reabierto'); refetchPedido(); },
  });

  const handleAddProduct = (prod: ProductoSearchMesa) => {
    if (!pedidoActivo) return;
    agregarItemMut.mutate({ pedidoId: pedidoActivo.PEDIDO_ID, producto: prod });
  };

  const addProductFromSearch = useCallback((product: ProductoSearch) => {
    const p: ProductoSearchMesa = {
      PRODUCTO_ID: product.PRODUCTO_ID,
      CODIGOPARTICULAR: product.CODIGOPARTICULAR,
      NOMBRE: product.NOMBRE,
      PRECIO_VENTA: product.PRECIO_VENTA,
      LISTA_DEFECTO: product.LISTA_DEFECTO,
      STOCK: product.STOCK,
      UNIDAD_ABREVIACION: product.UNIDAD_ABREVIACION,
    };
    handleAddProduct(p);
  }, [pedidoActivo]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const text = searchText.trim();
    if (!text) return;
    e.preventDefault();

    mesasApi.searchProductosMesa(text, puntoVentaId).then(products => {
      if (products.length === 1) {
        handleAddProduct(products[0]!);
        setSearchText('');
      } else if (products.length > 1) {
        const exact = products.find(p => p.CODIGOPARTICULAR?.toUpperCase() === text.toUpperCase());
        if (exact) {
          handleAddProduct(exact);
          setSearchText('');
        } else {
          setProductSearchInitial(text);
          productSearchKey.current += 1;
          setProductSearchOpen(true);
          setSearchText('');
        }
      } else {
        setProductSearchInitial(text);
        productSearchKey.current += 1;
        setProductSearchOpen(true);
        setSearchText('');
      }
    });
  }, [searchText, puntoVentaId, pedidoActivo]);

  const pedidoItems = pedidoActivo?.items || [];
  const total = pedidoItems.reduce((sum, i) => sum + i.CANTIDAD * i.PRECIO_UNITARIO, 0);
  const esCerrado = pedidoActivo?.ESTADO === 'CERRADO';

  return (
    <>
    <Drawer
      open={!!mesa}
      onClose={() => { onClose(); setSearchText(''); }}
      title={
        <Space>
          <CoffeeOutlined style={{ color: '#EABD23' }} />
          <span style={{ fontWeight: 600 }}>Mesa {mesa?.NUMERO_MESA}</span>
          {pedidoActivo && (
            <Tag color={pedidoActivo.ESTADO === 'CERRADO' ? 'default' : pedidoActivo.ESTADO === 'EN_PREPARACION' ? 'processing' : 'success'}>
              {pedidoActivo.ESTADO === 'ABIERTO' ? 'Abierto' : pedidoActivo.ESTADO === 'EN_PREPARACION' ? 'En preparación' : 'Cerrado'}
            </Tag>
          )}
        </Space>
      }
      width={700}
      destroyOnHidden
    >
      {loadingPedido ? <Spin style={{ display: 'block', margin: '60px auto' }} /> :
        !pedidoActivo ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Empty description="No hay pedido activo en esta mesa" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            <Button type="primary" size="large" icon={<PlusOutlined />}
              onClick={() => crearPedidoMut.mutate()}
              loading={crearPedidoMut.isPending}
              style={{ marginTop: 16 }}>
              Crear Nuevo Pedido
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* Search bar to add products */}
            {!esCerrado && (
              <div style={{ marginBottom: 14 }}>
                <Input
                  ref={searchRef}
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  prefix={<SearchOutlined style={{ color: '#999' }} />}
                  suffix={
                    <Tag color="default" style={{ margin: 0, fontSize: 11, opacity: 0.5 }}>
                      Enter
                    </Tag>
                  }
                  placeholder="Buscar producto para agregar..."
                  size="large"
                  allowClear
                  onKeyDown={handleSearchKeyDown}
                />
              </div>
            )}

            {/* Items table */}
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 12 }}>
              {pedidoItems.length === 0 ? (
                <Empty description="Agregue productos al pedido" image={Empty.PRESENTED_IMAGE_SIMPLE}
                  style={{ marginTop: 40 }} />
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #EABD23' }}>
                      <th style={{ textAlign: 'left', padding: '8px 10px', color: '#1E1F22', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>Producto</th>
                      <th style={{ textAlign: 'center', padding: '8px 10px', color: '#1E1F22', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, width: 120 }}>Cant.</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', color: '#1E1F22', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, width: 100 }}>Precio</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', color: '#1E1F22', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, width: 100 }}>Subtotal</th>
                      {!esCerrado && <th style={{ width: 36 }}></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {pedidoItems.map(item => (
                      <tr key={item.PEDIDO_ITEM_ID} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={{ padding: '10px 10px', color: '#333', fontSize: 13, fontWeight: 500 }}>
                          {item.PRODUCTO_NOMBRE || `Producto #${item.PRODUCTO_ID || item.PROMOCION_ID}`}
                        </td>
                        <td style={{ textAlign: 'center', padding: '6px 6px' }}>
                          {!esCerrado ? (
                            <Space size={4}>
                              <Button size="small" icon={<MinusOutlined style={{ fontSize: 10 }} />}
                                disabled={item.CANTIDAD <= 1}
                                onClick={() => actualizarQtyMut.mutate({ itemId: item.PEDIDO_ITEM_ID, cantidad: item.CANTIDAD - 1 })}
                                style={{ width: 26, height: 26 }} />
                              <Text style={{ color: '#1E1F22', fontWeight: 700, fontSize: 14, minWidth: 30, display: 'inline-block', textAlign: 'center' }}>
                                {item.CANTIDAD % 1 === 0 ? item.CANTIDAD : item.CANTIDAD.toFixed(2)}
                              </Text>
                              <Button size="small" icon={<PlusOutlined style={{ fontSize: 10 }} />}
                                onClick={() => actualizarQtyMut.mutate({ itemId: item.PEDIDO_ITEM_ID, cantidad: item.CANTIDAD + 1 })}
                                style={{ width: 26, height: 26 }} />
                            </Space>
                          ) : (
                            <Text style={{ color: '#333', fontWeight: 600 }}>{item.CANTIDAD}</Text>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', padding: '10px 10px', color: '#666', fontSize: 13 }}>
                          {fmtMoney(item.PRECIO_UNITARIO)}
                        </td>
                        <td style={{ textAlign: 'right', padding: '10px 10px', color: '#b8960e', fontWeight: 700, fontSize: 13 }}>
                          {fmtMoney(item.CANTIDAD * item.PRECIO_UNITARIO)}
                        </td>
                        {!esCerrado && (
                          <td style={{ padding: '4px 0' }}>
                            <Popconfirm title="¿Quitar item?" onConfirm={() => eliminarItemMut.mutate(item.PEDIDO_ITEM_ID)}
                              okText="Sí" cancelText="No">
                              <Button type="text" size="small" danger icon={<CloseOutlined style={{ fontSize: 10 }} />}
                                style={{ width: 26, height: 26 }} />
                            </Popconfirm>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Footer with total and actions */}
            <div style={{ borderTop: '2px solid #EABD23', paddingTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <Text style={{ color: '#666', fontSize: 15, fontWeight: 500 }}>Total del Pedido</Text>
                <Text style={{ color: '#b8960e', fontSize: 24, fontWeight: 700 }}>{fmtMoney(total)}</Text>
              </div>
              <Space style={{ width: '100%', justifyContent: 'flex-end' }} wrap>
                {pedidoItems.length > 0 && (
                  <Button icon={<PrinterOutlined />}
                    onClick={() => setPrintModalOpen(true)}>
                    Imprimir
                  </Button>
                )}
                {!esCerrado && pedidoItems.length > 0 && (
                  <Button type="primary" icon={<DollarOutlined />}
                    onClick={() => onPasarAVenta(pedidoActivo)}
                    style={{ background: '#52c41a', borderColor: '#52c41a' }}>
                    Cobrar
                  </Button>
                )}
                {esCerrado && (
                  <>
                    <Button icon={<UndoOutlined />} onClick={() => reabrirPedidoMut.mutate(pedidoActivo.PEDIDO_ID)}
                      loading={reabrirPedidoMut.isPending}>
                      Reabrir
                    </Button>
                    <Button type="primary" icon={<DollarOutlined />}
                      onClick={() => onPasarAVenta(pedidoActivo)}
                      style={{ background: '#52c41a', borderColor: '#52c41a' }}>
                      Cobrar
                    </Button>
                  </>
                )}
              </Space>
            </div>
          </div>
        )
      }
    </Drawer>

    <ProductSearchModal
      key={productSearchKey.current}
      open={productSearchOpen}
      onClose={() => {
        setProductSearchOpen(false);
        setTimeout(() => searchRef.current?.focus(), 0);
      }}
      onSelect={(products) => {
        products.forEach(p => addProductFromSearch(p));
      }}
      initialSearch={productSearchInitial}
      searchFn={mesasApi.searchProductosMesaAdvanced}
    />
    {pedidoActivo && (
      <PrintPedidoModal
        open={printModalOpen}
        pedidoId={pedidoActivo.PEDIDO_ID}
        puntoVentaId={puntoVentaId}
        mesaNumero={mesa?.NUMERO_MESA || ''}
        onClose={() => setPrintModalOpen(false)}
      />
    )}
    </>
  );
}

/* ═══════════════════════════════════════════════════
   HistorialDrawer — Order history for a table
   ═══════════════════════════════════════════════════ */

function HistorialDrawer({ mesa, onClose, onPasarAVenta }: {
  mesa: Mesa | null;
  onClose: () => void;
  onPasarAVenta: (pedido: PedidoDetalle) => void;
}) {
  const { data: pedidos = [], isLoading } = useQuery({
    queryKey: ['pedidos-mesa', mesa?.MESA_ID],
    queryFn: () => mesasApi.getPedidosMesa(mesa!.MESA_ID),
    enabled: !!mesa,
  });

  const handlePasarAVenta = async (pedidoId: number) => {
    try {
      const pedido = await mesasApi.getPedidoById(pedidoId);
      if (pedido) onPasarAVenta(pedido);
    } catch {
      message.error('Error al cargar pedido');
    }
  };

  return (
    <Drawer open={!!mesa} onClose={onClose}
      title={<><ClockCircleOutlined style={{ color: '#EABD23', marginRight: 8 }} />Historial — Mesa {mesa?.NUMERO_MESA}</>}
      width={520} destroyOnHidden>
      {isLoading ? <Spin style={{ display: 'block', margin: '40px auto' }} /> :
        pedidos.length === 0 ? <Empty description="Sin pedidos registrados" /> :
        <Table
          dataSource={pedidos}
          rowKey="PEDIDO_ID"
          size="small"
          pagination={{ pageSize: 15, size: 'small' }}
          columns={[
            { title: '#', dataIndex: 'PEDIDO_ID', width: 60 },
            { title: 'Estado', dataIndex: 'ESTADO', width: 110, render: (v: string) => (
              <Tag color={v === 'ABIERTO' ? 'success' : v === 'EN_PREPARACION' ? 'processing' : 'default'}>{v}</Tag>
            )},
            { title: 'Total', dataIndex: 'TOTAL', width: 100, render: (v: number) => <Text strong style={{ color: '#b8960e' }}>{fmtMoney(v)}</Text> },
            { title: 'Fecha', dataIndex: 'FECHA_CREACION', render: (v: string) => dayjs(v).format('DD/MM/YY HH:mm') },
            { title: '', width: 100, render: (_: any, record: any) =>
              record.ESTADO === 'CERRADO' && (
                record.VENTA_ID ? (
                  <Button size="small" type="link" icon={<DollarOutlined />}
                    onClick={() => {
                      onClose();
                      useTabStore.getState().openTab({ key: '/sales', label: 'Ventas', closable: true });
                      useNavigationStore.getState().navigate('/sales', { ventaId: record.VENTA_ID });
                    }}>
                    Venta #{record.VENTA_ID}
                  </Button>
                ) : (
                  <Button size="small" type="link" icon={<DollarOutlined />}
                    onClick={() => handlePasarAVenta(record.PEDIDO_ID)}>
                    Facturar
                  </Button>
                )
              )
            },
          ]}
        />
      }
    </Drawer>
  );
}

/* ═══════════════════════════════════════════════════
   PrintPedidoModal — Print options for an order
   ═══════════════════════════════════════════════════ */

function PrintPedidoModal({ open, pedidoId, puntoVentaId, mesaNumero, onClose }: {
  open: boolean;
  pedidoId: number;
  puntoVentaId: number;
  mesaNumero: string;
  onClose: () => void;
}) {
  const { data: tiposServicio = [] } = useQuery({
    queryKey: ['tipos-servicio-pedido', pedidoId, puntoVentaId],
    queryFn: () => mesasApi.getTiposServicioEnPedido(pedidoId, puntoVentaId),
    enabled: open,
  });

  const handlePrint = async (type: 'comanda' | 'cuenta' | 'servicio', tipoServicioId?: number, tipoNombre?: string) => {
    try {
      let data;
      let title = '';
      if (type === 'comanda') {
        data = await mesasApi.getComandaData(pedidoId);
        title = `Comanda - Mesa ${mesaNumero}`;
      } else if (type === 'cuenta') {
        data = await mesasApi.getCuentaClienteData(pedidoId);
        title = `Cuenta del Cliente - Mesa ${mesaNumero}`;
      } else if (type === 'servicio' && tipoServicioId) {
        data = await mesasApi.getComandaData(pedidoId, tipoServicioId);
        title = `Comanda ${tipoNombre} - Mesa ${mesaNumero}`;
      }
      if (data) {
        const isCuenta = type === 'cuenta';
        const itemsHtml = (data.items || []).map((item: any) =>
          isCuenta
            ? `<tr>
                <td style="padding:2px 0">${item.NOMBRE}</td>
                <td style="text-align:center;padding:2px 2px">${item.CANTIDAD}</td>
                <td style="text-align:right;padding:2px 0">$${item.PRECIO_UNITARIO.toFixed(2)}</td>
                <td style="text-align:right;padding:2px 0;font-weight:bold">$${item.TOTAL.toFixed(2)}</td>
              </tr>`
            : `<tr>
                <td style="padding:2px 0">${item.NOMBRE}</td>
                <td style="text-align:center;padding:2px 2px;font-weight:bold">${item.CANTIDAD}</td>
              </tr>`
        ).join('');

        let html: string;
        if (isCuenta) {
          // ── Cuenta del cliente: receipt style with prices ──
          html = `<!DOCTYPE html><html><head><title>${title}</title>
            <style>
              @page{size:80mm auto;margin:0}
              *{margin:0;padding:0;box-sizing:border-box}
              body{font-family:'Lucida Console','Courier New',monospace;padding:3mm;width:80mm;font-size:11px;line-height:1.2}
              table{width:100%;border-collapse:collapse}
              th,td{font-size:11px}
            </style></head><body>
            ${data.NOMBRE_FANTASIA ? `<div style="text-align:center;font-weight:bold;font-size:14px;margin-bottom:1px;text-transform:uppercase">${data.NOMBRE_FANTASIA}</div>` : ''}
            <div style="text-align:center;font-weight:bold;font-size:12px;margin-bottom:2px">${title}</div>
            <div style="text-align:center;font-size:10px;margin-bottom:1px">Mesa: ${data.MESA} | Sector: ${data.SECTOR}</div>
            <div style="text-align:center;font-size:10px;margin-bottom:1px">Mozo: ${data.MOZO}</div>
            <div style="text-align:center;font-size:10px;margin-bottom:4px">${dayjs(data.FECHA).format('DD/MM/YYYY HH:mm')}</div>
            <hr style="border:none;border-top:1px dashed #000;margin:2px 0">
            <table style="margin-top:3px">
              <thead><tr style="border-bottom:1px solid #000">
                <th style="text-align:left">Producto</th>
                <th style="text-align:center;width:40px">Cant.</th>
                <th style="text-align:right;width:60px">Precio</th>
                <th style="text-align:right;width:60px">Total</th>
              </tr></thead>
              <tbody>${itemsHtml}</tbody>
            </table>
            <div style="border-top:1px dashed #000;margin-top:4px;padding-top:4px;text-align:right;font-weight:bold;font-size:14px">
              TOTAL: $${data.TOTAL.toFixed(2)}
            </div>
            <div style="text-align:center;margin-top:6px;font-size:10px;font-style:italic">¡Gracias por su visita!</div>
            <hr style="border:none;border-top:1px dashed #000;margin:6px 0 2px 0">
            <div style="text-align:center;font-size:8px;color:#555">Río Gestión Software</div>
            </body></html>`;
        } else {
          // ── Comanda: clean professional style, no prices ──
          const labelServicio = type === 'servicio' && tipoNombre ? tipoNombre : '';
          html = `<!DOCTYPE html><html><head><title>${title}</title>
            <style>
              @page{size:80mm auto;margin:0}
              *{margin:0;padding:0;box-sizing:border-box}
              body{font-family:'Lucida Console','Courier New',monospace;padding:3mm;width:80mm;font-size:11px;line-height:1.2}
              table{width:100%;border-collapse:collapse}
              th,td{font-size:11px}
            </style></head><body>
            ${data.NOMBRE_FANTASIA ? `<div style="text-align:center;font-weight:bold;font-size:14px;margin-bottom:1px;text-transform:uppercase">${data.NOMBRE_FANTASIA}</div>` : ''}
            <div style="text-align:center;font-weight:bold;font-size:12px;margin-bottom:2px">COMANDA</div>
            ${labelServicio ? `<div style="text-align:center;font-size:11px;margin-bottom:2px;font-weight:bold">${labelServicio}</div>` : ''}
            <div style="text-align:center;font-size:10px;margin-bottom:1px">Mesa: ${data.MESA} | Sector: ${data.SECTOR}</div>
            <div style="text-align:center;font-size:10px;margin-bottom:1px">Mozo: ${data.MOZO}</div>
            <div style="text-align:center;font-size:10px;margin-bottom:4px">${dayjs(data.FECHA).format('DD/MM/YYYY HH:mm')}</div>
            <hr style="border:none;border-top:1px dashed #000;margin:2px 0">
            <table style="margin-top:3px">
              <thead><tr style="border-bottom:1px solid #000">
                <th style="text-align:left;padding:2px 0">Producto</th>
                <th style="text-align:center;width:50px;padding:2px 0">Cant.</th>
              </tr></thead>
              <tbody>${itemsHtml}</tbody>
            </table>
            <hr style="border:none;border-top:1px dashed #000;margin:6px 0 2px 0">
            <div style="text-align:center;font-size:8px;color:#555">Río Gestión Software</div>
            </body></html>`;
        }

        // Use hidden iframe for cleaner printing (no popup, no blocker issues)
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;visibility:hidden';
        document.body.appendChild(iframe);
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc || !iframe.contentWindow) {
          message.error('No se pudo preparar la impresión');
          document.body.removeChild(iframe);
          return;
        }
        doc.open();
        doc.write(html);
        doc.close();
        // Wait for content to render, then print
        iframe.contentWindow.onafterprint = () => {
          document.body.removeChild(iframe);
        };
        setTimeout(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          // Fallback removal if onafterprint doesn't fire
          setTimeout(() => {
            if (iframe.parentNode) document.body.removeChild(iframe);
          }, 60000);
        }, 200);
      }
    } catch (err) {
      message.error('Error al obtener datos de impresión');
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={<><PrinterOutlined style={{ color: '#EABD23', marginRight: 8 }} />Imprimir — Mesa {mesaNumero}</>}
      footer={null}
      width={380}
      destroyOnHidden
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
        <Button
          block
          size="large"
          icon={<FileTextOutlined />}
          onClick={() => { handlePrint('comanda'); onClose(); }}
          style={{ textAlign: 'left', fontWeight: 600, height: 48 }}
        >
          Imprimir comanda completa
        </Button>

        <Button
          block
          size="large"
          icon={<DollarOutlined />}
          onClick={() => { handlePrint('cuenta'); onClose(); }}
          style={{ textAlign: 'left', fontWeight: 600, height: 48 }}
        >
          Imprimir cuenta del cliente
        </Button>

        {tiposServicio.length > 0 && (
          <>
            <Divider style={{ margin: '4px 0', fontSize: 11, color: '#999' }}>Por tipo de servicio</Divider>
            {tiposServicio.map(ts => (
              <Button
                key={ts.TIPO_SERVICIO_ID}
                block
                size="large"
                icon={<BellOutlined />}
                onClick={() => { handlePrint('servicio', ts.TIPO_SERVICIO_ID, ts.NOMBRE); onClose(); }}
                style={{ textAlign: 'left', fontWeight: 600, height: 48 }}
              >
                Imprimir solo {ts.NOMBRE}
              </Button>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════
   TiposServicioComandaDrawer — CRUD for service types
   ═══════════════════════════════════════════════════ */

function TiposServicioComandaDrawer({ open, puntoVentaId, onClose }: {
  open: boolean;
  puntoVentaId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTipo, setSelectedTipo] = useState<TipoServicioComanda | null>(null);
  const [productSearchOpen, setProductSearchOpen] = useState(false);

  const { data: tipos = [], isLoading } = useQuery({
    queryKey: ['tipos-servicio-comanda', puntoVentaId],
    queryFn: () => mesasApi.getTiposServicioComanda(puntoVentaId),
    enabled: open && !!puntoVentaId,
  });

  const { data: productosAsignados = [], refetch: refetchProductos } = useQuery({
    queryKey: ['productos-tipo-servicio', selectedTipo?.TIPO_SERVICIO_ID, puntoVentaId],
    queryFn: () => mesasApi.getProductosByTipoServicio(selectedTipo!.TIPO_SERVICIO_ID, puntoVentaId),
    enabled: !!selectedTipo && !!puntoVentaId,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tipos-servicio-comanda'] });
  }, [queryClient]);

  const createMut = useMutation({
    mutationFn: () => form.validateFields().then(v =>
      mesasApi.createTipoServicioComanda({ NOMBRE: v.nombre, PUNTO_VENTA_ID: puntoVentaId })),
    onSuccess: () => { message.success('Tipo creado'); invalidate(); setModalOpen(false); form.resetFields(); },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error'),
  });

  const updateMut = useMutation({
    mutationFn: () => form.validateFields().then(v =>
      mesasApi.updateTipoServicioComanda(editingId!, { NOMBRE: v.nombre })),
    onSuccess: () => { message.success('Tipo actualizado'); invalidate(); setModalOpen(false); setEditingId(null); form.resetFields(); },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error'),
  });

  const deleteMut = useMutation({
    mutationFn: mesasApi.deleteTipoServicioComanda,
    onSuccess: () => {
      message.success('Tipo eliminado');
      invalidate();
      if (selectedTipo && tipos.find(t => t.TIPO_SERVICIO_ID === selectedTipo.TIPO_SERVICIO_ID) === undefined) {
        setSelectedTipo(null);
      }
    },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error'),
  });

  const asignarMut = useMutation({
    mutationFn: (productoId: number) =>
      mesasApi.asignarProductoTipoServicio(selectedTipo!.TIPO_SERVICIO_ID, productoId, puntoVentaId),
    onSuccess: () => { message.success('Producto asignado'); refetchProductos(); },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error'),
  });

  const desasignarMut = useMutation({
    mutationFn: (productoId: number) =>
      mesasApi.desasignarProductoTipoServicio(selectedTipo!.TIPO_SERVICIO_ID, productoId, puntoVentaId),
    onSuccess: () => { message.success('Producto desasignado'); refetchProductos(); },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error'),
  });

  const openCreate = () => { setEditingId(null); form.resetFields(); setModalOpen(true); };
  const openEdit = (tipo: TipoServicioComanda) => {
    setEditingId(tipo.TIPO_SERVICIO_ID);
    form.setFieldsValue({ nombre: tipo.NOMBRE });
    setModalOpen(true);
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title={<><SettingOutlined style={{ color: '#EABD23', marginRight: 8 }} />Tipos de Servicio Comanda</>}
        width={780}
        destroyOnHidden
      >
        <div style={{ display: 'flex', gap: 16, height: '100%' }}>
          {/* Left panel: list of tipos */}
          <div style={{ width: 260, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Button type="primary" icon={<PlusOutlined />} block onClick={openCreate} size="small">
              Nuevo Tipo
            </Button>
            {isLoading ? <Spin size="small" style={{ margin: '20px auto' }} /> :
              tipos.length === 0 ? <Empty description="Sin tipos de servicio" image={Empty.PRESENTED_IMAGE_SIMPLE} /> :
              tipos.map(tipo => (
                <div
                  key={tipo.TIPO_SERVICIO_ID}
                  onClick={() => { setSelectedTipo(tipo); }}
                  style={{
                    padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                    background: selectedTipo?.TIPO_SERVICIO_ID === tipo.TIPO_SERVICIO_ID ? 'rgba(234,189,35,0.12)' : '#fafafa',
                    border: selectedTipo?.TIPO_SERVICIO_ID === tipo.TIPO_SERVICIO_ID ? '1px solid rgba(234,189,35,0.5)' : '1px solid #f0f0f0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <Text style={{
                    fontWeight: selectedTipo?.TIPO_SERVICIO_ID === tipo.TIPO_SERVICIO_ID ? 600 : 400,
                    color: selectedTipo?.TIPO_SERVICIO_ID === tipo.TIPO_SERVICIO_ID ? '#b8960e' : '#333',
                    fontSize: 13,
                  }}>
                    <BellOutlined style={{ marginRight: 6 }} />{tipo.NOMBRE}
                  </Text>
                  <Space size={2}>
                    <Button type="text" size="small" icon={<EditOutlined style={{ fontSize: 11 }} />}
                      onClick={(e) => { e.stopPropagation(); openEdit(tipo); }}
                      style={{ color: '#aaa', width: 22, height: 22 }} />
                    <Popconfirm title="¿Eliminar tipo de servicio?" onConfirm={(e) => { e?.stopPropagation(); deleteMut.mutate(tipo.TIPO_SERVICIO_ID); }}
                      onCancel={(e) => e?.stopPropagation()} okText="Sí" cancelText="No">
                      <Button type="text" size="small" icon={<DeleteOutlined style={{ fontSize: 11 }} />}
                        onClick={(e) => e.stopPropagation()}
                        style={{ color: '#ff7875', width: 22, height: 22 }} />
                    </Popconfirm>
                  </Space>
                </div>
              ))
            }
          </div>

          {/* Right panel: products assigned to selected tipo */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!selectedTipo ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Empty description="Seleccione un tipo de servicio para ver y asignar productos" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            ) : (
              <>
                <div>
                  <Text strong style={{ fontSize: 14, color: '#b8960e' }}>
                    <BellOutlined style={{ marginRight: 6 }} />
                    Productos asignados a: {selectedTipo.NOMBRE}
                  </Text>
                </div>
                {/* Button to open advanced product search */}
                <Button icon={<SearchOutlined />} onClick={() => setProductSearchOpen(true)} block>
                  Buscar productos para asignar
                </Button>

                <Divider style={{ margin: '4px 0' }} />

                {/* Assigned products list */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {productosAsignados.length === 0 ? (
                    <Empty description="No hay productos asignados a este tipo" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 20 }} />
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid #EABD23' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#1E1F22' }}>Producto</th>
                          <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#1E1F22', width: 100 }}>Código</th>
                          <th style={{ width: 36 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {productosAsignados.map(prod => (
                          <tr key={prod.PRODUCTO_ID} style={{ borderBottom: '1px solid #f0f0f0' }}>
                            <td style={{ padding: '8px', fontSize: 13, fontWeight: 500 }}>{prod.PRODUCTO_NOMBRE}</td>
                            <td style={{ padding: '8px', fontSize: 12, color: '#888' }}>{prod.PRODUCTO_CODIGO}</td>
                            <td style={{ padding: '4px 0' }}>
                              <Popconfirm title="¿Desasignar producto?" onConfirm={() => desasignarMut.mutate(prod.PRODUCTO_ID)}
                                okText="Sí" cancelText="No">
                                <Button type="text" size="small" danger icon={<CloseOutlined style={{ fontSize: 10 }} />}
                                  style={{ width: 26, height: 26 }} />
                              </Popconfirm>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </Drawer>

      <Modal
        open={modalOpen}
        title={editingId ? 'Editar Tipo de Servicio' : 'Nuevo Tipo de Servicio'}
        onCancel={() => { setModalOpen(false); setEditingId(null); form.resetFields(); }}
        onOk={() => editingId ? updateMut.mutate() : createMut.mutate()}
        confirmLoading={createMut.isPending || updateMut.isPending}
        destroyOnHidden
        width={360}
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="nombre" label="Nombre" rules={[{ required: true, message: 'Ingrese el nombre' }]}>
            <Input placeholder="Ej: Cocina, Barra, Pastelería" maxLength={100} autoFocus />
          </Form.Item>
        </Form>
      </Modal>

      {selectedTipo && (
        <ProductSearchModal
          open={productSearchOpen}
          onClose={() => setProductSearchOpen(false)}
          onSelect={(products) => {
            products.forEach(p => asignarMut.mutate(p.PRODUCTO_ID));
          }}
          searchFn={mesasApi.searchProductosMesaAdvanced}
          multiSelect
        />
      )}
    </>
  );
}
