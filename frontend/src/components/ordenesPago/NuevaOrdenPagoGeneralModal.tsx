import { useEffect, useMemo, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Modal, Form, Input, InputNumber, DatePicker, Space, Typography, App, Divider, Segmented, Button, Tag, Select,
} from 'antd';
import {
  BankOutlined, InboxOutlined, WalletOutlined, CheckCircleOutlined,
  DollarOutlined, CreditCardOutlined, ShopOutlined, DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  ordenesPagoApi,
  type OrdenPagoGeneralInput,
  type ProveedorCtaCorriente,
} from '../../services/ordenesPago.api';
import { cajaApi } from '../../services/caja.api';
import { fmtMoney } from '../../utils/format';
import { printOrdenPago } from '../../utils/printOrdenPago';
import { useAuthStore } from '../../store/authStore';
import { ChequePicker } from '../cheques/ChequePicker';
import type { MetodoPagoItem } from '../../types';

const { Text } = Typography;

interface Props {
  open: boolean;
  pagoId: number | null; // null = new, number = edit
  /** When editing, pre-fill these */
  editProveedorId?: number;
  editCtaCorrienteId?: number;
  editProveedorNombre?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function NuevaOrdenPagoGeneralModal({
  open, pagoId, editProveedorId, editCtaCorrienteId, editProveedorNombre,
  onSuccess, onCancel,
}: Props) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const isEdit = pagoId !== null;
  const puntoVentaActivo = useAuthStore(s => s.puntoVentaActivo);
  const [destinoPago, setDestinoPago] = useState<'CAJA_CENTRAL' | 'CAJA'>('CAJA_CENTRAL');

  // ── Supplier selection state ────────────────────
  const [selectedProveedor, setSelectedProveedor] = useState<ProveedorCtaCorriente | null>(null);
  const [proveedorSearch, setProveedorSearch] = useState('');

  // ── Payment method state ────────────────────────
  const [selectedMetodos, setSelectedMetodos] = useState<number[]>([]);
  const [montosPorMetodo, setMontosPorMetodo] = useState<Record<number, number>>({});
  const [metodoModalOpen, setMetodoModalOpen] = useState(false);
  const [metodoModalSelection, setMetodoModalSelection] = useState<number[]>([]);
  const [chequesIds, setChequesIds] = useState<number[]>([]);
  const [chequesTotal, setChequesTotal] = useState(0);
  const [chequePickerOpen, setChequePickerOpen] = useState(false);

  // ── Queries ─────────────────────────────────────

  // Fetch suppliers with cta corriente
  const { data: proveedores = [], isFetching: proveedoresFetching } = useQuery({
    queryKey: ['ordenes-pago-proveedores', proveedorSearch],
    queryFn: () => ordenesPagoApi.getProveedores(proveedorSearch || undefined),
    enabled: open && !isEdit,
    staleTime: 30000,
  });

  // Check if user has an open cash register
  const { data: miCaja } = useQuery({
    queryKey: ['mi-caja'],
    queryFn: () => cajaApi.getMiCaja(),
    enabled: open,
    staleTime: 30000,
  });

