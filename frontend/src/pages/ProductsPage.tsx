import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Input, Typography, Tag, Select, Button, Dropdown, Modal, App,
  Tooltip, InputNumber, Drawer, Spin,
} from 'antd';
import type { InputRef, TableColumnType } from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, CopyOutlined, DownOutlined, TagsOutlined,
  DollarOutlined, BarcodeOutlined, FilterOutlined, ReloadOutlined,
} from '@ant-design/icons';
import { productApi, type ProductDetail } from '../services/product.api';
import { catalogApi } from '../services/catalog.api';
import type { Producto } from '../types';
import { fmtMoney, fmtUsd } from '../utils/format';
import { ProductFormModal } from '../components/products/ProductFormModal';
import { BulkPriceModal } from '../components/products/BulkPriceModal';
import { PriceListModal } from '../components/products/PriceListModal';

const { Title, Text } = Typography;

type EditingCell = { id: number; field: string; value: any } | null;

export function ProductsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [categoriaId, setCategoriaId] = useState<number | undefined>();
  const [marcaId, setMarcaId] = useState<number | undefined>();
  const [activo, setActivo] = useState<boolean | undefined>(undefined);
  const [orderBy, setOrderBy] = useState<string>('NOMBRE');
  const [orderDir, setOrderDir] = useState<'ASC' | 'DESC'>('ASC');

  // Selection
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [copyFrom, setCopyFrom] = useState<Producto | null>(null);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);

  // Detail drawer
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  // Price list modal
  const [priceListOpen, setPriceListOpen] = useState(false);
  const [priceListProduct, setPriceListProduct] = useState<Producto | null>(null);

  // Inline editing
  const [editing, setEditing] = useState<EditingCell>(null);
  const inputRef = useRef<InputRef>(null);

  // ── Data queries ─────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['products', page, pageSize, search, categoriaId, marcaId, activo, orderBy, orderDir],
    queryFn: () => productApi.getAll({
      page, pageSize,
      search: search || undefined,
      categoriaId, marcaId,
      activo,
      orderBy, orderDir,
    }),
  });

  const { data: categorias } = useQuery({ queryKey: ['categorias'], queryFn: () => catalogApi.getCategorias() });
  const { data: marcas } = useQuery({ queryKey: ['marcas'], queryFn: () => catalogApi.getMarcas() });
  const { data: listas } = useQuery({ queryKey: ['listas-precios'], queryFn: () => catalogApi.getListasPrecios() });

  // Detail
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['product-detail', detailId],
    queryFn: () => productApi.getById(detailId!),
    enabled: !!detailId && detailOpen,
  });

  const { data: stockData } = useQuery({
    queryKey: ['product-stock', detailId],
    queryFn: () => productApi.getStock(detailId!),
    enabled: !!detailId && detailOpen,
  });

  // ── Helpers ──────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['product-edit'] });
    setSelectedRowKeys([]);
  }, [qc]);

  const selectedIds = useMemo(() => selectedRowKeys.map(Number), [selectedRowKeys]);

  // ── Inline edit ──────────────────────────────────
  const startEdit = (id: number, field: string, value: any) => {
    setEditing({ id, field, value });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const saveInlineEdit = async () => {
    if (!editing) return;
    try {
      await productApi.inlineEdit({ PRODUCTO_ID: editing.id, campo: editing.field, valor: editing.value });
      invalidate();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Error al editar');
    }
    setEditing(null);
  };

  const cancelEdit = () => setEditing(null);

  const isEditing = (id: number, field: string) =>
    editing?.id === id && editing?.field === field;

  // ── Actions ──────────────────────────────────────
  const handleNew = () => { setEditId(null); setCopyFrom(null); setFormOpen(true); };
  const handleEdit = (record: Producto) => { setEditId(record.PRODUCTO_ID); setCopyFrom(null); setFormOpen(true); };
  const handleCopy = (record: Producto) => { setEditId(null); setCopyFrom(record); setFormOpen(true); };

  const handleDelete = (record: Producto) => {
    Modal.confirm({
      title: 'Eliminar producto',
      content: `¿Eliminar "${record.NOMBRE}"? Si está referenciado en ventas o compras se desactivará.`,
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        const result = await productApi.delete(record.PRODUCTO_ID);
        message.success(result.mode === 'soft' ? 'Producto desactivado (está en ventas/compras)' : 'Producto eliminado');
        invalidate();
      },
    });
  };

  const handleDetail = (record: Producto) => { setDetailId(record.PRODUCTO_ID); setDetailOpen(true); };

  // ── Bulk actions ─────────────────────────────────
  const handleBulkDelete = () => {
    Modal.confirm({
      title: 'Eliminar seleccionados',
      content: `¿Eliminar ${selectedIds.length} producto(s)? Los referenciados se desactivarán.`,
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        const result = await productApi.bulkDelete(selectedIds);
        message.success(`Eliminados: ${result.deleted}, Desactivados: ${result.deactivated}`);
        invalidate();
      },
    });
  };

  const handleBulkAssign = (campo: string, label: string) => {
    const isCategoria = campo === 'CATEGORIA_ID';
    const isMarca = campo === 'MARCA_ID';

    let selected: number | undefined;

    Modal.confirm({
      title: `Asignar ${label} a ${selectedIds.length} producto(s)`,
      content: (
        <Select
          showSearch
          optionFilterProp="label"
          style={{ width: '100%', marginTop: 8 }}
          placeholder={`Seleccioná ${label}`}
          onChange={(v: number) => { selected = v; }}
          options={
            isCategoria
              ? categorias?.map(c => ({ label: c.NOMBRE, value: c.CATEGORIA_ID }))
              : isMarca
              ? marcas?.map(m => ({ label: m.NOMBRE, value: m.MARCA_ID }))
              : []
          }
        />
      ),
      okText: 'Asignar',
      cancelText: 'Cancelar',
      onOk: async () => {
        if (!selected) { message.warning('No seleccionaste un valor'); return; }
        await productApi.bulkAssign({ productoIds: selectedIds, campo, valor: selected });
        message.success(`${label} asignada a ${selectedIds.length} producto(s)`);
        invalidate();
      },
    });
  };

  // ── Editable cell renderer ───────────────────────
  const editableCell = (field: string, record: Producto, value: any, isPrice = false) => {
    const id = record.PRODUCTO_ID;
    if (isEditing(id, field)) {
      return isPrice ? (
        <InputNumber
          ref={inputRef as any}
          size="small"
          value={editing!.value}
          min={0}
          precision={2}
          style={{ width: '100%' }}
          onChange={(v) => setEditing({ ...editing!, value: v })}
          onPressEnter={saveInlineEdit}
          onBlur={saveInlineEdit}
          onKeyDown={(e) => e.key === 'Escape' && cancelEdit()}
        />
      ) : (
        <Input
          ref={inputRef}
          size="small"
          value={editing!.value}
          onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
          onPressEnter={saveInlineEdit}
          onBlur={saveInlineEdit}
          onKeyDown={(e) => e.key === 'Escape' && cancelEdit()}
        />
      );
    }

    return (
      <div
        style={{ cursor: 'pointer', minHeight: 22 }}
        onDoubleClick={() => startEdit(id, field, value)}
        title="Doble click para editar"
      >
        {isPrice ? fmtMoney(value) : (value || '')}
      </div>
    );
  };

  // ── Table sort change ────────────────────────────
  const handleTableChange = (_pagination: any, _filters: any, sorter: any) => {
    if (sorter.field) {
      const colMap: Record<string, string> = {
        CODIGOPARTICULAR: 'CODIGOPARTICULAR',
        NOMBRE: 'NOMBRE',
        LISTA_1: 'LISTA_1',
        CANTIDAD: 'CANTIDAD',
        CATEGORIA_NOMBRE: 'CATEGORIA_NOMBRE',
        MARCA_NOMBRE: 'MARCA_NOMBRE',
      };
      const mappedCol = colMap[sorter.field];
      if (mappedCol) {
        setOrderBy(mappedCol);
        setOrderDir(sorter.order === 'descend' ? 'DESC' : 'ASC');
      }
    }
  };

  // ── Columns ──────────────────────────────────────
  const columns: TableColumnType<Producto>[] = [
    {
      title: 'Código',
      dataIndex: 'CODIGOPARTICULAR',
      key: 'CODIGOPARTICULAR',
      width: 110,
      sorter: true,
      render: (v: string, record: Producto) => editableCell('CODIGOPARTICULAR', record, v),
    },
    {
      title: 'Nombre',
      dataIndex: 'NOMBRE',
      key: 'NOMBRE',
      ellipsis: true,
      sorter: true,
      render: (v: string, record: Producto) => editableCell('NOMBRE', record, v),
    },
    {
      title: 'Categoría',
      dataIndex: 'CATEGORIA_NOMBRE',
      key: 'CATEGORIA_NOMBRE',
      width: 200,
      sorter: true,
      ellipsis: { showTitle: true },
      
    },
    {
      title: 'Marca',
      dataIndex: 'MARCA_NOMBRE',
      key: 'MARCA_NOMBRE',
      width: 130,
      sorter: true,
      ellipsis: { showTitle: true },
    },
    {
      title: 'Listas $',
      dataIndex: 'LISTA_1',
      key: 'LISTA_1',
      width: 130,
      align: 'right',
      sorter: true,
      render: (_: number, record: Producto) => {
        const defList = record.LISTA_DEFECTO ?? 1;
        const price = (record as any)[`LISTA_${defList}`] as number ?? record.LISTA_1;
        return (
          <div
            style={{ cursor: 'pointer', minHeight: 22 }}
            onClick={() => { setPriceListProduct(record); setPriceListOpen(true); }}
            title="Click para ver/editar todas las listas"
          >
            <span style={{ borderBottom: '1px dashed rgba(234,189,35,0.5)' }}>
              {fmtMoney(price)}
            </span>
          </div>
        );
      },
    },
    {
      title: 'Costo',
      dataIndex: 'PRECIO_COMPRA',
      key: 'PRECIO_COMPRA',
      width: 125,
      align: 'right',
      render: (v: number, record: Producto) => editableCell('PRECIO_COMPRA', record, v, true),
    },
    {
      title: 'Stock',
      dataIndex: 'CANTIDAD',
      key: 'CANTIDAD',
      width: 96,
      align: 'center',
      sorter: true,
      render: (v: number, record: Producto) => {
        if (record.ES_SERVICIO) return <Tag color="blue">Servicio</Tag>;
        const low = record.STOCK_MINIMO != null && v <= record.STOCK_MINIMO;
        return <Text type={low ? 'danger' : undefined} strong={low}>{v}</Text>;
      },
    },
    {
      title: 'Estado',
      dataIndex: 'ACTIVO',
      key: 'ACTIVO',
      width: 95,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Activo' : 'Inactivo'}</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 120,
      fixed: 'right',
      render: (_: unknown, record: Producto) => (
        <Space size={4}>
          <Tooltip title="Ver detalle">
            <Button type="text" size="small" icon={<EyeOutlined />}
              onClick={() => handleDetail(record)} style={{ color: '#EABD23' }} />
          </Tooltip>
          <Tooltip title="Editar">
            <Button type="text" size="small" icon={<EditOutlined />}
              onClick={() => handleEdit(record)} style={{ color: '#EABD23' }} />
          </Tooltip>
          <Tooltip title="Copiar">
            <Button type="text" size="small" icon={<CopyOutlined />}
              onClick={() => handleCopy(record)} />
          </Tooltip>
          <Tooltip title="Eliminar">
            <Button type="text" size="small" danger icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // ── Bulk actions menu ────────────────────────────
  const bulkMenuItems = [
    { key: 'cat', icon: <TagsOutlined />, label: 'Asignar categoría', onClick: () => handleBulkAssign('CATEGORIA_ID', 'Categoría') },
    { key: 'brand', icon: <TagsOutlined />, label: 'Asignar marca', onClick: () => handleBulkAssign('MARCA_ID', 'Marca') },
    { type: 'divider' as const },
    { key: 'prices', icon: <DollarOutlined />, label: 'Generar precios', onClick: () => setBulkPriceOpen(true) },
    { type: 'divider' as const },
    { key: 'delete', icon: <DeleteOutlined />, label: 'Eliminar seleccionados', danger: true, onClick: handleBulkDelete },
  ];

  // ── Detail modal ─────────────────────────────────
  const renderDetail = () => {
    if (!detail) return null;
    const d = detail as ProductDetail;
    return (
      <div>
        <table className="rg-detail-table">
          <tbody>
            {[
              ['Código', d.CODIGOPARTICULAR],
              ['Nombre', d.NOMBRE],
              ['Descripción', d.DESCRIPCION || '-'],
              ['Categoría', d.CATEGORIA_NOMBRE || '-'],
              ['Marca', d.MARCA_NOMBRE || '-'],
              ['Unidad', d.UNIDAD_NOMBRE || '-'],
              ['IVA', d.TASA_IVA_NOMBRE ? `${d.TASA_IVA_NOMBRE} (${d.TASA_IVA_PORCENTAJE}%)` : '-'],
              ['Costo ARS', fmtMoney(d.PRECIO_COMPRA)],
              ['Costo USD', fmtUsd(d.COSTO_USD)],
              ...([1, 2, 3, 4, 5].map(i => [
                listas?.[i - 1]?.NOMBRE || `Lista ${i}`,
                fmtMoney(d[`LISTA_${i}` as keyof Producto] as number),
              ])),
              ['Stock', String(d.CANTIDAD)],
              ['Stock Mínimo', d.STOCK_MINIMO != null ? String(d.STOCK_MINIMO) : '-'],
              ['Códigos de Barras', d.codigosBarras?.join(', ') || '-'],
              ['Proveedores', d.proveedores?.map(p => p.PROVEEDOR_NOMBRE).join(', ') || '-'],
              ['Estado', ''],
            ].map(([label, val], i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600, padding: '6px 12px', whiteSpace: 'nowrap', color: '#999' }}>{label}</td>
                <td style={{ padding: '6px 12px' }}>
                  {label === 'Estado'
                    ? <Tag color={d.ACTIVO ? 'green' : 'red'}>{d.ACTIVO ? 'Activo' : 'Inactivo'}</Tag>
                    : val}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {stockData && stockData.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Text strong style={{ marginBottom: 8, display: 'block' }}>Stock por Depósito</Text>
            <Table
              size="small"
              dataSource={stockData}
              rowKey="ITEM_ID"
              pagination={false}
              columns={[
                { title: 'Depósito', dataIndex: 'DEPOSITO_NOMBRE' },
                { title: 'Cantidad', dataIndex: 'CANTIDAD', align: 'right' as const },
              ]}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page-enter">
      {/* ── Header ────────────────────────────── */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <Title level={3} style={{ margin: 0 }}>Productos</Title>
        <Space wrap size="small">
          <Input
            placeholder="Buscar código, nombre, barras..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ width: 260 }}
            allowClear
          />
          <Select
            placeholder="Categoría"
            allowClear
            style={{ width: 150 }}
            value={categoriaId}
            onChange={(v) => { setCategoriaId(v); setPage(1); }}
            showSearch
            optionFilterProp="label"
            options={categorias?.map(c => ({ label: c.NOMBRE, value: c.CATEGORIA_ID }))}
            suffixIcon={<FilterOutlined />}
          />
          <Select
            placeholder="Marca"
            allowClear
            style={{ width: 150 }}
            value={marcaId}
            onChange={(v) => { setMarcaId(v); setPage(1); }}
            showSearch
            optionFilterProp="label"
            options={marcas?.map(m => ({ label: m.NOMBRE, value: m.MARCA_ID }))}
            suffixIcon={<FilterOutlined />}
          />
          <Select
            placeholder="Estado"
            allowClear
            style={{ width: 110 }}
            value={activo}
            onChange={(v) => { setActivo(v); setPage(1); }}
            options={[
              { label: 'Activos', value: true },
              { label: 'Inactivos', value: false },
            ]}
          />
        </Space>
        <Space size="small">
          <Tooltip title="Refrescar">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNew} className="btn-gold">
            Nuevo Producto
          </Button>
          {selectedRowKeys.length > 0 && (
            <Dropdown menu={{ items: bulkMenuItems }} trigger={['click']}>
              <Button>
                Acciones ({selectedRowKeys.length}) <DownOutlined />
              </Button>
            </Dropdown>
          )}
        </Space>
      </div>

      {/* ── Table ─────────────────────────────── */}
      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="PRODUCTO_ID"
        loading={isLoading}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          preserveSelectedRowKeys: true,
        }}
        onChange={handleTableChange}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: ['10', '25', '50', '100'],
          showTotal: (total) => `${total} productos`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 1100 }}
      />

      {/* ── Product Form (New / Edit / Copy) ─── */}
      <ProductFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={invalidate}
        editId={editId}
        copyFrom={copyFrom}
      />

      {/* ── Price List Modal (per product) ────── */}
      <PriceListModal
        open={priceListOpen}
        product={priceListProduct}
        onClose={() => { setPriceListOpen(false); setPriceListProduct(null); }}
        onSaved={invalidate}
      />

      {/* ── Bulk Price Modal ──────────────────── */}
      <BulkPriceModal
        open={bulkPriceOpen}
        onClose={() => setBulkPriceOpen(false)}
        onDone={invalidate}
        productIds={selectedIds}
      />

      {/* ── Detail Drawer ─────────────────────── */}
      <Drawer
        title={<span><BarcodeOutlined /> Detalle del Producto</span>}
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetailId(null); }}
        width={560}
        className="rg-drawer"
        extra={
          <Button type="primary" icon={<EditOutlined />} className="btn-gold" size="small"
            onClick={() => { setDetailOpen(false); handleEdit({ PRODUCTO_ID: detailId } as Producto); }}>
            Editar
          </Button>
        }
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : renderDetail()}
      </Drawer>
    </div>
  );
}
