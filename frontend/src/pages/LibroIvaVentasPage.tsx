import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Table, Space, Typography, Button, Card, Row, Col, Statistic, Select,
  Switch, Tag, Tooltip, App, Divider, Badge,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  ReloadOutlined, FileExcelOutlined, FileTextOutlined,
  DollarOutlined, AuditOutlined, DownloadOutlined,
  BankOutlined, PercentageOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  libroIvaVentasApi,
  type LibroIvaComprobante,
  type LibroIvaAlicuota,
  type LibroIvaFilter,
} from '../services/libroIvaVentas.api';
import { fmtMoney } from '../utils/format';
import { DateFilterPopover, getPresetRange, type DatePreset } from '../components/DateFilterPopover';

const { Title, Text } = Typography;

const TIPO_COMPROBANTE_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'A', label: 'Factura A' },
  { value: 'B', label: 'Factura B' },
  { value: 'C', label: 'Factura C' },
  { value: 'NC A', label: 'NC A' },
  { value: 'NC B', label: 'NC B' },
  { value: 'NC C', label: 'NC C' },
  { value: 'ND A', label: 'ND A' },
  { value: 'ND B', label: 'ND B' },
  { value: 'ND C', label: 'ND C' },
];

export function LibroIvaVentasPage() {
  const { message } = App.useApp();

  // ── Filters ─────────────────────────────────────
  const [datePreset, setDatePreset] = useState<DatePreset | undefined>('mes');
  const [fechaDesde, setFechaDesde] = useState<string>(() => getPresetRange('mes')[0]!);
  const [fechaHasta, setFechaHasta] = useState<string>(() => getPresetRange('mes')[1]!);
  const [puntoVentaId, setPuntoVentaId] = useState<number | undefined>();
  const [tipoComprobante, setTipoComprobante] = useState<string>('');
  const [incluirNoCobradas, setIncluirNoCobradas] = useState(true);

  const filter: LibroIvaFilter = useMemo(() => ({
    fechaDesde,
    fechaHasta,
    puntoVentaId,
    tipoComprobante: tipoComprobante || undefined,
    incluirNoCobradas,
  }), [fechaDesde, fechaHasta, puntoVentaId, tipoComprobante, incluirNoCobradas]);

  // ── Queries ─────────────────────────────────────
  const { data: comprobantes, isLoading, refetch } = useQuery({
    queryKey: ['libro-iva-comprobantes', filter],
    queryFn: () => libroIvaVentasApi.getComprobantes(filter),
    enabled: !!fechaDesde && !!fechaHasta,
  });

  const { data: totales } = useQuery({
    queryKey: ['libro-iva-totales', filter],
    queryFn: () => libroIvaVentasApi.getTotales(filter),
    enabled: !!fechaDesde && !!fechaHasta,
  });

  const { data: alicuotas } = useQuery({
    queryKey: ['libro-iva-alicuotas', filter],
    queryFn: () => libroIvaVentasApi.getAlicuotas(filter),
    enabled: !!fechaDesde && !!fechaHasta,
  });

  const { data: puntosVenta } = useQuery({
    queryKey: ['libro-iva-puntos-venta'],
    queryFn: () => libroIvaVentasApi.getPuntosDeVenta(),
    staleTime: 5 * 60 * 1000,
  });

  // ── Período label ───────────────────────────────
  const periodoLabel = useMemo(() => {
    const desde = dayjs(fechaDesde);
    const hasta = dayjs(fechaHasta);
    if (desde.month() === hasta.month() && desde.year() === hasta.year()) {
      const mes = desde.locale('es').format('MMMM YYYY');
      return mes.charAt(0).toUpperCase() + mes.slice(1);
    }
    return `${desde.format('DD/MM/YYYY')} - ${hasta.format('DD/MM/YYYY')}`;
  }, [fechaDesde, fechaHasta]);

  // ── Export Excel (client-side via CSV) ──────────
  const handleExportExcel = () => {
    if (!comprobantes?.length) {
      message.warning('No hay datos para exportar');
      return;
    }
    const headers = ['Fecha', 'Tipo Comp.', 'PV', 'Número', 'CAE', 'Cliente', 'CUIT/DNI',
      'Neto No Gravado', 'Neto Gravado', 'IVA', 'Imp. Interno', 'Total'];
    const rows = comprobantes.map(c => [
      dayjs(c.FECHA).format('DD/MM/YYYY'),
      c.TIPO_COMPROBANTE_DESCRIPCION,
      c.PUNTO_VENTA_ID,
      c.NUMERO_FISCAL,
      c.CAE || '',
      c.CLIENTE_NOMBRE,
      c.CLIENTE_CUIT,
      c.NETO_NO_GRAVADO.toFixed(2),
      c.NETO_GRAVADO.toFixed(2),
      c.IVA_TOTAL.toFixed(2),
      c.IMPUESTO_INTERNO.toFixed(2),
      c.TOTAL.toFixed(2),
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(';')).join('\n');
    downloadFile(csv, `LibroIVA_Ventas_${dayjs(fechaDesde).format('YYYYMM')}.csv`, 'text/csv;charset=utf-8');
    message.success('Archivo exportado');
  };

  // ── Export CITI (AFIP) ──────────────────────────
  const handleExportCiti = async () => {
    if (!comprobantes?.length) {
      message.warning('No hay datos para exportar');
      return;
    }
    try {
      const data = await libroIvaVentasApi.exportCiti(filter);
      const periodo = dayjs(fechaDesde).format('YYYYMM');
      downloadFile(data.comprobantes, `VENTAS_CBTE_${periodo}.txt`, 'text/plain');
      setTimeout(() => {
        downloadFile(data.alicuotas, `VENTAS_ALIC_${periodo}.txt`, 'text/plain');
      }, 500);
      message.success('Archivos CITI exportados (Comprobantes + Alícuotas)');
    } catch {
      message.error('Error al exportar archivos CITI');
    }
  };

  // ── Table columns ───────────────────────────────
  const columns: TableColumnType<LibroIvaComprobante>[] = [
    {
      title: 'Fecha',
      dataIndex: 'FECHA',
      width: 95,
      align: 'center',
      render: (v: string) => (
        <Text style={{ fontSize: 12 }}>{dayjs(v).format('DD/MM/YYYY')}</Text>
      ),
      sorter: (a, b) => dayjs(a.FECHA).unix() - dayjs(b.FECHA).unix(),
      defaultSortOrder: 'ascend',
    },
    {
      title: 'Comprobante',
      dataIndex: 'TIPO_COMPROBANTE_DESCRIPCION',
      width: 155,
      align: 'center',
      render: (v: string, record) => {
        const isNC = record.TIPO_COMPROBANTE.startsWith('NC');
        const isND = record.TIPO_COMPROBANTE.startsWith('ND');
        const color = isNC ? 'red' : isND ? 'orange' : 'blue';
        return <Tag color={color} style={{ margin: 0, fontWeight: 600 }}>{v}</Tag>;
      },
    },
    {
      title: 'PV',
      dataIndex: 'PUNTO_VENTA_ID',
      width: 52,
      align: 'center',
      render: (v: number) => (
        <Text type="secondary" style={{ fontSize: 12 }}>{String(v).padStart(4, '0')}</Text>
      ),
    },
    {
      title: 'Número',
      dataIndex: 'NUMERO_FISCAL',
      width: 115,
      align: 'center',
      render: (v: string) => (
        <Text copyable style={{ fontFamily: 'monospace', fontSize: 11.5 }}>{v}</Text>
      ),
    },
    {
      title: 'CAE',
      dataIndex: 'CAE',
      width: 148,
      align: 'center',
      render: (v: string) =>
        v ? (
          <Text copyable style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text>
        ) : (
          <Tag color="warning" style={{ margin: 0, fontSize: 11 }}>Sin CAE</Tag>
        ),
    },
    {
      title: 'Cliente',
      dataIndex: 'CLIENTE_NOMBRE',
      ellipsis: true,
      render: (v: string) => <Text style={{ fontWeight: 500 }}>{v}</Text>,
    },
    {
      title: 'CUIT / DNI',
      dataIndex: 'CLIENTE_CUIT',
      width: 122,
      align: 'center',
      render: (v: string) => (
        <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text>
      ),
    },
    {
      title: 'No Gravado',
      dataIndex: 'NETO_NO_GRAVADO',
      width: 115,
      align: 'right',
      render: (v: number) => (
        <Text type={v === 0 ? 'secondary' : undefined} style={{ fontSize: 12.5 }}>
          {v === 0 ? '—' : fmtMoney(v)}
        </Text>
      ),
      sorter: (a, b) => a.NETO_NO_GRAVADO - b.NETO_NO_GRAVADO,
    },
    {
      title: 'Neto Gravado',
      dataIndex: 'NETO_GRAVADO',
      width: 120,
      align: 'right',
      render: (v: number) => (
        <Text strong style={{ fontSize: 12.5 }}>{fmtMoney(v)}</Text>
      ),
      sorter: (a, b) => a.NETO_GRAVADO - b.NETO_GRAVADO,
    },
    {
      title: 'IVA',
      dataIndex: 'IVA_TOTAL',
      width: 108,
      align: 'right',
      render: (v: number) => (
        <Text style={{ color: '#1890ff', fontSize: 12.5 }}>{fmtMoney(v)}</Text>
      ),
      sorter: (a, b) => a.IVA_TOTAL - b.IVA_TOTAL,
    },
    {
      title: 'Imp. Int.',
      dataIndex: 'IMPUESTO_INTERNO',
      width: 98,
      align: 'right',
      render: (v: number) => (
        <Text type={v === 0 ? 'secondary' : undefined} style={{ fontSize: 12.5 }}>
          {v === 0 ? '—' : fmtMoney(v)}
        </Text>
      ),
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      width: 125,
      align: 'right',
      fixed: 'right',
      render: (v: number, record) => {
        const isNC = record.TIPO_COMPROBANTE.startsWith('NC');
        return (
          <Text strong style={{ color: isNC ? '#ff4d4f' : '#3f8600', fontSize: 13 }}>
            {fmtMoney(v)}
          </Text>
        );
      },
      sorter: (a, b) => a.TOTAL - b.TOTAL,
    },
  ];

  // ── Alícuotas columns ───────────────────────────
  const alicuotaColumns: TableColumnType<LibroIvaAlicuota>[] = [
    {
      title: 'Alícuota',
      dataIndex: 'ALICUOTA_DESCRIPCION',
      ellipsis: true,
    },
    {
      title: 'Comp.',
      dataIndex: 'CANTIDAD_COMPROBANTES',
      width: 70,
      align: 'center',
      render: (v: number) => (
        <Badge count={v} color="#1890ff" overflowCount={9999} />
      ),
    },
    {
      title: 'Base Imponible',
      dataIndex: 'BASE_IMPONIBLE',
      width: 140,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Débito Fiscal',
      dataIndex: 'DEBITO_FISCAL',
      width: 130,
      align: 'right',
      render: (v: number) => (
        <Text strong style={{ color: '#1890ff' }}>{fmtMoney(v)}</Text>
      ),
    },
  ];

  // ── Render ──────────────────────────────────────
  return (
    <div className="page-enter">

      {/* ── Page Header (guión dorado) ─────────── */}
      <div className="page-header">
        <div>
          <Title level={3}>
            <AuditOutlined style={{ marginRight: 10, color: 'var(--rg-gold)' }} />
            Libro IVA Ventas
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            RG 3685/2014 · AFIP Argentina
            {periodoLabel && (
              <>
                {' — '}
                <Text strong style={{ fontSize: 12, color: 'var(--rg-text)' }}>{periodoLabel}</Text>
              </>
            )}
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} size="small">
            Actualizar
          </Button>
          <Tooltip title="Exportar planilla CSV compatible con Excel">
            <Button
              icon={<FileExcelOutlined />}
              onClick={handleExportExcel}
              disabled={!comprobantes?.length}
            >
              Exportar Excel
            </Button>
          </Tooltip>
          <Tooltip title="Generar archivos TXT para importar en AFIP CITI Ventas">
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExportCiti}
              disabled={!comprobantes?.length}
              className="btn-gold"
            >
              AFIP CITI
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* ── KPI Cards ─────────────────────────── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card-flat">
            <Statistic
              title="Comprobantes"
              value={totales?.CANTIDAD_COMPROBANTES ?? 0}
              prefix={<FileTextOutlined />}
            />
            <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {totales?.CANTIDAD_FACTURAS ?? 0} fact.
              </Text>
              <Divider type="vertical" style={{ margin: 0 }} />
              <Text style={{ fontSize: 11, color: '#ff4d4f' }}>
                {totales?.CANTIDAD_NC ?? 0} NC
              </Text>
            </div>
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card-flat">
            <Statistic
              title="Neto Gravado"
              value={totales?.TOTAL_NETO_GRAVADO ?? 0}
              precision={2}
              prefix="$"
              valueStyle={{ fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card-flat">
            <Statistic
              title="IVA Débito Fiscal"
              value={totales?.TOTAL_IVA ?? 0}
              precision={2}
              prefix={<PercentageOutlined style={{ marginRight: 2 }} />}
              valueStyle={{ color: '#1890ff', fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card-flat">
            <Statistic
              title="Neto No Gravado"
              value={totales?.TOTAL_NETO_NO_GRAVADO ?? 0}
              precision={2}
              prefix="$"
              valueStyle={{ fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card-flat">
            <Statistic
              title="Imp. Internos"
              value={totales?.TOTAL_IMPUESTO_INTERNO ?? 0}
              precision={2}
              prefix="$"
              valueStyle={{ fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card
            size="small"
            className="rg-card-flat"
            style={{ borderColor: 'var(--rg-gold)', borderWidth: 2 }}
          >
            <Statistic
              title={<Text strong style={{ color: 'var(--rg-gold)' }}>Total General</Text>}
              value={totales?.TOTAL_GENERAL ?? 0}
              precision={2}
              prefix="$"
              valueStyle={{
                color: (totales?.TOTAL_GENERAL ?? 0) >= 0 ? '#3f8600' : '#ff4d4f',
                fontSize: 20,
                fontWeight: 700,
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Filtros ───────────────────────────── */}
      <Card
        size="small"
        className="rg-card-flat"
        style={{ marginBottom: 14 }}
        styles={{ body: { padding: '10px 14px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <DateFilterPopover
            preset={datePreset}
            fechaDesde={fechaDesde}
            fechaHasta={fechaHasta}
            onPresetChange={(p, d, h) => {
              setDatePreset(p);
              if (d) setFechaDesde(d);
              if (h) setFechaHasta(h);
            }}
            onRangeChange={(d, h) => {
              setDatePreset(undefined);
              if (d) setFechaDesde(d);
              if (h) setFechaHasta(h);
            }}
          />
          <Select
            placeholder="Punto de Venta"
            allowClear
            value={puntoVentaId}
            onChange={v => setPuntoVentaId(v)}
            style={{ width: 170 }}
            options={puntosVenta?.map(pv => ({ value: pv.PUNTO_VENTA_ID, label: pv.NOMBRE })) ?? []}
          />
          <Select
            placeholder="Tipo de Comprobante"
            value={tipoComprobante}
            onChange={v => setTipoComprobante(v)}
            style={{ width: 185 }}
            options={TIPO_COMPROBANTE_OPTIONS}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Switch
              size="small"
              checked={incluirNoCobradas}
              onChange={setIncluirNoCobradas}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>Incluir no cobradas</Text>
          </div>
          <div style={{ flex: 1 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {comprobantes?.length ?? 0} registros
          </Text>
        </div>
      </Card>

      {/* ── Tabla de comprobantes (ancho completo) ── */}
      <Card
        className="rg-card-flat"
        size="small"
        style={{ marginBottom: 16 }}
        styles={{ body: { padding: 0 } }}
      >
        <Table<LibroIvaComprobante>
          className="rg-table"
          rowKey="VENTA_ID"
          columns={columns}
          dataSource={comprobantes}
          loading={isLoading}
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            pageSizeOptions: ['25', '50', '100', '200'],
            showTotal: (t, range) => `${range[0]}–${range[1]} de ${t} comprobantes`,
            style: { padding: '8px 16px' },
          }}
          rowClassName={record =>
            record.TIPO_COMPROBANTE.startsWith('NC') ? 'libro-iva-row-nc' : ''
          }
        />
      </Card>

      {/* ── Analítica inferior ────────────────── */}
      <Row gutter={[16, 16]}>
        {/* ── Totales por alícuota ───────────── */}
        <Col xs={24} lg={14}>
          <Card
            className="rg-card-flat"
            size="small"
            title={
              <Space>
                <PercentageOutlined style={{ color: '#1890ff' }} />
                <span>Totales por Alícuota IVA</span>
              </Space>
            }
          >
            <Table<LibroIvaAlicuota>
              rowKey="ALICUOTA"
              columns={alicuotaColumns}
              dataSource={alicuotas}
              size="small"
              pagination={false}
              loading={isLoading}
            />
          </Card>
        </Col>

        {/* ── Resumen del período ────────────── */}
        <Col xs={24} lg={10}>
          <Card
            className="rg-card-flat"
            size="small"
            style={{ borderColor: 'var(--rg-gold)', borderWidth: 2 }}
            title={
              <Space>
                <BankOutlined style={{ color: 'var(--rg-gold)' }} />
                <span>Resumen del Período</span>
              </Space>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0' }}>
              <SummaryRow label="Neto Gravado" value={totales?.TOTAL_NETO_GRAVADO ?? 0} />
              <SummaryRow label="Neto No Gravado" value={totales?.TOTAL_NETO_NO_GRAVADO ?? 0} />
              <SummaryRow label="IVA Débito Fiscal" value={totales?.TOTAL_IVA ?? 0} color="#1890ff" />
              <SummaryRow label="Imp. Internos" value={totales?.TOTAL_IMPUESTO_INTERNO ?? 0} />
              <Divider style={{ margin: '8px 0', borderColor: 'var(--rg-gold)' }} />
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '6px 10px',
              }}>
                <Text strong style={{ fontSize: 14 }}>
                  <DollarOutlined style={{ marginRight: 6 }} />
                  TOTAL GENERAL
                </Text>
                <Text strong style={{
                  fontSize: 20,
                  color: (totales?.TOTAL_GENERAL ?? 0) >= 0 ? '#3f8600' : '#ff4d4f',
                }}>
                  {fmtMoney(totales?.TOTAL_GENERAL ?? 0)}
                </Text>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

// ── Helper components ─────────────────────────────
function SummaryRow({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 10px', borderRadius: 6, background: 'rgba(0,0,0,0.02)',
    }}>
      <Text type="secondary" style={{ fontSize: 12.5 }}>{label}</Text>
      <Text strong style={{ fontSize: 13.5, color }}>{fmtMoney(value)}</Text>
    </div>
  );
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
