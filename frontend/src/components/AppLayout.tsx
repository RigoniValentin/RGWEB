import { useState, useEffect, useMemo, useRef, type ComponentType } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
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
  BuildOutlined,
  OrderedListOutlined,
  TableOutlined,
  FileTextOutlined,
  UnorderedListOutlined,
  IdcardOutlined,
  SafetyOutlined,
  HomeOutlined,
  EnvironmentOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';
import { useTabStore } from '../store/tabStore';
import { useQueryClient } from '@tanstack/react-query';
import { RGLogo } from './RGLogo';
import { TabBar } from './TabBar';

// ── Lazy-loaded page components ──────────────────
import { DashboardPage } from '../pages/DashboardPage';
import { CustomersPage } from '../pages/CustomersPage';
import { ProductsPage } from '../pages/ProductsPage';
import { SalesPage } from '../pages/SalesPage';
import { SuppliersPage } from '../pages/SuppliersPage';
import { CajaPage } from '../pages/CajaPage';
import { CajaCentralPage } from '../pages/CajaCentralPage';
import { DepositsPage } from '../pages/DepositsPage';
import { CategoriesPage } from '../pages/CategoriesPage';
import { BrandsPage } from '../pages/BrandsPage';
import { CtaCorrientePage } from '../pages/CtaCorrientePage';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

/* ── Tab route configuration ────────────────────── */
interface TabRoute {
  label: string;
  icon: React.ReactNode;
  component: ComponentType;
  closable: boolean;
}

const TAB_ROUTES: Record<string, TabRoute> = {
  '/dashboard':      { label: 'Dashboard',    icon: <DashboardOutlined />,    component: DashboardPage,    closable: false },
  '/customers':      { label: 'Clientes',     icon: <TeamOutlined />,         component: CustomersPage,    closable: true },
  '/products':       { label: 'Productos',    icon: <ShoppingOutlined />,     component: ProductsPage,     closable: true },
  '/sales':          { label: 'Ventas',       icon: <DollarOutlined />,       component: SalesPage,        closable: true },
  '/suppliers':      { label: 'Proveedores',  icon: <ShopOutlined />,         component: SuppliersPage,    closable: true },
  '/cashregisters':  { label: 'Cajas',        icon: <BankOutlined />,         component: CajaPage,         closable: true },
  '/cashcentral':    { label: 'Caja Central', icon: <WalletOutlined />,       component: CajaCentralPage,  closable: true },
  '/deposits':       { label: 'Depósitos',    icon: <InboxOutlined />,        component: DepositsPage,     closable: true },
  '/categories':     { label: 'Categorías',   icon: <TagsOutlined />,         component: CategoriesPage,   closable: true },
  '/brands':         { label: 'Marcas',        icon: <TagOutlined />,          component: BrandsPage,       closable: true },
  '/cta-corriente':  { label: 'Cta. Corriente', icon: <WalletOutlined />,       component: CtaCorrientePage, closable: true },
};

