import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Input, Typography, Button, Modal, App,
  Tooltip, Spin, Form,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { depositApi, type DepositoInput } from '../services/deposit.api';
import type { Deposito } from '../types';

const { Title } = Typography;

export function DepositsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
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
    queryKey: ['deposits', page, pageSize, search, orderBy, orderDir],
    queryFn: () => depositApi.getAll({
      page, pageSize,
      search: search || undefined,
      orderBy, orderDir,
    }),
  });

  // Edit data for form
  const { data: editData, isLoading: editLoading } = useQuery({
    queryKey: ['deposit-edit', editId],
    queryFn: () => depositApi.getById(editId!),
    enabled: !!editId && formOpen,
  });

  // ── Helpers ──────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['deposits'] });
    qc.invalidateQueries({ queryKey: ['deposit-edit'] });
  }, [qc]);

  // ── Fill form when editing ───────────────────────
  useEffect(() => {
    if (editData && formOpen && editId) {
      form.setFieldsValue({
        CODIGOPARTICULAR: editData.CODIGOPARTICULAR,
        NOMBRE: editData.NOMBRE,
      });
    }
  }, [editData, formOpen, editId, form]);

  // ── Actions ──────────────────────────────────────
  const handleNew = () => {
    setEditId(null);
    form.resetFields();
    setFormOpen(true);
  };

  const handleEdit = (record: Deposito) => {
    setEditId(record.DEPOSITO_ID);
    form.resetFields();
    setFormOpen(true);
  };

  const handleDelete = (record: Deposito) => {
    if (record.DEPOSITO_ID === 1) {
      message.warning('No se puede eliminar el DEPOSITO CENTRAL, ya que es el que se toma por defecto. Si desea puede modificarle el nombre.');
      return;
    }
    Modal.confirm({
      title: 'Eliminar depósito',
      content: `¿Eliminar "${record.NOMBRE}"?`,
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        try {
          await depositApi.delete(record.DEPOSITO_ID);
          message.success('Depósito eliminado');
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

      const payload: DepositoInput = {
        CODIGOPARTICULAR: values.CODIGOPARTICULAR || undefined,
        NOMBRE: values.NOMBRE,
      };

      if (editId) {
        await depositApi.update(editId, payload);
        message.success('Depósito actualizado');
      } else {
        await depositApi.create(payload);
        message.success('Depósito creado');
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
  const columns: TableColumnType<Deposito>[] = [
    {
      title: 'Código',
      dataIndex: 'CODIGOPARTICULAR',
      key: 'CODIGOPARTICULAR',
      width: 150,
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
      title: '',
      key: 'actions',
      width: 100,
      fixed: 'right',
      render: (_: unknown, record: Deposito) => (
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
          Depósitos
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
        </Space>
        <Space size="small">
          <Tooltip title="Refrescar">
            <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNew} className="btn-gold">
            Nuevo Depósito
          </Button>
        </Space>
      </div>

      {/* ── Table ─────────────────────────────── */}
      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="DEPOSITO_ID"
        loading={isLoading}
        onChange={handleTableChange}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: ['10', '25', '50', '100'],
          showTotal: (total) => `${total} depósitos`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 500 }}
      />

      {/* ── Form Modal (New / Edit) ───────────── */}
      <Modal
        title={editId ? 'Editar Depósito' : 'Nuevo Depósito'}
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditId(null); form.resetFields(); }}
        onOk={handleSave}
        okText={editId ? 'Guardar Cambios' : 'Crear Depósito'}
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
              rules={[{ required: true, message: 'Ingresá el nombre del depósito' }]}>
              <Input />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
