import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, Card, Empty, Form, Input, List, Modal, Pagination,
  Select, Space, Spin, Switch, Tag, Tooltip, Typography,
} from 'antd';
import {
  CreditCardOutlined, DeleteOutlined, EditOutlined, FilterOutlined,
  PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined,
} from '@ant-design/icons';
import { paymentMethodApi, type MetodoPagoInput } from '../services/paymentMethod.api';
import type { MetodoPago } from '../types';

const { Title, Text } = Typography;

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

export function PaymentMethodsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  // Filters
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [categoria, setCategoria] = useState<'EFECTIVO' | 'DIGITAL' | undefined>();
  const [activa, setActiva] = useState<boolean | undefined>();

  // Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [imgPreview, setImgPreview] = useState<string | null>(null);
  const [form] = Form.useForm();

  // ── Queries ──────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['payment-methods', page, pageSize, search, categoria, activa],
    queryFn: () =>
      paymentMethodApi.getAll({
        page, pageSize,
        search: search || undefined,
        categoria, activa,
        orderBy: 'NOMBRE', orderDir: 'ASC',
      }),
  });

  const { data: editData, isLoading: editLoading } = useQuery({
    queryKey: ['payment-method-edit', editId],
    queryFn: () => paymentMethodApi.getById(editId!),
    enabled: !!editId && formOpen,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['payment-methods'] });
    qc.invalidateQueries({ queryKey: ['payment-method-edit'] });
  }, [qc]);

  // Fill form on edit
  useEffect(() => {
    if (editData && formOpen && editId) {
      form.setFieldsValue({
        NOMBRE: editData.NOMBRE,
        CATEGORIA: editData.CATEGORIA,
        ACTIVA: editData.ACTIVA,
      });
      setImgPreview(editData.IMAGEN_BASE64 || null);
    }
  }, [editData, formOpen, editId, form]);

  // ── Handlers ─────────────────────────────────────
  const resetModal = () => { setFormOpen(false); setEditId(null); setImgPreview(null); form.resetFields(); };

  const handleNew = () => {
    setEditId(null); setImgPreview(null);
    form.resetFields();
    form.setFieldsValue({ CATEGORIA: 'DIGITAL', ACTIVA: true });
    setFormOpen(true);
  };

  const handleEdit = (r: MetodoPago) => {
    setEditId(r.METODO_PAGO_ID); form.resetFields(); setFormOpen(true);
  };

  const handleDelete = (r: MetodoPago) => {
    Modal.confirm({
      title: 'Eliminar método de pago',
      content: `¿Eliminar "${r.NOMBRE}"?`,
      okText: 'Eliminar', okType: 'danger', cancelText: 'Cancelar',
      onOk: async () => {
        try {
          await paymentMethodApi.delete(r.METODO_PAGO_ID);
          message.success('Método de pago eliminado');
          invalidate();
        } catch (err: any) {
          message.error(err?.response?.data?.error || 'Error al eliminar');
        }
      },
    });
  };

  const handleSave = async () => {
    try {
      const vals = await form.validateFields();
      setSaving(true);

      const payload: MetodoPagoInput = {
        NOMBRE: vals.NOMBRE,
        CATEGORIA: vals.CATEGORIA,
        IMAGEN_BASE64: imgPreview,
        ACTIVA: vals.ACTIVA !== false,
      };

      if (editId) {
        await paymentMethodApi.update(editId, payload);
        message.success('Método de pago actualizado');
      } else {
        await paymentMethodApi.create(payload);
        message.success('Método de pago creado');
      }
      resetModal();
      invalidate();
    } catch (err: any) {
      if (err?.response?.data?.error) message.error(err.response.data.error);
    } finally {
      setSaving(false);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      message.warning('Formato no soportado. Use PNG, JPG, GIF o WebP.'); return;
    }
    if (file.size > 2 * 1024 * 1024) {
      message.warning('La imagen supera 2 MB'); return;
    }
    try { setImgPreview(await toDataUrl(file)); } catch { message.error('Error al cargar imagen'); }
  };

  // ── Render ───────────────────────────────────────
  return (
    <div className="page-enter">
      {/* Header */}
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <Title level={3} style={{ margin: 0 }}>
          <CreditCardOutlined style={{ marginRight: 8 }} />Métodos de Pago
        </Title>

        <Space wrap size="small">
          <Input placeholder="Buscar..." prefix={<SearchOutlined />} value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }} style={{ width: 260 }} allowClear />
          <Select placeholder="Categoría" allowClear style={{ width: 140 }} value={categoria}
            onChange={v => { setCategoria(v); setPage(1); }}
            options={[{ label: 'Digital', value: 'DIGITAL' }, { label: 'Efectivo', value: 'EFECTIVO' }]}
            suffixIcon={<FilterOutlined />} />
          <Select placeholder="Estado" allowClear style={{ width: 120 }} value={activa}
            onChange={v => { setActiva(v); setPage(1); }}
            options={[{ label: 'Activos', value: true }, { label: 'Inactivos', value: false }]}
            suffixIcon={<FilterOutlined />} />
        </Space>

        <Space size="small">
          <Tooltip title="Refrescar"><Button icon={<ReloadOutlined />} onClick={() => refetch()} /></Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNew} className="btn-gold">
            Nuevo Método
          </Button>
        </Space>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div style={{ padding: 60, textAlign: 'center' }}><Spin size="large" /></div>
      ) : (
        <>
          <List
            locale={{ emptyText: <Empty description="No hay métodos de pago" /> }}
            grid={{ gutter: 16, xs: 1, sm: 2, md: 3, lg: 4, xl: 5 }}
            dataSource={data?.data || []}
            renderItem={item => (
              <List.Item>
                <Card hoverable className="rg-card" onClick={() => handleEdit(item)}
                  cover={
                    <div style={{
                      height: 140, background: '#f5f5f5', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    }}>
                      {item.IMAGEN_BASE64
                        ? <img src={item.IMAGEN_BASE64} alt={item.NOMBRE}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : <CreditCardOutlined style={{ fontSize: 36, color: '#bfbfbf' }} />}
                    </div>
                  }
                  actions={[
                    <Tooltip title="Editar" key="e">
                      <Button type="text" size="small" icon={<EditOutlined />}
                        onClick={e => { e.stopPropagation(); handleEdit(item); }}
                        style={{ color: '#EABD23' }} />
                    </Tooltip>,
                    ...(!item.POR_DEFECTO ? [
                      <Tooltip title="Eliminar" key="d">
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}
                          onClick={e => { e.stopPropagation(); handleDelete(item); }} />
                      </Tooltip>,
                    ] : []),
                  ]}
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Text strong ellipsis>{item.NOMBRE}</Text>
                    <Space size={6}>
                      <Tag color={item.CATEGORIA === 'DIGITAL' ? 'blue' : 'green'}>{item.CATEGORIA}</Tag>
                      <Tag color={item.ACTIVA ? 'success' : 'default'}>{item.ACTIVA ? 'Activo' : 'Inactivo'}</Tag>
                    </Space>
                  </Space>
                </Card>
              </List.Item>
            )}
          />

          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <Pagination current={page} pageSize={pageSize} total={data?.total || 0}
              showSizeChanger pageSizeOptions={['12', '24', '48']}
              showTotal={t => `${t} métodos`}
              onChange={(p, ps) => { setPage(p); setPageSize(ps); }} />
          </div>
        </>
      )}

      {/* ── Modal ──────────────────────────────── */}
      <Modal
        title={editId ? 'Editar Método de Pago' : 'Nuevo Método de Pago'}
        open={formOpen} onCancel={resetModal} onOk={handleSave}
        okText={editId ? 'Guardar Cambios' : 'Crear Método'} cancelText="Cancelar"
        confirmLoading={saving} width={500} destroyOnClose className="rg-modal"
      >
        {editId && editLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : (
          <Form form={form} layout="vertical" size="middle">
            <Form.Item name="NOMBRE" label="Nombre"
              rules={[{ required: true, message: 'Ingresá el nombre' }]}>
              <Input />
            </Form.Item>

            <Form.Item name="CATEGORIA" label="Categoría"
              rules={[{ required: true, message: 'Seleccioná la categoría' }]}>
              <Select options={[
                { label: 'Digital', value: 'DIGITAL' },
                { label: 'Efectivo', value: 'EFECTIVO' },
              ]} />
            </Form.Item>

            <Form.Item label="Imagen">
              <Space direction="vertical" style={{ width: '100%' }}>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif"
                  style={{ display: 'none' }} onChange={onFileChange} />
                <Space>
                  <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()}>
                    Adjuntar imagen
                  </Button>
                  {imgPreview && <Button danger onClick={() => setImgPreview(null)}>Quitar</Button>}
                </Space>
                {imgPreview && (
                  <div style={{
                    width: 180, height: 110, borderRadius: 8, overflow: 'hidden',
                    border: '1px solid #f0f0f0', background: '#fafafa',
                  }}>
                    <img src={imgPreview} alt="Preview"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
              </Space>
            </Form.Item>

            <Form.Item name="ACTIVA" label="Activo" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        )}
      </Modal>
    </div>
  );
}
