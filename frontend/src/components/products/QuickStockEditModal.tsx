import { useEffect, useMemo, useState } from 'react';
import { Modal, InputNumber, Select, Switch, Space, Button, Table, Tag, Typography, App, Input } from 'antd';
import { PlusOutlined, DeleteOutlined, InboxOutlined, WarningOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { productApi } from '../../services/product.api';
import { catalogApi } from '../../services/catalog.api';
import { useAuthStore } from '../../store/authStore';
import type { Producto } from '../../types';
import { fmtNum } from '../../utils/format';
import { notify } from '../../utils/notify.ts';

const { Text } = Typography;

interface DepositoRow {
  DEPOSITO_ID: number;
  CANTIDAD: number;
  DEPOSITO_NOMBRE?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  product: Producto | null;
}

export function QuickStockEditModal({ open, onClose, onSaved, product }: Props) {
  const { modal } = App.useApp();
  const [depositos, setDepositos] = useState<DepositoRow[]>([]);
  const [observation, setObservation] = useState('');
  const [saving, setSaving] = useState(false);
  const [incluirOtrosPV, setIncluirOtrosPV] = useState(false);

  const puntosVentaUsuario = useAuthStore(s => s.puntosVenta);
  const puntoVentaActivo = useAuthStore(s => s.puntoVentaActivo);
  const pvPreferidoId =
    puntosVentaUsuario.find(pv => pv.ES_PREFERIDO)?.PUNTO_VENTA_ID
    ?? puntoVentaActivo
    ?? puntosVentaUsuario[0]?.PUNTO_VENTA_ID
    ?? null;
  const otrosPVIds = puntosVentaUsuario
    .map(pv => pv.PUNTO_VENTA_ID)
    .filter(id => id !== pvPreferidoId);
  const tieneOtrosPV = otrosPVIds.length > 0;
  const pvIdsParaDepositos: number[] | undefined = pvPreferidoId == null
    ? undefined
    : incluirOtrosPV
      ? [pvPreferidoId, ...otrosPVIds]
      : [pvPreferidoId];

  const { data: depositosList } = useQuery({
    queryKey: ['depositos', pvIdsParaDepositos ? [...pvIdsParaDepositos].sort((a, b) => a - b) : 'all'],
    queryFn: () => catalogApi.getDepositos(pvIdsParaDepositos),
    enabled: open,
  });

  const { data: detail } = useQuery({
    queryKey: ['product-edit', product?.PRODUCTO_ID],
    queryFn: () => productApi.getById(product!.PRODUCTO_ID),
    enabled: !!product && open,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const allowedDepositoIds = useMemo(() => {
    if (!depositosList) return null;
    return new Set(depositosList.map(d => d.DEPOSITO_ID));
  }, [depositosList]);
  const isDepositoAllowed = (id: number) =>
    allowedDepositoIds == null ? true : allowedDepositoIds.has(id);

  const visibleDepositos = useMemo(
    () => depositos.map((d, i) => ({ ...d, _idx: i })).filter(d => isDepositoAllowed(d.DEPOSITO_ID)),
    [depositos, allowedDepositoIds],
  );
  const hiddenDepositosCount = depositos.length - visibleDepositos.length;

  useEffect(() => {
    if (!open) return;
    setObservation('');
    if (detail) {
      setDepositos(detail.stockDepositos || []);
    }
  }, [open, detail]);

  const addDeposit = () => {
    const unused = depositosList?.find(d => !depositos.some(ed => ed.DEPOSITO_ID === d.DEPOSITO_ID));
    if (unused) {
      setDepositos([...depositos, { DEPOSITO_ID: unused.DEPOSITO_ID, CANTIDAD: 0, DEPOSITO_NOMBRE: unused.NOMBRE }]);
    }
  };

  const removeDeposit = (idx: number) => {
    const dep = depositos[idx];
    if (dep && dep.CANTIDAD > 0) {
      modal.confirm({
        title: <span style={{ color: '#1E1F22', fontWeight: 700, fontSize: 15 }}>Quitar depósito con stock</span>,
        icon: <WarningOutlined style={{ color: '#EABD23', fontSize: 22 }} />,
        content: (
          <div style={{ paddingTop: 4 }}>
            <div style={{
              background: 'rgba(234,189,35,0.08)',
              border: '1px solid rgba(234,189,35,0.3)',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 10,
            }}>
              <span style={{ fontWeight: 600 }}>{dep.DEPOSITO_NOMBRE ?? `#${dep.DEPOSITO_ID}`}</span> tiene{' '}
              <span style={{ color: '#EABD23', fontWeight: 700 }}>
                {dep.CANTIDAD} unidad{dep.CANTIDAD !== 1 ? 'es' : ''}
              </span> en stock.
            </div>
            <span style={{ color: '#666', fontSize: 13 }}>¿Estás seguro de que querés quitarlo del producto?</span>
          </div>
        ),
        okText: 'Sí, quitar',
        okType: 'danger',
        cancelText: 'Cancelar',
        onOk: () => setDepositos(depositos.filter((_, i) => i !== idx)),
      });
    } else {
      setDepositos(depositos.filter((_, i) => i !== idx));
    }
  };

  const updateDepositQty = (idx: number, cant: number) => {
    const next = [...depositos];
    const cur = next[idx]!;
    next[idx] = { DEPOSITO_ID: cur.DEPOSITO_ID, CANTIDAD: cant, DEPOSITO_NOMBRE: cur.DEPOSITO_NOMBRE };
    setDepositos(next);
  };

  const updateDepositId = (idx: number, depId: number) => {
    if (depositos.some((d, i) => i !== idx && d.DEPOSITO_ID === depId)) return;
    const next = [...depositos];
    const dep = depositosList?.find(d => d.DEPOSITO_ID === depId);
    const cur = next[idx]!;
    next[idx] = { DEPOSITO_ID: depId, CANTIDAD: cur.CANTIDAD ?? 0, DEPOSITO_NOMBRE: dep?.NOMBRE };
    setDepositos(next);
  };

  const handleSave = async () => {
    if (!product) return;
    setSaving(true);
    try {
      await productApi.update(product.PRODUCTO_ID, {
        depositos: depositos.map(d => ({ DEPOSITO_ID: d.DEPOSITO_ID, CANTIDAD: d.CANTIDAD })),
      });
      notify.success('Stock actualizado');
      onSaved();
      onClose();
    } catch (err: any) {
      notify.error(err?.response?.data?.error || 'Error al actualizar stock');
    } finally {
      setSaving(false);
    }
  };

  const totalCantidad = depositos.reduce((s, d) => s + (d.CANTIDAD || 0), 0);
  const esServicio = !!product?.ES_SERVICIO;
  const stockActual = product?.CANTIDAD ?? 0;
  const diferencia = totalCantidad - stockActual;

  return (
      <Modal
      title={
        <Space>
          <InboxOutlined />
          <span>Edición rápida de stock</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      confirmLoading={saving}
      okText="Guardar"
      cancelText="Cancelar"
      width={640}
      destroyOnClose
      className="rg-modal"
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
    >
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
          Producto: <b style={{ color: '#1E1F22' }}>{product?.NOMBRE}</b> · {product?.CODIGOPARTICULAR}
        </Text>
        <Space size={8}>
          <Tag color="blue">Stock actual: {fmtNum(stockActual)}</Tag>
          {diferencia !== 0 && (
            <Tag color={diferencia > 0 ? 'green' : 'red'}>
              Nuevo: {fmtNum(totalCantidad)} ({diferencia > 0 ? '+' : ''}{fmtNum(diferencia)})
            </Tag>
          )}
        </Space>
      </div>

      {esServicio ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
          <InboxOutlined style={{ fontSize: 32, marginBottom: 12 }} />
          <br />
          <Text type="secondary">Los productos de tipo servicio no requieren stock ni depósitos.</Text>
        </div>
      ) : (
        <>
          {tieneOtrosPV && (
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch size="small" checked={incluirOtrosPV} onChange={setIncluirOtrosPV} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Mostrar también depósitos de mis otros puntos de venta
              </Text>
            </div>
          )}

          {hiddenDepositosCount > 0 && (
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                El producto tiene stock en {hiddenDepositosCount} depósito{hiddenDepositosCount !== 1 ? 's' : ''} de otros puntos de venta. Esos valores se conservarán al guardar.
              </Text>
            </div>
          )}

          <Table
            size="small"
            dataSource={visibleDepositos}
            rowKey={(r) => String(r.DEPOSITO_ID)}
            pagination={false}
            columns={[
              {
                title: 'Depósito', dataIndex: 'DEPOSITO_ID', width: '50%',
                render: (val: number, row: any) => {
                  const idx = row._idx as number;
                  const opts = (depositosList ?? []).map(d => ({
                    label: d.NOMBRE,
                    value: d.DEPOSITO_ID,
                    disabled: d.DEPOSITO_ID !== val && depositos.some((ed, i) => i !== idx && ed.DEPOSITO_ID === d.DEPOSITO_ID),
                  }));
                  return (
                    <Select
                      size="small"
                      style={{ width: '100%' }}
                      value={val}
                      onChange={(v) => updateDepositId(idx, v)}
                      options={opts}
                    />
                  );
                },
              },
              {
                title: 'Cantidad', dataIndex: 'CANTIDAD', width: '35%',
                render: (val: number, row: any) => (
                  <InputNumber
                    size="small"
                    min={0}
                    precision={2}
                    value={val}
                    onChange={(v) => updateDepositQty(row._idx, v || 0)}
                    style={{ width: '100%' }}
                  />
                ),
              },
              {
                title: '', width: 50,
                render: (_: any, row: any) => (
                  <Button type="text" danger size="small" icon={<DeleteOutlined />}
                    onClick={() => removeDeposit(row._idx)} />
                ),
              },
            ]}
          />

          <Button type="dashed" icon={<PlusOutlined />} onClick={addDeposit}
            style={{ marginTop: 8 }} block>
            Agregar depósito
          </Button>

          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            Total: <b style={{ color: '#EABD23' }}>{fmtNum(totalCantidad)}</b>
          </Text>

          <div style={{ marginTop: 12 }}>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Observaciones (opcional):</Text>
            <Input.TextArea
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder="Motivo del ajuste (queda en la auditoría de stock)…"
              rows={2}
              maxLength={500}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