/** Icon map for TabBar */
const ICON_MAP: Record<string, React.ReactNode> = Object.fromEntries(
  Object.entries(TAB_ROUTES).map(([key, r]) => [key, r.icon])
);

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
        { key: '/cashcentral', icon: <WalletOutlined />, label: 'Caja Central' },
        { key: 'ctas-corrientes', icon: <WalletOutlined />, label: 'Cuentas Corrientes', children: [
          { key: '/cta-corriente', icon: <TeamOutlined />, label: 'Cta Cte Clientes' },
          { key: '/cta-corriente-prov', icon: <ShopOutlined />, label: 'Cta Cte Proveedores' },
        ]},
        { key: '/arca', icon: <FileProtectOutlined />, label: 'ARCA' },
        { key: '/expenses', icon: <CreditCardOutlined />, label: 'Gastos y Servicios' },
        { key: '/audit', icon: <AuditOutlined />, label: 'Auditorías' },
      ]},
    ],
  },
  {
    key: 'produccion',
    icon: <ToolOutlined />,
    label: 'Producción',
    children: [
      { type: 'group' as const, label: 'Producción', className: 'rg-popup-group-title', children: [
        { key: '/production/structures', icon: <BuildOutlined />, label: 'Estructuras' },
        { key: '/production/orders', icon: <OrderedListOutlined />, label: 'Órdenes' },
      ]},
    ],
  },
  {
    key: 'gastronomia',
    icon: <CoffeeOutlined />,
    label: 'Gastronomía',
    children: [
      { type: 'group' as const, label: 'Gastronomía', className: 'rg-popup-group-title', children: [
        { key: '/gastronomy/tables', icon: <TableOutlined />, label: 'Gestión de Mesas' },
      ]},
    ],
  },
  {
    key: 'reportes',
    icon: <BarChartOutlined />,
    label: 'Reportes',
    children: [
      { type: 'group' as const, label: 'Reportes', className: 'rg-popup-group-title', children: [
        { key: '/reports/reports', icon: <FileTextOutlined />, label: 'Reportes' },
        { key: '/reports/listings', icon: <UnorderedListOutlined />, label: 'Listados' },
      ]},
    ],
  },
  {
    key: 'usuarios',
    icon: <LockOutlined />,
    label: 'Usuarios y Permisos',
    children: [
      { type: 'group' as const, label: 'Usuarios y Permisos', className: 'rg-popup-group-title', children: [
        { key: '/users/users', icon: <UserOutlined />, label: 'Usuarios' },
        { key: '/users/staff', icon: <IdcardOutlined />, label: 'Personal' },
        { key: '/users/permissions', icon: <SafetyOutlined />, label: 'Permiso Acciones' },
      ]},
    ],
  },
  {
    key: 'configuracion',
    icon: <SettingOutlined />,
    label: 'Configuración',
    children: [
      { type: 'group' as const, label: 'Configuración', className: 'rg-popup-group-title', children: [
        { key: '/settings/company', icon: <HomeOutlined />, label: 'Mi Empresa' },
        { key: '/settings/pos', icon: <EnvironmentOutlined />, label: 'Puntos de Venta' },
      ]},
    ],
  },
];

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, puntosVenta, puntoVentaActivo, setPuntoVentaActivo, logout } = useAuthStore();
  const { tabs, activeKey, openTab } = useTabStore();
  const queryClient = useQueryClient();

  // Auto-refresh data when switching tabs
  const prevActiveKey = useRef(activeKey);
  useEffect(() => {
    if (activeKey !== prevActiveKey.current) {
      prevActiveKey.current = activeKey;
      queryClient.invalidateQueries();
    }
  }, [activeKey, queryClient]);

  // Sync: if URL changes externally (e.g. browser back/forward), open/activate the tab
  useEffect(() => {
    const path = location.pathname;
    const route = TAB_ROUTES[path];
    if (route) {
      openTab({ key: path, label: route.label, closable: route.closable });
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate from sidebar → open tab
  const handleMenuClick = (key: string) => {
    const route = TAB_ROUTES[key];
    if (route) {
      openTab({ key, label: route.label, closable: route.closable });
      navigate(key);
    } else {
      navigate(key);
    }
  };

  // Render tab panels: each open tab stays mounted, hidden via display:none
  const tabPanels = useMemo(() => {
    return tabs
      .filter(tab => tab.key in TAB_ROUTES)
      .map(tab => {
        const Comp = TAB_ROUTES[tab.key]!.component;
        return (
          <div
            key={tab.key}
            className="rg-tab-panel"
            style={{ display: tab.key === activeKey ? 'block' : 'none' }}
          >
            <Comp />
          </div>
        );
      });
  }, [tabs, activeKey]);

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
    const groups: Record<string, string[]> = {
      archivos: ['/customers', '/suppliers', '/deposits', '/categories', '/brands', '/products', '/promotions'],
      movimientos: ['/sales', '/purchases', '/cashregisters', '/cashcentral', '/arca', '/expenses', '/audit'],
      produccion: ['/production/structures', '/production/orders'],
      gastronomia: ['/gastronomy/tables'],
      reportes: ['/reports/reports', '/reports/listings'],
      usuarios: ['/users/users', '/users/staff', '/users/permissions'],
      configuracion: ['/settings/company', '/settings/pos'],
    };
    for (const [group, paths] of Object.entries(groups)) {
      if (paths.includes(activeKey)) return [group];
    }
    return [];
  };

  const [openKeys, setOpenKeys] = useState<string[]>(getOpenKeys());

  // When collapsed, also select the parent submenu so its icon highlights
  const getSelectedKeys = (): string[] => {
    const keys = [activeKey];
    if (collapsed) {
      const parentGroup = getOpenKeys();
      if (parentGroup.length > 0) keys.push(...parentGroup);
    }
    return keys;
  };

  return (
    <Layout style={{ minHeight: '100vh', paddingBottom: 42 }}>
      {/* ── Sidebar ─────────────────────────── */}
      <Sider
        trigger={null}
        collapsible
        collapsed={collapsed}
        width={230}
        collapsedWidth={54}
        className={`rg-sidebar ${collapsed ? 'rg-sidebar-collapsed' : ''}`}
        style={{
          background: collapsed
            ? 'linear-gradient(180deg, #1A1B1E 50%, #1A1B1E 100%)'
            : 'linear-gradient(180deg, #1A1B1E 50%, #1A1B1E 100%)',
          height: 'calc(100dvh - 42px)',
          position: 'sticky',
          top: 0,
          left: 0,
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid rgba(234, 189, 35, 1)',
          borderTop: '1px solid rgba(234, 189, 35, 1)',
          borderTopLeftRadius: 20,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: collapsed ? 0 : 20,
          overflow: 'hidden',
        }}
      >
        {/* Logo + Collapse toggle */}
        <div
          className="rg-sidebar-header"
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            padding: collapsed ? '0' : '0 12px 0 16px',
            transition: 'all 0.3s ease',
            flexShrink: 0,
          }}
        >
          <div
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            onClick={() => handleMenuClick('/dashboard')}
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
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0 0 4px', flexShrink: 0 }}>
            <Button
              type="text"
              icon={<DoubleRightOutlined />}
              onClick={() => setCollapsed(false)}
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
          </div>
        )}

        {/* Navigation */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={getSelectedKeys()}
            {...(collapsed ? {} : { openKeys, onOpenChange: setOpenKeys })}
            items={menuItems}
            onClick={({ key }) => {
              if (key.startsWith('/')) handleMenuClick(key);
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
          background: collapsed
            ? 'linear-gradient(90deg, #1A1B1E 50%, #1A1B1E 100%)'
            : 'linear-gradient(90deg, #1A1B1E 0%, #1A1B1E 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
           borderBottom: '1px solid rgba(234, 189, 35, 1)',
           borderTop: '1px solid rgba(234, 189, 35, 1)',
           borderRight: '1px solid rgba(234, 189, 35, 1)',
          borderTopRightRadius: 20,
            borderBottomRightRadius: 0,
          lineHeight: '54px',
          height: 54,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Mobile toggle (shows only when sidebar collapsed, as secondary control) */}

            <Text style={{
              color: 'rgba(255,255,255,0.4)',
              fontSize: 18,
              fontStyle: 'Normal',
            }}>
              <span style={{ color: '#EABD23', fontWeight: 700 }}>Río</span> <span style={{ fontWeight: 700, fontStyle: 'normal', color: '#FFFFFF' }}>gestión</span>
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
                  <Tag color="#EABD23" style={{ color: '#1E1F22', fontWeight: 600, margin: 0 }}>
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
                  color: '#1E1F22',
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
          margin: '10px 10px',
          padding: 24,
          background: '#FFFFFF',
          borderRadius: '12px 12px 12px 12px',
          minHeight: 280,
          boxShadow: '0 1px 8px rgba(0,0,0,0.1)',
        }}>
          {tabPanels}
        </Content>

        {/* ── Tab Bar (bottom) ─────────────────── */}
        <TabBar iconMap={ICON_MAP} />
      </Layout>
    </Layout>
  );
}
