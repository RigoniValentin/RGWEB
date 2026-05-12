import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  App, Button, Card, Col, Input, Row, Select, Space, Statistic, Switch, Table, Tooltip, Typography,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  DollarOutlined, FileExcelOutlined, FilePdfOutlined, InboxOutlined, ReloadOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import jsPDF from 'jspdf';
import dayjs from 'dayjs';
import { catalogApi } from '../services/catalog.api';
import { productListingApi, type ProductListingFilter, type ProductListingItem } from '../services/productListing.api';
import { fmtMoney, fmtNum } from '../utils/format';
import type { ListaPrecio } from '../types';

const { Title, Text } = Typography;

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}

function buildListaOptions(listas: ListaPrecio[] | undefined) {
  const base = [{ value: 0, label: 'Lista por defecto' }];
  if (!listas?.length) return base;
  return [
    ...base,
    ...listas.map(l => ({ value: l.LISTA_ID, label: l.NOMBRE })),
  ];
}

function getListaLabel(listaPrecio: number, listas: ListaPrecio[] | undefined): string {
  if (listaPrecio === 0) return 'Lista por defecto';
  return listas?.find(l => l.LISTA_ID === listaPrecio)?.NOMBRE ?? `Lista ${listaPrecio}`;
}

export function ListadoProductosPage() {
  const { message } = App.useApp();
  const [listaPrecio, setListaPrecio] = useState(0);
  const [categoriaId, setCategoriaId] = useState<number | undefined>();
  const [marcaId, setMarcaId] = useState<number | undefined>();
  const [soloActivos, setSoloActivos] = useState(true);
  const [soloConStock, setSoloConStock] = useState(false);
  const [mostrarCodigo, setMostrarCodigo] = useState(true);
  const [mostrarStock, setMostrarStock] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');

  const filter: ProductListingFilter = useMemo(() => ({
    listaPrecio,
    categoriaId,
    marcaId,
    soloActivos,
    soloConStock,
    search,
  }), [listaPrecio, categoriaId, marcaId, soloActivos, soloConStock, search]);

  const { data: listas, isLoading: loadingListas } = useQuery({
    queryKey: ['catalog-listas-precios'],
    queryFn: catalogApi.getListasPrecios,
    staleTime: 10 * 60 * 1000,
  });

  const listaOptions = useMemo(() => buildListaOptions(listas), [listas]);

  const { data: categorias, isLoading: loadingCategorias } = useQuery({
    queryKey: ['catalog-categorias'],
    queryFn: catalogApi.getCategorias,
    staleTime: 5 * 60 * 1000,
  });

  const { data: marcas, isLoading: loadingMarcas } = useQuery({
    queryKey: ['catalog-marcas'],
    queryFn: catalogApi.getMarcas,
    staleTime: 5 * 60 * 1000,
  });

  const { data: productos, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['product-listing', filter],
    queryFn: () => productListingApi.getProductos(filter),
  });

  const rows = productos ?? [];
  const totalStock = useMemo(() => rows.reduce((sum, row) => sum + toNumber(row.STOCK), 0), [rows]);
  const totalValorizado = useMemo(
    () => rows.reduce((sum, row) => sum + (toNumber(row.STOCK) * toNumber(row.PRECIO)), 0),
    [rows],
  );
  const precioPromedio = rows.length > 0
    ? rows.reduce((sum, row) => sum + toNumber(row.PRECIO), 0) / rows.length
    : 0;

  const columns = useMemo<TableColumnType<ProductListingItem>[]>(() => {
    const tableColumns: TableColumnType<ProductListingItem>[] = [];

    if (mostrarCodigo) {
      tableColumns.push({
        title: 'Código',
        dataIndex: 'CODIGOPARTICULAR',
        width: 130,
        align: 'center',
        ellipsis: true,
        render: (value: string | null) => (
          <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{value || '-'}</Text>
        ),
        sorter: (a, b) => (a.CODIGOPARTICULAR || '').localeCompare(b.CODIGOPARTICULAR || ''),
      });
    }

    tableColumns.push(
      {
        title: 'Nombre',
        dataIndex: 'NOMBRE',
        ellipsis: true,
        render: (value: string) => <Text strong>{value}</Text>,
        sorter: (a, b) => a.NOMBRE.localeCompare(b.NOMBRE),
      },
      {
        title: 'Marca',
        dataIndex: 'MARCA',
        width: 170,
        align: 'center',
        ellipsis: true,
        sorter: (a, b) => a.MARCA.localeCompare(b.MARCA),
      },
      {
        title: 'Categoría',
        dataIndex: 'CATEGORIA',
        width: 190,
        align: 'center',
        ellipsis: true,
        sorter: (a, b) => a.CATEGORIA.localeCompare(b.CATEGORIA),
      },
    );

    if (mostrarStock) {
      tableColumns.push({
        title: 'Stock',
        dataIndex: 'STOCK',
        width: 115,
        align: 'center',
        render: (value: number) => <Text>{fmtNum(toNumber(value))}</Text>,
        sorter: (a, b) => toNumber(a.STOCK) - toNumber(b.STOCK),
      });
    }

    tableColumns.push({
      title: getListaLabel(listaPrecio, listas),
      dataIndex: 'PRECIO',
      width: 165,
      align: 'center',
      fixed: 'right',
      render: (value: number) => <Text strong>{fmtMoney(toNumber(value))}</Text>,
      sorter: (a, b) => toNumber(a.PRECIO) - toNumber(b.PRECIO),
    });

    return tableColumns;
  }, [listaPrecio, listas, mostrarCodigo, mostrarStock]);

  const exportRows = () => {
    if (!rows.length) {
      message.warning('No hay datos para exportar');
      return null;
    }

    const headers: string[] = [];
    if (mostrarCodigo) headers.push('Código');
    headers.push('Nombre', 'Marca', 'Categoría');
    if (mostrarStock) headers.push('Stock');
    headers.push(getListaLabel(listaPrecio, listas));

    const body = rows.map(row => {
      const values: string[] = [];
      if (mostrarCodigo) values.push(row.CODIGOPARTICULAR || '');
      values.push(row.NOMBRE, row.MARCA, row.CATEGORIA);
      if (mostrarStock) values.push(fmtNum(toNumber(row.STOCK)));
      values.push(fmtNum(toNumber(row.PRECIO)));
      return values;
    });

    return { headers, body };
  };

  const handleExportExcel = () => {
    const data = exportRows();
    if (!data) return;

    const csv = [data.headers, ...data.body]
      .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(';'))
      .join('\n');

    downloadFile(csv, `Listado_Productos_${dayjs().format('YYYYMMDD_HHmmss')}.csv`, 'text/csv;charset=utf-8');
    message.success('Archivo exportado');
  };

  const handleExportPdf = () => {
    const data = exportRows();
    if (!data) return;

    try {
      generateProductListingPdf({
        rows,
        listaPrecio,
        listaLabel: getListaLabel(listaPrecio, listas),
        categoria: categorias?.find(c => c.CATEGORIA_ID === categoriaId)?.NOMBRE,
        marca: marcas?.find(m => m.MARCA_ID === marcaId)?.NOMBRE,
        soloActivos,
        soloConStock,
        mostrarCodigo,
        mostrarStock,
        search,
      });
      message.success('PDF generado');
    } catch {
      message.error('Error al generar el PDF');
    }
  };

  return (
    <div className="page-enter">
      <div className="page-header">
        <div>
          <Title level={3}>
            <ShoppingOutlined style={{ marginRight: 10, color: 'var(--rg-gold)' }} />
            Listado de Productos
          </Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Reportes / Listados - {getListaLabel(listaPrecio, listas)}
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching} size="small">
            Actualizar
          </Button>
          <Tooltip title="Exportar planilla CSV compatible con Excel">
            <Button icon={<FileExcelOutlined />} onClick={handleExportExcel} disabled={!rows.length}>
              Exportar Excel
            </Button>
          </Tooltip>
          <Tooltip title="Generar PDF del listado visible">
            <Button icon={<FilePdfOutlined />} onClick={handleExportPdf} disabled={!rows.length} className="btn-gold">
              Exportar PDF
            </Button>
          </Tooltip>
        </Space>
      </div>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={8} lg={6} xl={5}>
          <Card size="small" className="rg-card-flat">
            <Statistic title="Productos" value={rows.length} prefix={<ShoppingOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={6} xl={5}>
          <Card size="small" className="rg-card-flat">
            <Statistic title="Stock Total" value={totalStock} precision={2} prefix={<InboxOutlined />} valueStyle={{ fontSize: 18 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={6} xl={5}>
          <Card size="small" className="rg-card-flat">
            <Statistic title="Precio Promedio" value={precioPromedio} precision={2} prefix="$" valueStyle={{ fontSize: 18 }} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={6} xl={5}>
          <Card size="small" className="rg-card-flat" style={{ borderColor: 'var(--rg-gold)', borderWidth: 2 }}>
            <Statistic title={<Text strong style={{ color: 'var(--rg-gold)' }}>Valorizado</Text>} value={totalValorizado} precision={2} prefix={<DollarOutlined />} valueStyle={{ color: '#3f8600', fontSize: 20, fontWeight: 700 }} />
          </Card>
        </Col>
      </Row>

      <Card
        size="small"
        className="rg-card-flat"
        style={{ marginBottom: 14 }}
        styles={{ body: { padding: '10px 14px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <Input.Search
            allowClear
            placeholder="Buscar producto, código, marca o categoría"
            value={searchText}
            onChange={event => {
              setSearchText(event.target.value);
              if (!event.target.value) setSearch('');
            }}
            onSearch={value => setSearch(value.trim())}
            style={{ width: 280 }}
          />
          <Select
            value={listaPrecio}
            onChange={setListaPrecio}
            style={{ width: 170 }}
            loading={loadingListas}
            options={listaOptions}
          />
          <Select
            placeholder="Categoría"
            allowClear
            showSearch
            optionFilterProp="label"
            value={categoriaId}
            loading={loadingCategorias}
            onChange={value => setCategoriaId(value)}
            style={{ width: 210 }}
            options={categorias?.map(c => ({ value: c.CATEGORIA_ID, label: c.NOMBRE })) ?? []}
          />
          <Select
            placeholder="Marca"
            allowClear
            showSearch
            optionFilterProp="label"
            value={marcaId}
            loading={loadingMarcas}
            onChange={value => setMarcaId(value)}
            style={{ width: 190 }}
            options={marcas?.map(m => ({ value: m.MARCA_ID, label: m.NOMBRE })) ?? []}
          />
          <ToggleLabel label="Solo activos" checked={soloActivos} onChange={setSoloActivos} />
          <ToggleLabel label="Con stock" checked={soloConStock} onChange={setSoloConStock} />
          <ToggleLabel label="Código" checked={mostrarCodigo} onChange={setMostrarCodigo} />
          <ToggleLabel label="Stock" checked={mostrarStock} onChange={setMostrarStock} />
          <div style={{ flex: 1 }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {rows.length} registros
          </Text>
        </div>
      </Card>

      <Card className="rg-card-flat" size="small" styles={{ body: { padding: 0 } }}>
        <Table<ProductListingItem>
          className="rg-table"
          rowKey="PRODUCTO_ID"
          columns={columns}
          dataSource={rows}
          loading={isLoading}
          size="small"
          scroll={{ x: 'max-content' }}
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            pageSizeOptions: ['25', '50', '100', '200'],
            showTotal: (total, range) => `${range[0]}-${range[1]} de ${total} productos`,
            style: { padding: '8px 16px' },
          }}
        />
      </Card>
    </div>
  );
}

function ToggleLabel({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Switch size="small" checked={checked} onChange={onChange} />
      <Text type="secondary" style={{ fontSize: 12 }}>{label}</Text>
    </div>
  );
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

interface PdfOptions {
  rows: ProductListingItem[];
  listaPrecio: number;
  listaLabel: string;
  categoria?: string;
  marca?: string;
  soloActivos: boolean;
  soloConStock: boolean;
  mostrarCodigo: boolean;
  mostrarStock: boolean;
  search: string;
}

interface PdfColumn {
  title: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  value: (row: ProductListingItem) => string;
}

function generateProductListingPdf(options: PdfOptions) {
  const doc = new jsPDF('l', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);
  const columns = getPdfColumns(options);
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const startX = margin + Math.max(0, (contentWidth - tableWidth) / 2);
  const rowHeight = 7;
  const headerHeight = 43;
  let y = headerHeight;

  const drawPageHeader = () => {
    doc.setTextColor('#1E1F22');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('LISTADO DE PRODUCTOS', margin, 15);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Generado: ${dayjs().format('DD/MM/YYYY HH:mm')}`, margin, 21);
    doc.text(`Lista: ${options.listaLabel}`, margin, 26);

    const filters = [
      options.categoria ? `Categoría: ${options.categoria}` : undefined,
      options.marca ? `Marca: ${options.marca}` : undefined,
      options.soloActivos ? 'Solo activos' : undefined,
      options.soloConStock ? 'Con stock' : undefined,
      options.search ? `Búsqueda: ${options.search}` : undefined,
    ].filter(Boolean).join(' | ');

    if (filters) doc.text(trimText(doc, filters, contentWidth), margin, 31);

    let x = startX;
    doc.setFillColor('#1E1F22');
    doc.setDrawColor('#1E1F22');
    doc.rect(startX, 35, tableWidth, 8, 'F');
    doc.setTextColor('#EABD23');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    for (const column of columns) {
      drawCellText(doc, column.title, x, 40.2, column.width, column.align ?? 'left');
      x += column.width;
    }
  };

  drawPageHeader();
  doc.setFontSize(8);

  for (const row of options.rows) {
    if (y + rowHeight > pageHeight - 16) {
      doc.addPage();
      y = headerHeight;
      drawPageHeader();
    }

    let x = startX;
    doc.setDrawColor('#E8E8E8');
    doc.setTextColor('#333333');
    doc.setFont('helvetica', 'normal');
    columns.forEach(column => {
      doc.line(x, y + rowHeight, x + column.width, y + rowHeight);
      drawCellText(doc, column.value(row), x, y + 4.8, column.width, column.align ?? 'left');
      x += column.width;
    });
    y += rowHeight;
  }

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor('#666666');
    doc.text(`${page} / ${totalPages}`, pageWidth / 2, pageHeight - 7, { align: 'center' });
  }

  doc.save(`Listado_Productos_${dayjs().format('YYYYMMDD_HHmmss')}.pdf`);
}

function getPdfColumns(options: PdfOptions): PdfColumn[] {
  const columns: PdfColumn[] = [];
  if (options.mostrarCodigo) {
    columns.push({
      title: 'Código',
      width: 28,
      align: 'center',
      value: row => row.CODIGOPARTICULAR || '',
    });
  }

  columns.push(
    { title: 'Nombre', width: options.mostrarCodigo ? 84 : 105, value: row => row.NOMBRE },
    { title: 'Marca', width: 42, align: 'center', value: row => row.MARCA },
    { title: 'Categoría', width: 52, align: 'center', value: row => row.CATEGORIA },
  );

  if (options.mostrarStock) {
    columns.push({
      title: 'Stock',
      width: 25,
      align: 'right',
      value: row => fmtNum(toNumber(row.STOCK)),
    });
  }

  columns.push({
    title: options.listaLabel,
    width: 34,
    align: 'right',
    value: row => `$ ${fmtNum(toNumber(row.PRECIO))}`,
  });

  return columns;
}

function drawCellText(doc: jsPDF, value: string, x: number, y: number, width: number, align: 'left' | 'center' | 'right') {
  const text = trimText(doc, value, width - 3);
  const textX = align === 'right' ? x + width - 2 : align === 'center' ? x + (width / 2) : x + 2;
  doc.text(text, textX, y, { align });
}

function trimText(doc: jsPDF, value: string, maxWidth: number) {
  if (doc.getTextWidth(value) <= maxWidth) return value;
  let text = value;
  while (text.length > 0 && doc.getTextWidth(`${text}...`) > maxWidth) {
    text = text.slice(0, -1);
  }
  return `${text}...`;
}
