import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Drawer, Descriptions, Spin, Alert,
  Button, Input, Dropdown, Popconfirm, message, Select, Statistic, Card, Row, Col,
  Tooltip, Modal,
} from 'antd';
import {
  EyeOutlined, PlusOutlined, StopOutlined,
  SearchOutlined, MoreOutlined, ReloadOutlined,
  FileExclamationOutlined, UndoOutlined, ThunderboltOutlined,
  BankOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { ncVentasApi, type NCVenta } from '../services/ncVentas.api';
import { salesApi } from '../services/sales.api';
import { DateFilterPopover, type DatePreset } from '../components/DateFilterPopover';
import { NewNCVentaModal } from '../components/sales/NewNCVentaModal.js';
import { useTabStore } from '../store/tabStore';
import { useNavigationStore } from '../store/navigationStore';
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

export function NCVentasPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { openTab } = useTabStore();
  const navTo = useNavigationStore(s => s.navigate);
  const navEvent = useNavigationStore(s => s.event);
  const clearNavEvent = useNavigationStore(s => s.clearEvent);
  const lastNavTimestamp = useRef<number>(0);
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
  const [desgloseModalOpen, setDesgloseModalOpen] = useState(false);

  // ── FE config ──────────────────────────────────
  const { data: feConfig } = useQuery({
    queryKey: ['sales-fe-config'],
    queryFn: () => salesApi.getFEConfig(),
    staleTime: 300000,
  });
  const utilizaFE = feConfig?.utilizaFE === true;

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
    queryKey: ['nc-ventas', searchDebounced, fechaDesde, fechaHasta, filterMotivo, showAnuladas],
    queryFn: () => ncVentasApi.getAll({
      search: searchDebounced || undefined,
      fechaDesde, fechaHasta,
      motivo: filterMotivo,
      anulada: showAnuladas ? undefined : false,
    }),
  });

  // Refetch when tab becomes active
  const activeKey = useTabStore(s => s.activeKey);
  useEffect(() => {
    if (activeKey === '/nc-ventas') refetch();
  }, [activeKey]);

  // ── Open NC from navigation state (cross-nav from CajaCentral) ──
  useEffect(() => {
    const st = location.state as { openNCId?: number } | null;
    if (st?.openNCId) {
      setSelectedId(st.openNCId);
      setDrawerOpen(true);
      // Clear state to avoid re-opening on re-render
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  // ── Consume navigation events (cross-nav from Ventas) ──
  useEffect(() => {
    if (!navEvent || navEvent.target !== '/nc-ventas' || !navEvent.payload?.ncId) return;
    if (navEvent.timestamp === lastNavTimestamp.current) return;
    lastNavTimestamp.current = navEvent.timestamp;
    const targetId = navEvent.payload.ncId as number;
    clearNavEvent();
    setSelectedId(targetId);
    setDrawerOpen(true);
  }, [navEvent, clearNavEvent]);

  // ── Detail query ───────────────────────────────
  const { data: detail, isLoading: detailLoading, error: detailError } = useQuery({
    queryKey: ['nc-venta', selectedId],
    queryFn: () => ncVentasApi.getById(selectedId!),
    enabled: !!selectedId,
  });

  // ── Anular mutation ────────────────────────────
  const anularMutation = useMutation({
    mutationFn: (id: number) => ncVentasApi.anular(id),
    onSuccess: (data) => {
      message.success(`NC #${data.NC_ID} anulada — ND #${data.ND_ID} generada`);
      refetch();
      if (drawerOpen) { setDrawerOpen(false); setSelectedId(null); }
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al anular');
    },
  });

  // ── Emitir fiscal mutation ─────────────────────
  const emitirFiscalMutation = useMutation({
    mutationFn: (id: number) => ncVentasApi.emitirFiscal(id),
    onSuccess: (data, ncId) => {
      if (data.success) {
        message.success(`NC fiscal emitida: ${data.comprobante_nro} — CAE: ${data.cae}`);
      } else {
        message.error(`Error al emitir NC fiscal: ${data.errores?.join(', ') || data.error || 'Error desconocido'}`);
      }
      refetch();
      setSelectedId(ncId);
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al emitir NC fiscal');
    },
  });

  const openDetail = (record: NCVenta) => {
    setSelectedId(record.NC_ID);
    setDrawerOpen(true);
  };

  // ── KPI cards ──────────────────────────────────
  const totalMonto = notas?.reduce((s, n) => s + (n.ANULADA ? 0 : n.MONTO), 0) ?? 0;
  const totalActivas = notas?.filter(n => !n.ANULADA).length ?? 0;
  const totalAnuladas = notas?.filter(n => n.ANULADA).length ?? 0;

  // ── Action menu ────────────────────────────────
  const getRowActions = (record: NCVenta) => {
    const items: any[] = [
      { key: 'detail', label: 'Ver detalle', icon: <EyeOutlined />, onClick: () => openDetail(record) },
    ];
    if (!record.ANULADA) {
      if (utilizaFE && !record.EMITIDA_FISCAL && record.NUMERO_FISCAL === null) {
        items.push({
          key: 'emitir-fiscal',
          label: 'Emitir NC Fiscal',
          icon: <ThunderboltOutlined />,
        });
      }
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
    { title: 'Cliente', dataIndex: 'CLIENTE_NOMBRE', key: 'client', ellipsis: true },
    {
      title: 'Venta', dataIndex: 'VENTA_ID', key: 'ventaId', width: 160, align: 'center' as const,
      render: (_: number, record: NCVenta) => {
        const label = record.VENTA_NUMERO_FISCAL
          ? `${record.VENTA_PUNTO_VENTA || ''}-${record.VENTA_NUMERO_FISCAL}`
          : `#${record.VENTA_ID}`;
        return (
          <Tooltip title="Ver venta">
            <span
              style={{ cursor: 'pointer', color: '#EABD23', fontWeight: 500 }}
              onClick={(e) => {
                e.stopPropagation();
                openTab({ key: '/sales', label: 'Ventas', closable: true });
                navTo('/sales', { ventaId: record.VENTA_ID });
                navigate('/sales');
              }}
            >
              {label}
            </span>
          </Tooltip>
        );
      },
    },
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
      title: 'Fiscal', key: 'fiscal', width: 90, align: 'center' as const,
      render: (_: unknown, record: NCVenta) => (
        record.EMITIDA_FISCAL
          ? <Tag color="blue">{record.TIPO_COMPROBANTE || 'Emitida'}</Tag>
          : <Text type="secondary">—</Text>
      ),
    },
    {
      title: 'Estado', key: 'estado', width: 100, align: 'center' as const,
      render: (_: unknown, record: NCVenta) => (
        <Tag color={record.ANULADA ? 'red' : 'green'}>{record.ANULADA ? 'Anulada' : 'Activa'}</Tag>
      ),
    },
    {
      title: '', key: 'actions', width: 80, fixed: 'right' as const,
      render: (_: unknown, record: NCVenta) => (
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
                  openDetail(record);
                } else if (key === 'emitir-fiscal') {
                  emitirFiscalMutation.mutate(record.NC_ID);
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
          Notas de Crédito — Ventas
        </Title>
        <Space wrap>
          <Input
            placeholder="Buscar cliente..."
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
        scroll={{ x: 1000 }}
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
            <Space>
              {utilizaFE && !detail.EMITIDA_FISCAL && (
                <Popconfirm
                  title="¿Emitir NC fiscal?"
                  description="Se generará una NC fiscal a través de ARCA."
                  onConfirm={() => emitirFiscalMutation.mutate(detail.NC_ID)}
                  okText="Sí, emitir"
                  cancelText="Cancelar"
                >
                  <Button type="primary" size="small" icon={<ThunderboltOutlined />} loading={emitirFiscalMutation.isPending}>
                    Emitir Fiscal
                  </Button>
                </Popconfirm>
              )}
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
            </Space>
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
              <Descriptions.Item label="Cliente">
                {detail.CLIENTE_NOMBRE}
              </Descriptions.Item>
              <Descriptions.Item label="Venta asociada">
                <Tooltip title="Ver venta">
                  <span
                    style={{ cursor: 'pointer', color: '#EABD23', fontWeight: 500 }}
                    onClick={() => {
                      setDrawerOpen(false);
                      setSelectedId(null);
                      openTab({ key: '/sales', label: 'Ventas', closable: true });
                      navTo('/sales', { ventaId: detail.VENTA_ID });
                      navigate('/sales');
                    }}
                  >
                    #{detail.VENTA_ID}
                  </span>
                </Tooltip>
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
                  {detail.DESTINO_PAGO === 'CAJA' ? 'Caja Usuario' : (
                    <Tooltip title="Ver en Caja Central">
                      <span
                        style={{ cursor: 'pointer', color: '#EABD23' }}
                        onClick={() => {
                          setDrawerOpen(false);
                          setSelectedId(null);
                          openTab({ key: '/cashcentral', label: 'Caja Central', closable: true });
                          navigate('/cashcentral');
                        }}
                      >
                        Caja Central <BankOutlined />
                      </span>
                    </Tooltip>
                  )}
                </Descriptions.Item>
              )}
              {detail.EMITIDA_FISCAL && (
                <>
                  <Descriptions.Item label="Tipo Comprobante">
                    <Tag color="blue">{detail.TIPO_COMPROBANTE}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="Nro. Fiscal">
                    {detail.PUNTO_VENTA_FISCAL}-{detail.NUMERO_FISCAL}
                  </Descriptions.Item>
                  <Descriptions.Item label="CAE">
                    {detail.CAE}
                  </Descriptions.Item>
                  {detail.CAE_VTO && (
                    <Descriptions.Item label="CAE Vto.">
                      {detail.CAE_VTO}
                    </Descriptions.Item>
                  )}
                </>
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
                {detail.metodos_pago && detail.metodos_pago.length > 0 ? (
                  <span
                    style={{ fontSize: 20, fontWeight: 'bold', color: '#EABD23', cursor: 'pointer' }}
                    onClick={() => setDesgloseModalOpen(true)}
                  >
                    {fmtMoney(detail.MONTO)} ▸
                  </span>
                ) : (
                  <span style={{ fontSize: 20, fontWeight: 'bold', color: '#EABD23' }}>
                    {fmtMoney(detail.MONTO)}
                  </span>
                )}
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
                      title: 'U.', key: 'unidad', width: 50, align: 'center' as const,
                      render: (_: unknown, r: any) => <Text type="secondary">{r.UNIDAD_ABREVIACION || '—'}</Text>,
                    },
                    {
                      title: 'Cant. Devuelta', dataIndex: 'CANTIDAD_DEVUELTA', width: 136, align: 'center' as const,
                      render: (v: number) => <Text strong style={{ color: '#ff4d4f' }}>{v % 1 === 0 ? v : fmtNum(v)}</Text>,
                    },
                    {
                      title: 'Precio', dataIndex: 'PRECIO_UNITARIO', width: 120, align: 'center' as const,
                      render: (v: number) => fmtMoney(v),
                    },
                    {
                      title: 'Bonif.', key: 'desc', width: 80, align: 'center' as const,
                      render: (_: unknown, r: any) => {
                        const d = r.PORCENTAJE_DESCUENTO || 0;
                        return d > 0 ? <Text type="warning">{fmtNum(d)}%</Text> : <Text type="secondary">—</Text>;
                      },
                    },
                    {
                      title: 'Subtotal', key: 'sub', width: 120, align: 'center' as const,
                      render: (_: unknown, r: any) => {
                        const bruto = r.CANTIDAD_DEVUELTA * r.PRECIO_UNITARIO;
                        const neto = Math.round(bruto * (1 - (r.PORCENTAJE_DESCUENTO || 0) / 100) * 100) / 100;
                        return <Text strong>{fmtMoney(neto)}</Text>;
                      },
                    },
                  ]}
                  summary={() => {
                    const isFacturaA = detail.VENTA_TIPO_COMPROBANTE === 'Fa.A';
                    const totalNeto = Math.round(detail.items.reduce((s, i: any) => {
                      const bruto = i.CANTIDAD_DEVUELTA * i.PRECIO_UNITARIO;
                      return s + Math.round(bruto * (1 - (i.PORCENTAJE_DESCUENTO || 0) / 100) * 100) / 100;
                    }, 0) * 100) / 100;
                    const totalIva = isFacturaA
                      ? Math.round(detail.items.reduce((s, i: any) => {
                          const bruto = i.CANTIDAD_DEVUELTA * i.PRECIO_UNITARIO;
                          const netoLinea = Math.round(bruto * (1 - (i.PORCENTAJE_DESCUENTO || 0) / 100) * 100) / 100;
                          return s + Math.round(netoLinea * (i.IVA_ALICUOTA || 0) * 100) / 100;
                        }, 0) * 100) / 100
                      : 0;
                    const totalFinal = detail.MONTO;
                    return (
                      <>
                        {isFacturaA && (
                          <>
                            <Table.Summary.Row>
                              <Table.Summary.Cell index={0} colSpan={6}>
                                <Text type="secondary" style={{ marginLeft: 13 }}>Neto</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={6} align="center">
                                <Text type="secondary">{fmtMoney(totalNeto)}</Text>
                              </Table.Summary.Cell>
                            </Table.Summary.Row>
                            <Table.Summary.Row>
                              <Table.Summary.Cell index={0} colSpan={6}>
                                <Text type="secondary" style={{ marginLeft: 13 }}>IVA</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={6} align="center">
                                <Text type="secondary">{fmtMoney(totalIva)}</Text>
                              </Table.Summary.Cell>
                            </Table.Summary.Row>
                          </>
                        )}
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={6}>
                            <Text strong style={{ marginLeft: 13 }}>Total</Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={6} align="center">
                            <Text strong style={{ color: '#EABD23' }}>
                              {fmtMoney(totalFinal)}
                            </Text>
                          </Table.Summary.Cell>
                        </Table.Summary.Row>
                      </>
                    );
                  }}
                />
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* ── Desglose Métodos de Pago Modal ──── */}
      <Modal
        open={desgloseModalOpen}
        onCancel={() => setDesgloseModalOpen(false)}
        footer={<Button onClick={() => setDesgloseModalOpen(false)}>Cerrar</Button>}
        title="Desglose por método de pago"
        width={480}
        destroyOnClose
      >
        {detail?.metodos_pago && detail.metodos_pago.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {detail.metodos_pago.map(d => (
              <div key={d.METODO_PAGO_ID} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8,
                background: d.CATEGORIA === 'EFECTIVO' ? 'rgba(82,196,26,0.06)' : 'rgba(22,119,255,0.06)',
                border: `1px solid ${d.CATEGORIA === 'EFECTIVO' ? '#b7eb8f' : '#91caff'}`,
              }}>
                <Space>
                  {d.IMAGEN_BASE64 ? (
                    <img src={d.IMAGEN_BASE64} alt={d.NOMBRE} style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4 }} />
                  ) : null}
                  <div>
                    <Text strong>{d.NOMBRE}</Text>
                    <br />
                    <Tag color={d.CATEGORIA === 'EFECTIVO' ? 'green' : 'blue'} style={{ fontSize: 10 }}>
                      {d.CATEGORIA}
                    </Tag>
                  </div>
                </Space>
                <Text strong style={{ fontSize: 16 }}>{fmtMoney(Math.abs(d.TOTAL))}</Text>
              </div>
            ))}
          </div>
        ) : (
          <Text type="secondary">No hay métodos de pago registrados.</Text>
        )}
      </Modal>

      {/* ── New NC Modal ──────────────────────── */}
      <NewNCVentaModal
        open={newNCOpen}
        onClose={() => setNewNCOpen(false)}
        onSuccess={() => { setNewNCOpen(false); refetch(); }}
        utilizaFE={utilizaFE}
      />
    </div>
  );
}
