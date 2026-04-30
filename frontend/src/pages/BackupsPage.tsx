import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, Card, Form, Input, InputNumber, Modal, Space, Switch, Table,
  Tag, Tooltip, Typography, Row, Col, Alert, Popconfirm, Tabs,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CloudDownloadOutlined, CloudUploadOutlined, DeleteOutlined, PlayCircleOutlined,
  ReloadOutlined, RollbackOutlined, SafetyCertificateOutlined, SaveOutlined,
  ClockCircleOutlined, DatabaseOutlined,
  CheckCircleTwoTone, CloseCircleTwoTone, WarningTwoTone,
} from '@ant-design/icons';
import { backupsApi, type BackupConfig, type BackupRecord, type RestoreRecord } from '../services/backups.api';
import { RestoreBackupModal } from '../components/backups/RestoreBackupModal';

const { Title, Text, Paragraph } = Typography;

function formatBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function formatDate(s: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const CRON_PRESETS: { label: string; value: string; desc: string }[] = [
  { label: 'Todos los días 03:00',    value: '0 3 * * *',  desc: 'Recomendado' },
  { label: 'Todos los días 23:00',    value: '0 23 * * *', desc: 'Fin de jornada' },
  { label: 'Cada 12 horas',           value: '0 */12 * * *', desc: '03:00 y 15:00' },
  { label: 'Lunes a viernes 02:00',   value: '0 2 * * 1-5', desc: 'Días hábiles' },
  { label: 'Cada hora',               value: '0 * * * *', desc: 'Solo para pruebas' },
];

export function BackupsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [configOpen, setConfigOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreFromBackup, setRestoreFromBackup] = useState<BackupRecord | null>(null);
  const [form] = Form.useForm<BackupConfig>();

  // ── Queries ─────────────────────────────────────
  const { data: list = [], isLoading, refetch } = useQuery({
    queryKey: ['backups-list'],
    queryFn: () => backupsApi.list(200),
    refetchInterval: (q) => {
      const data = q.state.data as BackupRecord[] | undefined;
      return data?.some(b => b.ESTADO === 'EN_PROGRESO') ? 2000 : false;
    },
  });

  const { data: config } = useQuery({
    queryKey: ['backups-config'],
    queryFn: () => backupsApi.getConfig(),
  });

  const { data: restoreList = [], isLoading: loadingRestores } = useQuery({
    queryKey: ['backups-restore-history'],
    queryFn: () => backupsApi.listRestores(),
  });

  // ── Mutations ───────────────────────────────────
  const runMut = useMutation({
    mutationFn: () => backupsApi.run(),
    onMutate: () => { message.loading({ content: 'Ejecutando backup...', key: 'bk', duration: 0 }); },
    onSuccess: (rec) => {
      message.success({ content: `Backup completado: ${rec.ARCHIVO_NOMBRE}`, key: 'bk' });
      qc.invalidateQueries({ queryKey: ['backups-list'] });
      qc.invalidateQueries({ queryKey: ['backups-config'] });
    },
    onError: (err: any) => {
      message.error({ content: err?.response?.data?.error || err.message, key: 'bk', duration: 6 });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => backupsApi.delete(id),
    onSuccess: () => {
      message.success('Backup eliminado');
      qc.invalidateQueries({ queryKey: ['backups-list'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.error || err.message),
  });

  const retentionMut = useMutation({
    mutationFn: () => backupsApi.applyRetention(),
    onSuccess: (r) => {
      message.success(`Retención aplicada: ${r.eliminados} eliminados`);
      qc.invalidateQueries({ queryKey: ['backups-list'] });
    },
    onError: (err: any) => message.error(err?.response?.data?.error || err.message),
  });

  const saveConfigMut = useMutation({
    mutationFn: (v: Partial<BackupConfig>) => backupsApi.updateConfig(v),
    onSuccess: () => {
      message.success('Configuración guardada');
      qc.invalidateQueries({ queryKey: ['backups-config'] });
      setConfigOpen(false);
    },
    onError: (err: any) => message.error(err?.response?.data?.error || err.message),
  });

  // ── Columns ─────────────────────────────────────
  const columns: ColumnsType<BackupRecord> = [
    {
      title: 'Fecha', dataIndex: 'FECHA_INICIO', width: 180,
      render: (v) => formatDate(v),
      sorter: (a, b) => new Date(a.FECHA_INICIO).getTime() - new Date(b.FECHA_INICIO).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Estado', dataIndex: 'ESTADO', width: 130,
      render: (v: BackupRecord['ESTADO'], r) => {
        if (v === 'OK') return (
          <Space>
            <CheckCircleTwoTone twoToneColor="#52c41a" /> OK
            {r.VERIFICADO && <Tooltip title="Verificado con RESTORE VERIFYONLY"><SafetyCertificateOutlined style={{ color: '#52c41a' }} /></Tooltip>}
          </Space>
        );
        if (v === 'ERROR') return <Space><CloseCircleTwoTone twoToneColor="#ff4d4f" /> Error</Space>;
        return <Space><WarningTwoTone twoToneColor="#faad14" /> En progreso</Space>;
      },
    },
    {
      title: 'Tipo', dataIndex: 'TIPO', width: 110,
      render: (v) => <Tag color={v === 'PROGRAMADO' ? 'blue' : 'default'}>{v}</Tag>,
    },
    { title: 'Archivo', dataIndex: 'ARCHIVO_NOMBRE', ellipsis: true },
    { title: 'Tamaño', dataIndex: 'TAMANO_BYTES', width: 100, render: formatBytes, align: 'right' },
    { title: 'Duración', dataIndex: 'DURACION_MS', width: 100, render: formatMs, align: 'right' },
    { title: 'Usuario', dataIndex: 'USUARIO_NOMBRE', width: 140, render: (v) => v || '—' },
    {
      title: 'Acciones', width: 200, fixed: 'right' as const,
      render: (_: any, r: BackupRecord) => (
        <Space>
          <Tooltip title="Descargar .bak">
            <Button
              type="text"
              icon={<CloudDownloadOutlined />}
              disabled={r.ESTADO !== 'OK'}
              onClick={() => backupsApi.download(r.BACKUP_ID, r.ARCHIVO_NOMBRE).catch(e => message.error(e.message))}
            />
          </Tooltip>
          <Tooltip title="Restaurar este backup">
            <Button
              type="text"
              icon={<RollbackOutlined />}
              disabled={r.ESTADO !== 'OK'}
              onClick={() => { setRestoreFromBackup(r); setRestoreOpen(true); }}
            />
          </Tooltip>
          <Popconfirm
            title="¿Eliminar este backup?"
            description="Se borrará el archivo .bak y su registro."
            okType="danger"
            okText="Eliminar"
            cancelText="Cancelar"
            onConfirm={() => deleteMut.mutate(r.BACKUP_ID)}
          >
            <Tooltip title="Eliminar">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const lastOk = list.find(b => b.ESTADO === 'OK');
  const horasDesdeUltimo = lastOk
    ? (Date.now() - new Date(lastOk.FECHA_INICIO).getTime()) / 36e5
    : null;
  const saludOk = horasDesdeUltimo != null && horasDesdeUltimo <= 26;

  const openConfig = () => {
    if (config) form.setFieldsValue(config);
    setConfigOpen(true);
  };

  return (
    <div style={{ padding: 16 }}>
      <Row align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col>
          <Space align="center">
            <DatabaseOutlined style={{ fontSize: 24 }} />
            <Title level={3} style={{ margin: 0 }}>Backups</Title>
          </Space>
        </Col>
        <Col>
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => refetch()}>Actualizar</Button>
            <Button icon={<ClockCircleOutlined />} onClick={openConfig}>Configuración</Button>
            <Popconfirm
              title="¿Aplicar política de retención ahora?"
              description="Eliminará archivos antiguos según la configuración."
              onConfirm={() => retentionMut.mutate()}
            >
              <Button icon={<DeleteOutlined />}>Limpiar antiguos</Button>
            </Popconfirm>
            <Button
              icon={<CloudUploadOutlined />}
              danger
              onClick={() => { setRestoreFromBackup(null); setRestoreOpen(true); }}
            >
              Restaurar desde archivo
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={runMut.isPending}
              onClick={() => runMut.mutate()}
            >
              Ejecutar backup ahora
            </Button>
          </Space>
        </Col>
      </Row>

      {/* Estado de salud */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card size="small" title="Último backup">
            {lastOk ? (
              <Space direction="vertical" size={2}>
                <Text strong>{formatDate(lastOk.FECHA_INICIO)}</Text>
                <Text type="secondary">
                  {formatBytes(lastOk.TAMANO_BYTES)} · {formatMs(lastOk.DURACION_MS)} · {lastOk.ARCHIVO_NOMBRE}
                </Text>
                <Tag color={saludOk ? 'green' : 'orange'}>
                  {saludOk
                    ? `Hace ${horasDesdeUltimo!.toFixed(1)} h ✓`
                    : `Hace ${horasDesdeUltimo!.toFixed(1)} h — revisar`}
                </Tag>
              </Space>
            ) : (
              <Alert type="warning" message="Aún no se realizó ningún backup correcto" showIcon />
            )}
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title="Programación">
            {config ? (
              <Space direction="vertical" size={2}>
                <Space>
                  <Tag color={config.ACTIVO ? 'green' : 'default'}>
                    {config.ACTIVO ? 'Automático activo' : 'Automático desactivado'}
                  </Tag>
                  <Text code>{config.HORARIO_CRON}</Text>
                </Space>
                <Text type="secondary">
                  Retención: {config.RETENCION_DIAS} días (mín {config.RETENCION_MIN_KEEP} archivos)
                </Text>
                <Text type="secondary">
                  Destino: {config.DESTINO_PATH || '(predeterminado: ./backups)'}
                </Text>
              </Space>
            ) : <Text type="secondary">Cargando...</Text>}
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Tabs
          defaultActiveKey="backups"
          items={[
            {
              key: 'backups',
              label: <span><DatabaseOutlined /> Backups</span>,
              children: (
                <Table<BackupRecord>
                  rowKey="BACKUP_ID"
                  dataSource={list}
                  columns={columns}
                  loading={isLoading}
                  size="small"
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  scroll={{ x: 1100 }}
                />
              ),
            },
            {
              key: 'restores',
              label: <span><RollbackOutlined /> Restauraciones</span>,
              children: (
                <Table<RestoreRecord>
                  rowKey="RESTORE_ID"
                  dataSource={restoreList}
                  loading={loadingRestores}
                  size="small"
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                  scroll={{ x: 900 }}
                  columns={[
                    {
                      title: 'Fecha', dataIndex: 'FECHA_INICIO', width: 180,
                      render: (v) => formatDate(v),
                    },
                    {
                      title: 'Estado', dataIndex: 'ESTADO', width: 130,
                      render: (v: RestoreRecord['ESTADO']) => {
                        if (v === 'OK') return <Space><CheckCircleTwoTone twoToneColor="#52c41a" /> OK</Space>;
                        if (v === 'ERROR') return <Space><CloseCircleTwoTone twoToneColor="#ff4d4f" /> Error</Space>;
                        return <Space><WarningTwoTone twoToneColor="#faad14" /> En progreso</Space>;
                      },
                    },
                    {
                      title: 'Origen', dataIndex: 'ORIGEN', width: 110,
                      render: (v) => <Tag color={v === 'UPLOAD' ? 'purple' : 'blue'}>{v}</Tag>,
                    },
                    { title: 'Archivo', dataIndex: 'ARCHIVO_NOMBRE', ellipsis: true },
                    { title: 'Duración', dataIndex: 'DURACION_MS', width: 100, render: formatMs, align: 'right' },
                    { title: 'Usuario', dataIndex: 'USUARIO_NOMBRE', width: 140, render: (v) => v || '—' },
                    {
                      title: 'Error', dataIndex: 'ERROR_MENSAJE', ellipsis: true,
                      render: (v) => v ? <Tooltip title={v}><Text type="danger" ellipsis>{v}</Text></Tooltip> : '—',
                    },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>

      {/* Modal Restore */}
      <RestoreBackupModal
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        fromBackup={restoreFromBackup}
        dbName={list[0]?.DB_NOMBRE || 'BASE_DE_DATOS'}
      />

      {/* Modal configuración */}
      <Modal
        title="Configuración de Backups"
        open={configOpen}
        onCancel={() => setConfigOpen(false)}
        onOk={() => form.validateFields().then(v => saveConfigMut.mutate(v))}
        confirmLoading={saveConfigMut.isPending}
        okText={<><SaveOutlined /> Guardar</>}
        width={640}
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          La copia se realiza con <Text code>BACKUP DATABASE</Text> nativo de SQL Server.
          La ruta destino debe ser <strong>local al servidor SQL</strong> (la cuenta del
          servicio SQL debe poder escribir allí).
        </Paragraph>
        <Form<BackupConfig> layout="vertical" form={form} initialValues={config}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Backups automáticos" name="ACTIVO" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Verificar (RESTORE VERIFYONLY)" name="VERIFICAR_BACKUP" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label="Horario (expresión cron)"
            name="HORARIO_CRON"
            rules={[{ required: true, message: 'Requerido' }]}
            extra={
              <Space wrap size={4} style={{ marginTop: 4 }}>
                {CRON_PRESETS.map(p => (
                  <Button key={p.value} size="small" onClick={() => form.setFieldValue('HORARIO_CRON', p.value)}>
                    {p.label}
                  </Button>
                ))}
              </Space>
            }
          >
            <Input placeholder="0 3 * * *" />
          </Form.Item>
          <Form.Item
            label="Carpeta destino (absoluta, opcional)"
            name="DESTINO_PATH"
            extra="Vacío = se usa la carpeta 'backups' junto al ejecutable"
          >
            <Input placeholder="C:\RGBackups" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="Retención (días)"
                name="RETENCION_DIAS"
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={3650} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Mínimo de archivos a conservar"
                name="RETENCION_MIN_KEEP"
                rules={[{ required: true }]}
                tooltip="Aunque excedan los días, siempre se conservan los N más recientes."
              >
                <InputNumber min={0} max={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="COPY_ONLY"
                name="COPY_ONLY"
                valuePropName="checked"
                tooltip="No interfiere con planes de backup diferenciales/log existentes."
              >
                <Switch />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="Compresión"
                name="COMPRESION"
                valuePropName="checked"
                tooltip="Reduce el tamaño del .bak en 70-90%."
              >
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
