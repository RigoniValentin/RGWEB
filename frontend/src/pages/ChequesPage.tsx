import { useMemo, useState } from 'react';
import {
  Table, Card, Space, Input, Select, Button, Tag, Typography, App,
  Modal, Form, InputNumber, DatePicker, Row, Col, Statistic, Tooltip, Popconfirm,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  SearchOutlined, ReloadOutlined, PlusOutlined, BankOutlined,
  ExportOutlined, DeleteOutlined, EditOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { chequesApi, type ChequeInput } from '../services/cheques.api';
import { bancosApi } from '../services/bancos.api';
import BancoSelect from '../components/cheques/BancoSelect';
import { fmtMoney } from '../utils/format';
import type { Banco, Cheque, ChequeEstado } from '../types';
import { useAuthStore } from '../store/authStore';

const { Title, Text } = Typography;

const ESTADO_COLORS: Record<ChequeEstado, string> = {
  EN_CARTERA: 'gold',
  EGRESADO: 'blue',
  DEPOSITADO: 'green',
  ANULADO: 'red',
};

const ESTADO_LABELS: Record<ChequeEstado, string> = {
  EN_CARTERA: 'En cartera',
  EGRESADO: 'Egresado',
  DEPOSITADO: 'Depositado',
  ANULADO: 'Anulado',
};

export function ChequesPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const puntoVentaActivo = useAuthStore(s => s.puntoVentaActivo);

  // Filters
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [estado, setEstado] = useState<ChequeEstado | 'TODOS'>('TODOS');

  // Form modal (create/edit)
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Cheque | null>(null);
  const [form] = Form.useForm();

  // Salida masiva modal
  const [salidaOpen, setSalidaOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [salidaForm] = Form.useForm();

  // ── Queries ───────────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['cheques', page, pageSize, search, estado],
    queryFn: () => chequesApi.getAll({
      page, pageSize,
      search: search || undefined,
      estado,
      orderBy: 'FECHA_INGRESO',
      orderDir: 'DESC',
    }),
  });

  const { data: resumen } = useQuery({
    queryKey: ['cheques-resumen'],
    queryFn: () => chequesApi.getResumen(),
    refetchOnMount: 'always',
  });

  // Para auto-detección de banco a partir del prefijo del número de cheque
  const { data: bancos } = useQuery({
    queryKey: ['bancos', 'activos'],
    queryFn: () => bancosApi.getAll({ activo: true }),
    staleTime: 5 * 60 * 1000,
  });

  const detectarBancoPorPrefijo = (numero: string): Banco | null => {
    if (!numero || !bancos) return null;
    const limpio = numero.replace(/\D/g, '');
    if (limpio.length < 11) return null;
    const prefijo = limpio.slice(0, 3);
    return bancos.find(b => b.CODIGO_BCRA === prefijo) ?? null;
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['cheques'] });
    qc.invalidateQueries({ queryKey: ['cheques-resumen'] });
    qc.invalidateQueries({ queryKey: ['cheques-cartera'] });
    qc.invalidateQueries({ queryKey: ['caja-central-mov'] });
    qc.invalidateQueries({ queryKey: ['caja-central-totales'] });
    qc.invalidateQueries({ queryKey: ['caja-central-historico'] });
    qc.invalidateQueries({ queryKey: ['cc-desglose'] });
    qc.invalidateQueries({ queryKey: ['dashboard-analytics'] });
  };

  // ── Mutations ─────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (values: ChequeInput) => {
      if (editing) return chequesApi.update(editing.CHEQUE_ID, values);
      return chequesApi.create(values);
    },
    onSuccess: () => {
      message.success(editing ? 'Cheque actualizado' : 'Cheque creado');
      setFormOpen(false);
      setEditing(null);
      form.resetFields();
      invalidate();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.error || 'Error al guardar el cheque');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => chequesApi.delete(id),
    onSuccess: () => {
      message.success('Cheque anulado');
      invalidate();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.error || 'No se pudo anular el cheque');
    },
  });

  const salidaMutation = useMutation({
    mutationFn: (payload: { chequeIds: number[]; estadoDestino: 'DEPOSITADO' | 'ANULADO'; descripcion?: string; destinoDesc?: string }) =>
      chequesApi.salidaMasiva(payload),
    onSuccess: (res) => {
      message.success(`${res.procesados} cheque(s) procesados — ${fmtMoney(res.total)}`);
      setSalidaOpen(false);
      setSelectedIds([]);
      salidaForm.resetFields();
      invalidate();
    },
    onError: (err: any) => {
      message.error(err?.response?.data?.error || 'Error en la salida de cheques');
    },
  });

  // ── Handlers ──────────────────────────────────────
  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ FECHA_PRESENTACION: null });
    setFormOpen(true);
  };

  const openEdit = (c: Cheque) => {
    setEditing(c);
    form.setFieldsValue({
      BANCO_ID: c.BANCO_ID ?? null,
      BANCO: c.BANCO,
      LIBRADOR: c.LIBRADOR,
      NUMERO: c.NUMERO,
      IMPORTE: c.IMPORTE,
      PORTADOR: c.PORTADOR,
      FECHA_PRESENTACION: c.FECHA_PRESENTACION ? dayjs(c.FECHA_PRESENTACION) : null,
      OBSERVACIONES: c.OBSERVACIONES,
    });
    setFormOpen(true);
  };

  const submitForm = async () => {
    const values = await form.validateFields();
    const payload: ChequeInput = {
      BANCO_ID: values.BANCO_ID ?? null,
      BANCO: values.BANCO,
      LIBRADOR: values.LIBRADOR,
      NUMERO: String(values.NUMERO).replace(/\D/g, ''),
      IMPORTE: Number(values.IMPORTE),
      PUNTO_VENTA_ID: puntoVentaActivo,
      PORTADOR: values.PORTADOR || null,
      FECHA_PRESENTACION: values.FECHA_PRESENTACION ? (values.FECHA_PRESENTACION as Dayjs).format('YYYY-MM-DD') : null,
      OBSERVACIONES: values.OBSERVACIONES || null,
    };
    saveMutation.mutate(payload);
  };

  const submitSalida = async () => {
    const values = await salidaForm.validateFields();
    salidaMutation.mutate({
      chequeIds: selectedIds,
      estadoDestino: values.estadoDestino,
      descripcion: values.descripcion || undefined,
      destinoDesc: values.destinoDesc || undefined,
    });
  };

  // ── Columns ───────────────────────────────────────
  const columns: TableColumnType<Cheque>[] = useMemo(() => [
    { title: 'N°', dataIndex: 'NUMERO', width: 150, render: (v: string) => <Text strong>{v}</Text> },
    { title: 'Banco', dataIndex: 'BANCO', width: 200 },
    { title: 'Librador', dataIndex: 'LIBRADOR' },
    { title: 'Portador', dataIndex: 'PORTADOR', render: (v: string | null) => v || <Text type="secondary">—</Text> },
    {
      title: 'Importe',
      dataIndex: 'IMPORTE',
      width: 130,
      align: 'right',
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
    },
    {
      title: 'Ingreso',
      dataIndex: 'FECHA_INGRESO',
      width: 110,
      render: (v: string | null) => v ? new Date(v).toLocaleDateString('es-AR') : '—',
    },
    {
      title: 'Presentación',
      dataIndex: 'FECHA_PRESENTACION',
      width: 120,
      render: (v: string | null) => v ? new Date(v).toLocaleDateString('es-AR') : <Text type="secondary">—</Text>,
    },
    {
      title: 'Estado',
      dataIndex: 'ESTADO',
      width: 120,
      render: (v: ChequeEstado) => <Tag color={ESTADO_COLORS[v]}>{ESTADO_LABELS[v]}</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 100,
      render: (_: unknown, c: Cheque) => (
        <Space size={4}>
          {c.ESTADO === 'EN_CARTERA' && (
            <Tooltip title="Editar">
              <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(c)} />
            </Tooltip>
          )}
          {c.ESTADO === 'EN_CARTERA' && (
            <Popconfirm
              title="¿Anular este cheque?"
              description="El cheque pasa a estado ANULADO."
              okText="Anular"
              cancelText="Cancelar"
              okButtonProps={{ danger: true }}
              onConfirm={() => deleteMutation.mutate(c.CHEQUE_ID)}
            >
              <Button size="small" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ], [deleteMutation]);

  const seleccionEnCartera = useMemo(() => {
    const list = data?.data || [];
    const set = new Set(selectedIds);
    return list.filter((c: Cheque) => set.has(c.CHEQUE_ID) && c.ESTADO === 'EN_CARTERA');
  }, [data?.data, selectedIds]);

  return (
    <div className="page-enter">
      <div className="page-header">
        <Title level={3}>Cheques</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()}>Actualizar</Button>
          <Button type="primary" className="btn-gold" icon={<PlusOutlined />} onClick={openCreate}>
            Nuevo cheque
          </Button>
        </Space>
      </div>
      <Card className="rg-card" styles={{ body: { padding: 16 } }}>

        {/* Resumen */}
        {resumen && (
          <Row gutter={12} style={{ marginBottom: 16 }}>
            <Col xs={12} md={6}>
              <Card size="small" style={{ background: 'rgba(234,189,35,0.06)', borderColor: '#EABD23' }}>
                <Statistic
                  title={<><BankOutlined /> En cartera</>}
                  value={resumen.enCarteraTotal}
                  formatter={v => fmtMoney(Number(v))}
                  suffix={<Text type="secondary" style={{ fontSize: 12 }}>{` (${resumen.enCarteraCount})`}</Text>}
                />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="Egresados" value={resumen.egresadoTotal} formatter={v => fmtMoney(Number(v))} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small">
                <Statistic title="Depositados" value={resumen.depositadoTotal} formatter={v => fmtMoney(Number(v))} />
              </Card>
            </Col>
            <Col xs={12} md={6}>
              <Card size="small" style={{ background: 'rgba(0,0,0,0.02)' }}>
                <Statistic
                  title="Total histórico"
                  value={resumen.enCarteraTotal + resumen.egresadoTotal + resumen.depositadoTotal}
                  formatter={v => fmtMoney(Number(v))}
                />
              </Card>
            </Col>
          </Row>
        )}

        {/* Filters */}
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            prefix={<SearchOutlined />}
            placeholder="Buscar por número, librador o banco"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            allowClear
            style={{ width: 320 }}
          />
          <Select
            value={estado}
            onChange={v => { setEstado(v); setPage(1); }}
            style={{ width: 180 }}
            options={[
              { value: 'TODOS', label: 'Todos los estados' },
              { value: 'EN_CARTERA', label: 'En cartera' },
              { value: 'EGRESADO', label: 'Egresados' },
              { value: 'DEPOSITADO', label: 'Depositados' },
              { value: 'ANULADO', label: 'Anulados' },
            ]}
          />
          <Button
            type="primary"
            icon={<ExportOutlined />}
            disabled={seleccionEnCartera.length === 0}
            onClick={() => setSalidaOpen(true)}
          >
            Salida de cheques ({seleccionEnCartera.length})
          </Button>
        </Space>

        <Table<Cheque>
          rowKey="CHEQUE_ID"
          columns={columns}
          dataSource={data?.data || []}
          loading={isLoading}
          size="middle"
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: keys => setSelectedIds(keys as number[]),
            getCheckboxProps: (c) => ({ disabled: c.ESTADO !== 'EN_CARTERA' }),
          }}
          pagination={{
            current: page,
            pageSize,
            total: data?.total || 0,
            showSizeChanger: true,
            pageSizeOptions: [10, 20, 50, 100],
            onChange: (p, s) => { setPage(p); setPageSize(s); },
          }}
        />
      </Card>

      {/* ── Form modal ── */}
      <Modal
        title={editing ? 'Editar cheque' : 'Nuevo cheque'}
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditing(null); }}
        onOk={submitForm}
        okText={editing ? 'Guardar cambios' : 'Crear cheque'}
        cancelText="Cancelar"
        confirmLoading={saveMutation.isPending}
        width={560}
        destroyOnClose
        className="rg-modal"
        okButtonProps={{ className: 'btn-gold' }}
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="Banco" name="BANCO_ID" rules={[{ required: true, message: 'Banco requerido' }]}>
                <BancoSelect
                  onChange={(_id, banco) => {
                    form.setFieldsValue({ BANCO: banco?.NOMBRE ?? '' });
                  }}
                />
              </Form.Item>
              <Form.Item name="BANCO" hidden><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Número"
                name="NUMERO"
                rules={[
                  { required: true, message: 'Número requerido' },
                  { pattern: /^\d{6,20}$/, message: 'Solo números (6 a 20 dígitos)' },
                ]}
              >
                <Input
                  maxLength={20}
                  inputMode="numeric"
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '');
                    if (val !== e.target.value) {
                      form.setFieldsValue({ NUMERO: val });
                    }
                    // Auto-detect banco por prefijo BCRA
                    const detectado = detectarBancoPorPrefijo(val);
                    if (detectado && form.getFieldValue('BANCO_ID') !== detectado.BANCO_ID) {
                      form.setFieldsValue({
                        BANCO_ID: detectado.BANCO_ID,
                        BANCO: detectado.NOMBRE,
                      });
                    }
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Librador" name="LIBRADOR" rules={[{ required: true, message: 'Librador requerido' }]}>
                <Input maxLength={120} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Portador" name="PORTADOR">
                <Input maxLength={120} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Importe"
                name="IMPORTE"
                rules={[{ required: true, message: 'Importe requerido' }, { type: 'number', min: 0.01, message: 'Importe debe ser mayor a 0' }]}
              >
                <InputNumber
                  style={{ width: '100%' }}
                  min={0.01}
                  step={100}
                  precision={2}
                  prefix="$"
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Fecha de presentación"
                name="FECHA_PRESENTACION"
                rules={[
                  {
                    validator: (_, value: Dayjs | null) => {
                      if (!value) return Promise.resolve();
                      if (value.isBefore(dayjs().startOf('day'))) {
                        return Promise.reject(new Error('La fecha no puede ser anterior a hoy'));
                      }
                      if (value.diff(dayjs(), 'day') > 360) {
                        return Promise.reject(new Error('La fecha no puede superar 360 días'));
                      }
                      return Promise.resolve();
                    },
                  },
                ]}
              >
                <DatePicker
                  style={{ width: '100%' }}
                  format="DD/MM/YYYY"
                  disabledDate={(d) => d && d.isBefore(dayjs().startOf('day'))}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label="Observaciones" name="OBSERVACIONES">
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* ── Salida masiva modal ── */}
      <Modal
        title="Salida de cheques"
        open={salidaOpen}
        onCancel={() => setSalidaOpen(false)}
        onOk={submitSalida}
        okText="Confirmar salida"
        cancelText="Cancelar"
        confirmLoading={salidaMutation.isPending}
        width={480}
        destroyOnClose
        className="rg-modal"
        okButtonProps={{ className: 'btn-gold' }}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {seleccionEnCartera.length} cheque(s) por un total de{' '}
          <Text strong>{fmtMoney(seleccionEnCartera.reduce((s: number, c: Cheque) => s + (Number(c.IMPORTE) || 0), 0))}</Text>
        </Text>
        <Form form={salidaForm} layout="vertical" initialValues={{ estadoDestino: 'DEPOSITADO' }}>
          <Form.Item label="Destino" name="estadoDestino" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'DEPOSITADO', label: 'Depositar' },
                { value: 'ANULADO', label: 'Anular' },
              ]}
            />
          </Form.Item>
          <Form.Item label="Detalle del destino (opcional)" name="destinoDesc" tooltip="Ej: Banco Galicia CA 123-456">
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item label="Observaciones" name="descripcion">
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
