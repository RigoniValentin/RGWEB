import { useState } from 'react';
import { App, Alert, Button, Modal, Space, Steps, Typography, Upload, Tag, Descriptions } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExclamationCircleOutlined, InboxOutlined, RollbackOutlined, FileZipOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { backupsApi, type BackupRecord, type BackupFileInspection } from '../../services/backups.api';
import { useAuthStore } from '../../store/authStore';

const { Text, Paragraph } = Typography;
const { Dragger } = Upload;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Si se pasa, restore desde historial. Si null, restore desde upload. */
  fromBackup: BackupRecord | null;
  dbName: string;
}

export function RestoreBackupModal({ open, onClose, fromBackup, dbName }: Props) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const logout = useAuthStore(s => s.logout);

  const [step, setStep] = useState(0); // 0: warning, 1: select file (sólo upload), 2: confirm name
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [inspection, setInspection] = useState<BackupFileInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);

  const isUpload = !fromBackup;

  const reset = () => {
    setStep(0);
    setUploadFile(null);
    setConfirmText('');
    setInspection(null);
    setUploadPct(0);
  };

  const close = () => {
    if (restoreMut.isPending) return;
    reset();
    onClose();
  };

  const restoreMut = useMutation({
    mutationFn: async () => {
      if (fromBackup) {
        return backupsApi.restoreFromHistorial(fromBackup.BACKUP_ID, confirmText);
      } else {
        const file = uploadFile?.originFileObj as File;
        if (!file) throw new Error('Seleccione un archivo .bak');
        return backupsApi.restoreFromUpload(file, confirmText, setUploadPct);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries();
      Modal.success({
        title: 'Restauración completada',
        content: 'La base de datos fue restaurada correctamente. La sesión actual se cerrará para forzar la recarga de los datos.',
        okText: 'Cerrar sesión',
        onOk: () => {
          logout();
          window.location.href = '/login';
        },
      });
      close();
    },
    onError: (err: any) => {
      message.error({
        content: err?.response?.data?.error || err.message,
        duration: 10,
      });
    },
  });

  const handleInspect = async () => {
    const file = uploadFile?.originFileObj as File;
    if (!file) return;
    try {
      setInspecting(true);
      const meta = await backupsApi.inspectUpload(file);
      setInspection(meta);
    } catch (err: any) {
      message.error(err?.response?.data?.error || err.message);
      setInspection(null);
    } finally {
      setInspecting(false);
    }
  };

  // Steps definition
  const baseSteps = [
    { title: 'Advertencia' },
    ...(isUpload ? [{ title: 'Archivo' }] : []),
    { title: 'Confirmación' },
  ];

  return (
    <Modal
      title={<Space><RollbackOutlined /> Restaurar base de datos</Space>}
      open={open}
      onCancel={close}
      width={680}
      maskClosable={false}
      destroyOnClose
      footer={null}
    >
      <Steps current={step} items={baseSteps} size="small" style={{ marginBottom: 24 }} />

      {/* ── Paso 0: Advertencia ── */}
      {step === 0 && (
        <>
          <Alert
            type="warning"
            showIcon
            icon={<ExclamationCircleOutlined />}
            message="Operación crítica e irreversible"
            description={
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                <li><strong>Toda la información actual de la base será reemplazada</strong> por la del backup.</li>
                <li>Todos los usuarios conectados serán <strong>desconectados inmediatamente</strong>.</li>
                <li>El sistema quedará brevemente <strong>inaccesible</strong> mientras dura el proceso.</li>
                <li>Los datos creados después del backup se <strong>perderán de forma irreversible</strong>.</li>
                <li>Se recomienda <strong>generar un backup actual antes</strong> por seguridad.</li>
              </ul>
            }
            style={{ marginBottom: 16 }}
          />
          {fromBackup && (
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="Archivo">{fromBackup.ARCHIVO_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Fecha">{new Date(fromBackup.FECHA_INICIO).toLocaleString('es-AR')}</Descriptions.Item>
              <Descriptions.Item label="Tamaño">
                {fromBackup.TAMANO_BYTES ? `${(fromBackup.TAMANO_BYTES / 1024 / 1024).toFixed(1)} MB` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Verificado">
                {fromBackup.VERIFICADO ? <Tag color="green">Sí</Tag> : <Tag color="orange">No</Tag>}
              </Descriptions.Item>
            </Descriptions>
          )}
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button onClick={close}>Cancelar</Button>
              <Button type="primary" danger onClick={() => setStep(1)}>
                Entiendo, continuar
              </Button>
            </Space>
          </div>
        </>
      )}

      {/* ── Paso 1: Seleccionar archivo (solo upload) ── */}
      {step === 1 && isUpload && (
        <>
          <Paragraph>
            Seleccioná un archivo <Text code>.bak</Text> generado por SQL Server.
            Puede ser un backup descargado del historial o un archivo externo.
          </Paragraph>
          <Dragger
            accept=".bak"
            multiple={false}
            beforeUpload={() => false}
            maxCount={1}
            fileList={uploadFile ? [uploadFile] : []}
            onChange={(info) => {
              setUploadFile(info.fileList[0] || null);
              setInspection(null);
            }}
            onRemove={() => { setUploadFile(null); setInspection(null); return true; }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">Click o arrastrá un archivo .bak aquí</p>
            <p className="ant-upload-hint">Tamaño máximo: 10 GB</p>
          </Dragger>
          {uploadFile && (
            <div style={{ marginTop: 12 }}>
              <Button
                icon={<FileZipOutlined />}
                onClick={handleInspect}
                loading={inspecting}
                disabled={!uploadFile}
              >
                Inspeccionar contenido del archivo
              </Button>
              {inspection && (
                <Descriptions size="small" column={1} bordered style={{ marginTop: 12 }}>
                  <Descriptions.Item label="BD origen">{inspection.header.databaseName}</Descriptions.Item>
                  <Descriptions.Item label="Servidor origen">{inspection.header.serverName}</Descriptions.Item>
                  <Descriptions.Item label="Fecha del backup">
                    {inspection.header.backupStartDate
                      ? new Date(inspection.header.backupStartDate).toLocaleString('es-AR')
                      : '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="Archivos contenidos">
                    {inspection.files.map(f => `${f.logicalName} (${f.type})`).join(', ')}
                  </Descriptions.Item>
                </Descriptions>
              )}
              {inspection && inspection.header.databaseName.toLowerCase() !== dbName.toLowerCase() && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 12 }}
                  message="Las bases no coinciden"
                  description={`El backup es de "${inspection.header.databaseName}" pero se restaurará sobre "${dbName}". Continúe sólo si está seguro.`}
                />
              )}
            </div>
          )}
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setStep(0)}>Atrás</Button>
              <Button type="primary" disabled={!uploadFile} onClick={() => setStep(2)}>
                Continuar
              </Button>
            </Space>
          </div>
        </>
      )}

      {/* ── Paso 2: Confirmación final ── */}
      {step === (isUpload ? 2 : 1) && (
        <>
          <Alert
            type="error"
            showIcon
            message="Última confirmación"
            description={
              <>Para confirmar, escribí exactamente el nombre de la base de datos: <Text code copyable>{dbName}</Text></>
            }
            style={{ marginBottom: 16 }}
          />
          <input
            type="text"
            placeholder={dbName}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 11px',
              fontSize: 14,
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              fontFamily: 'monospace',
            }}
            disabled={restoreMut.isPending}
          />

          {restoreMut.isPending && isUpload && uploadPct < 100 && (
            <Paragraph style={{ marginTop: 12 }}>
              <Text type="secondary">Subiendo archivo: {uploadPct}%</Text>
            </Paragraph>
          )}
          {restoreMut.isPending && (uploadPct === 100 || !isUpload) && (
            <Paragraph style={{ marginTop: 12 }}>
              <Text type="secondary">Restaurando base de datos... no cierre esta ventana.</Text>
            </Paragraph>
          )}

          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setStep(isUpload ? 1 : 0)} disabled={restoreMut.isPending}>
                Atrás
              </Button>
              <Button
                type="primary"
                danger
                loading={restoreMut.isPending}
                disabled={confirmText !== dbName}
                onClick={() => restoreMut.mutate()}
              >
                Restaurar ahora
              </Button>
            </Space>
          </div>
        </>
      )}
    </Modal>
  );
}
