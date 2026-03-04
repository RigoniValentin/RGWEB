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
  ArrowUpOutlined, ArrowDownOutlined, WalletOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  ctaCorrienteApi,
  type CtaCorrienteListItem,
  type MovimientoCtaCte,
  type CobranzaItem,
} from '../services/ctaCorriente.api';
import { fmtMoney } from '../utils/format';
import { NuevaCobranzaModal } from '../components/ctaCorriente/NuevaCobranzaModal';
import { useNavigationStore } from '../store/navigationStore';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

type DateFilter = 'mes' | 'todos' | 'personalizado';

export function CtaCorrientePage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();

  // ── List state ──────────────────────────────────
  const [search, setSearch] = useState('');

  // ── Detail state ────────────────────────────────
  const [selected, setSelected] = useState<CtaCorrienteListItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'movimientos' | 'cobranzas'>('movimientos');
  const [dateFilter, setDateFilter] = useState<DateFilter>('mes');
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [dateFilterCobranza, setDateFilterCobranza] = useState<DateFilter>('mes');
  const [customRangeCobranza, setCustomRangeCobranza] = useState<[Dayjs, Dayjs] | null>(null);

  // ── Cobranza modal state ────────────────────────
  const [cobranzaModalOpen, setCobranzaModalOpen] = useState(false);
  const [editPagoId, setEditPagoId] = useState<number | null>(null);  const [detalleCobranza, setDetalleCobranza] = useState<CobranzaItem | null>(null);
  // ── Compute date range ──────────────────────────
  const dateRange = useMemo(() => {
    if (dateFilter === 'todos') return { fechaDesde: undefined, fechaHasta: undefined };
    if (dateFilter === 'personalizado' && customRange) {
      return {
        fechaDesde: customRange[0].startOf('day').toISOString(),
        fechaHasta: customRange[1].endOf('day').toISOString(),
      };
    }
    // mes actual
    return {
      fechaDesde: dayjs().startOf('month').toISOString(),
      fechaHasta: dayjs().endOf('month').toISOString(),
    };
  }, [dateFilter, customRange]);

  const dateRangeCobranza = useMemo(() => {
    if (dateFilterCobranza === 'todos') return { fechaDesde: undefined, fechaHasta: undefined };
    if (dateFilterCobranza === 'personalizado' && customRangeCobranza) {
      return {
        fechaDesde: customRangeCobranza[0].startOf('day').toISOString(),
        fechaHasta: customRangeCobranza[1].endOf('day').toISOString(),
      };
    }
    return {
      fechaDesde: dayjs().startOf('month').toISOString(),
      fechaHasta: dayjs().endOf('month').toISOString(),
    };
  }, [dateFilterCobranza, customRangeCobranza]);

  // ── Queries ─────────────────────────────────────
  const { data: clientes, isLoading } = useQuery({
    queryKey: ['cta-corriente-list', search],
    queryFn: () => ctaCorrienteApi.getAll(search || undefined),
  });

  // ── Cross-tab navigation: auto-open client detail ──
  const navEvent = useNavigationStore(s => s.event);
  const clearNavEvent = useNavigationStore(s => s.clearEvent);
  const lastNavTimestamp = useRef<number>(0);

  useEffect(() => {
    if (!navEvent || navEvent.target !== '/cta-corriente' || !navEvent.payload?.clienteId) return;
    if (navEvent.timestamp === lastNavTimestamp.current) return; // already processed
    if (!clientes || clientes.length === 0) return;

    lastNavTimestamp.current = navEvent.timestamp;
    const targetId = navEvent.payload.clienteId as number;
    const record = clientes.find(c => c.CLIENTE_ID === targetId);
    clearNavEvent();

    if (record) {
      handleView(record);
    } else {
      message.info('El cliente no tiene habilitada la Cuenta Corriente');
    }
  }, [navEvent, clientes]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctaId = selected?.CTA_CORRIENTE_ID ?? null;

  const { data: movData, isLoading: movLoading } = useQuery({
    queryKey: ['cta-movimientos', ctaId, dateRange.fechaDesde, dateRange.fechaHasta],
    queryFn: () => ctaCorrienteApi.getMovimientos(ctaId!, dateRange.fechaDesde, dateRange.fechaHasta),
    enabled: ctaId !== null && drawerOpen,
  });

  const { data: cobranzas, isLoading: cobranzasLoading } = useQuery({
    queryKey: ['cta-cobranzas', ctaId, dateRangeCobranza.fechaDesde, dateRangeCobranza.fechaHasta],
    queryFn: () => ctaCorrienteApi.getCobranzas(ctaId!, dateRangeCobranza.fechaDesde, dateRangeCobranza.fechaHasta),
    enabled: ctaId !== null && drawerOpen,
  });

  // ── Mutations ───────────────────────────────────
  const crearCuentaMut = useMutation({
    mutationFn: (clienteId: number) => ctaCorrienteApi.crearCuenta(clienteId),
    onSuccess: () => {
      message.success('Cuenta corriente creada');
      qc.invalidateQueries({ queryKey: ['cta-corriente-list'] });
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  const eliminarCobranzaMut = useMutation({
    mutationFn: (pagoId: number) => ctaCorrienteApi.eliminarCobranza(pagoId),
    onSuccess: () => {
      message.success('Cobranza eliminada');
      qc.invalidateQueries({ queryKey: ['cta-cobranzas'] });
      qc.invalidateQueries({ queryKey: ['cta-movimientos'] });
      qc.invalidateQueries({ queryKey: ['cta-corriente-list'] });
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  // ── Handlers ────────────────────────────────────
  const handleView = (record: CtaCorrienteListItem) => {
    if (record.ESTADO_CUENTA === 'SIN_CREAR') {
      modal.confirm({
        title: 'Crear Cuenta Corriente',
        content: `El cliente "${record.NOMBRE}" no tiene una cuenta corriente creada. ¿Desea crearla ahora?`,
        okText: 'Sí, crear',
        cancelText: 'No',
        onOk: async () => {
          const result = await crearCuentaMut.mutateAsync(record.CLIENTE_ID);
          setSelected({ ...record, CTA_CORRIENTE_ID: result.CTA_CORRIENTE_ID, ESTADO_CUENTA: 'CREADA_SIN_MOV' });
          setActiveTab('movimientos');
          setDateFilter('mes');
          setDateFilterCobranza('mes');
          setDrawerOpen(true);
        },
      });
      return;
    }
    setSelected(record);
    setActiveTab('movimientos');
    setDateFilter('mes');
    setDateFilterCobranza('mes');
    setDrawerOpen(true);
  };

  const handleDeleteCobranza = (pagoId: number) => {
    eliminarCobranzaMut.mutate(pagoId);
  };

  const handleCobranzaSuccess = () => {
    setCobranzaModalOpen(false);
    setEditPagoId(null);
    qc.invalidateQueries({ queryKey: ['cta-cobranzas'] });
    qc.invalidateQueries({ queryKey: ['cta-movimientos'] });
    qc.invalidateQueries({ queryKey: ['cta-corriente-list'] });
  };

  // ── List columns ────────────────────────────────
  const columns: TableColumnType<CtaCorrienteListItem>[] = [
    {
      title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 90,
      align: 'center',
    },
    {
      title: 'Cliente', dataIndex: 'NOMBRE', ellipsis: true,
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
      render: (_: any, record: CtaCorrienteListItem) => (
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
  const movColumns: TableColumnType<MovimientoCtaCte>[] = [
    {
      title: 'Tipo', dataIndex: 'TIPO_COMPROBANTE', width: 100,
      align: 'center',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: 'Fecha', dataIndex: 'FECHA', width: 150, align: 'center',
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

  // ── Cobranza columns ────────────────────────────
  const cobColumns: TableColumnType<CobranzaItem>[] = [
    {
      title: 'Fecha', dataIndex: 'FECHA', width: 140, align: 'center',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'),
    },
    {
      title: 'Usuario', dataIndex: 'USUARIO', width: 120, align: 'center',
    },
    {
      title: 'Concepto', dataIndex: 'CONCEPTO', ellipsis: true,
    },
    {
      title: 'Total', dataIndex: 'TOTAL', width: 130, align: 'center',
      render: (_: number, record: CobranzaItem) => (
        <Button
          type="link" size="small" style={{ padding: 0, fontWeight: 600 }}
          onClick={() => setDetalleCobranza(record)}
        >
          {fmtMoney(record.TOTAL)} <EyeOutlined style={{ fontSize: 12, marginLeft: 4 }} />
        </Button>
      ),
    },
    {
      title: '', width: 80, align: 'center',
      render: (_: any, record: CobranzaItem) => (
        <Space size={4}>
          <Tooltip title="Editar">
            <Button
              type="text" size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditPagoId(record.PAGO_ID);
                setCobranzaModalOpen(true);
              }}
            />
          </Tooltip>
          <Popconfirm
            title="¿Eliminar esta cobranza?"
            description="Esto puede alterar la integridad de la cuenta corriente."
            onConfirm={() => handleDeleteCobranza(record.PAGO_ID)}
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
  const movimientosData: MovimientoCtaCte[] = useMemo(() => {
    if (!movData) return [];
    const rows: MovimientoCtaCte[] = [];
    // Add "Saldo Anterior" row if filtering by date range
    if (dateFilter !== 'todos' && movData.saldoAnterior !== 0) {
      rows.push({
        COMPROBANTE_ID: 0,
        FECHA: dateRange.fechaDesde || dayjs().startOf('month').toISOString(),
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
    if (!clientes) return { total: 0, activas: 0, sinCrear: 0, saldoTotal: 0 };
    return {
      total: clientes.length,
      activas: clientes.filter(c => c.ESTADO_CUENTA === 'ACTIVA').length,
      sinCrear: clientes.filter(c => c.ESTADO_CUENTA === 'SIN_CREAR').length,
      saldoTotal: clientes.reduce((s, c) => s + c.SALDO_ACTUAL, 0),
    };
  }, [clientes]);

  // ── Render ──────────────────────────────────────
  return (
    <div className="page-enter">
      {/* Header */}
      <div className="page-header">
        <Title level={3}>Cuentas Corrientes — Clientes</Title>
        <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['cta-corriente-list'] })}>
          Actualizar
        </Button>
      </div>

      {/* Stats */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic title="Total clientes" value={stats.total} prefix={<BankOutlined />} />
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
          placeholder="Buscar cliente..."
          prefix={<SearchOutlined />}
          allowClear
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 300 }}
        />
      </Space>

      {/* Main table */}
      <Table<CtaCorrienteListItem>
        className="rg-table"
        rowKey="CLIENTE_ID"
        columns={columns}
        dataSource={clientes}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 25, showSizeChanger: true, showTotal: t => `${t} clientes` }}
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
        width={1100}
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
                    <Text strong style={{ color: activeTab === 'movimientos' ? 'var(--rg-gold)' : 'var(--rg-gold)' }}>
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
                  onClick={() => setActiveTab('cobranzas')}
                  style={{
                    cursor: 'pointer',
                    borderColor: activeTab === 'cobranzas' ? 'var(--rg-gold)' : undefined,
                    background: activeTab === 'cobranzas' ? 'rgba(234, 189, 35, 0.08)' : undefined,
                    transition: 'all 0.25s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <BankOutlined style={{ color: activeTab === 'cobranzas' ? 'var(--rg-gold)' : 'rgba(255,255,255,0.45)', fontSize: 16 }} />
                    <Text strong style={{ color: activeTab === 'cobranzas' ? 'var(--rg-gold)' : 'var(--rg-gold)' }}>
                      Cobranzas
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
                <Table<MovimientoCtaCte>
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

            {/* ── Cobranzas tab ── */}
            {activeTab === 'cobranzas' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Space>
                    <Segmented
                      size="small"
                      value={dateFilterCobranza}
                      onChange={v => setDateFilterCobranza(v as DateFilter)}
                      options={[
                        { label: 'Este mes', value: 'mes' },
                        { label: 'Todos', value: 'todos' },
                        { label: 'Personalizado', value: 'personalizado' },
                      ]}
                    />
                    {dateFilterCobranza === 'personalizado' && (
                      <RangePicker
                        size="small"
                        format="DD/MM/YYYY"
                        value={customRangeCobranza}
                        onChange={(dates) => setCustomRangeCobranza(dates as [Dayjs, Dayjs] | null)}
                      />
                    )}
                  </Space>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    size="small"
                    onClick={() => {
                      setEditPagoId(null);
                      setCobranzaModalOpen(true);
                    }}
                  >
                    Nueva Cobranza
                  </Button>
                </div>
                <Table<CobranzaItem>
                  className="rg-table"
                  rowKey="PAGO_ID"
                  columns={cobColumns}
                  dataSource={cobranzas}
                  loading={cobranzasLoading}
                  size="small"
                  pagination={false}
                  scroll={{ y: 400 }}
                />
              </>
            )}
          </>
        )}
      </Drawer>

      {/* Detalle Cobranza Modal */}
      <Modal
        title="Detalle de Cobranza"
        open={!!detalleCobranza}
        onCancel={() => setDetalleCobranza(null)}
        footer={null}
        width={400}
      >
        {detalleCobranza && (
          <Descriptions column={1} bordered size="small" style={{ marginTop: 12 }}>
            <Descriptions.Item label="Fecha">
              {dayjs(detalleCobranza.FECHA).format('DD/MM/YYYY HH:mm')}
            </Descriptions.Item>
            <Descriptions.Item label="Concepto">
              {detalleCobranza.CONCEPTO || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Efectivo">
              {fmtMoney(detalleCobranza.EFECTIVO)}
            </Descriptions.Item>
            <Descriptions.Item label="Digital">
              {fmtMoney(detalleCobranza.DIGITAL)}
            </Descriptions.Item>
            <Descriptions.Item label="Cheques">
              {fmtMoney(detalleCobranza.CHEQUES)}
            </Descriptions.Item>
            <Descriptions.Item label="Total">
              <Text strong style={{ fontSize: 15 }}>{fmtMoney(detalleCobranza.TOTAL)}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="Usuario">
              {detalleCobranza.USUARIO}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* Cobranza Modal */}
      {selected && (
        <NuevaCobranzaModal
          open={cobranzaModalOpen}
          ctaCorrienteId={selected.CTA_CORRIENTE_ID}
          clienteId={selected.CLIENTE_ID}
          clienteNombre={selected.NOMBRE || ''}
          pagoId={editPagoId}
          onSuccess={handleCobranzaSuccess}
          onCancel={() => {
            setCobranzaModalOpen(false);
            setEditPagoId(null);
          }}
        />
      )}
    </div>
  );
}
