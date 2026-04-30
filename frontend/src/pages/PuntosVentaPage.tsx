import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Input, Typography, Button, Modal, App,
  Tooltip, Spin, Form, Tag, Switch, Transfer, Radio,
} from 'antd';
import type { TableColumnType } from 'antd';
import type { TransferDirection } from 'antd/es/transfer';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  ReloadOutlined, EnvironmentOutlined, InboxOutlined, UserOutlined,
} from '@ant-design/icons';
import { puntoVentaApi, type PuntoVentaInput } from '../services/puntoVenta.api';
import { depositApi } from '../services/deposit.api';
import { usuariosApi } from '../services/usuarios.api';
import { useTabStore } from '../store/tabStore';
import type { PuntoVenta } from '../types';

const { Title, Text } = Typography;

export function PuntosVentaPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  // Listing state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  const [orderBy, setOrderBy] = useState<string>('NOMBRE');
  const [orderDir, setOrderDir] = useState<'ASC' | 'DESC'>('ASC');

  // Form state
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [depositoIds, setDepositoIds] = useState<number[]>([]);
  const [depositoPreferido, setDepositoPreferido] = useState<number | null>(null);
  const [usuarioIds, setUsuarioIds] = useState<number[]>([]);

  // ── Queries ──────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['puntos-venta', page, pageSize, search, orderBy, orderDir],
    queryFn: () => puntoVentaApi.getAll({
      page, pageSize,
      search: search || undefined,
      orderBy, orderDir,
    }),
  });

  const { data: editData, isLoading: editLoading } = useQuery({
    queryKey: ['punto-venta-edit', editId],
    queryFn: () => puntoVentaApi.getById(editId!),
    enabled: !!editId && formOpen,
  });

  const { data: depositosResp } = useQuery({
    queryKey: ['deposits-all'],
    queryFn: () => depositApi.getAll({ pageSize: 1000 }),
    enabled: formOpen,
  });

  const { data: usuariosResp } = useQuery({
    queryKey: ['usuarios-all'],
    queryFn: () => usuariosApi.getAll({ activo: true }),
    enabled: formOpen,
  });

  const depositosOptions = useMemo(
    () => (depositosResp?.data || []).map(d => ({ key: String(d.DEPOSITO_ID), title: `${d.CODIGOPARTICULAR} — ${d.NOMBRE}` })),
    [depositosResp],
  );
  const usuariosOptions = useMemo(
    () => (usuariosResp || []).map(u => ({ key: String(u.USUARIO_ID), title: u.NOMBRE_COMPLETO || u.NOMBRE })),
    [usuariosResp],
  );

  // ── Helpers ──────────────────────────────────────
  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['puntos-venta'] });
    qc.invalidateQueries({ queryKey: ['punto-venta-edit'] });
    qc.invalidateQueries({ queryKey: ['deposits'] });
    qc.invalidateQueries({ queryKey: ['stock-depositos'] });
  }, [qc]);

  const resetForm = () => {
    form.resetFields();
    setDepositoIds([]);
    setDepositoPreferido(null);
    setUsuarioIds([]);
  };

  // ── Fill form when editing ───────────────────────
  useEffect(() => {
    if (editData && formOpen && editId) {
      form.setFieldsValue({
        NOMBRE: editData.NOMBRE,
        DIRECCION: editData.DIRECCION || '',
        COMENTARIOS: editData.COMENTARIOS || '',
        ACTIVO: editData.ACTIVO,
      });
      setDepositoIds(editData.depositos.map(d => d.DEPOSITO_ID));
      const prefDep = editData.depositos.find(d => d.ES_PREFERIDO);
      setDepositoPreferido(prefDep ? prefDep.DEPOSITO_ID : null);
      setUsuarioIds(editData.usuarios.map(u => u.USUARIO_ID));
    }
  }, [editData, formOpen, editId, form]);

  // ── Actions ──────────────────────────────────────
  const handleNew = () => {
    setEditId(null);
    resetForm();
    form.setFieldsValue({ ACTIVO: true });
    setFormOpen(true);
  };

  useEffect(() => {
    const handler = () => { if (useTabStore.getState().activeKey === '/settings/pos') handleNew(); };
    window.addEventListener('rg:nuevo', handler);
    return () => window.removeEventListener('rg:nuevo', handler);
  }, []);

  const handleEdit = (record: PuntoVenta) => {
    setEditId(record.PUNTO_VENTA_ID);
    resetForm();
    setFormOpen(true);
  };

  const handleDelete = (record: PuntoVenta) => {
    if (record.PUNTO_VENTA_ID === 1) {
      message.warning('No se puede eliminar el Punto de Venta por defecto.');
      return;
    }
    Modal.confirm({
      title: 'Eliminar punto de venta',
      content: `¿Eliminar "${record.NOMBRE}"?`,
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        try {
          await puntoVentaApi.delete(record.PUNTO_VENTA_ID);
          message.success('Punto de venta eliminado');
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

      const payload: PuntoVentaInput = {
        NOMBRE: values.NOMBRE.trim(),
        DIRECCION: values.DIRECCION?.trim() || null,
        COMENTARIOS: values.COMENTARIOS?.trim() || null,
        ACTIVO: !!values.ACTIVO,
        depositos: depositoIds,
        depositoPreferido,
        usuarios: usuarioIds,
      };

      if (editId) {
        await puntoVentaApi.update(editId, payload);
        message.success('Punto de venta actualizado');
      } else {
        await puntoVentaApi.create(payload);
        message.success('Punto de venta creado');
      }

      setFormOpen(false);
      setEditId(null);
      resetForm();
      invalidate();
    } catch (err: any) {
      if (err?.response?.data?.error) message.error(err.response.data.error);
    } finally {
      setSaving(false);
    }
  };

  // ── Table sort ───────────────────────────────────
  const handleTableChange = (_p: any, _f: any, sorter: any) => {
    if (sorter.field) {
      setOrderBy(sorter.field);
      setOrderDir(sorter.order === 'descend' ? 'DESC' : 'ASC');
    }
  };

  // ── Columns ──────────────────────────────────────
  const columns: TableColumnType<PuntoVenta>[] = [
    { title: 'ID', dataIndex: 'PUNTO_VENTA_ID', key: 'PUNTO_VENTA_ID', width: 80, align: 'center', sorter: true },
    { title: 'Nombre', dataIndex: 'NOMBRE', key: 'NOMBRE', sorter: true, ellipsis: true },
    { title: 'Dirección', dataIndex: 'DIRECCION', key: 'DIRECCION', ellipsis: true,
      render: (v: string) => v || <Text type="secondary">—</Text> },
    { title: 'Depósitos', dataIndex: 'CANT_DEPOSITOS', key: 'CANT_DEPOSITOS', width: 110, align: 'center',
      render: (n?: number) => <Tag color="blue"><InboxOutlined /> {n ?? 0}</Tag> },
    { title: 'Usuarios', dataIndex: 'CANT_USUARIOS', key: 'CANT_USUARIOS', width: 110, align: 'center',
      render: (n?: number) => <Tag color="purple"><UserOutlined /> {n ?? 0}</Tag> },
    { title: 'Activo', dataIndex: 'ACTIVO', key: 'ACTIVO', width: 100, align: 'center', sorter: true,
      render: (v: boolean) => v ? <Tag color="green">SÍ</Tag> : <Tag>NO</Tag> },
    {
      title: '', key: 'actions', width: 100, fixed: 'right',
      render: (_: unknown, record: PuntoVenta) => (
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
          <EnvironmentOutlined /> Puntos de Venta
        </Title>
        <Space wrap size="small">
          <Input
            placeholder="Buscar nombre o dirección..."
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
            Nuevo Punto de Venta
          </Button>
        </Space>
      </div>

      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="PUNTO_VENTA_ID"
        loading={isLoading}
        onChange={handleTableChange}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: ['10', '25', '50', '100'],
          showTotal: (total) => `${total} puntos de venta`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 800 }}
      />

      {/* ── Form Modal ────────────────────────── */}
      <Modal
        title={editId ? 'Editar Punto de Venta' : 'Nuevo Punto de Venta'}
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditId(null); resetForm(); }}
        onOk={handleSave}
        okText={editId ? 'Guardar Cambios' : 'Crear Punto de Venta'}
        cancelText="Cancelar"
        confirmLoading={saving}
        width={780}
        destroyOnClose
        className="rg-modal"
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        {editId && editLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : (
          <Form form={form} layout="vertical" size="middle">
            <Space.Compact style={{ width: '100%' }}>
              <Form.Item name="NOMBRE" label="Nombre" style={{ flex: 1, marginRight: 12 }}
                rules={[{ required: true, whitespace: true, message: 'El nombre es obligatorio' }]}>
                <Input maxLength={100} />
              </Form.Item>
              <Form.Item name="ACTIVO" label="Activo" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Space.Compact>

            <Form.Item name="DIRECCION" label="Dirección">
              <Input maxLength={200} />
            </Form.Item>

            <Form.Item name="COMENTARIOS" label="Comentarios">
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>

            {/* Depositos assignment */}
            <Title level={5} style={{ marginTop: 8 }}><InboxOutlined /> Depósitos asignados</Title>
            <Transfer
              dataSource={depositosOptions}
              titles={['Disponibles', 'Asignados']}
              targetKeys={depositoIds.map(String)}
              onChange={(keys: React.Key[], _dir: TransferDirection, _moved: React.Key[]) => {
                const ids = keys.map(k => Number(k));
                setDepositoIds(ids);
                if (depositoPreferido != null && !ids.includes(depositoPreferido)) {
                  setDepositoPreferido(null);
                }
              }}
              render={item => item.title || ''}
              listStyle={{ width: 320, height: 220 }}
              showSearch
              filterOption={(input, option) =>
                (option.title || '').toLowerCase().includes(input.toLowerCase())
              }
            />
            {depositoIds.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ marginRight: 8 }}>Depósito preferido:</Text>
                <Radio.Group
                  value={depositoPreferido}
                  onChange={(e) => setDepositoPreferido(e.target.value)}
                >
                  <Radio value={null}>Ninguno</Radio>
                  {depositoIds.map(id => {
                    const d = depositosResp?.data.find(x => x.DEPOSITO_ID === id);
                    return (
                      <Radio key={id} value={id}>{d ? d.NOMBRE : `#${id}`}</Radio>
                    );
                  })}
                </Radio.Group>
              </div>
            )}

            {/* Usuarios assignment */}
            <Title level={5} style={{ marginTop: 16 }}><UserOutlined /> Usuarios habilitados</Title>
            <Transfer
              dataSource={usuariosOptions}
              titles={['Disponibles', 'Habilitados']}
              targetKeys={usuarioIds.map(String)}
              onChange={(keys: React.Key[], _dir: TransferDirection, _moved: React.Key[]) => {
                const ids = keys.map(k => Number(k));
                setUsuarioIds(ids);
              }}
              render={item => item.title || ''}
              listStyle={{ width: 320, height: 220 }}
              showSearch
              filterOption={(input, option) =>
                (option.title || '').toLowerCase().includes(input.toLowerCase())
              }
            />
            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              El punto de venta preferido de cada usuario se configura desde la edición del usuario.
            </Text>
          </Form>
        )}
      </Modal>
    </div>
  );
}
