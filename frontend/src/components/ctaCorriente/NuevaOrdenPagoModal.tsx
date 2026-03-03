import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Modal, Form, Input, InputNumber, DatePicker, Space, Typography, App, Divider, Segmented,
} from 'antd';
import { BankOutlined, InboxOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { ctaCorrienteProvApi, type OrdenPagoInput } from '../../services/ctaCorrienteProv.api';
import { cajaApi } from '../../services/caja.api';
import { fmtMoney } from '../../utils/format';

const { Text } = Typography;

interface Props {
  open: boolean;
  ctaCorrienteId: number;
  proveedorId: number;
  proveedorNombre: string;
  pagoId: number | null; // null = new, number = edit
  onSuccess: () => void;
  onCancel: () => void;
}

export function NuevaOrdenPagoModal({
  open, ctaCorrienteId, proveedorId, proveedorNombre, pagoId, onSuccess, onCancel,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isEdit = pagoId !== null;  const [destinoPago, setDestinoPago] = useState<'CAJA_CENTRAL' | 'CAJA'>('CAJA_CENTRAL');

  // Check if user has an open cash register
  const { data: miCaja } = useQuery({
    queryKey: ['mi-caja'],
    queryFn: () => cajaApi.getMiCaja(),
    enabled: open,
    staleTime: 30000,
  });
  // ── Load existing data for edit ─────────────────
  const { data: editData } = useQuery({
    queryKey: ['orden-pago-edit', pagoId],
    queryFn: () => ctaCorrienteProvApi.getOrdenPagoById(pagoId!),
    enabled: !!pagoId && open,
  });

  // Fill form when editing
  useEffect(() => {
    if (editData && open && isEdit) {
      // Extract just the description part from "OP #123 - Description"
      let concepto = editData.CONCEPTO || '';
      const match = concepto.match(/^OP #\d+\s*-?\s*(.*)/);
      if (match) concepto = match[1] || '';

      form.setFieldsValue({
        CONCEPTO: concepto,
        EFECTIVO: editData.EFECTIVO || 0,
        DIGITAL: editData.DIGITAL || 0,
        CHEQUES: editData.CHEQUES || 0,
        FECHA: dayjs(editData.FECHA),
      });
    }
  }, [editData, open, isEdit, form]);

  // Reset form when opening for new
  useEffect(() => {
    if (open && !isEdit) {
      form.resetFields();
      form.setFieldsValue({
        EFECTIVO: 0,
        DIGITAL: 0,
        CHEQUES: 0,
        FECHA: dayjs(),
      });
      setDestinoPago('CAJA_CENTRAL');
    }
  }, [open, isEdit, form]);

  // ── Computed total ──────────────────────────────
  const efectivo = Form.useWatch('EFECTIVO', form) || 0;
  const digital = Form.useWatch('DIGITAL', form) || 0;
  const cheques = Form.useWatch('CHEQUES', form) || 0;
  const total = useMemo(() => efectivo + digital + cheques, [efectivo, digital, cheques]);

  // ── Mutations ───────────────────────────────────
  const crearMut = useMutation({
    mutationFn: (data: OrdenPagoInput) => ctaCorrienteProvApi.crearOrdenPago(ctaCorrienteId, data),
    onSuccess: () => {
      message.success('Orden de pago registrada exitosamente');
      onSuccess();
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  const actualizarMut = useMutation({
    mutationFn: (data: OrdenPagoInput) => ctaCorrienteProvApi.actualizarOrdenPago(ctaCorrienteId, pagoId!, data),
    onSuccess: () => {
      message.success('Orden de pago modificada exitosamente');
      onSuccess();
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  const saving = crearMut.isPending || actualizarMut.isPending;

  // ── Submit ──────────────────────────────────────
  const handleOk = async () => {
    try {
      const values = await form.validateFields();

      const ef = values.EFECTIVO || 0;
      const dig = values.DIGITAL || 0;
      const ch = values.CHEQUES || 0;

      if (ef < 0 || dig < 0 || ch < 0) {
        message.warning('No se permiten montos negativos');
        return;
      }

      const t = ef + dig + ch;
      if (t <= 0) {
        message.warning('El total debe ser mayor a cero');
        return;
      }

      const payload: OrdenPagoInput = {
        proveedorId,
        FECHA: values.FECHA.toISOString(),
        EFECTIVO: ef,
        DIGITAL: dig,
        CHEQUES: ch,
        CONCEPTO: values.CONCEPTO || '',
        DESTINO_PAGO: destinoPago,
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
    <Modal
      title={isEdit ? '✏️ Modificar Orden de Pago' : '💰 Nueva Orden de Pago'}
      open={open}
      onOk={handleOk}
      onCancel={onCancel}
      okText={isEdit ? 'Guardar cambios' : 'Registrar orden de pago'}
      cancelText="Cancelar"
      confirmLoading={saving}
      width={480}
      destroyOnClose
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Proveedor: <Text strong>{proveedorNombre}</Text>
      </Text>

      <Form
        form={form}
        layout="vertical"
        size="middle"
        initialValues={{
          EFECTIVO: 0,
          DIGITAL: 0,
          CHEQUES: 0,
          FECHA: dayjs(),
        }}
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
                value: 'CAJA',
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

        <Space size={12} style={{ width: '100%' }} wrap>
          <Form.Item name="EFECTIVO" label="Efectivo" style={{ marginBottom: 8 }}>
            <InputNumber
              min={0} step={100} precision={2}
              prefix="$"
              style={{ width: 140 }}
              controls={false}
            />
          </Form.Item>

          <Form.Item name="DIGITAL" label="Digital" style={{ marginBottom: 8 }}>
            <InputNumber
              min={0} step={100} precision={2}
              prefix="$"
              style={{ width: 140 }}
              controls={false}
            />
          </Form.Item>

          <Form.Item name="CHEQUES" label="Cheques" style={{ marginBottom: 8 }}>
            <InputNumber
              min={0} step={100} precision={2}
              prefix="$"
              style={{ width: 140 }}
              controls={false}
            />
          </Form.Item>
        </Space>

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
  );
}
