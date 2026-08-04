import React, { useMemo, useState, useEffect } from 'react';
import { Button, Modal, Spin, Table, Tag, Typography, Tooltip, Empty, Space, Avatar, Row, Col } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  TrophyOutlined, RiseOutlined, FallOutlined,
  UserOutlined, DollarOutlined, ShoppingOutlined,
  ThunderboltOutlined, CalendarOutlined, ClockCircleOutlined,
  EyeOutlined, ReloadOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../services/dashboard.api';
import { fmtMoney } from '../../utils/format';
import { RGCajaModalHeader } from '../RGCajaModalHeader';
import { DateFilterPopover, type DateFilterOption } from '../DateFilterPopover';
import { ExportButtons, type ExportColumn } from '../ExportButtons';
import type {
  CajeroRendimientoItem, CajeroTopProducto,
} from '../../types';

const { Text } = Typography;

// ── Local period preset (independent from the dashboard's global filter) ──
type PeriodPreset = 'today' | '7d' | '30d' | 'mtd' | 'ytd';

const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Hoy',
  '7d': '7 días',
  '30d': '30 días',
  mtd: 'Mes',
  ytd: 'Año',
};

const PERIOD_PRESET_OPTIONS: DateFilterOption<PeriodPreset>[] = [
  { label: 'Hoy', value: 'today' },
  { label: '7 días', value: '7d' },
  { label: '30 días', value: '30d' },
  { label: 'Mes', value: 'mtd' },
  { label: 'Año', value: 'ytd' },
];

function getPresetRange(preset: PeriodPreset): { from: string; to: string } {
  const today = dayjs().startOf('day');
  const fmt = (date: Dayjs) => date.format('YYYY-MM-DD');
  const toStr = fmt(today);
  switch (preset) {
    case 'today': return { from: toStr, to: toStr };
    case '7d':    return { from: fmt(today.subtract(6, 'day')), to: toStr };
    case '30d':   return { from: fmt(today.subtract(29, 'day')), to: toStr };
    case 'mtd':   return { from: fmt(today.startOf('month')), to: toStr };
    case 'ytd':   return { from: fmt(today.startOf('year')), to: toStr };
  }
}

/**
 * Reverse-engineer which preset matches the supplied range — so the modal
 * selector reflects whatever period the dashboard had selected when it opened.
 * Returns `undefined` when the range is a custom one.
 */
function detectPresetFromRange(from: string | undefined, to: string | undefined): PeriodPreset | undefined {
  if (!from || !to) return undefined;
  const today = dayjs().startOf('day');
  const fmt = (date: Dayjs) => date.format('YYYY-MM-DD');
  const toStr = fmt(today);
  if (from === toStr && to === toStr) return 'today';
  if (from === fmt(today.subtract(6, 'day')) && to === toStr) return '7d';
  if (from === fmt(today.subtract(29, 'day')) && to === toStr) return '30d';
  if (from === fmt(today.startOf('month')) && to === toStr) return 'mtd';
  if (from === fmt(today.startOf('year')) && to === toStr) return 'ytd';
  return undefined;
}

function formatPeriodLabel(preset: PeriodPreset | undefined, from: string | undefined, to: string | undefined): string {
  if (preset === 'today') return 'Hoy';
  if (preset === '7d') return 'Últimos 7 días';
  if (preset === '30d') return 'Últimos 30 días';
  if (preset === 'mtd') return 'Mes en curso';
  if (preset === 'ytd') return 'Año en curso';
  if (!from || !to) return 'Período seleccionado';
  const f = dayjs(from).format('DD/MM/YYYY');
  const t = dayjs(to).format('DD/MM/YYYY');
  return from === to ? f : `${f} – ${t}`;
}

export interface CajerosRendimientoModalProps {
  open: boolean;
  onClose: () => void;
  from: string;
  to: string;
  puntoVentaId?: number;
  usuarioId?: number;
  periodLabel?: string;
  selfOnly?: boolean;
}

