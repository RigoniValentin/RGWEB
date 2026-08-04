import { useState } from 'react';
import { Input, InputNumber, Button, Empty, Spin, Card, Tag, Typography, Space } from 'antd';
import { SearchOutlined, PlusOutlined } from '@ant-design/icons';
import { purchasesApi } from '../../services/purchases.api';
import { productApi } from '../../services/product.api';
import type { ProductoCandidato } from '../../services/purchases.api';
import { notify } from '../../utils/notify';

const { Text } = Typography;

// ═══════════════════════════════════════════════════════════════════════════
//  ProductSearchCreatePopover
//
//  Popover con dos pestañas pensado para el modal de revisión de comprobantes
//  por imagen. NO usa ProductSearchModal existente (no rompe otras pantallas):
//  - Tab "Buscar": usa purchasesApi.searchProductsAdvanced para mostrar
//    resultados en vivo según el término, con highlighting.
//  - Tab "Crear": formulario inline para crear un producto mínimo (nombre,
//    código, precio de compra) y vincularlo automáticamente al ítem.
//
//  Emite onPick(productoId) cuando el usuario elige un candidato de la búsqueda
//  o cuando se completa la creación de un producto nuevo.
// ═══════════════════════════════════════════════════════════════════════════

interface Props {
  /** Sugerencia inicial para el buscador y para el campo Nombre del tab Crear. */
  initialQuery: string;
  /** Código de proveedor detectado por la IA (para pre-rellenar el campo Código del tab Crear). */
  initialCodigoProveedor?: string | null;
  /** Precio detectado por la IA (para pre-rellenar Precio del tab Crear). */
  initialPrecio?: number;
  /** Tasa de IVA predeterminada del sistema (para usar como default al crear). */
  tasaDefault?: { TASA_ID: number; PORCENTAJE: number } | null;
  /** Emite cuando el usuario eligió un candidato existente o creó uno nuevo. */
  onPick: (productoId: number, producto: ProductoCandidato) => void;
}

const TAB_KEYS = { SEARCH: 'search', CREATE: 'create' } as const;
type TabKey = typeof TAB_KEYS[keyof typeof TAB_KEYS];

