import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Drawer, Descriptions, Spin,
  Button, Input, Select, InputNumber, Popconfirm, message, Card, Row, Col,
  Statistic, Modal, Form, Dropdown, Radio, Divider, Alert,
} from 'antd';
import {
  PlusOutlined, LockOutlined, UnlockOutlined, EyeOutlined,
  ArrowUpOutlined, ArrowDownOutlined,
  DeleteOutlined, ReloadOutlined, MoreOutlined, SwapOutlined,
} from '@ant-design/icons';
import { cajaApi } from '../services/caja.api';
import { useAuthStore } from '../store/authStore';
import { DateFilterPopover, getPresetRange, type DatePreset } from '../components/DateFilterPopover';
import { PuntoVentaFilter } from '../components/PuntoVentaFilter';
import { FondoCambioModal } from '../components/FondoCambioModal';
import { fmtMoney, statFormatter } from '../utils/format';
import type { Caja, CajaItem } from '../types';

const { Title, Text } = Typography;

export function CajaPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const { user, puntoVentaActivo, puntosVenta } = useAuthStore();

  // ── State ──────────────────────────────────────
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [datePreset, setDatePreset] = useState<DatePreset>('mes');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(() => getPresetRange('mes')[0]);
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(() => getPresetRange('mes')[1]);
  const [filterEstado, setFilterEstado] = useState<string | undefined>();
  const [pvFilter, setPvFilter] = useState<number | undefined>(() => puntoVentaActivo ?? undefined);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Modals
  const [abrirModalOpen, setAbrirModalOpen] = useState(false);
  const [montoApertura, setMontoApertura] = useState<number>(0);
  const [cerrarModalOpen, setCerrarModalOpen] = useState(false);
  const [cerrarCajaId, setCerrarCajaId] = useState<number | null>(null);
  const [depositoMode, setDepositoMode] = useState<'none' | 'total' | 'partial'>('none');
  const [depositoMonto, setDepositoMonto] = useState<number>(0);
  const [depositoDescripcion, setDepositoDescripcion] = useState('');
  const [ieModalOpen, setIeModalOpen] = useState(false);
  const [ieType, setIeType] = useState<'INGRESO' | 'EGRESO'>('INGRESO');
  const [ieMonto, setIeMonto] = useState<number>(0);
  const [ieDescripcion, setIeDescripcion] = useState('');
  const [fondoModalOpen, setFondoModalOpen] = useState(false);

  // ── Open caja detail from external navigation (e.g. Caja Central) ──
  useEffect(() => {
    const state = location.state as { openCajaId?: number } | null;
    if (state?.openCajaId) {
      setSelectedId(state.openCajaId);
      setDrawerOpen(true);
      // Clear state to prevent re-opening on re-render
      window.history.replaceState({}, '');
    }
  }, [location.state]);

  // ── Queries ────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['cajas', page, pageSize, fechaDesde, fechaHasta, filterEstado, pvFilter],
    queryFn: () => cajaApi.getAll({
      page, pageSize, fechaDesde, fechaHasta,
      estado: filterEstado,
      puntoVentaIds: pvFilter ? String(pvFilter) : undefined,
    }),
  });

  const { data: miCaja, refetch: refetchMiCaja } = useQuery({
    queryKey: ['mi-caja'],
    queryFn: () => cajaApi.getMiCaja(),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['caja', selectedId],
    queryFn: () => cajaApi.getById(selectedId!),
    enabled: !!selectedId,
  });

  // Caja detail for cerrar modal breakdown
  const { data: cerrarDetail, isLoading: cerrarDetailLoading } = useQuery({
    queryKey: ['caja', cerrarCajaId],
    queryFn: () => cajaApi.getById(cerrarCajaId!),
    enabled: !!cerrarCajaId && cerrarModalOpen,
  });

  // Compute breakdown from items
  const cerrarBreakdown = (() => {
    if (!cerrarDetail?.items) return null;
    let fondoInicial = 0, efectivoReal = 0, efectivoTotal = 0, totalDigital = 0, cantidadItems = 0;
    for (const item of cerrarDetail.items) {
      const ef = item.MONTO_EFECTIVO || 0;
      const dg = item.MONTO_DIGITAL || 0;
      if (item.ORIGEN_TIPO === 'FONDO_CAMBIO' && ef > 0) fondoInicial += ef;
      if (item.ORIGEN_TIPO !== 'FONDO_CAMBIO') { efectivoReal += ef; cantidadItems++; }
      efectivoTotal += ef;
      totalDigital += dg;
    }
    return { fondoInicial, efectivoReal, efectivoTotal, totalDigital, cantidadItems };
  })();

  const { data: fondoData } = useQuery({
    queryKey: ['fondo-cambio', pvFilter],
    queryFn: () => cajaApi.getFondoCambioSaldo(pvFilter || undefined),
  });

  // Fondo específico para el modal de abrir caja (usa puntoVentaActivo, no pvFilter)
  const { data: fondoApertura, refetch: refetchFondoApertura } = useQuery({
    queryKey: ['fondo-cambio-apertura', puntoVentaActivo],
    queryFn: () => cajaApi.getFondoCambioSaldo(puntoVentaActivo || undefined),
    enabled: !!puntoVentaActivo,
  });

  // ── Mutations ──────────────────────────────────
  const invalidateAll = () => {
    refetch();
    refetchMiCaja();
    queryClient.invalidateQueries({ queryKey: ['caja'] });
    queryClient.invalidateQueries({ queryKey: ['fondo-cambio'] });
    queryClient.invalidateQueries({ queryKey: ['fondo-cambio-apertura'] });
    queryClient.invalidateQueries({ queryKey: ['fc-modal'] });
  };

  const fondoDisponible = fondoApertura?.saldo ?? 0;
  const montoExcedeFondo = montoApertura > fondoDisponible;

  const abrirMutation = useMutation({
    mutationFn: () => {
      if (montoApertura > fondoDisponible) {
        return Promise.reject({ response: { data: { error: 'El monto de apertura no puede superar el fondo de cambio disponible' } } });
      }
      return cajaApi.abrir({
        MONTO_APERTURA: montoApertura,
        PUNTO_VENTA_ID: puntoVentaActivo!,
      });
    },
    onSuccess: (data) => {
      message.success(`Caja #${data.CAJA_ID} abierta exitosamente`);
      setAbrirModalOpen(false);
      setMontoApertura(0);
      invalidateAll();
    },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error al abrir caja'),
  });

  const cerrarMutation = useMutation({
    mutationFn: () => {
      const depositoFinal = depositoMode === 'total'
        ? Math.max(cerrarBreakdown?.efectivoTotal ?? 0, 0)
        : depositoMode === 'partial' ? depositoMonto : 0;
      return cajaApi.cerrar(cerrarCajaId!, {
        DEPOSITO_FONDO: depositoFinal,
        DESCRIPCION_DEPOSITO: depositoDescripcion || undefined,
      });
    },
    onSuccess: () => {
      message.success('Caja cerrada exitosamente');
      setCerrarModalOpen(false);
      setCerrarCajaId(null);
      setDepositoMode('none');
      setDepositoMonto(0);
      setDepositoDescripcion('');
      invalidateAll();
      if (drawerOpen) { queryClient.invalidateQueries({ queryKey: ['caja', selectedId] }); }
    },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error al cerrar caja'),
  });

  const ieMutation = useMutation({
    mutationFn: () => cajaApi.addIngresoEgreso(miCaja!.CAJA_ID, {
      tipo: ieType,
      monto: ieMonto,
      descripcion: ieDescripcion,
    }),
    onSuccess: () => {
      message.success(`${ieType === 'INGRESO' ? 'Ingreso' : 'Egreso'} registrado`);
      setIeModalOpen(false);
      setIeMonto(0);
      setIeDescripcion('');
      invalidateAll();
    },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error al registrar'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: ({ cajaId, itemId }: { cajaId: number; itemId: number }) =>
      cajaApi.deleteItem(cajaId, itemId),
    onSuccess: () => {
      message.success('Ítem eliminado');
      queryClient.invalidateQueries({ queryKey: ['caja', selectedId] });
      invalidateAll();
    },
    onError: (err: any) => message.error(err.response?.data?.error || 'Error al eliminar'),
  });



  const openDetail = (record: Caja) => {
    setSelectedId(record.CAJA_ID);
    setDrawerOpen(true);
  };

  const handleCerrar = (cajaId: number) => {
    setCerrarCajaId(cajaId);
    setDepositoMode('none');
    setDepositoMonto(0);
    setDepositoDescripcion('');
    setCerrarModalOpen(true);
  };

  const openIeModal = (tipo: 'INGRESO' | 'EGRESO') => {
    setIeType(tipo);
    setIeMonto(0);
    setIeDescripcion('');
    setIeModalOpen(true);
  };

  // ── Row actions ────────────────────────────────
  const getRowActions = (record: Caja) => {
    const items: any[] = [
      { key: 'detail', label: 'Ver detalle', icon: <EyeOutlined />, onClick: () => openDetail(record) },
    ];
    if (record.ESTADO === 'ACTIVA' && record.USUARIO_ID === user?.USUARIO_ID) {
      items.push(
        { key: 'cerrar', label: 'Cerrar caja', icon: <LockOutlined />, danger: true, onClick: () => handleCerrar(record.CAJA_ID) },
      );
    }
    return items;
  };

  // ── Columns ────────────────────────────────────
  const columns = [
    { title: '#', dataIndex: 'CAJA_ID', key: 'id', width: 50, align: 'center' as const,},
    {
      title: 'Apertura', dataIndex: 'FECHA_APERTURA', key: 'open', width: 100, align: 'center' as const,
      render: (v: string) => new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
    },
    {
      title: 'Cierre', dataIndex: 'FECHA_CIERRE', key: 'close', width: 100, align: 'center' as const,
      render: (v: string | null) => v ? new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '-',
    },
    { title: 'Usuario', dataIndex: 'USUARIO_NOMBRE', key: 'user', width: 100, ellipsis: true ,align: 'center' as const,},
    { title: 'Punto Venta', dataIndex: 'PUNTO_VENTA_NOMBRE', key: 'pv', width: 100, ellipsis: true , align: 'center' as const,},
    {
      title: 'M. Apertura', dataIndex: 'MONTO_APERTURA', key: 'openAmt', width: 80, align: 'right' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'M. Cierre', dataIndex: 'MONTO_CIERRE', key: 'closeAmt', width: 80, align: 'right' as const,
      render: (v: number | null) => v != null ? fmtMoney(v) : '-',
    },
    {
      title: 'Estado', dataIndex: 'ESTADO', key: 'status', width: 50, align: 'center' as const,
      render: (v: string) => <Tag color={v === 'ACTIVA' ? 'green' : 'default'}>{v}</Tag>,
    },
    {
      title: '', key: 'actions', width: 80, fixed: 'right' as const,
      render: (_: unknown, record: Caja) => (
        <Space size={4}>
          <EyeOutlined
            style={{ cursor: 'pointer', color: '#EABD23', fontSize: 16 }}
            onClick={() => openDetail(record)}
          />
          <Dropdown menu={{ items: getRowActions(record) }} trigger={['click']} placement="bottomRight">
            <MoreOutlined style={{ cursor: 'pointer', fontSize: 16, padding: 4 }} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  // ── Item columns for detail drawer ─────────────
  const itemColumns = [
    {
      title: 'Fecha', dataIndex: 'FECHA', key: 'date', width: 140, align: 'center' as const,
      render: (v: string) => new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
    },
    {
      title: 'Tipo', dataIndex: 'ORIGEN_TIPO', key: 'tipo', width: 100, align: 'center' as const,
      render: (v: string) => {
        const colorMap: Record<string, string> = { VENTA: 'green', INGRESO: 'blue', EGRESO: 'red', FONDO_CAMBIO: 'orange', ORDEN_PAGO: 'red', COMPRA: 'red' };
        const labelMap: Record<string, string> = { FONDO_CAMBIO: 'FC', ORDEN_PAGO: 'OP' };
        return <Tag color={colorMap[v] || 'default'}>{labelMap[v] || v}</Tag>;
      },
    },
    {
      title: 'Descripción', dataIndex: 'DESCRIPCION', key: 'desc', ellipsis: true,
      render: (v: string, r: any) => r.ORIGEN_TIPO === 'FONDO_CAMBIO' ? v?.replace(/Fondo de Cambio/gi, 'FC') : v,
    },
    {
      title: 'Efectivo', dataIndex: 'MONTO_EFECTIVO', key: 'cash', width: 120, align: 'center' as const,
      render: (v: number) => <Text type={v < 0 ? 'danger' : undefined}>{fmtMoney(v)}</Text>,
    },
    {
      title: 'Digital', dataIndex: 'MONTO_DIGITAL', key: 'digital', width: 120, align: 'center' as const,
      render: (v: number) => fmtMoney(v),
    },
  ];

  const pvNombre = puntosVenta.find(p => p.PUNTO_VENTA_ID === puntoVentaActivo)?.NOMBRE || '';

  return (
    <div className="page-enter">
      {/* ── Header ─────────────────────────────── */}
      <div className="page-header">
        <Title level={3}>Cajas</Title>
        <Space wrap>
          <DateFilterPopover
            preset={datePreset}
            fechaDesde={fechaDesde}
            fechaHasta={fechaHasta}
            onPresetChange={(p, d, h) => { setDatePreset(p); setFechaDesde(d); setFechaHasta(h); setPage(1); }}
            onRangeChange={(d, h) => { setDatePreset(undefined as any); setFechaDesde(d); setFechaHasta(h); setPage(1); }}
          />
          <Select
            placeholder="Estado"
            allowClear
            style={{ width: 130 }}
            value={filterEstado}
            onChange={v => { setFilterEstado(v); setPage(1); }}
            options={[
              { value: 'ACTIVA', label: 'Activa' },
              { value: 'CERRADA', label: 'Cerrada' },
            ]}
          />
          <PuntoVentaFilter value={pvFilter} onChange={(v) => { setPvFilter(v); setPage(1); }} />
          <Button icon={<ReloadOutlined />} onClick={() => invalidateAll()} />
        </Space>
      </div>

      {/* ── Quick status cards ─────────────────── */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={8}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Mi Caja"
              value={miCaja ? `#${miCaja.CAJA_ID} — ${miCaja.ESTADO}` : 'Sin caja abierta'}
              valueStyle={{ fontSize: 16, color: miCaja ? '#52c41a' : '#999' }}
              prefix={miCaja ? <UnlockOutlined /> : <LockOutlined />}
            />
            <Space style={{ marginTop: 8 }}>
              {!miCaja ? (
                <Button
                  type="primary"
                  className="btn-gold"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => { refetchFondoApertura(); setAbrirModalOpen(true); }}
                  disabled={!puntoVentaActivo}
                >
                  Abrir Caja
                </Button>
              ) : (
                <>
                  <Button
                    size="small"
                    icon={<ArrowUpOutlined />}
                    onClick={() => openIeModal('INGRESO')}
                  >
                    Ingreso
                  </Button>
                  <Button
                    size="small"
                    icon={<ArrowDownOutlined />}
                    danger
                    onClick={() => openIeModal('EGRESO')}
                  >
                    Egreso
                  </Button>
                  <Button
                    size="small"
                    icon={<LockOutlined />}
                    danger
                    onClick={() => handleCerrar(miCaja.CAJA_ID)}
                  >
                    Cerrar
                  </Button>
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => openDetail(miCaja)}
                  >
                    Ver
                  </Button>
                </>
              )}
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Fondo de Cambio"
              value={fondoData?.saldo ?? 0}
              precision={2}
              prefix="$"
              valueStyle={{ color: (fondoData?.saldo ?? 0) > 0 ? '#52c41a' : (fondoData?.saldo ?? 0) < 0 ? '#ff4d4f' : '#999' }}
            />
            <Space style={{ marginTop: 8 }}>
              <Button
                size="small"
                icon={<SwapOutlined />}
                onClick={() => setFondoModalOpen(true)}
              >
                Transferir
              </Button>
              <Text type="secondary" style={{ fontSize: 12 }}>{pvNombre}</Text>
            </Space>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Cajas Activas"
              value={data?.data?.filter(c => c.ESTADO === 'ACTIVA').length ?? 0}
              prefix={<UnlockOutlined />}
              valueStyle={{ color: '#EABD23' }}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Table ──────────────────────────────── */}
      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="CAJA_ID"
        loading={isLoading}
        pagination={{
          current: page, pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          showTotal: (total) => `Total: ${total} cajas`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 900 }}
        onRow={(record) => ({
          onDoubleClick: () => openDetail(record),
        })}
      />

      {/* ── Detail Drawer ─────────────────────── */}
      <Drawer
        title={`Caja #${selectedId}`}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={900}
        className="rg-drawer"
        extra={
          detail && detail.ESTADO === 'ACTIVA' && detail.USUARIO_ID === user?.USUARIO_ID && (
            <Space>
              <Button size="small" icon={<ArrowUpOutlined />} onClick={() => { openIeModal('INGRESO'); }}>
                Ingreso
              </Button>
              <Button size="small" icon={<ArrowDownOutlined />} danger onClick={() => { openIeModal('EGRESO'); }}>
                Egreso
              </Button>
              <Button size="small" icon={<LockOutlined />} danger onClick={() => handleCerrar(detail.CAJA_ID)}>
                Cerrar
              </Button>
            </Space>
          )
        }
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : detail && (
          <>
            <Descriptions column={2} bordered size="small" style={{ marginBottom: 20 }}>
              <Descriptions.Item label="Estado">
                <Tag color={detail.ESTADO === 'ACTIVA' ? 'green' : 'default'}>{detail.ESTADO}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Usuario">{detail.USUARIO_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Punto de Venta">{detail.PUNTO_VENTA_NOMBRE || '-'}</Descriptions.Item>
              <Descriptions.Item label="Apertura">
                {new Date(detail.FECHA_APERTURA).toLocaleString('es-AR')}
              </Descriptions.Item>
              {detail.FECHA_CIERRE && (
                <Descriptions.Item label="Cierre">
                  {new Date(detail.FECHA_CIERRE).toLocaleString('es-AR')}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Monto Apertura">
                <Text strong>{fmtMoney(detail.MONTO_APERTURA)}</Text>
              </Descriptions.Item>
              {detail.MONTO_CIERRE != null && (
                <Descriptions.Item label="Monto Cierre">
                  <Text strong>{fmtMoney(detail.MONTO_CIERRE)}</Text>
                </Descriptions.Item>
              )}
              {detail.OBSERVACIONES && (
                <Descriptions.Item label="Observaciones" span={2}>{detail.OBSERVACIONES}</Descriptions.Item>
              )}
            </Descriptions>

            {/* Totals summary */}
            {detail.totales && (
              <Row gutter={12} style={{ marginBottom: 16 }}>
                <Col span={6}>
                  <Statistic title="Ingresos" value={detail.totales.ingresos} formatter={statFormatter} prefix="$"
                    valueStyle={{ color: '#52c41a', fontSize: 16 }} />
                </Col>
                <Col span={6}>
                  <Statistic title="Egresos" value={detail.totales.egresos} formatter={statFormatter} prefix="$"
                    valueStyle={{ color: '#ff4d4f', fontSize: 16 }} />
                </Col>
                <Col span={6}>
                  <Statistic title="Efectivo" value={detail.totales.efectivo} formatter={statFormatter} prefix="$"
                    valueStyle={{ fontSize: 16 }} />
                </Col>
                <Col span={6}>
                  <Statistic title="Digital" value={detail.totales.digital} formatter={statFormatter} prefix="$"
                    valueStyle={{ fontSize: 16 }} />
                </Col>
              </Row>
            )}

            {/* Items table */}
            {detail.items && detail.items.length > 0 && (
              <div>
                <Title level={5} style={{ marginBottom: 12 }}>Movimientos de la caja</Title>
                <Table
                  className="rg-table"
                  dataSource={detail.items}
                  rowKey="ITEM_ID"
                  size="small"
                  pagination={false}
                  scroll={{ y: 300 }}
                  columns={[
                    ...itemColumns,
                    ...(detail.ESTADO === 'ACTIVA' ? [{
                      title: '', key: 'del', width: 50,
                      render: (_: unknown, record: CajaItem) =>
                        (record.ORIGEN_TIPO === 'INGRESO' || record.ORIGEN_TIPO === 'EGRESO') ? (
                          <Popconfirm
                            title="¿Eliminar este movimiento?"
                            onConfirm={() => deleteItemMutation.mutate({ cajaId: detail.CAJA_ID, itemId: record.ITEM_ID })}
                            okText="Sí" cancelText="No" okButtonProps={{ danger: true }}
                          >
                            <DeleteOutlined style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                          </Popconfirm>
                        ) : null,
                    }] : []),
                  ]}
                />
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* ── Abrir Caja Modal ──────────────────── */}
      <Modal
        title="Abrir Caja"
        open={abrirModalOpen}
        onCancel={() => setAbrirModalOpen(false)}
        onOk={() => abrirMutation.mutate()}
        confirmLoading={abrirMutation.isPending}
        okText="Abrir Caja"
        okButtonProps={{ className: 'btn-gold', disabled: montoExcedeFondo }}
        className="rg-modal"
      >
        <div style={{ marginBottom: 16 }}>
          <Text>Punto de venta: <Text strong>{pvNombre}</Text></Text>
        </div>
        <div style={{ marginBottom: 16 }}>
          <Text>Fondo de cambio disponible: <Text strong style={{ color: fondoDisponible > 0 ? '#52c41a' : '#ff4d4f' }}>{fmtMoney(fondoDisponible)}</Text></Text>
        </div>
        <Form layout="vertical">
          <Form.Item
            label="Monto de apertura"
            validateStatus={montoExcedeFondo ? 'error' : undefined}
            help={montoExcedeFondo ? `El monto no puede superar el fondo disponible (${fmtMoney(fondoDisponible)})` : undefined}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              prefix="$"
              value={montoApertura}
              onChange={v => setMontoApertura(v ?? 0)}
              status={montoExcedeFondo ? 'error' : undefined}
              autoFocus
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Cerrar Caja Modal ─────────────────── */}
      <Modal
        title={`Cerrar Caja #${cerrarCajaId}`}
        open={cerrarModalOpen}
        onCancel={() => { setCerrarModalOpen(false); setCerrarCajaId(null); }}
        onOk={() => cerrarMutation.mutate()}
        confirmLoading={cerrarMutation.isPending}
        okText="Cerrar Caja"
        okButtonProps={{ danger: true, disabled: cerrarDetailLoading || !cerrarBreakdown }}
        width={480}
        className="rg-modal"
      >
        {cerrarDetailLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : cerrarBreakdown && (
          <>
            {/* Breakdown */}
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Cambio inicial">
                <Text strong>{fmtMoney(cerrarBreakdown.fondoInicial)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Efectivo real (ventas - egresos)">
                <Text strong style={{ color: cerrarBreakdown.efectivoReal >= 0 ? '#52c41a' : '#ff4d4f' }}>
                  {fmtMoney(cerrarBreakdown.efectivoReal)}
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Total efectivo disponible">
                <Text strong style={{ fontSize: 15 }}>{fmtMoney(cerrarBreakdown.efectivoTotal)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Digital">
                <Text>{fmtMoney(cerrarBreakdown.totalDigital)}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Movimientos">
                <Text>{cerrarBreakdown.cantidadItems}</Text>
              </Descriptions.Item>
            </Descriptions>

            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="Al cerrar, se registrará en Caja Central el ingreso real (sin incluir el fondo de cambio)."
            />

            {/* Deposit to fondo */}
            {cerrarBreakdown.efectivoTotal > 0 && (
              <>
                <Divider orientation="left" style={{ margin: '12px 0' }}>Depósito al Fondo de Cambio</Divider>
                <Radio.Group
                  value={depositoMode}
                  onChange={e => {
                    setDepositoMode(e.target.value);
                    if (e.target.value === 'total') setDepositoMonto(cerrarBreakdown.efectivoTotal);
                    if (e.target.value === 'none') setDepositoMonto(0);
                  }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}
                >
                  <Radio value="none">No depositar (el efectivo queda en Caja Central)</Radio>
                  <Radio value="total">Depositar total ({fmtMoney(cerrarBreakdown.efectivoTotal)})</Radio>
                  <Radio value="partial">Depositar parcial</Radio>
                </Radio.Group>

                {depositoMode === 'partial' && (
                  <Form layout="vertical" style={{ marginBottom: 8 }}>
                    <Form.Item label="Monto a depositar" style={{ marginBottom: 8 }}>
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0.01}
                        max={cerrarBreakdown.efectivoTotal}
                        precision={2}
                        prefix="$"
                        value={depositoMonto}
                        onChange={v => setDepositoMonto(v ?? 0)}
                        autoFocus
                      />
                    </Form.Item>
                  </Form>
                )}

                {depositoMode !== 'none' && (
                  <Form layout="vertical">
                    <Form.Item label="Descripción (opcional)" style={{ marginBottom: 0 }}>
                      <Input
                        value={depositoDescripcion}
                        onChange={e => setDepositoDescripcion(e.target.value)}
                        placeholder="Concepto del depósito..."
                      />
                    </Form.Item>
                  </Form>
                )}
              </>
            )}
          </>
        )}
      </Modal>

      {/* ── Ingreso/Egreso Modal ──────────────── */}
      <Modal
        title={ieType === 'INGRESO' ? 'Nuevo Ingreso' : 'Nuevo Egreso'}
        open={ieModalOpen}
        onCancel={() => setIeModalOpen(false)}
        onOk={() => ieMutation.mutate()}
        confirmLoading={ieMutation.isPending}
        okText="Registrar"
        okButtonProps={{ className: ieType === 'INGRESO' ? 'btn-gold' : undefined, danger: ieType === 'EGRESO', disabled: !ieMonto || !ieDescripcion.trim() }}
        className="rg-modal"
      >
        <Form layout="vertical">
          <Form.Item label="Descripción / Motivo" required>
            <Input
              value={ieDescripcion}
              onChange={e => setIeDescripcion(e.target.value)}
              placeholder="Describe el motivo..."
              autoFocus
            />
          </Form.Item>
          <Form.Item label="Monto" required>
            <InputNumber
              style={{ width: '100%' }}
              min={0.01}
              precision={2}
              prefix="$"
              value={ieMonto}
              onChange={v => setIeMonto(v ?? 0)}
            />
          </Form.Item>
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
        preselectedCajaId={miCaja?.CAJA_ID}
      />
    </div>
  );
}
