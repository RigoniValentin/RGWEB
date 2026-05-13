import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Tabs, Button, Table, Tag, Modal, Form, Input, Switch, InputNumber, Space,
  Typography, Alert, App, Popconfirm, Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  KeyOutlined, LinkOutlined, HistoryOutlined, PlusOutlined, DeleteOutlined,
  StopOutlined, CopyOutlined, ReloadOutlined, SendOutlined, CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  integracionesApi,
  type ApiKey,
  type ApiKeyCreated,
  type SyncLog,
} from '../services/integraciones.api';

const { Title, Text, Paragraph } = Typography;

// ═══════════════════════════════════════════════════
//  Página: Integraciones Externas
//
//  Tres bloques:
//   1. API Keys — crear / revocar / eliminar
//   2. Webhook — URL, secret, habilitado, test
//   3. Logs — últimas 10 sincronizaciones
// ═══════════════════════════════════════════════════

export function IntegracionesPage() {
  // ── Tabs ──────────────────────────────────────────
  const [tab, setTab] = useState<'keys' | 'config' | 'logs'>('keys');

  return (
    <div style={{ padding: 16 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        <LinkOutlined /> Integraciones Externas
      </Title>
      <Paragraph type="secondary">
        Exponé el sistema vía API segura para sincronizar stock y pedidos con la tienda online
        y la app móvil. La conexión se realiza a través de Cloudflare Tunnel.
      </Paragraph>

      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as typeof tab)}
        items={[
          { key: 'keys',   label: <span><KeyOutlined /> API Keys</span>,    children: <ApiKeysSection /> },
          { key: 'config', label: <span><LinkOutlined /> Webhook</span>,    children: <WebhookConfigSection /> },
          { key: 'logs',   label: <span><HistoryOutlined /> Logs</span>,    children: <SyncLogsSection /> },
        ]}
      />

      <Card size="small" style={{ marginTop: 16, background: '#fafafa' }}>
        <Text strong>Endpoints disponibles:</Text>
        <pre style={{ margin: '8px 0 0', fontSize: 12, color: '#555' }}>
{`GET  /api/external/sync-stock   →  Listado de productos VENTA_WEB
POST /api/external/orders       →  Recibir pedido desde la tienda
GET  /api/external/health       →  Health check

Headers requeridos:
  x-api-key: <api_key>            (tienda online)
    o
  Authorization: Bearer <jwt>     (app móvil)`}
        </pre>
      </Card>
    </div>
  );

  // ─── (helpers — see below) ───
}

// ═══════════════════════════════════════════════════
//  Section: API Keys
// ═══════════════════════════════════════════════════

