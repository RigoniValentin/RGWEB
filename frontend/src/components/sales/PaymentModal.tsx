import { useState, useEffect, useMemo } from 'react';
import { Modal, InputNumber, Space, Typography, Divider, Button, Tag, message } from 'antd';
import { DollarOutlined, CreditCardOutlined, WalletOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { salesApi } from '../../services/sales.api';
import { fmtMoney } from '../../utils/format';
import type { Venta } from '../../types';

const { Title, Text } = Typography;

interface Props {
  open: boolean;
  venta: Venta | null;
  onClose: () => void;
  onSuccess: () => void;
  mode: 'total' | 'parcial';
}

export function PaymentModal({ open, venta, onClose, onSuccess, mode }: Props) {
  const [selectedMetodos, setSelectedMetodos] = useState<number[]>([]);
  const [montosPorMetodo, setMontosPorMetodo] = useState<Record<number, number>>({});

  const { data: metodosPago = [] } = useQuery({
    queryKey: ['sales-active-payment-methods'],
    queryFn: () => salesApi.getActivePaymentMethods(),
    enabled: open,
    staleTime: 60000,
  });

  const metodosPagoOrdenados = useMemo(() => {
    const copy = [...metodosPago];
    copy.sort((a, b) => {
      const aScore = a.CATEGORIA === 'EFECTIVO' && a.POR_DEFECTO ? 0 : a.CATEGORIA === 'EFECTIVO' ? 1 : 2;
      const bScore = b.CATEGORIA === 'EFECTIVO' && b.POR_DEFECTO ? 0 : b.CATEGORIA === 'EFECTIVO' ? 1 : 2;
      if (aScore !== bScore) return aScore - bScore;
      return a.NOMBRE.localeCompare(b.NOMBRE);
    });
    return copy;
  }, [metodosPago]);

  const defaultMetodoEfectivoId = useMemo(() => {
    const efectivoPorDefecto = metodosPago.find(m => m.CATEGORIA === 'EFECTIVO' && m.POR_DEFECTO);
    if (efectivoPorDefecto) return efectivoPorDefecto.METODO_PAGO_ID;
    const primerEfectivo = metodosPago.find(m => m.CATEGORIA === 'EFECTIVO');
    if (primerEfectivo) return primerEfectivo.METODO_PAGO_ID;
    return metodosPago[0]?.METODO_PAGO_ID;
  }, [metodosPago]);

  const montoASaldar = venta
    ? venta.TOTAL - (venta.MONTO_EFECTIVO || 0) - (venta.MONTO_DIGITAL || 0)
    : 0;

  useEffect(() => {
    if (open && venta) {
      setSelectedMetodos(defaultMetodoEfectivoId ? [defaultMetodoEfectivoId] : []);
      setMontosPorMetodo({});
    }
  }, [open, venta, defaultMetodoEfectivoId]);

  // When a single method is selected, auto-fill the amount
  useEffect(() => {
    if (selectedMetodos.length === 1) {
      setMontosPorMetodo({ [selectedMetodos[0]!]: montoASaldar });
    }
  }, [selectedMetodos, montoASaldar]);

  const totalRecibido = useMemo(
    () => selectedMetodos.reduce((sum, id) => sum + (montosPorMetodo[id] || 0), 0),
    [selectedMetodos, montosPorMetodo]
  );

  const hayEfectivo = selectedMetodos.some(id => {
    const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
    return m?.CATEGORIA === 'EFECTIVO';
  });

  const soloEfectivo = selectedMetodos.length > 0 && selectedMetodos.every(id => {
    const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
    return m?.CATEGORIA === 'EFECTIVO';
  });

  const vuelto = useMemo(() => {
    if (selectedMetodos.length === 0) return 0;
    if (soloEfectivo || hayEfectivo) return Math.max(0, totalRecibido - montoASaldar);
    return 0;
  }, [selectedMetodos, totalRecibido, montoASaldar, soloEfectivo, hayEfectivo]);

  const payMutation = useMutation({
    mutationFn: () => {
      if (!venta) throw new Error('No hay venta seleccionada');
      // Derive category totals
      let efectivoTotal = 0;
      let digitalTotal = 0;
      const metodosPagoInput = selectedMetodos
        .filter(id => (montosPorMetodo[id] || 0) > 0)
        .map(id => {
          const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
          let monto = montosPorMetodo[id] || 0;
          if (m?.CATEGORIA === 'EFECTIVO' && vuelto > 0 && soloEfectivo) {
            monto = monto - vuelto;
          }
          if (m?.CATEGORIA === 'EFECTIVO') efectivoTotal += monto;
          else digitalTotal += monto;
          return { METODO_PAGO_ID: id, MONTO: monto };
        })
        .filter(mp => mp.MONTO > 0);

      return salesApi.pay(venta.VENTA_ID, {
        MONTO_EFECTIVO: efectivoTotal,
        MONTO_DIGITAL: digitalTotal,
        VUELTO: vuelto,
        parcial: mode === 'parcial',
        metodos_pago: metodosPagoInput,
      });
    },
    onSuccess: (result) => {
      message.success(result.cobrada ? 'Venta cobrada completamente' : 'Cobro parcial registrado');
      onSuccess();
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al registrar el cobro');
    },
  });

  const esValido = mode === 'parcial'
    ? totalRecibido > 0
    : totalRecibido >= montoASaldar;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={480}
      title={
        <Space>
          <WalletOutlined style={{ color: '#EABD23' }} />
          <span>{mode === 'total' ? 'Cobro Total' : 'Cobro Parcial'}</span>
        </Space>
      }
      footer={null}
      destroyOnClose
      className="rg-drawer"
    >
      {venta && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <Text type="secondary">Monto a cobrar</Text>
            <Title level={2} style={{ margin: '4px 0', color: '#EABD23' }}>
              {fmtMoney(montoASaldar)}
            </Title>
            <Text type="secondary">Venta #{venta.VENTA_ID} — {venta.CLIENTE_NOMBRE}</Text>
          </div>

          <Divider />

          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ marginBottom: 8, display: 'block' }}>Método de pago</Text>
            <Text type="secondary" style={{ fontSize: 12, marginBottom: 10, display: 'block' }}>
              Seleccione uno o más métodos. Si elige varios, podrá distribuir los montos.
            </Text>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
              {metodosPagoOrdenados.map(m => {
                const isSelected = selectedMetodos.includes(m.METODO_PAGO_ID);
                return (
                  <div
                    key={m.METODO_PAGO_ID}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedMetodos(prev => prev.filter(id => id !== m.METODO_PAGO_ID));
                        setMontosPorMetodo(prev => {
                          const next = { ...prev };
                          delete next[m.METODO_PAGO_ID];
                          return next;
                        });
                      } else {
                        setSelectedMetodos(prev => [...prev, m.METODO_PAGO_ID]);
                      }
                    }}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      padding: '14px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                      border: isSelected ? '2px solid #EABD23' : '1px solid #d9d9d9',
                      background: isSelected ? 'rgba(234, 189, 35, 0.08)' : 'transparent',
                      transition: 'all 0.15s', position: 'relative',
                    }}
                  >
                    {m.IMAGEN_BASE64 ? (
                      <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 32, height: 32, objectFit: 'contain', borderRadius: 4 }} />
                    ) : (
                      <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: isSelected ? '#EABD23' : '#999' }}>
                        {m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined /> : <CreditCardOutlined />}
                      </div>
                    )}
                    <Text strong style={{ fontSize: 12, lineHeight: 1.2 }}>{m.NOMBRE}</Text>
                    <Tag color={m.CATEGORIA === 'EFECTIVO' ? 'green' : 'blue'} style={{ fontSize: 10, margin: 0 }}>{m.CATEGORIA}</Tag>
                    {isSelected && (
                      <CheckCircleOutlined style={{ color: '#EABD23', fontSize: 14, position: 'absolute', top: 4, right: 4 }} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Amount inputs */}
          {selectedMetodos.length === 1 && (() => {
            const id = selectedMetodos[0]!;
            const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
            if (!m) return null;
            return (
              <div style={{ marginBottom: 12 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>Monto {m.NOMBRE}</Text>
                <InputNumber
                  value={montosPorMetodo[id] || 0}
                  min={0}
                  step={100}
                  size="large"
                  style={{ width: '100%' }}
                  formatter={v => `$ ${v}`}
                  onChange={v => setMontosPorMetodo(prev => ({ ...prev, [id]: v || 0 }))}
                  autoFocus
                />
              </div>
            );
          })()}

          {selectedMetodos.length > 1 && selectedMetodos.map(id => {
            const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
            if (!m) return null;
            return (
              <div style={{ marginBottom: 12 }} key={id}>
                <Text type="secondary" style={{ fontSize: 12 }}>Monto {m.NOMBRE}</Text>
                <InputNumber
                  value={montosPorMetodo[id] || 0}
                  min={0}
                  step={100}
                  size="large"
                  style={{ width: '100%' }}
                  formatter={v => `$ ${v}`}
                  onChange={v => setMontosPorMetodo(prev => ({ ...prev, [id]: v || 0 }))}
                />
              </div>
            );
          })}

          {vuelto > 0 && (
            <div style={{
              background: 'rgba(234, 189, 35, 0.08)',
              borderRadius: 8,
              padding: '8px 16px',
              marginBottom: 12,
              display: 'flex',
              justifyContent: 'space-between',
            }}>
              <Text>Vuelto:</Text>
              <Text strong style={{ color: '#EABD23', fontSize: 16 }}>{fmtMoney(vuelto)}</Text>
            </div>
          )}

          <Divider style={{ margin: '12px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={onClose}>Cancelar</Button>
            <Button
              type="primary"
              className="btn-gold"
              size="large"
              onClick={() => payMutation.mutate()}
              loading={payMutation.isPending}
              disabled={!esValido}
              icon={<WalletOutlined />}
            >
              Confirmar Cobro
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
