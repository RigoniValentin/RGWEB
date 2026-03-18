import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Card, Row, Col,
  Statistic, Button, Input, InputNumber, Popconfirm, message,
  Modal, Form, Select, Switch, Tabs, Tooltip,
} from 'antd';
import {
  ArrowUpOutlined, ArrowDownOutlined,
  PlusOutlined, DeleteOutlined, ReloadOutlined, SwapOutlined, EyeOutlined,
} from '@ant-design/icons';
import { cajaCentralApi } from '../services/cajaCentral.api';
import { cajaApi } from '../services/caja.api';
import { catalogApi } from '../services/catalog.api';
import { salesApi } from '../services/sales.api';
import { useAuthStore } from '../store/authStore';
import { DateFilterPopover, getPresetRange, type DatePreset } from '../components/DateFilterPopover';
import { PuntoVentaFilter } from '../components/PuntoVentaFilter';
import { FondoCambioModal } from '../components/FondoCambioModal';
import { fmtMoney, fmtMoneyAbs, statFormatter } from '../utils/format';
import { useTabStore } from '../store/tabStore';
import type { MovimientoCaja, CajaCentralTotales, DesgloseMetodo, MetodoPago } from '../types';

const { Title, Text } = Typography;

export function CajaCentralPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { openTab } = useTabStore();
  const { puntoVentaActivo, puntosVenta } = useAuthStore();

  // ── State ──────────────────────────────────────
  const [datePreset, setDatePreset] = useState<DatePreset>('mes');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(() => getPresetRange('mes')[0]);
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(() => getPresetRange('mes')[1]);
  const [balanceHistorico, setBalanceHistorico] = useState(false);
  const [activeTab, setActiveTab] = useState('ingresos');
  const [nuevoModalOpen, setNuevoModalOpen] = useState(false);
  const [fondoModalOpen, setFondoModalOpen] = useState(false);
  const [nuevoTipo, setNuevoTipo] = useState<'INGRESO' | 'EGRESO'>('INGRESO');
  const [nuevoDesc, setNuevoDesc] = useState('');
  const [nuevoMontosPorMetodo, setNuevoMontosPorMetodo] = useState<Record<number, number>>({});
  const [nuevoCheques, setNuevoCheques] = useState<number>(0);
  const [nuevoCtaCte, setNuevoCtaCte] = useState<number>(0);
  const [nuevoPvId, setNuevoPvId] = useState<number | undefined>(() => puntosVenta.length === 1 ? puntosVenta[0]?.PUNTO_VENTA_ID : puntoVentaActivo ?? undefined);
  const [cajaIdFilter, setCajaIdFilter] = useState<string>('');
  const [pvFilter, setPvFilter] = useState<number | undefined>(() => puntoVentaActivo ?? undefined);
  const [desgloseModalOpen, setDesgloseModalOpen] = useState(false);
  const [desgloseData, setDesgloseData] = useState<DesgloseMetodo[]>([]);

  const pvIdsParam = pvFilter ? String(pvFilter) : undefined;

  // ── All puntos de venta (for selectors) ────
  const { data: allPuntosVenta } = useQuery({
    queryKey: ['catalog-puntos-venta'],
    queryFn: () => catalogApi.getPuntosVenta(),
    staleTime: 5 * 60 * 1000,
  });

  // ── Queries ────────────────────────────────────
  const filterParams = {
    fechaDesde,
    fechaHasta,
    puntoVentaIds: pvIdsParam,
    cajaId: cajaIdFilter ? Number(cajaIdFilter) : undefined,
  };

  const { data: movimientos, isLoading } = useQuery({
    queryKey: ['caja-central-mov', filterParams],
    queryFn: () => cajaCentralApi.getMovimientos(filterParams),
  });

  const { data: totales } = useQuery({
    queryKey: ['caja-central-totales', fechaDesde, fechaHasta, pvIdsParam],
    queryFn: () => cajaCentralApi.getTotales({ fechaDesde, fechaHasta, puntoVentaIds: pvIdsParam }),
    enabled: !balanceHistorico,
  });

  const { data: totalesHistoricos } = useQuery({
    queryKey: ['caja-central-historico', pvIdsParam],
    queryFn: () => cajaCentralApi.getBalanceHistorico(pvIdsParam),
    enabled: balanceHistorico,
  });

  const { data: fondoData } = useQuery({
    queryKey: ['caja-central-fondo', pvIdsParam],
    queryFn: () => cajaCentralApi.getFondoCambioSaldo(pvIdsParam),
  });

  const displayTotales: CajaCentralTotales = balanceHistorico
    ? (totalesHistoricos || { totalIngresos: 0, totalEgresos: 0, balance: 0, efectivo: 0, digital: 0, cheques: 0, ctaCte: 0 })
    : (totales || { totalIngresos: 0, totalEgresos: 0, balance: 0, efectivo: 0, digital: 0, cheques: 0, ctaCte: 0 });

  // ── Mutations ──────────────────────────────────
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['caja-central-mov'] });
    queryClient.invalidateQueries({ queryKey: ['caja-central-totales'] });
    queryClient.invalidateQueries({ queryKey: ['caja-central-historico'] });
    queryClient.invalidateQueries({ queryKey: ['caja-central-fondo'] });
    queryClient.invalidateQueries({ queryKey: ['fc-modal'] });
  };

  const crearMutation = useMutation({
    mutationFn: () => {
      const metodos_pago = Object.entries(nuevoMontosPorMetodo)
        .filter(([, m]) => m > 0)
        .map(([id, m]) => ({ METODO_PAGO_ID: Number(id), MONTO: m }));
      return cajaCentralApi.crearMovimiento({
        tipo: nuevoTipo,
        descripcion: nuevoDesc,
        cheques: nuevoCheques,
        ctaCte: nuevoCtaCte,
        puntoVentaId: nuevoPvId,
        metodos_pago: metodos_pago.length > 0 ? metodos_pago : undefined,
      });
    },
    onSuccess: () => {
      message.success('Movimiento registrado');
      setNuevoModalOpen(false);
      resetNuevoForm();
      invalidateAll();
    },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error al registrar'),
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: number) => cajaCentralApi.eliminarMovimiento(id),
    onSuccess: () => {
      message.success('Movimiento eliminado');
      invalidateAll();
    },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error al eliminar'),
  });

  const resetNuevoForm = () => {
    setNuevoDesc('');
    setNuevoMontosPorMetodo({});
    setNuevoCheques(0);
    setNuevoCtaCte(0);
    setNuevoPvId(puntosVenta.length === 1 ? puntosVenta[0]?.PUNTO_VENTA_ID : puntoVentaActivo ?? undefined);
  };

  // ── Active payment methods query ─────────────
  const { data: activePaymentMethods = [] } = useQuery<MetodoPago[]>({
    queryKey: ['sales-active-payment-methods'],
    queryFn: () => salesApi.getActivePaymentMethods(),
    staleTime: 5 * 60 * 1000,
  });

  const orderedPaymentMethods = [...activePaymentMethods].sort((a, b) => {
    const rank = (m: MetodoPago) => {
      if (m.CATEGORIA === 'EFECTIVO' && m.POR_DEFECTO) return 0;
      if (m.CATEGORIA === 'EFECTIVO') return 1;
      return 2;
    };
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.NOMBRE.localeCompare(b.NOMBRE, 'es');
  });

  const nuevoMetodosTotal = Object.values(nuevoMontosPorMetodo).reduce((s, v) => s + (v || 0), 0);
  const nuevoTotal = nuevoMetodosTotal + nuevoCheques + nuevoCtaCte;

  // ── Movement columns ───────────────────────────
  const movColumns = [
    { title: 'ID', dataIndex: 'ID', key: 'id', width: 70,align: 'center' as const },
    {
      title: '', dataIndex: 'TIPO_ENTIDAD', key: 'manual', width: 55, align: 'center' as const,
      render: (v: string, record: MovimientoCaja) =>
        v === 'TRANSFERENCIA_FC'
          ? <Tooltip title="Transferencia Fondo de Cambio"><Tag color="cyan" style={{ margin: 0 }}>FC</Tag></Tooltip>
          : record.ES_MANUAL
            ? <Tooltip title="Movimiento manual"><Tag color="gold" style={{ margin: 0 }}>M</Tag></Tooltip>
            : <Tooltip title="Autogenerado por el sistema"><Tag style={{ margin: 0 }}>A</Tag></Tooltip>,
    },
    {
      title: 'Caja', dataIndex: 'CAJA_ID', key: 'caja', width: 100,align: 'center' as const ,
      render: (v: number | null) => v ? `#${v}` : '-',
    },
    {
      title: 'Fecha', dataIndex: 'FECHA', key: 'date', width: 160, align: 'center' as const,
      render: (v: string) => new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
    },
    { title: 'Movimiento', dataIndex: 'MOVIMIENTO', key: 'mov', ellipsis: true },
    { title: 'Usuario', dataIndex: 'USUARIO_NOMBRE', key: 'user', width: 120, ellipsis: true, align: 'center' as const },
    {
      title: 'Cheques', dataIndex: 'CHEQUES', key: 'cheques', width: 100, align: 'right' as const,
      render: (v: number) => v !== 0 ? fmtMoneyAbs(v) : '-',
    },
    {
      title: 'Cta. Cte', dataIndex: 'CTA_CTE', key: 'ctaCte', width: 100, align: 'right' as const,
      render: (v: number) => v !== 0 ? fmtMoneyAbs(v) : '-',
    },
    {
      title: 'Total', dataIndex: 'TOTAL', key: 'total', width: 160, align: 'center' as const,
      render: (v: number, record: MovimientoCaja) => {
        const showDesglose = record.CAJA_ID || record.ES_MANUAL;
        if (showDesglose) {
          return (
            <Text
              strong
              style={{ cursor: 'pointer'}}
              onClick={() => {
                const promise = record.CAJA_ID
                  ? cajaApi.getDesgloseMetodos(record.CAJA_ID)
                  : cajaCentralApi.getDesgloseMovimiento(record.ID);
                promise.then(data => {
                  setDesgloseData(data);
                  setDesgloseModalOpen(true);
                });
              }}
            >
              {fmtMoneyAbs(v)} ▸
            </Text>
          );
        }
        return <Text strong>{fmtMoneyAbs(v)}</Text>;
      },
    },
    {
      title: '', key: 'actions', width: 60, align: 'center' as const,
      render: (_: unknown, record: MovimientoCaja) => (
        <Space size={4}>
          {record.TIPO_ENTIDAD === 'CIERRE_CAJA' && record.CAJA_ID && (
            <Tooltip title={`Ver Caja #${record.CAJA_ID}`}>
              <EyeOutlined
                style={{ cursor: 'pointer', color: '#EABD23', fontSize: 16 }}
                onClick={() => {
                  openTab({ key: '/cashregisters', label: 'Cajas', closable: true });
                  navigate('/cashregisters', { state: { openCajaId: record.CAJA_ID } });
                }}
              />
            </Tooltip>
          )}
          {record.ES_MANUAL && record.TIPO_ENTIDAD !== 'TRANSFERENCIA_FC' && (
            <Popconfirm
              title="¿Eliminar este movimiento manual?"
              onConfirm={() => eliminarMutation.mutate(record.ID)}
              okText="Sí" cancelText="No" okButtonProps={{ danger: true }}
            >
              <DeleteOutlined style={{ cursor: 'pointer', color: '#ff4d4f' }} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-enter">
      {/* ── Header ─────────────────────────────── */}
      <div className="page-header">
        <Title level={3}>Caja Central</Title>
        <Space wrap>
          <DateFilterPopover
            preset={datePreset}
            fechaDesde={fechaDesde}
            fechaHasta={fechaHasta}
            onPresetChange={(p, d, h) => { setDatePreset(p); setFechaDesde(d); setFechaHasta(h); }}
            onRangeChange={(d, h) => { setDatePreset(undefined as any); setFechaDesde(d); setFechaHasta(h); }}
            disabled={balanceHistorico}
          />
          <Input
            placeholder="Caja ID"
            style={{ width: 100 }}
            value={cajaIdFilter}
            onChange={e => setCajaIdFilter(e.target.value.replace(/\D/g, ''))}
            allowClear
          />
          <PuntoVentaFilter value={pvFilter} onChange={setPvFilter} overridePuntosVenta={allPuntosVenta} />
          <Space size={4}>
            <Text style={{ fontSize: 12 }}>Histórico</Text>
            <Switch
              checked={balanceHistorico}
              onChange={v => setBalanceHistorico(v)}
              size="small"
            />
          </Space>
          <Button
            type="primary"
            className="btn-gold"
            icon={<PlusOutlined />}
            onClick={() => setNuevoModalOpen(true)}
          >
            Nuevo Movimiento
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => invalidateAll()} />
        </Space>
      </div>

      {/* ── Totals cards ───────────────────────── */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Ingresos"
              value={displayTotales.totalIngresos}
              formatter={statFormatter} prefix="$"
              valueStyle={{ color: '#52c41a', fontSize: 16 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Egresos"
              value={displayTotales.totalEgresos}
              formatter={statFormatter} prefix="$"
              valueStyle={{ color: '#ff4d4f', fontSize: 16 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={4}>
          <Card size="small" className="rg-card">
            <Statistic
              title={balanceHistorico ? 'Balance Histórico' : 'Balance'}
              value={displayTotales.balance}
              formatter={statFormatter} prefix="$"
              valueStyle={{ color: displayTotales.balance >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 16, fontWeight: 'bold' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" className="rg-card"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              cajaCentralApi.getDesgloseMetodos({
                fechaDesde, fechaHasta,
                pvIds: pvIdsParam,
              }).then(data => {
                setDesgloseData(data);
                setDesgloseModalOpen(true);
              });
            }}
          >
            <Statistic title="Total ▸" value={(displayTotales.efectivo || 0) + (displayTotales.digital || 0)} formatter={statFormatter} prefix="$" valueStyle={{ fontSize: 14, color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" className="rg-card">
            <Statistic title="Cheques" value={displayTotales.cheques} formatter={statFormatter} prefix="$" valueStyle={{ fontSize: 14 }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Fondo Cambio"
              value={fondoData?.saldo ?? 0}
              formatter={statFormatter} prefix="$"
              valueStyle={{ color: '#EABD23', fontSize: 14 }}
            />
            <Button
              size="small"
              icon={<SwapOutlined />}
              onClick={() => setFondoModalOpen(true)}
              style={{ marginTop: 4 }}
            >
              Transferir
            </Button>
          </Card>
        </Col>
      </Row>

      {/* ── Tabs: Ingresos / Egresos ──────────── */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'ingresos',
            label: (
              <span>
                <ArrowUpOutlined style={{ color: '#52c41a' }} /> Ingresos
                {movimientos?.ingresos && <Tag color="green" style={{ marginLeft: 6 }}>{movimientos.ingresos.length}</Tag>}
              </span>
            ),
            children: (
              <Table
                className="rg-table"
                columns={movColumns}
                dataSource={movimientos?.ingresos}
                rowKey="ID"
                loading={isLoading}
                size="small"
                pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '25', '50', '100'], showTotal: t => `${t} movimientos` }}
                scroll={{ x: 1100 }}
              />
            ),
          },
          {
            key: 'egresos',
            label: (
              <span>
                <ArrowDownOutlined style={{ color: '#ff4d4f' }} /> Egresos
                {movimientos?.egresos && <Tag color="red" style={{ marginLeft: 6 }}>{movimientos.egresos.length}</Tag>}
              </span>
            ),
            children: (
              <Table
                className="rg-table"
                columns={movColumns}
                dataSource={movimientos?.egresos}
                rowKey="ID"
                loading={isLoading}
                size="small"
                pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '25', '50', '100'], showTotal: t => `${t} movimientos` }}
                scroll={{ x: 1100 }}
              />
            ),
          },
        ]}
      />

      {/* ── Nuevo Movimiento Modal ────────────── */}
      <Modal
        title="Nuevo Movimiento Manual"
        open={nuevoModalOpen}
        onCancel={() => { setNuevoModalOpen(false); resetNuevoForm(); }}
        onOk={() => crearMutation.mutate()}
        confirmLoading={crearMutation.isPending}
        okText="Registrar"
        okButtonProps={{ className: nuevoTipo === 'INGRESO' ? 'btn-gold' : undefined, danger: nuevoTipo === 'EGRESO', disabled: !nuevoDesc.trim() || nuevoTotal <= 0 || !nuevoPvId }}
        width={500}
        className="rg-modal"
      >
        <Form layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Tipo">
                <Select
                  value={nuevoTipo}
                  onChange={v => setNuevoTipo(v)}
                  options={[
                    { value: 'INGRESO', label: '↑ Ingreso' },
                    { value: 'EGRESO', label: '↓ Egreso' },
                  ]}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Punto de Venta" required>
                <Select
                  value={nuevoPvId}
                  onChange={v => setNuevoPvId(v)}
                  placeholder="Seleccionar..."
                  options={(allPuntosVenta ?? puntosVenta).map(pv => ({ value: pv.PUNTO_VENTA_ID, label: pv.NOMBRE }))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Descripción" required>
            <Input
              value={nuevoDesc}
              onChange={e => setNuevoDesc(e.target.value)}
              placeholder="Describe el movimiento..."
              autoFocus
            />
          </Form.Item>

          {/* ── Payment methods ── */}
          {orderedPaymentMethods.length > 0 && (
            <>
              <div style={{ marginBottom: 4 }}>
                <Text strong style={{ fontSize: 13 }}>Métodos de pago</Text>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
                {orderedPaymentMethods.map(mp => {
                  const monto = nuevoMontosPorMetodo[mp.METODO_PAGO_ID] || 0;
                  const isActive = monto > 0;
                  return (
                    <div
                      key={mp.METODO_PAGO_ID}
                      style={{
                        border: `2px solid ${isActive ? '#EABD23' : '#d9d9d9'}`,
                        borderRadius: 8,
                        padding: '8px 10px',
                        background: isActive ? 'rgba(234,189,35,0.06)' : '#fafafa',
                        transition: 'all 0.2s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        {mp.IMAGEN_BASE64 ? (
                          <img src={mp.IMAGEN_BASE64} alt={mp.NOMBRE} style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 3 }} />
                        ) : null}
                        <Text style={{ fontSize: 12, fontWeight: 600 }}>{mp.NOMBRE}</Text>
                      </div>
                      <InputNumber
                        size="small"
                        style={{ width: '100%' }}
                        min={0}
                        precision={2}
                        prefix="$"
                        value={monto || undefined}
                        placeholder="0.00"
                        onChange={v => setNuevoMontosPorMetodo(prev => ({ ...prev, [mp.METODO_PAGO_ID]: v ?? 0 }))}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Cheques">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="$"
                  value={nuevoCheques} onChange={v => setNuevoCheques(v ?? 0)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Cta. Corriente">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="$"
                  value={nuevoCtaCte} onChange={v => setNuevoCtaCte(v ?? 0)} />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ textAlign: 'right', borderTop: '2px solid #EABD23', paddingTop: 8 }}>
            <Text strong style={{ fontSize: 18 }}>
              Total: <span style={{ color: nuevoTipo === 'EGRESO' ? '#ff4d4f' : '#52c41a' }}>{fmtMoney(nuevoTotal)}</span>
            </Text>
          </div>
        </Form>
      </Modal>

      {/* ── Fondo de Cambio Modal ───────────── */}
      <FondoCambioModal
        open={fondoModalOpen}
        onClose={() => setFondoModalOpen(false)}
        onSuccess={() => {
          setFondoModalOpen(false);
          message.success('Transferencia realizada');
          invalidateAll();
        }}
      />
      {/* ── Desglose Métodos de Pago Modal ──── */}
      <Modal
        open={desgloseModalOpen}
        onCancel={() => setDesgloseModalOpen(false)}
        footer={<Button onClick={() => setDesgloseModalOpen(false)}>Cerrar</Button>}
        title="Desglose por método de pago"
        width={480}
        destroyOnClose
      >
        {desgloseData.length === 0 ? (
          <Text type="secondary">No hay métodos de pago registrados para este período.</Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {desgloseData.map(d => (
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
                <Text strong style={{ fontSize: 16 }}>{fmtMoney(d.TOTAL)}</Text>
              </div>
            ))}
          </div>
        )}
      </Modal>    </div>
  );
}
