import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Input, Select, Button, Table, Typography, Space, App, Tag, Checkbox,
  Card, Tooltip, Empty, Dropdown,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, PrinterOutlined,
  FilePdfOutlined, BarcodeOutlined, TagOutlined,
  ClearOutlined, EyeOutlined, FilterOutlined, DownOutlined,
} from '@ant-design/icons';
import api from '../services/api';
import { catalogApi } from '../services/catalog.api';
import type { LabelProduct, LabelFormat, LabelConfig } from '../utils/labelPdf';
import { generateA4PDF, generate80mmPDF } from '../utils/labelPdf';
import { LabelPreview } from '../components/etiquetas/LabelPreview';

const { Title, Text } = Typography;

// ── Fetch products for labels ───────────────────
async function fetchForLabels(params: Record<string, any>): Promise<LabelProduct[]> {
  const { data } = await api.get<LabelProduct[]>('/products/for-labels', { params });
  return data;
}

// ── Format options ──────────────────────────────
const FORMAT_OPTIONS: { value: LabelFormat; label: string; desc: string }[] = [
  { value: 'estandar', label: 'Estándar (3 col.)', desc: '3 etiquetas por fila — tamaño medio' },
  { value: 'compacto', label: 'Compacto (4 col.)', desc: '4 etiquetas por fila — más pequeñas' },
  { value: 'grande', label: 'Grande (2 col.)', desc: '2 etiquetas por fila — más detalle' },
];

