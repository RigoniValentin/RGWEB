import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Drawer, Descriptions, Spin, Alert,
  Button, Input, Dropdown, Popconfirm, message, Select, Statistic, Card, Row, Col,
} from 'antd';
import {
  EyeOutlined, PlusOutlined, StopOutlined,
  SearchOutlined, MoreOutlined, ReloadOutlined,
  FileExclamationOutlined, UndoOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { ncComprasApi, type NCCompra } from '../services/ncCompras.api';
import { DateFilterPopover, type DatePreset } from '../components/DateFilterPopover';
import { NewNCCompraModal } from '../components/purchases/NewNCCompraModal.js';
import { useTabStore } from '../store/tabStore';
import { fmtMoney, fmtNum, statFormatter } from '../utils/format';

const { Title, Text } = Typography;

const MOTIVO_COLORS: Record<string, string> = {
  'POR DEVOLUCION': 'orange',
  'POR ANULACION': 'red',
  'POR DESCUENTO': 'cyan',
  'POR DIFERENCIA PRECIO': 'purple',
};

const MOTIVO_LABELS: Record<string, string> = {
  'POR DEVOLUCION': 'Devolución',
  'POR ANULACION': 'Anulación',
  'POR DESCUENTO': 'Descuento',
  'POR DIFERENCIA PRECIO': 'Dif. Precio',
};

export function NCComprasPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>('mes');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(dayjs().format('YYYY-MM-DD'));
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [filterMotivo, setFilterMotivo] = useState<string | undefined>();
  const [showAnuladas, setShowAnuladas] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newNCOpen, setNewNCOpen] = useState(false);

  // ── Debounced search ───────────────────────────
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer) clearTimeout(searchTimer);
    const timer = setTimeout(() => setSearchDebounced(value), 400);
    setSearchTimer(timer);
  };

  // ── List query ─────────────────────────────────
  const { data: notas, isLoading, refetch } = useQuery({
    queryKey: ['nc-compras', searchDebounced, fechaDesde, fechaHasta, filterMotivo, showAnuladas],
    queryFn: () => ncComprasApi.getAll({
      search: searchDebounced || undefined,
      fechaDesde, fechaHasta,
      motivo: filterMotivo,
      anulada: showAnuladas ? undefined : false,
    }),
  });

  // Refetch when tab becomes active
  const activeKey = useTabStore(s => s.activeKey);
  useEffect(() => {
    if (activeKey === '/nc-compras') refetch();
  }, [activeKey]);

  // ── Detail query ───────────────────────────────
  const { data: detail, isLoading: detailLoading, error: detailError } = useQuery({
    queryKey: ['nc-compra', selectedId],
    queryFn: () => ncComprasApi.getById(selectedId!),
    enabled: !!selectedId,
  });

  // ── Anular mutation ────────────────────────────
  const anularMutation = useMutation({
    mutationFn: (id: number) => ncComprasApi.anular(id),
    onSuccess: (data) => {
      message.success(`NC #${data.NC_ID} anulada — ND #${data.ND_ID} generada`);
      refetch();
      if (drawerOpen) { setDrawerOpen(false); setSelectedId(null); }
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al anular');
    },
  });

  const openDetail = (record: NCCompra) => {
    setSelectedId(record.NC_ID);
    setDrawerOpen(true);
  };

  // ── KPI cards ──────────────────────────────────
  const totalMonto = notas?.reduce((s, n) => s + (n.ANULADA ? 0 : n.MONTO), 0) ?? 0;
  const totalActivas = notas?.filter(n => !n.ANULADA).length ?? 0;
  const totalAnuladas = notas?.filter(n => n.ANULADA).length ?? 0;

  // ── Action menu ────────────────────────────────
  const getRowActions = (record: NCCompra) => {
    const items: any[] = [
      { key: 'detail', label: 'Ver detalle', icon: <EyeOutlined />, onClick: () => openDetail(record) },
    ];
    if (!record.ANULADA) {
      items.push(
        { type: 'divider' as const },
        { key: 'anular', label: 'Anular NC', icon: <StopOutlined />, danger: true },
      );
    }
    return items;
  };

  // ── Columns ────────────────────────────────────
  const columns = [
    { title: 'NC #', dataIndex: 'NC_ID', key: 'id', width: 80, align: 'center' as const },
    {
      title: 'Fecha', dataIndex: 'FECHA', key: 'date', width: 160, align: 'center' as const,
      render: (v: string) => new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
    },
    { title: 'Proveedor', dataIndex: 'PROVEEDOR_NOMBRE', key: 'provider', ellipsis: true },
    { title: 'Compra #', dataIndex: 'COMPRA_ID', key: 'compraId', width: 110, align: 'center' as const },
    {
      title: 'Motivo', dataIndex: 'MOTIVO', key: 'motivo', width: 130, align: 'center' as const,
      render: (v: string) => <Tag color={MOTIVO_COLORS[v] || 'default'}>{MOTIVO_LABELS[v] || v}</Tag>,
    },
    {
      title: 'M. Pago', dataIndex: 'MEDIO_PAGO', key: 'medioPago', width: 90, align: 'center' as const,
      render: (v: string) => <Tag color={v === 'CC' ? 'blue' : 'green'}>{v === 'CC' ? 'Cta. Cte.' : 'Contado'}</Tag>,
    },
    {
      title: 'Monto', dataIndex: 'MONTO', key: 'monto', width: 130, align: 'right' as const,
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
    },
    {
      title: 'Estado', key: 'estado', width: 100, align: 'center' as const,
      render: (_: unknown, record: NCCompra) => (
        <Tag color={record.ANULADA ? 'red' : 'green'}>{record.ANULADA ? 'Anulada' : 'Activa'}</Tag>
      ),
    },
    {
      title: '', key: 'actions', width: 80, fixed: 'right' as const,
      render: (_: unknown, record: NCCompra) => (
        <Space size={4}>
          <EyeOutlined
            style={{ cursor: 'pointer', color: '#EABD23', fontSize: 16 }}
            onClick={() => openDetail(record)}
          />
          <Dropdown
            menu={{
              items: getRowActions(record),
              onClick: ({ key }) => {
                if (key === 'anular') {
                  // Will use popconfirm in drawer instead
                  openDetail(record);
                }
              },
            }}
            trigger={['click']}
            placement="bottomRight"
          >
            <MoreOutlined style={{ cursor: 'pointer', fontSize: 16, padding: 4 }} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-enter">
      {/* ── Header ─────────────────────────────── */}
      <div className="page-header">
        <Title level={3}>
          <FileExclamationOutlined style={{ marginRight: 8 }} />
          Notas de Crédito — Compras
        </Title>
        <Space wrap>
          <Input
            placeholder="Buscar proveedor..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <DateFilterPopover
            preset={datePreset}
            fechaDesde={fechaDesde}
            fechaHasta={fechaHasta}
            onPresetChange={(p, d, h) => { setDatePreset(p); setFechaDesde(d); setFechaHasta(h); }}
            onRangeChange={(d, h) => { setDatePreset(undefined as any); setFechaDesde(d); setFechaHasta(h); }}
          />
          <Select
            placeholder="Motivo"
            allowClear
            value={filterMotivo}
            onChange={setFilterMotivo}
            style={{ width: 160 }}
            options={[
              { value: 'POR DEVOLUCION', label: 'Devolución' },
              { value: 'POR ANULACION', label: 'Anulación' },
              { value: 'POR DESCUENTO', label: 'Descuento' },
              { value: 'POR DIFERENCIA PRECIO', label: 'Dif. Precio' },
            ]}
          />
          <Button
            type={showAnuladas ? 'primary' : 'default'}
            danger={showAnuladas}
            size="small"
            onClick={() => setShowAnuladas(!showAnuladas)}
          >
            {showAnuladas ? 'Incluye anuladas' : 'Solo activas'}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          <Button
            type="primary"
            className="btn-gold"
            icon={<PlusOutlined />}
            onClick={() => setNewNCOpen(true)}
          >
            Nueva NC
          </Button>
        </Space>
      </div>

      {/* ── KPI cards ──────────────────────────── */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8}>
          <Card size="small" className="rg-card">
            <Statistic
              title="NC Activas"
              value={totalActivas}
              prefix={<FileExclamationOutlined />}
              valueStyle={{ color: '#EABD23', fontSize: 16 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Monto Total"
              value={totalMonto}
              formatter={statFormatter}
              prefix="$"
              valueStyle={{ color: '#EABD23', fontSize: 16 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Anuladas"
              value={totalAnuladas}
              prefix={<StopOutlined />}
              valueStyle={{ color: totalAnuladas > 0 ? '#ff4d4f' : '#8c8c8c', fontSize: 16 }}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Table ──────────────────────────────── */}
      <Table
        className="rg-table"
        columns={columns}
        dataSource={notas}
        rowKey="NC_ID"
        loading={isLoading}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `Total: ${total} notas`,
        }}
        size="small"
        scroll={{ x: 900 }}
        onRow={(record) => ({
          onDoubleClick: () => openDetail(record),
          style: record.ANULADA ? { opacity: 0.5 } : undefined,
        })}
      />

      {/* ── Detail Drawer ─────────────────────── */}
      <Drawer
        title={`Nota de Crédito #${selectedId}`}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={900}
        className="rg-drawer"
        extra={
          detail && !detail.ANULADA && (
            <Popconfirm
              title="¿Anular esta NC?"
              description="Se generará una ND y se revertirán los movimientos."
              onConfirm={() => anularMutation.mutate(detail.NC_ID)}
              okText="Sí, anular"
              cancelText="Cancelar"
              okButtonProps={{ danger: true }}
            >
              <Button type="text" danger size="small" icon={<StopOutlined />} loading={anularMutation.isPending}>
                Anular NC
              </Button>
            </Popconfirm>
          )
        }
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : detailError ? (
          <Alert type="error" message="Error al cargar detalle" description={(detailError as any)?.response?.data?.error || (detailError as Error).message} />
        ) : detail && (
          <>
            {detail.ANULADA && (
              <Alert
                type="error"
                message="NC Anulada"
                description="Esta nota de crédito fue anulada. Se generó una Nota de Débito asociada y se revirtieron todos los movimientos."
                style={{ marginBottom: 16 }}
                showIcon
              />
            )}

            <Descriptions column={2} bordered size="middle" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Fecha">
                {new Date(detail.FECHA).toLocaleDateString('es-AR')}
              </Descriptions.Item>
              <Descriptions.Item label="Proveedor">
                {detail.PROVEEDOR_NOMBRE}
              </Descriptions.Item>
              <Descriptions.Item label="Compra asociada">
                #{detail.COMPRA_ID}
              </Descriptions.Item>
              <Descriptions.Item label="Motivo">
                <Tag color={MOTIVO_COLORS[detail.MOTIVO] || 'default'}>
                  {MOTIVO_LABELS[detail.MOTIVO] || detail.MOTIVO}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Medio de pago">
                <Tag color={detail.MEDIO_PAGO === 'CC' ? 'blue' : 'green'}>
                  {detail.MEDIO_PAGO === 'CC' ? 'Cta. Corriente' : 'Contado'}
                </Tag>
              </Descriptions.Item>
              {detail.MEDIO_PAGO === 'CN' && detail.DESTINO_PAGO && (
                <Descriptions.Item label="Destino">
                  {detail.DESTINO_PAGO === 'CAJA' ? 'Caja Usuario' : 'Caja Central'}
                </Descriptions.Item>
              )}
              {detail.DESCRIPCION && (
                <Descriptions.Item label="Descripción" span={2}>
                  {detail.DESCRIPCION}
                </Descriptions.Item>
              )}
              {(detail.DESCUENTO ?? 0) > 0 && (
                <Descriptions.Item label="Descuento %">
                  {fmtNum(detail.DESCUENTO)}%
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Monto" span={2}>
                <span style={{ fontSize: 20, fontWeight: 'bold', color: '#EABD23' }}>
                  {fmtMoney(detail.MONTO)}
                </span>
              </Descriptions.Item>
            </Descriptions>

            {detail.items && detail.items.length > 0 && (
              <div className="rg-sale-items">
                <Title level={5} style={{ marginBottom: 12, fontWeight: 700 }}>
                  <UndoOutlined style={{ marginRight: 6 }} /> Ítems devueltos
                </Title>
                <Table
                  dataSource={detail.items}
                  rowKey="NC_ITEM_ID"
                  size="middle"
                  pagination={false}
                  columns={[
                    { title: 'Código', dataIndex: 'PRODUCTO_CODIGO', width: 90, align: 'center' as const },
                    { title: 'Producto', dataIndex: 'PRODUCTO_NOMBRE', ellipsis: true },
                    {
                      title: 'Cant. Devuelta', dataIndex: 'CANTIDAD_DEVUELTA', width: 120, align: 'center' as const,
                      render: (v: number) => <Text strong style={{ color: '#ff4d4f' }}>{v % 1 === 0 ? v : fmtNum(v)}</Text>,
                    },
                    {
                      title: 'P. Compra', dataIndex: 'PRECIO_COMPRA', width: 120, align: 'center' as const,
                      render: (v: number) => fmtMoney(v),
                    },
                    {
                      title: 'Subtotal', key: 'sub', width: 120, align: 'center' as const,
                      render: (_: unknown, r: any) => <Text strong>{fmtMoney(r.CANTIDAD_DEVUELTA * r.PRECIO_COMPRA)}</Text>,
                    },
                  ]}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={4}>
                        <Text strong style={{ marginLeft: 13 }}>Total</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="center">
                        <Text strong style={{ color: '#EABD23' }}>
                          {fmtMoney(detail.items.reduce((s, i) => s + i.CANTIDAD_DEVUELTA * i.PRECIO_COMPRA, 0))}
                        </Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* ── New NC Modal ──────────────────────── */}
      <NewNCCompraModal
        open={newNCOpen}
        onClose={() => setNewNCOpen(false)}
        onSuccess={() => { setNewNCOpen(false); refetch(); }}
      />
    </div>
  );
}
