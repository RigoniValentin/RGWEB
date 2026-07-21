import { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, InputNumber, Button, Space, Typography, Divider, Tag, Tooltip } from 'antd';
import {
  SaveOutlined, ReloadOutlined, UndoOutlined,
  PercentageOutlined, StarFilled, EditOutlined, CloseOutlined,
} from '@ant-design/icons';
import type { PriceCheckProduct } from '../../services/purchases.api';
import { fmtMoney, fmtNum } from '../../utils/format';
import { notify } from '../../utils/notify.ts';

const { Text, Title } = Typography;

const r2 = (n: number) => Math.round(n * 100) / 100;
const MARGEN_TOLERANCE = 0.5;
const roundToMultiple = (value: number, multiple: number) =>
  Math.round(value / multiple) * multiple;

interface Props {
  open: boolean;
  product: PriceCheckProduct | null;
  listNames: Record<number, string>;
  listMargins: Record<number, number>;
  onClose: () => void;
  onSave: (update: {
    PRODUCTO_ID: number;
    precios: { LISTA_ID: number; PRECIO: number }[];
  }) => void;
}

export function ProductPriceEditorModal({
  open, product, listNames, listMargins, onClose, onSave,
}: Props) {
  const [prices, setPrices] = useState<Record<number, number>>({});
  const [origPrices, setOrigPrices] = useState<Record<number, number>>({});
  const [editingMarginFor, setEditingMarginFor] = useState<number | null>(null);

  useEffect(() => {
    if (product && open) {
      const init: Record<number, number> = {};
      for (const p of product.precios) init[p.LISTA_ID] = p.PRECIO;
      setPrices(init);
      setOrigPrices(init);
    }
  }, [product, open]);

  const listasActivas = useMemo(
    () => Object.keys(listNames).map(Number).sort((a, b) => a - b),
    [listNames],
  );

  const costoMargenBase = useMemo(() => {
    if (!product) return 0;
    return product.COSTO;
  }, [product]);

  const getActualMargin = useCallback((listaId: number): number => {
    const precio = prices[listaId] || 0;
    if (costoMargenBase <= 0) return 0;
    return r2(((precio / costoMargenBase) - 1) * 100);
  }, [prices, costoMargenBase]);

  const matchesDefault = useCallback((listaId: number): boolean => {
    const margenDefault = listMargins[listaId] || 0;
    const actual = getActualMargin(listaId);
    if (costoMargenBase <= 0) return true;
    return Math.abs(actual - margenDefault) <= MARGEN_TOLERANCE;
  }, [listMargins, getActualMargin, costoMargenBase]);

  const isModified = useMemo(() => {
    for (const id of new Set([...Object.keys(prices), ...Object.keys(origPrices)].map(Number))) {
      if (Math.abs((prices[id] || 0) - (origPrices[id] || 0)) > 0.01) return true;
    }
    return false;
  }, [prices, origPrices]);

  const modifiedCount = useMemo(() => {
    let n = 0;
    for (const id of new Set([...Object.keys(prices), ...Object.keys(origPrices)].map(Number))) {
      if (Math.abs((prices[id] || 0) - (origPrices[id] || 0)) > 0.01) n++;
    }
    return n;
  }, [prices, origPrices]);

  const updatePrice = (listaId: number, value: number | null) => {
    setPrices(prev => ({ ...prev, [listaId]: r2(value || 0) }));
  };

  const updateMargin = (listaId: number, value: number | null) => {
    const margen = value || 0;
    if (costoMargenBase <= 0) {
      notify.warning('El costo debe ser mayor a 0 para calcular el margen');
      return;
    }
    const newPrice = r2(costoMargenBase * (1 + margen / 100));
    setPrices(prev => ({ ...prev, [listaId]: newPrice }));
  };

  const roundPrice = (listaId: number, multiple: number) => {
    setPrices(prev => {
      const curr = prev[listaId] || 0;
      return { ...prev, [listaId]: roundToMultiple(curr, multiple) };
    });
  };

  const recalcFromListMargins = useCallback(() => {
    if (!product) return;
    if (costoMargenBase <= 0) {
      notify.warning('El costo debe ser mayor a 0 para recalcular');
      return;
    }
    const newPrices: Record<number, number> = {};
    for (const id of listasActivas) {
      const margen = listMargins[id] || 0;
      newPrices[id] = r2(costoMargenBase * (1 + margen / 100));
    }
    setPrices(newPrices);
    notify.info('Precios recalculados desde márgenes default de cada lista');
  }, [product, costoMargenBase, listMargins, listasActivas]);

  const roundAll = (multiple: number) => {
    setPrices(prev => {
      const updated = { ...prev };
      for (const id of listasActivas) {
        const curr = updated[id] || 0;
        updated[id] = roundToMultiple(curr, multiple);
      }
      return updated;
    });
    notify.info(`Precios redondeados a múltiplos de $${multiple}`);
  };

  const resetPrices = useCallback(() => {
    setPrices({ ...origPrices });
  }, [origPrices]);

  const handleSave = () => {
    if (!product) return;
    const precios = listasActivas
      .map(id => ({ LISTA_ID: id, PRECIO: prices[id] || 0 }))
      .filter(p => p.PRECIO > 0);
    onSave({ PRODUCTO_ID: product.PRODUCTO_ID, precios });
  };

  if (!product) return null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="95vw"
      style={{ maxWidth: 1100 }}
      centered
      destroyOnClose
      closable={false}
      className="new-sale-modal"
      styles={{ body: { padding: 0, overflow: 'hidden' } }}
    >
      {/* ── Dark header bar ───────────────────────── */}
      <div className="nsm-header">
        <div className="nsm-header-left">
          <EditOutlined className="nsm-header-icon" />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <Text type="secondary" style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>
              #{product.CODIGO}
            </Text>
            <Title level={5} style={{ margin: 0, color: '#fff' }}>
              {product.DESCRIPCION}
            </Title>
          </div>
          {isModified && (
            <Tag color="green" style={{ margin: 0, fontWeight: 600 }}>
              {modifiedCount} cambio{modifiedCount > 1 ? 's' : ''}
            </Tag>
          )}
        </div>
        <Button
          type="text"
          onClick={onClose}
          icon={<CloseOutlined />}
          style={{ color: 'rgba(255,255,255,0.7)', fontSize: 18 }}
        />
      </div>

      {/* ── Toolbar ──────────────────────────────── */}
      <div style={{
        padding: '12px 20px 8px',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <Tooltip title="Recalcular todos los precios usando el margen default de cada lista">
          <Button size="small" icon={<ReloadOutlined />} onClick={recalcFromListMargins}>
            Recalcular desde listas
          </Button>
        </Tooltip>
        <Tooltip title="Deshacer todos los cambios no guardados">
          <Button size="small" icon={<UndoOutlined />} onClick={resetPrices} disabled={!isModified}>
            Deshacer
          </Button>
        </Tooltip>
        <Divider type="vertical" style={{ margin: '0 4px' }} />
        <Tooltip title="Redondear todos los precios al múltiplo de $50">
          <Button size="small" onClick={() => roundAll(50)}>Red. $50</Button>
        </Tooltip>
        <Tooltip title="Redondear todos los precios al múltiplo de $100">
          <Button size="small" onClick={() => roundAll(100)}>Red. $100</Button>
        </Tooltip>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Tag color="blue">Costo {fmtMoney(product.COSTO)}</Tag>
          {product.IMP_INTERNO > 0 && (
            <Tag color="default">Imp.Int {fmtMoney(product.IMP_INTERNO)}</Tag>
          )}
          {product.IVA_ALICUOTA > 0 && (
            <Tag color="default">IVA {product.IVA_ALICUOTA}%</Tag>
          )}
          <Tag color="default">Base margen {fmtMoney(costoMargenBase)}</Tag>
        </div>
      </div>

      {/* ── Grid de listas ───────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
        gap: 10,
        padding: '4px 20px 12px',
        maxHeight: 'calc(100dvh - 280px)', overflowY: 'auto',
      }}>
        {listasActivas.map(listaId => {
          const name = listNames[listaId] || `Lista ${listaId}`;
          const margenDefault = listMargins[listaId] || 0;
          const currPrice = prices[listaId] || 0;
          const origPrice = origPrices[listaId] || 0;
          const changed = Math.abs(currPrice - origPrice) > 0.01;
          const actualMargin = getActualMargin(listaId);
          const matches = matchesDefault(listaId);
          const isDefaultList = product.LISTA_DEFECTO === listaId;

          // Color de fondo: predeterminada (dorado) > modificada (verde) > normal
          let bgColor = '#fafafa';
          let borderColor = '#f0f0f0';
          let borderWidth = '1px';
          if (changed) { bgColor = '#f6ffed'; borderColor = '#b7eb8f'; }
          if (isDefaultList) {
            borderColor = '#EABD23';
            borderWidth = '2px';
            if (currPrice > 0) bgColor = matches ? 'rgba(234,189,35,0.08)' : '#fff7e6';
          }

          return (
            <div
              key={listaId}
              style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                padding: '12px 14px', borderRadius: 10,
                backgroundColor: bgColor,
                border: `${borderWidth} solid ${borderColor}`,
                position: 'relative',
                boxShadow: isDefaultList ? '0 0 0 2px rgba(234,189,35,0.15)' : 'none',
              }}
            >
              {/* Header */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  {isDefaultList && (
                    <StarFilled style={{ fontSize: 11, color: '#EABD23' }} />
                  )}
                  <Text
                    strong
                    style={{
                      fontSize: 13,
                      color: isDefaultList ? '#876800' : undefined,
                    }}
                    ellipsis={{ tooltip: name }}
                  >
                    {name}
                  </Text>
                  {isDefaultList && (
                    <Tag color="gold" style={{ margin: 0, fontSize: 9, lineHeight: '14px', padding: '0 4px' }}>
                      Pred.
                    </Tag>
                  )}
                </div>
                <Space size={3} wrap>
                  <Tooltip title="Margen default configurado en la lista">
                    <Tag color="geekblue" style={{ margin: 0, fontSize: 10, padding: '0 5px' }}>
                      Default {fmtNum(margenDefault)}%
                    </Tag>
                  </Tooltip>
                  {currPrice > 0 && (
                    editingMarginFor === listaId ? (
                      <InputNumber
                        autoFocus
                        value={actualMargin}
                        min={-100}
                        step={1}
                        controls={false}
                        suffix="%"
                        size="small"
                        style={{ width: 90, fontSize: 11 }}
                        onChange={v => updateMargin(listaId, v)}
                        onBlur={() => setEditingMarginFor(null)}
                        onPressEnter={() => setEditingMarginFor(null)}
                      />
                    ) : (
                      <Tooltip title={costoMargenBase > 0 ? 'Click para editar el margen (recalcula el precio)' : 'Se requiere costo válido'}>
                        <Tag
                          color={matches ? 'green' : 'default'}
                          style={{
                            margin: 0, fontSize: 10, padding: '0 5px',
                            cursor: costoMargenBase > 0 ? 'pointer' : 'default',
                          }}
                          onClick={() => {
                            if (costoMargenBase > 0) setEditingMarginFor(listaId);
                          }}
                        >
                          <PercentageOutlined /> Actual {fmtNum(actualMargin)}%
                        </Tag>
                      </Tooltip>
                    )
                  )}
                </Space>
              </div>

              {/* Price input (grande) */}
              <InputNumber
                value={currPrice}
                min={0}
                step={0.01}
                controls={false}
                prefix="$"
                placeholder="Sin precio"
                onChange={v => updatePrice(listaId, v)}
                style={{
                  width: '100%',
                  fontWeight: changed ? 700 : 500,
                  fontSize: 16,
                }}
                size="large"
              />

              {/* Original + round buttons */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 20 }}>
                <Text type="secondary" style={{ fontSize: 10 }}>
                  {changed ? `Original: $${origPrice.toFixed(2)}` : (origPrice > 0 ? `— $${origPrice.toFixed(2)} —` : ' ')}
                </Text>
                <Space size={2}>
                  <Tooltip title="Redondear a múltiplos de $50">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined style={{ fontSize: 10 }} />}
                      onClick={() => roundPrice(listaId, 50)}
                      style={{ fontSize: 10, padding: '0 6px', height: 22 }}
                    >
                      50
                    </Button>
                  </Tooltip>
                  <Tooltip title="Redondear a múltiplos de $100">
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined style={{ fontSize: 10 }} />}
                      onClick={() => roundPrice(listaId, 100)}
                      style={{ fontSize: 10, padding: '0 6px', height: 22 }}
                    >
                      100
                    </Button>
                  </Tooltip>
                </Space>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Footer ────────────────────────────────── */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid #f0f0f0',
        background: '#fafafa',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {isModified
            ? `${modifiedCount} lista(s) con precios modificados.`
            : 'Sin cambios pendientes.'}
        </Text>
        <Space>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            disabled={!isModified}
            className="btn-gold"
          >
            Guardar precios
          </Button>
        </Space>
      </div>
    </Modal>
  );
}
