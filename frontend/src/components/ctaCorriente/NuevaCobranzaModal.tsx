import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Modal, Form, Input, InputNumber, DatePicker, Space, Typography, App, Divider, Segmented, Button, Tag,
} from 'antd';
import {
  BankOutlined, InboxOutlined, WalletOutlined, CheckCircleOutlined,
  DollarOutlined, CreditCardOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { ctaCorrienteApi, type CobranzaInput } from '../../services/ctaCorriente.api';
import { cobranzasApi } from '../../services/cobranzas.api';
import { cajaApi } from '../../services/caja.api';
import { bancosApi } from '../../services/bancos.api';
import BancoSelect from '../cheques/BancoSelect';
import { fmtMoney } from '../../utils/format';
import { printReciboCobranza } from '../../utils/printReciboCobranza';
import { useAuthStore } from '../../store/authStore';
import type { MetodoPagoItem, ChequePayload } from '../../types';

const { Text } = Typography;

interface Props {
  open: boolean;
  ctaCorrienteId: number;
  clienteId: number;
  clienteNombre: string;
  pagoId: number | null; // null = new, number = edit
  onSuccess: () => void;
  onCancel: () => void;
}

export function NuevaCobranzaModal({
  open, ctaCorrienteId, clienteId, clienteNombre, pagoId, onSuccess, onCancel,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = pagoId !== null;
  const puntoVentaActivo = useAuthStore(s => s.puntoVentaActivo);
  const [destinoCobro, setDestinoCobro] = useState<'CAJA_CENTRAL' | 'CAJA'>('CAJA_CENTRAL');

  // Check if user has an open cash register
  const { data: miCaja } = useQuery({
    queryKey: ['mi-caja'],
    queryFn: () => cajaApi.getMiCaja(),
    enabled: open,
    staleTime: 30000,
  });
  // ── Payment method state ────────────────────────
  const [selectedMetodos, setSelectedMetodos] = useState<number[]>([]);
  const [montosPorMetodo, setMontosPorMetodo] = useState<Record<number, number>>({});
  const [chequesPorMetodo, setChequesPorMetodo] = useState<Record<number, ChequePayload>>({});
  const [metodoModalOpen, setMetodoModalOpen] = useState(false);
  const [metodoModalSelection, setMetodoModalSelection] = useState<number[]>([]);
  const queryClient = useQueryClient();

  // Cache de bancos para auto-detección por prefijo BCRA
  const { data: bancosCache } = useQuery({
    queryKey: ['bancos', 'activos'],
    queryFn: () => bancosApi.getAll({ activo: true }),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  // ── Active payment methods ──────────────────────
  const { data: metodosPago = [] } = useQuery({
    queryKey: ['co-active-payment-methods'],
    queryFn: () => ctaCorrienteApi.getActivePaymentMethods(),
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

  // ── Load existing data for edit ─────────────────
  const { data: editData } = useQuery({
    queryKey: ['cobranza-edit', pagoId],
    queryFn: () => ctaCorrienteApi.getCobranzaById(pagoId!),
    enabled: !!pagoId && open,
  });

  // Fill form when editing
  useEffect(() => {
    if (editData && open && isEdit) {
      let concepto = editData.CONCEPTO || '';
      const match = concepto.match(/^CO #\d+\s*-?\s*(.*)/);
      if (match) concepto = match[1] || '';

      form.setFieldsValue({
        CONCEPTO: concepto,
        FECHA: dayjs(editData.FECHA),
      });

      // Restore metodos_pago if available
      if (editData.metodos_pago && editData.metodos_pago.length > 0) {
        const ids = editData.metodos_pago.map(m => m.METODO_PAGO_ID);
        const montos: Record<number, number> = {};
        for (const m of editData.metodos_pago) {
          montos[m.METODO_PAGO_ID] = m.MONTO;
        }
        setSelectedMetodos(ids);
        setMontosPorMetodo(montos);
      } else {
        setSelectedMetodos([]);
        setMontosPorMetodo({});
      }
    }
  }, [editData, open, isEdit, form]);

  // Reset form when opening for new
  useEffect(() => {
    if (open && !isEdit) {
      form.resetFields();
      form.setFieldsValue({ FECHA: dayjs() });
      setDestinoCobro('CAJA_CENTRAL');
      setSelectedMetodos([]);
      setMontosPorMetodo({});
      setChequesPorMetodo({});
    }
  }, [open, isEdit, form]);

  // ── Computed total ──────────────────────────────
  const total = useMemo(() => {
    let sum = 0;
    for (const id of selectedMetodos) {
      sum += montosPorMetodo[id] || 0;
    }
    return Math.round(sum * 100) / 100;
  }, [selectedMetodos, montosPorMetodo]);
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
  // ── Mutations ───────────────────────────────────
  const crearMut = useMutation({
    mutationFn: (data: CobranzaInput) => ctaCorrienteApi.crearCobranza(ctaCorrienteId, data),
    onSuccess: (result) => {
      message.success('Cobranza registrada exitosamente');
      if (metodosCheque.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['cheques'] });
        queryClient.invalidateQueries({ queryKey: ['cheques-resumen'] });
        queryClient.invalidateQueries({ queryKey: ['cheques-cartera'] });
      }
      onSuccess();
      Modal.confirm({
        title: '¿Desea imprimir el recibo?',
        content: 'Se generará un recibo para esta cobranza.',
        okText: 'Imprimir',
        cancelText: 'No',
        onOk: async () => {
          try {
            const data = await cobranzasApi.getReciboData(result.PAGO_ID);
            await printReciboCobranza(data);
          } catch {
            message.error('No se pudo generar el recibo');
          }
        },
      });
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  const actualizarMut = useMutation({
    mutationFn: (data: CobranzaInput) => ctaCorrienteApi.actualizarCobranza(ctaCorrienteId, pagoId!, data),
    onSuccess: () => {
      message.success('Cobranza modificada exitosamente');
      if (metodosCheque.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['cheques'] });
        queryClient.invalidateQueries({ queryKey: ['cheques-resumen'] });
        queryClient.invalidateQueries({ queryKey: ['cheques-cartera'] });
      }
      onSuccess();
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  const saving = crearMut.isPending || actualizarMut.isPending;

  // ── Submit ──────────────────────────────────────
  const handleOk = async () => {
    try {
      const values = await form.validateFields();

      if (selectedMetodos.length === 0) {
        message.warning('Seleccione al menos un método de pago');
        return;
      }

      if (total <= 0) {
        message.warning('El total debe ser mayor a cero');
        return;
      }

      if (chequesIncompletos) {
        message.warning('Completá los datos obligatorios del cheque (banco, librador y número)');
        return;
      }

      // Build metodos_pago array (incluye cheque payload por método CHEQUES)
      const metodosPagoInput: MetodoPagoItem[] = selectedMetodos
        .filter(id => (montosPorMetodo[id] || 0) > 0)
        .map(id => {
          const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
          const item: MetodoPagoItem = { METODO_PAGO_ID: id, MONTO: montosPorMetodo[id] || 0 };
          if (m?.CATEGORIA === 'CHEQUES') {
            const c = chequesPorMetodo[id];
            if (c) item.cheque = c;
          }
          return item;
        });

      // Derive category totals for backward compat
      let efectivoFinal = 0;
      let digitalFinal = 0;
      let chequesFinal = 0;
      for (const mp of metodosPagoInput) {
        const m = metodosPago.find(x => x.METODO_PAGO_ID === mp.METODO_PAGO_ID);
        if (m?.CATEGORIA === 'EFECTIVO') efectivoFinal += mp.MONTO;
        else if (m?.CATEGORIA === 'CHEQUES') chequesFinal += mp.MONTO;
        else digitalFinal += mp.MONTO;
      }

      const payload: CobranzaInput = {
        clienteId,
        FECHA: values.FECHA.toISOString(),
        EFECTIVO: efectivoFinal,
        DIGITAL: digitalFinal,
        CHEQUES: chequesFinal,
        CONCEPTO: values.CONCEPTO || '',
        DESTINO_COBRO: destinoCobro,
        PUNTO_VENTA_ID: puntoVentaActivo,
        metodos_pago: metodosPagoInput.length > 0 ? metodosPagoInput : undefined,
      };

      if (isEdit) {
        actualizarMut.mutate(payload);
      } else {
        crearMut.mutate(payload);
      }
    } catch {
      // validation error
    }
  };

  return (
    <>
      <Modal
        title={isEdit ? '✏️ Modificar Cobranza' : '💰 Nueva Cobranza'}
        open={open}
        onOk={handleOk}
        onCancel={onCancel}
        okText={isEdit ? 'Guardar cambios' : 'Registrar cobranza'}
        cancelText="Cancelar"
        confirmLoading={saving}
        width={520}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          Cliente: <Text strong>{clienteNombre}</Text>
        </Text>

        <Form
          form={form}
          layout="vertical"
          size="middle"
          initialValues={{ FECHA: dayjs() }}
        >
          <Form.Item
            name="FECHA"
            label="Fecha"
            rules={[{ required: true, message: 'Ingrese la fecha' }]}
          >
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            name="CONCEPTO"
            label="Concepto"
            rules={[{ required: true, message: 'Ingrese un concepto' }]}
          >
            <Input placeholder="Descripción del cobro" maxLength={200} />
          </Form.Item>

          <Divider style={{ margin: '8px 0' }}>Formas de pago</Divider>

          {/* Payment destination selector */}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>Destino del cobro</Text>
            <Segmented
              value={destinoCobro}
              onChange={val => setDestinoCobro(val as 'CAJA_CENTRAL' | 'CAJA')}
              options={[
                {
                  value: 'CAJA_CENTRAL',
                  label: (
                    <Space>
                      <BankOutlined />
                      <span>Caja Central</span>
                    </Space>
                  ),
                },
                ...(miCaja ? [{
                  value: 'CAJA' as const,
                  label: (
                    <Space>
                      <InboxOutlined />
                      <span>Mi Caja</span>
                    </Space>
                  ),
                }] : []),
              ]}
            />
            {!miCaja && (
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>No tenés una caja abierta — el ingreso se registra en Caja Central</Text>
              </div>
            )}
          </div>

          {/* Selected methods display + "Seleccionar" button */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text type="secondary">Métodos de pago</Text>
              <Button type="link" size="small" onClick={() => {
                setMetodoModalSelection([...selectedMetodos]);
                setMetodoModalOpen(true);
              }}>
                {selectedMetodos.length > 0 ? 'Cambiar' : 'Seleccionar'}
              </Button>
            </div>
            {selectedMetodos.length === 0 ? (
              <div
                style={{
                  border: '1px dashed #d9d9d9', borderRadius: 8, padding: '20px 16px',
                  textAlign: 'center', cursor: 'pointer',
                }}
                onClick={() => {
                  setMetodoModalSelection([...selectedMetodos]);
                  setMetodoModalOpen(true);
                }}
              >
                <WalletOutlined style={{ fontSize: 24, color: '#999', display: 'block', marginBottom: 6 }} />
                <Text type="secondary">Seleccione métodos de pago</Text>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {selectedMetodos.map(id => {
                  const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                  if (!m) return null;
                  return (
                    <Tag key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: 13 }}>
                      {m.IMAGEN_BASE64 ? (
                        <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 2 }} />
                      ) : (
                        m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined /> : <CreditCardOutlined />
                      )}
                      {m.NOMBRE}
                    </Tag>
                  );
                })}
              </div>
            )}
          </div>

          {/* Amount inputs per selected method */}
          {selectedMetodos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {selectedMetodos.map(id => {
                const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                if (!m) return null;
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 130 }}>
                      {m.IMAGEN_BASE64 ? (
                        <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 3 }} />
                      ) : (
                        m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined style={{ color: '#52c41a' }} /> : <CreditCardOutlined style={{ color: '#1890ff' }} />
                      )}
                      <Text style={{ fontSize: 13 }}>{m.NOMBRE}</Text>
                    </div>
                    <InputNumber
                      min={0}
                      step={100}
                      precision={2}
                      prefix="$"
                      style={{ flex: 1 }}
                      controls={false}
                      value={montosPorMetodo[id] || 0}
                      onChange={val => setMontosPorMetodo(prev => ({ ...prev, [id]: val || 0 }))}
                    />
                  </div>
                );
              })}
            </div>
          )}

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
                  marginBottom: 12, padding: 12,
                  border: '1px dashed #d9d9d9', borderRadius: 8,
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

          <div
            style={{
              background: '#f5f5f5',
              borderRadius: 8,
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 4,
            }}
          >
            <Text strong style={{ fontSize: 15 }}>Total:</Text>
            <Text strong style={{ fontSize: 18, color: total > 0 ? '#3f8600' : '#999' }}>
              {fmtMoney(total)}
            </Text>
          </div>
        </Form>
      </Modal>

      {/* Payment method selection modal */}
      <Modal
        open={metodoModalOpen}
        onCancel={() => setMetodoModalOpen(false)}
        centered
        width={520}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
        title={
          <Space>
            <WalletOutlined style={{ color: '#EABD23', fontSize: 20 }} />
            <span>Seleccionar método de pago</span>
          </Space>
        }
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => setMetodoModalOpen(false)}>Cancelar</Button>
            <Button
              type="primary"
              className="btn-gold"
              disabled={metodoModalSelection.length === 0}
              onClick={() => {
                setSelectedMetodos(metodoModalSelection);
                setMontosPorMetodo(prev => {
                  const next: Record<number, number> = {};
                  for (const id of metodoModalSelection) {
                    next[id] = prev[id] || 0;
                  }
                  return next;
                });
                setMetodoModalOpen(false);
              }}
              icon={<CheckCircleOutlined />}
            >
              Confirmar ({metodoModalSelection.length})
            </Button>
          </div>
        }
      >
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 12, display: 'block' }}>
            Seleccione uno o más métodos. Si elige varios, podrá distribuir los montos.
          </Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
            {metodosPagoOrdenados.map(m => {
              const isSelected = metodoModalSelection.includes(m.METODO_PAGO_ID);
              return (
                <div
                  key={m.METODO_PAGO_ID}
                  onClick={() => {
                    setMetodoModalSelection(prev =>
                      isSelected
                        ? prev.filter(id => id !== m.METODO_PAGO_ID)
                        : [...prev, m.METODO_PAGO_ID]
                    );
                  }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: '16px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                    border: isSelected ? '2px solid #EABD23' : '1px solid #d9d9d9',
                    background: isSelected ? 'rgba(234, 189, 35, 0.08)' : 'transparent',
                    transition: 'all 0.15s', position: 'relative',
                  }}
                >
                  {m.IMAGEN_BASE64 ? (
                    <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 6 }} />
                  ) : (
                    <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: isSelected ? '#EABD23' : '#999' }}>
                      {m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined /> : <CreditCardOutlined />}
                    </div>
                  )}
                  <Text strong style={{ fontSize: 13, lineHeight: 1.2 }}>{m.NOMBRE}</Text>
                  <Tag
                    color={m.CATEGORIA === 'EFECTIVO' ? 'green' : 'blue'}
                    style={{ fontSize: 10, margin: 0 }}
                  >
                    {m.CATEGORIA}
                  </Tag>
                  {isSelected && (
                    <CheckCircleOutlined style={{ color: '#EABD23', fontSize: 16, position: 'absolute', top: 6, right: 6 }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}
