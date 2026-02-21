import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Avatar, Dropdown, Select, Tag } from 'antd';
import {
  DoubleLeftOutlined,
  DoubleRightOutlined,
  DashboardOutlined,
  TeamOutlined,
  ShoppingOutlined,
  DollarOutlined,
  ShopOutlined,
  LogoutOutlined,
  UserOutlined,
  FolderOutlined,
  SwapOutlined,
  InboxOutlined,
  TagsOutlined,
  TagOutlined,
  ShoppingCartOutlined,
  BarChartOutlined,
  SettingOutlined,
  LockOutlined,
  GiftOutlined,
  BankOutlined,
  FileProtectOutlined,
  CreditCardOutlined,
  AuditOutlined,
  ToolOutlined,
  CoffeeOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';
import { RGLogo } from './RGLogo';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

/* ── Menu sections matching Río Gestión desktop ─ */
const menuItems = [
  {
    key: '/dashboard',
    icon: <DashboardOutlined />,
    label: 'Dashboard',
  },
  {
    key: 'archivos',
    icon: <FolderOutlined />,
    label: 'Archivos',
    children: [
      { type: 'group' as const, label: 'Archivos', className: 'rg-popup-group-title', children: [
        { key: '/customers', icon: <TeamOutlined />, label: 'Clientes' },
        { key: '/suppliers', icon: <ShopOutlined />, label: 'Proveedores' },
        { key: '/deposits', icon: <InboxOutlined />, label: 'Depósitos' },
        { key: '/categories', icon: <TagsOutlined />, label: 'Categorías' },
        { key: '/brands', icon: <TagOutlined />, label: 'Marcas' },
        { key: '/products', icon: <ShoppingOutlined />, label: 'Productos' },
        { key: '/promotions', icon: <GiftOutlined />, label: 'Promociones' },
      ]},
    ],
  },
  {
    key: 'movimientos',
    icon: <SwapOutlined />,
    label: 'Movimientos',
    children: [
      { type: 'group' as const, label: 'Movimientos', className: 'rg-popup-group-title', children: [
        { key: '/sales', icon: <DollarOutlined />, label: 'Ventas' },
        { key: '/purchases', icon: <ShoppingCartOutlined />, label: 'Compras' },
        { key: '/cashregisters', icon: <BankOutlined />, label: 'Cajas' },
        { key: '/arca', icon: <FileProtectOutlined />, label: 'ARCA' },
        { key: '/expenses', icon: <CreditCardOutlined />, label: 'Gastos y Servicios' },
        { key: '/audit', icon: <AuditOutlined />, label: 'Auditorías' },
      ]},
    ],
  },
  {
    key: '/production',
    icon: <ToolOutlined />,
    label: 'Producción',
  },
  {
    key: '/gastronomy',
    icon: <CoffeeOutlined />,
    label: 'Gastronomía',
  },
  {
    key: '/reports',
    icon: <BarChartOutlined />,
    label: 'Reportes',
  },
  {
    key: '/users',
    icon: <LockOutlined />,
    label: 'Usuarios y Permisos',
  },
  {
    key: '/settings',
    icon: <SettingOutlined />,
    label: 'Configuraciones',
  },
];

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, puntosVenta, puntoVentaActivo, setPuntoVentaActivo, logout } = useAuthStore();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const pvNombre = puntosVenta.find(pv => pv.PUNTO_VENTA_ID === puntoVentaActivo)?.NOMBRE;

  const userMenuItems = [
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: 'Perfil',
    },
    {
      type: 'divider' as const,
    },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Cerrar Sesión',
      danger: true,
      onClick: handleLogout,
    },
  ];

  // Detect which submenu should be open based on path
  const getOpenKeys = (): string[] => {
    const archivos = ['/customers', '/suppliers', '/deposits', '/categories', '/brands', '/products', '/promotions'];
    const movimientos = ['/sales', '/purchases', '/cashregisters', '/arca', '/expenses', '/audit'];
    if (archivos.includes(location.pathname)) return ['archivos'];
    if (movimientos.includes(location.pathname)) return ['movimientos'];
    return [];
  };

  const [openKeys, setOpenKeys] = useState<string[]>(getOpenKeys());

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ── Sidebar ─────────────────────────── */}
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={230}
        collapsedWidth={64}
        className={`rg-sidebar ${collapsed ? 'rg-sidebar-collapsed' : ''}`}
        style={{
          background: 'linear-gradient(180deg, #1E1F23 0%, #2A2B2F 100%)',
          borderRight: '1px solid rgba(234, 189, 35, 0.15)',
          height: '100vh',
          position: 'sticky',
          top: 0,
          left: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Logo + Collapse toggle */}
        <div
          className="rg-sidebar-header"
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            padding: collapsed ? '0' : '0 12px 0 16px',
            borderBottom: '1px solid rgba(234, 189, 35, 0.15)',
            transition: 'all 0.3s ease',
            flexShrink: 0,
          }}
        >
          <div
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            onClick={() => navigate('/dashboard')}
          >
            <RGLogo size={collapsed ? 34 : 38} collapsed={collapsed} variant="white" />
          </div>
          {!collapsed && (
            <Button
              type="text"
              icon={<DoubleLeftOutlined />}
              onClick={() => setCollapsed(true)}
              className="rg-collapse-btn"
              size="small"
              style={{
                color: 'rgba(255,255,255,0.45)',
                fontSize: 14,
                width: 28,
                height: 28,
                borderRadius: 6,
              }}
            />
          )}
        </div>

        {/* Collapsed toggle button */}
        {collapsed && (
          <div
            className="rg-expand-btn"
            onClick={() => setCollapsed(false)}
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '10px 0 6px',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <DoubleRightOutlined style={{ color: '#EABD23', fontSize: 16 }} />
          </div>
        )}

        {/* Navigation */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[location.pathname]}
            {...(collapsed ? {} : { openKeys, onOpenChange: setOpenKeys })}
            items={menuItems}
            onClick={({ key }) => {
              if (key.startsWith('/')) navigate(key);
            }}
            style={{
              marginTop: 4,
              border: 'none',
            }}
          />
        </div>

        {/* Bottom version */}
        {!collapsed && (
          <div style={{
            padding: '12px 0',
            textAlign: 'center',
            opacity: 0.3,
            flexShrink: 0,
            borderTop: '1px solid rgba(234, 189, 35, 0.1)',
          }}>
            <Text style={{ color: '#fff', fontSize: 11 }}>v1.0.0</Text>
          </div>
        )}
      </Sider>

      <Layout>
        {/* ── Header ──────────────────────────── */}
        <Header style={{
          padding: '0 24px',
          background: '#1E1F23',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '2px solid #EABD23',
          height: 56,
          lineHeight: '56px',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Mobile toggle (shows only when sidebar collapsed, as secondary control) */}
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              className="rg-header-toggle"
              style={{ color: 'rgba(255,255,255,0.5)', fontSize: 15, width: 36, height: 36 }}
            />
            <Text style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 13,
              fontStyle: 'italic',
            }}>
              río <span style={{ fontWeight: 700, fontStyle: 'normal' }}>gestión</span>
            </Text>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* Punto de Venta Activo */}
            {puntosVenta.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                  Pto. Venta:
                </Text>
                {puntosVenta.length === 1 ? (
                  <Tag color="#EABD23" style={{ color: '#1E1F23', fontWeight: 600, margin: 0 }}>
                    {pvNombre}
                  </Tag>
                ) : (
                  <Select
                    size="small"
                    value={puntoVentaActivo}
                    onChange={setPuntoVentaActivo}
                    style={{ width: 140 }}
                    options={puntosVenta.map(pv => ({
                      label: pv.NOMBRE,
                      value: pv.PUNTO_VENTA_ID,
                    }))}
                    popupMatchSelectWidth={false}
                  />
                )}
              </div>
            )}

            {/* User info */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'rgba(255,255,255,0.5)',
              fontSize: 12,
            }}>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                Usuario:
              </Text>
              <Text style={{ color: '#EABD23', fontWeight: 600, fontSize: 13 }}>
                {user?.NOMBRE || 'Usuario'}
              </Text>
            </div>

            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" trigger={['click']}>
              <Avatar
                style={{
                  background: 'linear-gradient(135deg, #EABD23, #D4A720)',
                  color: '#1E1F23',
                  cursor: 'pointer',
                  fontWeight: 700,
                  transition: 'all 0.3s ease',
                }}
                icon={<UserOutlined />}
              />
            </Dropdown>
          </div>
        </Header>

        {/* ── Content ─────────────────────────── */}
        <Content style={{
          margin: 20,
          padding: 24,
          background: '#FFFFFF',
          borderRadius: 12,
          minHeight: 280,
          boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
        }}>
          <div className="page-enter">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
