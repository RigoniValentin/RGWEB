import { useEffect, useState, useRef, useCallback } from 'react';
import { Typography, Tag, Tooltip, Card, Input, Button, message, Collapse } from 'antd';
import {
  DollarOutlined,
  BankOutlined,
  ArrowRightOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  UserOutlined,
  KeyOutlined,
  ThunderboltOutlined,
  SaveOutlined,
  BarcodeOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../store/authStore';
import { useTabStore } from '../store/tabStore';
import { useSettingsStore } from '../store/settingsStore';
import { dashboardApi } from '../services/dashboard.api';
import { RGLogo } from '../components/RGLogo';

const { Title, Text } = Typography;

// ── Greeting based on time of day ────────────────────────────────────────────
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

// ── Live clock (1s tick, single setInterval) ────────────────────────────────
function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      color: 'rgba(255,255,255,0.65)',
      fontSize: 13,
      fontVariantNumeric: 'tabular-nums',
    }}>
      <ClockCircleOutlined />
      {time.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

// ── Quick action ─────────────────────────────────────────────────────────────
interface QuickActionProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color: string;
  onClick: () => void;
  kbd?: string;
  delay?: number;
}
function QuickAction({ icon, title, subtitle, color, onClick, kbd, delay = 0 }: QuickActionProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      className="rg-quick-action"
      style={{ ['--qa-color' as never]: color, animationDelay: `${delay}ms` }}
    >
      <div className="rg-quick-action-icon" style={{ animationDelay: `${delay + 120}ms` }}>
        {icon}
      </div>
      <div className="rg-quick-action-body">
        <span className="rg-quick-action-title">{title}</span>
        <span className="rg-quick-action-sub">{subtitle}</span>
        {kbd && <span className="rg-quick-action-kbd">{kbd}</span>}
      </div>
      <div className="rg-quick-action-cta" aria-hidden>
        <ArrowRightOutlined />
      </div>
    </div>
  );
}

// ── Shortcut recorder ────────────────────────────────────────────────────────
function ShortcutCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
          width: 200,
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