function ApiKeysSection() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealed, setRevealed] = useState<ApiKeyCreated | null>(null);
  const [form] = Form.useForm<{ nombre: string; scopes?: string; notas?: string }>();

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['integraciones', 'api-keys'],
    queryFn: () => integracionesApi.listApiKeys(),
  });

  const createMut = useMutation({
    mutationFn: integracionesApi.createApiKey,
    onSuccess: (created) => {
      message.success('API Key generada. Copiala ahora — no se mostrará nuevamente.');
      setRevealed(created);
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['integraciones', 'api-keys'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.error || e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => integracionesApi.revokeApiKey(id),
    onSuccess: () => {
      message.success('API Key revocada');
      qc.invalidateQueries({ queryKey: ['integraciones', 'api-keys'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.error || e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => integracionesApi.deleteApiKey(id),
    onSuccess: () => {
      message.success('API Key eliminada');
      qc.invalidateQueries({ queryKey: ['integraciones', 'api-keys'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.error || e.message),
  });

  const columns: ColumnsType<ApiKey> = [
    { title: 'Nombre', dataIndex: 'NOMBRE', key: 'nombre' },
    {
      title: 'Prefijo',
      dataIndex: 'KEY_PREFIX',
      key: 'prefix',
      width: 110,
      render: (v: string) => <Text code>{v}…</Text>,
    },
    {
      title: 'Estado',
      dataIndex: 'ACTIVA',
      key: 'activa',
      width: 110,
      render: (v: boolean, r) =>
        r.REVOKED_AT
          ? <Tag color="red">Revocada</Tag>
          : v ? <Tag color="green">Activa</Tag> : <Tag>Inactiva</Tag>,
    },
    { title: 'Scopes', dataIndex: 'SCOPES', key: 'scopes', render: (v) => v || <Text type="secondary">—</Text> },
    {
      title: 'Creada',
      dataIndex: 'CREATED_AT',
      key: 'created',
      width: 150,
      render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'),
    },
    {
      title: 'Último uso',
      dataIndex: 'LAST_USED_AT',
      key: 'last',
      width: 150,
      render: (v: string | null) => v ? dayjs(v).format('DD/MM/YYYY HH:mm') : <Text type="secondary">nunca</Text>,
    },
    {
      title: 'Acciones',
      key: 'acc',
      width: 200,
      render: (_: any, r) => (
        <Space>
          {r.ACTIVA && (
            <Popconfirm title="¿Revocar esta API key?" onConfirm={() => revokeMut.mutate(r.API_KEY_ID)}>
              <Button size="small" icon={<StopOutlined />} danger>Revocar</Button>
            </Popconfirm>
          )}
          <Popconfirm title="¿Eliminar definitivamente?" onConfirm={() => deleteMut.mutate(r.API_KEY_ID)}>
            <Button size="small" icon={<DeleteOutlined />} danger type="text" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="API Keys"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
          Generar nueva
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Las API keys se muestran en claro UNA SOLA VEZ al crearse. Guardalas en un lugar seguro."
      />
      <Table<ApiKey>
        rowKey="API_KEY_ID"
        loading={isLoading}
        dataSource={keys}
        columns={columns}
        size="small"
        pagination={false}
      />

      <Modal
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        title="Generar API Key"
        onOk={() => form.submit()}
        confirmLoading={createMut.isPending}
        okText="Generar"
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(v) => createMut.mutate({
            nombre: v.nombre,
            scopes: v.scopes,
            notas: v.notas,
          })}
        >
          <Form.Item label="Nombre" name="nombre" rules={[{ required: true, message: 'Requerido' }]}>
            <Input placeholder="Ej: Tienda online producción" />
          </Form.Item>
          <Form.Item label="Scopes (opcional, separados por coma)" name="scopes">
            <Input placeholder="sync_stock,orders" />
          </Form.Item>
          <Form.Item label="Notas" name="notas">
            <Input.TextArea rows={2} placeholder="Descripción opcional" />
          </Form.Item>
        </Form>
      </Modal>

      {revealed && (
        <Modal
          open={!!revealed}
          onCancel={() => setRevealed(null)}
          title="API Key generada"
          footer={<Button type="primary" onClick={() => setRevealed(null)}>Entendido</Button>}
        >
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Copiá esta clave AHORA. Una vez cerrada esta ventana no se podrá ver de nuevo."
          />
          <Input.Group compact>
            <Input value={revealed.RAW_KEY} readOnly style={{ width: 'calc(100% - 80px)' }} />
            <Button
              icon={<CopyOutlined />}
              onClick={() => {
                navigator.clipboard.writeText(revealed.RAW_KEY);
                message.success('Copiada al portapapeles');
              }}
            >
              Copiar
            </Button>
          </Input.Group>
        </Modal>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════
//  Section: Webhook Config
// ═══════════════════════════════════════════════════

function WebhookConfigSection() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [form] = Form.useForm();

  const { data: config, isLoading } = useQuery({
    queryKey: ['integraciones', 'config'],
    queryFn: () => integracionesApi.getConfig(),
  });

  const updateMut = useMutation({
    mutationFn: integracionesApi.updateConfig,
    onSuccess: () => {
      message.success('Configuración guardada');
      qc.invalidateQueries({ queryKey: ['integraciones', 'config'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.error || e.message),
  });

  const testMut = useMutation({
    mutationFn: integracionesApi.testWebhook,
    onSuccess: (r) => r.ok ? message.success(r.message) : message.error(r.message),
    onError: (e: any) => message.error(e?.response?.data?.message || e.message),
  });

  if (isLoading || !config) return <Card loading />;

  return (
    <Card
      title="Webhook hacia la tienda online"
      extra={
        <Button icon={<SendOutlined />} loading={testMut.isPending} onClick={() => testMut.mutate()}>
          Probar conexión
        </Button>
      }
    >
      <Form
        layout="vertical"
        form={form}
        initialValues={{
          webhook_url: config.webhook_url,
          webhook_enabled: config.webhook_enabled,
          webhook_max_retries: config.webhook_max_retries,
          orders_default_cliente_id: config.orders_default_cliente_id,
          orders_default_punto_venta_id: config.orders_default_punto_venta_id,
        }}
        onFinish={(v) => updateMut.mutate(v)}
      >
        <Form.Item
          label="URL del Webhook (POST hacia tu VPS)"
          name="webhook_url"
          rules={[{ type: 'url', message: 'URL inválida' }]}
        >
          <Input placeholder="https://tienda.midominio.com/api/webhooks/riogestion" />
        </Form.Item>

        <Form.Item label="Secret (HMAC SHA-256)" extra={config.webhook_secret_set ? 'Configurado. Dejá vacío para mantener el actual.' : 'Sin configurar.'}>
          <Form.Item name="webhook_secret" noStyle>
            <Input.Password
              placeholder={config.webhook_secret_set ? '••••••••' : 'Ingresá un secret seguro'}
              autoComplete="new-password"
            />
          </Form.Item>
        </Form.Item>

        <Space size="large" style={{ width: '100%' }}>
          <Form.Item label="Webhook habilitado" name="webhook_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="Reintentos máximos" name="webhook_max_retries">
            <InputNumber min={0} max={10} />
          </Form.Item>
        </Space>

        <Title level={5} style={{ marginTop: 8 }}>Defaults para pedidos entrantes</Title>
        <Space size="large" style={{ width: '100%' }}>
          <Form.Item label="Cliente por defecto (ID)" name="orders_default_cliente_id" tooltip="ID del cliente genérico para pedidos web">
            <InputNumber min={1} placeholder="Ej: 1" />
          </Form.Item>
          <Form.Item label="Punto de venta por defecto (ID)" name="orders_default_punto_venta_id">
            <InputNumber min={1} placeholder="Ej: 1" />
          </Form.Item>
        </Space>

        <Form.Item style={{ marginTop: 16 }}>
          <Button type="primary" htmlType="submit" loading={updateMut.isPending}>
            Guardar configuración
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

// ═══════════════════════════════════════════════════
//  Section: Sync Logs
// ═══════════════════════════════════════════════════

function SyncLogsSection() {
  const { data: logs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ['integraciones', 'logs'],
    queryFn: () => integracionesApi.listLogs(10),
    refetchInterval: 10_000,
  });

  const columns: ColumnsType<SyncLog> = [
    {
      title: 'Fecha',
      dataIndex: 'CREATED_AT',
      key: 'date',
      width: 150,
      render: (v: string) => dayjs(v).format('DD/MM HH:mm:ss'),
    },
    { title: 'Evento', dataIndex: 'EVENT_TYPE', key: 'event', width: 160 },
    {
      title: 'Dir',
      dataIndex: 'DIRECTION',
      key: 'dir',
      width: 90,
      render: (v) => <Tag color={v === 'OUTBOUND' ? 'blue' : 'purple'}>{v}</Tag>,
    },
    {
      title: 'Estado',
      dataIndex: 'STATUS',
      key: 'status',
      width: 110,
      render: (v) =>
        v === 'SUCCESS' ? <Tag icon={<CheckCircleOutlined />} color="success">OK</Tag>
                        : <Tag icon={<CloseCircleOutlined />} color="error">{v}</Tag>,
    },
    { title: 'HTTP', dataIndex: 'HTTP_STATUS', key: 'http', width: 70 },
    {
      title: 'Duración',
      dataIndex: 'DURATION_MS',
      key: 'dur',
      width: 90,
      render: (v: number | null) => v != null ? `${v} ms` : '—',
    },
    {
      title: 'Detalle',
      key: 'detail',
      render: (_: any, r) => (
        <Tooltip title={r.ERROR_MESSAGE || r.RESPONSE_BODY || r.REQUEST_BODY || '—'}>
          <Text style={{ fontSize: 12 }} ellipsis>
            {r.ERROR_MESSAGE || r.RESPONSE_BODY?.slice(0, 100) || r.TARGET_URL || '—'}
          </Text>
        </Tooltip>
      ),
    },
  ];

  return (
    <Card
      title="Últimas 10 sincronizaciones"
      extra={
        <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()}>
          Refrescar
        </Button>
      }
    >
      <Table<SyncLog>
        rowKey="LOG_ID"
        loading={isLoading}
        dataSource={logs}
        columns={columns}
        size="small"
        pagination={false}
      />
    </Card>
  );
}
