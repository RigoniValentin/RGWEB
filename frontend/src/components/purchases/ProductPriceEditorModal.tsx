import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Modal, InputNumber, Button, Space, Typography, Divider,
  Tag, Tooltip, message, Segmented, Descriptions,
} from 'antd';
import {
  SaveOutlined, ReloadOutlined, UndoOutlined,
  PercentageOutlined,
} from '@ant-design/icons';
import type { PriceCheckProduct } from '../../services/purchases.api';
import { fmtMoney, fmtNum } from '../../utils/format';

const { Text } = Typography;

const r2 = (n: number) => Math.round(n * 100) / 100;

const roundToMultiple = (value: number, multiple: number) =>
  Math.round(value / multiple) * multiple;

type MarginSource = 'individual' | 'lista';

interface Props {
  open: boolean;
  product: PriceCheckProduct | null;
  listNames: Record<number, string>;
  listMargins: Record<number, number>;
  impIntGravaIva: boolean;
  onClose: () => void;
  onSave: (update: {
    PRODUCTO_ID: number;
    LISTA_1: number; LISTA_2: number; LISTA_3: number;
    LISTA_4: number; LISTA_5: number;
  }) => void;
}

interface PriceState {
  LISTA_1: number; LISTA_2: number; LISTA_3: number;
  LISTA_4: number; LISTA_5: number;
}

