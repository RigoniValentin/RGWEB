import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Typography, Switch, Select, Input, Button, Space, Tag, Row, Col,
  message, Spin, Tooltip, Empty, Badge, Upload, Modal,
} from 'antd';
import {
  SettingOutlined, SaveOutlined, UndoOutlined, KeyOutlined,
  ShoppingCartOutlined, DollarOutlined, BankOutlined, AppstoreOutlined,
  ThunderboltOutlined, CheckOutlined, InfoCircleOutlined,
  CameraOutlined, DeleteOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSettingsStore } from '../store/settingsStore';
import type { ConfigResuelto, SaveSettingInput } from '../services/settings.api';
import { settingsApi } from '../services/settings.api';
import { RGLogo } from '../components/RGLogo';

const { Title, Text } = Typography;

// ── Module display config ────────────────────────
const MODULE_META: Record<string, { label: string; description: string; icon: React.ReactNode; color: string }> = {
  ventas:  { label: 'Ventas',  description: 'Atajos y comportamiento del módulo de ventas',  icon: <DollarOutlined />,       color: '#52c41a' },
  compras: { label: 'Compras', description: 'Atajos y comportamiento del módulo de compras', icon: <ShoppingCartOutlined />, color: '#1890ff' },
  caja:    { label: 'Caja',    description: 'Configuración del módulo de caja',               icon: <BankOutlined />,         color: '#722ed1' },
  general: { label: 'General', description: 'Preferencias generales del sistema',             icon: <AppstoreOutlined />,     color: '#fa8c16' },
};

const SUBMODULE_LABELS: Record<string, string> = {
  nueva_venta:  'Nueva Venta',
  nueva_compra: 'Nueva Compra',
  general:      'General',
  listado:      'Listado',
  _general:     'General',
};

// ── Logo upload section ──────────────────────────
function LogoSection() {
  const [msgApi, contextHolder] = message.useMessage();
  const [uploading, setUploading] = useState(false);
  const queryClient = useQueryClient();

  const { data: logoUrl, isLoading } = useQuery({
    queryKey: ['empresa-logo'],
    queryFn: () => settingsApi.getLogo(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const handleUpload = useCallback(async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      msgApi.error('La imagen supera el límite de 2 MB');
      return;
    }
    setUploading(true);
    try {
      await settingsApi.uploadLogo(file);
      queryClient.invalidateQueries({ queryKey: ['empresa-logo'] });
      msgApi.success('Logo actualizado');
    } catch {
      msgApi.error('Error al subir el logo');
    } finally {
      setUploading(false);
    }
  }, [msgApi, queryClient]);

  const handleDelete = useCallback(async () => {
    setUploading(true);
    try {
      await settingsApi.deleteLogo();
      queryClient.invalidateQueries({ queryKey: ['empresa-logo'] });
      msgApi.success('Logo eliminado');
    } catch {
      msgApi.error('Error al eliminar el logo');
    } finally {
      setUploading(false);
    }
  }, [msgApi, queryClient]);

  return (
    <Card
      className="rg-card animate-fade-up"
      size="small"
      style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 24 }}
      styles={{
        header: {
          background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
          borderBottom: '2px solid #EABD23',
          padding: '14px 20px',
        },
        body: { padding: '20px 24px' },
      }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(234,189,35,0.2)', color: '#EABD23', fontSize: 16,
          }}>
            <CameraOutlined />
          </span>
          <div>
            <Text strong style={{ color: '#fff', fontSize: 14 }}>Logo de Empresa</Text>
            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, display: 'block', lineHeight: 1.2 }}>
              Se muestra en el dashboard y documentos
            </Text>
          </div>
        </div>
      }
    >
      {contextHolder}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* Preview */}
        <div style={{
          width: 100, height: 100, borderRadius: 12,
          border: '2px dashed #d9d9d9',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden', background: '#fafafa', flexShrink: 0,
        }}>
          {isLoading ? (
            <Spin size="small" />
          ) : logoUrl ? (
            <img src={logoUrl} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <RGLogo size={60} showText={false} variant="gold" />
          )}
        </div>

        {/* Actions */}
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
            Formato: PNG, JPG, GIF o WebP. Tamaño máximo: 2 MB.
          </Text>
          <Space>
            <Upload
              accept="image/png,image/jpeg,image/gif,image/webp"
              showUploadList={false}
              beforeUpload={(file) => { handleUpload(file); return false; }}
            >
              <Button
                type="primary"
                className="btn-gold"
                icon={<CameraOutlined />}
                loading={uploading}
              >
                {logoUrl ? 'Cambiar Logo' : 'Subir Logo'}
              </Button>
            </Upload>
            {logoUrl && (
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={handleDelete}
                loading={uploading}
              >
                Eliminar
              </Button>
            )}
          </Space>
        </div>
      </div>
    </Card>
  );
}

