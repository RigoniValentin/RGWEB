import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Input, Typography, Tag, Button, App, Modal, Descriptions,
  Drawer, DatePicker, Segmented, Statistic, Card, Row, Col, Tooltip, Popconfirm,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, ReloadOutlined, DollarOutlined, BankOutlined,
  ArrowUpOutlined, ArrowDownOutlined, WalletOutlined, ShopOutlined,
  CreditCardOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  ctaCorrienteProvApi,
  type CtaCorrienteProvListItem,
  type MovimientoCtaCteProv,
  type OrdenPagoItem,
} from '../services/ctaCorrienteProv.api';
import { fmtMoney } from '../utils/format';
import { NuevaOrdenPagoModal } from '../components/ctaCorriente/NuevaOrdenPagoModal';
import { useNavigationStore } from '../store/navigationStore';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

type DateFilter = 'mes' | 'todos' | 'personalizado';

export function CtaCorrienteProvPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();

  // ── List state ──────────────────────────────────
  const [search, setSearch] = useState('');

  // ── Detail state ────────────────────────────────
  const [selected, setSelected] = useState<CtaCorrienteProvListItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'movimientos' | 'ordenes-pago'>('movimientos');
  const [dateFilter, setDateFilter] = useState<DateFilter>('mes');
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [dateFilterOP, setDateFilterOP] = useState<DateFilter>('mes');
  const [customRangeOP, setCustomRangeOP] = useState<[Dayjs, Dayjs] | null>(null);

  // ── Orden de pago modal state ───────────────────
  const [ordenPagoModalOpen, setOrdenPagoModalOpen] = useState(false);
  const [editPagoId, setEditPagoId] = useState<number | null>(null);
  const [detalleOrdenPago, setDetalleOrdenPago] = useState<OrdenPagoItem | null>(null);

  // ── Compute date range ──────────────────────────
  const dateRange = useMemo(() => {
    if (dateFilter === 'todos') return { fechaDesde: undefined, fechaHasta: undefined };
    if (dateFilter === 'personalizado' && customRange) {
      return {
        fechaDesde: customRange[0].startOf('day').format('YYYY-MM-DDTHH:mm:ss'),
        fechaHasta: customRange[1].endOf('day').format('YYYY-MM-DDTHH:mm:ss'),
      };
    }
    return {
      fechaDesde: dayjs().startOf('month').format('YYYY-MM-DDTHH:mm:ss'),
      fechaHasta: dayjs().endOf('month').format('YYYY-MM-DDTHH:mm:ss'),
    };
  }, [dateFilter, customRange]);

  const dateRangeOP = useMemo(() => {
    if (dateFilterOP === 'todos') return { fechaDesde: undefined, fechaHasta: undefined };
    if (dateFilterOP === 'personalizado' && customRangeOP) {
      return {
        fechaDesde: customRangeOP[0].startOf('day').format('YYYY-MM-DDTHH:mm:ss'),
        fechaHasta: customRangeOP[1].endOf('day').format('YYYY-MM-DDTHH:mm:ss'),
      };
    }
    return {
      fechaDesde: dayjs().startOf('month').format('YYYY-MM-DDTHH:mm:ss'),
      fechaHasta: dayjs().endOf('month').format('YYYY-MM-DDTHH:mm:ss'),
    };
  }, [dateFilterOP, customRangeOP]);

  // ── Queries ─────────────────────────────────────
  const { data: proveedores, isLoading } = useQuery({
    queryKey: ['cta-corriente-prov-list', search],
    queryFn: () => ctaCorrienteProvApi.getAll(search || undefined),
  });

  // ── Cross-tab navigation: auto-open supplier detail ──
  const navEvent = useNavigationStore(s => s.event);
  const clearNavEvent = useNavigationStore(s => s.clearEvent);
  const lastNavTimestamp = useRef<number>(0);

  useEffect(() => {
    if (!navEvent || navEvent.target !== '/cta-corriente-prov' || !navEvent.payload?.proveedorId) return;
    if (navEvent.timestamp === lastNavTimestamp.current) return;

    // Invalidate queries so data is fresh when navigating from another page
    qc.invalidateQueries({ queryKey: ['cta-corriente-prov-list'] });
    qc.invalidateQueries({ queryKey: ['cta-prov-movimientos'] });
    qc.invalidateQueries({ queryKey: ['cta-prov-ordenes-pago'] });

    if (!proveedores || proveedores.length === 0) return;

    lastNavTimestamp.current = navEvent.timestamp;
    const targetId = navEvent.payload.proveedorId as number;
    const record = proveedores.find(p => p.PROVEEDOR_ID === targetId);
    clearNavEvent();

    if (record) {
      handleView(record);
    } else {
      message.info('El proveedor no tiene habilitada la Cuenta Corriente');
    }
  }, [navEvent, proveedores]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctaId = selected?.CTA_CORRIENTE_ID ?? null;

  const { data: movData, isLoading: movLoading } = useQuery({
    queryKey: ['cta-prov-movimientos', ctaId, dateRange.fechaDesde, dateRange.fechaHasta],
    queryFn: () => ctaCorrienteProvApi.getMovimientos(ctaId!, dateRange.fechaDesde, dateRange.fechaHasta),
    enabled: ctaId !== null && drawerOpen,
  });

  const { data: ordenesPago, isLoading: ordenesLoading } = useQuery({
    queryKey: ['cta-prov-ordenes-pago', ctaId, dateRangeOP.fechaDesde, dateRangeOP.fechaHasta],
    queryFn: () => ctaCorrienteProvApi.getOrdenesPago(ctaId!, dateRangeOP.fechaDesde, dateRangeOP.fechaHasta),
    enabled: ctaId !== null && drawerOpen,
  });

  // ── Mutations ───────────────────────────────────
  const crearCuentaMut = useMutation({
    mutationFn: (proveedorId: number) => ctaCorrienteProvApi.crearCuenta(proveedorId),
    onSuccess: () => {
      message.success('Cuenta corriente creada');
      qc.invalidateQueries({ queryKey: ['cta-corriente-prov-list'] });
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  const eliminarOrdenPagoMut = useMutation({
    mutationFn: (pagoId: number) => ctaCorrienteProvApi.eliminarOrdenPago(pagoId),
    onSuccess: () => {
      message.success('Orden de pago eliminada');
      qc.invalidateQueries({ queryKey: ['cta-prov-ordenes-pago'] });
      qc.invalidateQueries({ queryKey: ['cta-prov-movimientos'] });
      qc.invalidateQueries({ queryKey: ['cta-corriente-prov-list'] });
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  // ── Handlers ────────────────────────────────────
  const handleView = (record: CtaCorrienteProvListItem) => {
    if (record.ESTADO_CUENTA === 'SIN_CREAR') {
      modal.confirm({
        title: 'Crear Cuenta Corriente',
        content: `El proveedor "${record.NOMBRE}" no tiene una cuenta corriente creada. ¿Desea crearla ahora?`,
        okText: 'Sí, crear',
        cancelText: 'No',
        onOk: async () => {
          const result = await crearCuentaMut.mutateAsync(record.PROVEEDOR_ID);
          setSelected({ ...record, CTA_CORRIENTE_ID: result.CTA_CORRIENTE_ID, ESTADO_CUENTA: 'CREADA_SIN_MOV' });
          setActiveTab('movimientos');
          setDateFilter('mes');
          setDateFilterOP('mes');
          setDrawerOpen(true);
        },
      });
      return;
    }
    setSelected(record);
    setActiveTab('movimientos');
    setDateFilter('mes');
    setDateFilterOP('mes');
    setDrawerOpen(true);
  };

  const handleDeleteOrdenPago = (pagoId: number) => {
    eliminarOrdenPagoMut.mutate(pagoId);
  };

  const handleOrdenPagoSuccess = () => {
    setOrdenPagoModalOpen(false);
    setEditPagoId(null);
    qc.invalidateQueries({ queryKey: ['cta-prov-ordenes-pago'] });
    qc.invalidateQueries({ queryKey: ['cta-prov-movimientos'] });
    qc.invalidateQueries({ queryKey: ['cta-corriente-prov-list'] });
  };

  // ── List columns ────────────────────────────────
  const columns: TableColumnType<CtaCorrienteProvListItem>[] = [
    {
      title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 90,
      align: 'center',
    },
    {
      title: 'Proveedor', dataIndex: 'NOMBRE', ellipsis: true,
    },
    {
      title: 'CUIT/DNI', dataIndex: 'NUMERO_DOC', width: 130,
      align: 'center',
    },
    {
      title: 'Teléfono', dataIndex: 'TELEFONO', width: 130, align: 'center',
      responsive: ['lg'],
    },
    {
      title: 'Estado', dataIndex: 'ESTADO_CUENTA', width: 140,
      align: 'center',
      render: (v: string) => {
        if (v === 'ACTIVA') return <Tag color="green">Activa</Tag>;
        if (v === 'CREADA_SIN_MOV') return <Tag color="orange">Sin movimientos</Tag>;
        return <Tag color="default">Sin crear</Tag>;
      },
    },
    {
      title: 'Saldo', dataIndex: 'SALDO_ACTUAL', width: 130,
      align: 'center',
      render: (v: number) => (
        <Text strong style={{ color: v > 0 ? '#cf1322' : v < 0 ? '#3f8600' : undefined }}>
          {fmtMoney(v)}
        </Text>
      ),
      sorter: (a, b) => a.SALDO_ACTUAL - b.SALDO_ACTUAL,
    },
    {
      title: 'Últ. Movimiento', dataIndex: 'ULTIMA_TRANSACCION', width: 175,
      align: 'center',
      render: (v: string | null) => v ? dayjs(v).format('DD/MM/YYYY HH:mm') : '-',
      sorter: (a, b) => {
        if (!a.ULTIMA_TRANSACCION) return 1;
        if (!b.ULTIMA_TRANSACCION) return -1;
        return dayjs(a.ULTIMA_TRANSACCION).unix() - dayjs(b.ULTIMA_TRANSACCION).unix();
      },
    },
    {
      title: 'Acciones', width: 110, align: 'center',
      render: (_: any, record: CtaCorrienteProvListItem) => (
        <Tooltip title="Ver detalle">
          <Button
            type="text" size="small"
            icon={<EyeOutlined />}
            onClick={() => handleView(record)}
          />
        </Tooltip>
      ),
    },
  ];

  // ── Movement columns ────────────────────────────
  const movColumns: TableColumnType<MovimientoCtaCteProv>[] = [
    {
      title: 'Tipo', dataIndex: 'TIPO_COMPROBANTE', width: 100,
      align: 'center',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Fecha', dataIndex: 'FECHA', width: 160, align: 'center',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'),
    },
    {
      title: 'Concepto', dataIndex: 'CONCEPTO',
    },
    {
      title: 'Debe', dataIndex: 'DEBE', width: 120, align: 'center',
      render: (v: number) => v > 0 ? <Text type="danger">{fmtMoney(v)}</Text> : '-',
    },
    {
      title: 'Haber', dataIndex: 'HABER', width: 120, align: 'center',
      render: (v: number) => v > 0 ? <Text type="success">{fmtMoney(v)}</Text> : '-',
    },
    {
      title: 'Saldo', dataIndex: 'SALDO', width: 120, align: 'center',
      render: (v: number) => (
        <Text strong style={{ color: v > 0 ? '#cf1322' : v < 0 ? '#3f8600' : undefined }}>
          {fmtMoney(v)}
        </Text>
      ),
    },
  ];

  // ── Orden de pago columns ───────────────────────
  const opColumns: TableColumnType<OrdenPagoItem>[] = [
    {
      title: 'Fecha', dataIndex: 'FECHA', width: 160, align: 'center',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'),
    },
    {
      title: 'Usuario', dataIndex: 'USUARIO', width: 150, align: 'center',
    },
    {
      title: 'Concepto', dataIndex: 'CONCEPTO', ellipsis: true,
    },
    {
      title: 'Total', dataIndex: 'TOTAL', width: 130, align: 'center',
      render: (_: number, record: OrdenPagoItem) => (
        <Button
          type="link" size="small" style={{ padding: 0, fontWeight: 600 }}
          onClick={() => setDetalleOrdenPago(record)}
        >
          {fmtMoney(record.TOTAL)} <EyeOutlined style={{ fontSize: 12, marginLeft: 4 }} />
        </Button>
      ),
    },
    {
      title: '', width: 80, align: 'center',
      render: (_: any, record: OrdenPagoItem) => (
        <Space size={4}>
          <Tooltip title="Editar">
            <Button
              type="text" size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditPagoId(record.PAGO_ID);
                setOrdenPagoModalOpen(true);
              }}
            />
          </Tooltip>
          <Popconfirm
            title="¿Eliminar esta orden de pago?"
            description="Esto puede alterar la integridad de la cuenta corriente."
            onConfirm={() => handleDeleteOrdenPago(record.PAGO_ID)}
            okText="Sí, eliminar"
            cancelText="No"
          >
            <Tooltip title="Eliminar">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Build movimientos data with saldo anterior ──
  const movimientosData: MovimientoCtaCteProv[] = useMemo(() => {
    if (!movData) return [];
    const rows: MovimientoCtaCteProv[] = [];
    if (dateFilter !== 'todos' && movData.saldoAnterior !== 0) {
      rows.push({
        COMPROBANTE_ID: 0,
        FECHA: dateRange.fechaDesde || dayjs().startOf('month').format('YYYY-MM-DDTHH:mm:ss'),
        CONCEPTO: 'Saldo Anterior',
        TIPO_COMPROBANTE: '',
        DEBE: 0,
        HABER: 0,
        SALDO: movData.saldoAnterior,
      });
    }
    rows.push(...movData.movimientos);
    return rows;
  }, [movData, dateFilter, dateRange.fechaDesde]);

  // ── Statistics summary ──────────────────────────
  const stats = useMemo(() => {
    if (!proveedores) return { total: 0, activas: 0, sinCrear: 0, saldoTotal: 0 };
    return {
      total: proveedores.length,
      activas: proveedores.filter(p => p.ESTADO_CUENTA === 'ACTIVA').length,
      sinCrear: proveedores.filter(p => p.ESTADO_CUENTA === 'SIN_CREAR').length,
      saldoTotal: proveedores.reduce((s, p) => s + p.SALDO_ACTUAL, 0),
    };
  }, [proveedores]);

  // ── Render ──────────────────────────────────────
  return (
    <div className="page-enter">
      {/* Header */}
      <div className="page-header">
        <Title level={3}>Cuentas Corrientes — Proveedores</Title>
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['cta-corriente-prov-list'] })}>
          Actualizar
        </Button>
      </div>

      {/* Stats */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic title="Total proveedores" value={stats.total} prefix={<ShopOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic title="Cuentas activas" value={stats.activas} valueStyle={{ color: '#3f8600' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic title="Sin crear" value={stats.sinCrear} valueStyle={{ color: '#999' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Saldo total"
              value={stats.saldoTotal}
              precision={2}
              prefix="$"
              valueStyle={{ color: stats.saldoTotal > 0 ? '#cf1322' : '#3f8600' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Search */}
      <Space style={{ marginBottom: 12 }}>
        <Input
          placeholder="Buscar proveedor..."
          prefix={<SearchOutlined />}
          allowClear
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 300 }}
        />
      </Space>

      {/* Main table */}
      <Table<CtaCorrienteProvListItem>
        className="rg-table"
        rowKey="PROVEEDOR_ID"
        columns={columns}
        dataSource={proveedores}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 25, showSizeChanger: true, showTotal: t => `${t} proveedores` }}
        onRow={(record) => ({
          onDoubleClick: () => handleView(record),
          style: { cursor: 'pointer' },
        })}
      />

      {/* Detail drawer */}
      <Drawer
        title={
          <div>
            <Text strong style={{ fontSize: 16 }}>{selected?.NOMBRE}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Cód: {selected?.CODIGOPARTICULAR} | {selected?.NUMERO_DOC || 'Sin documento'}
            </Text>
          </div>
        }
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelected(null); }}
        width={1000}
        styles={{ body: { padding: '12px 16px' } }}
      >
        {selected && selected.ESTADO_CUENTA !== 'SIN_CREAR' && (
          <>
            {/* Totals summary */}
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Card size="small" className="rg-card">
                  <Statistic
                    title="Total Debe"
                    value={movData?.totales?.TOTAL_DEBE ?? 0}
                    precision={2} prefix={<ArrowUpOutlined />}
                    valueStyle={{ color: '#cf1322' }}
                    formatter={(v) => fmtMoney(Number(v))}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" className="rg-card">
                  <Statistic
                    title="Total Haber"
                    value={movData?.totales?.TOTAL_HABER ?? 0}
                    precision={2} prefix={<ArrowDownOutlined />}
                    valueStyle={{ color: '#3f8600' }}
                    formatter={(v) => fmtMoney(Number(v))}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small" className="rg-card">
                  <Statistic
                    title="Saldo"
                    value={movData?.totales?.SALDO ?? 0}
                    precision={2} prefix={<WalletOutlined />}
                    valueStyle={{
                      color: (movData?.totales?.SALDO ?? 0) > 0 ? '#cf1322' : '#3f8600',
                      fontWeight: 700,
                    }}
                    formatter={(v) => fmtMoney(Number(v))}
                  />
                </Card>
              </Col>
            </Row>

            {/* Tab selector */}
            <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}>
                <Card
                  className="rg-card"
                  size="small"
                  hoverable
                  onClick={() => setActiveTab('movimientos')}
                  style={{
                    cursor: 'pointer',
                    borderColor: activeTab === 'movimientos' ? 'var(--rg-gold)' : undefined,
                    background: activeTab === 'movimientos' ? 'rgba(234, 189, 35, 0.08)' : undefined,
                    transition: 'all 0.25s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <DollarOutlined style={{ color: activeTab === 'movimientos' ? 'var(--rg-gold)' : 'rgba(255,255,255,0.45)', fontSize: 16 }} />
                    <Text strong style={{ color: 'var(--rg-gold)' }}>
                      Cuenta Corriente
                    </Text>
                  </div>
                </Card>
              </Col>
              <Col span={12}>
                <Card
                  className="rg-card"
                  size="small"
                  hoverable
                  onClick={() => setActiveTab('ordenes-pago')}
                  style={{
                    cursor: 'pointer',
                    borderColor: activeTab === 'ordenes-pago' ? 'var(--rg-gold)' : undefined,
                    background: activeTab === 'ordenes-pago' ? 'rgba(234, 189, 35, 0.08)' : undefined,
                    transition: 'all 0.25s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <BankOutlined style={{ color: activeTab === 'ordenes-pago' ? 'var(--rg-gold)' : 'rgba(255,255,255,0.45)', fontSize: 16 }} />
                    <Text strong style={{ color: 'var(--rg-gold)' }}>
                      Órdenes de Pago
                    </Text>
                  </div>
                </Card>
              </Col>
            </Row>

            {/* ── Movimientos tab ── */}
            {activeTab === 'movimientos' && (
              <>
                <Space style={{ marginBottom: 8 }}>
                  <Segmented
                    size="small"
                    value={dateFilter}
                    onChange={v => setDateFilter(v as DateFilter)}
                    options={[
                      { label: 'Este mes', value: 'mes' },
                      { label: 'Todos', value: 'todos' },
                      { label: 'Personalizado', value: 'personalizado' },
                    ]}
                  />
                  {dateFilter === 'personalizado' && (
                    <RangePicker
                      size="small"
                      format="DD/MM/YYYY"
                      value={customRange}
                      onChange={(dates) => setCustomRange(dates as [Dayjs, Dayjs] | null)}
                    />
                  )}
                </Space>
                <Table<MovimientoCtaCteProv>
                  className="rg-table"
                  rowKey={(r, i) => `${r.COMPROBANTE_ID}-${i}`}
                  columns={movColumns}
                  dataSource={movimientosData}
                  loading={movLoading}
                  size="small"
                  pagination={false}
                  scroll={{ y: 400 }}
                  rowClassName={(r) => r.CONCEPTO === 'Saldo Anterior' ? 'row-saldo-anterior' : ''}
                />
              </>
            )}

            {/* ── Ordenes de Pago tab ── */}
            {activeTab === 'ordenes-pago' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Space>
                    <Segmented
                      size="small"
                      value={dateFilterOP}
                      onChange={v => setDateFilterOP(v as DateFilter)}
                      options={[
                        { label: 'Este mes', value: 'mes' },
                        { label: 'Todos', value: 'todos' },
                        { label: 'Personalizado', value: 'personalizado' },
                      ]}
                    />
                    {dateFilterOP === 'personalizado' && (
                      <RangePicker
                        size="small"
                        format="DD/MM/YYYY"
                        value={customRangeOP}
                        onChange={(dates) => setCustomRangeOP(dates as [Dayjs, Dayjs] | null)}
                      />
                    )}
                  </Space>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    size="small"
                    onClick={() => {
                      setEditPagoId(null);
                      setOrdenPagoModalOpen(true);
                    }}
                  >
                    Nueva Orden de Pago
                  </Button>
                </div>
                <Table<OrdenPagoItem>
                  className="rg-table"
                  rowKey="PAGO_ID"
                  columns={opColumns}
                  dataSource={ordenesPago}
                  loading={ordenesLoading}
                  size="small"
                  pagination={false}
                  scroll={{ y: 400 }}
                />
              </>
            )}
          </>
        )}
      </Drawer>

      {/* Detalle Orden de Pago Modal */}
      <DetalleOrdenPagoModal
        detalleOrdenPago={detalleOrdenPago}
        onClose={() => setDetalleOrdenPago(null)}
      />

      {/* Orden de Pago Modal */}
      {selected && (
        <NuevaOrdenPagoModal
          open={ordenPagoModalOpen}
          ctaCorrienteId={selected.CTA_CORRIENTE_ID}
          proveedorId={selected.PROVEEDOR_ID}
          proveedorNombre={selected.NOMBRE || ''}
          pagoId={editPagoId}
          onSuccess={handleOrdenPagoSuccess}
          onCancel={() => {
            setOrdenPagoModalOpen(false);
            setEditPagoId(null);
          }}
        />
      )}
    </div>
  );
}

// ── Detalle Orden de Pago sub-component ─────────
function DetalleOrdenPagoModal({ detalleOrdenPago, onClose }: {
  detalleOrdenPago: OrdenPagoItem | null;
  onClose: () => void;
}) {
  const { data: detalle } = useQuery({
    queryKey: ['orden-pago-detalle', detalleOrdenPago?.PAGO_ID],
    queryFn: () => ctaCorrienteProvApi.getOrdenPagoById(detalleOrdenPago!.PAGO_ID),
    enabled: !!detalleOrdenPago,
  });

  const { data: metodosPago = [] } = useQuery({
    queryKey: ['op-active-payment-methods'],
    queryFn: () => ctaCorrienteProvApi.getActivePaymentMethods(),
    enabled: !!detalleOrdenPago,
    staleTime: 60000,
  });

  return (
    <Modal
      title="Detalle de Orden de Pago"
      open={!!detalleOrdenPago}
      onCancel={onClose}
      footer={null}
      width={420}
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
    >
      {detalleOrdenPago && (
        <>
          <Descriptions column={1} bordered size="small" style={{ marginTop: 12 }}>
            <Descriptions.Item label="Fecha">
              {dayjs(detalleOrdenPago.FECHA).format('DD/MM/YYYY HH:mm')}
            </Descriptions.Item>
            <Descriptions.Item label="Concepto">
              {detalleOrdenPago.CONCEPTO || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Usuario">
              {detalleOrdenPago.USUARIO}
            </Descriptions.Item>
          </Descriptions>

          {/* Payment method breakdown */}
          {detalle?.metodos_pago && detalle.metodos_pago.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                Desglose por método de pago
              </Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {detalle.metodos_pago.map((mp, idx) => {
                  const m = metodosPago.find(x => x.METODO_PAGO_ID === mp.METODO_PAGO_ID);
                  return (
                    <div key={idx} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 12px', background: '#fafafa', borderRadius: 6,
                    }}>
                      <Space size={8}>
                        {m?.IMAGEN_BASE64 ? (
                          <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 3 }} />
                        ) : m?.CATEGORIA === 'EFECTIVO' ? (
                          <DollarOutlined style={{ color: '#52c41a' }} />
                        ) : (
                          <CreditCardOutlined style={{ color: '#1890ff' }} />
                        )}
                        <Text>{m?.NOMBRE || `Método #${mp.METODO_PAGO_ID}`}</Text>
                      </Space>
                      <Text strong>{fmtMoney(mp.MONTO)}</Text>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <Descriptions column={1} bordered size="small" style={{ marginTop: 12 }}>
              <Descriptions.Item label="Efectivo">
                {fmtMoney(detalleOrdenPago.EFECTIVO)}
              </Descriptions.Item>
              <Descriptions.Item label="Digital">
                {fmtMoney(detalleOrdenPago.DIGITAL)}
              </Descriptions.Item>
              {detalleOrdenPago.CHEQUES > 0 && (
                <Descriptions.Item label="Cheques">
                  {fmtMoney(detalleOrdenPago.CHEQUES)}
                </Descriptions.Item>
              )}
            </Descriptions>
          )}

          <div style={{
            marginTop: 12, background: '#f5f5f5', borderRadius: 8, padding: '10px 16px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <Text strong style={{ fontSize: 15 }}>Total:</Text>
            <Text strong style={{ fontSize: 18, color: '#3f8600' }}>
              {fmtMoney(detalleOrdenPago.TOTAL)}
            </Text>
          </div>
        </>
      )}
    </Modal>
  );
}
