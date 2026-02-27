import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Input, Typography, Tag, Select, Button, Modal, App,
  Tooltip, Drawer, Spin, Form, Switch, Descriptions,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, FilterOutlined, ReloadOutlined, ShopOutlined,
} from '@ant-design/icons';
import { supplierApi, type ProveedorInput } from '../services/supplier.api';
import type { Proveedor } from '../types';

const { Title } = Typography;

export function SuppliersPage() {
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

  // ── Data queries ─────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['suppliers', page, pageSize, search, activo, orderBy, orderDir],
    queryFn: () => supplierApi.getAll({
      page, pageSize,
      search: search || undefined,
      activo,
      orderBy, orderDir,
    }),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['supplier-detail', selectedId],
    queryFn: () => supplierApi.getById(selectedId!),
    enabled: !!selectedId && drawerOpen,
  });

  // Edit data for form
  const { data: editData, isLoading: editLoading } = useQuery({
    queryKey: ['supplier-edit', editId],
    queryFn: () => supplierApi.getById(editId!),
    enabled: !!editId && formOpen,
  });

  // ── Helpers ──────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['suppliers'] });
    qc.invalidateQueries({ queryKey: ['supplier-edit'] });
  }, [qc]);

  // ── Fill form when editing ───────────────────────
  useEffect(() => {
    if (editData && formOpen && editId) {
      form.setFieldsValue({
        CODIGOPARTICULAR: editData.CODIGOPARTICULAR,
        NOMBRE: editData.NOMBRE,
        TIPO_DOCUMENTO: editData.TIPO_DOCUMENTO || 'CUIT',
        NUMERO_DOC: editData.NUMERO_DOC,
        TELEFONO: editData.TELEFONO,
        EMAIL: editData.EMAIL,
        DIRECCION: editData.DIRECCION,
        CIUDAD: editData.CIUDAD,
        CP: editData.CP,
        CTA_CORRIENTE: editData.CTA_CORRIENTE,
        ACTIVO: editData.ACTIVO,
      });
    }
  }, [editData, formOpen, editId, form]);

  // ── Actions ──────────────────────────────────────
  const handleNew = () => {
    setEditId(null);
    form.resetFields();
    form.setFieldsValue({ TIPO_DOCUMENTO: 'CUIT', ACTIVO: true, CTA_CORRIENTE: false });
    setFormOpen(true);
  };

  const handleEdit = (record: Proveedor) => {
    setEditId(record.PROVEEDOR_ID);
    form.resetFields();
    setFormOpen(true);
  };

  const handleDetail = (record: Proveedor) => {
    setSelectedId(record.PROVEEDOR_ID);
    setDrawerOpen(true);
  };

  const handleDelete = (record: Proveedor) => {
    Modal.confirm({
      title: 'Eliminar proveedor',
      content: `¿Eliminar "${record.NOMBRE}"? Si tiene compras o productos asociados se desactivará.`,
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        try {
          const result = await supplierApi.delete(record.PROVEEDOR_ID);
          message.success(
            result.mode === 'soft'
              ? 'Proveedor desactivado (tiene compras o productos asociados)'
              : 'Proveedor eliminado'
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

      const payload: ProveedorInput = {
        CODIGOPARTICULAR: values.CODIGOPARTICULAR || undefined,
        NOMBRE: values.NOMBRE,
        TELEFONO: values.TELEFONO || null,
        EMAIL: values.EMAIL || null,
        DIRECCION: values.DIRECCION || null,
        CIUDAD: values.CIUDAD || null,
        CP: values.CP || null,
        TIPO_DOCUMENTO: values.TIPO_DOCUMENTO || 'CUIT',
        NUMERO_DOC: values.NUMERO_DOC || '',
        CTA_CORRIENTE: values.CTA_CORRIENTE || false,
        ACTIVO: values.ACTIVO !== false,
      };

      if (editId) {
        await supplierApi.update(editId, payload);
        message.success('Proveedor actualizado');
      } else {
        await supplierApi.create(payload);
        message.success('Proveedor creado');
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
        CIUDAD: 'CIUDAD',
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
  const columns: TableColumnType<Proveedor>[] = [
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
      align: 'center',
      render: (_: unknown, r: Proveedor) =>
        r.NUMERO_DOC ? `${r.TIPO_DOCUMENTO} ${r.NUMERO_DOC}` : '-',
    },
    {
      title: 'Teléfono',
      dataIndex: 'TELEFONO',
      key: 'TELEFONO',
      width: 130,
      ellipsis: true,
      align: 'center',
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
      title: 'Ciudad',
      dataIndex: 'CIUDAD',
      key: 'CIUDAD',
      width: 140,
      sorter: true,
      ellipsis: { showTitle: true },
      align: 'center',
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
      render: (_: unknown, record: Proveedor) => (
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
        <Title level={3} style={{ margin: 0 }}>Proveedores</Title>
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
            Nuevo Proveedor
          </Button>
        </Space>
      </div>

      {/* ── Table ─────────────────────────────── */}
      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="PROVEEDOR_ID"
        loading={isLoading}
        onChange={handleTableChange}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: ['10', '25', '50', '100'],
          showTotal: (total) => `${total} proveedores`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 1200 }}
      />

      {/* ── Form Modal (New / Edit) ───────────── */}
      <Modal
        title={editId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditId(null); form.resetFields(); }}
        onOk={handleSave}
        okText={editId ? 'Guardar Cambios' : 'Crear Proveedor'}
        cancelText="Cancelar"
        confirmLoading={saving}
        width={600}
        destroyOnClose
        className="rg-modal"
      >
        {editId && editLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : (
          <Form form={form} layout="vertical" size="middle">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Form.Item name="CODIGOPARTICULAR" label="Código"
                tooltip={editId ? 'El código es obligatorio' : 'Si se deja vacío se asigna automáticamente'}
                rules={editId ? [{ required: true, whitespace: true, message: 'El código es obligatorio' }] : []}>
                <Input placeholder={editId ? '' : 'Auto'} />
              </Form.Item>
              <Form.Item name="NOMBRE" label="Nombre" rules={[{ required: true, message: 'Ingresá el nombre' }]}>
                <Input />
              </Form.Item>
              <Form.Item name="TIPO_DOCUMENTO" label="Tipo Documento">
                <Select options={[
                  { label: 'CUIT', value: 'CUIT' },
                  { label: 'DNI', value: 'DNI' },
                ]} />
              </Form.Item>
              <Form.Item name="NUMERO_DOC" label="Nro. Documento">
                <Input />
              </Form.Item>
              <Form.Item name="TELEFONO" label="Teléfono">
                <Input />
              </Form.Item>
              <Form.Item name="EMAIL" label="Email">
                <Input type="email" />
              </Form.Item>
              <Form.Item name="DIRECCION" label="Dirección" style={{ gridColumn: '1 / -1' }}>
                <Input />
              </Form.Item>
              <Form.Item name="CIUDAD" label="Ciudad">
                <Input />
              </Form.Item>
              <Form.Item name="CP" label="Código Postal">
                <Input />
              </Form.Item>
              <Form.Item name="CTA_CORRIENTE" label="Habilitar Cta. Corriente" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="ACTIVO" label="Activo" valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
          </Form>
        )}
      </Modal>

      {/* ── Detail Drawer ─────────────────────── */}
      <Drawer
        title={<span><ShopOutlined /> Detalle del Proveedor</span>}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={540}
        className="rg-drawer"
        extra={
          detail && (
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
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Código">{detail.CODIGOPARTICULAR}</Descriptions.Item>
            <Descriptions.Item label="Nombre">{detail.NOMBRE || '-'}</Descriptions.Item>
            <Descriptions.Item label="Tipo Doc.">{detail.TIPO_DOCUMENTO || '-'}</Descriptions.Item>
            <Descriptions.Item label="Nro. Doc.">{detail.NUMERO_DOC || '-'}</Descriptions.Item>
            <Descriptions.Item label="Dirección">{detail.DIRECCION || '-'}</Descriptions.Item>
            <Descriptions.Item label="Ciudad">{detail.CIUDAD || '-'}</Descriptions.Item>
            <Descriptions.Item label="CP">{detail.CP || '-'}</Descriptions.Item>
            <Descriptions.Item label="Teléfono">{detail.TELEFONO || '-'}</Descriptions.Item>
            <Descriptions.Item label="Email">{detail.EMAIL || '-'}</Descriptions.Item>
            <Descriptions.Item label="Cta. Corriente">
              {detail.CTA_CORRIENTE ? <Tag color="blue">Habilitada</Tag> : 'No'}
            </Descriptions.Item>
            <Descriptions.Item label="Estado">
              <Tag color={detail.ACTIVO ? 'green' : 'red'}>{detail.ACTIVO ? 'Activo' : 'Inactivo'}</Tag>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
