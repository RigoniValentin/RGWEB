import { useState } from 'react';
import { Modal, Form, Select, InputNumber, Radio, Space, Typography, App } from 'antd';
import { DollarOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { catalogApi } from '../../services/catalog.api';
import { productApi } from '../../services/product.api';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  productIds: number[];
}

export function BulkPriceModal({ open, onClose, onDone, productIds }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const { data: listas } = useQuery({
    queryKey: ['listas-precios'],
    queryFn: () => catalogApi.getListasPrecios(),
  });

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await productApi.bulkGeneratePrices({
        productoIds: productIds,
        listaId: values.listaTarget,
        margen: values.margen,
        fuente: values.source,
        redondeo: values.redondeo === 'none' ? undefined : values.redondeo,
      });
      message.success(`Precios generados para ${productIds.length} producto(s)`);
      onDone();
      onClose();
    } catch (err: any) {
      if (!err?.errorFields) {
        message.error(err?.response?.data?.error || 'Error al generar precios');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={<span><DollarOutlined /> Generar Precios Masivamente</span>}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      okText="Generar"
      cancelText="Cancelar"
      destroyOnHidden
      width={480}
      className="rg-modal"
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        Se aplicará a <b>{productIds.length}</b> producto(s) seleccionado(s)
      </Text>
      <Form form={form} layout="vertical" initialValues={{ source: 'ARS', margen: 0, redondeo: 'none' }}>
        <Form.Item name="listaTarget" label="Lista destino" rules={[{ required: true, message: 'Seleccioná una lista' }]}>
          <Select
            placeholder="Seleccioná lista"
            options={listas?.map((l, i) => ({ label: `Lista ${i + 1}: ${l.NOMBRE}`, value: i + 1 }))}
          />
        </Form.Item>
        <Form.Item name="source" label="Calcular desde">
          <Radio.Group>
            <Radio value="ARS">Costo ARS ($)</Radio>
            <Radio value="USD">Costo USD (U$S)</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="margen" label="Margen (%)" rules={[{ required: true, message: 'Ingresá margen' }]}>
          <InputNumber min={0} max={9999} precision={2} style={{ width: '100%' }} addonAfter="%" />
        </Form.Item>
        <Form.Item name="redondeo" label="Redondeo">
          <Radio.Group>
            <Space direction="vertical">
              <Radio value="none">Sin redondeo</Radio>
              <Radio value="entero">Entero</Radio>
              <Radio value="50">A $50</Radio>
              <Radio value="100">A $100</Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
      </Form>
    </Modal>
  );
}
