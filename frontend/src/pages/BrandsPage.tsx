import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Input, Typography, Tag, Select, Button, Modal, App,
  Tooltip, Spin, Form, Switch,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  FilterOutlined, ReloadOutlined, TagOutlined,
} from '@ant-design/icons';
import { brandApi, type MarcaInput } from '../services/brand.api';
import type { Marca } from '../types';

const { Title } = Typography;

export function BrandsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [activa, setActiva] = useState<boolean | undefined>(undefined);
  const [orderBy, setOrderBy] = useState<string>('NOMBRE');
  const [orderDir, setOrderDir] = useState<'ASC' | 'DESC'>('ASC');

  // Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);

  // Form
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  // ── Data queries ─────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['brands', page, pageSize, search, activa, orderBy, orderDir],
    queryFn: () => brandApi.getAll({
      page, pageSize,
      search: search || undefined,
      activa,
      orderBy, orderDir,
    }),
  });

  // Edit data for form
  const { data: editData, isLoading: editLoading } = useQuery({
    queryKey: ['brand-edit', editId],
    queryFn: () => brandApi.getById(editId!),
    enabled: !!editId && formOpen,
  });

  // ── Helpers ──────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['brands'] });
    qc.invalidateQueries({ queryKey: ['brand-edit'] });
    qc.invalidateQueries({ queryKey: ['marcas'] }); // Invalidate catalog cache too
  }, [qc]);

  // ── Fill form when editing ───────────────────────
  useEffect(() => {
    if (editData && formOpen && editId) {
      form.setFieldsValue({
        CODIGOPARTICULAR: editData.CODIGOPARTICULAR,
        NOMBRE: editData.NOMBRE,
        ACTIVA: editData.ACTIVA,
      });
    }
  }, [editData, formOpen, editId, form]);

  // ── Actions ──────────────────────────────────────
  const handleNew = () => {
    setEditId(null);
    form.resetFields();
    form.setFieldsValue({ ACTIVA: true });
    setFormOpen(true);
  };

  const handleEdit = (record: Marca) => {
    setEditId(record.MARCA_ID);
    form.resetFields();
    setFormOpen(true);
  };

  const handleDelete = (record: Marca) => {
    Modal.confirm({
      title: 'Eliminar marca',
      content: `¿Eliminar "${record.NOMBRE}"? Si tiene productos asociados se desactivará.`,
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        try {
          const result = await brandApi.delete(record.MARCA_ID);
          message.success(
            result.mode === 'soft'
              ? 'Marca desactivada (tiene productos asociados)'
              : 'Marca eliminada'
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

      const payload: MarcaInput = {
        CODIGOPARTICULAR: values.CODIGOPARTICULAR || undefined,
        NOMBRE: values.NOMBRE,
        ACTIVA: values.ACTIVA !== false,
      };

      if (editId) {
        await brandApi.update(editId, payload);
        message.success('Marca actualizada');
      } else {
        await brandApi.create(payload);
        message.success('Marca creada');
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
      };
      const mappedCol = colMap[sorter.field];
      if (mappedCol) {
        setOrderBy(mappedCol);
        setOrderDir(sorter.order === 'descend' ? 'DESC' : 'ASC');
      }
    }
  };

  // ── Columns ──────────────────────────────────────
  const columns: TableColumnType<Marca>[] = [
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
      title: 'Estado',
      dataIndex: 'ACTIVA',
      key: 'ACTIVA',
      width: 95,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Activa' : 'Inactiva'}</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_: unknown, record: Marca) => (
        <Space size={4}>
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
        <Title level={3} style={{ margin: 0 }}>
          <TagOutlined style={{ marginRight: 8 }} />
          Marcas
        </Title>
        <Space wrap size="small">
          <Input
            placeholder="Buscar nombre, código..."
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
            value={activa}
            onChange={(v) => { setActiva(v); setPage(1); }}
            options={[
              { label: 'Activas', value: true },
              { label: 'Inactivas', value: false },
            ]}
            suffixIcon={<FilterOutlined />}
          />
        </Space>
        <Space size="small">
          <Tooltip title="Refrescar">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNew} className="btn-gold">
            Nueva Marca
          </Button>
        </Space>
      </div>

      {/* ── Table ─────────────────────────────── */}
      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="MARCA_ID"
        loading={isLoading}
        onChange={handleTableChange}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: ['10', '25', '50', '100'],
          showTotal: (total) => `${total} marcas`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 600 }}
      />

      {/* ── Form Modal (New / Edit) ───────────── */}
      <Modal
        title={editId ? 'Editar Marca' : 'Nueva Marca'}
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditId(null); form.resetFields(); }}
        onOk={handleSave}
        okText={editId ? 'Guardar Cambios' : 'Crear Marca'}
        cancelText="Cancelar"
        confirmLoading={saving}
        width={450}
        destroyOnClose
        className="rg-modal"
      >
        {editId && editLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : (
          <Form form={form} layout="vertical" size="middle">
            <Form.Item name="CODIGOPARTICULAR" label="Código"
              tooltip={editId ? 'El código es obligatorio' : 'Si se deja vacío se asigna automáticamente'}
              rules={editId ? [{ required: true, whitespace: true, message: 'El código es obligatorio' }] : []}>
              <Input placeholder={editId ? '' : 'Auto'} />
            </Form.Item>
            <Form.Item name="NOMBRE" label="Nombre"
              rules={[{ required: true, message: 'Ingresá el nombre de la marca' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="ACTIVA" label="Activa" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
