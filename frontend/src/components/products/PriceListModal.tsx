import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Modal, InputNumber, Typography, Space, Tag, App, Segmented,
  Button, Divider, Tooltip, Spin, Select,
} from 'antd';
import {
  DollarOutlined, ReloadOutlined, UndoOutlined, PercentageOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { catalogApi } from '../../services/catalog.api';
import { productApi } from '../../services/product.api';
import type { Producto } from '../../types';

const { Text } = Typography;

const r2 = (n: number) => Math.round(n * 100) / 100;

interface Props {
  open: boolean;
  product: Producto | null;
  onClose: () => void;
  onSaved: () => void;
}

type MarginSource = 'individual' | 'lista';

export function PriceListModal({ open, product, onClose, onSaved }: Props) {
  const { message } = App.useApp();
  const [costo, setCosto] = useState(0);
  const [origCosto, setOrigCosto] = useState(0);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [origPrices, setOrigPrices] = useState<Record<string, number>>({});
  const [margenes, setMargenes] = useState<number[]>([0, 0, 0, 0, 0]);
  const [origMargenes, setOrigMargenes] = useState<number[]>([0, 0, 0, 0, 0]);
  const [marginSource, setMarginSource] = useState<MarginSource>('individual');
  const [listaDefecto, setListaDefecto] = useState<number | null>(null);
  const [origListaDefecto, setOrigListaDefecto] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: listas } = useQuery({
    queryKey: ['listas-precios'],
    queryFn: () => catalogApi.getListasPrecios(),
  });

  // List margins from LISTA_PRECIOS (global defaults)
  const listMargins = useMemo<number[]>(() => {
    if (!listas) return [0, 0, 0, 0, 0];
    return listas.slice(0, 5).map(l => l.MARGEN || 0);
  }, [listas]);

  // Fetch product detail (with margins) when modal opens
  useEffect(() => {
    if (product && open) {
      setLoading(true);
      productApi.getById(product.PRODUCTO_ID).then(d => {
        const c = d.PRECIO_COMPRA ?? 0;
        setCosto(c);
        setOrigCosto(c);

        const initial: Record<string, number> = {};
        for (let i = 1; i <= 5; i++) {
          initial[`LISTA_${i}`] = (d as any)[`LISTA_${i}`] ?? 0;
        }
        setPrices(initial);
        setOrigPrices(initial);

        setListaDefecto(d.LISTA_DEFECTO ?? null);
        setOrigListaDefecto(d.LISTA_DEFECTO ?? null);

        // Calculate margins from cost/prices (like ProductFormModal does)
        // More reliable than stored margins which may be stale
        const storedMargenes = d.margenes || [0, 0, 0, 0, 0];
        const hasStoredMargenes = storedMargenes.some((m: number) => m > 0);
        let initMargenes: number[];

        if (c > 0) {
          initMargenes = [1, 2, 3, 4, 5].map(i => {
            const precio = (d as any)[`LISTA_${i}`] || 0;
            return precio > 0 ? r2(((precio / c) - 1) * 100) : 0;
          });
        } else {
          // No cost — use stored margins or list defaults
          initMargenes = hasStoredMargenes
            ? storedMargenes
            : (listas?.slice(0, 5).map(l => l.MARGEN || 0) || [0, 0, 0, 0, 0]);
        }

        setMargenes(initMargenes);
        setOrigMargenes(initMargenes);
        // Default to individual if product has stored margins or MARGEN_INDIVIDUAL flag
        setMarginSource((hasStoredMargenes || d.MARGEN_INDIVIDUAL) ? 'individual' : 'lista');
      }).finally(() => setLoading(false));
    }
  }, [product, open, listas]);

  const isModified = useMemo(() => {
    if (Math.abs(costo - origCosto) > 0.01) return true;
    if (listaDefecto !== origListaDefecto) return true;
    for (let i = 1; i <= 5; i++) {
      const curr = prices[`LISTA_${i}`] || 0;
      const orig = origPrices[`LISTA_${i}`] || 0;
      if (Math.abs(curr - orig) > 0.01) return true;
    }
    return false;
  }, [costo, origCosto, prices, origPrices, listaDefecto, origListaDefecto]);

  // Recalculate all prices from configured margins (individual or lista depending on source)
  const recalcFromMargins = useCallback(() => {
    if (costo <= 0) {
      message.warning('El costo debe ser mayor a 0 para recalcular');
      return;
    }
    // Use original stored margins for individual, or list defaults
    const sourceMargins = marginSource === 'individual' ? origMargenes : listMargins;
    const newPrices: Record<string, number> = {};
    const newMargenes = [...sourceMargins];
    for (let i = 0; i < 5; i++) {
      const margen = sourceMargins[i] || 0;
      newPrices[`LISTA_${i + 1}`] = r2(costo * (1 + margen / 100));
      newMargenes[i] = margen;
    }
    setPrices(newPrices);
    setMargenes(newMargenes);
    message.info('Precios recalculados según márgenes');
  }, [costo, origMargenes, marginSource, listMargins, message]);

  // Reset to original values
  const resetAll = useCallback(() => {
    setCosto(origCosto);
    setPrices({ ...origPrices });
    setMargenes([...origMargenes]);
    setListaDefecto(origListaDefecto);
  }, [origCosto, origPrices, origMargenes, origListaDefecto]);

  // Handle margin change → recalculate that list's price
  const handleMargenChange = useCallback((idx: number, value: number | null) => {
    const newMargenes = [...margenes];
    newMargenes[idx] = value ?? 0;
    setMargenes(newMargenes);
    if (costo > 0) {
      const precio = r2(costo * (1 + (newMargenes[idx] || 0) / 100));
      setPrices(prev => ({ ...prev, [`LISTA_${idx + 1}`]: precio }));
    }
  }, [margenes, costo]);

  // Handle price change → reverse-calculate margin
  const handlePriceChange = useCallback((listNum: number, value: number | null) => {
    const precio = value ?? 0;
    setPrices(prev => ({ ...prev, [`LISTA_${listNum}`]: precio }));
    const newMargenes = [...margenes];
    if (costo > 0 && precio > 0) {
      newMargenes[listNum - 1] = r2(((precio / costo) - 1) * 100);
    } else {
      newMargenes[listNum - 1] = 0;
    }
    setMargenes(newMargenes);
  }, [costo, margenes]);

  // Handle cost change → recalculate all prices using current margins
  const handleCostoChange = useCallback((value: number | null) => {
    const newCosto = value ?? 0;
    setCosto(newCosto);
    if (newCosto > 0) {
      const newPrices: Record<string, number> = {};
      for (let i = 0; i < 5; i++) {
        newPrices[`LISTA_${i + 1}`] = r2(newCosto * (1 + (margenes[i] || 0) / 100));
      }
      setPrices(newPrices);
    }
  }, [margenes]);

  const handleSave = async () => {
    if (!product || !isModified) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await productApi.update(product.PRODUCTO_ID, {
        PRECIO_COMPRA: costo,
        LISTA_1: prices.LISTA_1,
        LISTA_2: prices.LISTA_2,
        LISTA_3: prices.LISTA_3,
        LISTA_4: prices.LISTA_4,
        LISTA_5: prices.LISTA_5,
        LISTA_DEFECTO: listaDefecto,
        MARGEN_INDIVIDUAL: true,
        margenes,
      });
      message.success('Precios actualizados');
      onSaved();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Error al guardar precios');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={<span><DollarOutlined /> Listas de Precios</span>}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText={isModified ? 'Guardar' : 'Cerrar'}
      cancelText="Cancelar"
      destroyOnHidden
      width={540}
      className="rg-modal"
    >
      {product && (
        loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin />
          </div>
        ) : (
          <>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
              <Text strong>{product.CODIGOPARTICULAR}</Text> — {product.NOMBRE}
            </Text>

            {/* Costo + Lista predeterminada */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Text strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Costo</Text>
              <InputNumber
                value={costo}
                onChange={handleCostoChange}
                min={0}
                precision={2}
                prefix="$"
                style={{
                  width: 150,
                  borderColor: Math.abs(costo - origCosto) > 0.01 ? '#EABD23' : undefined,
                }}
                size="middle"
              />
              <Text strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Lista pred.</Text>
              <Select
                value={listaDefecto}
                onChange={v => setListaDefecto(v)}
                allowClear
                placeholder="—"
                style={{ width: 130 }}
                size="middle"
                options={listas?.slice(0, 5).map((l, i) => ({ label: l.NOMBRE, value: i + 1 }))}
              />
            </div>

            {/* Margin source selector + actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Segmented
                value={marginSource}
                onChange={val => setMarginSource(val as MarginSource)}
                options={[
                  { value: 'individual', label: 'Margen individual' },
                  { value: 'lista', label: 'Margen de lista' },
                ]}
                size="small"
              />
              <div style={{ flex: 1 }} />
              <Tooltip title="Recalcular precios con los márgenes seleccionados">
                <Button size="small" icon={<ReloadOutlined />} onClick={recalcFromMargins}>
                  Recalcular
                </Button>
              </Tooltip>
              <Tooltip title="Restaurar valores originales">
                <Button size="small" icon={<UndoOutlined />} onClick={resetAll} disabled={!isModified} />
              </Tooltip>
            </div>

            <Divider style={{ margin: '4px 0 10px' }} />

            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px', marginBottom: 4 }}>
              <div style={{ flex: 1 }} />
              <Text type="secondary" style={{ width: 90, textAlign: 'center', fontSize: 11 }}>Margen %</Text>
              <Text type="secondary" style={{ width: 130, textAlign: 'center', fontSize: 11 }}>Precio $</Text>
            </div>

            {/* Price rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1, 2, 3, 4, 5].map(i => {
                const listName = listas?.[i - 1]?.NOMBRE || `Lista ${i}`;
                const isDefault = listaDefecto === i;
                const origPrice = origPrices[`LISTA_${i}`] || 0;
                const currPrice = prices[`LISTA_${i}`] || 0;
                const changed = Math.abs(currPrice - origPrice) > 0.01;
                const currMargen = margenes[i - 1] || 0;
                // Configured margin from selected source
                const configMargin = marginSource === 'individual'
                  ? origMargenes[i - 1] || 0
                  : (listMargins[i - 1] || 0);
                // Actual margin from current price/cost
                const actualMargin = costo > 0 && currPrice > 0
                  ? r2(((currPrice / costo) - 1) * 100)
                  : 0;
                const marginDiff = Math.abs(actualMargin - configMargin) > 0.5;

                return (
                  <div
                    key={i}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 8,
                      background: changed ? 'rgba(234,189,35,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${changed ? 'rgba(234,189,35,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Space size={4}>
                        <Text strong style={{ fontSize: 13 }}>{listName}</Text>
                        {isDefault && <Tag color="gold" style={{ fontSize: 10, lineHeight: '16px', margin: 0 }}>Pred.</Tag>}
                      </Space>
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        <Tooltip title={`Margen ${marginSource === 'individual' ? 'individual' : 'de lista'}`}>
                          <Tag
                            color={configMargin < 5 ? 'red' : configMargin < 15 ? 'orange' : 'green'}
                            style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}
                          >
                            <PercentageOutlined /> {configMargin.toFixed(1)}%
                          </Tag>
                        </Tooltip>
                        {marginDiff && (
                          <Tooltip title="Margen actual">
                            <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>
                              → {actualMargin.toFixed(1)}%
                            </Tag>
                          </Tooltip>
                        )}
                      </div>
                    </div>

                    <InputNumber
                      value={currMargen}
                      onChange={v => handleMargenChange(i - 1, v)}
                      precision={2}
                      suffix="%"
                      controls={false}
                      style={{ width: 90 }}
                      size="small"
                    />

                    <InputNumber
                      value={currPrice}
                      onChange={v => handlePriceChange(i, v)}
                      min={0}
                      precision={2}
                      prefix="$"
                      controls={false}
                      style={{
                        width: 130,
                        fontWeight: changed ? 700 : 400,
                      }}
                      size="middle"
                    />
                  </div>
                );
              })}
            </div>

            {isModified && (
              <>
                <Divider style={{ margin: '12px 0 8px' }} />
                <Text type="warning" style={{ fontSize: 12 }}>
                  Hay cambios pendientes. Al guardar se actualizarán costo, precios y márgenes.
                </Text>
              </>
            )}
          </>
        )
      )}
    </Modal>
  );
}
