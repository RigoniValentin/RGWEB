import { useState, useMemo } from 'react';
import { Modal, Form, Select, InputNumber, Radio, Space, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { catalogApi } from '../../services/catalog.api';
import { productApi } from '../../services/product.api';
import { notify } from '../../utils/notify.ts';
import { RGCajaModalHeader } from '../RGCajaModalHeader';
import { rgIcon } from '../rg-icons';
import { formulaLabel, labelTipoMargen, normalizarTipoMargen } from '../../utils/pricing';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  productIds: number[];
}

export function BulkPriceModal({ open, onClose, onDone, productIds }: Props) {

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const { data: listas } = useQuery({
    queryKey: ['listas-precios'],
    queryFn: () => catalogApi.getListasPrecios(),
  });

  const listaSeleccionada = useMemo(() => {
    const id = form.getFieldValue('listaTarget');
    return listas?.find(l => l.LISTA_ID === id) ?? null;
  }, [listas, form]);

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
      notify.success(`Precios generados para ${productIds.length} producto(s)`);
      onDone();
      onClose();
    } catch (err: any) {
      if (!err?.errorFields) {
        notify.error(err?.response?.data?.error || 'Error al generar precios');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={
        <RGCajaModalHeader
          icon={rgIcon('precio-masivo')}
          title="Generar Precios Masivamente"
          subtitle="Calculá precios en bloque aplicando un margen sobre el costo"
        />
      }
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      okText="Generar"
      cancelText="Cancelar"
      destroyOnHidden
      width={480}
      className="rg-modal"
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
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
        {listaSeleccionada && (
          <div style={{ marginBottom: 12, marginTop: -8 }}>
            <Tag color={normalizarTipoMargen(listaSeleccionada.TIPO_MARGEN) === 'U' ? 'purple' : 'blue'}>
              {labelTipoMargen(normalizarTipoMargen(listaSeleccionada.TIPO_MARGEN))}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {formulaLabel(normalizarTipoMargen(listaSeleccionada.TIPO_MARGEN))}
            </Typography.Text>
          </div>
        )}
        <Form.Item name="source" label="Calcular desde">
          <Radio.Group>
            <Radio value="ARS">Costo ARS ($)</Radio>
            <Radio value="USD">Costo USD (U$S)</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          name="margen"
          label="Margen (%)"
          rules={[
            { required: true, message: 'Ingresá margen' },
            {
              validator: async (_r, v) => {
                const tipo = normalizarTipoMargen(listaSeleccionada?.TIPO_MARGEN);
                if (tipo === 'U' && v >= 100) {
                  return Promise.reject(new Error('En modo Utilidad el margen debe ser menor a 100%.'));
                }
                if (v < 0) {
                  return Promise.reject(new Error('El margen no puede ser negativo.'));
                }
              },
            },
          ]}
        >
          <InputNumber
            min={0}
            max={normalizarTipoMargen(listaSeleccionada?.TIPO_MARGEN) === 'U' ? 99.99 : 9999}
            precision={2}
            style={{ width: '100%' }}
            addonAfter="%"
          />
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
