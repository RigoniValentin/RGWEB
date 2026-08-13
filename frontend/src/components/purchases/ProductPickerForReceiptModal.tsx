import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Modal, Input, Select, Table, Button, Space, Checkbox, Tag, Typography, Tooltip, Tabs,
  InputNumber, Form,
} from 'antd';
import { SearchOutlined, PlusOutlined, FilterOutlined } from '@ant-design/icons';
import { salesApi } from '../../services/sales.api';
import { productApi } from '../../services/product.api';
import { useSettingsStore } from '../../store/settingsStore';
import { fmtMoney } from '../../utils/format';
import { notify } from '../../utils/notify';
import { RGCajaModalHeader } from '../RGCajaModalHeader';
import { rgIcon } from '../rg-icons';
import type { ProductoSearch, Marca } from '../../types';
import type { ProductoCandidato } from '../../services/purchases.api';

const { Text } = Typography;

// ═══════════════════════════════════════════════════════════════════════════
//  ProductPickerForReceiptModal
//
//  Modal centrado, autocontenido, usado SOLO desde el flujo de "Cargar
//  comprobante por imagen". Tiene dos pestañas:
//    1. "Buscar"     — usa salesApi.searchProductsAdvanced, idéntico a la
//                       búsqueda del modal estándar que usan Compras y Ventas.
//    2. "Crear"      — formulario inline para crear un producto mínimo.
//
//  Aislamiento: este archivo se importa únicamente desde
//  PurchaseReceiptReviewModal, no modifica el comportamiento de
//  ProductSearchModal ni de NewSaleModal / NewPurchaseModal.
// ═══════════════════════════════════════════════════════════════════════════

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (producto: ProductoCandidato) => void;
  initialQuery?: string;
  initialCodigoProveedor?: string | null;
  initialPrecio?: number;
  tasaIvaDefault?: { TASA_ID: number; PORCENTAJE: number } | null;
  /** Categorías y marcas opcionales para los filtros avanzados. Si no se pasan,
   *  el modal igual funciona, sólo que no muestra esos combos. */
  marcaOptions?: Marca[];
}

type TabKey = 'search' | 'create';

