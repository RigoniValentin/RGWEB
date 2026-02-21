import { useEffect, useState } from 'react';
import {
  Modal, Form, Input, InputNumber, Select, Switch, Tabs, Space, Button,
  Table, Tag, DatePicker, Typography, Row, Col, Divider, Badge, App,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, BarcodeOutlined, ShopOutlined,
  DollarOutlined, InboxOutlined, FileTextOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { catalogApi } from '../../services/catalog.api';
import { productApi, type TasaImpuesto } from '../../services/product.api';
import dayjs from 'dayjs';
import type { Producto } from '../../types';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editId?: number | null;
  copyFrom?: Producto | null;
}

export function ProductFormModal({ open, onClose, onSaved, editId, copyFrom }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [newBarcode, setNewBarcode] = useState('');
  const [depositos, setDepositos] = useState<{ DEPOSITO_ID: number; CANTIDAD: number; DEPOSITO_NOMBRE?: string }[]>([]);
  const [selectedProveedores, setSelectedProveedores] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState('general');
  const [tabErrors, setTabErrors] = useState<{ stock?: boolean; proveedores?: boolean }>({});

  // ── Catalog data ───────────────────────────────
  const { data: categorias } = useQuery({ queryKey: ['categorias'], queryFn: () => catalogApi.getCategorias() });
  const { data: marcas } = useQuery({ queryKey: ['marcas'], queryFn: () => catalogApi.getMarcas() });
  const { data: unidades } = useQuery({ queryKey: ['unidades'], queryFn: () => catalogApi.getUnidades() });
  const { data: depositosList } = useQuery({ queryKey: ['depositos'], queryFn: () => catalogApi.getDepositos() });
  const { data: tasas } = useQuery({ queryKey: ['tasas'], queryFn: () => productApi.getTasasImpuestos() });
  const { data: listas } = useQuery({ queryKey: ['listas-precios'], queryFn: () => catalogApi.getListasPrecios() });
  const { data: proveedoresList } = useQuery({
    queryKey: ['all-suppliers'],
    queryFn: () => import('../../services/supplier.api').then(m => m.supplierApi.getAll({ pageSize: 9999 })),
  });

  // ── Load detail when editing ───────────────────
  const { data: detail, isLoading: loadingDetail } = useQuery({
    queryKey: ['product-edit', editId],
    queryFn: () => productApi.getById(editId!),
    enabled: !!editId && open,
  });

  useEffect(() => {
    if (!open) return;
    setActiveTab('general');
    setTabErrors({});

    if (editId && detail) {
      form.setFieldsValue({
        ...detail,
        FECHA_VENCIMIENTO: detail.FECHA_VENCIMIENTO ? dayjs(detail.FECHA_VENCIMIENTO) : null,
      });
      setBarcodes(detail.codigosBarras || []);
      setDepositos(detail.stockDepositos || []);
      setSelectedProveedores(detail.proveedores?.map((p) => p.PROVEEDOR_ID) || []);
    } else if (copyFrom) {
      form.setFieldsValue({
        ...copyFrom,
        CODIGOPARTICULAR: copyFrom.CODIGOPARTICULAR + ' (copia)',
        NOMBRE: copyFrom.NOMBRE + ' (copia)',
        FECHA_VENCIMIENTO: null,
      });
      setBarcodes([]);
      setDepositos([]);
      setSelectedProveedores([]);
    } else {
      form.resetFields();
      form.setFieldsValue({
        ACTIVO: true,
        DESCUENTA_STOCK: true,
        PRECIO_COMPRA: 0,
        COSTO_USD: 0,
        PRECIO_COMPRA_BASE: 0,
        LISTA_1: 0, LISTA_2: 0, LISTA_3: 0, LISTA_4: 0, LISTA_5: 0,
        LISTA_DEFECTO: 1,
        IMP_INT: 0,
        STOCK_MINIMO: 0,
      });
      setBarcodes([]);
      setDepositos([]);
      setSelectedProveedores([]);
    }
  }, [open, editId, detail, copyFrom, form]);

  // Set default tax rate once tasas are loaded (separate to avoid resetting form state)
  useEffect(() => {
    if (!open || editId || copyFrom || !tasas) return;
    const defaultTasa = tasas.find((t: TasaImpuesto) => t.PREDETERMINADA)?.TASA_ID;
    if (defaultTasa && !form.getFieldValue('TASA_IVA_ID')) {
      form.setFieldsValue({ TASA_IVA_ID: defaultTasa });
    }
  }, [open, editId, copyFrom, tasas, form]);

  // ── Barcode management ─────────────────────────
  const addBarcode = () => {
    if (newBarcode.trim() && !barcodes.includes(newBarcode.trim())) {
      setBarcodes([...barcodes, newBarcode.trim()]);
      setNewBarcode('');
    }
  };

  const removeBarcode = (idx: number) => {
    setBarcodes(barcodes.filter((_, i) => i !== idx));
  };

  // ── Deposit management ─────────────────────────
  const addDeposit = () => {
    const unused = depositosList?.find(d => !depositos.some(ed => ed.DEPOSITO_ID === d.DEPOSITO_ID));
    if (unused) {
      setDepositos([...depositos, { DEPOSITO_ID: unused.DEPOSITO_ID, CANTIDAD: 0, DEPOSITO_NOMBRE: unused.NOMBRE }]);
      setTabErrors(prev => ({ ...prev, stock: false }));
    }
  };

  const removeDeposit = (idx: number) => {
    setDepositos(depositos.filter((_, i) => i !== idx));
  };

  const updateDepositQty = (idx: number, cant: number) => {
    const next = [...depositos];
    const cur = next[idx]!;
    next[idx] = { DEPOSITO_ID: cur.DEPOSITO_ID, CANTIDAD: cant, DEPOSITO_NOMBRE: cur.DEPOSITO_NOMBRE };
    setDepositos(next);
  };

  const updateDepositId = (idx: number, depId: number) => {
    const next = [...depositos];
    const dep = depositosList?.find(d => d.DEPOSITO_ID === depId);
    const cur = next[idx]!;
    next[idx] = { DEPOSITO_ID: depId, CANTIDAD: cur.CANTIDAD ?? 0, DEPOSITO_NOMBRE: dep?.NOMBRE };
    setDepositos(next);
  };

  // ── Save ───────────────────────────────────────
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      // Validate deposits & providers (not managed by Form)
      const errors: { stock?: boolean; proveedores?: boolean } = {};
      if (depositos.length === 0) errors.stock = true;
      if (selectedProveedores.length === 0) errors.proveedores = true;
      setTabErrors(errors);

      if (errors.stock || errors.proveedores) {
        // Switch to the first tab with an error
        const firstErrorTab = errors.stock ? 'stock' : 'proveedores';
        setActiveTab(firstErrorTab);
        message.warning(
          errors.stock && errors.proveedores
            ? 'Debe asociar al menos un depósito y un proveedor'
            : errors.stock
            ? 'Debe asociar al menos un depósito'
            : 'Debe asociar al menos un proveedor'
        );
        return;
      }
      setSaving(true);

      const payload = {
        ...values,
        FECHA_VENCIMIENTO: values.FECHA_VENCIMIENTO ? values.FECHA_VENCIMIENTO.format('YYYY-MM-DD') : null,
        codigosBarras: barcodes,
        depositos: depositos.map(d => ({ DEPOSITO_ID: d.DEPOSITO_ID, CANTIDAD: d.CANTIDAD })),
        proveedores: selectedProveedores,
      };

      if (editId) {
        await productApi.update(editId, payload);
        message.success('Producto actualizado');
      } else {
        await productApi.create(payload);
        message.success('Producto creado');
      }

      onSaved();
      onClose();
    } catch (err: any) {
      if (err?.errorFields) return; // validation
      message.error(err?.response?.data?.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const isEdit = !!editId;
  const title = isEdit ? 'Modificar Producto' : copyFrom ? 'Copiar Producto' : 'Nuevo Producto';

  return (
    <Modal
      title={<span style={{ fontWeight: 700 }}>{title}</span>}
      open={open}
      onCancel={onClose}
      width={900}
      destroyOnHidden
      maskClosable={false}
      className="rg-drawer"
      footer={
        <Space>
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="primary" onClick={handleSave} loading={saving} className="btn-gold">
            {isEdit ? 'Guardar Cambios' : 'Crear Producto'}
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" size="middle" disabled={loadingDetail}>
        <Tabs
          size="small"
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key)}
          items={[
            {
              key: 'general',
              label: <span><FileTextOutlined /> General</span>,
              children: (
                <>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="CODIGOPARTICULAR" label="Código" rules={[{ required: true, message: 'Requerido' }]}>
                        <Input placeholder="Código particular" />
                      </Form.Item>
                    </Col>
                    <Col span={16}>
                      <Form.Item name="NOMBRE" label="Nombre" rules={[{ required: true, message: 'Requerido' }]}>
                        <Input placeholder="Nombre del producto" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="DESCRIPCION" label="Descripción">
                    <Input.TextArea rows={2} placeholder="Descripción opcional" />
                  </Form.Item>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="CATEGORIA_ID" label="Categoría" rules={[{ required: true, message: 'Seleccioná categoría' }]}>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="Categoría"
                          options={categorias?.map(c => ({ label: c.NOMBRE, value: c.CATEGORIA_ID }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="MARCA_ID" label="Marca" rules={[{ required: true, message: 'Seleccioná marca' }]}>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="Marca"
                          options={marcas?.map(m => ({ label: m.NOMBRE, value: m.MARCA_ID }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="UNIDAD_ID" label="Unidad de medida" rules={[{ required: true, message: 'Seleccioná unidad' }]}>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          placeholder="Unidad"
                          options={unidades?.map(u => ({ label: `${u.NOMBRE} (${u.ABREVIACION})`, value: u.UNIDAD_ID }))}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="TASA_IVA_ID" label="Tasa IVA">
                        <Select
                          placeholder="IVA"
                          options={tasas?.map((t: TasaImpuesto) => ({ label: t.NOMBRE, value: t.TASA_ID }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="FECHA_VENCIMIENTO" label="Fecha Vencimiento">
                        <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name="ACTIVO" label="Activo" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name="DESCUENTA_STOCK" label="Desc. Stock" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ),
            },
            {
              key: 'precios',
              label: <span><DollarOutlined /> Precios</span>,
              children: (
                <>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="PRECIO_COMPRA" label="Costo ARS ($)">
                        <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="COSTO_USD" label="Costo USD (U$S)">
                        <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="U$S" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="PRECIO_COMPRA_BASE" label="Costo Base ($)">
                        <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Divider style={{ margin: '12px 0' }}>Listas de Precios</Divider>
                  <Row gutter={16}>
                    {[1, 2, 3, 4, 5].map(i => (
                      <Col span={i <= 3 ? 8 : 12} key={i}>
                        <Form.Item name={`LISTA_${i}`} label={listas?.[i - 1]?.NOMBRE || `Lista ${i}`}>
                          <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
                        </Form.Item>
                      </Col>
                    ))}
                  </Row>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="LISTA_DEFECTO" label="Lista por defecto">
                        <Select
                          allowClear
                          placeholder="Seleccionar"
                          options={listas?.map((l, i) => ({ label: l.NOMBRE, value: i + 1 }))}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="IMP_INT" label="Imp. Internos ($)">
                        <InputNumber min={0} precision={2} style={{ width: '100%' }} prefix="$" />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="MARGEN_INDIVIDUAL" label="Margen Individual" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ),
            },
            {
              key: 'stock',
              label: <Badge dot={tabErrors.stock} offset={[6, 0]}><span><InboxOutlined /> Stock y Depósitos</span></Badge>,
              children: (
                <>
                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="STOCK_MINIMO" label="Stock Mínimo">
                        <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name="ES_CONJUNTO" label="Conjunto" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Divider style={{ margin: '12px 0' }}>Depósitos</Divider>
                  <Table
                    size="small"
                    dataSource={depositos}
                    rowKey={(r) => String(r.DEPOSITO_ID)}
                    pagination={false}
                    columns={[
                      {
                        title: 'Depósito', dataIndex: 'DEPOSITO_ID', width: 200,
                        render: (val: number, _: any, idx: number) => (
                          <Select
                            size="small"
                            style={{ width: '100%' }}
                            value={val}
                            onChange={(v) => updateDepositId(idx, v)}
                            options={depositosList?.map(d => ({ label: d.NOMBRE, value: d.DEPOSITO_ID }))}
                          />
                        ),
                      },
                      {
                        title: 'Cantidad', dataIndex: 'CANTIDAD', width: 130,
                        render: (val: number, _: any, idx: number) => (
                          <InputNumber size="small" min={0} precision={2} value={val}
                            onChange={(v) => updateDepositQty(idx, v || 0)} style={{ width: '100%' }} />
                        ),
                      },
                      {
                        title: '', width: 50,
                        render: (_: any, __: any, idx: number) => (
                          <Button type="text" danger size="small" icon={<DeleteOutlined />}
                            onClick={() => removeDeposit(idx)} />
                        ),
                      },
                    ]}
                  />
                  <Button type="dashed" icon={<PlusOutlined />} onClick={addDeposit}
                    style={{ marginTop: 8 }} block>
                    Agregar depósito
                  </Button>
                  <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                    Total: <b>{depositos.reduce((s, d) => s + (d.CANTIDAD || 0), 0).toFixed(2)}</b>
                  </Text>
                </>
              ),
            },
            {
              key: 'codbarras',
              label: <span><BarcodeOutlined /> Códigos de Barras</span>,
              children: (
                <>
                  <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
                    <Input
                      value={newBarcode}
                      onChange={e => setNewBarcode(e.target.value)}
                      placeholder="Escribí o escaneá un código de barras"
                      onPressEnter={addBarcode}
                    />
                    <Button type="primary" icon={<PlusOutlined />} onClick={addBarcode}>Agregar</Button>
                  </Space.Compact>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {barcodes.map((cb, i) => (
                      <Tag key={i} closable onClose={() => removeBarcode(i)}
                        style={{ fontSize: 13, padding: '4px 10px' }}>
                        <BarcodeOutlined /> {cb}
                      </Tag>
                    ))}
                    {barcodes.length === 0 && <Text type="secondary">Sin códigos de barras</Text>}
                  </div>
                </>
              ),
            },
            {
              key: 'proveedores',
              label: <Badge dot={tabErrors.proveedores} offset={[6, 0]}><span><ShopOutlined /> Proveedores</span></Badge>,
              children: (
                <Select
                  mode="multiple"
                  style={{ width: '100%' }}
                  placeholder="Seleccioná proveedores"
                  value={selectedProveedores}
                  onChange={(val) => {
                    setSelectedProveedores(val);
                    if (val.length > 0) setTabErrors(prev => ({ ...prev, proveedores: false }));
                  }}
                  optionFilterProp="label"
                  options={proveedoresList?.data?.map((p: any) => ({
                    label: p.NOMBRE, value: p.PROVEEDOR_ID,
                  }))}
                />
              ),
            },
          ]}
        />
      </Form>
    </Modal>
  );
}