export function CajerosRendimientoModal({
  open, onClose, from, to, puntoVentaId, usuarioId, selfOnly,
}: CajerosRendimientoModalProps) {
  const [selected, setSelected] = useState<CajeroRendimientoItem | null>(null);

  // Local period state — initialized from the dashboard's current range every
  // time the modal (re)opens, but fully independent afterwards.
  const [period, setPeriod] = useState<PeriodPreset | undefined>(() => detectPresetFromRange(from, to));
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(from);
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(to);

  useEffect(() => {
    if (open) {
      setFechaDesde(from);
      setFechaHasta(to);
      setPeriod(detectPresetFromRange(from, to));
    }
  }, [open, from, to]);

  const periodLabel = formatPeriodLabel(period, fechaDesde, fechaHasta);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['cajeros-rendimiento', fechaDesde, fechaHasta, puntoVentaId, usuarioId, selfOnly],
    queryFn: () => dashboardApi.getCajerosRendimiento({
      // Fallback to today if either bound is missing — keeps the request safe.
      from: fechaDesde ?? dayjs().format('YYYY-MM-DD'),
      to: fechaHasta ?? dayjs().format('YYYY-MM-DD'),
      puntoVentaId, usuarioId,
    }),
    enabled: open && !!fechaDesde && !!fechaHasta,
    staleTime: 60_000,
  });

  const items = data?.items ?? [];

  const totals = useMemo(() => {
    const t = items.reduce(
      (s, c) => ({
        ventas: s.ventas + c.ventas,
        total: s.total + c.total,
      }),
      { ventas: 0, total: 0 },
    );
    const ticketGlobal = t.ventas > 0 ? t.total / t.ventas : 0;
    return { ...t, ticketGlobal };
  }, [items]);

  const columns: ColumnsType<CajeroRendimientoItem> = [
    {
      title: '#',
      key: 'rank',
      width: 56,
      render: (_v, _r, i) => {
        const rank = i + 1;
        if (rank === 1) return <span className="rg-rendimiento-medal rg-rendimiento-medal-1">1°</span>;
        if (rank === 2) return <span className="rg-rendimiento-medal rg-rendimiento-medal-2">2°</span>;
        if (rank === 3) return <span className="rg-rendimiento-medal rg-rendimiento-medal-3">3°</span>;
        return <Tag style={{ fontWeight: 600 }}>{rank}</Tag>;
      },
    },
    {
      title: 'Cajero',
      dataIndex: 'USUARIO_NOMBRE',
      key: 'nombre',
      width: 200,
      sorter: (a, b) => a.USUARIO_NOMBRE.localeCompare(b.USUARIO_NOMBRE),
      render: (v: string, r) => (
        <Space size={8}>
          <Avatar
            size={28}
            icon={<UserOutlined />}
            style={{ background: 'linear-gradient(135deg, var(--rg-gold), var(--rg-gold-dark))', color: '#1E1F22' }}
          >
            {v?.charAt(0).toUpperCase()}
          </Avatar>
          <Text strong style={{ fontSize: 13 }}>{v}</Text>
          <Tooltip title="Ver detalle">
            <EyeOutlined
              style={{ color: '#1677ff', fontSize: 13, cursor: 'pointer' }}
              onClick={(e) => { e.stopPropagation(); setSelected(r); }}
            />
          </Tooltip>
        </Space>
      ),
    },
    {
      title: 'Ventas',
      dataIndex: 'ventas',
      key: 'ventas',
      width: 90,
      align: 'right',
      sorter: (a, b) => a.ventas - b.ventas,
      render: (v: number) => <Text strong>{v.toLocaleString('es-AR')}</Text>,
    },
    {
      title: 'Facturado',
      dataIndex: 'total',
      key: 'total',
      width: 150,
      align: 'right',
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.total - b.total,
      render: (v: number) => (
        <Text style={{ fontWeight: 700, color: '#1E1F22' }}>{fmtMoney(v)}</Text>
      ),
    },
    {
      title: 'Ticket prom.',
      dataIndex: 'ticketPromedio',
      key: 'ticket',
      width: 140,
      align: 'right',
      sorter: (a, b) => a.ticketPromedio - b.ticketPromedio,
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
    },
  ];

  const exportColumns: ExportColumn<CajeroRendimientoItem>[] = [
    { title: '#', render: (_v, _r, i) => i + 1, align: 'center', width: 50 },
    { title: 'Cajero', dataIndex: 'USUARIO_NOMBRE', width: 200 },
    { title: 'Ventas', dataIndex: 'ventas', align: 'right', width: 80 },
    { title: 'Facturado', dataIndex: 'total', align: 'right', width: 140, money: true },
    { title: 'Ticket prom.', dataIndex: 'ticketPromedio', align: 'right', width: 130, money: true },
    { title: 'Mejor venta', dataIndex: 'mejorVenta', align: 'right', width: 130, money: true },
    { title: 'Días trabajados', dataIndex: 'diasTrabajados', align: 'center', width: 110 },
    { title: 'Período anterior', dataIndex: 'totalAnterior', align: 'right', width: 140, money: true },
    { title: 'Δ %', dataIndex: 'deltaPct', align: 'right', width: 80 },
  ];

  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        width={760}
        destroyOnClose
        className="rg-modal rg-modal-rendimiento-cajeros"
        title={
          <RGCajaModalHeader
            icon={<TrophyOutlined />}
            title={selfOnly ? 'Mi rendimiento' : 'Rendimiento de cajeros'}
            subtitle={periodLabel}
            tag={selfOnly ? 'MI RENDIMIENTO' : 'BONOS'}
          />
        }
        footer={
          <Space wrap>
            <ExportButtons<CajeroRendimientoItem>
              data={items}
              columns={exportColumns}
              title={selfOnly ? 'Mi rendimiento' : 'Rendimiento de cajeros'}
              subtitle={periodLabel}
              meta={[
                `Período: ${dayjs(fechaDesde).format('DD/MM/YYYY')} – ${dayjs(fechaHasta).format('DD/MM/YYYY')}`,
                puntoVentaId ? `Punto de venta #${puntoVentaId}` : 'Todos los puntos de venta',
                `Generado: ${dayjs().format('DD/MM/YYYY HH:mm')}`,
              ].join(' · ')}
              fileName={`rendimiento-cajeros-${fechaDesde}_${fechaHasta}`}
              sheetName="Cajeros"
              disabled={items.length === 0}
              variant="full"
              pdfLabel="PDF"
              excelLabel="Excel"
            />
          </Space>
        }
      >
        <div className="rg-abrir-sesion">
          {/* Filter bar — independent from the dashboard's global filter */}
          <div className="rg-rendimiento-filterbar">
            <Space size={6} wrap>
              <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>Período:</Text>
              <DateFilterPopover<PeriodPreset>
                preset={period}
                fechaDesde={fechaDesde}
                fechaHasta={fechaHasta}
                presetLabels={PERIOD_PRESET_LABELS}
                presetOptions={PERIOD_PRESET_OPTIONS}
                getPresetRange={(value) => {
                  const next = getPresetRange(value);
                  return [next.from, next.to];
                }}
                onPresetChange={(value, desde, hasta) => {
                  setPeriod(value);
                  setFechaDesde(desde);
                  setFechaHasta(hasta);
                }}
                onRangeChange={(desde, hasta) => {
                  setPeriod(undefined);
                  setFechaDesde(desde);
                  setFechaHasta(hasta);
                }}
              />
            </Space>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => refetch()}
              loading={isFetching}
            >
              Actualizar
            </Button>
          </div>

          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
              <Spin size="large" />
            </div>
          ) : items.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text type="secondary">
                  {selfOnly
                    ? 'No tenés ventas registradas en el período seleccionado.'
                    : 'No hay ventas registradas en el período seleccionado.'}
                </Text>
              }
              style={{ padding: '40px 0' }}
            />
          ) : (
            <>
              {/* Top strip con resumen global */}
              <div className="rg-abrir-sesion__top rg-abrir-sesion__top--solo-stats">
                <div className="rg-mini-stat" style={{ borderLeftColor: '#EABD23' }}>
                  <TrophyOutlined className="rg-mini-stat__icon" style={{ color: '#EABD23' }} />
                  <div>
                    <div className="rg-mini-stat__label">{selfOnly ? 'Mi rol' : 'Cajeros activos'}</div>
                    <div className="rg-mini-stat__value" style={{ color: '#EABD23' }}>
                      {selfOnly ? '1' : items.length}
                    </div>
                  </div>
                </div>
                <div className="rg-mini-stat" style={{ borderLeftColor: '#1677ff' }}>
                  <DollarOutlined className="rg-mini-stat__icon" style={{ color: '#1677ff' }} />
                  <div>
                    <div className="rg-mini-stat__label">Facturado total</div>
                    <div className="rg-mini-stat__value" style={{ color: '#1677ff' }}>
                      {fmtMoney(totals.total)}
                    </div>
                  </div>
                </div>
                <div className="rg-mini-stat" style={{ borderLeftColor: '#722ed1' }}>
                  <ThunderboltOutlined className="rg-mini-stat__icon" style={{ color: '#722ed1' }} />
                  <div>
                    <div className="rg-mini-stat__label">Ticket promedio global</div>
                    <div className="rg-mini-stat__value" style={{ color: '#722ed1' }}>
                      {fmtMoney(totals.ticketGlobal)}
                    </div>
                  </div>
                </div>
                <div className="rg-mini-stat" style={{ borderLeftColor: '#52c41a' }}>
                  <ShoppingOutlined className="rg-mini-stat__icon" style={{ color: '#52c41a' }} />
                  <div>
                    <div className="rg-mini-stat__label">Ventas totales</div>
                    <div className="rg-mini-stat__value" style={{ color: '#52c41a' }}>
                      {totals.ventas.toLocaleString('es-AR')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Tabla principal reducida — click en fila abre el detalle */}
              <Table<CajeroRendimientoItem>
                className="rg-table rg-rendimiento-table"
                dataSource={items}
                rowKey="USUARIO_ID"
                size="middle"
                columns={columns}
                pagination={{ pageSize: 15, showSizeChanger: false }}
                loading={isFetching}
                onRow={(record) => ({
                  onClick: () => setSelected(record),
                  style: { cursor: 'pointer' },
                })}
                locale={{
                  emptyText: 'Sin datos en el período',
                }}
              />
            </>
          )}
        </div>
      </Modal>

      {/* Modal detalle por cajero */}
      <CajeroDetalleModal
        open={!!selected}
        record={selected}
        topProductos={selected ? (data?.topProductosByUser?.[selected.USUARIO_ID] ?? []) : []}
        onClose={() => setSelected(null)}
      />
    </>
  );
}

