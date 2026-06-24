import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Card, Row, Col,
  Statistic, Button, Input, InputNumber, message,
  Modal, Form, Select, Switch, Tabs, Tooltip, Descriptions, Divider,
} from 'antd';
import {
  ArrowUpOutlined, ArrowDownOutlined,
  PlusOutlined, DeleteOutlined, ReloadOutlined, SwapOutlined, EyeOutlined,
  FileProtectOutlined, QuestionCircleOutlined,
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
import type { MovimientoCaja, CajaCentralTotales, CajaCentralCierreDetalle, DesgloseMetodo, MetodoPago } from '../types';
import { ExportButtons, type ExportColumn } from '../components/ExportButtons';
import { RowContextMenu } from '../components/RowContextMenu';
import { useRowActions, type RowAction } from '../hooks/useRowActions';


const { Title, Text } = Typography;

const metodoVisual = (categoria: string) => {
  if (categoria === 'EFECTIVO') return { tag: 'green', background: 'rgba(82,196,26,0.06)', border: '#b7eb8f' };
  if (categoria === 'CHEQUES') return { tag: 'orange', background: 'rgba(250,140,22,0.07)', border: '#ffd591' };
  return { tag: 'blue', background: 'rgba(22,119,255,0.06)', border: '#91caff' };
};
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

  // '+' key shortcut → Nuevo Movimiento
  useEffect(() => {
    const handler = () => { if (useTabStore.getState().activeKey === '/cashcentral') setNuevoModalOpen(true); };
    window.addEventListener('rg:nuevo', handler);
    return () => window.removeEventListener('rg:nuevo', handler);
  }, []);
  const [fondoModalOpen, setFondoModalOpen] = useState(false);
  const [nuevoTipo, setNuevoTipo] = useState<'INGRESO' | 'EGRESO'>('INGRESO');
  const [nuevoDesc, setNuevoDesc] = useState('');
  const [nuevoMontosPorMetodo, setNuevoMontosPorMetodo] = useState<Record<number, number>>({});
  const [nuevoPvId, setNuevoPvId] = useState<number | undefined>(() => puntosVenta.length === 1 ? puntosVenta[0]?.PUNTO_VENTA_ID : puntoVentaActivo ?? undefined);
  const [cajaIdFilter, setCajaIdFilter] = useState<string>('');
  const [pvFilter, setPvFilter] = useState<number | undefined>(() => puntoVentaActivo ?? undefined);
  const [desgloseModalOpen, setDesgloseModalOpen] = useState(false);
  const [desgloseData, setDesgloseData] = useState<DesgloseMetodo[]>([]);
  const [cierreDetalleOpen, setCierreDetalleOpen] = useState(false);
  const [cierreDetalle, setCierreDetalle] = useState<CajaCentralCierreDetalle | null>(null);
  const [cierreMetodos, setCierreMetodos] = useState<DesgloseMetodo[]>([]);

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

  const emptyTotales: CajaCentralTotales = {
    totalIngresos: 0,
    totalEgresos: 0,
    balance: 0,
    efectivo: 0,
    efectivoOperativo: 0,
    ajusteFondoCambio: 0,
    totalMetodos: 0,
    diferenciaMetodosBalance: 0,
    fondoCambioSaldo: 0,
    digital: 0,
    cheques: 0,
    chequesEnCartera: 0,
    chequesEnCarteraCantidad: 0,
  };

  const displayTotales: CajaCentralTotales = balanceHistorico
    ? (totalesHistoricos || emptyTotales)
    : (totales || emptyTotales);

  const chequesEnCartera = displayTotales.chequesEnCartera ?? displayTotales.cheques ?? 0;
  const chequesEnCarteraCantidad = displayTotales.chequesEnCarteraCantidad ?? 0;
  const desgloseParams = balanceHistorico
    ? { puntoVentaIds: pvIdsParam }
    : { fechaDesde, fechaHasta, puntoVentaIds: pvIdsParam };

  const openCierreDetalle = async (cajaId: number) => {
    try {
      const [detalle, metodos] = await Promise.all([
        cajaCentralApi.getDetalleCierreCaja(cajaId),
        cajaApi.getDesgloseMetodos(cajaId),
      ]);
      setCierreDetalle(detalle);
      setCierreMetodos(metodos);
      setCierreDetalleOpen(true);
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Error al cargar el detalle de cierre');
    }
  };
  // ── Mutations ──────────────────────────────────
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['caja-central-mov'] });
    queryClient.invalidateQueries({ queryKey: ['caja-central-totales'] });
    queryClient.invalidateQueries({ queryKey: ['caja-central-historico'] });
    queryClient.invalidateQueries({ queryKey: ['caja-central-fondo'] });
    queryClient.invalidateQueries({ queryKey: ['cheques-resumen'] });
    queryClient.invalidateQueries({ queryKey: ['cheques-cartera'] });
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
        puntoVentaId: nuevoPvId,
        metodos_pago,
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
  const nuevoTotal = nuevoMetodosTotal;

  // ── Export columns (compartidos entre ingresos y egresos) ──
  const exportColumns: ExportColumn<MovimientoCaja>[] = [
    { title: 'ID', dataIndex: 'ID', align: 'center', width: 8 },
    {
      title: 'Tipo', dataIndex: 'TIPO_ENTIDAD',
      render: (v: string) => v === 'TRANSFERENCIA_FC' ? 'FC' : v === 'CIERRE_CAJA' ? 'Cierre Caja' : v,
      width: 14,
    },
    { title: 'Caja', dataIndex: 'CAJA_ID', align: 'center', render: (v: number | null) => v ? `#${v}` : '-', width: 10 },
    {
      title: 'Fecha', dataIndex: 'FECHA',
      render: (v: string) => v ? new Date(v).toLocaleString('es-AR') : '-',
      width: 22,
    },
    { title: 'Movimiento', dataIndex: 'MOVIMIENTO', width: 30 },
    { title: 'Usuario', dataIndex: 'USUARIO_NOMBRE', width: 18 },
    {
      title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, align: 'right', width: 18,
      render: (v: number, r: MovimientoCaja) => {
        const isFondoCambio = ['TRANSFERENCIA_FC', 'REINTEGRO_FONDO', 'DEPOSITO_FONDO'].includes(r.TIPO_ENTIDAD);
        return fmtMoneyAbs(isFondoCambio ? r.EFECTIVO : v);
      },
    },
  ];

  const exportMetaParts: string[] = [];
  if (balanceHistorico) exportMetaParts.push('Balance histórico');
  else if (fechaDesde && fechaHasta) exportMetaParts.push(`Período: ${fechaDesde} → ${fechaHasta}`);
  if (pvFilter) {
    const pv = allPuntosVenta?.find(p => p.PUNTO_VENTA_ID === pvFilter) ?? puntosVenta.find(p => p.PUNTO_VENTA_ID === pvFilter);
    if (pv) exportMetaParts.push(`Punto de Venta: ${pv.NOMBRE}`);
  }
  if (cajaIdFilter) exportMetaParts.push(`Caja ID: ${cajaIdFilter}`);
  const exportMeta = exportMetaParts.length > 0 ? `Filtros: ${exportMetaParts.join(' · ')}` : undefined;

  const ingresosArr = movimientos?.ingresos ?? [];
  const egresosArr = movimientos?.egresos ?? [];


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
      title: 'Total', dataIndex: 'TOTAL', key: 'total', width: 160, align: 'center' as const,
      render: (_: number, record: MovimientoCaja) => {
        const isFondoCambio = ['TRANSFERENCIA_FC', 'REINTEGRO_FONDO', 'DEPOSITO_FONDO'].includes(record.TIPO_ENTIDAD);
        const displayValue = isFondoCambio ? record.EFECTIVO : record.TOTAL;
        const showDesglose = !isFondoCambio && (record.CAJA_ID || record.ES_MANUAL || record.TIPO_ENTIDAD === 'COMPRA' || record.TIPO_ENTIDAD === 'ORDEN_PAGO' || record.TIPO_ENTIDAD === 'COBRANZA' || record.TIPO_ENTIDAD === 'NC_VENTA' || record.TIPO_ENTIDAD === 'NC_COMPRA' || record.TIPO_ENTIDAD === 'GASTO');
        if (showDesglose) {
          return (
            <Text
              strong
              style={{ cursor: 'pointer'}}
              onClick={() => {
                if (record.TIPO_ENTIDAD === 'CIERRE_CAJA' && record.CAJA_ID) {
                  openCierreDetalle(record.CAJA_ID);
                  return;
                }
                const promise = record.CAJA_ID
                  ? cajaApi.getDesgloseMetodos(record.CAJA_ID)
                  : cajaCentralApi.getDesgloseMovimiento(record.ID);
                promise.then(data => {
                  setDesgloseData(data);
                  setDesgloseModalOpen(true);
                });
              }}
            >
              {fmtMoneyAbs(displayValue)} ▸
            </Text>
          );
        }
        return <Text strong>{fmtMoneyAbs(displayValue)}</Text>;
      },
    },
  ];

  // ── Row interactions (active row + context menu) ─
  const extractNCId = (movimiento: string | undefined): number | null => {
    const m = movimiento?.match(/^NC (?:Venta|Compra)(?: [^ ]+)? #(\d+)/);
    return m ? Number(m[1]) : null;
  };

  const goToCierreCaja = (record: MovimientoCaja) => {
    if (!record.CAJA_ID) return;
    openTab({ key: '/cashregisters', label: 'Cajas', closable: true });
    navigate('/cashregisters', { state: { openCajaId: record.CAJA_ID } });
  };

  const goToNCVenta = (record: MovimientoCaja) => {
    const ncId = extractNCId(record.MOVIMIENTO);
    openTab({ key: '/nc-ventas', label: 'NC Ventas', closable: true });
    navigate('/nc-ventas', { state: { openNCId: ncId } });
  };

  const goToNCCompra = (record: MovimientoCaja) => {
    const ncId = extractNCId(record.MOVIMIENTO);
    openTab({ key: '/nc-compras', label: 'NC Compras', closable: true });
    navigate('/nc-compras', { state: { openNCId: ncId } });
  };

  const goToGasto = (record: MovimientoCaja) => {
    if (!record.ID_ENTIDAD) return;
    openTab({ key: '/expenses', label: 'Gastos y Servicios', closable: true });
    navigate('/expenses', { state: { openGastoId: record.ID_ENTIDAD } });
  };

  const goToOrdenPago = (record: MovimientoCaja) => {
    if (!record.ID_ENTIDAD) return;
    openTab({ key: '/ordenes-pago', label: 'Órdenes de Pago', closable: true });
    navigate('/ordenes-pago', { state: { openOPId: record.ID_ENTIDAD } });
  };

  const navigateFromMovimiento = (record: MovimientoCaja) => {
    switch (record.TIPO_ENTIDAD) {
      case 'CIERRE_CAJA': goToCierreCaja(record); break;
      case 'NC_VENTA': goToNCVenta(record); break;
      case 'NC_COMPRA': goToNCCompra(record); break;
      case 'GASTO': goToGasto(record); break;
      case 'ORDEN_PAGO': goToOrdenPago(record); break;
    }
  };

  const contextMenuActions = useMemo<RowAction<MovimientoCaja>[]>(() => [
    {
      key: 'view',
      label: 'Ver detalle',
      icon: <EyeOutlined />,
      disabled: (r) => !['CIERRE_CAJA', 'NC_VENTA', 'NC_COMPRA', 'GASTO', 'ORDEN_PAGO'].includes(r.TIPO_ENTIDAD)
        || (r.TIPO_ENTIDAD === 'CIERRE_CAJA' && !r.CAJA_ID)
        || ((r.TIPO_ENTIDAD === 'GASTO' || r.TIPO_ENTIDAD === 'ORDEN_PAGO') && !r.ID_ENTIDAD),
      onClick: navigateFromMovimiento,
    },
    { type: 'divider' },
    {
      key: 'delete',
      label: 'Eliminar',
      icon: <DeleteOutlined />,
      danger: true,
      disabled: (r) => !(r.ES_MANUAL && r.TIPO_ENTIDAD !== 'TRANSFERENCIA_FC'),
      onClick: (r) => {
        Modal.confirm({
          title: '¿Eliminar este movimiento manual?',
          okText: 'Sí',
          cancelText: 'No',
          okButtonProps: { danger: true },
          onOk: () => eliminarMutation.mutateAsync(r.ID),
        });
      },
    },
  ], [eliminarMutation]);

  const { onRow, rowClassName, contextMenu, contextMenuItems, closeContextMenu } = useRowActions<MovimientoCaja>({
    getRowId: (r) => r.ID,
    primaryAction: navigateFromMovimiento,
    actions: contextMenuActions,
  });

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
          <ExportButtons
            data={activeTab === 'ingresos' ? ingresosArr : egresosArr}
            showQuantitySelector
            columns={exportColumns}
            title={`Caja Central — ${activeTab === 'ingresos' ? 'Ingresos' : 'Egresos'}`}
            subtitle="Movimientos operativos"
            meta={exportMeta}
            fileName={`caja-central-${activeTab}`}
            sheetName={activeTab === 'ingresos' ? 'Ingresos' : 'Egresos'}
          />
        </Space>
      </div>

      {/* ── Totals cards ───────────────────────── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={16}>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={8}>
              <Card size="small" className="rg-card">
                <Statistic
                  title={<span>Ingresos&nbsp;<Tooltip title="Total de ingresos operativos del período. No incluye movimientos de Fondo de Cambio."><QuestionCircleOutlined style={{ color: '#8c8c8c', fontSize: 11 }} /></Tooltip></span>}
                  value={displayTotales.totalIngresos}
                  formatter={statFormatter} prefix="$"
                  valueStyle={{ color: '#52c41a', fontSize: 16 }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="rg-card">
                <Statistic
                  title={<span>Egresos&nbsp;<Tooltip title="Total de egresos operativos del período. No incluye movimientos de Fondo de Cambio."><QuestionCircleOutlined style={{ color: '#8c8c8c', fontSize: 11 }} /></Tooltip></span>}
                  value={displayTotales.totalEgresos}
                  formatter={statFormatter} prefix="$"
                  valueStyle={{ color: '#ff4d4f', fontSize: 16 }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" className="rg-card">
                <Statistic
                  title={<span>{balanceHistorico ? 'Balance Histórico' : 'Balance'}&nbsp;<Tooltip title={balanceHistorico ? 'Total acumulado del período filtrado. El desglose muestra cómo se compone por método de pago.' : 'Resultado neto del período filtrado. El desglose muestra cómo se compone por método de pago.'}><QuestionCircleOutlined style={{ color: '#8c8c8c', fontSize: 11 }} /></Tooltip></span>}
                  value={displayTotales.balance}
                  formatter={statFormatter} prefix="$"
                  valueStyle={{ color: displayTotales.balance >= 0 ? '#52c41a' : '#ff4d4f', fontSize: 16, fontWeight: 'bold' }}
                />
                <Button
                  type="link"
                  size="small"
                  style={{ paddingInline: 0, height: 'auto', marginTop: 6 }}
                  onClick={() => {
                    cajaCentralApi.getDesgloseMetodos(desgloseParams).then(data => {
                      setDesgloseData(data);
                      setDesgloseModalOpen(true);
                    });
                  }}
                >
                  Ver desglose
                </Button>
              </Card>
            </Col>
          </Row>
        </Col>
        <Col xs={24} md={8}>
          <Row gutter={[12, 12]} justify="end">
            <Col xs={24} sm={12}>
              <Card
                size="small"
                className="rg-card"
                hoverable
                onClick={() => {
                  openTab({ key: '/cheques', label: 'Cheques', closable: true });
                  navigate('/cheques');
                }}
              >
                <Statistic
                  title={<span><FileProtectOutlined /> Cheques cartera&nbsp;<Tooltip title="Importe total de cheques en estado EN_CARTERA. No afecta el Balance. Clic para ir a Cheques."><QuestionCircleOutlined style={{ color: '#8c8c8c', fontSize: 11 }} /></Tooltip></span>}
                  value={chequesEnCartera}
                  formatter={statFormatter} prefix="$"
                  valueStyle={{ color: '#fa8c16', fontSize: 14 }}
                />
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {chequesEnCarteraCantidad} cheque{chequesEnCarteraCantidad === 1 ? '' : 's'}
                </Text>
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card size="small" className="rg-card">
                <Statistic
                  title={<span>Fondo Cambio&nbsp;<Tooltip title="Efectivo apartado como fondo operativo. No forma parte del Balance ni de Métodos; se registra como movimiento interno al transferir."><QuestionCircleOutlined style={{ color: '#8c8c8c', fontSize: 11 }} /></Tooltip></span>}
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
                onRow={onRow}
                rowClassName={rowClassName}
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
                onRow={onRow}
                rowClassName={rowClassName}
                pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '25', '50', '100'], showTotal: t => `${t} movimientos` }}
                scroll={{ x: 1100 }}
              />
            ),
          },
        ]}
      />

      <RowContextMenu
        open={contextMenu !== null}
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        items={contextMenuItems}
        onClose={closeContextMenu}
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
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
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
      {/* ── Detalle Cierre de Caja ───────────── */}
      <Modal
        open={cierreDetalleOpen}
        onCancel={() => setCierreDetalleOpen(false)}
        footer={<Button onClick={() => setCierreDetalleOpen(false)}>Cerrar</Button>}
        title={cierreDetalle ? `Detalle Cierre Caja #${cierreDetalle.caja.CAJA_ID}` : 'Detalle Cierre Caja'}
        width={720}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 } }}
      >
        {cierreDetalle && (() => {
          const t = cierreDetalle.totales;
          return (
          <>
            {/* ── Identificación ── */}
            <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Usuario">{cierreDetalle.caja.USUARIO_NOMBRE || '-'}</Descriptions.Item>
              <Descriptions.Item label="Punto de Venta">{cierreDetalle.caja.PUNTO_VENTA_NOMBRE || '-'}</Descriptions.Item>
              <Descriptions.Item label="Apertura">
                {new Date(cierreDetalle.caja.FECHA_APERTURA).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
              </Descriptions.Item>
              <Descriptions.Item label="Cierre">
                {cierreDetalle.caja.FECHA_CIERRE
                  ? new Date(cierreDetalle.caja.FECHA_CIERRE).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Movimientos">{t.cantidadItems}</Descriptions.Item>
              <Descriptions.Item label="Estado">{cierreDetalle.caja.ESTADO}</Descriptions.Item>
            </Descriptions>

            {/* ── Ingresos del período ── */}
            <Divider orientation="left" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>Ingresos del período</Divider>
            <Row gutter={[16, 8]} style={{ marginBottom: 20 }}>
              <Col xs={24} sm={8}>
                <Statistic
                  title={<Text strong style={{ fontSize: 13 }}>Total ingresado</Text>}
                  value={t.totalOperativo}
                  formatter={statFormatter} prefix="$"
                  valueStyle={{ color: '#52c41a', fontSize: 20, fontWeight: 700 }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title={<Text type="secondary" style={{ fontSize: 12 }}>↳ Efectivo</Text>}
                  value={t.efectivoReal}
                  formatter={statFormatter} prefix="$"
                  valueStyle={{ fontSize: 15 }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title={<Text type="secondary" style={{ fontSize: 12 }}>↳ Digital</Text>}
                  value={t.digital}
                  formatter={statFormatter} prefix="$"
                  valueStyle={{ fontSize: 15, color: '#1677ff' }}
                />
              </Col>
            </Row>

            {/* ── Efectivo en caja al cierre ── */}
            <Divider orientation="left" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>Efectivo en caja al cierre</Divider>
            <Row gutter={[16, 8]} style={{ marginBottom: 20 }}>
              <Col xs={12} sm={8}>
                <Statistic
                  title={<Text type="secondary" style={{ fontSize: 12 }}>Fondo inicial</Text>}
                  value={t.fondoInicial}
                  formatter={statFormatter} prefix="$"
                  valueStyle={{ fontSize: 15, color: '#EABD23' }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title={<Text type="secondary" style={{ fontSize: 12 }}>+ Efectivo de ventas</Text>}
                  value={t.efectivoReal}
                  formatter={statFormatter} prefix="$"
                  valueStyle={{ fontSize: 15 }}
                />
              </Col>
              <Col xs={24} sm={8}>
                <Statistic
                  title={<Text style={{ fontSize: 12, color: '#08979c' }}>= Total físico → depositado al FC</Text>}
                  value={t.efectivoTotal}
                  formatter={statFormatter} prefix="$"
                  valueStyle={{ fontSize: 16, color: '#08979c', fontWeight: 700 }}
                />
              </Col>
            </Row>

            {/* ── Detalle por método de pago ── */}
            <Divider orientation="left" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>Detalle por método de pago</Divider>
            {cierreMetodos.length === 0 ? (
              <Text type="secondary">No hay métodos de pago registrados para esta caja.</Text>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {cierreMetodos.map(metodo => {
                  const visual = metodoVisual(metodo.CATEGORIA);
                  return (
                    <div key={metodo.METODO_PAGO_ID} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderRadius: 8, background: visual.background, border: `1px solid ${visual.border}`, overflow: 'hidden' }}>
                      <Space style={{ minWidth: 0, overflow: 'hidden' }}>
                        {metodo.IMAGEN_BASE64 ? <img src={metodo.IMAGEN_BASE64} alt={metodo.NOMBRE} style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} /> : null}
                        <Text strong>{metodo.NOMBRE}</Text>
                        <Tag color={visual.tag} style={{ fontSize: 10 }}>{metodo.CATEGORIA}</Tag>
                      </Space>
                      <Text strong style={{ flexShrink: 0, paddingLeft: 8 }}>{fmtMoney(metodo.TOTAL)}</Text>
                    </div>
                  );
                })}
              </div>
            )}
          </>
          );
        })()}
      </Modal>
      {/* ── Desglose Métodos de Pago Modal ──── */}
      <Modal
        open={desgloseModalOpen}
        onCancel={() => setDesgloseModalOpen(false)}
        footer={<Button onClick={() => setDesgloseModalOpen(false)}>Cerrar</Button>}
        title="Desglose por método de pago"
        width={480}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        {desgloseData.length === 0 ? (
          <Text type="secondary">No hay métodos de pago registrados para este período.</Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {desgloseData.map(d => (
              (() => {
                const visual = metodoVisual(d.CATEGORIA);
                return (
              <div key={d.METODO_PAGO_ID} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8,
                background: visual.background,
                border: `1px solid ${visual.border}`,
              }}>
                <Space>
                  {d.IMAGEN_BASE64 ? (
                    <img src={d.IMAGEN_BASE64} alt={d.NOMBRE} style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4 }} />
                  ) : d.CATEGORIA === 'CHEQUES' ? (
                    <FileProtectOutlined style={{ fontSize: 20, color: '#fa8c16' }} />
                  ) : null}
                  <div>
                    <Text strong>{d.NOMBRE}</Text>
                    <br />
                    <Tag color={visual.tag} style={{ fontSize: 10 }}>
                      {d.CATEGORIA}
                    </Tag>
                  </div>
                </Space>
                <Text strong style={{ fontSize: 16 }}>{fmtMoney(d.TOTAL)}</Text>
              </div>
                );
              })()
            ))}
          </div>
        )}
      </Modal>    </div>
  );
}