export function ProductPickerForReceiptModal({
  open,
  onClose,
  onPick,
  initialQuery = '',
  initialCodigoProveedor,
  initialPrecio,
  tasaIvaDefault,
  marcaOptions,
}: Props) {
  const [tab, setTab] = useState<TabKey>('search');

  // ── Buscar ───────────────────────────────────────────────────
  const [keywords, setKeywords] = useState('');
  const [marca, setMarca] = useState('');
  const [marcaIds, setMarcaIds] = useState<number[]>([]);
  const [categoria, setCategoria] = useState('');
  const [codigo, setCodigo] = useState('');
  const [soloActivos, setSoloActivos] = useState(true);
  const [soloConStock, setSoloConStock] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [results, setResults] = useState<ProductoSearch[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeRowIndex, setActiveRowIndex] = useState<number>(-1);
  const busquedaMultiEntidad = useSettingsStore(s => s.getBool('busqueda_producto_multientidad'));

  const keywordsRef = useRef<any>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const searchedOnOpen = useRef(false);
  const keywordsDirty = useRef(false);

  // ── Crear ────────────────────────────────────────────────────
  const [newNombre, setNewNombre] = useState(initialQuery);
  const [newCodigo, setNewCodigo] = useState<string>(initialCodigoProveedor ?? '');
  const [newPrecio, setNewPrecio] = useState<number>(initialPrecio ?? 0);
  const [creating, setCreating] = useState(false);

  // ── Reset al abrir ──────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setTab('search');
      setKeywords(initialQuery);
      setMarca(''); setMarcaIds([]); setCategoria(''); setCodigo('');
      setSoloActivos(true); setSoloConStock(false);
      setShowAdvancedFilters(false);
      setResults([]); setActiveRowIndex(-1);
      searchedOnOpen.current = false;
      keywordsDirty.current = false;
      setNewNombre(initialQuery);
      setNewCodigo(initialCodigoProveedor ?? '');
      setNewPrecio(initialPrecio ?? 0);
    }
  }, [open, initialQuery, initialCodigoProveedor, initialPrecio]);

  // ── Búsqueda ────────────────────────────────────────────────
  const doSearch = useCallback(async (
    kw?: string, m?: string, cat?: string, cod?: string,
    activos?: boolean, conStock?: boolean, marcaIdsOverride?: number[],
  ) => {
    setLoading(true);
    setActiveRowIndex(-1);
    try {
      const activeMarcaIds = marcaIdsOverride ?? marcaIds;
      const hasMarcaIdsFilter = activeMarcaIds.length > 0;
      const data = await salesApi.searchProductsAdvanced({
        search: kw ?? keywords,
        marca: hasMarcaIdsFilter ? undefined : (m ?? marca),
        marcaIds: hasMarcaIdsFilter ? activeMarcaIds : undefined,
        categoria: cat ?? categoria,
        codigo: cod ?? codigo,
        soloActivos: activos ?? soloActivos,
        soloConStock: conStock ?? soloConStock,
        limit: 50,
        busquedaMultiEntidad,
      });
      setResults(data);
      keywordsDirty.current = false;
      if (data.length > 0) {
        setActiveRowIndex(0);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywords, marca, marcaIds, categoria, codigo, soloActivos, soloConStock, busquedaMultiEntidad]);

  // Búsqueda automática al abrir si hay initialQuery
  useEffect(() => {
    if (open && initialQuery && !searchedOnOpen.current) {
      searchedOnOpen.current = true;
      const text = initialQuery.trim();
      if (/^\d{6,}$/.test(text)) {
        setKeywords('');
        setCodigo(text);
        setShowAdvancedFilters(true);
        doSearch('', '', '', text, true, false);
      } else {
        doSearch(initialQuery, '', '', '', true, false);
      }
    }
  }, [open, initialQuery, doSearch]);

  // Focus al input al abrir
  useEffect(() => {
    if (open) {
      setTimeout(() => keywordsRef.current?.focus(), 0);
    }
  }, [open]);

  // Enter en el input de keywords
  const handleKeywordsKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const kw = keywords.trim();
      if (/^\d{6,}$/.test(kw)) {
        setKeywords('');
        setCodigo(kw);
        setShowAdvancedFilters(true);
        doSearch('', '', '', kw, true, false);
      } else {
        doSearch(kw);
      }
    }
  };

  // Seleccionar un producto del listado
  const pickProduct = (p: ProductoSearch) => {
    const candidato: ProductoCandidato = {
      PRODUCTO_ID: p.PRODUCTO_ID,
      CODIGOPARTICULAR: p.CODIGOPARTICULAR,
      NOMBRE: p.NOMBRE,
      STOCK_ACTUAL: p.STOCK ?? null,
      PRECIO_COMPRA: p.PRECIO_COMPRA ?? null,
      PRECIO_VENTA: p.PRECIO_VENTA ?? null,
      TASA_IVA_ID: p.TASA_IVA_ID ?? null,
      UNIDAD_ABREVIACION: p.UNIDAD_ABREVIACION ?? null,
      IVA_PORCENTAJE: p.IVA_PORCENTAJE ?? null,
    };
    onPick(candidato);
    onClose();
  };

  const handleCreate = async () => {
    if (!newNombre.trim()) {
      notify.warning('Ingresá un nombre para el producto.');
      return;
    }
    setCreating(true);
    try {
      const resp = await productApi.create({
        NOMBRE: newNombre.trim(),
        CODIGOPARTICULAR: newCodigo.trim() || undefined,
        PRECIO_COMPRA: newPrecio,
        TASA_IVA_ID: tasaIvaDefault?.TASA_ID ?? null,
        ACTIVO: true,
        ES_SERVICIO: false,
        ES_CONJUNTO: false,
        DESCUENTA_STOCK: true,
      });
      const newProd: ProductoCandidato = {
        PRODUCTO_ID: resp.PRODUCTO_ID,
        CODIGOPARTICULAR: newCodigo.trim() || null,
        NOMBRE: newNombre.trim(),
        STOCK_ACTUAL: 0,
        PRECIO_COMPRA: newPrecio,
        PRECIO_VENTA: newPrecio,
        TASA_IVA_ID: tasaIvaDefault?.TASA_ID ?? null,
        UNIDAD_ABREVIACION: null,
        IVA_PORCENTAJE: tasaIvaDefault?.PORCENTAJE ?? null,
      };
      notify.success(`Producto "${newProd.NOMBRE}" creado.`);
      onPick(newProd);
      onClose();
    } catch (err: any) {
      notify.error(err?.response?.data?.error ?? 'No se pudo crear el producto');
    } finally {
      setCreating(false);
    }
  };

  // ── Columnas tabla ──────────────────────────────────────────
  const columns = [
    {
      title: 'Código',
      dataIndex: 'CODIGOPARTICULAR',
      width: 130,
      render: (v: string | null) => v ? <span style={{ fontFamily: 'monospace' }}>{v}</span> : <Text type="secondary">s/c</Text>,
    },
    {
      title: 'Nombre',
      dataIndex: 'NOMBRE',
      ellipsis: true,
    },
    {
      title: 'Stock',
      dataIndex: 'STOCK',
      width: 80,
      align: 'right' as const,
      render: (v: number | null | undefined) => {
        const n = Number(v ?? 0);
        const color = n <= 0 ? '#ff4d4f' : n < 5 ? '#faad14' : '#52c41a';
        return <Text style={{ color, fontWeight: 500 }}>{n}</Text>;
      },
    },
    {
      title: 'IVA',
      dataIndex: 'IVA_PORCENTAJE',
      width: 70,
      align: 'center' as const,
      render: (v: number | null | undefined) => v ? `${v}%` : '—',
    },
    {
      title: 'Precio',
      dataIndex: 'PRECIO_VENTA',
      width: 110,
      align: 'right' as const,
      render: (v: number | null | undefined) => v != null ? fmtMoney(v) : '—',
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={900}
      centered
      destroyOnClose
      footer={null}
      maskClosable={false}
      className="rg-modal purchase-receipt-picker-modal"
      title={
        <RGCajaModalHeader
          icon={rgIcon('producto-buscar')}
          title="Buscar o crear producto"
          subtitle="Vinculá el producto correspondiente al ítem detectado por la IA"
        />
      }
    >
      <div style={{ padding: '20px 24px' }}>
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as TabKey)}
          items={[
            {
              key: 'search',
              label: <span><SearchOutlined /> Buscar producto</span>,
              children: (
                <>
                  {/* ── Buscador ── */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <Input
                      ref={keywordsRef}
                      size="large"
                      placeholder="Buscar por código, nombre, marca o categoría…"
                      value={keywords}
                      onChange={e => { setKeywords(e.target.value); keywordsDirty.current = true; }}
                      onKeyDown={handleKeywordsKeyDown}
                      prefix={<SearchOutlined />}
                      allowClear
                      style={{ flex: 1 }}
                    />
                    <Button
                      type="primary"
                      size="large"
                      loading={loading}
                      icon={<SearchOutlined />}
                      onClick={() => doSearch(keywords)}
                    >
                      Buscar
                    </Button>
                    <Tooltip title="Filtros avanzados">
                      <Button
                        size="large"
                        icon={<FilterOutlined />}
                        type={showAdvancedFilters ? 'default' : 'text'}
                        onClick={() => setShowAdvancedFilters(s => !s)}
                      />
                    </Tooltip>
                  </div>

                  {showAdvancedFilters && (
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                      gap: 8, marginBottom: 12, padding: 10,
                      background: '#fafafa', borderRadius: 6,
                    }}>
                      <Input
                        placeholder="Código (exacto)"
                        value={codigo}
                        onChange={e => setCodigo(e.target.value)}
                        onPressEnter={() => doSearch()}
                      />
                      <Input
                        placeholder="Marca"
                        value={marca}
                        onChange={e => { setMarca(e.target.value); setMarcaIds([]); }}
                        disabled={marcaIds.length > 0}
                        onPressEnter={() => doSearch()}
                      />
                      <Input
                        placeholder="Categoría"
                        value={categoria}
                        onChange={e => setCategoria(e.target.value)}
                        onPressEnter={() => doSearch()}
                      />
                      <Space size={16} style={{ gridColumn: '1 / -1' }}>
                        <Checkbox checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)}>
                          Solo activos
                        </Checkbox>
                        <Checkbox checked={soloConStock} onChange={e => setSoloConStock(e.target.checked)}>
                          Solo con stock
                        </Checkbox>
                        {marcaOptions && marcaOptions.length > 0 && (
                          <Select
                            mode="multiple"
                            placeholder="Marcas (multi)"
                            style={{ minWidth: 240 }}
                            value={marcaIds}
                            onChange={(v) => {
                              setMarcaIds(v);
                              setMarca('');
                              doSearch(undefined, undefined, undefined, undefined, undefined, undefined, v);
                            }}
                            options={marcaOptions.map(m => ({ value: m.MARCA_ID, label: m.NOMBRE }))}
                            allowClear
                            maxTagCount="responsive"
                          />
                        )}
                      </Space>
                    </div>
                  )}

                  {/* ── Resultados ── */}
                  <div ref={tableRef} style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6 }}>
                    {results.length === 0 && !loading && (
                      <EmptyState msg={keywords.trim() ? 'Sin resultados. Probá el tab "Crear".' : 'Escribí un término para buscar.'} setTab={setTab} />
                    )}
                    {results.length > 0 && (
                      <Table
                        size="small"
                        dataSource={results}
                        columns={columns}
                        rowKey="PRODUCTO_ID"
                        pagination={false}
                        loading={loading}
                        rowClassName={(record: any) =>
                          record.PRODUCTO_ID === results[activeRowIndex]?.PRODUCTO_ID ? 'rg-row-active' : ''
                        }
                        onRow={(record: any, index?: number) => ({
                          onClick: () => setActiveRowIndex(index ?? -1),
                          onDoubleClick: () => pickProduct(record),
                          style: { cursor: 'pointer' },
                        })}
                      />
                    )}
                    {loading && results.length === 0 && (
                      <div style={{ textAlign: 'center', padding: 24 }}><span>Buscando…</span></div>
                    )}
                  </div>

                  {/* ── Footer tab Buscar ── */}
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Doble click sobre una fila para seleccionar.
                      {results.length > 0 && ` ${results.length} resultado(s).`}
                    </Text>
                    <Space>
                      <Button onClick={() => setTab('create')} icon={<PlusOutlined />}>
                        Crear producto nuevo
                      </Button>
                      <Button
                        type="primary"
                        disabled={activeRowIndex < 0 || !results[activeRowIndex]}
                        onClick={() => results[activeRowIndex] && pickProduct(results[activeRowIndex]!)}
                      >
                        Seleccionar
                      </Button>
                    </Space>
                  </div>
                </>
              ),
            },
            {
              key: 'create',
              label: <span><PlusOutlined /> Crear producto</span>,
              children: (
                <Form layout="vertical">
                  <Form.Item
                    label="Nombre del producto"
                    help="Descripción con la que se identificará en el sistema."
                    required
                  >
                    <Input
                      size="large"
                      placeholder="Ej: GASEOSA COLA 1.5L"
                      value={newNombre}
                      onChange={e => setNewNombre(e.target.value)}
                    />
                  </Form.Item>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Form.Item label="Código interno (opcional)">
                      <Input
                        placeholder="Código de proveedor / propio"
                        value={newCodigo}
                        onChange={e => setNewCodigo(e.target.value)}
                      />
                    </Form.Item>
                    <Form.Item label="Precio de compra">
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        step={0.01}
                        value={newPrecio}
                        onChange={v => setNewPrecio(Number(v) || 0)}
                        formatter={v => `$ ${v}`}
                        parser={(v) => Number((v ?? '').replace(/[^0-9.,]/g, '').replace(',', '.'))}
                      />
                    </Form.Item>
                  </div>
                  {tasaIvaDefault && (
                    <Form.Item label="IVA">
                      <Tag color="purple">{tasaIvaDefault.PORCENTAJE}% (predeterminado del sistema)</Tag>
                    </Form.Item>
                  )}
                  <div style={{
                    padding: 10, background: '#fffbe6', border: '1px solid #ffe58f',
                    borderRadius: 6, marginBottom: 12, fontSize: 12,
                  }}>
                    <Text type="warning" style={{ fontSize: 12 }}>
                      Se creará un producto mínimo (sin código de barras, sin precio de venta, sin margen).
                      Después podés completarlo desde <strong>Productos → Editar</strong>.
                    </Text>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button onClick={() => setTab('search')} icon={<SearchOutlined />}>
                      Volver a buscar
                    </Button>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      loading={creating}
                      onClick={handleCreate}
                    >
                      Crear y vincular
                    </Button>
                  </div>
                </Form>
              ),
            },
          ]}
        />
      </div>
    </Modal>
  );
}

// ── Sub-componente: empty state simple ────────────────────────────────────
function EmptyState({
  msg,
  setTab,
}: {
  msg: string;
  setTab: (k: TabKey) => void;
}) {
  return (
    <div style={{ padding: 32, textAlign: 'center', color: '#999' }}>
      <p>{msg}</p>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setTab('create')}>
        Crear producto nuevo
      </Button>
    </div>
  );
}