// ───────────────────────────────────────────────────────────────────
// CajeroDetalleModal — detalle completo de un cajero (modal flotante)
// Layout horizontal: Top productos a la izquierda · Medios de cobro +
// comparativa a la derecha.
// ───────────────────────────────────────────────────────────────────
interface CajeroDetalleModalProps {
  open: boolean;
  record: CajeroRendimientoItem | null;
  topProductos: CajeroTopProducto[];
  onClose: () => void;
}

function CajeroDetalleModal({ open, record, topProductos, onClose }: CajeroDetalleModalProps) {
  if (!record) return null;

  const deltaIcon = record.deltaPct > 0 ? RiseOutlined
    : record.deltaPct < 0 ? FallOutlined
      : ClockCircleOutlined;
  const deltaColor = record.deltaPct > 0 ? 'success'
    : record.deltaPct < 0 ? 'error'
      : 'default';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={960}
      destroyOnClose
      className="rg-modal rg-modal-cajero-detalle"
      title={
        <RGCajaModalHeader
          icon={<UserOutlined />}
          title={record.USUARIO_NOMBRE}
          subtitle="Detalle de rendimiento del cajero"
          tag={record.ventas > 0 ? `${record.ventas} VENTAS` : '—'}
        />
      }
    >
      <div className="rg-abrir-sesion">
        {/* KPIs principales (horizontal strip) */}
        <div className="rg-abrir-sesion__top rg-abrir-sesion__top--solo-stats">
          <div className="rg-mini-stat" style={{ borderLeftColor: '#1677ff' }}>
            <DollarOutlined className="rg-mini-stat__icon" style={{ color: '#1677ff' }} />
            <div>
              <div className="rg-mini-stat__label">Facturado</div>
              <div className="rg-mini-stat__value" style={{ color: '#1677ff' }}>
                {fmtMoney(record.total)}
              </div>
            </div>
          </div>
          <div className="rg-mini-stat" style={{ borderLeftColor: '#722ed1' }}>
            <ThunderboltOutlined className="rg-mini-stat__icon" style={{ color: '#722ed1' }} />
            <div>
              <div className="rg-mini-stat__label">Ticket promedio</div>
              <div className="rg-mini-stat__value" style={{ color: '#722ed1' }}>
                {fmtMoney(record.ticketPromedio)}
              </div>
            </div>
          </div>
          <div className="rg-mini-stat" style={{ borderLeftColor: '#fa8c16' }}>
            <TrophyOutlined className="rg-mini-stat__icon" style={{ color: '#fa8c16' }} />
            <div>
              <div className="rg-mini-stat__label">Mejor venta</div>
              <div className="rg-mini-stat__value" style={{ color: '#fa8c16' }}>
                {fmtMoney(record.mejorVenta)}
              </div>
            </div>
          </div>
          <div className="rg-mini-stat" style={{ borderLeftColor: '#13c2c2' }}>
            <CalendarOutlined className="rg-mini-stat__icon" style={{ color: '#13c2c2' }} />
            <div>
              <div className="rg-mini-stat__label">Días trabajados</div>
              <div className="rg-mini-stat__value" style={{ color: '#13c2c2' }}>
                {record.diasTrabajados}
              </div>
            </div>
          </div>
        </div>

        {/* Layout horizontal:
            · IZQUIERDA: Top productos vendidos
            · DERECHA:   Medios de cobro + Comparativa vs período anterior */}
        <Row gutter={[16, 12]} className="rg-rendimiento-detalle-row">
          {/* LEFT: Top productos */}
          <Col xs={24} md={14} lg={14}>
            <Text type="secondary" style={{
              fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
            }}>
              <ShoppingOutlined /> Top productos vendidos
            </Text>
              <Table<CajeroTopProducto>
                size="small"
                className="rg-table"
                dataSource={topProductos}
                rowKey="PRODUCTO_ID"
                pagination={false}
                locale={{ emptyText: 'Sin productos vendidos' }}
                columns={[
                  { title: 'Producto', dataIndex: 'NOMBRE', ellipsis: true },
                  {
                    title: 'Cant.',
                    dataIndex: 'cantidad',
                    align: 'right',
                    width: 130,
                    render: (_v: number, r: CajeroTopProducto) => (
                      <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {Number(r.cantidad).toLocaleString('es-AR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} {r.UNIDAD_ABREVIACION}
                      </Text>
                    ),
                  },
                  { title: 'Total', dataIndex: 'total', align: 'right', width: 130,
                    render: (v: number) => <Text strong style={{ color: '#1E1F22' }}>{fmtMoney(v)}</Text> },
                ]}
              />
          </Col>

          {/* RIGHT: Medios de cobro + Comparativa */}
          <Col xs={24} md={10} lg={10}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div className="rg-composicion-card">
                <div className="rg-composicion-card__title">Medios de cobro</div>
                <div className="rg-composicion-card__row">
                  <span className="rg-composicion-card__dot" style={{ background: '#52c41a' }} />
                  <DollarOutlined style={{ color: '#52c41a' }} />
                  <span className="rg-composicion-card__label">Efectivo</span>
                  <span className="rg-composicion-card__value" style={{ color: '#52c41a' }}>
                    {fmtMoney(record.efectivo)}
                  </span>
                </div>
                <div className="rg-composicion-card__row">
                  <span className="rg-composicion-card__dot" style={{ background: '#1677ff' }} />
                  <DollarOutlined style={{ color: '#1677ff' }} />
                  <span className="rg-composicion-card__label">Digital</span>
                  <span className="rg-composicion-card__value" style={{ color: '#1677ff' }}>
                    {fmtMoney(record.digital)}
                  </span>
                </div>
                <div className="rg-composicion-card__row rg-composicion-card__row--total">
                  <span className="rg-composicion-card__dot" style={{ background: '#EABD23' }} />
                  <DollarOutlined style={{ color: '#EABD23' }} />
                  <span className="rg-composicion-card__label"><Text strong>Total</Text></span>
                  <span className="rg-composicion-card__value">
                    <Text strong style={{ color: '#EABD23' }}>{fmtMoney(record.total)}</Text>
                  </span>
                </div>
              </div>

              <div className="rg-composicion-card">
                <div className="rg-composicion-card__title">Comparativa vs período anterior</div>
                <div className="rg-composicion-card__row">
                  <span className="rg-composicion-card__dot" style={{ background: '#8c8c8c' }} />
                  <ClockCircleOutlined style={{ color: '#8c8c8c' }} />
                  <span className="rg-composicion-card__label">Período anterior</span>
                  <span className="rg-composicion-card__value">
                    {record.totalAnterior > 0 ? fmtMoney(record.totalAnterior) : '—'}
                  </span>
                </div>
                <div className="rg-composicion-card__row rg-composicion-card__row--total">
                  <span
                    className="rg-composicion-card__dot"
                    style={{ background: deltaColor === 'success' ? '#52c41a' : deltaColor === 'error' ? '#ff4d4f' : '#8c8c8c' }}
                  />
                  {React.createElement(deltaIcon, {
                    style: {
                      color: deltaColor === 'success' ? '#52c41a'
                        : deltaColor === 'error' ? '#ff4d4f'
                          : '#8c8c8c',
                    },
                  })}
                  <span className="rg-composicion-card__label"><Text strong>Variación</Text></span>
                  <Tag color={deltaColor} style={{ fontWeight: 700, marginLeft: 'auto' }}>
                    {record.deltaPct > 0 ? '+' : ''}{record.deltaPct.toFixed(1)}%
                  </Tag>
                </div>
                <div className="rg-composicion-card__row">
                  <CalendarOutlined style={{ color: '#8c8c8c' }} />
                  <span className="rg-composicion-card__label"><Text strong>Actividad</Text></span>
                </div>
                <div style={{
                  fontSize: 12, padding: '0 4px 4px', display: 'flex',
                  flexDirection: 'column', gap: 4,
                }}>
                  <span>
                    <Text type="secondary">Primera: </Text>
                    <Text strong>
                      {record.primeraVenta ? dayjs(record.primeraVenta).format('DD/MM/YY HH:mm') : '—'}
                    </Text>
                  </span>
                  <span>
                    <Text type="secondary">Última: </Text>
                    <Text strong>
                      {record.ultimaVenta ? dayjs(record.ultimaVenta).format('DD/MM/YY HH:mm') : '—'}
                    </Text>
                  </span>
                </div>
              </div>
            </Space>
          </Col>
        </Row>
      </div>
    </Modal>
  );
}
