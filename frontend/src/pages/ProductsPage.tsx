import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useTabStore } from '../store/tabStore';
import { catalogApi } from '../services/catalog.api';
import { puntoVentaApi } from '../services/puntoVenta.api';
import { useAuthStore } from '../store/authStore';
import type { Producto } from '../types';
import { fmtMoney, fmtUsd } from '../utils/format';
import { ProductFormModal } from '../components/products/ProductFormModal';
import { BulkPriceModal } from '../components/products/BulkPriceModal';
import { PriceListModal } from '../components/products/PriceListModal';
import { ExportButtons, type ExportColumn } from '../components/ExportButtons';
import { RowContextMenu } from '../components/RowContextMenu';
import { useRowActions, type RowAction } from '../hooks/useRowActions';


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
  const [unidadIds, setUnidadIds] = useState<number[]>([]);
  const [activo, setActivo] = useState<boolean | undefined>(undefined);
  const [listaDefecto, setListaDefecto] = useState<number | undefined>();
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
  const [stockPvId, setStockPvId] = useState<number | undefined>();

  // Price list modal
  const [priceListOpen, setPriceListOpen] = useState(false);
  const [priceListProduct, setPriceListProduct] = useState<Producto | null>(null);

  // Inline editing
  const [editing, setEditing] = useState<EditingCell>(null);
  const inputRef = useRef<InputRef>(null);

  // ── Data queries ─────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['products', page, pageSize, search, categoriaId, marcaId, unidadIds, activo, listaDefecto, orderBy, orderDir],
    queryFn: () => productApi.getAll({
      page, pageSize,
      search: search || undefined,
      categoriaId, marcaId,
      unidadIds: unidadIds.length > 0 ? unidadIds.join(',') : undefined,
      activo,
      listaDefecto,
      orderBy, orderDir,
    }),
  });

  const { data: categorias } = useQuery({ queryKey: ['categorias'], queryFn: () => catalogApi.getCategorias() });
  const { data: marcas } = useQuery({ queryKey: ['marcas'], queryFn: () => catalogApi.getMarcas() });
  const { data: unidades } = useQuery({ queryKey: ['unidades'], queryFn: () => catalogApi.getUnidades() });
  const { data: listas } = useQuery({ queryKey: ['listas-precios'], queryFn: () => catalogApi.getListasPrecios() });

  // ── Query para exportar TODOS los productos (sin paginación) ──
  // Esta query carga todos los productos aplicados los mismos filtros para exportar