  // Active payment methods
  const { data: metodosPago = [] } = useQuery({
    queryKey: ['op-gen-active-payment-methods'],
    queryFn: () => ordenesPagoApi.getActivePaymentMethods(),
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

  // Load existing data for edit
  const { data: editData } = useQuery({
    queryKey: ['orden-pago-edit', pagoId],
    queryFn: () => ordenesPagoApi.getOrdenPagoById(pagoId!),
    enabled: !!pagoId && open,
  });

  // Fill form when editing
  useEffect(() => {
    if (editData && open && isEdit) {
      let concepto = editData.CONCEPTO || '';
      const match = concepto.match(/^OP #\d+\s*-?\s*(.*)/);
      if (match) concepto = match[1] || '';

      form.setFieldsValue({
        CONCEPTO: concepto,
        FECHA: dayjs(editData.FECHA),
      });

      // Set the supplier info from edit props
      if (editProveedorId && editCtaCorrienteId) {
        setSelectedProveedor({
          PROVEEDOR_ID: editProveedorId,
          CTA_CORRIENTE_ID: editCtaCorrienteId,
          NOMBRE: editProveedorNombre || '',
          CODIGOPARTICULAR: '',
          NUMERO_DOC: '',
          SALDO_ACTUAL: 0,
        });
      }

      // Restore metodos_pago
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

      if (editData.cheques_ids && editData.cheques_ids.length > 0) {
        setChequesIds(editData.cheques_ids);
        setChequesTotal(editData.CHEQUES || 0);
      } else {
        setChequesIds([]);
        setChequesTotal(0);
      }
    }
  }, [editData, open, isEdit, form, editProveedorId, editCtaCorrienteId, editProveedorNombre]);

  // Reset form when opening for new
  useEffect(() => {
    if (open && !isEdit) {
      form.resetFields();
      form.setFieldsValue({ FECHA: dayjs() });
      setDestinoPago('CAJA_CENTRAL');
      setSelectedMetodos([]);
      setMontosPorMetodo({});
      setChequesIds([]);
      setChequesTotal(0);
      setSelectedProveedor(null);
      setProveedorSearch('');
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

  useEffect(() => {
    const chequeMetodo = metodosPago.find(m => m.CATEGORIA === 'CHEQUES' && selectedMetodos.includes(m.METODO_PAGO_ID));
    if (!chequeMetodo) {
      if (chequesIds.length > 0 || chequesTotal > 0) {
        setChequesIds([]);
        setChequesTotal(0);
      }
      return;
    }
    setMontosPorMetodo(prev => {
      if ((prev[chequeMetodo.METODO_PAGO_ID] || 0) === chequesTotal) return prev;
      return { ...prev, [chequeMetodo.METODO_PAGO_ID]: chequesTotal };
    });
  }, [chequesTotal, chequesIds.length, selectedMetodos, metodosPago]);

  // ── Mutations ───────────────────────────────────
  const crearMut = useMutation({
    mutationFn: (data: OrdenPagoGeneralInput & { ctaId: number }) =>
      ordenesPagoApi.crearOrdenPago(data.ctaId, data),
    onSuccess: (result) => {
      message.success('Orden de pago registrada exitosamente');
      if (chequesIds.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['cheques'] });
        queryClient.invalidateQueries({ queryKey: ['cheques-resumen'] });
        queryClient.invalidateQueries({ queryKey: ['cheques-cartera'] });
      }
      onSuccess();
      Modal.confirm({
        title: '¿Desea imprimir la orden de pago?',
        content: 'Se generará un comprobante para esta orden de pago.',
        okText: 'Imprimir',
        cancelText: 'No',
        onOk: async () => {
          try {
            const data = await ordenesPagoApi.getReciboData(result.PAGO_ID);
            await printOrdenPago(data);
          } catch {
            message.error('No se pudo generar la orden de pago');
          }
        },
      });
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  const actualizarMut = useMutation({
    mutationFn: (data: OrdenPagoGeneralInput & { ctaId: number }) =>
      ordenesPagoApi.actualizarOrdenPago(data.ctaId, pagoId!, data),
    onSuccess: () => {
      message.success('Orden de pago modificada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['cheques'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-resumen'] });
      queryClient.invalidateQueries({ queryKey: ['cheques-cartera'] });
      onSuccess();
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  const saving = crearMut.isPending || actualizarMut.isPending;

  // ── Supplier search handler ──────────────────────
  const handleProveedorSearch = useCallback((value: string) => {
    setProveedorSearch(value);
  }, []);

  // ── Submit ──────────────────────────────────────
  const handleOk = async () => {
    try {
      const values = await form.validateFields();

      if (!selectedProveedor) {
        message.warning('Seleccione un proveedor');
        return;
      }

      if (selectedMetodos.length === 0) {
        message.warning('Seleccione al menos un método de pago');
        return;
      }

      if (total <= 0) {
        message.warning('El total debe ser mayor a cero');
        return;
      }

      // Build metodos_pago array
      const metodosPagoInput: MetodoPagoItem[] = selectedMetodos
        .filter(id => (montosPorMetodo[id] || 0) > 0)
        .map(id => ({ METODO_PAGO_ID: id, MONTO: montosPorMetodo[id] || 0 }));

      const tieneMetodoCheques = selectedMetodos.some(id => {
        const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
        return m?.CATEGORIA === 'CHEQUES' && (montosPorMetodo[id] || 0) > 0;
      });
      if (tieneMetodoCheques && chequesIds.length === 0) {
        message.warning('Seleccione cheques de cartera para el método CHEQUES');
        return;
      }

      // Derive category totals
      let efectivoFinal = 0;
      let digitalFinal = 0;
      let chequesFinal = 0;
      for (const mp of metodosPagoInput) {
        const m = metodosPago.find(x => x.METODO_PAGO_ID === mp.METODO_PAGO_ID);
        if (m?.CATEGORIA === 'EFECTIVO') efectivoFinal += mp.MONTO;
        else if (m?.CATEGORIA === 'CHEQUES') chequesFinal += mp.MONTO;
        else digitalFinal += mp.MONTO;
      }

      const payload: OrdenPagoGeneralInput & { ctaId: number } = {
        ctaId: selectedProveedor.CTA_CORRIENTE_ID,
        proveedorId: selectedProveedor.PROVEEDOR_ID,
        FECHA: values.FECHA.toISOString(),
        EFECTIVO: efectivoFinal,
        DIGITAL: digitalFinal,
        CHEQUES: chequesFinal,
        CONCEPTO: values.CONCEPTO || '',
        DESTINO_PAGO: destinoPago,
        PUNTO_VENTA_ID: puntoVentaActivo,
        metodos_pago: metodosPagoInput.length > 0 ? metodosPagoInput : undefined,
        cheques_ids: chequesIds.length > 0 ? chequesIds : undefined,
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

  // ── Supplier select options ──────────────────────
  const proveedorOptions = useMemo(() => {
    return proveedores.map(p => ({
      value: p.PROVEEDOR_ID,
      label: (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{p.NOMBRE}</span>
          <span style={{
            fontSize: 12,
            color: p.SALDO_ACTUAL > 0 ? '#cf1322' : p.SALDO_ACTUAL < 0 ? '#3f8600' : '#999',
            fontWeight: 600,
          }}>
            {fmtMoney(p.SALDO_ACTUAL)}
          </span>
        </div>
      ),
      searchText: `${p.NOMBRE} ${p.CODIGOPARTICULAR} ${p.NUMERO_DOC}`,
      record: p,
    }));
  }, [proveedores]);

  return (
    <>
      <Modal
        title={isEdit ? '✏️ Modificar Orden de Pago' : '💰 Nueva Orden de Pago'}
        open={open}
        onOk={handleOk}
        onCancel={onCancel}
        okText={isEdit ? 'Guardar cambios' : 'Registrar orden de pago'}
        cancelText="Cancelar"
        confirmLoading={saving}
        width={540}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        {/* Supplier selector */}
        {isEdit ? (
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            Proveedor: <Text strong>{editProveedorNombre || selectedProveedor?.NOMBRE}</Text>
          </Text>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>Proveedor</Text>
            <Select
              showSearch
              placeholder="Buscar proveedor por nombre, código o documento..."
              style={{ width: '100%' }}
              size="large"
              value={selectedProveedor?.PROVEEDOR_ID}
              onSearch={handleProveedorSearch}
              onChange={(value) => {
                const p = proveedores.find(x => x.PROVEEDOR_ID === value);
                setSelectedProveedor(p || null);
              }}
              filterOption={(input, option) =>
                (option?.searchText as string || '').toLowerCase().includes(input.toLowerCase())
              }
              loading={proveedoresFetching}
              options={proveedorOptions}
              notFoundContent={proveedoresFetching ? 'Buscando...' : 'Sin resultados'}
              suffixIcon={<ShopOutlined />}
            />
            {selectedProveedor && (
              <div style={{
                marginTop: 8, padding: '8px 12px', background: 'rgba(234, 189, 35, 0.08)',
                borderRadius: 8, border: '1px solid rgba(234, 189, 35, 0.3)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <Text strong>{selectedProveedor.NOMBRE}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {selectedProveedor.CODIGOPARTICULAR && `Cód: ${selectedProveedor.CODIGOPARTICULAR}`}
                    {selectedProveedor.NUMERO_DOC && ` | Doc: ${selectedProveedor.NUMERO_DOC}`}
                  </Text>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Saldo</Text>
                  <Text strong style={{
                    fontSize: 15,
                    color: selectedProveedor.SALDO_ACTUAL > 0 ? '#cf1322'
                      : selectedProveedor.SALDO_ACTUAL < 0 ? '#3f8600' : undefined,
                  }}>
                    {fmtMoney(selectedProveedor.SALDO_ACTUAL)}
                  </Text>
                </div>
              </div>
            )}
          </div>
        )}

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
            <Input placeholder="Descripción del pago" maxLength={200} />
          </Form.Item>

          <Divider style={{ margin: '8px 0' }}>Formas de pago</Divider>

          {/* Payment destination selector */}
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>Origen del pago</Text>
            <Segmented
              value={destinoPago}
              onChange={val => setDestinoPago(val as 'CAJA_CENTRAL' | 'CAJA')}
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
                <Text type="secondary" style={{ fontSize: 12 }}>No tenés una caja abierta — el egreso se registra en Caja Central</Text>
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
                        m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined /> : m.CATEGORIA === 'CHEQUES' ? <BankOutlined /> : <CreditCardOutlined />
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
                if (m.CATEGORIA === 'CHEQUES') {
                  return (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 130 }}>
                        <BankOutlined style={{ color: '#722ed1' }} />
                        <Text style={{ fontSize: 13 }}>{m.NOMBRE}</Text>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1 }}>
                        <Button
                          icon={<BankOutlined />}
                          onClick={() => setChequePickerOpen(true)}
                          style={{ flex: 1 }}
                        >
                          {chequesIds.length > 0
                            ? `${chequesIds.length} cheque${chequesIds.length === 1 ? '' : 's'} — ${fmtMoney(chequesTotal)}`
                            : 'Seleccionar cheques de cartera'}
                        </Button>
                        {chequesIds.length > 0 && (
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => { setChequesIds([]); setChequesTotal(0); }}
                          />
                        )}
                      </div>
                    </div>
                  );
                }
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
            <Text strong style={{ fontSize: 18, color: total > 0 ? '#cf1322' : '#999' }}>
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
                    color={m.CATEGORIA === 'EFECTIVO' ? 'green' : m.CATEGORIA === 'CHEQUES' ? 'orange' : 'blue'}
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

      <ChequePicker
        open={chequePickerOpen}
        onClose={() => setChequePickerOpen(false)}
        initialSelectedIds={chequesIds}
        title="Seleccionar cheques de cartera"
        onConfirm={(ids, t) => {
          setChequesIds(ids);
          setChequesTotal(t);
          setChequePickerOpen(false);
        }}
      />
    </>
  );
}
