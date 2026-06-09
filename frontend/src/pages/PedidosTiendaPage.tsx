import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Tabs, Table, Tag, Button, Modal, Drawer, Form, Input, InputNumber, Select,
  Typography, Space, Popconfirm, App, Descriptions, Empty, Tooltip, Statistic, Row, Col,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ShoppingOutlined, ReloadOutlined, FileTextOutlined, MailOutlined,
  CheckCircleOutlined, StopOutlined, CloseCircleOutlined, DollarOutlined,
  ClockCircleOutlined, FilePdfOutlined, EyeOutlined, WalletOutlined,
  BankOutlined, CreditCardOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  tiendaOrdersApi,
  type ProcesarOrderInput,
  type TiendaOrder,
  type TiendaOrderEstado,
  type TiendaOrderWithItems,
} from '../services/tiendaOrders.api';
import { salesApi } from '../services/sales.api';
import { cajaApi } from '../services/caja.api';
import type { Deposito, MetodoPago } from '../types';

const { Title, Text, Paragraph } = Typography;

// ═══════════════════════════════════════════════════
//  Página: Pedidos Tienda Online
//
//  Pestañas por estado, tabla con acciones por fila:
//    - Ver detalle (drawer)
//    - Procesar  → convierte en Venta
//    - Facturar  → emite FE + envía mail
//    - Cancelar  → motivo
//    - Reenviar mail (si ya facturado)
// ═══════════════════════════════════════════════════

const ESTADO_COLORS: Record<TiendaOrderEstado, string> = {
  PENDIENTE: 'gold',
  PROCESADO: 'processing',
  FACTURADO: 'success',
  CANCELADO: 'default',
};

const ESTADO_LABELS: Record<TiendaOrderEstado, string> = {
  PENDIENTE: 'Pendiente',
  PROCESADO: 'Procesado',
  FACTURADO: 'Facturado',
  CANCELADO: 'Cancelado',
};

