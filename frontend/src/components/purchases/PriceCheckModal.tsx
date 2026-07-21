import { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button, Space, Typography, Input, Tag, Tooltip } from 'antd';
import {
  SaveOutlined, SearchOutlined,
  CheckCircleOutlined, EditOutlined, PercentageOutlined, CloseOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { purchasesApi, type PriceCheckProduct, type PriceCheckUpdate } from '../../services/purchases.api';
import { ProductPriceEditorModal } from './ProductPriceEditorModal';
import { fmtMoney, fmtNum } from '../../utils/format';
import { notify } from '../../utils/notify.ts';

const { Text, Title } = Typography;

interface Props {
  open: boolean;
  compraId: number | null;
  onClose: () => void;
}

interface ProductRow extends PriceCheckProduct {
  /** Mapa LISTA_ID → precio original (para detectar cambios). */
  preciosOrig: Record<number, number>;
  MODIFICADO: boolean;
}

export function PriceCheckModal({ open, compraId, onClose }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [searchText, setSearchText] = useState('');
  const [listNames, setListNames] = useState<Record<number, string>>({});
  const [listMargins, setListMargins] = useState<Record<number, number>>({});
  const [editorProduct, setEditorProduct] = useState<PriceCheckProduct | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['price-check', compraId],
    queryFn: () => purchasesApi.getPriceCheckData(compraId!),
    enabled: open && !!compraId,
  });

  useEffect(() => {
    if (data) {
      setListNames(data.listNames);
      setListMargins(data.listMargins || {});
      setProducts(data.products.map(p => {
        const preciosOrig: Record<number, number> = {};
        for (const pp of p.precios) preciosOrig[pp.LISTA_ID] = pp.PRECIO;
        return { ...p, preciosOrig, MODIFICADO: false };
      }));
    }
  }, [data]);

  const listasActivas = useMemo(
    () => Object.keys(listNames).map(Number).sort((a, b) => a - b),
    [listNames],
  );

  const saveMutation = useMutation({
    mutationFn: (updates: PriceCheckUpdate[]) => purchasesApi.savePriceCheck(updates),
    onSuccess: (result) => {
      notify.success(`Se actualizaron los precios de ${result.updated} producto(s)`);
      onClose();
    },
    onError: (err: any) => {
      notify.error(err.response?.data?.error || 'Error al guardar precios');
    },
  });

  const handleProductSave = useCallback((update: {
    PRODUCTO_ID: number;
    precios: { LISTA_ID: number; PRECIO: number }[];
  }) => {
    setProducts(prev => prev.map(p => {
      if (p.PRODUCTO_ID !== update.PRODUCTO_ID) return p;
      const newPrecios = update.precios.map(up => ({
        LISTA_ID: up.LISTA_ID,
        PRECIO: up.PRECIO,
        MARGEN_INDIVIDUAL: null,
      }));
      const updated: ProductRow = {
        ...p,
        precios: newPrecios,
        TIENE_MARGENES_INDIV: newPrecios.some(pp => pp.MARGEN_INDIVIDUAL != null),
      };
      let modified = false;
      for (const np of newPrecios) {
        if (Math.abs((p.preciosOrig[np.LISTA_ID] || 0) - np.PRECIO) > 0.01) {
          modified = true;
          break;
        }
      }
      if (!modified && newPrecios.length > Object.keys(p.preciosOrig).length) {
        modified = true;
      }
      updated.MODIFICADO = modified;
      return updated;
    }));
    setEditorOpen(false);
    setEditorProduct(null);
    notify.success('Precios del producto actualizados');
  }, []);

  const openEditor = useCallback((record: ProductRow) => {
    const productWithCurrentPrices: PriceCheckProduct = {
      PRODUCTO_ID: record.PRODUCTO_ID,
      CODIGO: record.CODIGO,
      DESCRIPCION: record.DESCRIPCION,
      COSTO: record.COSTO,
      IMP_INTERNO: record.IMP_INTERNO,
      IVA_ALICUOTA: record.IVA_ALICUOTA,
      LISTA_DEFECTO: record.LISTA_DEFECTO,
      precios: record.precios,
      TIENE_MARGENES_INDIV: record.TIENE_MARGENES_INDIV,
    };
    setEditorProduct(productWithCurrentPrices);
    setEditorOpen(true);
  }, []);

  const filteredProducts = useMemo(() => {
    if (!searchText.trim()) return products;
    const s = searchText.trim().toLowerCase();
    return products.filter(p =>
      p.CODIGO.toLowerCase().includes(s) ||
      p.DESCRIPCION.toLowerCase().includes(s)
    );
  }, [products, searchText]);

  const modifiedCount = useMemo(() => products.filter(p => p.MODIFICADO).length, [products]);
  const hasCambios = modifiedCount > 0;
  const sinPrecios = useMemo(() => products.filter(p => p.precios.length === 0).length, [products]);

  const calcMargenReal = useCallback((precio: number, costo: number): number => {
    if (!costo || !precio) return 0;
    return Math.round(((precio / costo) - 1) * 100 * 100) / 100;
  }, []);

  const handleSaveAll = () => {
    const modified = products.filter(p => p.MODIFICADO);
    if (modified.length === 0) {
      onClose();
      return;
    }
    const updates: PriceCheckUpdate[] = modified.map(p => ({
      PRODUCTO_ID: p.PRODUCTO_ID,
      precios: p.precios.map(pp => ({ LISTA_ID: pp.LISTA_ID, PRECIO: pp.PRECIO })),
    }));
    saveMutation.mutate(updates);
  };

  const handleClose = () => {
    if (hasCambios) {
      Modal.confirm({
        title: 'Cambios sin guardar',
        content: `Hay ${modifiedCount} producto(s) con precios modificados sin guardar. ¿Desea salir sin guardar?`,
        okText: 'Salir sin guardar',
        cancelText: 'Seguir editando',
        okButtonProps: { danger: true },
        onOk: () => {
          setProducts([]);
          setSearchText('');
          onClose();
        },
      });
    } else {
      setProducts([]);
      setSearchText('');
      onClose();
    }
  };

  return (
    <>
      <Modal
        open={open}
        onCancel={handleClose}
        footer={null}
        width="95vw"
        style={{ maxWidth: 1400 }}
        centered
        destroyOnClose
        closable={false}
        className="new-sale-modal"
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
      >
        {/* ── Dark header bar ───────────────────────── */}
        <div className="nsm-header">
          <div className="nsm-header-left">
            <PercentageOutlined className="nsm-header-icon" />
            <Title level={4} style={{ margin: 0, color: '#fff' }}>
              Chequeo de Precios
            </Title>
            <Tag color="gold" style={{ margin: 0, fontWeight: 600 }}>
              Compra #{compraId}
            </Tag>
          </div>
          <Button
            type="text"
            onClick={handleClose}
            icon={<CloseOutlined />}
            style={{ color: 'rgba(255,255,255,0.7)', fontSize: 18 }}
          />
        </div>

        {/* ── Toolbar ──────────────────────────────── */}
        <div style={{
          padding: '14px 20px 8px',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <Input
            placeholder="Buscar por código o descripción..."
            prefix={<SearchOutlined />}
            allowClear
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            style={{ maxWidth: 380 }}
          />
          <Space size={6} wrap>
            <Tag color="blue">{products.length} productos</Tag>
            <Tag color={listasActivas.length ? 'cyan' : 'default'}>{listasActivas.length} listas</Tag>
            {sinPrecios > 0 && (
              <Tag color="orange">{sinPrecios} sin precio</Tag>
            )}
            {hasCambios && (
              <Tag color="green" icon={<CheckCircleOutlined />}>
                {modifiedCount} modificado{modifiedCount > 1 ? 's' : ''}
              </Tag>
            )}
            <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>
              {filteredProducts.length} resultado{filteredProducts.length !== 1 ? 's' : ''}
            </Text>
          </Space>
        </div>

        {/* ── Lista de productos ───────────────────── */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: '4px 20px 16px',
          maxHeight: 'calc(100dvh - 230px)', overflowY: 'auto',
        }}>
          {filteredProducts.map(p => {
            const isDefault = (id: number) => p.LISTA_DEFECTO === id;
            const listasAsignadas = p.precios.length;

            return (
              <div
                key={p.PRODUCTO_ID}
                style={{
                  display: 'flex', alignItems: 'stretch', gap: 12,
                  padding: '10px 14px', borderRadius: 8,
                  background: p.MODIFICADO ? '#f6ffed' : '#fafafa',
                  border: p.MODIFICADO ? '1px solid #b7eb8f' : '1px solid #f0f0f0',
                  transition: 'all 0.15s',
                }}
              >
                {/* Zona izquierda: producto */}
                <div style={{ width: 280, flexShrink: 0, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Text type="secondary" style={{ fontSize: 11, fontFamily: 'monospace' }}>
                      {p.CODIGO}
                    </Text>
                    {p.MODIFICADO && (
                      <Tooltip title="Producto con cambios sin guardar">
                        <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 12 }} />
                      </Tooltip>
                    )}
                  </div>
                  <Text
                    strong
                    style={{ fontSize: 13, display: 'block', marginTop: 2 }}
                    ellipsis={{ tooltip: p.DESCRIPCION }}
                  >
                    {p.DESCRIPCION}
                  </Text>
                  <Space size={4} wrap style={{ marginTop: 6 }}>
                    <Tag color="default" style={{ fontSize: 10, margin: 0 }}>
                      Costo {fmtMoney(p.COSTO)}
                    </Tag>
                    <Tag color={listasAsignadas > 0 ? 'blue' : 'orange'} style={{ fontSize: 10, margin: 0 }}>
                      {listasAsignadas}/{listasActivas.length} listas
                    </Tag>
                  </Space>
                </div>

                {/* Zona derecha: chips de listas */}
                <div style={{
                  flex: 1, minWidth: 0,
                  display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
                }}>
                  {listasActivas.map(listaId => {
                    const pp = p.precios.find(x => x.LISTA_ID === listaId);
                    const precio = pp?.PRECIO || 0;
                    const margenReal = calcMargenReal(precio, p.COSTO);
                    const margenDefault = listMargins[listaId] || 0;
                    const defaultList = isDefault(listaId);

                    if (precio === 0) {
                      return (
                        <Tooltip
                          key={listaId}
                          title={`${listNames[listaId]}: sin precio`}
                        >
                          <Tag
                            style={{
                              margin: 0, fontSize: 11, padding: '2px 8px',
                              opacity: 0.45, borderStyle: 'dashed',
                              borderColor: defaultList ? '#EABD23' : '#d9d9d9',
                            }}
                          >
                            <Text type="secondary" style={{ fontSize: 10 }}>
                              {listNames[listaId]?.substring(0, 12) || `L${listaId}`}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>—</Text>
                          </Tag>
                        </Tooltip>
                      );
                    }

                    return (
                      <Tooltip
                        key={listaId}
                        title={
                          <div style={{ fontSize: 12 }}>
                            <div><strong>{listNames[listaId]}</strong>{defaultList && ' (predeterminada)'}</div>
                            <div>Precio: <strong>{fmtMoney(precio)}</strong></div>
                            <div>Margen default: {fmtNum(margenDefault)}%</div>
                            <div>Margen actual: {fmtNum(margenReal)}%</div>
                          </div>
                        }
                      >
                        <Tag
                          color={
                            defaultList ? 'gold' : 'blue'
                          }
                          style={{
                            margin: 0, fontSize: 11, padding: '2px 8px',
                            borderWidth: defaultList ? 2 : 1,
                          }}
                        >
                          <Text style={{ fontSize: 10, marginRight: 4 }}>
                            {listNames[listaId]?.substring(0, 12) || `L${listaId}`}
                          </Text>
                          <Text strong style={{ fontSize: 11 }}>
                            {fmtMoney(precio)}
                          </Text>
                          <Text style={{ fontSize: 9, marginLeft: 4, opacity: 0.85 }}>
                            {fmtNum(margenReal)}%
                          </Text>
                        </Tag>
                      </Tooltip>
                    );
                  })}
                </div>

                {/* Botón editar */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <Button
                    type="primary"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEditor(p)}
                  >
                    Chequear
                  </Button>
                </div>
              </div>
            );
          })}

          {!isLoading && filteredProducts.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'rgba(0,0,0,0.45)' }}>
              <Text type="secondary">No hay productos que coincidan con la búsqueda.</Text>
            </div>
          )}
        </div>

        {/* ── Footer con acciones ──────────────────── */}
        <div style={{
          padding: '12px 20px',
          borderTop: '1px solid #f0f0f0',
          background: '#fafafa',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {hasCambios
              ? `${modifiedCount} producto(s) con precios modificados.`
              : 'Sin cambios pendientes.'}
          </Text>
          <Space>
            <Button onClick={handleClose}>Cerrar</Button>
            {hasCambios && (
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saveMutation.isPending}
                onClick={handleSaveAll}
                className="btn-gold"
              >
                Guardar {modifiedCount} cambio{modifiedCount > 1 ? 's' : ''}
              </Button>
            )}
          </Space>
        </div>
      </Modal>

      {/* Product price editor modal */}
      <ProductPriceEditorModal
        open={editorOpen}
        product={editorProduct}
        listNames={listNames}
        listMargins={listMargins}
        onClose={() => { setEditorOpen(false); setEditorProduct(null); }}
        onSave={handleProductSave}
      />
    </>
  );
}
