import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Empty, Row, Segmented, Space, Typography } from 'antd';
import {
  ArrowRightOutlined,
  BarChartOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  TagsOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { REPORT_DEFINITIONS, GROUP_LABELS, type ReportDefinition, type ReportGroup } from '../config/reports.config';
import { reportsApi, type ReportFilter } from '../services/reports.api';
import { ReportDrawer } from '../components/reports/ReportDrawer';

const { Title, Text, Paragraph } = Typography;

type Granularity = 'day' | 'week' | 'month';

export function ReportsPage() {
  const [activeGroup, setActiveGroup] = useState<ReportGroup>('ventas');
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const reportsByGroup = useMemo(() => {
    const map: Record<ReportGroup, ReportDefinition[]> = { ventas: [], compras: [], clientes: [], productos: [] };
    REPORT_DEFINITIONS.forEach(r => map[r.group].push(r));
    return map;
  }, []);

  const activeReport = useMemo(
    () => REPORT_DEFINITIONS.find(r => r.key === activeKey) ?? null,
    [activeKey],
  );

  return (
    <div className="page-enter">
      <div className="page-header">
        <div>
          <Title level={3}>
            <BarChartOutlined style={{ marginRight: 10, color: 'var(--rg-gold)' }} />
            Reportes
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Análisis integral · Ventas, Compras, Clientes y Productos
          </Text>
        </div>
        <Segmented
          value={activeGroup}
          onChange={v => setActiveGroup(v as ReportGroup)}
          options={[
            { label: 'Ventas', value: 'ventas', icon: <BarChartOutlined /> },
            { label: 'Compras', value: 'compras', icon: <ShoppingCartOutlined /> },
            { label: 'Clientes', value: 'clientes', icon: <TeamOutlined /> },
            { label: 'Productos', value: 'productos', icon: <TagsOutlined /> },
          ]}
        />
      </div>

      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Elegí un reporte para abrirlo. Cada uno incluye filtros (fechas, punto de venta, incluir
        notas de crédito), KPIs, visualización y exportación a Excel / PDF.
      </Text>

      <ReportsGrid
        reports={reportsByGroup[activeGroup]}
        onOpen={key => setActiveKey(key)}
      />

      {activeReport && (
        <ReportDrawerHost
          key={activeReport.key}
          report={activeReport}
          onClose={() => setActiveKey(null)}
        />
      )}
    </div>
  );
}

interface ReportsGridProps {
  reports: ReportDefinition[];
  onOpen: (key: string) => void;
}

function ReportsGrid({ reports, onOpen }: ReportsGridProps) {
  if (!reports.length) {
    return <Empty description="No hay reportes configurados" />;
  }
  return (
    <Row gutter={[16, 16]}>
      {reports.map(r => (
        <Col key={r.key} xs={24} sm={12} md={8} lg={6}>
          <Card
            hoverable
            className="rg-card"
            onClick={() => onOpen(r.key)}
            styles={{ body: { padding: 18 } }}
          >
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    width: 36,
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(234, 189, 35, 0.15)',
                    color: 'var(--rg-gold-dark)',
                    borderRadius: 8,
                    fontSize: 18,
                  }}
                >
                  {r.icon}
                </span>
                <Title level={5} style={{ margin: 0, flex: 1 }}>
                  {r.title}
                </Title>
              </div>
              <Paragraph type="secondary" style={{ margin: 0, fontSize: 12, minHeight: 48 }}>
                {r.description}
              </Paragraph>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 4,
                }}
              >
                <TagLike>{GROUP_LABELS[r.group]}</TagLike>
                <Text style={{ color: 'var(--rg-gold-dark)', fontSize: 12 }}>
                  Abrir <ArrowRightOutlined />
                </Text>
              </div>
            </Space>
          </Card>
        </Col>
      ))}
    </Row>
  );
}

function TagLike({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: '2px 8px',
        background: 'var(--rg-white-smoke)',
        border: '1px solid var(--rg-border)',
        borderRadius: 10,
        color: 'var(--rg-text-light)',
      }}
    >
      {children}
    </span>
  );
}

interface ReportDrawerHostProps {
  report: ReportDefinition;
  onClose: () => void;
}

function ReportDrawerHost({ report, onClose }: ReportDrawerHostProps) {
  const [filters, setFilters] = useState<ReportFilter>(report.defaultFilters);
  const [granularity, setGranularity] = useState<Granularity>('day');

  const fetchKey = ['reports', report.key, filters, granularity];

  const { data, isLoading, refetch } = useQuery<any[]>({
    queryKey: fetchKey,
    queryFn: () => {
      if (report.key === 'sales-timeline') {
        return reportsApi.getSalesTimeline(filters, granularity);
      }
      return report.fetch(filters);
    },
  });

  const rows = data ?? [];

  const heatmapData = useMemo(() => {
    if (report.key !== 'sales-heatmap') return [];
    return rows.map((r: any) => ({ dow: r.DOW, hour: r.HOUR, value: r.VENTAS }));
  }, [rows, report.key]);

  const kpis = useMemo(() => report.kpis?.(rows, filters) ?? [], [report, rows, filters]);
  const chart = useMemo(() => {
    if (report.key === 'sales-heatmap') {
      return {
        type: 'heatmap' as const,
        data: heatmapData,
        hourFrom: 7,
        hourTo: 23,
      };
    }
    return report.chart?.(rows, filters);
  }, [report, rows, filters, heatmapData]);

  const granularityControl =
    report.key === 'sales-timeline' ? (
      <Space size={6}>
        <Text type="secondary" style={{ fontSize: 12 }}>Agrupar por</Text>
        <Segmented
          size="small"
          value={granularity}
          onChange={v => setGranularity(v as Granularity)}
          options={[
            { label: 'Día', value: 'day' },
            { label: 'Semana', value: 'week' },
            { label: 'Mes', value: 'month' },
          ]}
        />
      </Space>
    ) : null;

  return (
    <ReportDrawer
      open={true}
      title={report.title}
      description={report.description}
      icon={report.icon}
      filterValues={filters}
      onFilterChange={next => setFilters(prev => ({ ...prev, ...next }))}
      isLoading={isLoading}
      data={rows}
      columns={report.columns}
      kpis={kpis}
      chart={chart}
      tableScrollX={report.tableScrollX}
      defaultPageSize={report.defaultPageSize ?? 25}
      showLimit={report.filterOptions?.showLimit}
      showIncluirNc={report.filterOptions?.showIncluirNc}
      showRefresh={true}
      extraToolbar={granularityControl}
      filterExtras={null}
      onClose={onClose}
      onRefresh={() => refetch()}
      excelColumns={report.excelColumns}
      excelTitle={report.title}
      pdfColumns={report.pdfColumns}
      pdfTitle={report.title}
      pdfSubtitle={periodoLabel(filters)}
      exportFileName={`${slug(report.title)}_${dayjs().format('YYYYMMDD_HHmmss')}`}
      emptyText={report.emptyText}
    />
  );
}

function periodoLabel(f: ReportFilter): string {
  if (f.fechaDesde === f.fechaHasta) return dayjs(f.fechaDesde).format('DD/MM/YYYY');
  return `${dayjs(f.fechaDesde).format('DD/MM/YYYY')} – ${dayjs(f.fechaHasta).format('DD/MM/YYYY')}`;
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '_');
}