// ── Shortcut recorder component ──────────────────
function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();

    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    const key = e.key;
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;

    const keyMap: Record<string, string> = {
      ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      Escape: 'Esc', Delete: 'Del', Backspace: 'Backspace', Enter: 'Enter', Tab: 'Tab',
    };

    const mapped = key.startsWith('F') && key.length <= 3
      ? key.toUpperCase()
      : keyMap[key] || key.toUpperCase();
    
    parts.push(mapped);
    onChange(parts.join('+'));
    setRecording(false);
  }, [recording, onChange]);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Input
        ref={inputRef as any}
        readOnly
        value={recording ? 'Presioná una tecla...' : value || 'Sin asignar'}
        onKeyDown={handleKeyDown}
        onBlur={() => setRecording(false)}
        style={{
          width: 220,
          cursor: 'pointer',
          fontFamily: 'monospace',
          fontWeight: 600,
          textAlign: 'center',
          borderColor: recording ? '#EABD23' : undefined,
          boxShadow: recording ? '0 0 0 2px rgba(234,189,35,0.2)' : undefined,
          borderRadius: 8,
        }}
        onClick={() => { setRecording(true); inputRef.current?.focus(); }}
        suffix={
          <Tooltip title={recording ? 'Grabando...' : 'Click para grabar atajo'}>
            <KeyOutlined style={{ color: recording ? '#EABD23' : '#999' }} />
          </Tooltip>
        }
      />
      {recording && (
        <Tag color="gold" icon={<ThunderboltOutlined />} style={{ borderRadius: 6 }}>REC</Tag>
      )}
    </div>
  );
}

