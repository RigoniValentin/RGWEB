import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Drawer, Descriptions, Spin, Alert,
  Button, Input, Dropdown, Popconfirm, message, Select, Statistic, Card, Row, Col,
} from 'antd';
import {
  EyeOutlined, SearchOutlined, MoreOutlined, ReloadOutlined,
  StopOutlined, FilePdfOutlined,
  ImportOutlined, ExportOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { remitosApi } from '../services/remitos.api';
import { settingsApi } from '../services/settings.api';
import type { Remito, RemitoDetalle } from '../types';
import { DateFilterPopover, type DatePreset } from '../components/DateFilterPopover';
import { NewRemitoModal } from '../components/remitos/NewRemitoModal.js';
import { generateRemitoPdf, type CopiasTipo } from '../components/remitos/remitoPdf.js';
import { useTabStore } from '../store/tabStore';
import { useNavigationStore } from '../store/navigationStore';
import { fmtMoney, fmtNum, statFormatter } from '../utils/format';

const { Title, Text } = Typography;

export function RemitosPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>('mes');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(dayjs().format('YYYY-MM-DD'));
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [filterTipo, setFilterTipo] = useState<'ENTRADA' | 'SALIDA' | undefined>();
  const [showAnulados, setShowAnulados] = useState(false);
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
    queryKey: ['remitos', searchDebounced, fechaDesde, fechaHasta, filterTipo, showAnulados, page, pageSize],
    queryFn: () => remitosApi.getAll({
      search: searchDebounced || undefined,
      fechaDesde, fechaHasta,
      tipo: filterTipo,
      anulado: showAnulados ? undefined : false,
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
      message.success(`Remito #${data.REMITO_ID} anulado`);
      refetch();
      if (drawerOpen) { setDrawerOpen(false); setSelectedId(null); }
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al anular');
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
      message.error('Error al generar PDF');
    }
  };

  // ── KPI cards ──────────────────────────────────
  const totalMonto = remitos.reduce((s: number, r: Remito) => s + (r.ANULADO ? 0 : r.TOTAL), 0);
  const totalEntradas = remitos.filter((r: Remito) => r.TIPO === 'ENTRADA' && !r.ANULADO).length;
  const totalSalidas = remitos.filter((r: Remito) => r.TIPO === 'SALIDA' && !r.ANULADO).length;

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
      title: 'Total', dataIndex: 'TOTAL', width: 120, align: 'right' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Estado', width: 56, align: 'center' as const,
      render: (_: any, r: Remito) => r.ANULADO
        ? <Tag color="red">Anulado</Tag>
        : <Tag color="green">Activo</Tag>,
    },
    {
      title: '', width: 25, align: 'center' as const,
      render: (_: any, record: Remito) => (
        <Dropdown menu={{
          items: [
            { key: 'ver', icon: <EyeOutlined />, label: 'Ver detalle', onClick: () => openDetail(record) },
            { key: 'pdf-original', icon: <FilePdfOutlined />, label: 'PDF Original', onClick: async () => {
              const d = await remitosApi.getById(record.REMITO_ID);
              handleGeneratePdf(d, 'original');
            }},
            { key: 'pdf-duplicado', icon: <FilePdfOutlined />, label: 'PDF Original + Duplicado', onClick: async () => {
              const d = await remitosApi.getById(record.REMITO_ID);
              handleGeneratePdf(d, 'original-duplicado');
            }},
            ...(record.ANULADO ? [] : [
              { type: 'divider' as const },
              { key: 'anular', icon: <StopOutlined />, label: 'Anular', danger: true,
                onClick: () => anularMutation.mutate(record.REMITO_ID) },
            ]),
          ],
        }} trigger={['click']}>
          <Button type="text" size="small" icon={<MoreOutlined />} />
        </Dropdown>
      ),
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
          <Card size="small" className="rg-card">
            <Statistic title="Entradas" value={totalEntradas} valueStyle={{ color: '#52c41a' }} formatter={statFormatter} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="rg-card">
            <Statistic title="Salidas" value={totalSalidas} valueStyle={{ color: '#1890ff' }} formatter={statFormatter} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="rg-card">
            <Statistic title="Total Valorizado" value={totalMonto} prefix="$" valueStyle={{ color: '#722ed1' }} formatter={statFormatter} />
          </Card>
        </Col>
      </Row>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
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
        <Select
          placeholder="Tipo"
          allowClear
          value={filterTipo}
          onChange={v => setFilterTipo(v)}
          style={{ width: 140 }}
          options={[
            { value: 'ENTRADA', label: 'Entrada' },
            { value: 'SALIDA', label: 'Salida' },
          ]}
        />
        <Button
          type={showAnulados ? 'primary' : 'default'}
          onClick={() => setShowAnulados(!showAnulados)}
          icon={<StopOutlined />}
        >
          {showAnulados ? 'Todos' : 'Solo activos'}
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
      </div>

      {/* ── Table ── */}
      <Table
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
        onRow={(record) => ({
          onDoubleClick: () => openDetail(record),
          style: record.ANULADO ? { opacity: 0.5 } : undefined,
        })}
      />

      {/* ── Detail Drawer ── */}
      <Drawer
        title={detail ? `Remito ${detail.TIPO} #${detail.PTO_VTA}-${detail.NRO_REMITO}` : 'Detalle de Remito'}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={850}
        extra={detail && !detail.ANULADO && (
          <Space>
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
          </Space>
        )}
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
                {detail.ANULADO ? <Tag color="red">Anulado</Tag> : <Tag color="green">Activo</Tag>}
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
            </Descriptions>

            <Title level={5}>Ítems</Title>
            <Table
              dataSource={detail.items}
              rowKey="ITEM_ID"
              size="small"
              pagination={false}
              columns={[
                { title: 'Código', dataIndex: 'PRODUCTO_CODIGO', width: 80, align: 'center'},
                { title: 'Producto', dataIndex: 'PRODUCTO_NOMBRE', ellipsis: true },
                { title: 'Cantidad', dataIndex: 'CANTIDAD', width: 90, align: 'center',
                  render: (v: number, r: any) => `${fmtNum(v)} ${r.UNIDAD_ABREVIACION || 'u'}` },
                { title: 'P. Unitario', dataIndex: 'PRECIO_UNITARIO', width: 130, align: 'right',
                  render: (v: number) => fmtMoney(v) },
                { title: 'Total', dataIndex: 'TOTAL_PRODUCTO', width: 130, align: 'right',
                  render: (v: number) => fmtMoney(v) },
              ]}
              summary={() => (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={4} align="right"><Text strong>Total:</Text></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right"><Text strong>{fmtMoney(detail.TOTAL)}</Text></Table.Summary.Cell>
                </Table.Summary.Row>
              )}
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
