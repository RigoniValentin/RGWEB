import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Typography, App, Alert, Space } from 'antd';
import { UserOutlined, LockOutlined, LockFilled, ExclamationCircleFilled, CheckCircleFilled, WarningFilled, SendOutlined, KeyOutlined } from '@ant-design/icons';
import { authApi } from '../services/auth.api';
import { useAuthStore } from '../store/authStore';
import { RGLogo } from '../components/RGLogo';
import type { LicenseStatus } from '../types';

const { Title, Text } = Typography;

type ErrorState = {
  type: 'lockout' | 'invalid' | 'inactive' | 'server' | 'license';
  title: string;
  description: string;
  license?: LicenseStatus;
} | null;

type SuccessState = {
  name: string;
  mustChangePassword: boolean;
} | null;

type ActivationState = {
  activationId: string;
  expiresAt: string;
} | null;

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function LoginPage() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<ErrorState>(null);
  const [successState, setSuccessState] = useState<SuccessState>(null);
  const [activationState, setActivationState] = useState<ActivationState>(null);
  const [activationCode, setActivationCode] = useState('');
  const [requestingCode, setRequestingCode] = useState(false);
  const [activatingLicense, setActivatingLicense] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const passwordRef = useRef<any>(null);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const triggerShake = () => setShakeKey((k) => k + 1);

  const onFinish = async (values: { username: string; password: string }) => {
    // Clear previous feedback on each new attempt
    setErrorState(null);
    setSuccessState(null);
    setActivationState(null);
    setActivationCode('');
    setLoading(true);
    try {
      const { user, token, permisos, puntosVenta, roles, license } = await authApi.login(values);
      setAuth(user, token, permisos, puntosVenta, roles);

      if (license?.state === 'warning') {
        message.warning(license.message);
      }

      if (user.DEBE_CAMBIAR_CLAVE) {
        setSuccessState({ name: user.NOMBRE_COMPLETO || user.NOMBRE, mustChangePassword: true });
        message.warning('Ingresaste correctamente, pero debés cambiar tu contraseña.');
        setTimeout(() => navigate('/dashboard'), 1800);
      } else {
        setSuccessState({ name: user.NOMBRE_COMPLETO || user.NOMBRE, mustChangePassword: false });
        setTimeout(() => navigate('/dashboard'), 800);
      }
    } catch (err: any) {
      const status = err.response?.status;
      const serverMsg: string = err.response?.data?.error || '';
      const serverCode: string = err.response?.data?.code || '';
      const license: LicenseStatus | undefined = err.response?.data?.license;
      const isLicenseError = status === 403 && serverCode.startsWith('LICENSE_');

      if (!isLicenseError) {
        // Desktop-like: clear password on auth error, keep username, refocus password
        form.setFieldValue('password', '');
        setTimeout(() => passwordRef.current?.focus(), 50);
      }

      if (status === 423) {
        setErrorState({
          type: 'lockout',
          title: 'Cuenta bloqueada',
          description: 'Superaste el límite de intentos fallidos. Tu cuenta está bloqueada temporalmente. Intentá de nuevo en unos minutos o contactá al administrador.',
        });
      } else if (status === 401 && serverMsg.toLowerCase().includes('inactivo')) {
        setErrorState({
          type: 'inactive',
          title: 'Cuenta desactivada',
          description: 'Tu cuenta se encuentra inactiva. Contactá al administrador del sistema para habilitarla.',
        });
      } else if (status === 401) {
        setErrorState({
          type: 'invalid',
          title: 'Usuario o contraseña incorrectos',
          description: 'Verificá que el usuario y la contraseña sean correctos. Recordá que la contraseña distingue mayúsculas y minúsculas.',
        });
      } else if (isLicenseError) {
        const title = serverCode === 'LICENSE_DATE_INVALID'
          ? 'Fecha del equipo inválida'
          : serverCode === 'LICENSE_NOT_FOUND'
          ? 'Licencia no encontrada'
          : 'Licencia vencida';
        setErrorState({
          type: 'license',
          title,
          description: serverMsg || 'Solicitá un código de activación para renovar la licencia.',
          license,
        });
      } else {
        setErrorState({
          type: 'server',
          title: 'Error del servidor',
          description: serverMsg || 'Ocurrió un problema al conectar con el sistema. Intentá nuevamente.',
        });
      }
      triggerShake();
    } finally {
      setLoading(false);
    }
  };

  const requestLicenseCode = async () => {
    try {
      const values = await form.validateFields(['username', 'password']) as { username: string; password: string };
      setRequestingCode(true);
      const result = await authApi.requestLicenseActivationCode(values);
      setActivationState({ activationId: result.activationId, expiresAt: result.expiresAt });
      setActivationCode('');
      message.success('Código solicitado. Revisá WhatsApp con soporte.');
    } catch (err: any) {
      const serverMsg: string = err.response?.data?.error || 'No se pudo solicitar el código.';
      const retryAfter = err.response?.data?.retryAfterSeconds;
      message.error(retryAfter ? `${serverMsg} Intentá nuevamente en ${retryAfter} segundos.` : serverMsg);
    } finally {
      setRequestingCode(false);
    }
  };

  const activateLicense = async () => {
    if (!activationState) return;
    const code = activationCode.trim();
    if (code.length < 6) {
      message.warning('Ingresá el código de 6 dígitos.');
      return;
    }

    try {
      setActivatingLicense(true);
      await authApi.activateLicense({ activationId: activationState.activationId, code });
      setErrorState(null);
      setActivationState(null);
      setActivationCode('');
      message.success('Licencia activada por 31 días.');
      setTimeout(() => form.submit(), 700);
    } catch (err: any) {
      message.error(err.response?.data?.error || 'No se pudo activar la licencia.');
    } finally {
      setActivatingLicense(false);
    }
  };

  return (
    <div
      className="rg-login-root"
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        overflow: 'hidden',
        background: '#1E1F22',
      }}
    >
      {/* ── Left: Branding Panel (60%) ──────────────── */}
      <div
        className="animate-fade-left"
        style={{
          flex: '0 0 55%',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {/* Animated background pattern */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: `
            repeating-linear-gradient(
              -45deg,
              rgba(234, 189, 35, 0.03) 0px,
              rgba(234, 189, 35, 0.03) 1px,
              transparent 1px,
              transparent 40px
            )
          `,
          animation: 'shimmer 8s linear infinite',
        }} />

        {/* Radial glow behind logo */}
        <div style={{
          position: 'absolute',
          width: 500,
          height: 500,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(234,189,35,0.12) 0%, transparent 70%)',
          filter: 'blur(60px)',
          animation: 'pulse-gold 4s ease-in-out infinite',
        }} />

        {/* Top gold accent */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'linear-gradient(90deg, transparent, #EABD23, transparent)',
        }} />

        {/* Logo */}
        <div
          style={{
            position: 'relative',
            background: '#FFFFFF',
            borderRadius: 28,
            padding: 36,
            marginBottom: 40,
            boxShadow: '0 16px 64px rgba(0,0,0,0.4), 0 0 100px rgba(234,189,35,0.08)',
            animation: 'scaleIn 0.7s ease-out 0.2s both',
          }}
        >
          <RGLogo size={110} showText={false} />
        </div>

        {/* Brand name */}
        <div style={{ position: 'relative', textAlign: 'center' }}>
          <Title
            level={1}
            style={{
              margin: 0,
              fontWeight: 800,
              fontSize: 44,
              letterSpacing: '0.03em',
              lineHeight: 1.1,
              animation: 'fadeInUp 0.6s ease-out 0.3s both',
            }}
          >
            <span style={{ color: '#EABD23' }}>río</span>{' '}
            <span style={{ color: '#FFFFFF' }}>gestión</span>
          </Title>
          <Text style={{
            display: 'block',
            color: 'rgba(255,255,255,0.4)',
            marginTop: 12,
            fontSize: 15,
            letterSpacing: '0.15em',
            textTransform: 'uppercase',
            animation: 'fadeInUp 0.6s ease-out 0.45s both',
          }}>
            Sistema de Gestión Empresarial
          </Text>
        </div>

        {/* Bottom gold accent */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'linear-gradient(90deg, transparent, #EABD23, transparent)',
        }} />

        {/* Version / footer */}
        <Text style={{
          position: 'absolute',
          bottom: 24,
          color: 'rgba(255,255,255,0.2)',
          fontSize: 12,
          animation: 'fadeInUp 0.5s ease-out 0.6s both',
        }}>
          v1.0 — Río Gestión © {new Date().getFullYear()}
        </Text>
      </div>

      {/* ── Right: Login Form (45%) ─────────────────── */}
      <div
        className="animate-fade-right"
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FFFFFF',
          position: 'relative',
        }}
      >
        {/* Decorative corner element */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 120,
          height: 120,
          background: 'linear-gradient(135deg, rgba(234,189,35,0.08) 0%, transparent 100%)',
          borderRadius: '0 0 120px 0',
        }} />

        <div style={{ width: '100%', maxWidth: 400, padding: '0 40px' }}>
          {/* Welcome text */}
          <div style={{ marginBottom: 48, animation: 'fadeInUp 0.5s ease-out 0.3s both' }}>
            <Text style={{
              display: 'block',
              color: '#EABD23',
              fontSize: 14,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              marginBottom: 8,
            }}>
              Bienvenido
            </Text>
            <Title
              level={2}
              style={{
                margin: 0,
                color: '#1E1F22',
                fontWeight: 800,
                fontSize: 32,
              }}
            >
              Iniciar Sesión
            </Title>
            <div style={{
              width: 48,
              height: 3,
              background: 'linear-gradient(90deg, #EABD23, #D4A720)',
              borderRadius: 2,
              marginTop: 16,
            }} />
          </div>

          {/* Feedback alert */}
          {errorState && (
            <div
              key={`shake-${shakeKey}`}
              style={{ marginBottom: 24, animation: 'shake 0.45s ease-out' }}
            >
              <Alert
                type={errorState.type === 'lockout' ? 'error' : errorState.type === 'inactive' ? 'warning' : errorState.type === 'server' ? 'warning' : 'error'}
                showIcon
                icon={
                  errorState.type === 'lockout'
                    ? <LockFilled />
                    : errorState.type === 'inactive'
                    ? <WarningFilled />
                    : errorState.type === 'license'
                    ? <KeyOutlined />
                    : <ExclamationCircleFilled />
                }
                message={errorState.title}
                description={errorState.description}
                style={{ borderRadius: 10, textAlign: 'left' }}
              />
            </div>
          )}

          {errorState?.type === 'license' && errorState.license?.state !== 'date_invalid' && (
            <div style={{ marginBottom: 24, animation: 'fadeInUp 0.35s ease-out' }}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Button
                  icon={<SendOutlined />}
                  loading={requestingCode}
                  disabled={activatingLicense}
                  block
                  onClick={requestLicenseCode}
                  style={{ height: 46, borderRadius: 10, fontWeight: 700 }}
                >
                  Solicitar código de activación
                </Button>

                {activationState && (
                  <div
                    style={{
                      border: '1px solid #f0f0f0',
                      borderRadius: 10,
                      padding: 12,
                      background: '#fafafa',
                    }}
                  >
                    <Text style={{ display: 'block', color: '#595959', fontSize: 13, marginBottom: 10 }}>
                      Solicitud enviada. Válido hasta {formatDateTime(activationState.expiresAt)}.
                    </Text>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input
                        value={activationCode}
                        onChange={(event) => setActivationCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        onPressEnter={activateLicense}
                        maxLength={6}
                        inputMode="numeric"
                        placeholder="Código"
                        style={{ height: 44, fontSize: 16, letterSpacing: 2 }}
                      />
                      <Button
                        type="primary"
                        icon={<KeyOutlined />}
                        loading={activatingLicense}
                        onClick={activateLicense}
                        style={{ height: 44, fontWeight: 700 }}
                      >
                        Activar
                      </Button>
                    </Space.Compact>
                  </div>
                )}
              </Space>
            </div>
          )}

          {successState && (
            <div style={{ marginBottom: 24, animation: 'fadeInUp 0.4s ease-out' }}>
              <Alert
                type={successState.mustChangePassword ? 'warning' : 'success'}
                showIcon
                icon={successState.mustChangePassword ? <WarningFilled /> : <CheckCircleFilled />}
                message={successState.mustChangePassword ? 'Contraseña temporal detectada' : `¡Bienvenido, ${successState.name}!`}
                description={successState.mustChangePassword ? `Bienvenido, ${successState.name}. Por seguridad debés cambiar tu contraseña antes de continuar.` : 'Ingresando al sistema…'}
                style={{ borderRadius: 10, textAlign: 'left' }}
              />
            </div>
          )}

          {/* Form */}
          <Form
            form={form}
            name="rg-login"
            onFinish={onFinish}
            layout="vertical"
            size="large"
            autoComplete="off"
            style={{ animation: 'fadeInUp 0.5s ease-out 0.45s both' }}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: 'Ingrese su usuario' }]}
              style={{ marginBottom: 24 }}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#EABD23', fontSize: 16 }} />}
                placeholder="Nombre de usuario"
                autoFocus
                autoComplete="username"
                style={{
                  height: 54,
                  borderRadius: 12,
                  border: errorState ? '2px solid #ff4d4f' : '2px solid #f0f0f0',
                  fontSize: 15,
                  paddingLeft: 16,
                  transition: 'border-color 0.2s',
                }}
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Ingrese su contraseña' }]}
              style={{ marginBottom: errorState || successState ? 24 : 36 }}
            >
              <Input.Password
                ref={passwordRef}
                prefix={<LockOutlined style={{ color: '#EABD23', fontSize: 16 }} />}
                placeholder="Contraseña"
                autoComplete="current-password"
                style={{
                  height: 54,
                  borderRadius: 12,
                  border: errorState ? '2px solid #ff4d4f' : '2px solid #f0f0f0',
                  fontSize: 15,
                  paddingLeft: 16,
                  transition: 'border-color 0.2s',
                }}
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                disabled={!!successState}
                block
                className="btn-gold"
                style={{
                  height: 54,
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: '0.03em',
                  boxShadow: '0 8px 24px rgba(234, 189, 35, 0.3)',
                }}
              >
                {loading ? 'Verificando…' : 'Ingresar al Sistema'}
              </Button>
            </Form.Item>
          </Form>
        </div>
      </div>
    </div>
  );
}
