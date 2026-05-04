import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Modal, Form, Input, InputNumber, DatePicker, Space, Typography, App, Divider, Button, Tag, AutoComplete, Select,
} from 'antd';
import {
  WalletOutlined, CheckCircleOutlined,
  DollarOutlined, CreditCardOutlined, EnvironmentOutlined,
  BankOutlined, DeleteOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { expensesApi, type GastoServicioInput } from '../../services/expenses.api';
import { fmtMoney } from '../../utils/format';
import { useAuthStore } from '../../store/authStore';
import { ChequePicker } from '../cheques/ChequePicker';
import type { MetodoPagoItem } from '../../types';

const { Text } = Typography;

interface Props {
  open: boolean;
  gastoId: number | null; // null = new, number = edit
  onSuccess: () => void;
  onCancel: () => void;
}

export function NuevoGastoModal({ open, gastoId, onSuccess, onCancel }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = gastoId !== null;
  const { puntosVenta, puntoVentaActivo } = useAuthStore();

  // ── PV state ─────────────────────────────────────
  const [pvId, setPvId] = useState<number | undefined>(undefined);

  // ── Payment method state ────────────────────────
  const [selectedMetodos, setSelectedMetodos] = useState<number[]>([]);
  const [montosPorMetodo, setMontosPorMetodo] = useState<Record<number, number>>({});
  const [metodoModalOpen, setMetodoModalOpen] = useState(false);
  const [metodoModalSelection, setMetodoModalSelection] = useState<number[]>([]);
  // ── Cheques de cartera (egreso) ────────────────────
  const [chequesIds, setChequesIds] = useState<number[]>([]);
  const [chequesTotal, setChequesTotal] = useState(0);
  const [chequePickerOpen, setChequePickerOpen] = useState(false);
  // ── Queries ─────────────────────────────────────
  const { data: metodosPago = [] } = useQuery({
    queryKey: ['expenses-active-payment-methods'],
    queryFn: () => expensesApi.getActivePaymentMethods(),
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

  const { data: entidades = [] } = useQuery({
    queryKey: ['expenses-entidades'],
    queryFn: () => expensesApi.getEntidades(),
    enabled: open,
    staleTime: 60000,
  });

  const { data: editData } = useQuery({
    queryKey: ['expense-edit', gastoId],
    queryFn: () => expensesApi.getById(gastoId!),
    enabled: !!gastoId && open,
  });

  // Fill form when editing
  useEffect(() => {
    if (editData && open && isEdit) {
      form.setFieldsValue({
        ENTIDAD: editData.ENTIDAD,
        DESCRIPCION: editData.DESCRIPCION || '',
        CATEGORIA: editData.CATEGORIA || '',
        FECHA: dayjs(editData.FECHA),
      });
      setPvId(editData.PUNTO_VENTA_ID ?? undefined);

      if (editData.metodos_pago && editData.metodos_pago.length > 0) {
        const ids = editData.metodos_pago.map(m => m.METODO_PAGO_ID);
        const montos: Record<number, number> = {};
        for (const m of editData.metodos_pago) montos[m.METODO_PAGO_ID] = m.MONTO;
        setSelectedMetodos(ids);
        setMontosPorMetodo(montos);
      } else {
        setSelectedMetodos([]);
        setMontosPorMetodo({});
      }

      // Cheques
      if (editData.cheques_ids && editData.cheques_ids.length > 0) {
        setChequesIds(editData.cheques_ids);
        setChequesTotal(editData.CHEQUES || 0);
      } else {
        setChequesIds([]);
        setChequesTotal(0);
      }
    }
  }, [editData, open, isEdit, form]);

  // Reset form when opening for new
  useEffect(() => {
    if (open && !isEdit) {
      form.resetFields();
      form.setFieldsValue({ FECHA: dayjs() });
      setSelectedMetodos([]);
      setMontosPorMetodo({});
      setChequesIds([]);
      setChequesTotal(0);
      // Default PV: only PV if user has 1, otherwise active PV
      setPvId(
        puntosVenta.length === 1
          ? puntosVenta[0]?.PUNTO_VENTA_ID
          : puntoVentaActivo ?? undefined
      );
    }
  }, [open, isEdit, form, puntosVenta, puntoVentaActivo]);

  // ── Computed total ──────────────────────────────
  const total = useMemo(() => {
    let sum = 0;
    for (const id of selectedMetodos) sum += montosPorMetodo[id] || 0;
    return Math.round(sum * 100) / 100;
  }, [selectedMetodos, montosPorMetodo]);
  // Mantener sincronizado el monto del método CHEQUES con el total seleccionado
  // del ChequePicker (no editable manualmente).
  useEffect(() => {
    const chequeMetodo = metodosPago.find(m => m.CATEGORIA === 'CHEQUES' && selectedMetodos.includes(m.METODO_PAGO_ID));
    if (!chequeMetodo) return;
    setMontosPorMetodo(prev => {
      if ((prev[chequeMetodo.METODO_PAGO_ID] || 0) === chequesTotal) return prev;
      return { ...prev, [chequeMetodo.METODO_PAGO_ID]: chequesTotal };
    });
  }, [chequesTotal, selectedMetodos, metodosPago]);
  // ── Mutations ───────────────────────────────────
  const crearMut = useMutation({
    mutationFn: (data: GastoServicioInput) => expensesApi.crear(data),
    onSuccess: () => {
      message.success('Gasto registrado exitosamente');
      onSuccess();
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  const actualizarMut = useMutation({
    mutationFn: (data: GastoServicioInput) => expensesApi.actualizar(gastoId!, data),
    onSuccess: () => {
      message.success('Gasto modificado exitosamente');
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
      if (puntosVenta.length > 1 && !pvId) {
        message.warning('Seleccione un punto de venta');
        return;
      }

      const metodos_pago: MetodoPagoItem[] = selectedMetodos
        .filter(id => (montosPorMetodo[id] || 0) > 0)
        .map(id => ({ METODO_PAGO_ID: id, MONTO: montosPorMetodo[id] || 0 }));

      // Validar que si hay método CHEQUES, haya cheques seleccionados
      const tieneMetodoCheques = selectedMetodos.some(id => {
        const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
        return m?.CATEGORIA === 'CHEQUES' && (montosPorMetodo[id] || 0) > 0;
      });
      if (tieneMetodoCheques && chequesIds.length === 0) {
        message.warning('Seleccione cheques de cartera para el método CHEQUES');
        return;
      }

      const payload: GastoServicioInput = {
        ENTIDAD: (values.ENTIDAD || '').trim(),
        DESCRIPCION: (values.DESCRIPCION || '').trim() || undefined,
        CATEGORIA: (values.CATEGORIA || '').trim() || undefined,
        FECHA: values.FECHA.toISOString(),
        puntoVentaId: pvId,
        metodos_pago,
        cheques_ids: chequesIds.length > 0 ? chequesIds : undefined,
      };

      if (isEdit) actualizarMut.mutate(payload);
      else crearMut.mutate(payload);
    } catch {
      // form validation error
    }
  };

  const entidadOptions = useMemo(
    () => entidades.map(e => ({ value: e })),
    [entidades],
  );

  return (
    <>
      <Modal
        title={isEdit ? '✏️ Modificar Gasto' : '💸 Nuevo Gasto / Servicio'}
        open={open}
        onOk={handleOk}
        onCancel={onCancel}
        okText={isEdit ? 'Guardar cambios' : 'Registrar gasto'}
        cancelText="Cancelar"
        confirmLoading={saving}
        width={540}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        <Form form={form} layout="vertical" size="middle" initialValues={{ FECHA: dayjs() }}>
          <Form.Item
            name="ENTIDAD"
            label="Entidad / Proveedor"
            rules={[{ required: true, message: 'Ingrese la entidad / proveedor' }]}
          >
            <AutoComplete
              options={entidadOptions}
              placeholder="Ej: EDESUR, Aysa, Liquidación de sueldos..."
              filterOption={(input, option) =>
                ((option?.value as string) || '').toLowerCase().includes(input.toLowerCase())
              }
              maxLength={100}
            />
          </Form.Item>

          <Form.Item name="CATEGORIA" label="Categoría">
            <Input placeholder="Ej: Servicios, Sueldos, Impuestos..." maxLength={50} />
          </Form.Item>

          <Form.Item name="DESCRIPCION" label="Descripción">
            <Input.TextArea
              placeholder="Detalle del gasto (opcional)"
              maxLength={250}
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </Form.Item>

          <Form.Item
            name="FECHA"
            label="Fecha"
            rules={[{ required: true, message: 'Ingrese la fecha' }]}
          >
            <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>

          {puntosVenta.length > 1 && (
            <Form.Item label="Punto de Venta" required>
              <Select
                value={pvId}
                onChange={setPvId}
                placeholder="Seleccione un punto de venta"
                suffixIcon={<EnvironmentOutlined />}
                options={puntosVenta.map(pv => ({
                  label: pv.NOMBRE,
                  value: pv.PUNTO_VENTA_ID,
                }))}
              />
            </Form.Item>
          )}

          <Divider style={{ margin: '8px 0' }}>Formas de pago</Divider>

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
              background: '#f5f5f5', borderRadius: 8, padding: '12px 16px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4,
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
                  for (const id of metodoModalSelection) next[id] = prev[id] || 0;
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
                      isSelected ? prev.filter(id => id !== m.METODO_PAGO_ID) : [...prev, m.METODO_PAGO_ID],
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
