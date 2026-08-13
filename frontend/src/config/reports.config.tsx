import { ReactNode } from 'react';
import type { TableColumnsType } from 'antd';
import {
  BarChartOutlined,
  DollarOutlined,
  PieChartOutlined,
  ProfileOutlined,
  ShoppingCartOutlined,
  StarOutlined,
  TagsOutlined,
  TeamOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import type { ExcelColumn } from '../utils/exportExcel';
import type { PdfColumn } from '../utils/exportPdf';
import { fmtMoney, fmtNum } from '../utils/format';
import dayjs from 'dayjs';
import {
  reportsApi,
  type ReportFilter,
  type RevenueByDimensionRow,
  type SalesByClientRow,
  type SalesByProductRow,
  type SalesBySucursalRow,
  type SalesHeatmapRow,
} from '../services/reports.api';
import type { ReportChartKind } from '../components/reports/ReportChart';
import type { ReportKpiSpec } from '../components/reports/ReportKpis';

export type ReportGroup = 'ventas' | 'compras' | 'clientes' | 'productos';

export interface ReportDefinition {
  key: string;
  title: string;
  group: ReportGroup;
  icon: ReactNode;
  description: string;
  defaultFilters: ReportFilter;
  filterOptions?: {
    showLimit?: boolean;
    showIncluirNc?: boolean;
  };
  fetch: (f: ReportFilter) => Promise<any[]>;
  kpis?: (rows: any[], f: ReportFilter) => ReportKpiSpec[];
  chart?: (rows: any[], f: ReportFilter) => ReportChartKind | undefined;
  columns: TableColumnsType<any>;
  tableScrollX?: number | string;
  excelColumns?: ExcelColumn<any>[];
  pdfColumns?: PdfColumn<any>[];
  emptyText?: string;
  defaultPageSize?: number;
}

const baseDateRange = (): { fechaDesde: string; fechaHasta: string } => {
  const today = dayjs();
  return {
    fechaDesde: today.startOf('month').format('YYYY-MM-DD'),
    fechaHasta: today.endOf('month').format('YYYY-MM-DD'),
  };
};

const defaultFilters = (): ReportFilter => ({ ...baseDateRange() });

const fmtPct = (n: number): string => `${n.toFixed(2)}%`;

const kpiParticipacion = (rows: RevenueByDimensionRow[]): ReportKpiSpec => {
  const top = rows[0];
  return {
    title: 'Top participación',
    value: top?.PARTICIPACION_PCT ?? 0,
    suffix: '%',
    numeric: true,
    precision: 2,
    formatter: v => fmtPct(v),
  };
};

const revenueKpis = (rows: RevenueByDimensionRow[]): ReportKpiSpec[] => {
  const total = rows.reduce((s, r) => s + r.TOTAL_VENDIDO, 0);
  const unidades = rows.reduce((s, r) => s + r.UNIDADES_VENDIDAS, 0);
  const ventas = rows.reduce((s, r) => s + r.CANTIDAD_VENTAS, 0);
  return [
    { title: 'Total vendido', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
    { title: 'Unidades vendidas', value: unidades, numeric: true, formatter: v => fmtNum(v) },
    { title: 'Ventas distintas', value: ventas, numeric: true, formatter: v => fmtNum(v) },
    kpiParticipacion(rows),
  ];
};

const revenueColumns = (): TableColumnsType<RevenueByDimensionRow> => [
  { title: 'Nombre', dataIndex: 'NOMBRE', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
  {
    title: 'Ventas',
    dataIndex: 'CANTIDAD_VENTAS',
    width: 100,
    align: 'center',
    render: (v: number) => fmtNum(v),
    sorter: (a, b) => a.CANTIDAD_VENTAS - b.CANTIDAD_VENTAS,
  },
  {
    title: 'Unidades',
    dataIndex: 'UNIDADES_VENDIDAS',
    width: 110,
    align: 'center',
    render: (v: number) => fmtNum(v),
    sorter: (a, b) => a.UNIDADES_VENDIDAS - b.UNIDADES_VENDIDAS,
  },
  {
    title: 'Total vendido',
    dataIndex: 'TOTAL_VENDIDO',
    width: 150,
    align: 'right',
    render: (v: number) => <strong>{fmtMoney(v)}</strong>,
    sorter: (a, b) => a.TOTAL_VENDIDO - b.TOTAL_VENDIDO,
    defaultSortOrder: 'descend',
  },
  {
    title: 'Participación',
    dataIndex: 'PARTICIPACION_PCT',
    width: 130,
    align: 'right',
    render: (v: number) => fmtPct(v),
    sorter: (a, b) => a.PARTICIPACION_PCT - b.PARTICIPACION_PCT,
  },
];

const revenueExcelColumns = (): ExcelColumn<RevenueByDimensionRow>[] => [
  { title: 'Nombre', dataIndex: 'NOMBRE', width: 36 },
  { title: 'Ventas', dataIndex: 'CANTIDAD_VENTAS', numeric: true, width: 12 },
  { title: 'Unidades', dataIndex: 'UNIDADES_VENDIDAS', numeric: true, width: 14 },
  { title: 'Total vendido', dataIndex: 'TOTAL_VENDIDO', numeric: true, money: true, width: 20 },
  { title: 'Participación %', dataIndex: 'PARTICIPACION_PCT', numeric: true, width: 16, render: v => fmtPct(v as number) },
];

const revenuePdfColumns = (): PdfColumn<RevenueByDimensionRow>[] => [
  { title: 'Nombre', dataIndex: 'NOMBRE' },
  { title: 'Ventas', dataIndex: 'CANTIDAD_VENTAS', numeric: true, align: 'right' },
  { title: 'Unidades', dataIndex: 'UNIDADES_VENDIDAS', numeric: true, align: 'right' },
  { title: 'Total', dataIndex: 'TOTAL_VENDIDO', numeric: true, money: true, align: 'right' },
  { title: '%', dataIndex: 'PARTICIPACION_PCT', numeric: true, align: 'right' },
];

const donutFromRevenue = (rows: RevenueByDimensionRow[]) => ({
  type: 'donut' as const,
  data: rows.slice(0, 12).map(r => ({ label: r.NOMBRE, value: r.TOTAL_VENDIDO })),
  centerLabel: 'Total',
});

const revenueByCategories: ReportDefinition = {
  key: 'revenue-by-categories',
  title: 'Análisis de ingresos por Categoría',
  group: 'ventas',
  icon: <TagsOutlined />,
  description: 'Distribución del total vendido agrupado por categoría de producto, con porcentaje de participación.',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getRevenueByCategories(f),
  kpis: revenueKpis,
  chart: (rows) => donutFromRevenue(rows),
  columns: revenueColumns() as TableColumnsType<any>,
  excelColumns: revenueExcelColumns(),
  pdfColumns: revenuePdfColumns(),
  tableScrollX: 720,
};

const revenueByBrands: ReportDefinition = {
  key: 'revenue-by-brands',
  title: 'Análisis de ingresos por Marca',
  group: 'ventas',
  icon: <TagsOutlined />,
  description: 'Distribución del total vendido agrupado por marca de producto.',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getRevenueByBrands(f),
  kpis: revenueKpis,
  chart: (rows) => donutFromRevenue(rows),
  columns: revenueColumns() as TableColumnsType<any>,
  excelColumns: revenueExcelColumns(),
  pdfColumns: revenuePdfColumns(),
  tableScrollX: 720,
};

const revenueByProducts: ReportDefinition = {
  key: 'revenue-by-products',
  title: 'Análisis de ingresos por Producto',
  group: 'ventas',
  icon: <TagsOutlined />,
  description: 'Productos ordenados por total vendido. Útil para detectar concentración de ingresos.',
  defaultFilters: { ...defaultFilters(), limit: 50 },
  filterOptions: { showLimit: true },
  fetch: f => reportsApi.getRevenueByProducts(f),
  kpis: revenueKpis,
  chart: (rows) => ({
    type: 'bar',
    data: rows.slice(0, 15).map(r => ({ label: r.NOMBRE.length > 22 ? r.NOMBRE.slice(0, 22) + '…' : r.NOMBRE, value: r.TOTAL_VENDIDO, count: r.UNIDADES_VENDIDAS })),
    height: 280,
    showSecondary: false,
    emptyLabel: 'Sin ventas en el período',
  }),
  columns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 120, render: (v: string | null) => v || '—' },
    { title: 'Producto', dataIndex: 'NOMBRE', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
    { title: 'Categoría', dataIndex: 'CATEGORIA', width: 170, align: 'center' },
    {
      title: 'Ventas',
      dataIndex: 'CANTIDAD_VENTAS',
      width: 90,
      align: 'center',
      render: (v: number) => fmtNum(v),
      sorter: (a, b) => a.CANTIDAD_VENTAS - b.CANTIDAD_VENTAS,
    },
    {
      title: 'Unidades',
      dataIndex: 'UNIDADES_VENDIDAS',
      width: 110,
      align: 'center',
      render: (v: number) => fmtNum(v),
      sorter: (a, b) => a.UNIDADES_VENDIDAS - b.UNIDADES_VENDIDAS,
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL_VENDIDO',
      width: 150,
      align: 'right',
      render: (v: number) => <strong>{fmtMoney(v)}</strong>,
      sorter: (a, b) => a.TOTAL_VENDIDO - b.TOTAL_VENDIDO,
      defaultSortOrder: 'descend',
    },
    {
      title: '%',
      dataIndex: 'PARTICIPACION_PCT',
      width: 90,
      align: 'right',
      render: (v: number) => fmtPct(v),
    },
  ] as TableColumnsType<any>,
  excelColumns: revenueExcelColumns(),
  pdfColumns: revenuePdfColumns(),
  tableScrollX: 900,
  defaultPageSize: 50,
};

const salesByClientColumns = (): TableColumnsType<SalesByClientRow> => [
  { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 130, render: (v: string | null) => v || '—' },
  { title: 'Cliente', dataIndex: 'CLIENTE', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
  {
    title: 'Ventas',
    dataIndex: 'CANTIDAD_VENTAS',
    width: 90,
    align: 'center',
    render: (v: number) => fmtNum(v),
    sorter: (a, b) => a.CANTIDAD_VENTAS - b.CANTIDAD_VENTAS,
  },
  {
    title: 'Total',
    dataIndex: 'TOTAL',
    width: 150,
    align: 'right',
    render: (v: number) => <strong>{fmtMoney(v)}</strong>,
    sorter: (a, b) => a.TOTAL - b.TOTAL,
    defaultSortOrder: 'descend',
  },
  {
    title: 'Ticket prom.',
    dataIndex: 'TICKET_PROMEDIO',
    width: 140,
    align: 'right',
    render: (v: number) => fmtMoney(v),
    sorter: (a, b) => a.TICKET_PROMEDIO - b.TICKET_PROMEDIO,
  },
  {
    title: 'Última venta',
    dataIndex: 'ULTIMA_VENTA',
    width: 130,
    align: 'center',
    render: (v: string | null) => v ? dayjs(v).format('DD/MM/YYYY') : '—',
  },
];

const salesByClient: ReportDefinition = {
  key: 'sales-by-client',
  title: 'Ventas por Cliente',
  group: 'ventas',
  icon: <TeamOutlined />,
  description: 'Ventas agrupadas por cliente con ticket promedio y fecha de última compra.',
  defaultFilters: { ...defaultFilters(), limit: 200 },
  filterOptions: { showLimit: true },
  fetch: f => reportsApi.getSalesByClient(f),
  kpis: (rows) => {
    const total = rows.reduce((s, r) => s + r.TOTAL, 0);
    const ventas = rows.reduce((s, r) => s + r.CANTIDAD_VENTAS, 0);
    const ticket = ventas > 0 ? total / ventas : 0;
    return [
      { title: 'Clientes con ventas', value: rows.length, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Ventas', value: ventas, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Total facturado', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
      { title: 'Ticket promedio', value: ticket, prefix: <DollarOutlined />, money: true },
    ];
  },
  columns: salesByClientColumns() as TableColumnsType<any>,
  excelColumns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 14 },
    { title: 'Cliente', dataIndex: 'CLIENTE', width: 40 },
    { title: 'Ventas', dataIndex: 'CANTIDAD_VENTAS', numeric: true, width: 10 },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, width: 18 },
    { title: 'Ticket prom.', dataIndex: 'TICKET_PROMEDIO', numeric: true, money: true, width: 16 },
    { title: 'Última venta', dataIndex: 'ULTIMA_VENTA', width: 14, render: v => v ? dayjs(v as string).format('DD/MM/YYYY') : '' },
  ],
  pdfColumns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR' },
    { title: 'Cliente', dataIndex: 'CLIENTE' },
    { title: 'Ventas', dataIndex: 'CANTIDAD_VENTAS', numeric: true, align: 'right' },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, align: 'right' },
    { title: 'Ticket', dataIndex: 'TICKET_PROMEDIO', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 880,
  defaultPageSize: 25,
};

const salesByProductColumns = (): TableColumnsType<SalesByProductRow> => [
  { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 120, render: (v: string | null) => v || '—' },
  { title: 'Producto', dataIndex: 'PRODUCTO', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
  { title: 'Categoría', dataIndex: 'CATEGORIA', width: 150, align: 'center' },
  { title: 'Marca', dataIndex: 'MARCA', width: 140, align: 'center' },
  {
    title: 'Unidades',
    dataIndex: 'CANTIDAD_VENDIDA',
    width: 110,
    align: 'center',
    render: (v: number) => fmtNum(v),
    sorter: (a, b) => a.CANTIDAD_VENDIDA - b.CANTIDAD_VENDIDA,
  },
  {
    title: 'Ventas distintas',
    dataIndex: 'VENTAS_DISTINTAS',
    width: 140,
    align: 'center',
    render: (v: number) => fmtNum(v),
  },
  {
    title: 'Total',
    dataIndex: 'TOTAL_INGRESOS',
    width: 150,
    align: 'right',
    render: (v: number) => <strong>{fmtMoney(v)}</strong>,
    sorter: (a, b) => a.TOTAL_INGRESOS - b.TOTAL_INGRESOS,
    defaultSortOrder: 'descend',
  },
  {
    title: 'Precio prom.',
    dataIndex: 'PRECIO_PROMEDIO',
    width: 140,
    align: 'right',
    render: (v: number) => fmtMoney(v),
  },
];

const salesByProduct: ReportDefinition = {
  key: 'sales-by-product',
  title: 'Ventas por Producto',
  group: 'ventas',
  icon: <ShoppingCartOutlined />,
  description: 'Cantidades y monto vendido por producto, con precio promedio y ventas distintas.',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getSalesByProduct(f),
  kpis: (rows) => {
    const total = rows.reduce((s, r) => s + r.TOTAL_INGRESOS, 0);
    const unidades = rows.reduce((s, r) => s + r.CANTIDAD_VENDIDA, 0);
    return [
      { title: 'Productos vendidos', value: rows.length, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Unidades', value: unidades, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Total facturado', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
    ];
  },
  columns: salesByProductColumns() as TableColumnsType<any>,
  excelColumns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 14 },
    { title: 'Producto', dataIndex: 'PRODUCTO', width: 38 },
    { title: 'Categoría', dataIndex: 'CATEGORIA', width: 22 },
    { title: 'Marca', dataIndex: 'MARCA', width: 20 },
    { title: 'Unidades', dataIndex: 'CANTIDAD_VENDIDA', numeric: true, width: 12 },
    { title: 'Ventas', dataIndex: 'VENTAS_DISTINTAS', numeric: true, width: 12 },
    { title: 'Total', dataIndex: 'TOTAL_INGRESOS', numeric: true, money: true, width: 18 },
    { title: 'Precio prom.', dataIndex: 'PRECIO_PROMEDIO', numeric: true, money: true, width: 16 },
  ],
  pdfColumns: [
    { title: 'Producto', dataIndex: 'PRODUCTO' },
    { title: 'Cat.', dataIndex: 'CATEGORIA', align: 'center' },
    { title: 'Unidades', dataIndex: 'CANTIDAD_VENDIDA', numeric: true, align: 'right' },
    { title: 'Total', dataIndex: 'TOTAL_INGRESOS', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 1080,
  defaultPageSize: 25,
};

const salesBySucursal: ReportDefinition = {
  key: 'sales-by-sucursal',
  title: 'Ventas por Sucursal / Punto de Venta',
  group: 'ventas',
  icon: <BarChartOutlined />,
  description: 'Comparativa de ventas, ganancia y ticket promedio entre sucursales.',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getSalesBySucursal(f),
  kpis: (rows) => {
    const total = rows.reduce((s, r) => s + r.TOTAL_VENDIDO, 0);
    const ganancia = rows.reduce((s, r) => s + r.GANANCIA, 0);
    return [
      { title: 'Sucursales', value: rows.length, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Total vendido', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
      { title: 'Ganancia', value: ganancia, prefix: <DollarOutlined />, money: true },
      {
        title: 'Margen',
        value: total > 0 ? +(ganancia / total * 100).toFixed(2) : 0,
        suffix: '%',
        numeric: true,
        formatter: v => `${v.toFixed(2)}%`,
      },
    ];
  },
  columns: [
    { title: 'Sucursal', dataIndex: 'SUCURSAL', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
    {
      title: 'Ventas',
      dataIndex: 'CANTIDAD_VENTAS',
      width: 100,
      align: 'center',
      render: (v: number) => fmtNum(v),
      sorter: (a, b) => a.CANTIDAD_VENTAS - b.CANTIDAD_VENTAS,
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL_VENDIDO',
      width: 150,
      align: 'right',
      render: (v: number) => <strong>{fmtMoney(v)}</strong>,
      sorter: (a, b) => a.TOTAL_VENDIDO - b.TOTAL_VENDIDO,
      defaultSortOrder: 'descend',
    },
    {
      title: 'Ganancia',
      dataIndex: 'GANANCIA',
      width: 150,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Ticket prom.',
      dataIndex: 'TICKET_PROMEDIO',
      width: 140,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Margen',
      width: 110,
      align: 'right',
      render: (_: any, r: SalesBySucursalRow) => {
        const m = r.TOTAL_VENDIDO > 0 ? (r.GANANCIA / r.TOTAL_VENDIDO) * 100 : 0;
        return `${m.toFixed(1)}%`;
      },
      sorter: (a, b) => (a.TOTAL_VENDIDO > 0 ? a.GANANCIA / a.TOTAL_VENDIDO : 0) - (b.TOTAL_VENDIDO > 0 ? b.GANANCIA / b.TOTAL_VENDIDO : 0),
    },
  ] as TableColumnsType<any>,
  excelColumns: [
    { title: 'Sucursal', dataIndex: 'SUCURSAL', width: 32 },
    { title: 'Ventas', dataIndex: 'CANTIDAD_VENTAS', numeric: true, width: 12 },
    { title: 'Total', dataIndex: 'TOTAL_VENDIDO', numeric: true, money: true, width: 18 },
    { title: 'Ganancia', dataIndex: 'GANANCIA', numeric: true, money: true, width: 18 },
    { title: 'Ticket prom.', dataIndex: 'TICKET_PROMEDIO', numeric: true, money: true, width: 16 },
  ],
  pdfColumns: [
    { title: 'Sucursal', dataIndex: 'SUCURSAL' },
    { title: 'Ventas', dataIndex: 'CANTIDAD_VENTAS', numeric: true, align: 'right' },
    { title: 'Total', dataIndex: 'TOTAL_VENDIDO', numeric: true, money: true, align: 'right' },
    { title: 'Ganancia', dataIndex: 'GANANCIA', numeric: true, money: true, align: 'right' },
    { title: 'Ticket', dataIndex: 'TICKET_PROMEDIO', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 820,
  defaultPageSize: 25,
};

const salesGeneral: ReportDefinition = {
  key: 'sales-general',
  title: 'Reporte General de Ventas',
  group: 'ventas',
  icon: <ProfileOutlined />,
  description: 'Detalle comprobante-por-venta: cliente, productos, totales, efectivo y digital.',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getSalesGeneral(f),
  kpis: (rows) => {
    const total = rows.reduce((s, r) => s + r.TOTAL, 0);
    const ganancia = rows.reduce((s, r) => s + r.GANANCIA, 0);
    const efectivo = rows.reduce((s, r) => s + r.EFECTIVO, 0);
    const digital = rows.reduce((s, r) => s + r.DIGITAL, 0);
    return [
      { title: 'Comprobantes', value: rows.length, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Total', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
      { title: 'Efectivo', value: efectivo, prefix: <DollarOutlined />, money: true },
      { title: 'Digital', value: digital, prefix: <DollarOutlined />, money: true },
      { title: 'Ganancia', value: ganancia, prefix: <DollarOutlined />, money: true },
    ];
  },
  columns: [
    { title: 'Comprobante', dataIndex: 'VENTA_ID', width: 110, align: 'center', render: (v: number) => `#${v}` },
    {
      title: 'Fecha',
      dataIndex: 'FECHA_VENTA',
      width: 130,
      align: 'center',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'),
    },
    { title: 'Tipo', dataIndex: 'TIPO_COMPROBANTE', width: 80, align: 'center', render: (v: string | null) => v ?? '—' },
    { title: 'Cliente', dataIndex: 'CLIENTE', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
    { title: 'Productos', dataIndex: 'PRODUCTOS', ellipsis: true },
    {
      title: 'Efectivo',
      dataIndex: 'EFECTIVO',
      width: 130,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Digital',
      dataIndex: 'DIGITAL',
      width: 130,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      width: 140,
      align: 'right',
      render: (v: number) => <strong>{fmtMoney(v)}</strong>,
      sorter: (a, b) => a.TOTAL - b.TOTAL,
      defaultSortOrder: 'descend',
    },
    {
      title: 'Ganancia',
      dataIndex: 'GANANCIA',
      width: 140,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
  ] as TableColumnsType<any>,
  excelColumns: [
    { title: 'Comprobante', dataIndex: 'VENTA_ID', width: 14, render: v => `#${v}` },
    { title: 'Fecha', dataIndex: 'FECHA_VENTA', width: 18, render: v => dayjs(v as string).format('DD/MM/YYYY HH:mm') },
    { title: 'Tipo', dataIndex: 'TIPO_COMPROBANTE', width: 10 },
    { title: 'Cliente', dataIndex: 'CLIENTE', width: 32 },
    { title: 'Productos', dataIndex: 'PRODUCTOS', width: 60 },
    { title: 'Efectivo', dataIndex: 'EFECTIVO', numeric: true, money: true, width: 16 },
    { title: 'Digital', dataIndex: 'DIGITAL', numeric: true, money: true, width: 16 },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, width: 18 },
    { title: 'Ganancia', dataIndex: 'GANANCIA', numeric: true, money: true, width: 16 },
  ],
  pdfColumns: [
    { title: '#', dataIndex: 'VENTA_ID', align: 'center' },
    { title: 'Fecha', dataIndex: 'FECHA_VENTA', render: (v: any) => dayjs(v).format('DD/MM/YY') },
    { title: 'Cliente', dataIndex: 'CLIENTE' },
    { title: 'Productos', dataIndex: 'PRODUCTOS' },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 1180,
  defaultPageSize: 25,
};

const salesTimeline: ReportDefinition = {
  key: 'sales-timeline',
  title: 'Serie temporal de Ventas',
  group: 'ventas',
  icon: <BarChartOutlined />,
  description: 'Evolución de ventas por día, semana o mes. Incluye heatmap día × hora.',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getSalesTimeline(f, 'day'),
  kpis: (rows) => {
    const total = rows.reduce((s, r) => s + r.TOTAL, 0);
    const ventas = rows.reduce((s, r) => s + r.VENTAS, 0);
    const ganancia = rows.reduce((s, r) => s + r.GANANCIA, 0);
    return [
      { title: 'Períodos', value: rows.length, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Ventas', value: ventas, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Total', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
      { title: 'Ganancia', value: ganancia, prefix: <DollarOutlined />, money: true },
    ];
  },
  chart: (rows, _f) => ({
    type: 'bar',
    data: rows.map(r => ({
      label: dayjs(r.BUCKET).format('DD/MM'),
      value: r.TOTAL,
      count: r.VENTAS,
    })),
    height: 260,
    showSecondary: false,
    emptyLabel: 'Sin ventas en el período',
  }),
  columns: [
    {
      title: 'Fecha',
      dataIndex: 'BUCKET',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY'),
      sorter: (a, b) => dayjs(a.BUCKET).valueOf() - dayjs(b.BUCKET).valueOf(),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Ventas',
      dataIndex: 'VENTAS',
      width: 110,
      align: 'center',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      width: 160,
      align: 'right',
      render: (v: number) => <strong>{fmtMoney(v)}</strong>,
    },
    {
      title: 'Ganancia',
      dataIndex: 'GANANCIA',
      width: 160,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
  ] as TableColumnsType<any>,
  excelColumns: [
    { title: 'Fecha', dataIndex: 'BUCKET', width: 14, render: v => dayjs(v as string).format('DD/MM/YYYY') },
    { title: 'Ventas', dataIndex: 'VENTAS', numeric: true, width: 12 },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, width: 18 },
    { title: 'Ganancia', dataIndex: 'GANANCIA', numeric: true, money: true, width: 18 },
  ],
  pdfColumns: [
    { title: 'Fecha', dataIndex: 'BUCKET', render: (v: any) => dayjs(v).format('DD/MM/YY') },
    { title: 'Ventas', dataIndex: 'VENTAS', numeric: true, align: 'right' },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 640,
};

const salesHeatmap: ReportDefinition = {
  key: 'sales-heatmap',
  title: 'Heatmap de ventas (día × hora)',
  group: 'ventas',
  icon: <PieChartOutlined />,
  description: 'Mapa de calor con la concentración de ventas por día de la semana y hora del día.',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getSalesHeatmap(f),
  chart: (rows) => ({
    type: 'heatmap',
    data: rows.map(r => ({ dow: r.DOW, hour: r.HOUR, value: r.VENTAS })),
    hourFrom: 7,
    hourTo: 23,
  }),
  columns: [
    {
      title: 'Día',
      width: 140,
      render: (_: any, r: SalesHeatmapRow) => ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][r.DOW - 1] ?? `Día ${r.DOW}`,
    },
    {
      title: 'Hora',
      dataIndex: 'HOUR',
      width: 100,
      align: 'center',
      render: (v: number) => `${v.toString().padStart(2, '0')}:00`,
    },
    {
      title: 'Ventas',
      dataIndex: 'VENTAS',
      width: 110,
      align: 'center',
      render: (v: number) => fmtNum(v),
      sorter: (a, b) => a.VENTAS - b.VENTAS,
      defaultSortOrder: 'descend',
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      width: 150,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
  ] as TableColumnsType<any>,
  excelColumns: [
    { title: 'Día', width: 14, render: (_v: any, _r, i) => i },
    { title: 'Hora', dataIndex: 'HOUR', numeric: true, width: 10 },
    { title: 'Ventas', dataIndex: 'VENTAS', numeric: true, width: 12 },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, width: 18 },
  ],
  pdfColumns: [
    { title: 'Día', dataIndex: 'DOW' },
    { title: 'Hora', dataIndex: 'HOUR' },
    { title: 'Ventas', dataIndex: 'VENTAS', numeric: true, align: 'right' },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 520,
  emptyText: 'No hay ventas registradas en el período',
};

const topProductsByUnidades: ReportDefinition = {
  key: 'top-products-unidades',
  title: 'Top productos por unidades vendidas',
  group: 'productos',
  icon: <TrophyOutlined />,
  description: 'Los productos más vendidos por cantidad (no por monto).',
  defaultFilters: { ...defaultFilters(), limit: 50 },
  filterOptions: { showLimit: true },
  fetch: f => reportsApi.getTopProductsByUnidades(f),
  kpis: (rows) => {
    const unidades = rows.reduce((s, r) => s + r.UNIDADES_VENDIDAS, 0);
    const total = rows.reduce((s, r) => s + r.TOTAL_VENDIDO, 0);
    return [
      { title: 'Productos', value: rows.length, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Unidades vendidas', value: unidades, numeric: true, formatter: v => fmtNum(v), highlight: true },
      { title: 'Ingresos generados', value: total, prefix: <DollarOutlined />, money: true },
    ];
  },
  chart: (rows) => ({
    type: 'bar',
    data: rows.slice(0, 15).map(r => ({
      label: r.NOMBRE.length > 22 ? r.NOMBRE.slice(0, 22) + '…' : r.NOMBRE,
      value: r.UNIDADES_VENDIDAS,
    })),
    height: 260,
    showSecondary: false,
    emptyLabel: 'Sin ventas en el período',
  }),
  columns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 120, render: (v: string | null) => v || '—' },
    { title: 'Producto', dataIndex: 'NOMBRE', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
    { title: 'Categoría', dataIndex: 'CATEGORIA', width: 160, align: 'center' },
    {
      title: 'Unidades',
      dataIndex: 'UNIDADES_VENDIDAS',
      width: 130,
      align: 'center',
      render: (v: number) => <strong>{fmtNum(v)}</strong>,
      sorter: (a, b) => a.UNIDADES_VENDIDAS - b.UNIDADES_VENDIDAS,
      defaultSortOrder: 'descend',
    },
    {
      title: 'Ventas',
      dataIndex: 'VENTAS_DISTINTAS',
      width: 110,
      align: 'center',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Ingresos',
      dataIndex: 'TOTAL_VENDIDO',
      width: 160,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
  ] as TableColumnsType<any>,
  excelColumns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 14 },
    { title: 'Producto', dataIndex: 'NOMBRE', width: 38 },
    { title: 'Categoría', dataIndex: 'CATEGORIA', width: 22 },
    { title: 'Unidades', dataIndex: 'UNIDADES_VENDIDAS', numeric: true, width: 12 },
    { title: 'Ventas', dataIndex: 'VENTAS_DISTINTAS', numeric: true, width: 12 },
    { title: 'Ingresos', dataIndex: 'TOTAL_VENDIDO', numeric: true, money: true, width: 18 },
  ],
  pdfColumns: [
    { title: 'Producto', dataIndex: 'NOMBRE' },
    { title: 'Unidades', dataIndex: 'UNIDADES_VENDIDAS', numeric: true, align: 'right' },
    { title: 'Ingresos', dataIndex: 'TOTAL_VENDIDO', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 820,
  defaultPageSize: 50,
};

const topProductsByIngresos: ReportDefinition = {
  ...topProductsByUnidades,
  key: 'top-products-ingresos',
  title: 'Top productos por ingresos',
  description: 'Los productos que más dinero generaron (no por cantidad).',
  defaultFilters: { ...defaultFilters(), limit: 50 },
  fetch: f => reportsApi.getTopProductsByIngresos(f),
  chart: (rows) => ({
    type: 'bar',
    data: rows.slice(0, 15).map(r => ({
      label: r.NOMBRE.length > 22 ? r.NOMBRE.slice(0, 22) + '…' : r.NOMBRE,
      value: r.TOTAL_VENDIDO,
    })),
    height: 260,
    showSecondary: false,
    emptyLabel: 'Sin ventas en el período',
  }),
  columns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 120, render: (v: string | null) => v || '—' },
    { title: 'Producto', dataIndex: 'NOMBRE', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
    { title: 'Categoría', dataIndex: 'CATEGORIA', width: 160, align: 'center' },
    {
      title: 'Ingresos',
      dataIndex: 'TOTAL_VENDIDO',
      width: 160,
      align: 'right',
      render: (v: number) => <strong>{fmtMoney(v)}</strong>,
      sorter: (a, b) => a.TOTAL_VENDIDO - b.TOTAL_VENDIDO,
      defaultSortOrder: 'descend',
    },
    {
      title: 'Unidades',
      dataIndex: 'UNIDADES_VENDIDAS',
      width: 130,
      align: 'center',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Ventas',
      dataIndex: 'VENTAS_DISTINTAS',
      width: 110,
      align: 'center',
      render: (v: number) => fmtNum(v),
    },
  ] as TableColumnsType<any>,
};

const purchasesBySupplier: ReportDefinition = {
  key: 'purchases-by-supplier',
  title: 'Compras por Proveedor',
  group: 'compras',
  icon: <TeamOutlined />,
  description: 'Total comprado por proveedor con IVA y percepciones.',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getPurchasesBySupplier(f),
  kpis: (rows) => {
    const total = rows.reduce((s, r) => s + r.TOTAL, 0);
    const iva = rows.reduce((s, r) => s + r.IVA_TOTAL, 0);
    const perc = rows.reduce((s, r) => s + r.PERCEPCIONES, 0);
    return [
      { title: 'Proveedores', value: rows.length, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Comprobantes', value: rows.reduce((s, r) => s + r.CANTIDAD_COMPROBANTES, 0), numeric: true, formatter: v => fmtNum(v) },
      { title: 'Total comprado', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
      { title: 'IVA', value: iva, prefix: <DollarOutlined />, money: true },
      { title: 'Percepciones', value: perc, prefix: <DollarOutlined />, money: true },
    ];
  },
  columns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 130, render: (v: string | null) => v || '—' },
    { title: 'Proveedor', dataIndex: 'PROVEEDOR', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
    {
      title: 'Comprobantes',
      dataIndex: 'CANTIDAD_COMPROBANTES',
      width: 130,
      align: 'center',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      width: 150,
      align: 'right',
      render: (v: number) => <strong>{fmtMoney(v)}</strong>,
      sorter: (a, b) => a.TOTAL - b.TOTAL,
      defaultSortOrder: 'descend',
    },
    {
      title: 'IVA',
      dataIndex: 'IVA_TOTAL',
      width: 140,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Percepciones',
      dataIndex: 'PERCEPCIONES',
      width: 150,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
  ] as TableColumnsType<any>,
  excelColumns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 14 },
    { title: 'Proveedor', dataIndex: 'PROVEEDOR', width: 40 },
    { title: 'Comprobantes', dataIndex: 'CANTIDAD_COMPROBANTES', numeric: true, width: 14 },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, width: 18 },
    { title: 'IVA', dataIndex: 'IVA_TOTAL', numeric: true, money: true, width: 16 },
    { title: 'Percepciones', dataIndex: 'PERCEPCIONES', numeric: true, money: true, width: 16 },
  ],
  pdfColumns: [
    { title: 'Proveedor', dataIndex: 'PROVEEDOR' },
    { title: 'Comprobantes', dataIndex: 'CANTIDAD_COMPROBANTES', numeric: true, align: 'right' },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 820,
};

const purchasesByProduct: ReportDefinition = {
  key: 'purchases-by-product',
  title: 'Compras por Producto',
  group: 'compras',
  icon: <ShoppingCartOutlined />,
  description: 'Cantidad y monto comprado por producto.',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getPurchasesByProduct(f),
  kpis: (rows) => {
    const total = rows.reduce((s, r) => s + r.TOTAL_COMPRADO, 0);
    const cant = rows.reduce((s, r) => s + r.CANTIDAD_COMPRADA, 0);
    return [
      { title: 'Productos', value: rows.length, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Cantidad comprada', value: cant, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Total comprado', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
    ];
  },
  columns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 130, render: (v: string | null) => v || '—' },
    { title: 'Producto', dataIndex: 'PRODUCTO', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
    {
      title: 'Cantidad',
      dataIndex: 'CANTIDAD_COMPRADA',
      width: 130,
      align: 'center',
      render: (v: number) => fmtNum(v),
      sorter: (a, b) => a.CANTIDAD_COMPRADA - b.CANTIDAD_COMPRADA,
    },
    {
      title: 'Compras',
      dataIndex: 'COMPRAS_DISTINTAS',
      width: 120,
      align: 'center',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL_COMPRADO',
      width: 150,
      align: 'right',
      render: (v: number) => <strong>{fmtMoney(v)}</strong>,
      sorter: (a, b) => a.TOTAL_COMPRADO - b.TOTAL_COMPRADO,
      defaultSortOrder: 'descend',
    },
    {
      title: 'Precio prom.',
      dataIndex: 'PRECIO_PROMEDIO',
      width: 140,
      align: 'right',
      render: (v: number) => fmtMoney(v),
    },
  ] as TableColumnsType<any>,
  excelColumns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 14 },
    { title: 'Producto', dataIndex: 'PRODUCTO', width: 40 },
    { title: 'Cantidad', dataIndex: 'CANTIDAD_COMPRADA', numeric: true, width: 12 },
    { title: 'Compras', dataIndex: 'COMPRAS_DISTINTAS', numeric: true, width: 12 },
    { title: 'Total', dataIndex: 'TOTAL_COMPRADO', numeric: true, money: true, width: 18 },
    { title: 'Precio prom.', dataIndex: 'PRECIO_PROMEDIO', numeric: true, money: true, width: 16 },
  ],
  pdfColumns: [
    { title: 'Producto', dataIndex: 'PRODUCTO' },
    { title: 'Cantidad', dataIndex: 'CANTIDAD_COMPRADA', numeric: true, align: 'right' },
    { title: 'Total', dataIndex: 'TOTAL_COMPRADO', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 820,
};

const purchasesGeneral: ReportDefinition = {
  key: 'purchases-general',
  title: 'Reporte General de Compras',
  group: 'compras',
  icon: <ProfileOutlined />,
  description: 'Detalle comprobante-por-compra con proveedor y productos.',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getPurchasesGeneral(f),
  kpis: (rows) => {
    const total = rows.reduce((s, r) => s + r.TOTAL, 0);
    return [
      { title: 'Comprobantes', value: rows.length, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Total', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
    ];
  },
  columns: [
    { title: 'Comprobante', dataIndex: 'COMPROBANTE_ID', width: 120, align: 'center', render: (v: number) => `#${v}` },
    {
      title: 'Fecha',
      dataIndex: 'FECHA',
      width: 120,
      align: 'center',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY'),
    },
    { title: 'Tipo', dataIndex: 'TIPO_COMPROBANTE', width: 80, align: 'center', render: (v: string | null) => v ?? '—' },
    { title: 'Proveedor', dataIndex: 'PROVEEDOR', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
    { title: 'Productos', dataIndex: 'PRODUCTOS', ellipsis: true },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      width: 150,
      align: 'right',
      render: (v: number) => <strong>{fmtMoney(v)}</strong>,
      sorter: (a, b) => a.TOTAL - b.TOTAL,
      defaultSortOrder: 'descend',
    },
  ] as TableColumnsType<any>,
  excelColumns: [
    { title: 'Comprobante', dataIndex: 'COMPROBANTE_ID', width: 14, render: v => `#${v}` },
    { title: 'Fecha', dataIndex: 'FECHA', width: 14, render: v => dayjs(v as string).format('DD/MM/YYYY') },
    { title: 'Tipo', dataIndex: 'TIPO_COMPROBANTE', width: 10 },
    { title: 'Proveedor', dataIndex: 'PROVEEDOR', width: 32 },
    { title: 'Productos', dataIndex: 'PRODUCTOS', width: 60 },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, width: 18 },
  ],
  pdfColumns: [
    { title: '#', dataIndex: 'COMPROBANTE_ID', align: 'center' },
    { title: 'Fecha', dataIndex: 'FECHA', render: (v: any) => dayjs(v).format('DD/MM/YY') },
    { title: 'Proveedor', dataIndex: 'PROVEEDOR' },
    { title: 'Productos', dataIndex: 'PRODUCTOS' },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 980,
};

const clientList: ReportDefinition = {
  key: 'clients-list',
  title: 'Listado de Clientes',
  group: 'clientes',
  icon: <TeamOutlined />,
  description: 'Listado de clientes con métricas de ventas históricas.',
  defaultFilters: defaultFilters(),
  fetch: () => reportsApi.getClientList({ activo: true }),
  kpis: (rows) => {
    const total = rows.reduce((s, r) => s + Number(r.TOTAL_VENTAS ?? 0), 0);
    return [
      { title: 'Clientes', value: rows.length, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Ventas totales', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
    ];
  },
  columns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 130, render: (v: string | null) => v || '—' },
    { title: 'Nombre', dataIndex: 'NOMBRE', ellipsis: true, render: (v: string) => <strong>{v}</strong> },
    { title: 'Doc.', dataIndex: 'NUMERO_DOC', width: 130, render: (v: string | null) => v || '—' },
    { title: 'Cond. IVA', dataIndex: 'CONDICION_IVA', width: 160, render: (v: string | null) => v || '—' },
    { title: 'Email', dataIndex: 'EMAIL', width: 200, ellipsis: true, render: (v: string | null) => v || '—' },
    { title: 'Teléfono', dataIndex: 'TELEFONO', width: 130, render: (v: string | null) => v || '—' },
    { title: 'Ciudad', dataIndex: 'CIUDAD', width: 130, render: (v: string | null) => v || '—' },
    {
      title: 'Ventas totales',
      dataIndex: 'TOTAL_VENTAS',
      width: 160,
      align: 'right',
      render: (v: number) => fmtMoney(Number(v ?? 0)),
      sorter: (a, b) => Number(a.TOTAL_VENTAS ?? 0) - Number(b.TOTAL_VENTAS ?? 0),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Última venta',
      dataIndex: 'ULTIMA_VENTA',
      width: 130,
      align: 'center',
      render: (v: string | null) => v ? dayjs(v).format('DD/MM/YYYY') : '—',
    },
  ] as TableColumnsType<any>,
  excelColumns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 14 },
    { title: 'Nombre', dataIndex: 'NOMBRE', width: 40 },
    { title: 'CUIT/DNI', dataIndex: 'NUMERO_DOC', width: 16 },
    { title: 'Condición IVA', dataIndex: 'CONDICION_IVA', width: 22 },
    { title: 'Email', dataIndex: 'EMAIL', width: 30 },
    { title: 'Teléfono', dataIndex: 'TELEFONO', width: 16 },
    { title: 'Ciudad', dataIndex: 'CIUDAD', width: 16 },
    { title: 'Ventas totales', dataIndex: 'TOTAL_VENTAS', numeric: true, money: true, width: 18 },
    { title: 'Última venta', dataIndex: 'ULTIMA_VENTA', width: 14, render: v => v ? dayjs(v as string).format('DD/MM/YYYY') : '' },
  ],
  pdfColumns: [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR' },
    { title: 'Cliente', dataIndex: 'NOMBRE' },
    { title: 'Doc.', dataIndex: 'NUMERO_DOC' },
    { title: 'Total ventas', dataIndex: 'TOTAL_VENTAS', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 1080,
  defaultPageSize: 50,
};

const clientesNuevosVsRecurrentes: ReportDefinition = {
  key: 'clients-nuevos-vs-recurrentes',
  title: 'Clientes Nuevos vs Recurrentes',
  group: 'clientes',
  icon: <StarOutlined />,
  description: 'Clasificación de clientes según si su primera compra fue dentro del período (Nuevo) o anterior (Recurrente).',
  defaultFilters: defaultFilters(),
  fetch: f => reportsApi.getClientesNuevosVsRecurrentes(f),
  chart: (rows) => ({
    type: 'donut',
    data: rows.map(r => ({ label: r.TIPO, value: r.TOTAL })),
    centerLabel: 'Total vendido',
  }),
  kpis: (rows) => {
    const total = rows.reduce((s, r) => s + r.TOTAL, 0);
    const clientes = rows.reduce((s, r) => s + r.CANTIDAD_CLIENTES, 0);
    return [
      { title: 'Clientes únicos', value: clientes, numeric: true, formatter: v => fmtNum(v) },
      { title: 'Ventas en el período', value: rows.reduce((s, r) => s + r.CANTIDAD_VENTAS, 0), numeric: true, formatter: v => fmtNum(v) },
      { title: 'Total facturado', value: total, prefix: <DollarOutlined />, money: true, highlight: true },
    ];
  },
  columns: [
    {
      title: 'Tipo',
      dataIndex: 'TIPO',
      width: 160,
      render: (v: string) => <strong>{v}</strong>,
      filters: [
        { text: 'Nuevo', value: 'Nuevo' },
        { text: 'Recurrente', value: 'Recurrente' },
      ],
      onFilter: (value, r) => r.TIPO === value,
    },
    {
      title: 'Clientes',
      dataIndex: 'CANTIDAD_CLIENTES',
      width: 130,
      align: 'center',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Ventas',
      dataIndex: 'CANTIDAD_VENTAS',
      width: 130,
      align: 'center',
      render: (v: number) => fmtNum(v),
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      width: 160,
      align: 'right',
      render: (v: number) => <strong>{fmtMoney(v)}</strong>,
    },
  ] as TableColumnsType<any>,
  excelColumns: [
    { title: 'Tipo', dataIndex: 'TIPO', width: 18 },
    { title: 'Clientes', dataIndex: 'CANTIDAD_CLIENTES', numeric: true, width: 12 },
    { title: 'Ventas', dataIndex: 'CANTIDAD_VENTAS', numeric: true, width: 12 },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, width: 18 },
  ],
  pdfColumns: [
    { title: 'Tipo', dataIndex: 'TIPO' },
    { title: 'Clientes', dataIndex: 'CANTIDAD_CLIENTES', numeric: true, align: 'right' },
    { title: 'Ventas', dataIndex: 'CANTIDAD_VENTAS', numeric: true, align: 'right' },
    { title: 'Total', dataIndex: 'TOTAL', numeric: true, money: true, align: 'right' },
  ],
  tableScrollX: 620,
};

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  revenueByCategories,
  revenueByBrands,
  revenueByProducts,
  salesByClient,
  salesByProduct,
  salesBySucursal,
  salesGeneral,
  salesTimeline,
  salesHeatmap,
  topProductsByUnidades,
  topProductsByIngresos,
  purchasesBySupplier,
  purchasesByProduct,
  purchasesGeneral,
  clientList,
  clientesNuevosVsRecurrentes,
];

export const GROUP_LABELS: Record<ReportGroup, string> = {
  ventas: 'Ventas',
  compras: 'Compras',
  clientes: 'Clientes',
  productos: 'Productos',
};