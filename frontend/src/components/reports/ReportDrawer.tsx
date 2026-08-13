import { ReactNode } from 'react';
import { Button, Drawer, Space, Spin, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { CloseOutlined, FileExcelOutlined, FilePdfOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ReportChart, type ReportChartKind } from './ReportChart';
import { ReportKpis, type ReportKpiSpec } from './ReportKpis';
import { ReportsFiltersBar, type ReportFiltersValues } from './ReportsFiltersBar';
import { exportToExcel, type ExcelColumn } from '../../utils/exportExcel';
import { exportToPdf, type PdfColumn } from '../../utils/exportPdf';
import { notify } from '../../utils/notify';

const { Title, Text } = Typography;

interface ReportDrawerProps<TRow = any> {
  open: boolean;
  title: string;
  description?: string;
  icon?: ReactNode;
  filterValues: ReportFiltersValues;
  onFilterChange: (next: Partial<ReportFiltersValues>) => void;
  isLoading?: boolean;
  data?: TRow[];
  columns: TableColumnsType<TRow>;
  kpis?: ReportKpiSpec[];
  chart?: ReportChartKind;
  tableScrollX?: number | string;
  pageSize?: number;
  defaultPageSize?: number;
  showLimit?: boolean;
  showIncluirNc?: boolean;
  showRefresh?: boolean;
  extraToolbar?: ReactNode;
  filterExtras?: ReactNode;
  onClose: () => void;
  onRefresh?: () => void;
  excelColumns?: ExcelColumn<TRow>[];
  excelTitle?: string;
  pdfColumns?: PdfColumn<TRow>[];
  pdfTitle?: string;
  pdfSubtitle?: string;
  pdfFooterSummary?: string[][];
  exportFileName?: string;
  emptyText?: string;
}

export function ReportDrawer<TRow extends Record<string, any> = any>({
  open,
  title,
  description,
  icon,
  filterValues,
  onFilterChange,
  isLoading,
  data,
  columns,
  kpis,
  chart,
  tableScrollX,
  defaultPageSize = 25,
  showLimit,
  showIncluirNc,
  showRefresh = true,
  extraToolbar,
  filterExtras,
  onClose,
  onRefresh,
  excelColumns,
  excelTitle,
  pdfColumns,
  pdfTitle,
  pdfSubtitle,
  pdfFooterSummary,
  exportFileName,
  emptyText,
}: ReportDrawerProps<TRow>) {
  const rows: TRow[] = data ?? [];

  const rangoLabel = filterValues.fechaDesde === filterValues.fechaHasta
    ? dayjs(filterValues.fechaDesde).format('DD/MM/YYYY')
    : `${dayjs(filterValues.fechaDesde).format('DD/MM/YYYY')} – ${dayjs(filterValues.fechaHasta).format('DD/MM/YYYY')}`;

  const handleExcel = () => {
    if (!excelColumns || rows.length === 0) {
      notify.warning('No hay datos para exportar');
      return;
    }
    try {
      exportToExcel({
        title: excelTitle ?? title,
        subtitle: rangoLabel,
        columns: excelColumns,
        data: rows,
        fileName: exportFileName,
      });
      notify.success('Excel generado');
    } catch (e: any) {
      notify.error(`Error al generar Excel: ${e.message ?? e}`);
    }
  };

  const handlePdf = () => {
    if (!pdfColumns || rows.length === 0) {
      notify.warning('No hay datos para exportar');
      return;
    }
    try {
      exportToPdf({
        title: pdfTitle ?? title,
        subtitle: pdfSubtitle,
        meta: rangoLabel,
        columns: pdfColumns,
        data: rows,
        footerSummary: pdfFooterSummary,
        fileName: exportFileName,
      });
      notify.success('PDF generado');
    } catch (e: any) {
      notify.error(`Error al generar PDF: ${e.message ?? e}`);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="min(96vw, 1180px)"
      destroyOnClose
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--rg-gold)' }}>{icon}</span>
          <Title level={4} style={{ margin: 0 }}>{title}</Title>
        </div>
      }
      closeIcon={<CloseOutlined />}
      styles={{
        body: { padding: '12px 20px 20px' },
        header: { borderBottom: '1px solid var(--rg-border)', paddingBottom: 10 },
      }}
      extra={
        <Space>
          {excelColumns && (
            <Button icon={<FileExcelOutlined />} size="small" disabled={!rows.length} onClick={handleExcel}>
              Excel
            </Button>
          )}
          {pdfColumns && (
            <Button icon={<FilePdfOutlined />} size="small" disabled={!rows.length} className="btn-gold" onClick={handlePdf}>
              PDF
            </Button>
          )}
          <Button icon={<CloseOutlined />} size="small" onClick={onClose}>Cerrar</Button>
        </Space>
      }
    >
      {description && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 13 }}>
          {description}
        </Text>
      )}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          marginBottom: 12,
        }}
      >
        <ReportsFiltersBar
          fechaDesde={filterValues.fechaDesde}
          fechaHasta={filterValues.fechaHasta}
          puntoVentaId={filterValues.puntoVentaId}
          incluirNc={filterValues.incluirNc}
          limit={filterValues.limit}
          onChange={next => onFilterChange(next)}
          showLimit={showLimit}
          showIncluirNc={showIncluirNc}
          extra={filterExtras}
        />
        <div style={{ flex: 1 }} />
        <Space>
          {showRefresh && onRefresh && (
            <Button icon={<ReloadOutlined />} size="small" onClick={onRefresh} loading={isLoading}>
              Actualizar
            </Button>
          )}
          {extraToolbar}
        </Space>
      </div>

      <Spin spinning={!!isLoading} tip="Cargando...">
        <ReportKpis kpis={kpis ?? []} />
        <ReportChart chart={chart} />

        <Table<TRow>
          className="rg-table"
          rowKey={(record, index) => String((record as any).VENTA_ID ?? (record as any).COMPROBANTE_ID ?? (record as any).CLIENTE_ID ?? (record as any).PROVEEDOR_ID ?? (record as any).PRODUCTO_ID ?? (record as any).ID ?? index)}
          columns={columns}
          dataSource={rows}
          size="small"
          scroll={{ x: tableScrollX ?? 'max-content' }}
          pagination={{
            pageSize: defaultPageSize,
            showSizeChanger: true,
            pageSizeOptions: ['10', '25', '50', '100'],
            showTotal: (total, range) => `${range[0]}-${range[1]} de ${total}`,
          }}
          locale={{
            emptyText: emptyText ?? 'Sin datos para los filtros seleccionados',
          }}
        />
      </Spin>
    </Drawer>
  );
}