export function ProductPriceEditorModal({
  open, product, listNames, listMargins, impIntGravaIva, onClose, onSave,
}: Props) {
  const [prices, setPrices] = useState<PriceState>({ LISTA_1: 0, LISTA_2: 0, LISTA_3: 0, LISTA_4: 0, LISTA_5: 0 });
  const [origPrices, setOrigPrices] = useState<PriceState>({ LISTA_1: 0, LISTA_2: 0, LISTA_3: 0, LISTA_4: 0, LISTA_5: 0 });
  const [marginSource, setMarginSource] = useState<MarginSource>('individual');

  useEffect(() => {
    if (product && open) {
      const p: PriceState = {
        LISTA_1: product.LISTA_1,
        LISTA_2: product.LISTA_2,
        LISTA_3: product.LISTA_3,
        LISTA_4: product.LISTA_4,
        LISTA_5: product.LISTA_5,
      };
      setPrices(p);
      setOrigPrices(p);
      setMarginSource(product.TIENE_MARGENES_INDIV ? 'individual' : 'lista');
    }
  }, [product, open]);

  // COSTO = PRECIO_COMPRA (costo con impuestos), used directly for margin calculations
  const costoMargenBase = useMemo(() => {
    if (!product) return 0;
    return product.COSTO;
  }, [product]);

  // Get the margin for a list depending on source
  const getConfiguredMargin = useCallback((listNum: number): number => {
    if (!product) return 0;
    if (marginSource === 'individual') {
      return (product as any)[`MARGEN_${listNum}`] || 0;
    }
    return listMargins[listNum] || 0;
  }, [product, marginSource, listMargins]);

  // Calculate actual margin from current price (based on cost without IVA)
  const getActualMargin = useCallback((listNum: number): number => {
    const price = (prices as any)[`LISTA_${listNum}`] || 0;
    if (costoMargenBase <= 0) return 0;
    return r2(((price / costoMargenBase) - 1) * 100);
  }, [prices, costoMargenBase]);

  const isModified = useMemo(() => {
    for (let i = 1; i <= 5; i++) {
      const curr = (prices as any)[`LISTA_${i}`] || 0;
      const orig = (origPrices as any)[`LISTA_${i}`] || 0;
      if (Math.abs(curr - orig) > 0.01) return true;
    }
    return false;
  }, [prices, origPrices]);

  const recalcFromMargins = useCallback(() => {
    if (!product) return;
    const newPrices: any = { ...prices };
    for (let i = 1; i <= 5; i++) {
      const margen = getConfiguredMargin(i);
      newPrices[`LISTA_${i}`] = r2(costoMargenBase * (1 + margen / 100));
    }
    setPrices(newPrices);
    message.info('Precios recalculados según márgenes');
  }, [product, costoMargenBase, getConfiguredMargin, prices]);

  const resetPrices = useCallback(() => {
    setPrices({ ...origPrices });
  }, [origPrices]);

  const updatePrice = (listNum: number, value: number) => {
    setPrices(prev => ({ ...prev, [`LISTA_${listNum}`]: r2(value) }));
  };

  const roundPrice = (listNum: number, multiple: number) => {
    setPrices(prev => {
      const curr = (prev as any)[`LISTA_${listNum}`] || 0;
      return { ...prev, [`LISTA_${listNum}`]: roundToMultiple(curr, multiple) };
    });
  };

  const roundAll = (multiple: number) => {
    setPrices(prev => {
      const updated: any = { ...prev };
      for (let i = 1; i <= 5; i++) {
        updated[`LISTA_${i}`] = roundToMultiple(updated[`LISTA_${i}`] || 0, multiple);
      }
      return updated;
    });
    message.info(`Precios redondeados a múltiplos de $${multiple}`);
  };

  const handleSave = () => {
    if (!product) return;
    onSave({
      PRODUCTO_ID: product.PRODUCTO_ID,
      ...prices,
    });
  };

  if (!product) return null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>{product.CODIGO}</Text>
          <div style={{ fontSize: 16 }}>{product.DESCRIPCION}</div>
        </div>
      }
      width={480}
      centered
      destroyOnClose
      footer={
        <Space style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
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
      }
    >
      {/* Product info */}
      <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Costo">{fmtMoney(product.COSTO)}</Descriptions.Item>
        <Descriptions.Item label="Imp. Interno">
          {product.IMP_INTERNO > 0 ? fmtMoney(product.IMP_INTERNO) : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="IVA">{product.IVA_ALICUOTA}%</Descriptions.Item>
        <Descriptions.Item label="Base p/ margen">{fmtMoney(costoMargenBase)}</Descriptions.Item>
      </Descriptions>

      {/* Margin source selector */}
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
          Origen de márgenes
        </Text>
        <Segmented
          value={marginSource}
          onChange={val => setMarginSource(val as MarginSource)}
          block
          options={[
            {
              value: 'individual',
              label: 'Margen individual',
            },
            {
              value: 'lista',
              label: 'Margen de lista',
            },
          ]}
        />
      </div>

      {/* Action buttons */}
      <Space style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Space size="small">
          <Button size="small" icon={<ReloadOutlined />} onClick={recalcFromMargins}>
            Recalcular
          </Button>
          <Button size="small" icon={<UndoOutlined />} onClick={resetPrices} disabled={!isModified}>
            Deshacer
          </Button>
        </Space>
        <Space size="small">
          <Button size="small" onClick={() => roundAll(50)}>Red. $50</Button>
          <Button size="small" onClick={() => roundAll(100)}>Red. $100</Button>
        </Space>
      </Space>

      <Divider style={{ margin: '8px 0' }} />

      {/* Price rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {[1, 2, 3, 4, 5].map(i => {
          const name = listNames[i] || `Lista ${i}`;
          const configMargin = getConfiguredMargin(i);
          const actualMargin = getActualMargin(i);
          const origPrice = (origPrices as any)[`LISTA_${i}`] || 0;
          const currPrice = (prices as any)[`LISTA_${i}`] || 0;
          const changed = Math.abs(currPrice - origPrice) > 0.01;
          const marginDiff = Math.abs(actualMargin - configMargin) > 0.5;

          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', borderRadius: 8,
                backgroundColor: changed ? '#f6ffed' : '#fafafa',
                border: `1px solid ${changed ? '#b7eb8f' : '#f0f0f0'}`,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text strong style={{ fontSize: 13 }}>{name}</Text>
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <Tooltip title="Margen configurado">
                    <Tag
                      color={configMargin < 5 ? 'red' : configMargin < 15 ? 'orange' : 'green'}
                      style={{ margin: 0, fontSize: 11 }}
                    >
                      <PercentageOutlined /> {fmtNum(configMargin)}%
                    </Tag>
                  </Tooltip>
                  {marginDiff && (
                    <Tooltip title="Margen actual (según precio editado)">
                      <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
                        → {fmtNum(actualMargin)}%
                      </Tag>
                    </Tooltip>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <InputNumber
                  value={currPrice}
                  min={0}
                  step={0.01}
                  controls={false}
                  prefix="$"
                  onChange={v => updatePrice(i, v || 0)}
                  style={{
                    width: 130,
                    fontWeight: changed ? 700 : 400,
                  }}
                />
                <Space size={0}>
                  <Tooltip title="Redondear a $50">
                    <Button type="text" size="small" onClick={() => roundPrice(i, 50)} style={{ fontSize: 11, padding: '0 4px' }}>
                      50
                    </Button>
                  </Tooltip>
                  <Tooltip title="Redondear a $100">
                    <Button type="text" size="small" onClick={() => roundPrice(i, 100)} style={{ fontSize: 11, padding: '0 4px' }}>
                      100
                    </Button>
                  </Tooltip>
                </Space>
              </div>
            </div>
          );
        })}
      </div>

      {isModified && (
        <>
          <Divider style={{ margin: '12px 0 8px' }} />
          <Text type="success" style={{ fontSize: 12 }}>
            Hay cambios de precio pendientes. Al guardar se actualizarán también los márgenes individuales.
          </Text>
        </>
      )}
    </Modal>
  );
}