const { data: allProductsData } = useQuery({
    queryKey: ['products-all', search, categoriaId, marcaId, unidadIds, activo, listaDefecto, orderBy, orderDir],
    queryFn: () => productApi.getAll({
      page: 1,
      pageSize: 999999, // Número grande para obtener todos
      search: search || undefined,
      categoriaId, marcaId,
      unidadIds: unidadIds.length > 0 ? unidadIds.join(',') : undefined,
      activo,
      listaDefecto,
      orderBy, orderDir,
    }),
    staleTime: 30 * 1000, // 30 segundos de cache
  });

  // Detail
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['product-detail', detailId],
    queryFn: () => productApi.getById(detailId!),
    enabled: !!detailId && detailOpen,
  });

  const canVerTodosPV = useAuthStore(s => s.hasPermiso('configuracion.ver'));

  const { data: pvSelector } = useQuery({
    queryKey: ['puntos-venta-selector'],
    queryFn: () => puntoVentaApi.getSelector(),
    enabled: canVerTodosPV && detailOpen,
  });

  const { data: stockData } = useQuery({
    queryKey: ['product-stock', detailId, stockPvId],
    queryFn: () => productApi.getStock(detailId!, stockPvId ? { puntoVentaId: stockPvId } : undefined),
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

  useEffect(() => {
    const handler = () => { if (useTabStore.getState().activeKey === '/products') handleNew(); };
    window.addEventListener('rg:nuevo', handler);
    return () => window.removeEventListener('rg:nuevo', handler);
  }, []);
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

  const handleDetail = (record: Producto) => { setDetailId(record.PRODUCTO_ID); setStockPvId(undefined); setDetailOpen(true); };

  // ── Row interactions (active row + context menu) ─
  const contextMenuActions = useMemo<RowAction<Producto>[]>(() => [
    { key: 'view', label: 'Ver detalle', icon: <EyeOutlined />, onClick: handleDetail },
    { key: 'edit', label: 'Editar', icon: <EditOutlined />, onClick: handleEdit },
    { key: 'copy', label: 'Copiar', icon: <CopyOutlined />, onClick: handleCopy },
    { type: 'divider' },
    { key: 'delete', label: 'Eliminar', icon: <DeleteOutlined />, danger: true, onClick: handleDelete },
  ], []);

  const { onRow, rowClassName, contextMenu, contextMenuItems, closeContextMenu } = useRowActions<Producto>({
    getRowId: (r) => r.PRODUCTO_ID,
    primaryAction: handleDetail,
    actions: contextMenuActions,
  });

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
        onDoubleClick={(e) => { e.stopPropagation(); startEdit(id, field, value); }}
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
      title: 'Lista pred.',
      key: 'LISTA_PREDETERMINADA',
      width: 140,
      align: 'center',
      sorter: true,
      render: (_: any, record: Producto) => {
        const defList = record.LISTA_DEFECTO ?? 1;
        const found = record.PRECIOS?.find(p => p.LISTA_ID === defList);
        const price = found?.PRECIO ?? 0;
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
        const unidad = record.UNIDAD_ABREVIACION ? ` ${record.UNIDAD_ABREVIACION}` : '';
        return <Text type={low ? 'danger' : undefined} strong={low}>{v}{unidad}</Text>;
      },
    },
    {
      title: 'Estado',
      dataIndex: 'ACTIVO',
      key: 'ACTIVO',
      width: 95,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Activo' : 'Inactivo'}</Tag>,
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

  // ── Export columns ──────────────────────────────
  const exportColumns: ExportColumn<Producto>[] = useMemo(() => {
    const precioCols = (listas ?? []).map(l => ({
      title: l.NOMBRE,
      numeric: true, money: true, align: 'right' as const, width: 14,
      render: (_v: any, r: Producto) => r.PRECIOS?.find(p => p.LISTA_ID === l.LISTA_ID)?.PRECIO ?? 0,
    }));
    return [
      { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 12 },
      { title: 'Nombre', dataIndex: 'NOMBRE', width: 30 },
      { title: 'Categoría', dataIndex: 'CATEGORIA_NOMBRE', width: 20 },
      { title: 'Marca', dataIndex: 'MARCA_NOMBRE', width: 15 },
      ...precioCols,
      { title: 'Costo', dataIndex: 'PRECIO_COMPRA', numeric: true, money: true, align: 'right', width: 14 },
      { title: 'Stock', dataIndex: 'CANTIDAD', numeric: true, align: 'center', width: 10 },
      { title: 'Stock Mín.', dataIndex: 'STOCK_MINIMO', numeric: true, align: 'center', width: 10 },
      { title: 'Estado', render: (_v, r) => r.ACTIVO ? 'Activo' : 'Inactivo', align: 'center', width: 10 },
    ];
  }, [listas]);

  // ── Meta de filtros aplicados ──
  const exportMeta = useMemo(() => {
    const parts: string[] = [];
    if (search) parts.push(`Búsqueda: "${search}"`);
    if (categoriaId) {
      const c = categorias?.find(x => x.CATEGORIA_ID === categoriaId);
      if (c) parts.push(`Categoría: ${c.NOMBRE}`);
    }
    if (marcaId) {
      const m = marcas?.find(x => x.MARCA_ID === marcaId);
      if (m) parts.push(`Marca: ${m.NOMBRE}`);
    }
    if (unidadIds.length > 0) parts.push(`Unidades: ${unidadIds.length}`);
    if (activo === true) parts.push('Sólo activos');
    if (activo === false) parts.push('Sólo inactivos');
    if (listaDefecto) {
      const l = listas?.find(x => x.LISTA_ID === listaDefecto);
      if (l) parts.push(`Lista: ${l.NOMBRE}`);
    }
    return parts.length > 0 ? `Filtros: ${parts.join(' · ')}` : undefined;
  }, [search, categoriaId, marcaId, unidadIds, activo, listaDefecto, categorias, marcas, listas]);

  // Total de la página actual (para summary)
  const exportData = useMemo(() => data?.data ?? [], [data]);
  const exportSummary = useMemo(() => {
    const arr = exportData;
    if (arr.length === 0) return undefined;
    const totalCosto = arr.reduce((s, r) => s + (r.PRECIO_COMPRA ?? 0) * (r.CANTIDAD ?? 0), 0);
    const totalStock = arr.reduce((s, r) => s + (r.CANTIDAD ?? 0), 0);
    return [[
      '', '', '', '', '', '', '', '', 'TOTALES',
      fmtMoney(totalCosto),
      String(totalStock),
      '', '',
    ]];
  }, [exportData]);

  // ── Detail modal ─────────────────────────────────
  const renderDetail = () => {
    if (!detail) return null;
    const d = detail as ProductDetail;
    return (
      <div>
        <table className="rg-detail-table">
          <tbody>
            {[
              ['ID', d.PRODUCTO_ID],
              ['Código', d.CODIGOPARTICULAR],
              ['Nombre', d.NOMBRE],
              ['Descripción', d.DESCRIPCION || '-'],
              ['Categoría', d.CATEGORIA_NOMBRE || '-'],
              ['Marca', d.MARCA_NOMBRE || '-'],
              ['Unidad', d.UNIDAD_NOMBRE || '-'],
              ['IVA', d.TASA_IVA_NOMBRE ? `${d.TASA_IVA_NOMBRE} (${d.TASA_IVA_PORCENTAJE}%)` : '-'],
              ['Costo ARS', fmtMoney(d.PRECIO_COMPRA)],
              ['Costo USD', fmtUsd(d.COSTO_USD)],
              ...((listas ?? []).map(l => [
                l.NOMBRE,
                fmtMoney(d.precios?.find(p => p.LISTA_ID === l.LISTA_ID)?.PRECIO ?? 0),
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
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Text strong>Stock por Depósito</Text>
            {canVerTodosPV && pvSelector && pvSelector.length > 1 && (
              <Select
                placeholder="Todos los puntos de venta"
                allowClear
                style={{ flex: 1, maxWidth: 220 }}
                value={stockPvId}
                onChange={(v) => setStockPvId(v)}
                options={pvSelector.filter(pv => pv.ACTIVO).map(pv => ({ value: pv.PUNTO_VENTA_ID, label: pv.NOMBRE }))}
                size="small"
              />
            )}
          </div>
          {stockData && stockData.length > 0 ? (
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
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>Sin stock en depósitos{stockPvId ? ' para este punto de venta' : ''}.</Text>
          )}
        </div>
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
            placeholder="Buscar código, nombre, barras o ID..."
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
            mode="multiple"
            placeholder="Unidad"
            allowClear
            maxTagCount="responsive"
            style={{ width: 190 }}
            value={unidadIds}
            onChange={(v) => { setUnidadIds(v); setPage(1); }}
            showSearch
            optionFilterProp="label"
            options={unidades?.map(u => ({ label: `${u.NOMBRE} (${u.ABREVIACION})`, value: u.UNIDAD_ID }))}
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
          <Select
            placeholder="Todas"
            allowClear
            style={{ width: 170 }}
            value={listaDefecto}
            onChange={(v) => { setListaDefecto(v); setPage(1); }}
            showSearch
            optionFilterProp="label"
            prefix={<span style={{ fontSize: 12, color: '#8c8c8c', marginRight: 2 }}>Lista</span>}
            options={listas?.filter(l => l.ACTIVA).map(l => ({ label: l.NOMBRE, value: l.LISTA_ID }))}
            suffixIcon={<FilterOutlined />}
          />
        </Space>
        <Space size="small">
          <Tooltip title="Refrescar">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          </Tooltip>
          <ExportButtons
            data={exportData}
            allData={allProductsData?.data}
            totalCount={allProductsData?.total}
            columns={exportColumns}
            title="Listado de Productos"
            subtitle="ABM de Productos"
            meta={exportMeta}
            footerSummary={exportSummary}
            fileName="productos"
            sheetName="Productos"
          />
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
        onRow={onRow}
        rowClassName={rowClassName}
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

      {/* ── Row context menu (right click) ────── */}
      <RowContextMenu
        open={contextMenu !== null}
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        items={contextMenuItems}
        onClose={closeContextMenu}
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
