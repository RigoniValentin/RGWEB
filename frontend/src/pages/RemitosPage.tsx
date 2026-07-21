import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Space, Typography, Tag, Drawer, Descriptions, Spin, Alert, Button, Input, Dropdown, Popconfirm, Statistic, Card, Row, Col, Segmented, Switch } from 'antd';
import {
  EyeOutlined, SearchOutlined, ReloadOutlined,
  StopOutlined, FilePdfOutlined,
  ImportOutlined, ExportOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined,
  MobileOutlined, DesktopOutlined, FilterOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { remitosApi } from '../services/remitos.api';
import { settingsApi } from '../services/settings.api';
import { invalidateInventoryQueries } from '../utils/invalidateInventoryQueries';
import type { Remito, RemitoDetalle } from '../types';
import { DateFilterPopover, type DatePreset } from '../components/DateFilterPopover';
import { NewRemitoModal } from '../components/remitos/NewRemitoModal.js';
import { generateRemitoPdf, type CopiasTipo } from '../components/remitos/remitoPdf.js';
import { useTabStore } from '../store/tabStore';
import { useNavigationStore } from '../store/navigationStore';
import { fmtMoney, fmtNum, statFormatter } from '../utils/format';
import { RowContextMenu } from '../components/RowContextMenu';
import { useRowActions, type RowAction } from '../hooks/useRowActions';
import { notify } from '../utils/notify.ts';

const { Title, Text } = Typography;

export function RemitosPage() {
  const queryClient = useQueryClient();
  const [datePreset, setDatePreset] = useState<DatePreset>('mes');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(dayjs().format('YYYY-MM-DD'));
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [filterTipo, setFilterTipo] = useState<'todos' | 'ENTRADA' | 'SALIDA'>('todos');
  const [filterEstado, setFilterEstado] = useState<'todos' | 'activos' | 'pendientes' | 'anulados'>('activos');
  const [filterOrigen, setFilterOrigen] = useState<'todos' | 'WEB' | 'MOBILE'>('todos');
  const [sinCompraAsociada, setSinCompraAsociada] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newRemitoOpen, setNewRemitoOpen] = useState(false);
  const [newRemitoTipo, setNewRemitoTipo] = useState<'ENTRADA' | 'SALIDA'>('SALIDA');
  const navigate = useNavigate();
  const openTab = useTabStore(s => s.openTab);
  const navTo = useNavigationStore(s => s.navigate);
  const navEvent = useNavigationStore(s => s.event);
  const clearNavEvent = useNavigationStore(s => s.clearEvent);
  const lastNavTimestamp = useRef<number>(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // ── Debounced search ───────────────────────────
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer) clearTimeout(searchTimer);
    const timer = setTimeout(() => setSearchDebounced(value), 400);
    setSearchTimer(timer);
  };

  // ── List query ─────────────────────────────────
  const { data: remitosData, isLoading, refetch } = useQuery({
    queryKey: ['remitos', searchDebounced, fechaDesde, fechaHasta, filterTipo, filterEstado, filterOrigen, sinCompraAsociada, page, pageSize],
    queryFn: () => remitosApi.getAll({
      search: searchDebounced || undefined,
      fechaDesde, fechaHasta,
      tipo: filterTipo === 'todos' ? undefined : filterTipo,
      anulado: filterEstado === 'anulados' ? true : filterEstado === 'todos' ? undefined : false,
      estado: filterEstado === 'pendientes' ? 'PENDIENTE' : undefined,
      origen: filterOrigen === 'todos' ? undefined : filterOrigen,
      sinCompra: sinCompraAsociada || undefined,
      page, pageSize,
    }),
  });

  const remitos = remitosData?.data ?? [];
  const total = remitosData?.total ?? 0;

  // Refetch when tab becomes active
  const activeKey = useTabStore(s => s.activeKey);
  useEffect(() => {
    if (activeKey === '/remitos') refetch();
  }, [activeKey]);

  // Consume navigation events to auto-open detail drawer
  useEffect(() => {
    if (!navEvent || navEvent.target !== '/remitos' || !navEvent.payload?.remitoId) return;
    if (navEvent.timestamp === lastNavTimestamp.current) return;
    lastNavTimestamp.current = navEvent.timestamp;
    const targetId = navEvent.payload.remitoId as number;
    clearNavEvent();
    setSelectedId(targetId);
    setDrawerOpen(true);
  }, [navEvent, clearNavEvent]);

  // ── Detail query ───────────────────────────────
  const { data: detail, isLoading: detailLoading, error: detailError } = useQuery({
    queryKey: ['remito', selectedId],
    queryFn: () => remitosApi.getById(selectedId!),
    enabled: !!selectedId,
  });

  // ── Anular mutation ────────────────────────────
  const anularMutation = useMutation({
    mutationFn: (id: number) => remitosApi.anular(id),
    onSuccess: (data) => {
      invalidateInventoryQueries(queryClient);
      notify.success(`Remito #${data.REMITO_ID} anulado`);
      refetch();
      if (drawerOpen) { setDrawerOpen(false); setSelectedId(null); }
    },
    onError: (err: any) => {
      notify.error(err.response?.data?.error || 'Error al anular');
    },
  });

  // ── Confirmar remito pendiente (mobile) ────────
  const confirmarMutation = useMutation({
    mutationFn: (id: number) => remitosApi.confirmar(id),
    onSuccess: (data) => {
      invalidateInventoryQueries(queryClient);
      notify.success(`Remito #${data.REMITO_ID} confirmado y stock aplicado`);
      refetch();
      if (drawerOpen) { setDrawerOpen(false); setSelectedId(null); }
    },
    onError: (err: any) => {
      notify.error(err.response?.data?.error || 'Error al confirmar');
    },
  });

  // ── Rechazar remito pendiente (mobile) ──────────
  const rechazarMutation = useMutation({
    mutationFn: (id: number) => remitosApi.rechazar(id),
    onSuccess: (data) => {
      notify.success(`Remito #${data.REMITO_ID} rechazado`);
      refetch();
      if (drawerOpen) { setDrawerOpen(false); setSelectedId(null); }
    },
    onError: (err: any) => {
      notify.error(err.response?.data?.error || 'Error al rechazar');
    },
  });


  const openDetail = (record: Remito) => {
    setSelectedId(record.REMITO_ID);
    setDrawerOpen(true);
  };

  const openNewRemito = (tipo: 'ENTRADA' | 'SALIDA') => {
    setNewRemitoTipo(tipo);
    setNewRemitoOpen(true);
  };

  // ── PDF generation ─────────────────────────────
  const handleGeneratePdf = async (remitoDetail: RemitoDetalle, copias: CopiasTipo = 'original') => {
    try {
      const [empresa, logoDataUrl] = await Promise.all([
        remitosApi.getEmpresaData(),
        settingsApi.getLogoDataUrl(),
      ]);
      generateRemitoPdf(remitoDetail, empresa, copias, logoDataUrl);
    } catch {
      notify.error('Error al generar PDF');
    }
  };

  // ── KPI cards ──────────────────────────────────
  const totalEntradas = remitos.filter((r: Remito) => r.TIPO === 'ENTRADA' && !r.ANULADO).length;
  const totalSalidas = remitos.filter((r: Remito) => r.TIPO === 'SALIDA' && !r.ANULADO).length;
  const totalPendientes = remitos.filter((r: Remito) => r.ESTADO === 'PENDIENTE' && !r.ANULADO).length;
  const activeFiltersCount = [
    filterTipo !== 'todos',
    filterEstado !== 'activos',
    filterOrigen !== 'todos',
    sinCompraAsociada,
  ].filter(Boolean).length;

  // ── Context menu actions ─────────────────────────
  const contextMenuActions = useMemo<RowAction<Remito>[]>(() => [
    { key: 'view', label: 'Ver detalle', icon: <EyeOutlined />, onClick: openDetail },
    {
      key: 'pdf-original', label: 'PDF Original', icon: <FilePdfOutlined />,
      onClick: async (r) => {
        const d = await remitosApi.getById(r.REMITO_ID);
        handleGeneratePdf(d, 'original');
      },
    },
    {
      key: 'pdf-duplicado', label: 'PDF Original + Duplicado', icon: <FilePdfOutlined />,
      onClick: async (r) => {
        const d = await remitosApi.getById(r.REMITO_ID);
        handleGeneratePdf(d, 'original-duplicado');
      },
    },
    { type: 'divider' },
    {
      key: 'anular', label: 'Anular', icon: <StopOutlined />, danger: true,
      onClick: (r) => anularMutation.mutate(r.REMITO_ID),
      disabled: (r) => r.ANULADO,
    },
  ], []);

  const { onRow, rowClassName, contextMenu, contextMenuItems, closeContextMenu } = useRowActions<Remito>({
    getRowId: (r) => r.REMITO_ID,
    primaryAction: openDetail,
    actions: contextMenuActions,
  });

  // ── Table columns ─────────────────────────────
  const columns = [
    {
      title: '#', dataIndex: 'REMITO_ID', width: 35, align: 'center' as const,
      render: (v: number) => <Text strong>#{v}</Text>,
    },
    {
      title: 'Tipo', dataIndex: 'TIPO', width: 70, align: 'center' as const,
      render: (v: string) => (
        <Tag color={v === 'ENTRADA' ? 'green' : 'blue'} icon={v === 'ENTRADA' ? <ImportOutlined /> : <ExportOutlined />}>
          {v}
        </Tag>
      ),
    },
    {
      title: 'Comprobante', width: 140,
      render: (_: any, r: Remito) => `${r.PTO_VTA}-${r.NRO_REMITO}`,
    },
    {
      title: 'Fecha', dataIndex: 'FECHA', width: 110,
      render: (v: string) => dayjs(v).format('DD/MM/YYYY'),
    },
    {
      title: 'Destinatario / Origen', width: 200, ellipsis: true,
      render: (_: any, r: Remito) => r.CLIENTE_NOMBRE || r.PROVEEDOR_NOMBRE || '-',
    },
    {
      title: 'Depósito', dataIndex: 'DEPOSITO_NOMBRE', width: 120, ellipsis: true,
      render: (v: string) => v || '-',
    },
    {
      title: 'Estado', width: 110, align: 'center' as const,
      render: (_: any, r: Remito) => {
        if (r.ANULADO) return <Tag color="red" icon={<CloseCircleOutlined />}>Anulado</Tag>;
        if (r.ESTADO === 'PENDIENTE') return <Tag color="orange" icon={<ClockCircleOutlined />}>Pendiente</Tag>;
        return <Tag color="green" icon={<CheckCircleOutlined />}>Confirmado</Tag>;
      },
    },
    {
      title: 'Origen', width: 80, align: 'center' as const,
      render: (_: any, r: Remito) => r.ORIGEN === 'MOBILE'
        ? <Tag color="purple">Mobile</Tag>
        : r.ORIGEN === 'WEB'
          ? <Tag>Web</Tag>
          : <Text type="secondary">-</Text>,
    },
  ];

  return (
    <div className="page-enter">
      {/* ── Header ── */}
      <div className="page-header">
        <Title level={3}>Remitos</Title>
        <Space>
          <Button type="primary" icon={<ImportOutlined />} onClick={() => openNewRemito('ENTRADA')}>
            Remito de Entrada
          </Button>
          <Button type="primary" icon={<ExportOutlined />} onClick={() => openNewRemito('SALIDA')}>
            Remito de Salida
          </Button>
        </Space>
      </div>

      {/* ── KPI Cards ── */}
      <Row gutter={16} style={{ marginBottom: 12 }}>
        <Col xs={24} sm={8}>
          <Card
            size="small"
            className="rg-card"
            style={{ cursor: 'pointer', borderColor: filterTipo === 'ENTRADA' ? '#52c41a' : undefined }}
            onClick={() => setFilterTipo(v => { setPage(1); return v === 'ENTRADA' ? 'todos' : 'ENTRADA'; })}
          >
            <Statistic title="Entradas" value={totalEntradas} valueStyle={{ color: '#52c41a' }} formatter={statFormatter} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card
            size="small"
            className="rg-card"
            style={{ cursor: 'pointer', borderColor: filterTipo === 'SALIDA' ? '#1890ff' : undefined }}
            onClick={() => setFilterTipo(v => { setPage(1); return v === 'SALIDA' ? 'todos' : 'SALIDA'; })}
          >
            <Statistic title="Salidas" value={totalSalidas} valueStyle={{ color: '#1890ff' }} formatter={statFormatter} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card
            size="small"
            className="rg-card"
            style={{ cursor: 'pointer', borderColor: filterEstado === 'pendientes' ? '#faad14' : totalPendientes > 0 ? '#faad14' : undefined }}
            onClick={() => setFilterEstado(v => { setPage(1); return v === 'pendientes' ? 'activos' : 'pendientes'; })}
          >
            <Statistic
              title={
                <span>
                  <ClockCircleOutlined style={{ color: '#faad14', marginRight: 6 }} />
                  Pendientes (mobile)
                </span>
              }
              value={totalPendientes}
              valueStyle={{ color: totalPendientes > 0 ? '#faad14' : '#999', fontWeight: 700 }}
              formatter={statFormatter}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Filters ── */}
      <Card
        size="small"
        className="rg-card-flat"
        style={{ marginBottom: 14 }}
        styles={{ body: { padding: '14px 16px', background: '#FAFAFA' } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <FilterOutlined style={{ color: 'var(--rg-gold)', fontSize: 16 }} />
            <Text strong style={{ fontSize: 14, color: 'var(--rg-text)' }}>Filtros</Text>
            {activeFiltersCount > 0 && (
              <Tag color="gold" style={{ margin: 0, fontSize: 11, fontWeight: 600 }}>{activeFiltersCount} activo{activeFiltersCount > 1 ? 's' : ''}</Tag>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Input
              placeholder="Buscar por nro, cliente, proveedor..."
              prefix={<SearchOutlined />}
              value={search}
              onChange={e => handleSearchChange(e.target.value)}
              allowClear
              style={{ width: 280 }}
            />
            <DateFilterPopover
              preset={datePreset}
              fechaDesde={fechaDesde}
              fechaHasta={fechaHasta}
              onPresetChange={(p, d, h) => { setDatePreset(p); setFechaDesde(d); setFechaHasta(h); }}
              onRangeChange={(d, h) => { setDatePreset(undefined as any); setFechaDesde(d); setFechaHasta(h); }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 28px', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong style={{ fontSize: 13, color: 'var(--rg-text-light)', whiteSpace: 'nowrap' }}>Tipo:</Text>
            <Segmented
              className="rg-segmented-light"
              value={filterTipo}
              onChange={v => { setFilterTipo(v as any); setPage(1); }}
              options={[
                { label: 'Todos', value: 'todos' },
                { label: <span><ImportOutlined /> Entradas</span>, value: 'ENTRADA' },
                { label: <span><ExportOutlined /> Salidas</span>, value: 'SALIDA' },
              ]}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong style={{ fontSize: 13, color: 'var(--rg-text-light)', whiteSpace: 'nowrap' }}>Estado:</Text>
            <Segmented
              className="rg-segmented-light"
              value={filterEstado}
              onChange={v => { setFilterEstado(v as any); setPage(1); }}
              options={[
                { label: 'Todos', value: 'todos' },
                { label: <span><CheckCircleOutlined /> Activos</span>, value: 'activos' },
                { label: <span><ClockCircleOutlined /> Pendientes</span>, value: 'pendientes' },
                { label: <span><CloseCircleOutlined /> Anulados</span>, value: 'anulados' },
              ]}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong style={{ fontSize: 13, color: 'var(--rg-text-light)', whiteSpace: 'nowrap' }}>Origen:</Text>
            <Segmented
              className="rg-segmented-light"
              value={filterOrigen}
              onChange={v => { setFilterOrigen(v as any); setPage(1); }}
              options={[
                { label: 'Todos', value: 'todos' },
                { label: <span><DesktopOutlined /> Web</span>, value: 'WEB' },
                { label: <span><MobileOutlined /> Mobile</span>, value: 'MOBILE' },
              ]}
            />
          </div>

          {filterTipo === 'ENTRADA' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Switch
                checked={sinCompraAsociada}
                onChange={v => { setSinCompraAsociada(v); setPage(1); }}
              />
              <Text strong style={{ fontSize: 13, color: 'var(--rg-text-light)' }}>Sin compra asociada</Text>
            </div>
          )}
        </div>
      </Card>

      {/* ── Table ── */}
      <Table
        className="rg-table"
        dataSource={remitos}
        columns={columns}
        rowKey="REMITO_ID"
        loading={isLoading}
        size="small"
        scroll={{ x: 1000 }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          showTotal: (t) => `${t} remitos`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        onRow={onRow}
        rowClassName={(r) => `${rowClassName(r)} ${r.ANULADO ? 'rg-row-anulada' : ''}`}
      />

      <RowContextMenu
        open={contextMenu !== null}
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />

      {/* ── Detail Drawer ── */}
      <Drawer
        title={detail ? `Remito ${detail.TIPO} #${detail.PTO_VTA}-${detail.NRO_REMITO}` : 'Detalle de Remito'}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={850}
        extra={
          detail && !detail.ANULADO && (
            <Space>
              {detail.ESTADO === 'PENDIENTE' && detail.ORIGEN === 'MOBILE' ? (
                <>
                  <Popconfirm
                    title="¿Confirmar este remito?"
                    description="Se aplicará el movimiento de stock correspondiente."
                    okText="Confirmar"
                    cancelText="Cancelar"
                    onConfirm={() => confirmarMutation.mutate(detail.REMITO_ID)}
                  >
                    <Button
                      type="primary"
                      icon={<CheckCircleOutlined />}
                      loading={confirmarMutation.isPending}
                      style={{ background: '#52c41a', borderColor: '#52c41a' }}
                    >
                      Confirmar
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="¿Rechazar este remito?"
                    description="Quedará como anulado sin tocar el stock."
                    okText="Rechazar"
                    okButtonProps={{ danger: true }}
                    cancelText="Cancelar"
                    onConfirm={() => rechazarMutation.mutate(detail.REMITO_ID)}
                  >
                    <Button danger icon={<CloseCircleOutlined />} loading={rechazarMutation.isPending}>
                      Rechazar
                    </Button>
                  </Popconfirm>
                </>
              ) : (
                <>
                  <Dropdown menu={{
                    items: [
                      { key: 'original', label: 'Original', onClick: () => handleGeneratePdf(detail, 'original') },
                      { key: 'original-duplicado', label: 'Original + Duplicado', onClick: () => handleGeneratePdf(detail, 'original-duplicado') },
                    ],
                  }}>
                    <Button icon={<FilePdfOutlined />}>PDF</Button>
                  </Dropdown>
                  <Popconfirm title="¿Anular este remito?" onConfirm={() => anularMutation.mutate(detail.REMITO_ID)}>
                    <Button danger icon={<StopOutlined />}>Anular</Button>
                  </Popconfirm>
                </>
              )}
            </Space>
          )
        }
      >
        {detailLoading && <Spin />}
        {detailError && <Alert type="error" message="Error al cargar detalle" />}
        {detail && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Tipo">
                <Tag color={detail.TIPO === 'ENTRADA' ? 'green' : 'blue'}>{detail.TIPO}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Comprobante">{detail.PTO_VTA}-{detail.NRO_REMITO}</Descriptions.Item>
              <Descriptions.Item label="Fecha">{dayjs(detail.FECHA).format('DD/MM/YYYY')}</Descriptions.Item>
              <Descriptions.Item label="Estado">
                {detail.ANULADO
                  ? <Tag color="red" icon={<CloseCircleOutlined />}>Anulado</Tag>
                  : detail.ESTADO === 'PENDIENTE'
                    ? <Tag color="orange" icon={<ClockCircleOutlined />}>Pendiente</Tag>
                    : <Tag color="green" icon={<CheckCircleOutlined />}>Confirmado</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="Origen">
                {detail.ORIGEN === 'MOBILE'
                  ? <Tag color="purple">App Mobile</Tag>
                  : detail.ORIGEN === 'WEB'
                    ? <Tag>Web</Tag>
                    : <Text type="secondary">-</Text>}
              </Descriptions.Item>
              {detail.CLIENTE_NOMBRE && (
                <Descriptions.Item label="Cliente" span={2}>{detail.CLIENTE_NOMBRE}</Descriptions.Item>
              )}
              {detail.PROVEEDOR_NOMBRE && (
                <Descriptions.Item label="Proveedor" span={2}>{detail.PROVEEDOR_NOMBRE}</Descriptions.Item>
              )}
              {detail.DEPOSITO_NOMBRE && (
                <Descriptions.Item label="Depósito" span={2}>{detail.DEPOSITO_NOMBRE}</Descriptions.Item>
              )}
              {detail.OBSERVACIONES && (
                <Descriptions.Item label="Observaciones" span={2}>{detail.OBSERVACIONES}</Descriptions.Item>
              )}
              {detail.VENTA_ID && (
                <Descriptions.Item label="Factura asociada" span={2}>
                  <Tag
                    color="gold"
                    style={{ fontSize: 13, cursor: 'pointer' }}
                    onClick={() => {
                      setDrawerOpen(false);
                      setSelectedId(null);
                      openTab({ key: '/sales', label: 'Ventas', closable: true });
                      navTo('/sales', { ventaId: detail.VENTA_ID });
                      navigate('/sales');
                    }}
                  >
                    {detail.VENTA_TIPO_COMPROBANTE || 'Venta'} #{detail.VENTA_ID}
                    {detail.VENTA_NUMERO_FISCAL ? ` — Nro. Fiscal: ${detail.VENTA_NUMERO_FISCAL}` : ''}
                  </Tag>
                  {detail.VENTA_FECHA && (
                    <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                      {dayjs(detail.VENTA_FECHA).format('DD/MM/YYYY')}
                    </Text>
                  )}
                  {detail.VENTA_TOTAL != null && (
                    <Text strong style={{ marginLeft: 8 }}>
                      {fmtMoney(detail.VENTA_TOTAL)}
                    </Text>
                  )}
                </Descriptions.Item>
              )}
              {detail.COMPRA_ID && (
                <Descriptions.Item label="Compra asociada" span={2}>
                  <Tag
                    color="gold"
                    style={{ fontSize: 13, cursor: 'pointer' }}
                    onClick={() => {
                      setDrawerOpen(false);
                      setSelectedId(null);
                      openTab({ key: '/purchases', label: 'Compras', closable: true });
                      navTo('/purchases', { compraId: detail.COMPRA_ID });
                      navigate('/purchases');
                    }}
                  >
                    {detail.COMPRA_TIPO_COMPROBANTE || 'Compra'} #{detail.COMPRA_ID}
                    {detail.COMPRA_NRO_COMPROBANTE
                      ? ` — ${detail.COMPRA_PTO_VTA || '0000'}-${detail.COMPRA_NRO_COMPROBANTE}`
                      : ''}
                  </Tag>
                  {detail.COMPRA_FECHA && (
                    <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                      {dayjs(detail.COMPRA_FECHA).format('DD/MM/YYYY')}
                    </Text>
                  )}
                  {detail.COMPRA_TOTAL != null && (
                    <Text strong style={{ marginLeft: 8 }}>
                      {fmtMoney(detail.COMPRA_TOTAL)}
                    </Text>
                  )}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Title level={5}>Ítems</Title>
            <Table
              dataSource={detail.items}
              rowKey="ITEM_ID"
              size="small"
              pagination={false}
              columns={[
                { title: 'Código', dataIndex: 'PRODUCTO_CODIGO', width: 100, align: 'center'},
                { title: 'Producto', dataIndex: 'PRODUCTO_NOMBRE', ellipsis: true },
                { title: 'Cantidad', dataIndex: 'CANTIDAD', width: 120, align: 'center',
                  render: (v: number, r: any) => `${fmtNum(v)} ${r.UNIDAD_ABREVIACION || 'u'}` },
              ]}
            />
          </>
        )}
      </Drawer>

      {/* ── New Remito Modal ── */}
      <NewRemitoModal
        open={newRemitoOpen}
        tipo={newRemitoTipo}
        onClose={() => setNewRemitoOpen(false)}
        onSuccess={() => { setNewRemitoOpen(false); refetch(); }}
      />
    </div>
  );
}
