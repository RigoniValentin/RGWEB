import { useMemo, useState, useEffect } from 'react';
import {
  Button, Card, Col, Modal, Row, Statistic, Table, Typography, Spin, Tag, Space, Tooltip,
  Segmented, Empty, Progress,
} from 'antd';
import {
  ShoppingOutlined, DollarOutlined,
  WarningOutlined, RiseOutlined, FallOutlined,
  BankOutlined, TrophyOutlined,
  CalendarOutlined, ClockCircleOutlined, UserOutlined,
  BarChartOutlined, FundOutlined, PercentageOutlined, StarOutlined,
  ArrowDownOutlined, ArrowUpOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../services/dashboard.api';
import { useAuthStore } from '../store/authStore';
import { fmtMoney, statFormatter } from '../utils/format';
import type { DesgloseMetodo, DashboardGranularity, DashboardSeriesPoint } from '../types';
import { PuntoVentaFilter } from '../components/PuntoVentaFilter';
import { RGLogo } from '../components/RGLogo';
import { CajeroDashboardPage } from './CajeroDashboardPage';
import { useTabStore } from '../store/tabStore';
import { BarChart, DonutChart, Heatmap, type BarPoint } from '../components/dashboard/Charts';

const { Title, Text } = Typography;

// ── Helpers ──────────────────────────────────────────────────────────
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      color: 'rgba(255,255,255,0.65)', fontSize: 13,
      fontVariantNumeric: 'tabular-nums',
    }}>
      <ClockCircleOutlined />
      {time.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

type PeriodPreset = 'today' | '7d' | '30d' | 'mtd' | 'ytd';

function periodRange(preset: PeriodPreset): { from: string; to: string; granularity: DashboardGranularity } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const toStr = fmt(today);
  switch (preset) {
    case 'today':
      return { from: toStr, to: toStr, granularity: 'hour' };
    case '7d': {
      const d = new Date(today); d.setDate(d.getDate() - 6);
      return { from: fmt(d), to: toStr, granularity: 'day' };
    }
    case '30d': {
      const d = new Date(today); d.setDate(d.getDate() - 29);
      return { from: fmt(d), to: toStr, granularity: 'day' };
    }
    case 'mtd': {
      const d = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: fmt(d), to: toStr, granularity: 'day' };
    }
    case 'ytd': {
      const d = new Date(today.getFullYear(), 0, 1);
      return { from: fmt(d), to: toStr, granularity: 'month' };
    }
  }
}

function formatBucket(bucket: string, g: DashboardGranularity): string {
  const d = new Date(bucket);
  if (Number.isNaN(d.getTime())) return bucket;
  switch (g) {
    case 'hour':
      return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    case 'day':
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    case 'week':
      return 'Sem ' + d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
    case 'month':
      return d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
  }
}

