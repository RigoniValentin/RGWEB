import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, Typography, Switch, Select, Input, Button, Space, Tag, Row, Col,
  message, Spin, Tooltip, Empty, Badge,
} from 'antd';
import {
  SettingOutlined, SaveOutlined, UndoOutlined, KeyOutlined,
  ShoppingCartOutlined, DollarOutlined, BankOutlined, AppstoreOutlined,
  ThunderboltOutlined, CheckOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { useSettingsStore } from '../store/settingsStore';
import type { ConfigResuelto, SaveSettingInput } from '../services/settings.api';

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
  const { settings, loaded, loading, fetchSettings, saveUserSettings, resetAll } = useSettingsStore();
  const [localValues, setLocalValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
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

  const handleResetAll = async () => {
    setSaving(true);
    try {
      await resetAll();
      msgApi.success('Configuración restaurada a valores por defecto');
    } catch {
      msgApi.error('Error al restaurar la configuración');
    } finally {
      setSaving(false);
    }
  };

  const grouped = useSettingsStore.getState().getGrouped();

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
            Restaurar
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

      {/* ── KPI Summary Cards ─────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }} className="stagger">
        {Object.entries(grouped).map(([modKey, subModules]) => {
          const meta = MODULE_META[modKey] || { label: modKey, description: '', icon: <SettingOutlined />, color: '#999' };
          const paramCount = Object.values(subModules).flat().length;
          const modifiedCount = Object.values(subModules).flat().filter(p => {
            const current = localValues[p.PARAMETRO_ID];
            const original = p.VALOR ?? p.VALOR_DEFECTO ?? '';
            return current !== undefined && current !== original;
          }).length;
          return (
            <Col xs={12} sm={6} key={modKey}>
              <Card className="kpi-card animate-fade-up" hoverable style={{ cursor: 'default' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: `${meta.color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, color: meta.color,
                  }}>
                    {meta.icon}
                  </div>
                  <div>
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
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* ── Settings by Module ────────────────── */}
      <Row gutter={[20, 20]} className="stagger">
        {Object.entries(grouped).map(([modKey, subModules]) => {
          const meta = MODULE_META[modKey] || { label: modKey, description: '', icon: <SettingOutlined />, color: '#999' };
          return (
            <Col xs={24} lg={12} key={modKey}>
              <Card
                className="rg-card animate-fade-up"
                style={{ borderRadius: 14, overflow: 'hidden' }}
                styles={{
                  header: {
                    background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
                    borderBottom: `2px solid ${meta.color}`,
                    padding: '14px 20px',
                  },
                  body: { padding: '12px 8px' },
                }}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 32, height: 32, borderRadius: 8,
                      background: `${meta.color}20`, color: meta.color, fontSize: 16,
                    }}>
                      {meta.icon}
                    </span>
                    <div>
                      <Text strong style={{ color: '#fff', fontSize: 14 }}>{meta.label}</Text>
                      <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, display: 'block', lineHeight: 1.2 }}>
                        {meta.description}
                      </Text>
                    </div>
                  </div>
                }
              >
                {Object.entries(subModules).map(([subKey, params], idx) => (
                  <div key={subKey}>
                    {Object.keys(subModules).length > 1 && (
                      <div style={{
                        padding: '6px 16px',
                        marginTop: idx > 0 ? 8 : 0,
                        marginBottom: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        <div style={{ width: 3, height: 14, borderRadius: 2, background: meta.color }} />
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
            </Col>
          );
        })}
      </Row>

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
