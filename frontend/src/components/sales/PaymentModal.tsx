import { useState, useEffect } from 'react';
import { Modal, InputNumber, Space, Typography, Divider, Button, Radio, message } from 'antd';
import { DollarOutlined, CreditCardOutlined, WalletOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
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
  const [montoEfectivo, setMontoEfectivo] = useState(0);
  const [montoDigital, setMontoDigital] = useState(0);
  const [metodo, setMetodo] = useState<'efectivo' | 'digital' | 'mixto'>('efectivo');

  const montoASaldar = venta
    ? venta.TOTAL - (venta.MONTO_EFECTIVO || 0) - (venta.MONTO_DIGITAL || 0)
    : 0;

  useEffect(() => {
    if (open && venta) {
      setMontoEfectivo(montoASaldar);
      setMontoDigital(0);
      setMetodo('efectivo');
    }
  }, [open, venta, montoASaldar]);

  useEffect(() => {
    if (metodo === 'efectivo') {
      setMontoEfectivo(montoASaldar);
      setMontoDigital(0);
    } else if (metodo === 'digital') {
      setMontoEfectivo(0);
      setMontoDigital(montoASaldar);
    }
  }, [metodo, montoASaldar]);

  const vuelto = metodo === 'efectivo' || metodo === 'mixto'
    ? Math.max(0, (montoEfectivo + montoDigital) - montoASaldar)
    : 0;

  const payMutation = useMutation({
    mutationFn: () => {
      if (!venta) throw new Error('No hay venta seleccionada');
      return salesApi.pay(venta.VENTA_ID, {
        MONTO_EFECTIVO: montoEfectivo,
        MONTO_DIGITAL: montoDigital,
        VUELTO: vuelto,
        parcial: mode === 'parcial',
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

  const totalIngresado = montoEfectivo + montoDigital;
  const esValido = mode === 'parcial'
    ? totalIngresado > 0
    : totalIngresado >= montoASaldar;

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
            <Radio.Group value={metodo} onChange={e => setMetodo(e.target.value)} buttonStyle="solid">
              <Radio.Button value="efectivo">
                <DollarOutlined /> Efectivo
              </Radio.Button>
              <Radio.Button value="digital">
                <CreditCardOutlined /> Digital
              </Radio.Button>
              <Radio.Button value="mixto">
                Mixto
              </Radio.Button>
            </Radio.Group>
          </div>

          {(metodo === 'efectivo' || metodo === 'mixto') && (
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Monto Efectivo</Text>
              <InputNumber
                value={montoEfectivo}
                min={0}
                step={100}
                size="large"
                style={{ width: '100%' }}
                formatter={v => `$ ${v}`}
                onChange={v => setMontoEfectivo(v || 0)}
                autoFocus={metodo === 'efectivo'}
              />
            </div>
          )}

          {(metodo === 'digital' || metodo === 'mixto') && (
            <div style={{ marginBottom: 12 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Monto Digital</Text>
              <InputNumber
                value={montoDigital}
                min={0}
                step={100}
                size="large"
                style={{ width: '100%' }}
                formatter={v => `$ ${v}`}
                onChange={v => setMontoDigital(v || 0)}
                autoFocus={metodo === 'digital'}
              />
            </div>
          )}

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
