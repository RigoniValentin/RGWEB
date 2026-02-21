import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Typography, App } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { authApi } from '../services/auth.api';
import { useAuthStore } from '../store/authStore';
import { RGLogo } from '../components/RGLogo';

const { Title, Text } = Typography;

export function LoginPage() {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const { user, token, permisos, puntosVenta } = await authApi.login(values);
      setAuth(user, token, permisos, puntosVenta);
      message.success(`Bienvenido, ${user.NOMBRE}`);
      navigate('/dashboard');
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Error al iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: `
        repeating-linear-gradient(
          -45deg,
          #1E1F22,
          #1E1F22 10px,
          #2A2B2F 10px,
          #2A2B2F 20px
        )
      `,
      padding: 16,
    }}>
      <div
        className="animate-scale-in"
        style={{
          display: 'flex',
          width: '100%',
          maxWidth: 860,
          minHeight: 480,
          borderRadius: 20,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        {/* ── Left Panel - Dark with Logo ───── */}
        <div
          className="animate-fade-left"
          style={{
            flex: '0 0 320px',
            background: 'linear-gradient(180deg, #1E1F22 0%, #2A2B2F 100%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 32px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Decorative gold line */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            background: 'linear-gradient(90deg, transparent, #EABD23, transparent)',
          }} />

          <div style={{
            background: '#FFFFFF',
            borderRadius: 20,
            padding: 28,
            marginBottom: 36,
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            animation: 'scaleIn 0.6s ease-out 0.2s both',
          }}>
            <RGLogo size={90} showText={false} />
          </div>

          <Title
            level={2}
            style={{
              color: '#EABD23',
              margin: 0,
              fontWeight: 700,
              letterSpacing: '0.02em',
              animation: 'fadeInUp 0.5s ease-out 0.3s both',
            }}
          >
            ¡Bienvenido!
          </Title>
          <Text style={{
            color: 'rgba(255,255,255,0.6)',
            marginTop: 8,
            textAlign: 'center',
            fontSize: 14,
            animation: 'fadeInUp 0.5s ease-out 0.4s both',
          }}>
            Ingrese sus credenciales para<br />acceder al sistema
          </Text>

          {/* Bottom decorative line */}
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
            background: 'linear-gradient(90deg, transparent, #EABD23, transparent)',
          }} />
        </div>

        {/* ── Right Panel - Form ────────────── */}
        <div
          className="animate-fade-right"
          style={{
            flex: 1,
            background: '#FFFFFF',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '48px 48px',
          }}
        >
          <div style={{ marginBottom: 36 }}>
            <Title
              level={2}
              style={{
                margin: 0,
                color: '#1E1F22',
                fontWeight: 700,
              }}
            >
              Iniciar Sesión
            </Title>
            <div style={{
              width: 48,
              height: 3,
              background: '#EABD23',
              borderRadius: 2,
              marginTop: 12,
            }} />
          </div>

          <Form
            name="login"
            onFinish={onFinish}
            layout="vertical"
            size="large"
            style={{ maxWidth: 380 }}
          >
            <Form.Item
              name="username"
              rules={[{ required: true, message: 'Ingrese su usuario' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#EABD23' }} />}
                placeholder="Nombre de usuario"
                autoFocus
                style={{
                  height: 50,
                  borderRadius: 10,
                  border: '1.5px solid #e8e8e8',
                  fontSize: 15,
                }}
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: 'Ingrese su contraseña' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#EABD23' }} />}
                placeholder="Contraseña"
                style={{
                  height: 50,
                  borderRadius: 10,
                  border: '1.5px solid #e8e8e8',
                  fontSize: 15,
                }}
              />
            </Form.Item>

            <Form.Item style={{ marginTop: 32 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                block
                className="btn-gold"
                style={{
                  height: 50,
                  borderRadius: 10,
                  fontSize: 16,
                  letterSpacing: '0.02em',
                }}
              >
                Ingresar al Sistema
              </Button>
            </Form.Item>
          </Form>
        </div>
      </div>
    </div>
  );
}
