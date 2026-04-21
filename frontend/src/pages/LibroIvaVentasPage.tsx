import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Table, Space, Typography, Button, Card, Row, Col, Statistic, Select,
  Switch, Tag, Tooltip, App,
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
      title: 'Fecha', dataIndex: 'FECHA', width: 100, align: 'center',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY'),
      sorter: (a, b) => dayjs(a.FECHA).unix() - dayjs(b.FECHA).unix(),
      defaultSortOrder: 'ascend',
    },
    {
      title: 'Tipo', dataIndex: 'TIPO_COMPROBANTE_DESCRIPCION', width: 170, align: 'center',
      render: (v: string, record) => {
        const isNC = record.TIPO_COMPROBANTE.startsWith('NC');
        return <Tag color={isNC ? 'red' : 'blue'} style={{ margin: 0 }}>{v}</Tag>;
      },
    },
    {
      title: 'PV', dataIndex: 'PUNTO_VENTA_ID', width: 60, align: 'center',
    },
    {
      title: 'Número', dataIndex: 'NUMERO_FISCAL', width: 120, align: 'center',
      render: (v: string) => <Text copyable style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'CAE', dataIndex: 'CAE', width: 140, align: 'center',
      render: (v: string) => v
        ? <Text copyable style={{ fontFamily: 'monospace', fontSize: 11 }}>{v}</Text>
        : <Text type="secondary">-</Text>,
    },
    {
      title: 'Cliente', dataIndex: 'CLIENTE_NOMBRE', ellipsis: true, width: 200,
    },
    {
      title: 'CUIT/DNI', dataIndex: 'CLIENTE_CUIT', width: 120, align: 'center',
      render: (v: string) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'No Gravado', dataIndex: 'NETO_NO_GRAVADO', width: 120, align: 'right',
      render: (v: number) => fmtMoney(v),
      sorter: (a, b) => a.NETO_NO_GRAVADO - b.NETO_NO_GRAVADO,
    },
    {
      title: 'Gravado', dataIndex: 'NETO_GRAVADO', width: 120, align: 'right',
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
      sorter: (a, b) => a.NETO_GRAVADO - b.NETO_GRAVADO,
    },
    {
      title: 'IVA', dataIndex: 'IVA_TOTAL', width: 110, align: 'right',
      render: (v: number) => fmtMoney(v),
      sorter: (a, b) => a.IVA_TOTAL - b.IVA_TOTAL,
    },
    {
      title: 'Imp. Int.', dataIndex: 'IMPUESTO_INTERNO', width: 110, align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Total', dataIndex: 'TOTAL', width: 130, align: 'right',
      render: (v: number, record) => {
        const isNC = record.TIPO_COMPROBANTE.startsWith('NC');
        return <Text strong style={{ color: isNC ? '#ff4d4f' : '#3f8600' }}>{fmtMoney(v)}</Text>;
      },
      sorter: (a, b) => a.TOTAL - b.TOTAL,
    },
  ];

  // ── Alícuotas columns ───────────────────────────
  const alicuotaColumns: TableColumnType<LibroIvaAlicuota>[] = [
    {
      title: 'Alícuota', dataIndex: 'ALICUOTA_DESCRIPCION', ellipsis: true,
    },
    {
      title: 'Cant.', dataIndex: 'CANTIDAD_COMPROBANTES', width: 70, align: 'center',
    },
    {
      title: 'Base Imponible', dataIndex: 'BASE_IMPONIBLE', width: 140, align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Débito Fiscal', dataIndex: 'DEBITO_FISCAL', width: 140, align: 'right',
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
    },
  ];

  // ── Render ──────────────────────────────────────
  return (
    <div className="page-enter">
      {/* ── Banner Header ─────────────────────── */}
      <div
        className="animate-fade-in"
        style={{
          background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
          borderRadius: 14,
          padding: '24px 28px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div>
          <Title level={3} style={{ color: '#EABD23', margin: 0, fontWeight: 700 }}>
            <AuditOutlined style={{ marginRight: 10 }} />
            Libro IVA Ventas
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4, display: 'block' }}>
            Conforme a normativa AFIP Argentina — RG 3685/2014
          </Text>
          {periodoLabel && (
            <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 12, marginTop: 2, display: 'block' }}>
              Período: {periodoLabel}
            </Text>
          )}
        </div>
        <Space>
          <Tooltip title="Exportar CSV (Excel)">
            <Button
              icon={<FileExcelOutlined />}
              onClick={handleExportExcel}
              disabled={!comprobantes?.length}
              style={{
                background: 'rgba(82,196,26,0.15)',
                borderColor: 'rgba(82,196,26,0.4)',
                color: '#52c41a',
              }}
            >
              Excel
            </Button>
          </Tooltip>
          <Tooltip title="Exportar CITI Ventas para AFIP (TXT)">
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExportCiti}
              disabled={!comprobantes?.length}
              style={{
                background: 'rgba(234,189,35,0.15)',
                borderColor: 'rgba(234,189,35,0.4)',
                color: '#EABD23',
              }}
            >
              AFIP (CITI)
            </Button>
          </Tooltip>
        </Space>
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 3,
          background: 'linear-gradient(90deg, #EABD23, transparent)',
        }} />
      </div>

      {/* ── KPI Stats ─────────────────────────── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }} className="stagger">
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Comprobantes"
              value={totales?.CANTIDAD_COMPROBANTES ?? 0}
              prefix={<FileTextOutlined />}
              suffix={
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {totales?.CANTIDAD_FACTURAS ?? 0} fact. · {totales?.CANTIDAD_NC ?? 0} NC
                </Text>
              }
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Neto Gravado"
              value={totales?.TOTAL_NETO_GRAVADO ?? 0}
              precision={2} prefix="$"
              valueStyle={{ fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card">
            <Statistic
              title="No Gravado"
              value={totales?.TOTAL_NETO_NO_GRAVADO ?? 0}
              precision={2} prefix="$"
              valueStyle={{ fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Imp. Internos"
              value={totales?.TOTAL_IMPUESTO_INTERNO ?? 0}
              precision={2} prefix="$"
              valueStyle={{ fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card">
            <Statistic
              title="IVA Débito Fiscal"
              value={totales?.TOTAL_IVA ?? 0}
              precision={2} prefix="$"
              valueStyle={{ color: '#1890ff', fontSize: 18 }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small" className="rg-card" style={{ borderColor: '#EABD23' }}>
            <Statistic
              title={<Text strong style={{ color: '#EABD23' }}>TOTAL GENERAL</Text>}
              value={totales?.TOTAL_GENERAL ?? 0}
              precision={2} prefix="$"
              valueStyle={{
                color: (totales?.TOTAL_GENERAL ?? 0) >= 0 ? '#3f8600' : '#ff4d4f',
                fontSize: 20, fontWeight: 700,
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Filters ───────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10,
        marginBottom: 14, padding: '10px 14px',
        background: 'rgba(0,0,0,0.02)', borderRadius: 10,
        border: '1px solid rgba(0,0,0,0.04)',
      }}>
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
          options={[
            ...(puntosVenta?.map(pv => ({ value: pv.PUNTO_VENTA_ID, label: pv.NOMBRE })) ?? []),
          ]}
        />
        <Select
          placeholder="Tipo Comprobante"
          value={tipoComprobante}
          onChange={v => setTipoComprobante(v)}
          style={{ width: 160 }}
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
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} size="small">
          Actualizar
        </Button>
      </div>

      {/* ── Main & Alícuotas layout ───────────── */}
      <Row gutter={[16, 16]}>
        {/* ── Comprobantes table ─────────────── */}
        <Col xs={24} xl={17}>
          <Table<LibroIvaComprobante>
            className="rg-table"
            rowKey="VENTA_ID"
            columns={columns}
            dataSource={comprobantes}
            loading={isLoading}
            size="small"
            scroll={{ x: 1500 }}
            pagination={{
              pageSize: 50,
              showSizeChanger: true,
              pageSizeOptions: ['25', '50', '100'],
              showTotal: t => `${t} comprobantes`,
            }}
            rowClassName={record =>
              record.TIPO_COMPROBANTE.startsWith('NC') ? 'libro-iva-row-nc' : ''
            }
          />
        </Col>

        {/* ── Alícuotas side card ───────────── */}
        <Col xs={24} xl={7}>
          <Card
            className="rg-card animate-fade-up"
            size="small"
            style={{ borderRadius: 14, overflow: 'hidden' }}
            styles={{
              header: {
                background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
                borderBottom: '2px solid #1890ff',
                padding: '12px 16px',
              },
              body: { padding: '8px 0' },
            }}
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <PercentageOutlined style={{ color: '#1890ff', fontSize: 16 }} />
                <Text strong style={{ color: '#fff', fontSize: 13 }}>Totales por Alícuota IVA</Text>
              </div>
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

          {/* ── Resumen card ────────────────── */}
          <Card
            className="rg-card animate-fade-up"
            size="small"
            style={{ borderRadius: 14, marginTop: 16, overflow: 'hidden' }}
            styles={{
              header: {
                background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
                borderBottom: '2px solid #EABD23',
                padding: '12px 16px',
              },
              body: { padding: 16 },
            }}
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <BankOutlined style={{ color: '#EABD23', fontSize: 16 }} />
                <Text strong style={{ color: '#fff', fontSize: 13 }}>Resumen del Período</Text>
              </div>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <SummaryRow label="Neto Gravado" value={totales?.TOTAL_NETO_GRAVADO ?? 0} />
              <SummaryRow label="Neto No Gravado" value={totales?.TOTAL_NETO_NO_GRAVADO ?? 0} />
              <SummaryRow label="IVA Débito Fiscal" value={totales?.TOTAL_IVA ?? 0} color="#1890ff" />
              <SummaryRow label="Imp. Internos" value={totales?.TOTAL_IMPUESTO_INTERNO ?? 0} />
              <div style={{
                borderTop: '2px solid #EABD23',
                paddingTop: 10, marginTop: 4,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <Text strong style={{ fontSize: 14 }}>
                  <DollarOutlined style={{ marginRight: 6 }} />
                  TOTAL GENERAL
                </Text>
                <Text strong style={{
                  fontSize: 18,
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