export function PedidosTiendaPage() {
  const [tab, setTab] = useState<TiendaOrderEstado | 'TODOS'>('PENDIENTE');
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);

  // Conteos para mostrar en cada tab
  const { data: counts } = useQuery({
    queryKey: ['tienda-orders', 'counts'],
    queryFn: () => tiendaOrdersApi.counts(),
    refetchInterval: 30_000,
  });

  return (
    <div className="page-enter" style={{ padding: 16 }}>
      <div className="page-header">
        <Title level={3}>
          <ShoppingOutlined /> Pedidos Tienda Online
        </Title>
      </div>
      <Paragraph type="secondary">
        Bandeja de pedidos recibidos desde la tienda online. Revisalos, convertilos en venta y
        opcionalmente emití factura electrónica con envío automático del comprobante por mail.
      </Paragraph>

      {/* KPIs rápidos */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Pendientes"
              value={counts?.pendientes ?? 0}
              valueStyle={{ color: '#d48806' }}
              prefix={<ClockCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Procesados"
              value={counts?.procesados ?? 0}
              valueStyle={{ color: '#1677ff' }}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Facturados"
              value={counts?.facturados ?? 0}
              valueStyle={{ color: '#52c41a' }}
              prefix={<FilePdfOutlined />}
            />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic
              title="Cancelados"
              value={counts?.cancelados ?? 0}
              valueStyle={{ color: '#8c8c8c' }}
              prefix={<StopOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card>
        <Tabs
          activeKey={tab}
          onChange={k => setTab(k as typeof tab)}
          tabBarExtraContent={
            <Input.Search
              allowClear
              placeholder="Buscar por ID, cliente o email"
              style={{ width: 280 }}
              onSearch={setSearch}
              onChange={e => !e.target.value && setSearch('')}
            />
          }
          items={[
            { key: 'PENDIENTE', label: `Pendientes (${counts?.pendientes ?? 0})` },
            { key: 'PROCESADO', label: `Procesados (${counts?.procesados ?? 0})` },
            { key: 'FACTURADO', label: `Facturados (${counts?.facturados ?? 0})` },
            { key: 'CANCELADO', label: `Cancelados (${counts?.cancelados ?? 0})` },
            { key: 'TODOS', label: 'Todos' },
          ]}
        />
        <OrdersTable
          estado={tab}
          search={search}
          onOpenDetail={id => setDetailId(id)}
        />
      </Card>

      {detailId != null && (
        <OrderDetailDrawer orderId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
//  Tabla de pedidos
// ─────────────────────────────────────────────────

function OrdersTable({
  estado,
  search,
  onOpenDetail,
}: {
  estado: TiendaOrderEstado | 'TODOS';
  search: string;
  onOpenDetail: (id: number) => void;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [procesarOpen, setProcesarOpen] = useState<TiendaOrder | null>(null);
  const [cancelarOpen, setCancelarOpen] = useState<TiendaOrder | null>(null);

  const { data, isFetching } = useQuery({
    queryKey: ['tienda-orders', 'list', estado, search],
    queryFn: () => tiendaOrdersApi.list({ estado, search: search || undefined, limit: 100 }),
    refetchOnWindowFocus: false,
  });

  const facturarMut = useMutation({
    mutationFn: (id: number) => tiendaOrdersApi.facturar(id),
    onSuccess: r => {
      const aviso = r.emailEnviado
        ? `Factura emitida (CAE ${r.cae}) y enviada a ${r.emailDestinatario}`
        : `Factura emitida (CAE ${r.cae}).${r.emailDestinatario ? ' No se pudo enviar el mail.' : ' Sin email del cliente.'}`;
      message.success(aviso);
      qc.invalidateQueries({ queryKey: ['tienda-orders'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.error || e.message),
  });

  const reenviarMut = useMutation({
    mutationFn: (id: number) => tiendaOrdersApi.reenviarMail(id),
    onSuccess: () => {
      message.success('Mail de comprobante reenviado');
      qc.invalidateQueries({ queryKey: ['tienda-orders'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.error || e.message),
  });

  const handleActualizar = async () => {
    await qc.invalidateQueries({ queryKey: ['tienda-orders'] });
    await qc.refetchQueries({ queryKey: ['tienda-orders'], type: 'active' });
  };

  const columns: ColumnsType<TiendaOrder> = useMemo(() => [
    {
      title: 'Pedido',
      dataIndex: 'EXTERNAL_ORDER_ID',
      width: 180,
      render: (v: string, row) => (
        <div>
          <Text strong>#{v}</Text>
          <div><Text type="secondary" style={{ fontSize: 11 }}>{row.TIENDA_ORIGEN}</Text></div>
        </div>
      ),
    },
    {
      title: 'Fecha',
      dataIndex: 'CREATED_AT',
      width: 130,
      render: (v: string) => dayjs(v).format('DD/MM/YY HH:mm'),
    },
    {
      title: 'Cliente',
      dataIndex: 'CLIENTE_NOMBRE',
      render: (_: any, row) => (
        <div>
          <div>{row.CLIENTE_NOMBRE || <Text type="secondary">— sin nombre —</Text>}</div>
          {row.CLIENTE_EMAIL && (
            <Text type="secondary" style={{ fontSize: 11 }}>{row.CLIENTE_EMAIL}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      width: 110,
      align: 'right',
      render: (v: number | null) => v != null ? `$ ${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` : '—',
    },
    {
      title: 'Pago',
      dataIndex: 'PAGO_METODO',
      width: 130,
      render: (v: string | null, row) => v
        ? <Tag color={row.PAGO_ESTADO === 'APROBADO' ? 'green' : 'orange'}>{v}</Tag>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Estado',
      dataIndex: 'ESTADO',
      width: 110,
      render: (v: TiendaOrderEstado) => (
        <Tag color={ESTADO_COLORS[v]}>{ESTADO_LABELS[v]}</Tag>
      ),
    },
    {
      title: 'Comprobante',
      width: 140,
      render: (_: any, row) => row.CAE
        ? <Tooltip title={`CAE: ${row.CAE}`}><Tag color="green">{row.COMPROBANTE_NUMERO || 'OK'}</Tag></Tooltip>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Acciones',
      width: 280,
      fixed: 'right',
      render: (_: any, row) => (
        <Space size="small">
          <Tooltip title="Ver detalle">
            <Button size="small" icon={<EyeOutlined />} onClick={() => onOpenDetail(row.TIENDA_ORDER_ID)} />
          </Tooltip>
          {row.ESTADO === 'PENDIENTE' && (
            <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => setProcesarOpen(row)}>
              Procesar
            </Button>
          )}
          {row.ESTADO === 'PROCESADO' && !row.FACTURADO && (
            <Popconfirm
              title="Emitir factura electrónica"
              description={`Se emitirá factura por la venta #${row.VENTA_ID} y se enviará por mail a ${row.CLIENTE_EMAIL || 'el cliente (si tiene mail)'}.`}
              okText="Facturar"
              onConfirm={() => facturarMut.mutate(row.TIENDA_ORDER_ID)}
            >
              <Button size="small" icon={<FileTextOutlined />} loading={facturarMut.isPending}>Facturar</Button>
            </Popconfirm>
          )}
          {row.ESTADO === 'FACTURADO' && row.CLIENTE_EMAIL && (
            <Tooltip title="Reenviar comprobante por mail">
              <Button size="small" icon={<MailOutlined />} onClick={() => reenviarMut.mutate(row.TIENDA_ORDER_ID)} loading={reenviarMut.isPending} />
            </Tooltip>
          )}
          {(row.ESTADO === 'PENDIENTE' || row.ESTADO === 'PROCESADO') && (
            <Button size="small" danger icon={<CloseCircleOutlined />} onClick={() => setCancelarOpen(row)}>
              Cancelar
            </Button>
          )}
        </Space>
      ),
    },
  ], [facturarMut, reenviarMut, onOpenDetail]);

  return (
    <>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <Button icon={<ReloadOutlined />} onClick={handleActualizar} loading={isFetching}>
          Actualizar
        </Button>
      </div>
      <Table
        rowKey="TIENDA_ORDER_ID"
        size="small"
        loading={isFetching}
        dataSource={data?.items ?? []}
        columns={columns}
        pagination={{ pageSize: 20, showSizeChanger: false, total: data?.total ?? 0 }}
        scroll={{ x: 1100 }}
        locale={{ emptyText: <Empty description="No hay pedidos en este estado" /> }}
      />

      {procesarOpen && (
        <ProcesarModal
          order={procesarOpen}
          onClose={() => setProcesarOpen(null)}
          onDone={() => qc.invalidateQueries({ queryKey: ['tienda-orders'] })}
        />
      )}

      {cancelarOpen && (
        <CancelarModal
          order={cancelarOpen}
          onClose={() => setCancelarOpen(null)}
          onDone={() => qc.invalidateQueries({ queryKey: ['tienda-orders'] })}
        />
      )}
    </>
  );
}

// ─────────────────────────────────────────────────
//  Modal: Procesar (convertir en Venta)
// ─────────────────────────────────────────────────

type DepositoSelectable = Deposito & { ES_PREFERIDO?: boolean };

function ProcesarModal({
  order, onClose, onDone,
}: { order: TiendaOrder; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ clienteId?: number; puntoVentaId?: number; depositoId?: number }>();
  const puntoVentaId = Form.useWatch('puntoVentaId', form) as number | undefined;

  const { data: miCaja } = useQuery({
    queryKey: ['mi-caja'],
    queryFn: () => cajaApi.getMiCaja(),
    staleTime: 30_000,
  });

  const { data: depositos = [] } = useQuery<DepositoSelectable[]>({
    queryKey: ['tienda-orders', 'depositos', puntoVentaId ?? 'all'],
    queryFn: async () => {
      if (puntoVentaId) {
        const list = await salesApi.getDepositosPV(puntoVentaId);
        return list.map(d => ({ ...d, ES_PREFERIDO: d.ES_PREFERIDO }));
      }
      const list = await salesApi.getDepositos();
      return list.map(d => ({ ...d, ES_PREFERIDO: false }));
    },
    staleTime: 60_000,
  });

  const { data: metodosPago = [] } = useQuery<MetodoPago[]>({
    queryKey: ['tienda-orders', 'active-payment-methods'],
    queryFn: () => salesApi.getActivePaymentMethods(),
    staleTime: 60_000,
  });

  const metodosPagoOrdenados = useMemo(() => {
    const copy = [...metodosPago];
    copy.sort((a, b) => {
      const aScore = a.CATEGORIA === 'EFECTIVO' && a.POR_DEFECTO ? 0 : a.CATEGORIA === 'EFECTIVO' ? 1 : 2;
      const bScore = b.CATEGORIA === 'EFECTIVO' && b.POR_DEFECTO ? 0 : b.CATEGORIA === 'EFECTIVO' ? 1 : 2;
      if (aScore !== bScore) return aScore - bScore;
      return a.NOMBRE.localeCompare(b.NOMBRE);
    });
    return copy;
  }, [metodosPago]);

  const metodosPagoProcesables = useMemo(
    () => metodosPagoOrdenados.filter(m => m.CATEGORIA !== 'CHEQUES'),
    [metodosPagoOrdenados],
  );

  const total = Number(order.TOTAL ?? 0);

  const defaultDepositoId = useMemo(() => {
    const preferido = depositos.find(d => d.ES_PREFERIDO);
    return preferido?.DEPOSITO_ID ?? depositos[0]?.DEPOSITO_ID ?? null;
  }, [depositos]);

  const defaultMetodoId = useMemo(() => {
    const preferido = metodosPagoProcesables.find(m => m.CATEGORIA === 'EFECTIVO' && m.POR_DEFECTO);
    if (preferido) return preferido.METODO_PAGO_ID;
    const efectivo = metodosPagoProcesables.find(m => m.CATEGORIA === 'EFECTIVO');
    if (efectivo) return efectivo.METODO_PAGO_ID;
    return metodosPagoProcesables[0]?.METODO_PAGO_ID ?? null;
  }, [metodosPagoProcesables]);

  const [selectedMetodos, setSelectedMetodos] = useState<number[]>([]);
  const [montosPorMetodo, setMontosPorMetodo] = useState<Record<number, number>>({});
  const [metodoModalOpen, setMetodoModalOpen] = useState(false);
  const [metodoModalSelection, setMetodoModalSelection] = useState<number[]>([]);

  useEffect(() => {
    form.resetFields();
    form.setFieldsValue({ clienteId: order.CLIENTE_ID ?? undefined, puntoVentaId: undefined, depositoId: undefined });
    setSelectedMetodos([]);
    setMontosPorMetodo({});
    setMetodoModalSelection([]);
  }, [form, order.CLIENTE_ID, order.TIENDA_ORDER_ID]);

  useEffect(() => {
    if (defaultDepositoId == null) return;
    const currentDepositoId = form.getFieldValue('depositoId');
    const stillValid = currentDepositoId != null && depositos.some(d => d.DEPOSITO_ID === currentDepositoId);
    if (!stillValid) {
      form.setFieldsValue({ depositoId: defaultDepositoId });
    }
  }, [defaultDepositoId, depositos, form]);

  useEffect(() => {
    if (selectedMetodos.length !== 1) return;
    const id = selectedMetodos[0]!;
    setMontosPorMetodo(prev => {
      if (prev[id] != null && prev[id] > 0) return prev;
      return { ...prev, [id]: total };
    });
  }, [selectedMetodos, total]);

  useEffect(() => {
    if (selectedMetodos.length === 0 && defaultMetodoId != null) {
      setSelectedMetodos([defaultMetodoId]);
      setMetodoModalSelection([defaultMetodoId]);
      setMontosPorMetodo({ [defaultMetodoId]: total });
    }
  }, [defaultMetodoId, selectedMetodos.length, total]);

  const procesarMut = useMutation({
    mutationFn: (payload: ProcesarOrderInput) => tiendaOrdersApi.procesar(order.TIENDA_ORDER_ID, payload),
    onSuccess: r => {
      message.success(`Pedido convertido en Venta #${r.ventaId}`);
      onDone();
      onClose();
    },
    onError: (e: any) => message.error(e?.response?.data?.error || e.message),
  });

  const totalRecibido = useMemo(
    () => selectedMetodos.reduce((sum, id) => sum + (montosPorMetodo[id] || 0), 0),
    [selectedMetodos, montosPorMetodo],
  );

  const handleOk = async () => {
    try {
      if (!miCaja) {
        message.warning('Para procesar un pedido debe haber una caja abierta');
        return;
      }

      const values = await form.validateFields();
      if (selectedMetodos.length === 0) {
        message.warning('Seleccione al menos un método de pago');
        return;
      }

      const metodos_pago = selectedMetodos
        .map(id => ({ METODO_PAGO_ID: id, MONTO: Number(montosPorMetodo[id] || 0) }))
        .filter(item => item.MONTO > 0);

      if (metodos_pago.length === 0) {
        message.warning('Complete el monto de al menos un método de pago');
        return;
      }

      if (Math.abs(totalRecibido - total) >= 0.01) {
        message.warning('El total de los métodos de pago debe coincidir con el total del pedido');
        return;
      }

      const payload: ProcesarOrderInput = {
        clienteId: values.clienteId || undefined,
        puntoVentaId: values.puntoVentaId || undefined,
        depositoId: values.depositoId || undefined,
        metodos_pago,
      };

      procesarMut.mutate(payload);
    } catch {
      // validation error
    }
  };

  const confirmMetodoSelection = () => {
    if (metodoModalSelection.length === 0) return;
    setSelectedMetodos(metodoModalSelection);
    setMontosPorMetodo(prev => {
      const next: Record<number, number> = {};
      for (const id of metodoModalSelection) {
        next[id] = prev[id] ?? (metodoModalSelection.length === 1 ? total : 0);
      }
      return next;
    });
    setMetodoModalOpen(false);
  };

  return (
    <>
      <Modal
        open
        title={`Procesar pedido #${order.EXTERNAL_ORDER_ID}`}
        onCancel={onClose}
        okText="Procesar y crear venta"
        onOk={handleOk}
        confirmLoading={procesarMut.isPending}
        okButtonProps={{ disabled: !miCaja }}
        width={680}
        destroyOnClose
      >
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Se creará una <b>Venta</b> en RG WEB con los items del pedido. Elegí el depósito para descontar stock y el desglose real de pago antes de confirmar.
        </Paragraph>

        {!miCaja && (
          <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8, background: '#fff7e6', border: '1px solid #ffd591' }}>
            <Text type="warning">No hay caja abierta. Abrí una caja antes de procesar este pedido.</Text>
          </div>
        )}

        <Form form={form} layout="vertical" initialValues={{ clienteId: order.CLIENTE_ID ?? undefined }}>
          <Form.Item label="Cliente (ID en RG WEB)" name="clienteId">
            <InputNumber placeholder="Default de Integraciones" style={{ width: '100%' }} min={1} />
          </Form.Item>

          <Form.Item label="Punto de venta (ID)" name="puntoVentaId">
            <InputNumber placeholder="Default de Integraciones" style={{ width: '100%' }} min={1} />
          </Form.Item>

          <Form.Item
            label="Depósito para descontar stock"
            name="depositoId"
            rules={[{ required: true, message: 'Seleccione un depósito' }]}
          >
            <Select
              placeholder="Seleccione un depósito"
              loading={depositos.length === 0}
              options={depositos.map(d => ({
                value: d.DEPOSITO_ID,
                label: d.ES_PREFERIDO ? `${d.NOMBRE} (preferido)` : d.NOMBRE,
              }))}
            />
          </Form.Item>

          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text type="secondary">Métodos de pago</Text>
              <Button
                type="link"
                size="small"
                onClick={() => {
                  setMetodoModalSelection([...selectedMetodos]);
                  setMetodoModalOpen(true);
                }}
              >
                {selectedMetodos.length > 0 ? 'Cambiar' : 'Seleccionar'}
              </Button>
            </div>

            {selectedMetodos.length === 0 ? (
              <div style={{ border: '1px dashed #d9d9d9', borderRadius: 8, padding: '18px 16px', textAlign: 'center' }}>
                <WalletOutlined style={{ fontSize: 24, color: '#999', display: 'block', marginBottom: 6 }} />
                <Text type="secondary">Seleccione métodos de pago</Text>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                {selectedMetodos.map(id => {
                  const metodo = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                  if (!metodo) return null;
                  return (
                    <Tag key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: 13 }}>
                      {metodo.IMAGEN_BASE64 ? (
                        <img src={metodo.IMAGEN_BASE64} alt={metodo.NOMBRE} style={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 2 }} />
                      ) : (
                        metodo.CATEGORIA === 'EFECTIVO'
                          ? <DollarOutlined />
                          : metodo.CATEGORIA === 'CHEQUES'
                            ? <BankOutlined />
                            : <CreditCardOutlined />
                      )}
                      {metodo.NOMBRE}
                    </Tag>
                  );
                })}
              </div>
            )}
          </div>

          {selectedMetodos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {selectedMetodos.map(id => {
                const metodo = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                if (!metodo) return null;
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 140 }}>
                      {metodo.IMAGEN_BASE64 ? (
                        <img src={metodo.IMAGEN_BASE64} alt={metodo.NOMBRE} style={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 3 }} />
                      ) : (
                        metodo.CATEGORIA === 'EFECTIVO'
                          ? <DollarOutlined style={{ color: '#52c41a' }} />
                          : metodo.CATEGORIA === 'CHEQUES'
                            ? <BankOutlined style={{ color: '#d48806' }} />
                            : <CreditCardOutlined style={{ color: '#1890ff' }} />
                      )}
                      <Text style={{ fontSize: 13 }}>{metodo.NOMBRE}</Text>
                    </div>
                    <InputNumber
                      min={0}
                      step={100}
                      precision={2}
                      prefix="$"
                      style={{ flex: 1 }}
                      controls={false}
                      value={montosPorMetodo[id] || 0}
                      onChange={val => setMontosPorMetodo(prev => ({ ...prev, [id]: val || 0 }))}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ background: '#f5f5f5', borderRadius: 8, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <Text strong style={{ fontSize: 15 }}>Total pedido:</Text>
            <Text strong style={{ fontSize: 18, color: total > 0 ? '#3f8600' : '#999' }}>
              $ {total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
            </Text>
          </div>

          {selectedMetodos.length > 0 && Math.abs(totalRecibido - total) >= 0.01 && (
            <Text type="danger" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              El total cargado en métodos de pago debe coincidir con el total del pedido.
            </Text>
          )}
        </Form>
      </Modal>

      <Modal
        open={metodoModalOpen}
        onCancel={() => setMetodoModalOpen(false)}
        centered
        width={520}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
        title={
          <Space>
            <WalletOutlined style={{ color: '#EABD23', fontSize: 20 }} />
            <span>Seleccionar método de pago</span>
          </Space>
        }
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => setMetodoModalOpen(false)}>Cancelar</Button>
            <Button type="primary" className="btn-gold" disabled={metodoModalSelection.length === 0} onClick={confirmMetodoSelection} icon={<CheckCircleOutlined />}>
              Confirmar ({metodoModalSelection.length})
            </Button>
          </div>
        }
      >
        <div style={{ marginTop: 12 }}>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 12, display: 'block' }}>
            Seleccione uno o más métodos. Si elige varios, podrá distribuir el monto total del pedido.
          </Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, padding: 6 }}>
            {metodosPagoProcesables.map(m => {
              const isSelected = metodoModalSelection.includes(m.METODO_PAGO_ID);
              return (
                <div
                  key={m.METODO_PAGO_ID}
                  onClick={() => setMetodoModalSelection(prev => (
                    isSelected
                      ? prev.filter(id => id !== m.METODO_PAGO_ID)
                      : [...prev, m.METODO_PAGO_ID]
                  ))}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: '22px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                    border: isSelected ? '2px solid #EABD23' : '1px solid #d9d9d9',
                    background: isSelected ? 'rgba(234, 189, 35, 0.08)' : 'transparent',
                    transition: 'all 0.15s', position: 'relative',
                  }}
                >
                  {m.IMAGEN_BASE64 ? (
                    <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 6 }} />
                  ) : (
                    <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: isSelected ? '#EABD23' : '#999' }}>
                      {m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined /> : m.CATEGORIA === 'CHEQUES' ? <BankOutlined /> : <CreditCardOutlined />}
                    </div>
                  )}
                  <Text strong style={{ fontSize: 13, lineHeight: 1.2 }}>{m.NOMBRE}</Text>
                  <Tag color={m.CATEGORIA === 'EFECTIVO' ? 'green' : m.CATEGORIA === 'CHEQUES' ? 'orange' : 'blue'} style={{ fontSize: 10, margin: 0 }}>
                    {m.CATEGORIA}
                  </Tag>
                  {isSelected && (
                    <CheckCircleOutlined style={{ color: '#EABD23', fontSize: 16, position: 'absolute', top: 6, right: 6 }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────
//  Modal: Cancelar
// ─────────────────────────────────────────────────

function CancelarModal({
  order, onClose, onDone,
}: { order: TiendaOrder; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [motivo, setMotivo] = useState('');

  const cancelarMut = useMutation({
    mutationFn: () => tiendaOrdersApi.cancelar(order.TIENDA_ORDER_ID, motivo),
    onSuccess: () => {
      message.success('Pedido cancelado');
      onDone();
      onClose();
    },
    onError: (e: any) => message.error(e?.response?.data?.error || e.message),
  });

  return (
    <Modal
      open
      title={`Cancelar pedido #${order.EXTERNAL_ORDER_ID}`}
      okText="Cancelar pedido"
      okButtonProps={{ danger: true }}
      cancelText="Volver"
      onCancel={onClose}
      onOk={() => cancelarMut.mutate()}
      confirmLoading={cancelarMut.isPending}
    >
      <Paragraph>
        Esta acción marca el pedido como <b>cancelado</b>. No se podrá facturar después.
      </Paragraph>
      <Input.TextArea
        rows={3}
        value={motivo}
        onChange={e => setMotivo(e.target.value)}
        placeholder="Motivo (opcional)"
        maxLength={500}
        showCount
      />
    </Modal>
  );
}

// ─────────────────────────────────────────────────
//  Drawer: detalle del pedido (con items)
// ─────────────────────────────────────────────────

function OrderDetailDrawer({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tienda-orders', 'detail', orderId],
    queryFn: () => tiendaOrdersApi.get(orderId),
  });

  return (
    <Drawer
      open
      width={680}
      onClose={onClose}
      title={data ? `Pedido #${data.EXTERNAL_ORDER_ID}` : 'Pedido'}
      loading={isLoading}
    >
      {data && <OrderDetailContent order={data} />}
    </Drawer>
  );
}

function OrderDetailContent({ order }: { order: TiendaOrderWithItems }) {
  const total = order.TOTAL ?? order.items.reduce((s, i) => s + Number(i.SUBTOTAL ?? i.PRECIO_UNITARIO * i.CANTIDAD), 0);

  return (
    <>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="Tienda">{order.TIENDA_ORIGEN}</Descriptions.Item>
          <Descriptions.Item label="Estado">
            <Tag color={ESTADO_COLORS[order.ESTADO]}>{ESTADO_LABELS[order.ESTADO]}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Recibido">{dayjs(order.CREATED_AT).format('DD/MM/YY HH:mm')}</Descriptions.Item>
          <Descriptions.Item label="Pedido (fecha)">
            {dayjs(order.FECHA_PEDIDO).format('DD/MM/YY HH:mm')}
          </Descriptions.Item>
          <Descriptions.Item label="Venta vinculada" span={2}>
            {order.VENTA_ID ? <Tag color="blue">Venta #{order.VENTA_ID}</Tag> : <Text type="secondary">— sin procesar —</Text>}
          </Descriptions.Item>
          {order.CAE && (
            <Descriptions.Item label="Comprobante" span={2}>
              <Space>
                <Tag color="green" icon={<FilePdfOutlined />}>{order.COMPROBANTE_NUMERO}</Tag>
                <Text type="secondary">CAE: {order.CAE}</Text>
                {order.EMAIL_ENVIADO_AT && (
                  <Tag color="cyan" icon={<MailOutlined />}>
                    Enviado: {dayjs(order.EMAIL_ENVIADO_AT).format('DD/MM HH:mm')}
                  </Tag>
                )}
              </Space>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      <Card size="small" title="Cliente" style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="Nombre">{order.CLIENTE_NOMBRE || '—'}</Descriptions.Item>
          <Descriptions.Item label="Documento">
            {order.CLIENTE_TIPO_DOC} {order.CLIENTE_DOCUMENTO || '—'}
          </Descriptions.Item>
          <Descriptions.Item label="Email">{order.CLIENTE_EMAIL || '—'}</Descriptions.Item>
          <Descriptions.Item label="Teléfono">{order.CLIENTE_TELEFONO || '—'}</Descriptions.Item>
          <Descriptions.Item label="Dirección" span={2}>
            {[order.CLIENTE_DIRECCION, order.CLIENTE_LOCALIDAD, order.CLIENTE_PROVINCIA, order.CLIENTE_CP]
              .filter(Boolean).join(', ') || '—'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title="Pago y envío" style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="Método pago">{order.PAGO_METODO || '—'}</Descriptions.Item>
          <Descriptions.Item label="Estado pago">{order.PAGO_ESTADO || '—'}</Descriptions.Item>
          <Descriptions.Item label="Ref. pago">{order.PAGO_REFERENCIA || '—'}</Descriptions.Item>
          <Descriptions.Item label="Envío">{order.ENVIO_METODO || '—'}</Descriptions.Item>
          <Descriptions.Item label="Costo envío">
            {order.ENVIO_COSTO != null ? `$ ${Number(order.ENVIO_COSTO).toLocaleString('es-AR')}` : '—'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title={`Items (${order.items.length})`}>
        <Table
          rowKey="ITEM_ID"
          size="small"
          pagination={false}
          dataSource={order.items}
          columns={[
            { title: 'Producto', dataIndex: 'NOMBRE', render: (v: string | null, r) => (
              <div>
                <div>{v || `Producto #${r.PRODUCTO_ID ?? r.SKU ?? '?'}`}</div>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {r.PRODUCTO_ID ? `RG WEB #${r.PRODUCTO_ID}` : `SKU ${r.SKU}`}
                </Text>
              </div>
            )},
            { title: 'Cant.', dataIndex: 'CANTIDAD', width: 70, align: 'right' },
            { title: 'P. Unit.', dataIndex: 'PRECIO_UNITARIO', width: 100, align: 'right',
              render: (v: number) => `$ ${Number(v).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
            { title: 'Dto%', dataIndex: 'DESCUENTO', width: 70, align: 'right',
              render: (v: number) => v ? `${v}%` : '—' },
            { title: 'Subtotal', dataIndex: 'SUBTOTAL', width: 110, align: 'right',
              render: (v: number | null, r) => `$ ${Number(v ?? r.PRECIO_UNITARIO * r.CANTIDAD).toLocaleString('es-AR', { minimumFractionDigits: 2 })}` },
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4} align="right">
                <Text strong>Total</Text>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right">
                <Text strong style={{ color: '#52c41a' }}>
                  <DollarOutlined /> $ {Number(total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </Text>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </Card>

      {order.OBSERVACIONES && (
        <Card size="small" title="Observaciones" style={{ marginTop: 12 }}>
          <Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{order.OBSERVACIONES}</Paragraph>
        </Card>
      )}

      {order.CANCELACION_MOTIVO && (
        <Card size="small" title="Motivo de cancelación" style={{ marginTop: 12 }}>
          <Paragraph style={{ margin: 0 }}>{order.CANCELACION_MOTIVO}</Paragraph>
        </Card>
      )}
    </>
  );
}
