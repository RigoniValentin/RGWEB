import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Tabs, Table, Tag, Button, Modal, Drawer, Form, Input, InputNumber, Select,
  Typography, Space, Popconfirm, App, Descriptions, Empty, Tooltip, Statistic, Row, Col,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ShoppingOutlined, ReloadOutlined, FileTextOutlined, MailOutlined,
  CheckCircleOutlined, StopOutlined, CloseCircleOutlined, DollarOutlined,
  ClockCircleOutlined, FilePdfOutlined, EyeOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  tiendaOrdersApi,
  type TiendaOrder,
  type TiendaOrderEstado,
  type TiendaOrderWithItems,
} from '../services/tiendaOrders.api';

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
  pendiente: 'gold',
  procesado: 'processing',
  facturado: 'success',
  cancelado: 'default',
};

const ESTADO_LABELS: Record<TiendaOrderEstado, string> = {
  pendiente: 'Pendiente',
  procesado: 'Procesado',
  facturado: 'Facturado',
  cancelado: 'Cancelado',
};

export function PedidosTiendaPage() {
  const [tab, setTab] = useState<TiendaOrderEstado | 'todos'>('pendiente');
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
            { key: 'pendiente', label: `Pendientes (${counts?.pendientes ?? 0})` },
            { key: 'procesado', label: `Procesados (${counts?.procesados ?? 0})` },
            { key: 'facturado', label: `Facturados (${counts?.facturados ?? 0})` },
            { key: 'cancelado', label: `Cancelados (${counts?.cancelados ?? 0})` },
            { key: 'todos', label: 'Todos' },
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
  estado: TiendaOrderEstado | 'todos';
  search: string;
  onOpenDetail: (id: number) => void;
}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [procesarOpen, setProcesarOpen] = useState<TiendaOrder | null>(null);
  const [cancelarOpen, setCancelarOpen] = useState<TiendaOrder | null>(null);

  const { data, isFetching, refetch } = useQuery({
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
        ? <Tag color={row.PAGO_ESTADO === 'aprobado' ? 'green' : 'orange'}>{v}</Tag>
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
          {row.ESTADO === 'pendiente' && (
            <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => setProcesarOpen(row)}>
              Procesar
            </Button>
          )}
          {row.ESTADO === 'procesado' && !row.FACTURADO && (
            <Popconfirm
              title="Emitir factura electrónica"
              description={`Se emitirá factura por la venta #${row.VENTA_ID} y se enviará por mail a ${row.CLIENTE_EMAIL || 'el cliente (si tiene mail)'}.`}
              okText="Facturar"
              onConfirm={() => facturarMut.mutate(row.TIENDA_ORDER_ID)}
            >
              <Button size="small" icon={<FileTextOutlined />} loading={facturarMut.isPending}>Facturar</Button>
            </Popconfirm>
          )}
          {row.ESTADO === 'facturado' && row.CLIENTE_EMAIL && (
            <Tooltip title="Reenviar comprobante por mail">
              <Button size="small" icon={<MailOutlined />} onClick={() => reenviarMut.mutate(row.TIENDA_ORDER_ID)} loading={reenviarMut.isPending} />
            </Tooltip>
          )}
          {(row.ESTADO === 'pendiente' || row.ESTADO === 'procesado') && (
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
        <Button icon={<ReloadOutlined />} onClick={() => refetch()} loading={isFetching}>
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

function ProcesarModal({
  order, onClose, onDone,
}: { order: TiendaOrder; onClose: () => void; onDone: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ clienteId?: number; puntoVentaId?: number; metodoPago: 'EFECTIVO' | 'DIGITAL' | 'CTA_CORRIENTE' }>();

  const procesarMut = useMutation({
    mutationFn: () => {
      const values = form.getFieldsValue();
      return tiendaOrdersApi.procesar(order.TIENDA_ORDER_ID, {
        clienteId: values.clienteId || undefined,
        puntoVentaId: values.puntoVentaId || undefined,
        metodoPago: values.metodoPago,
      });
    },
    onSuccess: r => {
      message.success(`Pedido convertido en Venta #${r.ventaId}`);
      onDone();
      onClose();
    },
    onError: (e: any) => message.error(e?.response?.data?.error || e.message),
  });

  return (
    <Modal
      open
      title={`Procesar pedido #${order.EXTERNAL_ORDER_ID}`}
      onCancel={onClose}
      okText="Procesar y crear venta"
      onOk={() => procesarMut.mutate()}
      confirmLoading={procesarMut.isPending}
      width={560}
    >
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        Se creará una <b>Venta</b> en RG WEB con los items del pedido. Si dejás vacíos los campos
        de cliente y punto de venta, se usarán los <b>defaults de Integraciones</b>.
      </Paragraph>
      <Form form={form} layout="vertical" initialValues={{ metodoPago: 'EFECTIVO' }}>
        <Form.Item label="Cliente (ID en RG WEB)" name="clienteId">
          <InputNumber placeholder="Default de Integraciones" style={{ width: '100%' }} min={1} />
        </Form.Item>
        <Form.Item label="Punto de venta (ID)" name="puntoVentaId">
          <InputNumber placeholder="Default de Integraciones" style={{ width: '100%' }} min={1} />
        </Form.Item>
        <Form.Item label="Método de pago de la venta" name="metodoPago" rules={[{ required: true }]}>
          <Select options={[
            { value: 'EFECTIVO', label: 'Efectivo' },
            { value: 'DIGITAL', label: 'Digital (transferencia, MP, etc.)' },
            { value: 'CTA_CORRIENTE', label: 'Cuenta corriente' },
          ]}/>
        </Form.Item>
      </Form>
    </Modal>
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
