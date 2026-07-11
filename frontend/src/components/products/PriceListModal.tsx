import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Modal, InputNumber, Typography, Space, Tag, App, Segmented,
  Button, Divider, Tooltip, Spin, Select, Dropdown, Tabs,
} from 'antd';
import {
  DollarOutlined, ReloadOutlined, UndoOutlined, PercentageOutlined,
  VerticalAlignTopOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { catalogApi } from '../../services/catalog.api';
import { productApi } from '../../services/product.api';
import type { ListaPrecio, Producto } from '../../types';

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
  const [precios, setPrecios] = useState<Record<number, number>>({});
  const [origPrecios, setOrigPrecios] = useState<Record<number, number>>({});
  const [margenes, setMargenes] = useState<Record<number, number>>({});
  const [origMargenes, setOrigMargenes] = useState<Record<number, number>>({});
  const [marginSource, setMarginSource] = useState<MarginSource>('individual');
  const [listaDefecto, setListaDefecto] = useState<number | null>(null);
  const [origListaDefecto, setOrigListaDefecto] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: listas } = useQuery({
    queryKey: ['listas-precios'],
    queryFn: () => catalogApi.getListasPrecios(),
  });

  const listasActivas = useMemo<ListaPrecio[]>(
    () => (listas ?? []).filter(l => l.ACTIVA),
    [listas],
  );

  useEffect(() => {
    if (product && open) {
      setLoading(true);
      productApi.getById(product.PRODUCTO_ID).then(d => {
        const c = d.PRECIO_COMPRA ?? 0;
        setCosto(c);
        setOrigCosto(c);

        const initPrecios: Record<number, number> = {};
        const initOrigPrecios: Record<number, number> = {};
        for (const p of (d.precios ?? [])) {
          initPrecios[p.LISTA_ID] = p.PRECIO;
          initOrigPrecios[p.LISTA_ID] = p.PRECIO;
        }
        setPrecios(initPrecios);
        setOrigPrecios(initOrigPrecios);

        setListaDefecto(d.LISTA_DEFECTO ?? null);
        setOrigListaDefecto(d.LISTA_DEFECTO ?? null);

        const initMargenes: Record<number, number> = {};
        if (c > 0) {
          for (const p of (d.precios ?? [])) {
            initMargenes[p.LISTA_ID] = p.PRECIO > 0 ? r2(((p.PRECIO / c) - 1) * 100) : 0;
          }
        }
        setMargenes(initMargenes);
        setOrigMargenes({ ...initMargenes });
        const hasStored = Object.values(initMargenes).some(v => v > 0);
        setMarginSource(hasStored || d.MARGEN_INDIVIDUAL ? 'individual' : 'lista');
      }).finally(() => setLoading(false));
    }
  }, [product, open]);

  const isModified = useMemo(() => {
    if (Math.abs(costo - origCosto) > 0.01) return true;
    if (listaDefecto !== origListaDefecto) return true;
    for (const id of new Set([...Object.keys(precios), ...Object.keys(origPrecios)].map(Number))) {
      if (Math.abs((precios[id] || 0) - (origPrecios[id] || 0)) > 0.01) return true;
    }
    return false;
  }, [costo, origCosto, precios, origPrecios, listaDefecto, origListaDefecto]);

  const recalcFromMargins = useCallback(() => {
    if (costo <= 0) {
      message.warning('El costo debe ser mayor a 0 para recalcular');
      return;
    }
    const newPrecios: Record<number, number> = {};
    const newMargenes: Record<number, number> = {};
    for (const lista of listasActivas) {
      const id = lista.LISTA_ID;
      const margen = marginSource === 'individual'
        ? (origMargenes[id] || 0)
        : (lista.MARGEN || 0);
      newPrecios[id] = r2(costo * (1 + margen / 100));
      newMargenes[id] = margen;
    }
    setPrecios(newPrecios);
    setMargenes(newMargenes);
    message.info('Precios recalculados según márgenes');
  }, [costo, origMargenes, marginSource, listasActivas, message]);

  const resetAll = useCallback(() => {
    setCosto(origCosto);
    setPrecios({ ...origPrecios });
    setMargenes({ ...origMargenes });
    setListaDefecto(origListaDefecto);
  }, [origCosto, origPrecios, origMargenes, origListaDefecto]);

  const handleMargenChange = useCallback((listaId: number, value: number | null) => {
    const margen = value ?? 0;
    setMargenes(prev => ({ ...prev, [listaId]: margen }));
    if (costo > 0) {
      const precio = r2(costo * (1 + margen / 100));
      setPrecios(prev => ({ ...prev, [listaId]: precio }));
    }
  }, [costo]);

  const handlePriceChange = useCallback((listaId: number, value: number | null) => {
    const precio = value ?? 0;
    setPrecios(prev => ({ ...prev, [listaId]: precio }));
    if (costo > 0 && precio > 0) {
      setMargenes(prev => ({ ...prev, [listaId]: r2(((precio / costo) - 1) * 100) }));
    } else {
      setMargenes(prev => ({ ...prev, [listaId]: 0 }));
    }
  }, [costo]);

  const handleCostoChange = useCallback((value: number | null) => {
    const newCosto = value ?? 0;
    setCosto(newCosto);
    if (newCosto > 0) {
      const newPrecios: Record<number, number> = {};
      for (const idStr of Object.keys(margenes)) {
        const id = Number(idStr);
        newPrecios[id] = r2(newCosto * (1 + (margenes[id] || 0) / 100));
      }
      setPrecios(newPrecios);
    }
  }, [margenes]);

  const handleRedondearPrecios = useCallback((step: number) => {
    const newPrecios: Record<number, number> = { ...precios };
    const newMargenes: Record<number, number> = { ...margenes };
    for (const idStr of Object.keys(precios)) {
      const id = Number(idStr);
      const precio = precios[id] || 0;
      if (precio > 0) {
        const redondeado = Math.ceil(precio / step) * step;
        newPrecios[id] = redondeado;
        if (costo > 0) {
          newMargenes[id] = r2(((redondeado / costo) - 1) * 100);
        }
      }
    }
    setPrecios(newPrecios);
    setMargenes(newMargenes);
  }, [precios, margenes, costo]);

  const handleSave = async () => {
    if (!product || !isModified) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      // Sincronizar márgenes individuales (1..5) con los valores actuales
      const margenesLegacy: number[] = [];
      for (let i = 1; i <= 5; i++) margenesLegacy.push(margenes[i] || 0);

      await productApi.update(product.PRODUCTO_ID, {
        PRECIO_COMPRA: costo,
        precios,
        LISTA_DEFECTO: listaDefecto,
        MARGEN_INDIVIDUAL: marginSource === 'individual',
        margenes: margenesLegacy,
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

  const renderTabContent = (lista: ListaPrecio) => {
    const id = lista.LISTA_ID;
    const isDefault = listaDefecto === id;
    const origPrice = origPrecios[id] || 0;
    const currPrice = precios[id] || 0;
    const changed = Math.abs(currPrice - origPrice) > 0.01;
    const currMargen = margenes[id] || 0;
    const configMargin = marginSource === 'individual'
      ? (origMargenes[id] || 0)
      : (lista.MARGEN || 0);
    const actualMargin = costo > 0 && currPrice > 0
      ? r2(((currPrice / costo) - 1) * 100)
      : 0;
    const marginDiff = Math.abs(actualMargin - configMargin) > 0.5;

    return (
      <div style={{ paddingTop: 8 }}>
        <Space size={6} style={{ marginBottom: 12 }}>
          {isDefault && <Tag color="gold">Lista predeterminada</Tag>}
          <Tooltip title={`Margen ${marginSource === 'individual' ? 'individual' : 'de lista'}`}>
            <Tag color={configMargin < 5 ? 'red' : configMargin < 15 ? 'orange' : 'green'}>
              <PercentageOutlined /> {configMargin.toFixed(1)}%
            </Tag>
          </Tooltip>
          {marginDiff && (
            <Tooltip title="Margen real calculado desde precio actual">
              <Tag color="blue">→ {actualMargin.toFixed(1)}%</Tag>
            </Tooltip>
          )}
        </Space>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>
              Margen %
            </Text>
            <InputNumber
              value={currMargen}
              onChange={v => handleMargenChange(id, v)}
              precision={2}
              suffix="%"
              controls={false}
              style={{ width: '100%' }}
              size="large"
            />
          </div>
          <div>
            <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>
              Precio $
            </Text>
            <InputNumber
              value={currPrice}
              onChange={v => handlePriceChange(id, v)}
              min={0}
              precision={2}
              prefix="$"
              controls={false}
              style={{
                width: '100%',
                fontWeight: changed ? 700 : 400,
              }}
              size="large"
            />
            {changed && (
              <Text type="warning" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
                Original: ${origPrice.toFixed(2)}
              </Text>
            )}
          </div>
        </div>
      </div>
    );
  };

  const tabItems = listasActivas.map(lista => ({
    key: String(lista.LISTA_ID),
    label: (
      <Space size={4}>
        <span>{lista.NOMBRE}</span>
        {listaDefecto === lista.LISTA_ID && <Tag color="gold" style={{ margin: 0, fontSize: 10 }}>Pred.</Tag>}
        {Math.abs((precios[lista.LISTA_ID] || 0) - (origPrecios[lista.LISTA_ID] || 0)) > 0.01 && (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#EABD23', display: 'inline-block' }} />
        )}
      </Space>
    ),
    children: renderTabContent(lista),
  }));

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
      width={520}
      className="rg-modal"
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
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
                options={listasActivas.map(l => ({ label: l.NOMBRE, value: l.LISTA_ID }))}
              />
            </div>

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
              <Dropdown
                menu={{
                  items: [
                    { key: '50', label: 'Redondear a $ 50', onClick: () => handleRedondearPrecios(50) },
                    { key: '100', label: 'Redondear a $ 100', onClick: () => handleRedondearPrecios(100) },
                    { key: '500', label: 'Redondear a $ 500', onClick: () => handleRedondearPrecios(500) },
                    { key: '1000', label: 'Redondear a $ 1000', onClick: () => handleRedondearPrecios(1000) },
                  ],
                }}
                trigger={['click']}
              >
                <Tooltip title="Redondear precios">
                  <Button size="small" icon={<VerticalAlignTopOutlined />} />
                </Tooltip>
              </Dropdown>
              <Tooltip title="Recalcular precios">
                <Button size="small" icon={<ReloadOutlined />} onClick={recalcFromMargins} />
              </Tooltip>
              <Tooltip title="Restaurar valores originales">
                <Button size="small" icon={<UndoOutlined />} onClick={resetAll} disabled={!isModified} />
              </Tooltip>
            </div>

            <Divider style={{ margin: '4px 0 10px' }} />

            <Tabs items={tabItems} type="card" size="small" />

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
