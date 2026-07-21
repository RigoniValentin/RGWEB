import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, Tabs, Button, Table, Tag, Modal, Form, Input, Switch, InputNumber, Space, Typography, Alert, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  KeyOutlined, LinkOutlined, HistoryOutlined, PlusOutlined, DeleteOutlined,
  StopOutlined, CopyOutlined, ReloadOutlined, SendOutlined, CheckCircleOutlined,
  CloseCircleOutlined, MobileOutlined, QrcodeOutlined, PlayCircleOutlined,
  PauseCircleOutlined, ThunderboltOutlined, DownloadOutlined, DesktopOutlined,
  DisconnectOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import QRCode from 'qrcode';
import {
  integracionesApi,
  type ApiKey,
  type ApiKeyCreated,
  type SyncLog,
} from '../services/integraciones.api';
import { tunnelApi, type TunnelInfo, type MobileDevice } from '../services/tunnel.api';
import { RowContextMenu } from '../components/RowContextMenu';
import { useRowActions, type RowAction } from '../hooks/useRowActions';
import { notify } from '../utils/notify.ts';

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
    <div className="page-enter" style={{ padding: 16 }}>
      <div className="page-header">
        <Title level={3}>
          <LinkOutlined /> Integraciones Externas
        </Title>
      </div>
      <Paragraph type="secondary">
        Exponé el sistema vía API segura para sincronizar stock y pedidos con la tienda online
        y la app móvil. La conexión se realiza a través de Cloudflare Tunnel.
      </Paragraph>

      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as typeof tab)}
        items={[
          { key: 'keys',    label: <span><KeyOutlined /> API Keys</span>,    children: <ApiKeysSection /> },
          { key: 'config',  label: <span><LinkOutlined /> Webhook</span>,    children: <WebhookConfigSection /> },
          { key: 'mobile',  label: <span><MobileOutlined /> Mobile</span>,   children: <MobileTunnelSection /> },
          { key: 'logs',    label: <span><HistoryOutlined /> Logs</span>,    children: <SyncLogsSection /> },
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

  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [revealed, setRevealed] = useState<ApiKeyCreated | null>(null);
  const [showRegisterTokens, setShowRegisterTokens] = useState(false);
  const [form] = Form.useForm<{ nombre: string; scopes?: string; notas?: string }>();

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['integraciones', 'api-keys'],
    queryFn: () => integracionesApi.listApiKeys(),
  });

  const isRegisterToken = (k: ApiKey) => (k.SCOPES ?? '').includes('mobile_register');
  const visibleKeys = showRegisterTokens ? keys : keys.filter((k) => !isRegisterToken(k));
  const hiddenRegisterCount = keys.filter(isRegisterToken).length;

  const createMut = useMutation({
    mutationFn: integracionesApi.createApiKey,
    onSuccess: (created) => {
      notify.success('API Key generada. Copiala ahora — no se mostrará nuevamente.');
      setRevealed(created);
      setCreateOpen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['integraciones', 'api-keys'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || e.message),
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => integracionesApi.revokeApiKey(id),
    onSuccess: () => {
      notify.success('API Key revocada');
      qc.invalidateQueries({ queryKey: ['integraciones', 'api-keys'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => integracionesApi.deleteApiKey(id),
    onSuccess: () => {
      notify.success('API Key eliminada');
      qc.invalidateQueries({ queryKey: ['integraciones', 'api-keys'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || e.message),
  });

  // ── Handlers ─────────────────────────────────────
  const handleOpenCreate = () => setCreateOpen(true);

  const handleRevokeApiKey = (r: ApiKey) => {
    Modal.confirm({
      title: '¿Revocar esta API key?',
      content: 'La clave dejará de funcionar inmediatamente.',
      okText: 'Revocar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: () => revokeMut.mutate(r.API_KEY_ID),
    });
  };

  const handleDeleteApiKey = async (r: ApiKey) => {
    // Chequear cuántos devices mobile están vinculados a esta key
    let deviceCount = 0;
    try {
      const res = await tunnelApi.keyDevicesCount(r.API_KEY_ID);
      deviceCount = res.count;
    } catch {
      deviceCount = 0;
    }

    if (deviceCount > 0) {
      Modal.confirm({
        title: 'Esta API key tiene dispositivos vinculados',
        content: (
          <Space direction="vertical" size="small">
            <span>
              Hay <strong>{deviceCount}</strong> dispositivo(s) mobile usando esta API key.
            </span>
            <span style={{ fontSize: 12 }}>
              Si la eliminás, los devices quedarán con la asociación cortada (quedan como <em>"huérfanos"</em> en el historial pero sin API key funcional). La key en sí se borra.
            </span>
            <span style={{ fontSize: 12 }}>
              Si querés desvincularlos limpiamente primero, andá a la pestaña <strong>Mobile → Dispositivos conectados</strong>.
            </span>
          </Space>
        ),
        okText: `Eliminar de todos modos (${deviceCount} device${deviceCount === 1 ? '' : 's'} quedarán huérfanos)`,
        okType: 'danger',
        cancelText: 'Cancelar',
        onOk: () => deleteMut.mutate(r.API_KEY_ID),
      });
    } else {
      Modal.confirm({
        title: '¿Eliminar definitivamente?',
        content: 'Esta API key no tiene dispositivos mobile vinculados.',
        okText: 'Eliminar',
        okType: 'danger',
        cancelText: 'Cancelar',
        onOk: () => deleteMut.mutate(r.API_KEY_ID),
      });
    }
  };

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
  ];

  const contextMenuActions = useMemo<RowAction<ApiKey>[]>(() => [
    { key: 'revoke', label: 'Revocar', icon: <StopOutlined />, danger: true, disabled: (r) => !r.ACTIVA, onClick: handleRevokeApiKey },
    { key: 'delete', label: 'Eliminar', icon: <DeleteOutlined />, danger: true, onClick: handleDeleteApiKey },
  ], []);

  const { onRow, rowClassName, contextMenu, contextMenuItems, closeContextMenu } = useRowActions<ApiKey>({
    getRowId: (r) => r.API_KEY_ID,
    primaryAction: handleOpenCreate,
    actions: contextMenuActions,
  });

  return (
    <Card
      title={
        <Space>
          <span>API Keys</span>
          {!showRegisterTokens && hiddenRegisterCount > 0 && (
            <Tag color="default">{hiddenRegisterCount} registration token{hiddenRegisterCount === 1 ? '' : 's'} ocultos</Tag>
          )}
        </Space>
      }
      extra={
        <Space>
          <Tooltip title="Los 'registration tokens' son los one-time-use que viajan en el QR de Mobile. Se revocan solos al primer uso. Normalmente no necesitás verlos.">
            <Space size={6}>
              <Text type="secondary" style={{ fontSize: 12 }}>Mostrar QR tokens</Text>
              <Switch size="small" checked={showRegisterTokens} onChange={setShowRegisterTokens} />
            </Space>
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            Generar nueva
          </Button>
        </Space>
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
        dataSource={visibleKeys}
        columns={columns}
        size="small"
        onRow={onRow}
        rowClassName={rowClassName}
        pagination={false}
      />

      <RowContextMenu
        open={contextMenu !== null}
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        items={contextMenuItems}
        onClose={closeContextMenu}
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
                notify.success('Copiada al portapapeles');
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

  const qc = useQueryClient();
  const [form] = Form.useForm();

  const { data: config, isLoading } = useQuery({
    queryKey: ['integraciones', 'config'],
    queryFn: () => integracionesApi.getConfig(),
  });

  const updateMut = useMutation({
    mutationFn: integracionesApi.updateConfig,
    onSuccess: () => {
      notify.success('Configuración guardada');
      qc.invalidateQueries({ queryKey: ['integraciones', 'config'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || e.message),
  });

  const testMut = useMutation({
    mutationFn: integracionesApi.testWebhook,
    onSuccess: (r) => r.ok ? notify.success(r.message) : notify.error(r.message),
    onError: (e: any) => notify.error(e?.response?.data?.message || e.message),
  });

  const pushFullMut = useMutation({
    mutationFn: integracionesApi.pushFullStock,
    onSuccess: (r) => r.ok ? notify.success(r.message) : notify.error(r.message),
    onError: (e: any) => notify.error(e?.response?.data?.message || e.message),
  });

  if (isLoading || !config) return <Card loading />;

  return (
    <Card
      title="Webhook hacia la tienda online"
      extra={
        <Space>
          <Button icon={<SendOutlined />} loading={testMut.isPending} onClick={() => testMut.mutate()}>
            Probar conexión
          </Button>
          <Button type="primary" loading={pushFullMut.isPending} onClick={() => pushFullMut.mutate()}>
            Sincronizar catálogo completo
          </Button>
        </Space>
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

// ═══════════════════════════════════════════════════
//  Section: Mobile Tunnel (Cloudflare Quick Tunnel)
// ═══════════════════════════════════════════════════

function humanAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'instantes';
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d`;
  const mo = Math.floor(d / 30);
  return `${mo} meses`;
}

function formatUptime(sec: number | null): string {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function statusTag(status: TunnelInfo['status']) {
  if (status === 'running')  return <Tag icon={<CheckCircleOutlined />} color="success">Activo</Tag>;
  if (status === 'starting') return <Tag icon={<ThunderboltOutlined />} color="processing">Iniciando…</Tag>;
  if (status === 'error')    return <Tag icon={<CloseCircleOutlined />} color="error">Error</Tag>;
  return <Tag>Detenido</Tag>;
}

function MobileTunnelSection() {
  const qc = useQueryClient();
  const statusQuery = useQuery({
    queryKey: ['tunnel', 'status'],
    queryFn: tunnelApi.status,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'starting' || s === 'error' ? 2000 : 5000;
    },
  });

  const logsQuery = useQuery({
    queryKey: ['tunnel', 'logs'],
    queryFn: () => tunnelApi.logs(50),
    refetchInterval: 5000,
    enabled: statusQuery.data?.status === 'running' || statusQuery.data?.status === 'starting',
  });

  const logsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logsQuery.data]);

  const startMut = useMutation({
    mutationFn: tunnelApi.start,
    onSuccess: () => {
      notify.success('Túnel iniciado');
      statusQuery.refetch();
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || e.message),
  });

  const handleStop = () => {
    Modal.confirm({
      title: '¿Detener el túnel?',
      content: 'La app mobile dejará de poder conectarse hasta que vuelvas a iniciarlo.',
      okText: 'Detener',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: () => {
        tunnelApi.stop()
          .then(() => {
            notify.success('Túnel detenido');
            statusQuery.refetch();
            qc.removeQueries({ queryKey: ['tunnel', 'qr'] });
          })
          .catch((e) => notify.error(e?.response?.data?.error || e.message));
      },
    });
  };

  const checkMut = useMutation({
    mutationFn: tunnelApi.check,
    onSuccess: (r) => {
      if (r.ok) notify.success(`Túnel responde OK (${r.latencyMs} ms)`);
      else notify.error(`Túnel no responde: ${r.error}`);
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || e.message),
  });

  const qrQuery = useQuery({
    queryKey: ['tunnel', 'qr'],
    queryFn: () => tunnelApi.qrPayload(),
    enabled: false,
    retry: false,
  });

  const loadQr = async () => {
    if (statusQuery.data?.status !== 'running') {
      notify.warning('Iniciá el túnel antes de generar el QR');
      return;
    }
    try {
      await qrQuery.refetch();
    } catch (e: any) {
      notify.error(e?.response?.data?.error || e.message);
    }
  };

  const rotateMut = useMutation({
    mutationFn: tunnelApi.rotateToken,
    onSuccess: (r) => {
      notify.success(r.message);
      qc.removeQueries({ queryKey: ['tunnel', 'qr'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || e.message),
  });

  const [qrPngUrl, setQrPngUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!qrQuery.data) {
      setQrPngUrl(null);
      return;
    }
    const json = JSON.stringify(qrQuery.data);
    QRCode.toDataURL(json, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQrPngUrl)
      .catch(() => setQrPngUrl(null));
  }, [qrQuery.data]);

  const downloadQr = () => {
    if (!qrPngUrl || !qrQuery.data) return;
    const a = document.createElement('a');
    a.href = qrPngUrl;
    a.download = `rg-mobile-qr-${Date.now()}.png`;
    a.click();
  };

  const info = statusQuery.data;
  const qr = qrQuery.data;

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="Conexión Mobile vía Cloudflare Tunnel"
        description={
          <span>
            Iniciá el túnel para que la app mobile pueda operar desde 4G u otra red.
            Sin abrir puertos ni VPN. Si el celular no carga la URL, configurale DNS privado
            <code style={{ background: '#f0f0f0', padding: '0 4px', margin: '0 4px' }}>1dot1dot1dot1.cloudflare-dns.com</code>
            (Android) o <code style={{ background: '#f0f0f0', padding: '0 4px' }}>1.1.1.1</code> (iOS).
          </span>
        }
      />

      <Card
        title={
          <Space>
            <span>Estado del túnel</span>
            {info && statusTag(info.status)}
          </Space>
        }
        extra={
          <Space>
            <Button
              icon={<ThunderboltOutlined />}
              loading={checkMut.isPending}
              disabled={info?.status !== 'running'}
              onClick={() => checkMut.mutate()}
            >
              Probar túnel
            </Button>
            {info?.status === 'running' ? (
              <Button danger icon={<PauseCircleOutlined />} onClick={handleStop}>
                Detener túnel
              </Button>
            ) : (
              <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => startMut.mutate()} loading={startMut.isPending}>
                Iniciar túnel
              </Button>
            )}
          </Space>
        }
      >
        {statusQuery.isLoading ? (
          <Typography.Text type="secondary">Cargando estado…</Typography.Text>
        ) : info ? (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <Space size="large" wrap>
              <TunnelStatistic label="URL pública" value={
                info.publicUrl ? (
                  <Typography.Text code copyable={{ text: info.publicUrl }}>{info.publicUrl}</Typography.Text>
                ) : <Typography.Text type="secondary">—</Typography.Text>
              } />
              <TunnelStatistic label="Activo desde" value={info.startedAt ? dayjs(info.startedAt).format('DD/MM HH:mm:ss') : '—'} />
              <TunnelStatistic label="Uptime" value={formatUptime(info.uptimeSec)} />
              <TunnelStatistic label="Backend port" value={String(info.backendPort)} />
              {info.pid && <TunnelStatistic label="PID" value={String(info.pid)} />}
            </Space>
            {info.lastError && (
              <Alert type="error" showIcon message={info.lastError} />
            )}
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Binario: <code>{info.cloudflaredPath}</code>
            </Typography.Text>
          </Space>
        ) : null}
      </Card>

      <Card
        title={
          <Space>
            <QrcodeOutlined />
            <span>QR para la app mobile</span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={loadQr} disabled={info?.status !== 'running'}>
              {qr ? 'Refrescar QR' : 'Generar QR'}
            </Button>
            <Button icon={<ThunderboltOutlined />} onClick={() => rotateMut.mutate()} loading={rotateMut.isPending} disabled={info?.status !== 'running'}>
              Cerrar inscripciones
            </Button>
          </Space>
        }
      >
        {qr ? (
          <Space direction="vertical" align="center" style={{ width: '100%' }}>
            {qrPngUrl ? (
              <img src={qrPngUrl} alt="QR de conexión mobile" style={{ width: 260, height: 260, border: '1px solid #eee', borderRadius: 8 }} />
            ) : (
              <div style={{ width: 260, height: 260, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                Generando…
              </div>
            )}
            <Typography.Text strong>{qr.name}</Typography.Text>
            <Typography.Text type="secondary" code>{qr.url}</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              QR emitido {dayjs(qr.issuedAt).format('DD/MM HH:mm:ss')} — Válido hasta {dayjs(qr.expiresAt).format('DD/MM HH:mm')}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>
              Múltiples dispositivos pueden escanear este mismo QR. Cada uno obtiene su propia API key individual.
            </Typography.Text>
            <Button icon={<DownloadOutlined />} onClick={downloadQr} disabled={!qrPngUrl}>
              Descargar PNG
            </Button>
          </Space>
        ) : (
          <Alert
            type="warning"
            showIcon
            message="No hay QR generado"
            description={
              info?.status === 'running'
                ? 'Hacé clic en "Generar QR" para crear un código escaneable desde la app mobile. Múltiples dispositivos pueden usar el mismo QR.'
                : 'Iniciá el túnel primero. El QR contiene un registration token one-time — cada device lo canjea por su propia API key.'
            }
          />
        )}
      </Card>

      <DevicesCard />

      <Card title="Logs del proceso cloudflared" size="small">
        <div
          ref={logsRef}
          style={{
            background: '#0f172a',
            color: '#e2e8f0',
            padding: 12,
            borderRadius: 6,
            fontFamily: 'Consolas, monospace',
            fontSize: 12,
            height: 220,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {(logsQuery.data ?? []).length === 0
            ? '(sin logs aún — iniciá el túnel)'
            : (logsQuery.data ?? []).join('\n')}
        </div>
      </Card>
    </Space>
  );
}

// ═══════════════════════════════════════════════════
//  Section: Dispositivos Mobile Conectados
// ═══════════════════════════════════════════════════

function isDeviceActive(d: MobileDevice, now = Date.now()): boolean {
  if (d.REVOKED_AT) return false;
  if (d.API_KEY_ID == null) return false;
  if (!d.KEY_ACTIVA || d.KEY_REVOKED_AT) return false;
  if (d.EXPIRES_AT && new Date(d.EXPIRES_AT).getTime() < now) return false;
  return true;
}

function deviceStatusTag(d: MobileDevice): { color: string; label: string } {
  if (d.REVOKED_AT || d.API_KEY_ID == null) {
    return { color: 'default', label: d.API_KEY_ID == null ? 'huérfano' : 'revocado' };
  }
  if (!d.KEY_ACTIVA || d.KEY_REVOKED_AT) return { color: 'default', label: 'revocado' };
  if (d.EXPIRES_AT && new Date(d.EXPIRES_AT).getTime() < Date.now()) {
    return { color: 'orange', label: 'expirado' };
  }
  return { color: 'success', label: 'activo' };
}

function DevicesCard() {
  const qc = useQueryClient();

  const devicesQuery = useQuery({
    queryKey: ['tunnel', 'devices'],
    queryFn: tunnelApi.listDevices,
    refetchInterval: 15_000,
  });

  const revokeMut = useMutation({
    mutationFn: (id: number) => tunnelApi.revokeDevice(id),
    onSuccess: () => {
      notify.success('Device revocado. Su próxima request será rechazada.');
      qc.invalidateQueries({ queryKey: ['tunnel', 'devices'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || e.message),
  });

  const unlinkMut = useMutation({
    mutationFn: (id: number) => tunnelApi.unlinkDevice(id),
    onSuccess: (r) => {
      notify.success(r.message ?? 'Device desvinculado.');
      qc.invalidateQueries({ queryKey: ['tunnel', 'devices'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => tunnelApi.deleteDevice(id),
    onSuccess: () => {
      notify.success('Device eliminado del historial.');
      qc.invalidateQueries({ queryKey: ['tunnel', 'devices'] });
    },
    onError: (e: any) => notify.error(e?.response?.data?.error || e.message),
  });

  const handleRevoke = (d: MobileDevice) => {
    Modal.confirm({
      title: `¿Revocar "${d.DEVICE_NAME}"?`,
      content: 'El dispositivo dejará de poder conectarse inmediatamente. Tendrá que re-escanear el QR para volver a operar. La API key queda marcada como revocada.',
      okText: 'Revocar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: () => revokeMut.mutate(d.DEVICE_ID),
    });
  };

  const handleUnlink = (d: MobileDevice) => {
    Modal.confirm({
      title: `¿Desvincular "${d.DEVICE_NAME}"?`,
      content:
        'El device ya no podrá autenticarse con esta API key. El row queda en el historial pero con la asociación cortada. La API key queda revocada.',
      okText: 'Desvincular',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: () => unlinkMut.mutate(d.DEVICE_ID),
    });
  };

  const handleDelete = (d: MobileDevice) => {
    Modal.confirm({
      title: `¿Eliminar "${d.DEVICE_NAME}" del historial?`,
      content: 'Esta acción no se puede deshacer. Sólo elimina el row del device — la API key (si existe) NO se toca.',
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: () => deleteMut.mutate(d.DEVICE_ID),
    });
  };

  const columns: ColumnsType<MobileDevice> = [
    {
      title: 'Device',
      dataIndex: 'DEVICE_NAME',
      key: 'name',
      render: (name: string, r) => {
        const status = deviceStatusTag(r);
        return (
          <Space direction="vertical" size={0}>
            <Space size={6}>
              <DesktopOutlined />
              <Typography.Text strong>{name}</Typography.Text>
              <Tag color={status.color}>{status.label}</Tag>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              UUID: {r.DEVICE_UUID.slice(0, 8)}…{r.DEVICE_UUID.slice(-4)}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: 'API Key',
      key: 'key',
      width: 120,
      render: (_: any, r) =>
        r.KEY_PREFIX ? (
          <Typography.Text code style={{ fontSize: 11 }}>{r.KEY_PREFIX}…</Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>—</Typography.Text>
        ),
    },
    {
      title: 'Registrado',
      dataIndex: 'REGISTERED_AT',
      key: 'registered',
      width: 140,
      render: (v: string) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontSize: 12 }}>{dayjs(v).format('DD/MM/YY HH:mm')}</span>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            hace {humanAgo(v)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Última actividad',
      dataIndex: 'LAST_SEEN_AT',
      key: 'lastSeen',
      width: 160,
      render: (v: string | null, r) => (
        <Space direction="vertical" size={0}>
          <span style={{ fontSize: 12 }}>{v ? dayjs(v).format('DD/MM HH:mm:ss') : '—'}</span>
          {r.LAST_IP && (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              IP: {r.LAST_IP}
            </Typography.Text>
          )}
        </Space>
      ),
    },
    {
      title: 'Expira',
      dataIndex: 'EXPIRES_AT',
      key: 'expires',
      width: 130,
      render: (v: string | null) =>
        v ? <span style={{ fontSize: 12 }}>{dayjs(v).format('DD/MM/YY HH:mm')}</span> : '—',
    },
    {
      title: 'Acciones',
      key: 'actions',
      width: 240,
      align: 'right',
      render: (_: any, r) => {
        const active = isDeviceActive(r);
        const orphaned = r.API_KEY_ID == null;
        return (
          <Space size={4}>
            {active && (
              <Button danger size="small" icon={<StopOutlined />} onClick={() => handleRevoke(r)}>
                Revocar
              </Button>
            )}
            {!orphaned && (
              <Tooltip title="Desvincular de la API key (la key queda revocada, el row del device queda en historial)">
                <Button size="small" icon={<DisconnectOutlined />} onClick={() => handleUnlink(r)}>
                  Desvincular
                </Button>
              </Tooltip>
            )}
            <Tooltip title="Eliminar el row del device del historial. No toca la API key.">
              <Button danger size="small" type="text" icon={<DeleteOutlined />} onClick={() => handleDelete(r)}>
                Eliminar
              </Button>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  const devices = devicesQuery.data ?? [];
  const activeCount = devices.filter((d) => isDeviceActive(d)).length;
  const totalCount = devices.length;

  return (
    <Card
      title={
        <Space>
          <MobileOutlined />
          <span>Dispositivos conectados</span>
          <Tag>{totalCount} total</Tag>
          {activeCount > 0 && <Tag color="success">{activeCount} activos</Tag>}
        </Space>
      }
      extra={
        <Button icon={<ReloadOutlined />} loading={devicesQuery.isFetching} onClick={() => devicesQuery.refetch()}>
          Refrescar
        </Button>
      }
    >
      {totalCount === 0 ? (
        <Alert
          type="info"
          showIcon
          message="Ningún dispositivo registrado todavía"
          description="Generá el QR arriba y hacé que cada operador lo escanee desde su celular. Cada device obtendrá su propia API key y aparecerá acá."
        />
      ) : (
        <Table<MobileDevice>
          rowKey="DEVICE_ID"
          loading={devicesQuery.isLoading}
          dataSource={devices}
          columns={columns}
          size="small"
          pagination={false}
        />
      )}
    </Card>
  );
}

function TunnelStatistic({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#999' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
