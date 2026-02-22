import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Card, Row, Col,
  Statistic, Button, Input, InputNumber, Popconfirm, message,
  Modal, Form, Select, Switch, Tabs, Tooltip,
} from 'antd';
import {
  ArrowUpOutlined, ArrowDownOutlined,
  PlusOutlined, DeleteOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { cajaCentralApi } from '../services/cajaCentral.api';
import { useAuthStore } from '../store/authStore';
import { DateFilterPopover, getPresetRange, type DatePreset } from '../components/DateFilterPopover';
import { fmtMoney, fmtMoneyAbs, statFormatter } from '../utils/format';
import type { MovimientoCaja, CajaCentralTotales } from '../types';

const { Title, Text } = Typography;

export function CajaCentralPage() {
  const queryClient = useQueryClient();
  const { puntoVentaActivo } = useAuthStore();

  // ── State ──────────────────────────────────────
  const [datePreset, setDatePreset] = useState<DatePreset>('mes');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(() => getPresetRange('mes')[0]);
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(() => getPresetRange('mes')[1]);
  const [balanceHistorico, setBalanceHistorico] = useState(false);
  const [activeTab, setActiveTab] = useState('ingresos');
  const [nuevoModalOpen, setNuevoModalOpen] = useState(false);
  const [nuevoTipo, setNuevoTipo] = useState<'INGRESO' | 'EGRESO'>('INGRESO');
  const [nuevoDesc, setNuevoDesc] = useState('');
  const [nuevoEfectivo, setNuevoEfectivo] = useState<number>(0);
  const [nuevoDigital, setNuevoDigital] = useState<number>(0);
  const [nuevoCheques, setNuevoCheques] = useState<number>(0);
  const [nuevoCtaCte, setNuevoCtaCte] = useState<number>(0);
  const [cajaIdFilter, setCajaIdFilter] = useState<string>('');

  const pvIdsParam = puntoVentaActivo ? String(puntoVentaActivo) : undefined;

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
  };

  const crearMutation = useMutation({
    mutationFn: () => cajaCentralApi.crearMovimiento({
      tipo: nuevoTipo,
      descripcion: nuevoDesc,
      efectivo: nuevoEfectivo,
      digital: nuevoDigital,
      cheques: nuevoCheques,
      ctaCte: nuevoCtaCte,
      puntoVentaId: puntoVentaActivo || undefined,
    }),
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
    setNuevoEfectivo(0);
    setNuevoDigital(0);
    setNuevoCheques(0);
    setNuevoCtaCte(0);
  };



  const nuevoTotal = nuevoEfectivo + nuevoDigital + nuevoCheques + nuevoCtaCte;

  // ── Movement columns ───────────────────────────
  const movColumns = [
    { title: 'ID', dataIndex: 'ID', key: 'id', width: 70,align: 'center' as const },
    {
      title: '', dataIndex: 'ES_MANUAL', key: 'manual', width: 55, align: 'center' as const,
      render: (v: boolean) => v
        ? <Tooltip title="Movimiento manual"><Tag color="gold" style={{ margin: 0 }}>M</Tag></Tooltip>
        : <Tooltip title="Autogenerado por el sistema"><Tag style={{ margin: 0 }}>A</Tag></Tooltip>,
    },
    {
      title: 'Caja', dataIndex: 'CAJA_ID', key: 'caja', width: 75,align: 'center' as const ,
      render: (v: number | null) => v ? `#${v}` : '-',
    },
    {
      title: 'Fecha', dataIndex: 'FECHA', key: 'date', width: 120, align: 'center' as const,
      render: (v: string) => new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    },
    { title: 'Movimiento', dataIndex: 'MOVIMIENTO', key: 'mov', ellipsis: true },
    { title: 'Usuario', dataIndex: 'USUARIO_NOMBRE', key: 'user', width: 120, ellipsis: true, align: 'center' as const },
    {
      title: 'Efectivo', dataIndex: 'EFECTIVO', key: 'cash', width: 120, align: 'right' as const,
      render: (v: number) => fmtMoneyAbs(v),
    },
    {
      title: 'Digital', dataIndex: 'DIGITAL', key: 'digital', width: 120, align: 'right' as const,
      render: (v: number) => fmtMoneyAbs(v),
    },
    {
      title: 'Cheques', dataIndex: 'CHEQUES', key: 'cheques', width: 100, align: 'right' as const,
      render: (v: number) => v !== 0 ? fmtMoneyAbs(v) : '-',
    },
    {
      title: 'Cta. Cte', dataIndex: 'CTA_CTE', key: 'ctaCte', width: 100, align: 'right' as const,
      render: (v: number) => v !== 0 ? fmtMoneyAbs(v) : '-',
    },
    {
      title: 'Total', dataIndex: 'TOTAL', key: 'total', width: 130, align: 'right' as const,
      render: (v: number) => <Text strong>{fmtMoneyAbs(v)}</Text>,
    },
    {
      title: '', key: 'actions', width: 50,
      render: (_: unknown, record: MovimientoCaja) =>
        record.ES_MANUAL ? (
          <Popconfirm
            title="¿Eliminar este movimiento manual?"
            onConfirm={() => eliminarMutation.mutate(record.ID)}
            okText="Sí" cancelText="No" okButtonProps={{ danger: true }}
          >
            <DeleteOutlined style={{ cursor: 'pointer', color: '#ff4d4f' }} />
          </Popconfirm>
        ) : null,
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
          <Card size="small" className="rg-card">
            <Statistic title="Efectivo" value={displayTotales.efectivo} formatter={statFormatter} prefix="$" valueStyle={{ fontSize: 14 }} />
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" className="rg-card">
            <Statistic title="Digital" value={displayTotales.digital} formatter={statFormatter} prefix="$" valueStyle={{ fontSize: 14 }} />
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
        okButtonProps={{ className: nuevoTipo === 'INGRESO' ? 'btn-gold' : undefined, danger: nuevoTipo === 'EGRESO', disabled: !nuevoDesc.trim() || nuevoTotal <= 0 }}
        width={500}
      >
        <Form layout="vertical">
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
          <Form.Item label="Descripción" required>
            <Input
              value={nuevoDesc}
              onChange={e => setNuevoDesc(e.target.value)}
              placeholder="Describe el movimiento..."
              autoFocus
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Efectivo">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="$"
                  value={nuevoEfectivo} onChange={v => setNuevoEfectivo(v ?? 0)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Digital">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} prefix="$"
                  value={nuevoDigital} onChange={v => setNuevoDigital(v ?? 0)} />
              </Form.Item>
            </Col>
          </Row>
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
    </div>
  );
}
