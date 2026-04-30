import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Input, Typography, Tag, Select, Button, Modal, App,
  Tooltip, Drawer, Spin, Form, Switch, Descriptions, Divider, Row, Col,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, FilterOutlined, ReloadOutlined, UserOutlined, WarningOutlined,
} from '@ant-design/icons';
import { customerApi, type ClienteInput } from '../services/customer.api';
import { useTabStore } from '../store/tabStore';
import { afipApi } from '../services/afip.api';
import { fmtMoney } from '../utils/format';
import type { Cliente } from '../types';

const { Title, Text } = Typography;

const CONDICIONES_IVA = [
  'Consumidor Final',
  'Responsable Inscripto',
  'Monotributista',
  'Exento',
  'No Responsable',
];

const PROVINCIAS = [
  'Buenos Aires', 'CABA', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba',
  'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja',
  'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan',
  'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero',
  'Tierra del Fuego', 'Tucumán',
];

export function CustomersPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [activo, setActivo] = useState<boolean | undefined>(undefined);
  const [orderBy, setOrderBy] = useState<string>('NOMBRE');
  const [orderDir, setOrderDir] = useState<'ASC' | 'DESC'>('ASC');

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  // Detail drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Form instance
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [lookingUpCuit, setLookingUpCuit] = useState(false);
  const [noAlcanzado, setNoAlcanzado] = useState(false);
  const tipoDocWatch = Form.useWatch('TIPO_DOCUMENTO', form);

  // ── Data queries ─────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['customers', page, pageSize, search, activo, orderBy, orderDir],
    queryFn: () => customerApi.getAll({
      page, pageSize,
      search: search || undefined,
      activo,
      orderBy, orderDir,
    }),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['customer-detail', selectedId],
    queryFn: () => customerApi.getById(selectedId!),
    enabled: !!selectedId && drawerOpen,
  });

  const { data: ctaCorriente } = useQuery({
    queryKey: ['customer-cta', selectedId],
    queryFn: () => customerApi.getCtaCorriente(selectedId!),
    enabled: !!selectedId && drawerOpen,
  });

  // Edit data for form
  const { data: editData, isLoading: editLoading } = useQuery({
    queryKey: ['customer-edit', editId],
    queryFn: () => customerApi.getById(editId!),
    enabled: !!editId && formOpen,
  });

  // ── Helpers ──────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['customers'] });
    qc.invalidateQueries({ queryKey: ['customer-edit'] });
  }, [qc]);

  // ── AFIP Padrón lookup ────────────────────────────
  const handleBuscarCuit = async () => {
    const cuit = (form.getFieldValue('NUMERO_DOC') as string || '').replace(/-/g, '');
    if (!cuit) { message.warning('Ingresá el CUIT antes de buscar'); return; }
    setLookingUpCuit(true);
    setNoAlcanzado(false);
    try {
      const result = await afipApi.lookupCuit(cuit);
      form.setFieldsValue({ NOMBRE: result.razonSocial });
      if (result.noAlcanzado) {
        setNoAlcanzado(true);
      } else if (result.condicionIva) {
        form.setFieldsValue({ CONDICION_IVA: result.condicionIva });
      }
      if (result.domicilio) form.setFieldsValue({ DOMICILIO: result.domicilio });
      if (result.provincia) form.setFieldsValue({ PROVINCIA: result.provincia });
      if (result.ciudad) form.setFieldsValue({ CIUDAD: result.ciudad });
      if (result.codigoPostal) form.setFieldsValue({ CP: result.codigoPostal });
      if (result.rubro) form.setFieldsValue({ RUBRO: result.rubro });
      if (result.fechaNacimiento) form.setFieldsValue({ FECHA_NACIMIENTO: result.fechaNacimiento });
      message.success('Datos importados desde AFIP');
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'No se pudo consultar el padrón de AFIP');
    } finally {
      setLookingUpCuit(false);
    }
  };

  // ── Fill form when editing ───────────────────────
  useEffect(() => {
    if (editData && formOpen && editId) {
      form.setFieldsValue({
        CODIGOPARTICULAR: editData.CODIGOPARTICULAR,
        NOMBRE: editData.NOMBRE,
        DOMICILIO: editData.DOMICILIO,
        CIUDAD: editData.CIUDAD,
        CP: editData.CP,
        PROVINCIA: editData.PROVINCIA,
        TELEFONO: editData.TELEFONO,
        EMAIL: editData.EMAIL,
        TIPO_DOCUMENTO: editData.TIPO_DOCUMENTO || 'DNI',
        NUMERO_DOC: editData.NUMERO_DOC,
        CONDICION_IVA: editData.CONDICION_IVA,
        RUBRO: editData.RUBRO,
        FECHA_NACIMIENTO: editData.FECHA_NACIMIENTO
          ? String(editData.FECHA_NACIMIENTO).slice(0, 10)
          : null,
        CTA_CORRIENTE: editData.CTA_CORRIENTE,
        ACTIVO: editData.ACTIVO,
      });
    }
  }, [editData, formOpen, editId, form]);

  // ── Actions ──────────────────────────────────────
  const handleNew = () => {
    setEditId(null);
    form.resetFields();
    form.setFieldsValue({ TIPO_DOCUMENTO: 'DNI', ACTIVO: true, CTA_CORRIENTE: false });
    setFormOpen(true);
  };

  useEffect(() => {
    const handler = () => { if (useTabStore.getState().activeKey === '/customers') handleNew(); };
    window.addEventListener('rg:nuevo', handler);
    return () => window.removeEventListener('rg:nuevo', handler);
  }, []);

  const handleEdit = (record: Cliente) => {
    setEditId(record.CLIENTE_ID);
    form.resetFields();
    setFormOpen(true);
  };

  const handleDetail = (record: Cliente) => {
    setSelectedId(record.CLIENTE_ID);
    setDrawerOpen(true);
  };

  const handleDelete = (record: Cliente) => {
    if (record.CLIENTE_ID === 1) {
      message.warning('No se puede eliminar el cliente CONSUMIDOR FINAL');
      return;
    }
    Modal.confirm({
      title: 'Eliminar cliente',
      content: `¿Eliminar "${record.NOMBRE}"? Si tiene ventas asociadas se desactivará.`,
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        try {
          const result = await customerApi.delete(record.CLIENTE_ID);
          message.success(
            result.mode === 'soft'
              ? 'Cliente desactivado (tiene ventas asociadas)'
              : 'Cliente eliminado'
          );
          invalidate();
        } catch (err: any) {
          message.error(err?.response?.data?.error || 'Error al eliminar');
        }
      },
    });
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);

      const payload: ClienteInput = {
        CODIGOPARTICULAR: values.CODIGOPARTICULAR || undefined,
        NOMBRE: values.NOMBRE,
        DOMICILIO: values.DOMICILIO || null,
        CIUDAD: values.CIUDAD || null,
        CP: values.CP || null,
        PROVINCIA: values.PROVINCIA || null,
        TELEFONO: values.TELEFONO || null,
        EMAIL: values.EMAIL || null,
        TIPO_DOCUMENTO: values.TIPO_DOCUMENTO || 'DNI',
        NUMERO_DOC: values.NUMERO_DOC || '',
        CONDICION_IVA: values.CONDICION_IVA || null,
        RUBRO: values.RUBRO || null,
        FECHA_NACIMIENTO: values.FECHA_NACIMIENTO || null,
        CTA_CORRIENTE: values.CTA_CORRIENTE || false,
        ACTIVO: values.ACTIVO !== false,
      };

      if (editId) {
        await customerApi.update(editId, payload);
        message.success('Cliente actualizado');
      } else {
        await customerApi.create(payload);
        message.success('Cliente creado');
      }

      setFormOpen(false);
      form.resetFields();
      invalidate();
    } catch (err: any) {
      if (err?.response?.data?.error) {
        message.error(err.response.data.error);
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Table sort change ────────────────────────────
  const handleTableChange = (_pagination: any, _filters: any, sorter: any) => {
    if (sorter.field) {
      const colMap: Record<string, string> = {
        CODIGOPARTICULAR: 'CODIGOPARTICULAR',
        NOMBRE: 'NOMBRE',
        PROVINCIA: 'PROVINCIA',
        CONDICION_IVA: 'CONDICION_IVA',
        NUMERO_DOC: 'NUMERO_DOC',
      };
      const mappedCol = colMap[sorter.field];
      if (mappedCol) {
        setOrderBy(mappedCol);
        setOrderDir(sorter.order === 'descend' ? 'DESC' : 'ASC');
      }
    }
  };

  // ── Columns ──────────────────────────────────────
  const columns: TableColumnType<Cliente>[] = [
    {
      title: 'Código',
      dataIndex: 'CODIGOPARTICULAR',
      key: 'CODIGOPARTICULAR',
      width: 120,
      sorter: true,
      align: 'center' as const,
    },
    {
      title: 'Nombre',
      dataIndex: 'NOMBRE',
      key: 'NOMBRE',
      ellipsis: true,
      sorter: true,
    },
    {
      title: 'Documento',
      key: 'doc',
      width: 180,
      render: (_: unknown, r: Cliente) =>
        r.NUMERO_DOC ? `${r.TIPO_DOCUMENTO} ${r.NUMERO_DOC}` : '-',
    },
    {
      title: 'Teléfono',
      dataIndex: 'TELEFONO',
      key: 'TELEFONO',
      width: 130,
      ellipsis: true,
    },
    {
      title: 'Email',
      dataIndex: 'EMAIL',
      key: 'EMAIL',
      ellipsis: true,
      width: 230,
      align: 'center',
    },
    {
      title: 'Provincia',
      dataIndex: 'PROVINCIA',
      key: 'PROVINCIA',
      width: 130,
      sorter: true,
      ellipsis: { showTitle: true },
      align: 'center',
    },
    {
      title: 'Cond. IVA',
      dataIndex: 'CONDICION_IVA',
      key: 'CONDICION_IVA',
      width: 180,
      sorter: true,
      align: 'center',
      ellipsis: { showTitle: true },
    },
    {
      title: 'Cta Cte',
      dataIndex: 'CTA_CORRIENTE',
      key: 'CTA_CORRIENTE',
      width: 100,
      align: 'center',
      render: (v: boolean) => v ? <Tag color="blue">Sí</Tag> : <Tag>No</Tag>,
    },
    {
      title: 'Estado',
      dataIndex: 'ACTIVO',
      key: 'ACTIVO',
      width: 95,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Activo' : 'Inactivo'}</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      fixed: 'right',
      render: (_: unknown, record: Cliente) => (
        <Space size={4}>
          <Tooltip title="Ver detalle">
            <Button type="text" size="small" icon={<EyeOutlined />}
              onClick={() => handleDetail(record)} style={{ color: '#EABD23' }} />
          </Tooltip>
          <Tooltip title="Editar">
            <Button type="text" size="small" icon={<EditOutlined />}
              onClick={() => handleEdit(record)} style={{ color: '#EABD23' }} />
          </Tooltip>
          <Tooltip title="Eliminar">
            <Button type="text" size="small" danger icon={<DeleteOutlined />}
              onClick={() => handleDelete(record)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-enter">
      {/* ── Header ────────────────────────────── */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <Title level={3} style={{ margin: 0 }}>Clientes</Title>
        <Space wrap size="small">
          <Input
            placeholder="Buscar nombre, código, documento..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ width: 280 }}
            allowClear
          />
          <Select
            placeholder="Estado"
            allowClear
            style={{ width: 120 }}
            value={activo}
            onChange={(v) => { setActivo(v); setPage(1); }}
            options={[
              { label: 'Activos', value: true },
              { label: 'Inactivos', value: false },
            ]}
            suffixIcon={<FilterOutlined />}
          />
        </Space>
        <Space size="small">
          <Tooltip title="Refrescar">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNew} className="btn-gold">
            Nuevo Cliente
          </Button>
        </Space>
      </div>

      {/* ── Table ─────────────────────────────── */}
      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="CLIENTE_ID"
        loading={isLoading}
        onChange={handleTableChange}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: ['10', '25', '50', '100'],
          showTotal: (total) => `${total} clientes`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 1200 }}
      />

      {/* ── Form Modal (New / Edit) ───────────── */}
      <Modal
        title={editId ? 'Editar Cliente' : 'Nuevo Cliente'}
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditId(null); setNoAlcanzado(false); form.resetFields(); }}
        onOk={handleSave}
        okText={editId ? 'Guardar Cambios' : 'Crear Cliente'}
        cancelText="Cancelar"
        confirmLoading={saving}
        width={720}
        destroyOnClose
        className="rg-modal"
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        {editId && editLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : (
          <Form form={form} layout="vertical" size="middle">

            {/* ── Identificación ──────────────── */}
            <Divider orientation="left" orientationMargin={0} style={{ marginTop: 4, marginBottom: 12, fontSize: 12, color: '#888' }}>Identificación</Divider>
            <Row gutter={12}>
              <Col span={5}>
                <Form.Item name="CODIGOPARTICULAR" label="Código"
                  tooltip={editId ? 'Obligatorio' : 'Vacío = automático'}
                  rules={editId ? [{ required: true, whitespace: true, message: 'Requerido' }] : []}>
                  <Input placeholder={editId ? '' : 'Auto'} />
                </Form.Item>
              </Col>
              <Col span={19}>
                <Form.Item name="NOMBRE" label="Nombre" rules={[{ required: true, message: 'Ingresá el nombre' }]}>
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={6}>
                <Form.Item name="TIPO_DOCUMENTO" label="Tipo Doc.">
                  <Select
                    options={[
                      { label: 'DNI', value: 'DNI' },
                      { label: 'CUIT', value: 'CUIT' },
                    ]}
                    onChange={() => setNoAlcanzado(false)}
                  />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name="NUMERO_DOC" label="Nro. Documento">
                  <Input.Search
                    enterButton={tipoDocWatch === 'CUIT' ? 'Buscar AFIP' : false}
                    loading={lookingUpCuit}
                    onSearch={tipoDocWatch === 'CUIT' ? handleBuscarCuit : undefined}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="CONDICION_IVA"
                  label={
                    noAlcanzado
                      ? <span><WarningOutlined style={{ color: '#faad14', marginRight: 4 }} />Cond. IVA <span style={{ fontWeight: 400, color: '#faad14', fontSize: 11 }}>(seleccioná manualmente)</span></span>
                      : 'Condición IVA'
                  }
                >
                  <Select
                    allowClear
                    showSearch
                    placeholder="Seleccionar"
                    options={CONDICIONES_IVA.map(c => ({ label: c, value: c }))}
                  />
                </Form.Item>
              </Col>
            </Row>

            {/* ── Domicilio ───────────────────── */}
            <Divider orientation="left" orientationMargin={0} style={{ marginBottom: 12, fontSize: 12, color: '#888' }}>Domicilio</Divider>
            <Row gutter={12}>
              <Col span={6}>
                <Form.Item name="PROVINCIA" label="Provincia">
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="Seleccionar"
                    options={PROVINCIAS.map(p => ({ label: p, value: p }))}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="DOMICILIO" label="Dirección">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="CIUDAD" label="Ciudad">
                  <Input />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={5}>
                <Form.Item name="CP" label="Cód. Postal">
                  <Input maxLength={10} />
                </Form.Item>
              </Col>
              <Col span={19}>
                <Form.Item name="RUBRO" label="Rubro / Actividad">
                  <Input placeholder="Actividad principal (AFIP)" />
                </Form.Item>
              </Col>
            </Row>

            {/* ── Contacto & Config ───────────── */}
            <Divider orientation="left" orientationMargin={0} style={{ marginBottom: 12, fontSize: 12, color: '#888' }}>Contacto y configuración</Divider>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="TELEFONO" label="Teléfono">
                  <Input />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name="EMAIL" label="Email">
                  <Input type="email" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="FECHA_NACIMIENTO" label="F. Nacimiento" tooltip="Sólo personas físicas — AAAA-MM-DD">
                  <Input placeholder="AAAA-MM-DD" maxLength={10} />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={12}>
              <Col span={8}>
                <Form.Item name="CTA_CORRIENTE" label="Cta. Corriente" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="ACTIVO" label="Activo" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>

          </Form>
        )}
      </Modal>

      {/* ── Detail Drawer ─────────────────────── */}
      <Drawer
        title={<span><UserOutlined /> Detalle del Cliente</span>}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={540}
        className="rg-drawer"
        extra={
          detail && detail.CLIENTE_ID !== 1 && (
            <Button type="primary" icon={<EditOutlined />} className="btn-gold" size="small"
              onClick={() => { setDrawerOpen(false); handleEdit(detail); }}>
              Editar
            </Button>
          )
        }
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : detail && (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Código">{detail.CODIGOPARTICULAR}</Descriptions.Item>
              <Descriptions.Item label="Nombre">{detail.NOMBRE || '-'}</Descriptions.Item>
              <Descriptions.Item label="Tipo Doc.">{detail.TIPO_DOCUMENTO || '-'}</Descriptions.Item>
              <Descriptions.Item label="Nro. Doc.">{detail.NUMERO_DOC || '-'}</Descriptions.Item>
              <Descriptions.Item label="Cond. IVA">{detail.CONDICION_IVA || '-'}</Descriptions.Item>
              <Descriptions.Item label="Domicilio">{detail.DOMICILIO || '-'}</Descriptions.Item>
              <Descriptions.Item label="Ciudad">{detail.CIUDAD || '-'}</Descriptions.Item>
              <Descriptions.Item label="Cód. Postal">{detail.CP || '-'}</Descriptions.Item>
              <Descriptions.Item label="Provincia">{detail.PROVINCIA || '-'}</Descriptions.Item>
              <Descriptions.Item label="Rubro">{detail.RUBRO || '-'}</Descriptions.Item>
              {detail.FECHA_NACIMIENTO && (
                <Descriptions.Item label="Fecha Nacimiento">
                  {String(detail.FECHA_NACIMIENTO).slice(0, 10)}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Teléfono">{detail.TELEFONO || '-'}</Descriptions.Item>
              <Descriptions.Item label="Email">{detail.EMAIL || '-'}</Descriptions.Item>
              <Descriptions.Item label="Cta. Corriente">
                {detail.CTA_CORRIENTE ? <Tag color="blue">Habilitada</Tag> : 'No'}
              </Descriptions.Item>
              <Descriptions.Item label="Estado">
                <Tag color={detail.ACTIVO ? 'green' : 'red'}>{detail.ACTIVO ? 'Activo' : 'Inactivo'}</Tag>
              </Descriptions.Item>
            </Descriptions>

            {ctaCorriente && detail.CTA_CORRIENTE && (
              <div style={{ marginTop: 24 }}>
                <Text strong style={{ marginBottom: 8, display: 'block' }}>Cuenta Corriente</Text>
                <Descriptions column={1} bordered size="small">
                  <Descriptions.Item label="Total Debe">{fmtMoney(ctaCorriente.TOTAL_DEBE)}</Descriptions.Item>
                  <Descriptions.Item label="Total Haber">{fmtMoney(ctaCorriente.TOTAL_HABER)}</Descriptions.Item>
                  <Descriptions.Item label="Saldo">
                    <span style={{ fontWeight: 'bold', color: ctaCorriente.SALDO > 0 ? '#f5222d' : '#52c41a' }}>
                      {fmtMoney(ctaCorriente.SALDO)}
                    </span>
                  </Descriptions.Item>
                </Descriptions>
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