// ── Main "Inicio" page for CAJERO ────────────────────────────────────────────
export function CajeroDashboardPage() {
  const navigate = useNavigate();
  const { user, puntosVenta, puntoVentaActivo } = useAuthStore();
  const { openTab } = useTabStore();
  const { settings, loaded, fetchSettings, saveUserSettings } = useSettingsStore();
  const [localShortcuts, setLocalShortcuts] = useState<Record<number, string>>({});
  const [savingShortcuts, setSavingShortcuts] = useState(false);
  const [msgApi, contextHolder] = message.useMessage();

  const { data: logoUrl } = useQuery({
    queryKey: ['empresa-logo'],
    queryFn: () => dashboardApi.getLogo(),
    staleTime: Infinity,
    retry: false,
  });

  // Load settings once if not yet loaded
  useEffect(() => { if (!loaded) fetchSettings(); }, [loaded, fetchSettings]);

  // Shortcut parameters for this page
  const SHORTCUT_CLAVES = ['atajo_nueva_venta', 'atajo_abrir_caja', 'atajo_busqueda_rapida_producto'];
  const shortcutParams = settings.filter(s => SHORTCUT_CLAVES.includes(s.CLAVE));

  // Sync local state whenever settings load/reload
  useEffect(() => {
    if (shortcutParams.length === 0) return;
    setLocalShortcuts(prev => {
      const next = { ...prev };
      for (const s of shortcutParams) {
        if (next[s.PARAMETRO_ID] === undefined) {
          next[s.PARAMETRO_ID] = s.VALOR ?? s.VALOR_DEFECTO ?? '';
        }
      }
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const hasShortcutChanges = shortcutParams.some(
    s => localShortcuts[s.PARAMETRO_ID] !== undefined &&
         localShortcuts[s.PARAMETRO_ID] !== (s.VALOR ?? s.VALOR_DEFECTO ?? '')
  );

  const handleSaveShortcuts = async () => {
    setSavingShortcuts(true);
    try {
      const changed = shortcutParams
        .filter(s => localShortcuts[s.PARAMETRO_ID] !== undefined &&
                     localShortcuts[s.PARAMETRO_ID] !== (s.VALOR ?? s.VALOR_DEFECTO ?? ''))
        .map(s => ({ PARAMETRO_ID: s.PARAMETRO_ID, VALOR: localShortcuts[s.PARAMETRO_ID] ?? '' }));
      if (changed.length > 0) {
        await saveUserSettings(changed);
        msgApi.success('Atajos guardados correctamente');
      } else {
        msgApi.info('No hay cambios para guardar');
      }
    } catch {
      msgApi.error('Error al guardar los atajos');
    } finally {
      setSavingShortcuts(false);
    }
  };

  const pvNombre = puntosVenta.find((pv) => pv.PUNTO_VENTA_ID === puntoVentaActivo)?.NOMBRE
    ?? puntosVenta[0]?.NOMBRE
    ?? '—';

  const handleNuevaVenta = () => {
    openTab({ key: '/sales', label: 'Ventas', closable: true });
    navigate('/sales');
    setTimeout(() => window.dispatchEvent(new CustomEvent('rg:open-new-sale')), 150);
  };

  const handleGoCaja = () => {
    openTab({ key: '/cashregisters', label: 'Cajas', closable: true });
    navigate('/cashregisters');
  };

  const today = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const todayCapitalized = today.charAt(0).toUpperCase() + today.slice(1);

  return (
    <div>
      {contextHolder}
      {/* ── Hero / Welcome ──────────────────────────────────────────────── */}
      <div className="rg-cajero-hero">
        {/* decorative grid layer */}
        <div className="rg-cajero-hero-grid" aria-hidden />

        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 24,
          flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <span className="rg-cajero-badge">
                <UserOutlined /> CAJERO
              </span>
              <LiveClock />
            </div>

            <Title level={2} style={{
              color: '#fff',
              margin: 0,
              fontWeight: 800,
              letterSpacing: '-0.01em',
              lineHeight: 1.1,
            }}>
              {getGreeting()},{' '}
              <span style={{ color: '#EABD23' }}>{user?.NOMBRE ?? 'Cajero'}</span>
            </Title>

            <Text style={{
              color: 'rgba(255,255,255,0.6)',
              fontSize: 15,
              marginTop: 8,
              display: 'block',
              maxWidth: 540,
            }}>
              Listo para operar. Accedé a las funciones que usás todos los días con un clic.
            </Text>

            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 14,
              marginTop: 18,
              color: 'rgba(255,255,255,0.55)',
              fontSize: 13,
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CalendarOutlined />
                {todayCapitalized}
              </span>

              <Tooltip title="Punto de venta asignado por el administrador">
                <Tag
                  icon={<EnvironmentOutlined />}
                  color="#EABD23"
                  style={{
                    color: '#1E1F22',
                    fontWeight: 700,
                    margin: 0,
                    borderRadius: 6,
                    cursor: 'help',
                  }}
                >
                  {pvNombre}
                </Tag>
              </Tooltip>
            </div>
          </div>

          {/* Logo float */}
          <div
            className="rg-cajero-hero-logo"
            style={{
              padding: 14,
              borderRadius: 18,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(234,189,35,0.18)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
            }}
          >
            {logoUrl
              ? <img src={logoUrl} alt="Logo empresa" style={{ width: 88, height: 88, objectFit: 'contain', display: 'block' }} />
              : <RGLogo size={88} showText={false} variant="white" />
            }
          </div>
        </div>
      </div>

      {/* ── Quick actions ───────────────────────────────────────────────── */}
      <div className="rg-section-title">Accesos rápidos</div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
        gap: 18,
      }}>
        <QuickAction
          icon={<DollarOutlined />}
          title="Ventas"
          subtitle="Registrar una nueva venta o consultar las del día"
          color="#EABD23"
          onClick={handleNuevaVenta}
          delay={80}
        />
        <QuickAction
          icon={<BankOutlined />}
          title="Caja"
          subtitle="Apertura, cierre y movimientos de tu caja"
          color="#1890ff"
          onClick={handleGoCaja}
          delay={160}
        />
        <QuickAction
          icon={<BarcodeOutlined />}
          title="Consultar producto"
          subtitle="Escaneá un código de barras y vé precio, stock y detalles al instante"
          color="#52c41a"
          onClick={() => window.dispatchEvent(new CustomEvent('rg:open-quick-product-lookup'))}
          delay={240}
        />
      </div>

      {/* ── Shortcut config ─────────────────────────────────────────────── */}
      <Collapse
        ghost
        style={{ marginTop: 28, background: 'transparent' }}
        className="rg-shortcuts-collapse"
        items={[{
          key: 'shortcuts',
          label: (
            <div className="rg-section-title" style={{ margin: 0 }}>
              Atajos de teclado
            </div>
          ),
          children: (
            <Card
              size="small"
              style={{ borderRadius: 14, border: '1px solid rgba(0,0,0,0.08)' }}
              styles={{ body: { padding: '16px 20px' } }}
            >
              {shortcutParams.length === 0 ? (
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  Cargando configuración…
                </Typography.Text>
              ) : (
                <>
                  {shortcutParams.map((param) => {
                    const currentVal = localShortcuts[param.PARAMETRO_ID] ?? '';
                    const originalVal = param.VALOR ?? param.VALOR_DEFECTO ?? '';
                    const isModified = currentVal !== originalVal;
                    return (
                      <div
                        key={param.PARAMETRO_ID}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '10px 12px',
                          borderRadius: 10,
                          marginBottom: 6,
                          background: isModified ? 'rgba(234,189,35,0.06)' : 'rgba(0,0,0,0.01)',
                          border: isModified ? '1px solid rgba(234,189,35,0.2)' : '1px solid transparent',
                        }}
                      >
                        <div>
                          <Typography.Text strong style={{ fontSize: 13.5 }}>
                            {param.DESCRIPCION}
                          </Typography.Text>
                          {param.VALOR_DEFECTO && (
                            <Typography.Text type="secondary" style={{ fontSize: 11.5, display: 'block' }}>
                              Por defecto:{' '}
                              <code style={{
                                fontSize: 11,
                                background: 'rgba(0,0,0,0.04)',
                                padding: '1px 6px',
                                borderRadius: 4,
                                fontFamily: 'monospace',
                              }}>
                                {param.VALOR_DEFECTO}
                              </code>
                            </Typography.Text>
                          )}
                        </div>
                        <ShortcutCapture
                          value={currentVal}
                          onChange={(v) => setLocalShortcuts(prev => ({ ...prev, [param.PARAMETRO_ID]: v }))}
                        />
                      </div>
                    );
                  })}
                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button
                      type="primary"
                      className="btn-gold"
                      icon={<SaveOutlined />}
                      loading={savingShortcuts}
                      disabled={!hasShortcutChanges}
                      onClick={handleSaveShortcuts}
                    >
                      Guardar atajos
                    </Button>
                  </div>
                </>
              )}
            </Card>
          ),
        }]}
      />

      {/* ── Footer hint ─────────────────────────────────────────────────── */}
      <div style={{
        marginTop: 32,
        textAlign: 'center',
        color: 'rgba(0,0,0,0.35)',
        fontSize: 12,
        letterSpacing: '0.04em',
      }}>
        Río Gestión <span style={{ color: '#EABD23', fontWeight: 700 }}>•</span> Gestionamos con vos, crecemos juntos.
      </div>
    </div>
  );
}
