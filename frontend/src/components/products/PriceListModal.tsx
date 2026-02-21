import { useEffect, useState } from 'react';
import { Modal, InputNumber, Typography, message, Space, Tag } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { catalogApi } from '../../services/catalog.api';
import { productApi } from '../../services/product.api';
import type { Producto } from '../../types';

const { Text } = Typography;

interface Props {
  open: boolean;
  product: Producto | null;
  onClose: () => void;
  onSaved: () => void;
}

const LISTA_FIELDS = ['LISTA_1', 'LISTA_2', 'LISTA_3', 'LISTA_4', 'LISTA_5'] as const;

export function PriceListModal({ open, product, onClose, onSaved }: Props) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const { data: listas } = useQuery({
    queryKey: ['listas-precios'],
    queryFn: () => catalogApi.getListasPrecios(),
  });

  // Sync prices from product when modal opens or product changes
  useEffect(() => {
    if (product && open) {
      const initial: Record<string, number> = {};
      for (const field of LISTA_FIELDS) {
        initial[field] = (product[field as keyof Producto] as number) ?? 0;
      }
      setPrices(initial);
      setDirty(new Set());
    }
  }, [product, open]);

  const handleChange = (field: string, value: number | null) => {
    setPrices(prev => ({ ...prev, [field]: value ?? 0 }));
    setDirty(prev => {
      const next = new Set(prev);
      const original = (product?.[field as keyof Producto] as number) ?? 0;
      if ((value ?? 0) !== original) {
        next.add(field);
      } else {
        next.delete(field);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!product || dirty.size === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      // Save each changed list via inline edit
      for (const field of dirty) {
        await productApi.inlineEdit({
          PRODUCTO_ID: product.PRODUCTO_ID,
          campo: field,
          valor: prices[field],
        });
      }
      message.success(`${dirty.size} lista(s) actualizada(s)`);
      onSaved();
      onClose();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Error al guardar precios');
    } finally {
      setSaving(false);
    }
  };

  const defaultListaIdx = product?.LISTA_DEFECTO;

  return (
    <Modal
      title={<span><DollarOutlined /> Listas de Precios</span>}
      open={open}
      onOk={handleSave}
      onCancel={onClose}
      confirmLoading={saving}
      okText={dirty.size > 0 ? 'Guardar' : 'Cerrar'}
      cancelText="Cancelar"
      destroyOnClose
      width={420}
    >
      {product && (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            <Text strong>{product.CODIGOPARTICULAR}</Text> — {product.NOMBRE}
          </Text>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {LISTA_FIELDS.map((field, idx) => {
              const listName = listas?.[idx]?.NOMBRE || `Lista ${idx + 1}`;
              const isDefault = defaultListaIdx === idx + 1;
              const isModified = dirty.has(field);
              return (
                <div key={field} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Space size={4}>
                      <Text strong style={{ fontSize: 13 }}>{listName}</Text>
                      {isDefault && <Tag color="gold" style={{ fontSize: 11 }}>Predeterminada</Tag>}
                    </Space>
                  </div>
                  <InputNumber
                    value={prices[field]}
                    onChange={(v) => handleChange(field, v)}
                    min={0}
                    precision={2}
                    prefix="$"
                    style={{
                      width: 160,
                      borderColor: isModified ? '#EABD23' : undefined,
                    }}
                    size="middle"
                  />
                </div>
              );
            })}
          </div>

          {product.PRECIO_COMPRA != null && (
            <div style={{ marginTop: 16, padding: '8px 12px', background: 'rgba(255,255,255,0.04)', borderRadius: 6 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Costo: <Text strong>$ {(product.PRECIO_COMPRA ?? 0).toFixed(2)}</Text>
                {product.COSTO_USD != null && product.COSTO_USD > 0 && (
                  <> &nbsp;|&nbsp; Costo USD: <Text strong>U$S {product.COSTO_USD.toFixed(2)}</Text></>
                )}
              </Text>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
