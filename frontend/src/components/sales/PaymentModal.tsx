import { useState, useEffect, useMemo } from 'react';
import { Modal, InputNumber, Space, Typography, Divider, Button, Tag, Input, DatePicker, message } from 'antd';
import { DollarOutlined, CreditCardOutlined, WalletOutlined, CheckCircleOutlined, BankOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { salesApi } from '../../services/sales.api';
import { bancosApi } from '../../services/bancos.api';
import BancoSelect from '../cheques/BancoSelect';
import { fmtMoney } from '../../utils/format';
import type { Venta, ChequePayload } from '../../types';

const { Title, Text } = Typography;

interface Props {
  open: boolean;
  venta: Venta | null;
  onClose: () => void;
  onSuccess: () => void;
  mode: 'total' | 'parcial';
}

export function PaymentModal({ open, venta, onClose, onSuccess, mode }: Props) {
  const queryClient = useQueryClient();
  const [selectedMetodos, setSelectedMetodos] = useState<number[]>([]);
  const [montosPorMetodo, setMontosPorMetodo] = useState<Record<number, number>>({});
  const [chequesPorMetodo, setChequesPorMetodo] = useState<Record<number, ChequePayload>>({});

  const { data: metodosPago = [] } = useQuery({
    queryKey: ['sales-active-payment-methods'],
    queryFn: () => salesApi.getActivePaymentMethods(),
    enabled: open,
    staleTime: 60000,
  });

  const { data: bancosCache } = useQuery({
    queryKey: ['bancos', 'activos'],
    queryFn: () => bancosApi.getAll({ activo: true }),
    enabled: open,
    staleTime: 5 * 60 * 1000,
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
      setChequesPorMetodo({});
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

  const metodosCheque = useMemo(() =>
    selectedMetodos
      .map(id => metodosPago.find(mp => mp.METODO_PAGO_ID === id))
      .filter((m): m is NonNullable<typeof m> => !!m && m.CATEGORIA === 'CHEQUES'),
    [selectedMetodos, metodosPago]);

  const chequesIncompletos = metodosCheque.some(m => {
    if ((montosPorMetodo[m.METODO_PAGO_ID] || 0) <= 0) return false;
    const c = chequesPorMetodo[m.METODO_PAGO_ID];
    return !c || !c.BANCO?.trim() || !c.LIBRADOR?.trim() || !c.NUMERO?.trim();
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
          else if (m?.CATEGORIA === 'CHEQUES') { /* cheques: flujo separado, no cuentan en efectivo/digital */ }
          else digitalTotal += monto;
          const item: { METODO_PAGO_ID: number; MONTO: number; cheque?: ChequePayload } = { METODO_PAGO_ID: id, MONTO: monto };
          if (m?.CATEGORIA === 'CHEQUES') {
            const c = chequesPorMetodo[id];
            if (c) item.cheque = c;
          }
          return item;
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
      // Si la venta usó cheques (método CHEQUES), invalidar caché de cheques.
      if (metodosCheque.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['cheques'] });
        queryClient.invalidateQueries({ queryKey: ['cheques-resumen'] });
        queryClient.invalidateQueries({ queryKey: ['cheques-cartera'] });
      }
      onSuccess();
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al registrar el cobro');
    },
  });

  const esValido = (mode === 'parcial'
    ? totalRecibido > 0
    : totalRecibido >= montoASaldar) && !chequesIncompletos;

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
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
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
              Haga click para seleccionar un método. Mantenga Ctrl presionado para seleccionar varios.
            </Text>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
              {metodosPagoOrdenados.map(m => {
                const isSelected = selectedMetodos.includes(m.METODO_PAGO_ID);
                return (
                  <div
                    key={m.METODO_PAGO_ID}
                    onClick={(e: React.MouseEvent) => {
                      if (e.ctrlKey || e.metaKey) {
                        // Ctrl+Click: toggle individual
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
                      } else {
                        // Plain click: select only this one
                        setSelectedMetodos([m.METODO_PAGO_ID]);
                        setMontosPorMetodo({});
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
                        {m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined /> : m.CATEGORIA === 'CHEQUES' ? <BankOutlined /> : <CreditCardOutlined />}
                      </div>
                    )}
                    <Text strong style={{ fontSize: 12, lineHeight: 1.2 }}>{m.NOMBRE}</Text>
                    <Tag color={m.CATEGORIA === 'EFECTIVO' ? 'green' : m.CATEGORIA === 'CHEQUES' ? 'gold' : 'blue'} style={{ fontSize: 10, margin: 0 }}>{m.CATEGORIA}</Tag>
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

          {/* ── Datos del cheque (uno por método CHEQUES seleccionado) ── */}
          {metodosCheque.map(m => {
            const id = m.METODO_PAGO_ID;
            const c = chequesPorMetodo[id] || { BANCO: '', LIBRADOR: '', NUMERO: '' };
            const fpres: Dayjs | null = c.FECHA_PRESENTACION ? dayjs(c.FECHA_PRESENTACION) : null;
            const setField = (patch: Partial<ChequePayload>) =>
              setChequesPorMetodo(prev => ({ ...prev, [id]: { ...c, ...patch } as ChequePayload }));
            return (
              <div
                key={`chq-${id}`}
                style={{
                  marginBottom: 12,
                  padding: 12,
                  border: '1px dashed #d9d9d9',
                  borderRadius: 8,
                  background: 'rgba(234, 189, 35, 0.04)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <BankOutlined style={{ color: '#EABD23' }} />
                  <Text strong style={{ fontSize: 13 }}>Datos del cheque — {m.NOMBRE}</Text>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <BancoSelect
                    value={c.BANCO_ID ?? null}
                    onChange={(_id, banco) => setField({ BANCO_ID: _id, BANCO: banco?.NOMBRE ?? '' })}
                    placeholder="Banco *"
                  />
                  <Input
                    placeholder="N° Cheque *"
                    value={c.NUMERO}
                    inputMode="numeric"
                    maxLength={20}
                    onChange={e => {
                      const numero = e.target.value.replace(/\D/g, '');
                      const patch: Partial<ChequePayload> = { NUMERO: numero };
                      // Auto-detección por prefijo BCRA
                      if (numero.length >= 11 && bancosCache) {
                        const prefijo = numero.slice(0, 3);
                        const detectado = bancosCache.find(b => b.CODIGO_BCRA === prefijo);
                        if (detectado && detectado.BANCO_ID !== c.BANCO_ID) {
                          patch.BANCO_ID = detectado.BANCO_ID;
                          patch.BANCO = detectado.NOMBRE;
                        }
                      }
                      setField(patch);
                    }}
                  />
                  <Input
                    placeholder="Librador *"
                    value={c.LIBRADOR}
                    onChange={e => setField({ LIBRADOR: e.target.value })}
                  />
                  <Input
                    placeholder="Portador"
                    value={c.PORTADOR || ''}
                    onChange={e => setField({ PORTADOR: e.target.value })}
                  />
                  <DatePicker
                    placeholder="Fecha de presentación"
                    value={fpres}
                    style={{ width: '100%', gridColumn: 'span 2' }}
                    format="DD/MM/YYYY"
                    onChange={(d) => setField({ FECHA_PRESENTACION: d ? d.format('YYYY-MM-DD') : null })}
                  />
                </div>
              </div>
            );
          })}

          {chequesIncompletos && (
            <Text type="danger" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
              Completá los datos obligatorios del cheque (banco, librador y número).
            </Text>
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