// ── Setting row renderer ─────────────────────────
function SettingRow({
  param,
  localValue,
  onValueChange,
}: {
  param: ConfigResuelto;
  localValue: string;
  onValueChange: (parametroId: number, value: string) => void;
}) {
  const isModified = localValue !== (param.VALOR ?? param.VALOR_DEFECTO ?? '');

  const renderControl = () => {
    switch (param.TIPO) {
      case 'boolean':
        return (
          <Switch
            checked={localValue === 'true'}
            onChange={(checked) => onValueChange(param.PARAMETRO_ID, checked ? 'true' : 'false')}
            checkedChildren={<CheckOutlined />}
            style={{ minWidth: 44 }}
          />
        );
      case 'shortcut':
        return (
          <ShortcutInput
            value={localValue}
            onChange={(v) => onValueChange(param.PARAMETRO_ID, v)}
          />
        );
      case 'select': {
        let options: string[] = [];
        try { options = JSON.parse(param.OPCIONES || '[]'); } catch { /* ignore */ }
        return (
          <Select
            value={localValue}
            onChange={(v) => onValueChange(param.PARAMETRO_ID, v)}
            style={{ width: 180 }}
            options={options.map(o => ({ value: o, label: o }))}
          />
        );
      }
      case 'number':
        return (
          <Input
            type="number"
            value={localValue}
            onChange={(e) => onValueChange(param.PARAMETRO_ID, e.target.value)}
            style={{ width: 100, borderRadius: 8 }}
          />
        );
      default:
        return (
          <Input
            value={localValue}
            onChange={(e) => onValueChange(param.PARAMETRO_ID, e.target.value)}
            style={{ width: 220, borderRadius: 8 }}
          />
        );
    }
  };

  return (
    <div className="setting-row" style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      borderRadius: 10,
      marginBottom: 6,
      transition: 'all 0.2s ease',
      background: isModified ? 'rgba(234, 189, 35, 0.06)' : 'rgba(0,0,0,0.01)',
      border: isModified ? '1px solid rgba(234,189,35,0.2)' : '1px solid transparent',
    }}>
      <div style={{ flex: 1, marginRight: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <Text strong style={{ fontSize: 13.5 }}>{param.DESCRIPCION}</Text>
          {isModified && (
            <span style={{
              display: 'inline-block',
              width: 6, height: 6,
              borderRadius: '50%',
              background: '#EABD23',
            }} />
          )}
        </div>
        {param.VALOR_DEFECTO && (
          <Text type="secondary" style={{ fontSize: 11.5 }}>
            Por defecto: <code style={{
              fontSize: 11,
              background: 'rgba(0,0,0,0.04)',
              padding: '1px 6px',
              borderRadius: 4,
              fontFamily: 'monospace',
            }}>
              {param.VALOR_DEFECTO}
            </code>
          </Text>
        )}
      </div>
      <div>{renderControl()}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  SettingsPage — Main component
// ═══════════════════════════════════════════════════
export function SettingsPage() {
  const { settings, loaded, loading, fetchSettings, saveUserSettings, resetAll, resetModule } = useSettingsStore();
  const [localValues, setLocalValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [msgApi, contextHolder] = message.useMessage();

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  useEffect(() => {
    if (loaded) {
      const vals: Record<number, string> = {};
      for (const s of settings) vals[s.PARAMETRO_ID] = s.VALOR ?? s.VALOR_DEFECTO ?? '';
      setLocalValues(vals);
    }
  }, [loaded, settings]);

  const handleValueChange = useCallback((parametroId: number, value: string) => {
    setLocalValues(prev => ({ ...prev, [parametroId]: value }));
  }, []);

  const hasChanges = settings.some(s => {
    const current = localValues[s.PARAMETRO_ID];
    const original = s.VALOR ?? s.VALOR_DEFECTO ?? '';
    return current !== undefined && current !== original;
  });

  const changedCount = settings.filter(s => {
    const current = localValues[s.PARAMETRO_ID];
    const original = s.VALOR ?? s.VALOR_DEFECTO ?? '';
    return current !== undefined && current !== original;
  }).length;

  const handleSave = async () => {
    setSaving(true);
    try {
      const changed: SaveSettingInput[] = settings
        .filter(s => {
          const current = localValues[s.PARAMETRO_ID];
          const original = s.VALOR ?? s.VALOR_DEFECTO ?? '';
          return current !== undefined && current !== original;
        })
        .map(s => ({ PARAMETRO_ID: s.PARAMETRO_ID, VALOR: localValues[s.PARAMETRO_ID]! }));

      if (changed.length > 0) {
        await saveUserSettings(changed);
        msgApi.success(`${changed.length} configuración(es) guardada(s)`);
      }
    } catch {
      msgApi.error('Error al guardar la configuración');
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = () => {
    Modal.confirm({
      title: 'Restaurar toda la configuración',
      content: '¿Estás seguro? Se restaurarán todos los módulos a sus valores por defecto. Esta acción no se puede deshacer.',
      okText: 'Restaurar todo',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        setSaving(true);
        try {
          await resetAll();
          msgApi.success('Configuración restaurada a valores por defecto');
        } catch {
          msgApi.error('Error al restaurar la configuración');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const handleResetModule = (modulo: string, label: string) => {
    Modal.confirm({
      title: `Restaurar ${label}`,
      content: `¿Estás seguro? Se restaurarán las configuraciones de "${label}" a sus valores por defecto.`,
      okText: 'Restaurar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        setSaving(true);
        try {
          await resetModule(modulo);
          msgApi.success(`Configuración de ${label} restaurada`);
        } catch {
          msgApi.error('Error al restaurar la configuración');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const grouped = useSettingsStore.getState().getGrouped();
  const moduleKeys = Object.keys(grouped);

  if (loading && !loaded) {
    return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;
  }

  if (loaded && settings.length === 0) {
    return (
      <div className="page-enter">
        {contextHolder}
        <div style={{
          background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
          borderRadius: 14, padding: '28px 32px', marginBottom: 24, position: 'relative',
        }} className="animate-fade-in">
          <Title level={3} style={{ color: '#EABD23', margin: 0, fontWeight: 700 }}>
            <SettingOutlined style={{ marginRight: 10 }} />
            Configuración General
          </Title>
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #EABD23, transparent)' }} />
        </div>
        <Card className="animate-fade-up" style={{ borderRadius: 12 }}>
          <Empty description="No hay parámetros de configuración disponibles" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          <div style={{ textAlign: 'center', marginTop: 16 }}>
            <Text type="secondary">
              <InfoCircleOutlined style={{ marginRight: 4 }} />
              Ejecutá el script SQL de configuración para crear los parámetros iniciales.
            </Text>
          </div>
        </Card>
      </div>
    );
  }

  // Active module data
  const activeSubModules = activeModule ? grouped[activeModule] : null;
  const activeMeta = activeModule
    ? MODULE_META[activeModule] || { label: activeModule, description: '', icon: <SettingOutlined />, color: '#999' }
    : null;

  return (
    <div className="page-enter">
      {contextHolder}

      {/* ── Banner Header ─────────────────────── */}
      <div
        className="animate-fade-in"
        style={{
          background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
          borderRadius: 14,
          padding: '28px 32px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div>
          <Title level={3} style={{ color: '#EABD23', margin: 0, fontWeight: 700 }}>
            <SettingOutlined style={{ marginRight: 10 }} />
            Configuración General
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 4, display: 'block' }}>
            Personalizá tu experiencia. Los cambios se guardan <span style={{ color: '#EABD23', fontWeight: 600 }}>por usuario</span>.
          </Text>
        </div>
        <Space>
          <Button
            icon={<UndoOutlined />}
            onClick={handleResetAll}
            disabled={saving}
            style={{
              background: 'rgba(255,255,255,0.08)',
              borderColor: 'rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.7)',
            }}
          >
            Restaurar todo
          </Button>
          <Badge count={changedCount} offset={[-4, 4]} color="#EABD23" style={{ color: '#1E1F22', fontWeight: 700 }}>
            <Button
              type="primary"
              className="btn-gold"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
              disabled={!hasChanges}
            >
              Guardar cambios
            </Button>
          </Badge>
        </Space>
        {/* Gold accent line */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, #EABD23, transparent)' }} />
      </div>

      {/* ── Logo de Empresa ───────────────────── */}
      <LogoSection />

      {/* ── Module selector cards ─────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }} className="stagger">
        {moduleKeys.map((modKey) => {
          const meta = MODULE_META[modKey] || { label: modKey, description: '', icon: <SettingOutlined />, color: '#999' };
          const subModules = grouped[modKey];
          const paramCount = Object.values(subModules ?? {}).flat().length;
          const modifiedCount = Object.values(subModules ?? {}).flat().filter(p => {
            const current = localValues[p.PARAMETRO_ID];
            const original = p.VALOR ?? p.VALOR_DEFECTO ?? '';
            return current !== undefined && current !== original;
          }).length;
          const isActive = activeModule === modKey;

          return (
            <Col xs={12} sm={6} key={modKey}>
              <Card
                className="kpi-card animate-fade-up"
                hoverable
                onClick={() => setActiveModule(isActive ? null : modKey)}
                style={{
                  cursor: 'pointer',
                  borderColor: isActive ? meta.color : undefined,
                  borderWidth: isActive ? 2 : 1,
                  boxShadow: isActive ? `0 0 16px ${meta.color}25` : undefined,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: isActive ? `${meta.color}25` : `${meta.color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, color: meta.color,
                  }}>
                    {meta.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <Text strong style={{ fontSize: 15, display: 'block', lineHeight: 1.2 }}>{meta.label}</Text>
                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      {paramCount} parámetro{paramCount !== 1 ? 's' : ''}
                      {modifiedCount > 0 && (
                        <span style={{ color: '#EABD23', fontWeight: 600, marginLeft: 4 }}>
                          · {modifiedCount} pendiente{modifiedCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </Text>
                  </div>
                  {isActive && (
                    <CheckOutlined style={{ color: meta.color, fontSize: 16 }} />
                  )}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* ── Active module settings panel ───────── */}
      {activeModule && activeSubModules && activeMeta && (
        <Card
          key={activeModule}
          className="rg-card animate-fade-up"
          style={{ borderRadius: 14, overflow: 'hidden', marginBottom: 24 }}
          styles={{
            header: {
              background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
              borderBottom: `2px solid ${activeMeta.color}`,
              padding: '14px 20px',
            },
            body: { padding: '12px 8px' },
          }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8,
                background: `${activeMeta.color}20`, color: activeMeta.color, fontSize: 16,
              }}>
                {activeMeta.icon}
              </span>
              <div style={{ flex: 1 }}>
                <Text strong style={{ color: '#fff', fontSize: 14 }}>{activeMeta.label}</Text>
                <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, display: 'block', lineHeight: 1.2 }}>
                  {activeMeta.description}
                </Text>
              </div>
              <Button
                size="small"
                icon={<UndoOutlined />}
                onClick={() => handleResetModule(activeModule, activeMeta.label)}
                disabled={saving}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  borderColor: 'rgba(255,255,255,0.15)',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: 12,
                }}
              >
                Restaurar {activeMeta.label}
              </Button>
            </div>
          }
        >
          {Object.entries(activeSubModules).map(([subKey, params], idx) => (
            <div key={subKey}>
              {Object.keys(activeSubModules).length > 1 && (
                <div style={{
                  padding: '6px 16px',
                  marginTop: idx > 0 ? 8 : 0,
                  marginBottom: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}>
                  <div style={{ width: 3, height: 14, borderRadius: 2, background: activeMeta.color }} />
                  <Text type="secondary" style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {SUBMODULE_LABELS[subKey] || subKey}
                  </Text>
                </div>
              )}
              {params.map(param => (
                <SettingRow
                  key={param.PARAMETRO_ID}
                  param={param}
                  localValue={localValues[param.PARAMETRO_ID] ?? param.VALOR ?? param.VALOR_DEFECTO ?? ''}
                  onValueChange={handleValueChange}
                />
              ))}
            </div>
          ))}
        </Card>
      )}

      {/* Hint when no module selected */}
      {!activeModule && (
        <div className="animate-fade-in" style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: 'rgba(0,0,0,0.25)',
        }}>
          <SettingOutlined style={{ fontSize: 40, marginBottom: 12, display: 'block' }} />
          <Text type="secondary" style={{ fontSize: 14 }}>
            Seleccioná un módulo para ver sus opciones
          </Text>
        </div>
      )}

      {/* ── Sticky save bar ───────────────────── */}
      {hasChanges && (
        <div style={{
          position: 'fixed',
          bottom: 56,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          zIndex: 100,
          pointerEvents: 'none',
          animation: 'fadeInUp 0.3s ease-out',
        }}>
          <div style={{
            background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
            borderRadius: 14,
            padding: '12px 28px',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            border: '1px solid rgba(234,189,35,0.25)',
            pointerEvents: 'all',
            backdropFilter: 'blur(8px)',
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#EABD23',
              animation: 'breathe 2s ease-in-out infinite',
            }} />
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13 }}>
              {changedCount} cambio{changedCount !== 1 ? 's' : ''} sin guardar
            </Text>
            <Button
              type="primary"
              className="btn-gold"
              icon={<SaveOutlined />}
              onClick={handleSave}
              loading={saving}
              size="small"
            >
              Guardar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