export function ProductSearchCreatePopover({
  initialQuery,
  initialCodigoProveedor,
  initialPrecio,
  tasaDefault,
  onPick,
}: Props) {
  const [tab, setTab] = useState<TabKey>(TAB_KEYS.SEARCH);

  // ── Tab Buscar ────────────────────────────────────────────────
  const [searchText, setSearchText] = useState(initialQuery);
  const [results, setResults] = useState<ProductoCandidato[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async (textToSearch?: string) => {
    const q = (textToSearch ?? searchText).trim();
    if (!q || q.length < 2) {
      setResults([]);
      setSearched(true);
      return;
    }
    setSearching(true);
    setSearched(true);
    try {
      const raw = await purchasesApi.searchProductsAdvanced({
        search: q,
        limit: 8,
        busquedaMultiEntidad: true,
      });
      const list: ProductoCandidato[] = raw.map(r => ({
        PRODUCTO_ID: r.PRODUCTO_ID,
        CODIGOPARTICULAR: r.CODIGOPARTICULAR,
        NOMBRE: r.NOMBRE,
        STOCK_ACTUAL: r.STOCK ?? null,
        PRECIO_COMPRA: r.PRECIO_COMPRA ?? null,
        PRECIO_VENTA: r.PRECIO_VENTA ?? null,
        TASA_IVA_ID: r.TASA_IVA_ID ?? null,
        UNIDAD_ABREVIACION: r.UNIDAD_ABREVIACION ?? null,
        IVA_PORCENTAJE: r.IVA_PORCENTAJE ?? null,
      }));
      setResults(list);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  // ── Tab Crear ─────────────────────────────────────────────────
  const [newNombre, setNewNombre] = useState(initialQuery);
  const [newCodigo, setNewCodigo] = useState<string>(initialCodigoProveedor ?? '');
  const [newPrecio, setNewPrecio] = useState<number>(initialPrecio ?? 0);
  const [creating, setCreating] = useState(false);

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
        TASA_IVA_ID: tasaDefault?.TASA_ID ?? null,
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
        TASA_IVA_ID: tasaDefault?.TASA_ID ?? null,
        UNIDAD_ABREVIACION: null,
        IVA_PORCENTAJE: tasaDefault?.PORCENTAJE ?? null,
      };
      notify.success(`Producto "${newProd.NOMBRE}" creado.`);
      onPick(newProd.PRODUCTO_ID, newProd);
    } catch (err: any) {
      notify.error(err?.response?.data?.error ?? 'No se pudo crear el producto');
    } finally {
      setCreating(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ width: 380 }}>
      <TabsBar active={tab} onChange={setTab} />

      {tab === TAB_KEYS.SEARCH && (
        <div>
          <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
            <Input
              autoFocus
              placeholder="Buscar por código o nombre…"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              onPressEnter={() => handleSearch()}
              allowClear
            />
            <Button type="primary" onClick={() => handleSearch()} loading={searching} icon={<SearchOutlined />}>
              Buscar
            </Button>
          </Space.Compact>

          {searching && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Spin />
            </div>
          )}

          {!searching && searched && results.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<>Sin resultados para «{searchText.trim()}».<br />Probá el tab «Crear» para darlo de alta.</>}
            />
          )}

          {!searching && results.length > 0 && (
            <Space direction="vertical" size={6} style={{ width: '100%', maxHeight: 280, overflowY: 'auto' }}>
              {results.map(r => (
                <Card
                  key={r.PRODUCTO_ID}
                  size="small"
                  hoverable
                  onClick={() => onPick(r.PRODUCTO_ID, r)}
                  bodyStyle={{ padding: 8 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.NOMBRE}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {r.CODIGOPARTICULAR ?? '(s/c)'} · Stock: {r.STOCK_ACTUAL ?? 0}
                      </Text>
                    </div>
                    <Space size={4} wrap>
                      {r.IVA_PORCENTAJE != null && <Tag color="purple">IVA {r.IVA_PORCENTAJE}%</Tag>}
                      <Tag color="blue">
                        {r.PRECIO_VENTA != null ? `$${r.PRECIO_VENTA.toFixed(2)}` : 's/precio'}
                      </Tag>
                    </Space>
                  </div>
                </Card>
              ))}
            </Space>
          )}
        </div>
      )}

      {tab === TAB_KEYS.CREATE && (
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            Crea un producto con los datos mínimos. Lo vas a poder completar después desde Productos.
          </Text>
          <Input
            addonBefore="Nombre"
            placeholder="Descripción del producto"
            value={newNombre}
            onChange={e => setNewNombre(e.target.value)}
          />
          <Input
            addonBefore="Código"
            placeholder="(opcional) código interno"
            value={newCodigo}
            onChange={e => setNewCodigo(e.target.value)}
          />
          <InputNumber
            addonBefore="Precio compra"
            value={newPrecio}
            min={0}
            step={0.01}
            onChange={v => setNewPrecio(Number(v) || 0)}
            style={{ width: '100%' }}
            formatter={v => `$ ${v}`}
            parser={(v) => Number((v ?? '').replace(/[^0-9.,]/g, '').replace(',', '.'))}
          />
          {tasaDefault && (
            <Text type="secondary" style={{ fontSize: 11 }}>
              IVA aplicado: {tasaDefault.PORCENTAJE}% (predeterminado del sistema)
            </Text>
          )}
          <Button
            type="primary"
            block
            icon={<PlusOutlined />}
            loading={creating}
            onClick={handleCreate}
          >
            Crear y vincular
          </Button>
        </Space>
      )}
    </div>
  );
}

// ── Sub-componente: barra de tabs ───────────────────────────────────
function TabsBar({ active, onChange }: { active: TabKey; onChange: (k: TabKey) => void }) {
  const tabs: { key: TabKey; label: string }[] = [
    { key: TAB_KEYS.SEARCH, label: 'Buscar' },
    { key: TAB_KEYS.CREATE, label: 'Crear producto' },
  ];
  return (
    <div style={{ display: 'flex', borderBottom: '1px solid #f0f0f0', marginBottom: 12 }}>
      {tabs.map(t => (
        <div
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            padding: '6px 12px',
            cursor: 'pointer',
            borderBottom: active === t.key ? '2px solid #EABD23' : '2px solid transparent',
            fontWeight: active === t.key ? 600 : 400,
            color: active === t.key ? '#EABD23' : '#888',
            fontSize: 13,
          }}
        >
          {t.label}
        </div>
      ))}
    </div>
  );
}