export function EtiquetasPage() {
  const { message } = App.useApp();

  // ── Search & filters ──
  const [search, setSearch] = useState('');
  const [categoriaId, setCategoriaId] = useState<number | undefined>();
  const [marcaId, setMarcaId] = useState<number | undefined>();

  // ── Config ──
  const [format, setFormat] = useState<LabelFormat>('estandar');
  const [listaPrecios, setListaPrecios] = useState(1);
  const [showBarcode, setShowBarcode] = useState(false);

  // ── Selection ──
  const [selected, setSelected] = useState<LabelProduct[]>([]);

  // ── Preview ──
  const [previewOpen, setPreviewOpen] = useState(false);

  const searchRef = useRef<any>(null);

  // ── Queries ──
  const { data: products, isLoading } = useQuery({
    queryKey: ['products-labels', search, categoriaId, marcaId],
    queryFn: () => fetchForLabels({
      search: search || undefined,
      categoriaId,
      marcaId,
    }),
  });

  const { data: categorias } = useQuery({ queryKey: ['categorias'], queryFn: () => catalogApi.getCategorias() });
  const { data: marcas } = useQuery({ queryKey: ['marcas'], queryFn: () => catalogApi.getMarcas() });
  const { data: listas } = useQuery({ queryKey: ['listas-precios'], queryFn: () => catalogApi.getListasPrecios() });

  // Focus search on mount
  useEffect(() => {
    setTimeout(() => searchRef.current?.focus(), 100);
  }, []);

  // ── Helpers ──
  const selectedIds = useMemo(() => new Set(selected.map(p => p.PRODUCTO_ID)), [selected]);

  const formatPrice = useCallback((product: LabelProduct) => {
    const prices: Record<number, number> = {
      1: product.LISTA_1, 2: product.LISTA_2, 3: product.LISTA_3,
      4: product.LISTA_4, 5: product.LISTA_5,
    };
    return new Intl.NumberFormat('es-AR', {
      style: 'currency', currency: 'ARS', minimumFractionDigits: 2,
    }).format(prices[listaPrecios] ?? product.LISTA_1);
  }, [listaPrecios]);

  const addProduct = useCallback((product: LabelProduct) => {
    setSelected(prev => {
      if (prev.some(p => p.PRODUCTO_ID === product.PRODUCTO_ID)) return prev;
      return [...prev, product];
    });
  }, []);

  const removeProduct = useCallback((id: number) => {
    setSelected(prev => prev.filter(p => p.PRODUCTO_ID !== id));
  }, []);

  const addAllVisible = useCallback(() => {
    if (!products?.length) return;
    setSelected(prev => {
      const existing = new Set(prev.map(p => p.PRODUCTO_ID));
      const toAdd = products.filter(p => !existing.has(p.PRODUCTO_ID));
      return [...prev, ...toAdd];
    });
    message.success(`Productos visibles agregados`);
  }, [products, message]);

  const clearAll = useCallback(() => {
    setSelected([]);
  }, []);

  // ── Config object for PDF gen ──
  const labelConfig: LabelConfig = useMemo(() => ({
    format,
    listaPrecios,
    showBarcode,
  }), [format, listaPrecios, showBarcode]);

  // ── PDF generation ──
  const handleExport = useCallback((type: 'a4' | '80mm') => {
    if (selected.length === 0) {
      message.warning('Seleccione al menos un producto');
      return;
    }
    try {
      const doc = type === 'a4'
        ? generateA4PDF(selected, labelConfig)
        : generate80mmPDF(selected, labelConfig);
      const suffix = type === 'a4' ? 'A4' : '80mm';
      doc.save(`Etiquetas_${suffix}_${new Date().toISOString().slice(0, 10)}.pdf`);
      message.success('PDF generado exitosamente');
    } catch (err) {
      message.error('Error al generar PDF');
      console.error(err);
    }
  }, [selected, labelConfig, message]);

  const handlePreview = useCallback(() => {
    if (selected.length === 0) {
      message.warning('Seleccione al menos un producto');
      return;
    }
    setPreviewOpen(true);
  }, [selected, message]);

  // ── Available products columns ──
  const prodColumns: ColumnsType<LabelProduct> = [
    {
      title: 'Cod',
      dataIndex: 'CODIGOPARTICULAR',
      width: 80,
      align: 'center',
      render: (v: string) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Nombre',
      dataIndex: 'NOMBRE',
      ellipsis: true,
    },
    {
      title: 'Categoría',
      dataIndex: 'CATEGORIA_NOMBRE',
      width: 130,
      ellipsis: true,
      render: (v: string) => v ? <Tag>{v}</Tag> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Precio',
      key: 'precio',
      width: 110,
      align: 'right',
      render: (_: any, record: LabelProduct) => (
        <Text strong style={{ color: 'var(--rg-gold-dark)' }}>{formatPrice(record)}</Text>
      ),
    },
    {
      title: '',
      key: 'action',
      width: 50,
      align: 'center',
      render: (_: any, record: LabelProduct) => {
        const isSelected = selectedIds.has(record.PRODUCTO_ID);
        return (
          <Tooltip title={isSelected ? 'Ya agregado' : 'Agregar'}>
            <Button
              type={isSelected ? 'default' : 'primary'}
              size="small"
              icon={isSelected ? <Tag color="green" style={{ margin: 0, fontSize: 10 }}>✓</Tag> : <PlusOutlined />}
              onClick={() => addProduct(record)}
              disabled={isSelected}
              className={isSelected ? '' : 'btn-gold'}
              style={{ minWidth: 32 }}
            />
          </Tooltip>
        );
      },
    },
  ];

  // ── Selected products columns ──
  const selColumns: ColumnsType<LabelProduct> = [
    {
      title: 'Cod',
      dataIndex: 'CODIGOPARTICULAR',
      width: 70,
      align: 'center',
      render: (v: string) => <Text code style={{ fontSize: 11 }}>{v}</Text>,
    },
    {
      title: 'Nombre',
      dataIndex: 'NOMBRE',
      ellipsis: true,
    },
    {
      title: 'C.B.',
      key: 'cb',
      width: 60,
      align: 'center',
      render: (_: any, r: LabelProduct) => r.CODIGO_BARRAS
        ? <BarcodeOutlined style={{ color: 'var(--rg-gold-dark)' }} />
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Precio',
      key: 'precio',
      width: 100,
      align: 'right',
      render: (_: any, record: LabelProduct) => (
        <Text strong>{formatPrice(record)}</Text>
      ),
    },
    {
      title: '',
      key: 'quitar',
      width: 40,
      align: 'center',
      render: (_: any, record: LabelProduct) => (
        <Button
          type="text"
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => removeProduct(record.PRODUCTO_ID)}
        />
      ),
    },
  ];

  return (
    <div className="page-enter etiquetas-page">
      {/* ── Header ─────────────────────────────── */}
      <div className="page-header" style={{ marginBottom: 12 }}>
        <Title level={3} style={{ margin: 0 }}>Etiquetas de Precios</Title>
        <Space size="small">
          <Tag color="default" style={{ fontSize: 13, padding: '4px 12px', margin: 0 }}>
            {selected.length} {selected.length === 1 ? 'producto' : 'productos'} seleccionado{selected.length !== 1 ? 's' : ''}
          </Tag>
        </Space>
      </div>

      {/* ── Main Layout ────────────────────────── */}
      <div className="etiquetas-layout">
        {/* ── Left: Product Search ──────────────── */}
        <Card className="etiquetas-panel etiquetas-panel-left" size="small"
          title={<Space><SearchOutlined /> Buscar Productos</Space>}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <Input
              ref={searchRef}
              placeholder="Buscar por nombre, código o código de barras..."
              prefix={<SearchOutlined style={{ color: 'var(--rg-gold-dark)' }} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
              style={{ flex: 1, minWidth: 200 }}
            />
            <Select
              placeholder="Categoría"
              allowClear
              style={{ width: 140 }}
              value={categoriaId}
              onChange={setCategoriaId}
              showSearch
              optionFilterProp="label"
              suffixIcon={<FilterOutlined />}
              options={categorias?.map(c => ({ label: c.NOMBRE, value: c.CATEGORIA_ID }))}
            />
            <Select
              placeholder="Marca"
              allowClear
              style={{ width: 130 }}
              value={marcaId}
              onChange={setMarcaId}
              showSearch
              optionFilterProp="label"
              suffixIcon={<FilterOutlined />}
              options={marcas?.map(m => ({ label: m.NOMBRE, value: m.MARCA_ID }))}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {products?.length ?? 0} producto{(products?.length ?? 0) !== 1 ? 's' : ''} encontrado{(products?.length ?? 0) !== 1 ? 's' : ''}
            </Text>
            <Button size="small" type="link" icon={<PlusOutlined />} onClick={addAllVisible}
              disabled={!products?.length}>
              Agregar todos
            </Button>
          </div>
          <Table
            className="rg-table etiquetas-table"
            columns={prodColumns}
            dataSource={products}
            rowKey="PRODUCTO_ID"
            loading={isLoading}
            size="small"
            pagination={{ pageSize: 15, showSizeChanger: false, size: 'small' }}
            scroll={{ y: 'calc(100vh - 450px)' }}
            onRow={(record) => ({
              onDoubleClick: () => addProduct(record),
              style: { cursor: 'pointer' },
            })}
          />
        </Card>

        {/* ── Right: Selected & Config ──────────── */}
        <div className="etiquetas-right">
          {/* ── Config Panel ── */}
          <Card className="etiquetas-panel" size="small"
            title={<Space><PrinterOutlined /> Configuración de Impresión</Space>}>
            <div className="etiquetas-config-grid">
              <div className="etiquetas-config-item">
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                  Formato A4
                </Text>
                <Select
                  value={format}
                  onChange={setFormat}
                  style={{ width: '100%' }}
                  options={FORMAT_OPTIONS.map(f => ({
                    value: f.value,
                    label: f.label,
                  }))}
                />
              </div>
              <div className="etiquetas-config-item">
                <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>
                  Lista de Precios
                </Text>
                <Select
                  value={listaPrecios}
                  onChange={setListaPrecios}
                  style={{ width: '100%' }}
                  options={listas?.map(l => ({
                    value: l.LISTA_ID,
                    label: l.NOMBRE,
                  })) || [
                    { value: 1, label: 'Lista 1' },
                    { value: 2, label: 'Lista 2' },
                    { value: 3, label: 'Lista 3' },
                    { value: 4, label: 'Lista 4' },
                    { value: 5, label: 'Lista 5' },
                  ]}
                />
              </div>
              <div className="etiquetas-config-item" style={{ display: 'flex', alignItems: 'center', paddingTop: 20 }}>
                <Checkbox checked={showBarcode} onChange={(e) => setShowBarcode(e.target.checked)}>
                  <Space size={4}>
                    <BarcodeOutlined />
                    <span>Imprimir Código de Barras</span>
                  </Space>
                </Checkbox>
              </div>
            </div>
          </Card>

          {/* ── Selected Products ── */}
          <Card className="etiquetas-panel etiquetas-panel-selected" size="small"
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <Space><TagOutlined /> Productos Seleccionados ({selected.length})</Space>
                {selected.length > 0 && (
                  <Button type="link" danger size="small" icon={<ClearOutlined />} onClick={clearAll}>
                    Quitar todos
                  </Button>
                )}
              </div>
            }>
            {selected.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Text type="secondary">
                    Haga doble clic o use el botón + para agregar productos
                  </Text>
                }
                style={{ padding: '20px 0' }}
              />
            ) : (
              <Table
                className="rg-table etiquetas-selected-table"
                columns={selColumns}
                dataSource={selected}
                rowKey="PRODUCTO_ID"
                size="small"
                pagination={false}
                scroll={{ y: 'calc(100vh - 510px)' }}
              />
            )}
          </Card>

          {/* ── Action Buttons ── */}
          <div className="etiquetas-actions">
            <Button
              icon={<EyeOutlined />}
              onClick={handlePreview}
              disabled={selected.length === 0}
              style={{ flex: 1 }}
            >
              Vista Previa
            </Button>
            <Dropdown
              menu={{
                items: [
                  { key: 'a4', icon: <FilePdfOutlined />, label: 'Exportar PDF A4' },
                  { key: '80mm', icon: <PrinterOutlined />, label: 'Exportar PDF 80mm' },
                ],
                onClick: ({ key }) => handleExport(key as 'a4' | '80mm'),
              }}
              disabled={selected.length === 0}
            >
              <Button
                type="primary"
                icon={<FilePdfOutlined />}
                className="btn-gold"
                disabled={selected.length === 0}
                style={{ flex: 1 }}
              >
                Exportar PDF <DownOutlined />
              </Button>
            </Dropdown>
          </div>
        </div>
      </div>

      {/* ── Preview Modal ── */}
      <LabelPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        products={selected}
        config={labelConfig}
        type="a4"
      />
    </div>
  );
}