function pctChange(curr: number, prev: number): number | null {
  if (prev === 0 && curr === 0) return 0;
  if (prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

function DeltaTag({ curr, prev }: { curr: number; prev: number }) {
  const p = pctChange(curr, prev);
  if (p === null) return <Tag color="default" style={{ marginLeft: 8 }}>—</Tag>;
  const positive = p > 0;
  const color = p === 0 ? 'default' : positive ? 'success' : 'error';
  const Icon = p === 0 ? null : positive ? ArrowUpOutlined : ArrowDownOutlined;
  return (
    <Tooltip title={`Período anterior: ${typeof prev === 'number' ? prev.toLocaleString('es-AR') : prev}`}>
      <Tag color={color} style={{ marginLeft: 8, fontWeight: 600 }}>
        {Icon ? <Icon style={{ fontSize: 11 }} /> : null} {Math.abs(p).toFixed(1)}%
      </Tag>
    </Tooltip>
  );
}

// ── Page ─────────────────────────────────────────────────────────────
export function DashboardPage() {
  const puntoVentaActivo = useAuthStore((s) => s.puntoVentaActivo);
  const { user, puntosVenta } = useAuthStore();
  const isCajero = useAuthStore((s) => s.isCajero);
  const cajero = isCajero();
  const openTab = useTabStore((s) => s.openTab);

  const [pvFilter, setPvFilter] = useState<number | undefined>(() => puntoVentaActivo ?? undefined);
  const [period, setPeriod] = useState<PeriodPreset>('today');
  const [granularity, setGranularity] = useState<DashboardGranularity | 'auto'>('auto');
  const [desgloseModalOpen, setDesgloseModalOpen] = useState(false);
  const [desgloseData, setDesgloseData] = useState<DesgloseMetodo[]>([]);
  const [heatmapModalOpen, setHeatmapModalOpen] = useState(false);

  const periodRng = useMemo(() => periodRange(period), [period]);
  const effGranularity: DashboardGranularity = granularity === 'auto' ? periodRng.granularity : granularity;

  const { data: logoUrl } = useQuery({
    queryKey: ['empresa-logo'],
    queryFn: () => dashboardApi.getLogo(),
    staleTime: Infinity,
    retry: false,
  });

  const { data: analytics, isLoading } = useQuery({
    queryKey: ['dashboard-analytics', periodRng.from, periodRng.to, effGranularity, pvFilter],
    queryFn: () => dashboardApi.getAnalytics({
      from: periodRng.from,
      to: periodRng.to,
      granularity: effGranularity,
      puntoVentaId: pvFilter,
    }),
    enabled: !cajero,
  });

  if (cajero) return <CajeroDashboardPage />;

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const todayCapitalized = today.charAt(0).toUpperCase() + today.slice(1);

  const barData: BarPoint[] = useMemo(() => {
    if (!analytics?.series) return [];
    return analytics.series.map((s: DashboardSeriesPoint) => ({
      label: formatBucket(s.bucket, effGranularity),
      value: Number(s.total) || 0,
      secondary: Number(s.ganancia) || 0,
      count: Number(s.ventas) || 0,
    }));
  }, [analytics, effGranularity]);

  const donutData = useMemo(() => {
    if (!analytics?.metodosPago) return [];
    return analytics.metodosPago.map((m, i) => ({
      label: m.NOMBRE,
      value: Number(m.TOTAL) || 0,
      color: m.CATEGORIA === 'EFECTIVO'
        ? ['#52c41a', '#73d13d', '#95de64'][i % 3]
        : ['#1677ff', '#13c2c2', '#722ed1', '#eb2f96'][i % 4],
    }));
  }, [analytics]);

  const heatData = useMemo(() => {
    if (!analytics?.heatmap) return [];
    return analytics.heatmap.map(h => ({ dow: h.dow, hour: h.hour, value: Number(h.ventas) || 0 }));
  }, [analytics]);

  // Heatmap insights — derive top hour, top day, top combo & best time-band from heatData
  const heatInsights = useMemo(() => {
    if (!heatData.length) return null;
    const DOW = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const byHour = new Map<number, number>();
    const byDow = new Map<number, number>();
    const bands = { manana: 0, tarde: 0, noche: 0 } as Record<'manana' | 'tarde' | 'noche', number>;
    let topCombo = { dow: 1, hour: 0, value: 0 };
    let total = 0;
    for (const h of heatData) {
      total += h.value;
      byHour.set(h.hour, (byHour.get(h.hour) ?? 0) + h.value);
      byDow.set(h.dow, (byDow.get(h.dow) ?? 0) + h.value);
      if (h.value > topCombo.value) topCombo = { dow: h.dow, hour: h.hour, value: h.value };
      if (h.hour < 12) bands.manana += h.value;
      else if (h.hour < 19) bands.tarde += h.value;
      else bands.noche += h.value;
    }
    const topHour = [...byHour.entries()].sort((a, b) => b[1] - a[1])[0];
    const topDow = [...byDow.entries()].sort((a, b) => b[1] - a[1])[0];
    const topBand = (Object.entries(bands) as [keyof typeof bands, number][])
      .sort((a, b) => b[1] - a[1])[0];
    const bandLabel: Record<keyof typeof bands, string> = {
      manana: 'Mañana (00–12h)', tarde: 'Tarde (12–19h)', noche: 'Noche (19–24h)',
    };
    return {
      total,
      topCombo: topCombo.value > 0
        ? { label: `${DOW[topCombo.dow - 1]} · ${topCombo.hour.toString().padStart(2, '0')}:00`, value: topCombo.value }
        : null,
      topHour: topHour ? { label: `${topHour[0].toString().padStart(2, '0')}:00 hs`, value: topHour[1] } : null,
      topDow: topDow ? { label: DOW[topDow[0] - 1], value: topDow[1] } : null,
      topBand: topBand ? { label: bandLabel[topBand[0]], value: topBand[1], pct: total > 0 ? Math.round((topBand[1] / total) * 100) : 0 } : null,
    };
  }, [heatData]);

  const totalCategorias = useMemo(
    () => (analytics?.topCategorias ?? []).reduce((s, c) => s + Number(c.total || 0), 0),
    [analytics]
  );

  const periodLabel = (() => {
    if (period === 'today') return 'Hoy';
    if (period === '7d') return 'Últimos 7 días';
    if (period === '30d') return 'Últimos 30 días';
    if (period === 'mtd') return 'Mes en curso';
    return 'Año en curso';
  })();

  const granLabel = effGranularity === 'hour' ? 'hora'
    : effGranularity === 'day' ? 'día'
    : effGranularity === 'week' ? 'semana'
    : 'mes';

  return (
    <div>
      {/* ── Hero Banner (preservado) ───────────────────────── */}
      <div className="rg-cajero-hero">
        <div className="rg-cajero-hero-grid" aria-hidden />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <span className="rg-cajero-badge">
                <UserOutlined /> DASHBOARD
              </span>
              <LiveClock />
            </div>
            <Title level={2} style={{ color: '#fff', margin: 0, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.1 }}>
              {getGreeting()},{' '}
              <span style={{ color: '#EABD23' }}>{user?.NOMBRE ?? 'Usuario'}</span>
            </Title>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 15, marginTop: 8, display: 'block', maxWidth: 540 }}>
              Gestionamos con vos, <span style={{ color: '#EABD23', fontWeight: 600 }}>CRECEMOS JUNTOS.</span>
            </Text>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 18, alignItems: 'center' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                <CalendarOutlined />
                {todayCapitalized}
              </span>
              <PuntoVentaFilter value={pvFilter} onChange={setPvFilter} />
            </div>
          </div>
          <div
            className="rg-cajero-hero-logo"
            style={{
              padding: 14, borderRadius: 18,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(234,189,35,0.18)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
            }}
          >
            {logoUrl
              ? <img src={logoUrl} alt="Logo empresa" style={{ width: 88, height: 88, objectFit: 'contain', display: 'block' }} />
              : <RGLogo size={88} showText={false} variant="white" />
            }
          </div>
        </div>
      </div>

      {/* ── Filter Bar ─────────────────────────────────────── */}
      <Card className="rg-dash-filterbar animate-fade-in" styles={{ body: { padding: 14 } }}>
        <Row gutter={[12, 12]} align="middle">
          <Col flex="auto">
            <Space size={6} wrap>
              <Text strong style={{ marginRight: 4 }}>Período:</Text>
              <Segmented
                value={period}
                onChange={(v) => setPeriod(v as PeriodPreset)}
                options={[
                  { label: 'Hoy', value: 'today' },
                  { label: '7 días', value: '7d' },
                  { label: '30 días', value: '30d' },
                  { label: 'Mes', value: 'mtd' },
                  { label: 'Año', value: 'ytd' },
                ]}
              />
            </Space>
          </Col>
          <Col>
            <Space size={6} wrap>
              <Text strong>Granularidad:</Text>
              <Segmented
                value={granularity}
                onChange={(v) => setGranularity(v as DashboardGranularity | 'auto')}
                options={[
                  { label: 'Auto', value: 'auto' },
                  { label: 'Hora', value: 'hour' },
                  { label: 'Día', value: 'day' },
                  { label: 'Semana', value: 'week' },
                  { label: 'Mes', value: 'month' },
                ]}
              />
            </Space>
          </Col>
        </Row>
      </Card>

      {isLoading || !analytics ? (
        <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />
      ) : (
        <>
          {/* ── KPI Cards with delta ─────────────────────── */}
          <Row gutter={[16, 16]} className="stagger" style={{ marginTop: 16 }}>
            <Col xs={24} sm={12} lg={8} xl={6}>
              <Card className="kpi-card animate-fade-up" hoverable>
                <Statistic
                  title={<span>Ventas <DeltaTag curr={analytics.kpis.ventas} prev={analytics.prev.ventas} /></span>}
                  value={analytics.kpis.ventas}
                  prefix={<ShoppingOutlined style={{ color: '#EABD23' }} />}
                  valueStyle={{ color: '#1E1F22', fontWeight: 700 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>Anterior: {analytics.prev.ventas}</Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={8} xl={6}>
              <Card
                className="kpi-card animate-fade-up"
                hoverable
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setDesgloseData(analytics.metodosPago);
                  setDesgloseModalOpen(true);
                }}
              >
                <Statistic
                  title={<span>Total facturado <DeltaTag curr={analytics.kpis.total} prev={analytics.prev.total} /></span>}
                  value={analytics.kpis.total}
                  formatter={statFormatter}
                  prefix={<DollarOutlined style={{ color: '#EABD23' }} />}
                  valueStyle={{ color: '#EABD23', fontWeight: 700 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>Anterior: {fmtMoney(analytics.prev.total)} ▸</Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={8} xl={6}>
              <Card className="kpi-card animate-fade-up" hoverable>
                <Statistic
                  title={<span>Ganancia <DeltaTag curr={analytics.kpis.ganancia} prev={analytics.prev.ganancia} /></span>}
                  value={analytics.kpis.ganancia}
                  formatter={statFormatter}
                  prefix={<TrophyOutlined style={{ color: '#52c41a' }} />}
                  valueStyle={{ color: '#52c41a', fontWeight: 700 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>Anterior: {fmtMoney(analytics.prev.ganancia)}</Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={8} xl={6}>
              <Card className="kpi-card animate-fade-up" hoverable>
                <Statistic
                  title={<span>Margen <DeltaTag curr={analytics.kpis.margenPct} prev={analytics.prev.margenPct} /></span>}
                  value={analytics.kpis.margenPct}
                  precision={2}
                  suffix="%"
                  prefix={<PercentageOutlined style={{ color: '#13c2c2' }} />}
                  valueStyle={{ color: '#13c2c2', fontWeight: 700 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>Anterior: {analytics.prev.margenPct.toFixed(2)}%</Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={8} xl={6}>
              <Card className="kpi-card animate-fade-up" hoverable>
                <Statistic
                  title={<span>Ticket promedio <DeltaTag curr={analytics.kpis.ticketPromedio} prev={analytics.prev.ticketPromedio} /></span>}
                  value={analytics.kpis.ticketPromedio}
                  formatter={statFormatter}
                  prefix={<FundOutlined style={{ color: '#722ed1' }} />}
                  valueStyle={{ color: '#722ed1', fontWeight: 700 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>Anterior: {fmtMoney(analytics.prev.ticketPromedio)}</Text>
              </Card>
            </Col>
            <Col xs={24} sm={12} lg={8} xl={6}>
              <Card className="kpi-card animate-fade-up" hoverable>
                <Statistic
                  title="Balance Caja Central"
                  value={analytics.cajaCentral.balance}
                  formatter={statFormatter}
                  prefix={<BankOutlined style={{ color: analytics.cajaCentral.balance >= 0 ? '#52c41a' : '#ff4d4f' }} />}
                  suffix={analytics.cajaCentral.balance >= 0
                    ? <RiseOutlined style={{ color: '#52c41a' }} />
                    : <FallOutlined style={{ color: '#ff4d4f' }} />}
                  valueStyle={{ color: '#1E1F22', fontWeight: 700 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  + {fmtMoney(analytics.cajaCentral.totalIngresos)} · − {fmtMoney(analytics.cajaCentral.totalEgresos)}
                </Text>
              </Card>
            </Col>
          </Row>

          {/* ── Bar chart + Donut métodos pago ─────────────── */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={16}>
              <Card
                className="animate-fade-in"
                title={<><BarChartOutlined /> Ventas por {granLabel} <Text type="secondary" style={{ fontWeight: 400, fontSize: 13, marginLeft: 8 }}>· {periodLabel}</Text></>}
                extra={<Text type="secondary" style={{ fontSize: 12 }}>{periodRng.from} → {periodRng.to}</Text>}
              >
                <BarChart data={barData} height={300} showSecondary />
              </Card>
            </Col>
            <Col xs={24} lg={8}>
              <Card
                className="animate-fade-in"
                title="Métodos de pago"
                extra={<Text type="secondary" style={{ fontSize: 12 }}>{periodLabel}</Text>}
              >
                {donutData.length > 0 ? (
                  <DonutChart
                    data={donutData}
                    size={200}
                    centerLabel="Total cobrado"
                    centerValue={fmtMoney(donutData.reduce((s, d) => s + d.value, 0))}
                  />
                ) : (
                  <Empty description="Sin desglose" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </Card>
            </Col>
          </Row>

          {/* ── Caja Central detail + Top categorías ──────── */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={12}>
              <Card title={<><BankOutlined /> Balance de Caja Central</>} className="animate-fade-in"
                extra={<Text type="secondary" style={{ fontSize: 12 }}>{periodLabel}</Text>}>
                <Row gutter={[12, 12]}>
                  <Col xs={12}>
                    <div className="rg-mini-stat" style={{ borderColor: '#b7eb8f' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>Ingresos</Text>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#52c41a' }}>
                        {fmtMoney(analytics.cajaCentral.totalIngresos)}
                      </div>
                    </div>
                  </Col>
                  <Col xs={12}>
                    <div className="rg-mini-stat" style={{ borderColor: '#ffccc7' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>Egresos</Text>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#ff4d4f' }}>
                        {fmtMoney(analytics.cajaCentral.totalEgresos)}
                      </div>
                    </div>
                  </Col>
                  <Col xs={24} style={{ marginTop: 4 }}>
                    <Button
                      type="primary"
                      icon={<BankOutlined />}
                      className="btn-gold"
                      onClick={() => openTab({ key: '/cashcentral', label: 'Caja Central', closable: true })}
                    >
                      Ir a Caja Central
                    </Button>
                  </Col>
                </Row>
              </Card>
            </Col>

            <Col xs={24} lg={12}>
              <Card title={<><StarOutlined /> Top categorías</>} className="animate-fade-in"
                extra={<Text type="secondary" style={{ fontSize: 12 }}>{periodLabel}</Text>}>
                {analytics.topCategorias.length === 0 ? (
                  <Empty description="Sin datos" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                ) : (
                  <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    {analytics.topCategorias.map((c, i) => {
                      const pct = totalCategorias > 0 ? (Number(c.total) / totalCategorias) * 100 : 0;
                      return (
                        <div key={c.NOMBRE + i}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <Text strong>{c.NOMBRE}</Text>
                            <Text style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {fmtMoney(c.total)} <Text type="secondary" style={{ fontSize: 11 }}>({pct.toFixed(1)}%)</Text>
                            </Text>
                          </div>
                          <Progress percent={pct} showInfo={false} strokeColor="#EABD23" size="small" />
                        </div>
                      );
                    })}
                  </Space>
                )}
              </Card>
            </Col>
          </Row>

          {/* ── Top Productos + Top Clientes ──────────────── */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={14}>
              <Card title={<><ShoppingOutlined /> Top productos</>} className="animate-fade-in"
                extra={<Text type="secondary" style={{ fontSize: 12 }}>{periodLabel}</Text>}>
                <Table
                  className="rg-table"
                  dataSource={analytics.topProductos}
                  rowKey="PRODUCTO_ID"
                  size="small"
                  pagination={false}
                  locale={{ emptyText: 'Sin ventas en el período' }}
                  columns={[
                    { title: '#', width: 50, render: (_v, _r, i) => <Tag color="gold" style={{ fontWeight: 700 }}>{i + 1}</Tag> },
                    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 90 },
                    { title: 'Producto', dataIndex: 'NOMBRE', ellipsis: true },
                    { title: 'Cant.', dataIndex: 'cantidad', align: 'right' as const, width: 80,
                      render: (v: number) => <Text strong>{v}</Text> },
                    { title: 'Total', dataIndex: 'total', align: 'right' as const, width: 120,
                      render: (v: number) => <Text style={{ fontWeight: 600, color: '#1E1F22' }}>{fmtMoney(v)}</Text> },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} lg={10}>
              <Card title={<><UserOutlined /> Top clientes</>} className="animate-fade-in"
                extra={<Text type="secondary" style={{ fontSize: 12 }}>{periodLabel}</Text>}>
                <Table
                  className="rg-table"
                  dataSource={analytics.topClientes}
                  rowKey={(r) => `${r.CLIENTE_ID ?? 'na'}-${r.NOMBRE ?? ''}`}
                  size="small"
                  pagination={false}
                  locale={{ emptyText: 'Sin ventas' }}
                  columns={[
                    { title: '#', width: 50, render: (_v, _r, i) => <Tag style={{ fontWeight: 700 }}>{i + 1}</Tag> },
                    { title: 'Cliente', dataIndex: 'NOMBRE', ellipsis: true,
                      render: (v: string | null) => v || <Text type="secondary">Consumidor final</Text> },
                    { title: 'Ventas', dataIndex: 'ventas', align: 'right' as const, width: 70 },
                    { title: 'Total', dataIndex: 'total', align: 'right' as const, width: 120,
                      render: (v: number) => <Text strong>{fmtMoney(v)}</Text> },
                  ]}
                />
              </Card>
            </Col>
          </Row>

          {/* ── Concentración de ventas (compact insights + modal) ── */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24}>
              <Card
                size="small"
                className="animate-fade-in rg-heat-summary"
                title={<Space size={8}><ClockCircleOutlined style={{ color: '#EABD23' }} /><span>Concentración de ventas</span></Space>}
                extra={
                  <Space size={8}>
                    <Text type="secondary" style={{ fontSize: 12 }}>{periodLabel}</Text>
                    <Button
                      size="small" type="link" icon={<BarChartOutlined />}
                      onClick={() => setHeatmapModalOpen(true)}
                      disabled={heatData.length === 0}
                    >
                      Ver mapa completo
                    </Button>
                  </Space>
                }
              >
                {!heatInsights || heatInsights.total === 0 ? (
                  <Empty description="Sin datos en el período" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '8px 0' }} />
                ) : (
                  <Row gutter={[12, 12]}>
                    <Col xs={12} md={6}>
                      <div className="rg-heat-tile" onClick={() => setHeatmapModalOpen(true)}>
                        <div className="rg-heat-tile-label"><CalendarOutlined /> Día más fuerte</div>
                        <div className="rg-heat-tile-value">{heatInsights.topDow?.label ?? '—'}</div>
                        <div className="rg-heat-tile-sub">{heatInsights.topDow?.value ?? 0} ventas</div>
                      </div>
                    </Col>
                    <Col xs={12} md={6}>
                      <div className="rg-heat-tile" onClick={() => setHeatmapModalOpen(true)}>
                        <div className="rg-heat-tile-label"><ClockCircleOutlined /> Hora pico</div>
                        <div className="rg-heat-tile-value">{heatInsights.topHour?.label ?? '—'}</div>
                        <div className="rg-heat-tile-sub">{heatInsights.topHour?.value ?? 0} ventas</div>
                      </div>
                    </Col>
                    <Col xs={12} md={6}>
                      <div className="rg-heat-tile rg-heat-tile-accent" onClick={() => setHeatmapModalOpen(true)}>
                        <div className="rg-heat-tile-label"><StarOutlined /> Momento estrella</div>
                        <div className="rg-heat-tile-value">{heatInsights.topCombo?.label ?? '—'}</div>
                        <div className="rg-heat-tile-sub">{heatInsights.topCombo?.value ?? 0} ventas</div>
                      </div>
                    </Col>
                    <Col xs={12} md={6}>
                      <div className="rg-heat-tile" onClick={() => setHeatmapModalOpen(true)}>
                        <div className="rg-heat-tile-label"><FundOutlined /> Franja top</div>
                        <div className="rg-heat-tile-value">{heatInsights.topBand?.label ?? '—'}</div>
                        <div className="rg-heat-tile-sub">{heatInsights.topBand?.pct ?? 0}% del total</div>
                      </div>
                    </Col>
                  </Row>
                )}
              </Card>
            </Col>
          </Row>

          {/* ── Stock bajo + Cajas abiertas ───────────────── */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={12}>
              <Card title={<><WarningOutlined style={{ color: '#EABD23' }} /> Productos con stock bajo</>}
                className="animate-fade-in">
                <Table
                  className="rg-table"
                  dataSource={analytics.productosStockBajo}
                  rowKey="PRODUCTO_ID"
                  size="small"
                  pagination={false}
                  locale={{ emptyText: 'Stock OK' }}
                  columns={[
                    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 90, align: 'center' as const },
                    { title: 'Producto', dataIndex: 'NOMBRE', ellipsis: true },
                    { title: 'Stock', dataIndex: 'CANTIDAD', width: 80, align: 'center' as const,
                      render: (v: number) => <Tag color="red">{v}</Tag> },
                    { title: 'Mín', dataIndex: 'STOCK_MINIMO', width: 60, align: 'center' as const },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="Cajas abiertas" className="animate-fade-in">
                <Table
                  className="rg-table"
                  dataSource={analytics.cajasAbiertas}
                  rowKey="CAJA_ID"
                  size="small"
                  pagination={false}
                  locale={{ emptyText: 'Ninguna caja abierta' }}
                  columns={[
                    { title: '#', dataIndex: 'CAJA_ID', width: 50 },
                    { title: 'Apertura', dataIndex: 'FECHA_APERTURA',
                      render: (v: string) => new Date(v).toLocaleString('es-AR') },
                    { title: 'Monto', dataIndex: 'MONTO_APERTURA', align: 'right' as const,
                      render: (v: number) => fmtMoney(v) },
                    { title: 'Usuario', dataIndex: 'USUARIO_NOMBRE' },
                    { title: 'Punto Venta', dataIndex: 'PUNTO_VENTA_NOMBRE', ellipsis: true },
                  ]}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* ── Desglose Métodos de Pago Modal ──── */}
      <Modal
        open={desgloseModalOpen}
        onCancel={() => setDesgloseModalOpen(false)}
        footer={<Button onClick={() => setDesgloseModalOpen(false)}>Cerrar</Button>}
        title={`Desglose por método de pago — ${periodLabel}`}
        width={520}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        {desgloseData.length === 0 ? (
          <Text type="secondary">No hay métodos de pago registrados para el período.</Text>
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
      </Modal>

      {/* ── Heatmap full-view Modal ─────────── */}
      <Modal
        open={heatmapModalOpen}
        onCancel={() => setHeatmapModalOpen(false)}
        footer={<Button onClick={() => setHeatmapModalOpen(false)}>Cerrar</Button>}
        title={`Concentración de ventas — ${periodLabel}`}
        width={820}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(85dvh - 120px)', overflowY: 'auto' } }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
          Cada celda representa una combinación día × hora. Mayor intensidad = más ventas.
        </Text>
        {heatData.length === 0
          ? <Empty description="Sin datos" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          : <Heatmap data={heatData} hourFrom={7} hourTo={23} />}
      </Modal>
    </div>
  );
}
