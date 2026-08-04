import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Button, Card, Collapse, Col, Descriptions, Drawer, Input, Row, Space, Spin, Statistic, Table, Tag, Typography,
} from 'antd';
import type { TableColumnsType } from 'antd';
import {
  ClockCircleOutlined, CloudSyncOutlined, EyeOutlined, FileProtectOutlined,
  ReloadOutlined, SafetyCertificateOutlined, SearchOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { salesApi } from '../services/sales.api';
import { dashboardApi } from '../services/dashboard.api';
import { afipApi } from '../services/afip.api';
import { catalogApi } from '../services/catalog.api';
import { PuntoVentaFilter } from '../components/PuntoVentaFilter';
import { DateFilterPopover, type DatePreset } from '../components/DateFilterPopover';
import { useAuthStore } from '../store/authStore';
import { fmtComprobanteTipo, fmtMoney } from '../utils/format';
import type { Venta, VentaDetalle } from '../types';
import { RowContextMenu } from '../components/RowContextMenu';
import { useRowActions, type RowAction } from '../hooks/useRowActions';
import { RGCajaModalHeader } from '../components/RGCajaModalHeader';
import { rgIcon } from '../components/rg-icons';

const { Title, Text } = Typography;

const CBTE_TO_ARCA: Record<string, number> = {
  FA: 1,
  FB: 6,
  FC: 11,
  'FA.A': 1,
  'FA.B': 6,
  'FA.C': 11,
  'F.A': 1,
  'F.B': 6,
  'F.C': 11,
  'ND.A': 2,
  'ND.B': 7,
  'ND.C': 12,
  'NC.A': 3,
  'NC.B': 8,
  'NC.C': 13,
};

function toArcaCbteTipo(tipo?: string | null) {
  if (!tipo) return undefined;
  return CBTE_TO_ARCA[tipo.toUpperCase().replace(/\s+/g, '')];
}

function parseFiscalNumber(value?: string | null) {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeArcaResponse(data: any) {
  return data?.FeCompConsResponse
    || data?.FECompConsResponse
    || data?.FeCompConsultarResult
    || data?.FECompConsultarResult
    || data?.FeCompConsResult
    || data?.FECompConsResult
    || data;
}

function unwrapArcaResponse(data: any) {
  return data?.data
    || data?.response
    || data?.Response
    || data?.body
    || data?.Body
    || data;
}

function unwrapArcaResultGet(data: any) {
  return data?.ResultGet
    || data?.resultGet
    || data?.Result
    || data?.result
    || data;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeArcaMessages(value: any) {
  return asArray(value)
    .flatMap((entry) => {
      if (!entry) return [];
      if (typeof entry === 'string') {
        const text = entry.trim();
        return text && text !== '[]' ? [text] : [];
      }
      const code = entry?.Code ?? entry?.code ?? entry?.codigoError;
      const msg = entry?.Msg ?? entry?.msg ?? entry?.descripcionError;
      const text = [code ? `[${code}]` : '', msg || ''].join(' ').trim();
      return text ? [text] : [];
    })
    .filter(Boolean);
}

function formatFiscalDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function ArcaPage() {
  const { puntoVentaActivo } = useAuthStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('mes');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(() => dayjs().startOf('month').format('YYYY-MM-DD'));
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(() => dayjs().format('YYYY-MM-DD'));
  const [pvFilter, setPvFilter] = useState<number | undefined>(() => puntoVentaActivo ?? undefined);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchDebounced(search);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { data: puntosVenta } = useQuery({
    queryKey: ['catalog-puntos-venta'],
    queryFn: () => catalogApi.getPuntosVenta(),
    staleTime: 300000,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['arca-comprobantes', page, pageSize, searchDebounced, fechaDesde, fechaHasta, pvFilter],
    queryFn: () => salesApi.getAll({
      page,
      pageSize,
      search: searchDebounced || undefined,
      fechaDesde,
      fechaHasta,
      puntoVentaId: pvFilter,
      soloFiscal: true,
    }),
  });

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['arca-analytics', fechaDesde, fechaHasta, pvFilter],
    queryFn: () => dashboardApi.getAnalytics({
      from: fechaDesde || dayjs().startOf('month').format('YYYY-MM-DD'),
      to: fechaHasta || dayjs().format('YYYY-MM-DD'),
      granularity: 'day',
      puntoVentaId: pvFilter,
      soloFiscal: true,
    }),
  });

  const { data: detalle, isLoading: loadingDetalle, error: detalleError } = useQuery({
    queryKey: ['arca-comprobante-detalle', selectedId],
    queryFn: () => salesApi.getById(selectedId!) as Promise<VentaDetalle>,
    enabled: !!selectedId && drawerOpen,
  });

  const cbteTipo = toArcaCbteTipo(detalle?.TIPO_COMPROBANTE);
  const ptoVta = parseFiscalNumber(detalle?.PUNTO_VENTA);
  const cbteNro = parseFiscalNumber(detalle?.NUMERO_FISCAL);
  const canConsultArca = !!drawerOpen && !!detalle?.NUMERO_FISCAL && cbteTipo !== undefined && ptoVta !== undefined && cbteNro !== undefined;

  const { data: consultaArca, isFetching: consultingArca, refetch: refetchArca } = useQuery({
    queryKey: ['arca-consulta', selectedId, cbteTipo, ptoVta, cbteNro],
    queryFn: () => afipApi.consultarComprobante(cbteTipo!, ptoVta!, cbteNro!),
    enabled: canConsultArca,
    retry: false,
  });

  const arcaData = normalizeArcaResponse(unwrapArcaResponse(consultaArca));
  const arcaResultGet = unwrapArcaResultGet(arcaData);
  const arcaCab = arcaResultGet?.FeCabResp || arcaResultGet?.feCabResp || arcaResultGet?.FeCab || arcaResultGet?.feCab || arcaResultGet?.CabResp || {};
  const arcaDetSource = arcaResultGet?.FeDetResp || arcaResultGet?.feDetResp || arcaResultGet?.FeDet || arcaResultGet?.feDet || arcaResultGet?.DetResp;
  const arcaDet = asArray(
    arcaDetSource?.FECompConsResponse
      || arcaDetSource?.FECompConsResp
      || arcaDetSource?.FECompConsResult
      || arcaDetSource?.FECompConsultaResponse
      || arcaDetSource,
  );
  const arcaResult = arcaCab?.Resultado || arcaDet[0]?.Resultado;
  const arcaEvents = normalizeArcaMessages(arcaResultGet?.Events || arcaData?.Events || arcaData?.events);
  const arcaErrors = normalizeArcaMessages(arcaResultGet?.Errors || arcaData?.Errors || arcaData?.errors);

  const ultimoFiscal = analytics?.ultimaVentaFiscal;

  const columns: TableColumnsType<Venta> = [
    {
      title: 'Fecha',
      dataIndex: 'FECHA_VENTA',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
    },
    {
      title: 'Comprobante',
      width: 220,
      render: (_: unknown, record: Venta) => (
        <Space direction="vertical" size={0}>
          <Text strong>{fmtComprobanteTipo(record.TIPO_COMPROBANTE || '')}</Text>
          <Text type="secondary">{`${record.PUNTO_VENTA || '0000'}-${record.NUMERO_FISCAL || '--------'}`}</Text>
        </Space>
      ),
    },
    { title: 'Cliente', dataIndex: 'CLIENTE_NOMBRE', ellipsis: true },
    {
      title: 'CAE',
      dataIndex: 'CAE',
      width: 130,
      render: (v: string | null) => v ? <Tag color="green">{v}</Tag> : <Tag color="orange">Sin CAE</Tag>,
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      width: 140,
      align: 'right' as const,
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
    },
    {
      title: 'Estado FE',
      width: 120,
      align: 'center' as const,
      render: (_: unknown, record: Venta) => (
        record.NUMERO_FISCAL
          ? <Tag color="green">Emitido</Tag>
          : <Tag color="orange">Pendiente</Tag>
      ),
    },
  ];

  // ── Row interactions (active row + context menu) ─
  const handleOpenDetail = (record: Venta) => {
    setSelectedId(record.VENTA_ID);
    setDrawerOpen(true);
  };
  const contextMenuActions = useMemo<RowAction<Venta>[]>(() => [
    { key: 'view', label: 'Consultar detalle', icon: <EyeOutlined />, onClick: handleOpenDetail },
  ], []);
  const { onRow, rowClassName, contextMenu, contextMenuItems, closeContextMenu } = useRowActions<Venta>({
    getRowId: (r) => r.VENTA_ID,
    primaryAction: handleOpenDetail,
    actions: contextMenuActions,
  });

  return (
    <div className="page-enter">
      {/* ── Header ─────────────────────────────── */}
      <div className="page-header">
        <Title level={3}>
          <FileProtectOutlined style={{ marginRight: 8 }} />
          ARCA
        </Title>
        <Space wrap>
          <Input
            placeholder="Buscar cliente, comprobante o número fiscal"
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            allowClear
            style={{ width: 280 }}
          />
          <DateFilterPopover
            preset={datePreset}
            fechaDesde={fechaDesde}
            fechaHasta={fechaHasta}
            onPresetChange={(p, d, h) => { setDatePreset(p); setFechaDesde(d); setFechaHasta(h); setPage(1); }}
            onRangeChange={(d, h) => { setDatePreset(undefined as any); setFechaDesde(d); setFechaHasta(h); setPage(1); }}
          />
          <PuntoVentaFilter
            value={pvFilter}
            onChange={v => { setPvFilter(v); setPage(1); }}
            overridePuntosVenta={puntosVenta?.map(pv => ({ PUNTO_VENTA_ID: pv.PUNTO_VENTA_ID, NOMBRE: pv.NOMBRE }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
        </Space>
      </div>

      {/* ── Summary cards ──────────────────────── */}
      <Row gutter={16} wrap={false} style={{ marginBottom: 16, flexWrap: 'nowrap' }}>
        <Col flex="1 1 0" style={{ minWidth: 0 }}>
          <Card size="small" className="rg-card" loading={analyticsLoading}>
            <Statistic
              title="Comprobantes emitidos"
              value={analytics?.kpis.ventas ?? 0}
              prefix={<SafetyCertificateOutlined />}
              valueStyle={{ color: '#EABD23' }}
            />
          </Card>
        </Col>
        <Col flex="1 1 0" style={{ minWidth: 0 }}>
          <Card size="small" className="rg-card" loading={analyticsLoading}>
            <Statistic
              title="Monto facturado"
              value={analytics?.kpis.total ?? 0}
              precision={2}
              prefix="$"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col flex="1 1 0" style={{ minWidth: 0 }}>
          <Card size="small" className="rg-card" loading={analyticsLoading}>
            <Statistic
              title="Ticket promedio"
              value={analytics?.kpis.ticketPromedio ?? 0}
              precision={2}
              prefix="$"
              valueStyle={{ color: '#1677ff' }}
            />
          </Card>
        </Col>
        <Col flex="1 1 0" style={{ minWidth: 0 }}>
          <Card size="small" className="rg-card" loading={analyticsLoading}>
            <Statistic
              title="Última emisión"
              value={ultimoFiscal?.FECHA_VENTA ? formatFiscalDate(ultimoFiscal.FECHA_VENTA) : '-'}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#7c3aed' }}
            />
          </Card>
        </Col>
      </Row>

      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="VENTA_ID"
        loading={isLoading}
        onRow={onRow}
        rowClassName={rowClassName}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: ['10', '25', '50', '100'],
          showTotal: total => `${total} comprobantes`,
          onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize); },
        }}
        size="middle"
        scroll={{ x: 900 }}
        style={{ marginBottom: 16 }}
      />

      <RowContextMenu
        open={contextMenu !== null}
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={980}
        title={
          <RGCajaModalHeader
            icon={rgIcon('arca')}
            title={`Comprobante ${selectedId ? `#${selectedId}` : ''}`}
            subtitle="Detalle fiscal y consulta en ARCA"
          />
        }
        className="rg-drawer rg-modal"
        extra={detalle?.NUMERO_FISCAL ? (
          <Space>
            <Button icon={<CloudSyncOutlined />} loading={consultingArca} onClick={() => refetchArca()}>
              Consultar en ARCA
            </Button>
          </Space>
        ) : null}
      >
        {detalleError ? (
          <Alert type="error" showIcon message="No se pudo cargar el comprobante" description={(detalleError as any)?.response?.data?.error || (detalleError as Error).message} />
        ) : loadingDetalle ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spin size="large" /></div>
        ) : detalle ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions column={2} bordered size="middle">
              <Descriptions.Item label="Fecha">{new Date(detalle.FECHA_VENTA).toLocaleString('es-AR')}</Descriptions.Item>
              <Descriptions.Item label="Cliente">{detalle.CLIENTE_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Comprobante">{fmtComprobanteTipo(detalle.TIPO_COMPROBANTE || '')}</Descriptions.Item>
              <Descriptions.Item label="Punto de venta">{detalle.PUNTO_VENTA || '-'}</Descriptions.Item>
              <Descriptions.Item label="Número fiscal">{detalle.NUMERO_FISCAL || 'Sin emitir'}</Descriptions.Item>
              <Descriptions.Item label="CAE">{detalle.CAE || '-'}</Descriptions.Item>
              <Descriptions.Item label="Estado">{detalle.NUMERO_FISCAL ? <Tag color="green">Emitido</Tag> : <Tag color="orange">Pendiente</Tag>}</Descriptions.Item>
              <Descriptions.Item label="Total">{fmtMoney(detalle.TOTAL)}</Descriptions.Item>
            </Descriptions>

            <Card title="Consulta ARCA" bordered={false} className="rg-card">
              {detalle.NUMERO_FISCAL ? (
                <>
                  {!canConsultArca ? (
                    <Alert
                      type="warning"
                      showIcon
                      message="No se pudo preparar la consulta ARCA"
                      description="El comprobante no tiene un tipo o punto de venta fiscal válido para consultar en ARCA."
                    />
                  ) : consultingArca && !consultaArca ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spin /></div>
                  ) : arcaData ? (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                      <Descriptions column={2} bordered size="small">
                        <Descriptions.Item label="Resultado">{arcaResult ? <Tag color={arcaResult === 'A' ? 'green' : arcaResult === 'R' ? 'red' : 'orange'}>{arcaResult}</Tag> : '-'}</Descriptions.Item>
                        <Descriptions.Item label="F. proceso">{arcaCab?.FchProceso || '-'}</Descriptions.Item>
                        <Descriptions.Item label="Cuit">{arcaCab?.Cuit || '-'}</Descriptions.Item>
                        <Descriptions.Item label="Cant. registros">{arcaCab?.CantReg ?? '-'}</Descriptions.Item>
                      </Descriptions>

                      {arcaDet.length > 0 && (
                        <Descriptions column={2} bordered size="small">
                          <Descriptions.Item label="CBTE desde">{arcaDet[0]?.CbteDesde ?? arcaDet[0]?.CbteNro ?? '-'}</Descriptions.Item>
                          <Descriptions.Item label="CBTE hasta">{arcaDet[0]?.CbteHasta ?? arcaDet[0]?.CbteNro ?? '-'}</Descriptions.Item>
                          <Descriptions.Item label="CAE">{arcaDet[0]?.CAE || detalle.CAE || '-'}</Descriptions.Item>
                          <Descriptions.Item label="Vto. CAE">{arcaDet[0]?.CAEFchVto || '-'}</Descriptions.Item>
                        </Descriptions>
                      )}

                      {arcaErrors.length > 0 && (
                        <Alert
                          type="error"
                          showIcon
                          message="Errores ARCA"
                          description={arcaErrors.join(' · ')}
                        />
                      )}

                      {arcaEvents.length > 0 && (
                        <Alert
                          type="warning"
                          showIcon
                          message="Eventos ARCA"
                          description={arcaEvents.join(' · ')}
                        />
                      )}

                      <Card size="small" title="Respuesta técnica">
                        <Collapse ghost items={[{
                          key: 'technical-response',
                          label: 'Ver respuesta técnica',
                          children: (
                            <pre style={{ margin: 0, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {JSON.stringify(arcaData, null, 2)}
                            </pre>
                          ),
                        }]} />
                      </Card>
                    </Space>
                  ) : (
                    <Alert type="info" showIcon message="No se consultó aún el comprobante en ARCA" description="Presioná Consultar en ARCA para traer el detalle fiscal oficial." />
                  )}
                </>
              ) : (
                <Alert type="warning" showIcon message="Este comprobante no tiene número fiscal emitido" description="Solo los comprobantes electrónicos emitidos pueden consultarse en ARCA." />
              )}
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}