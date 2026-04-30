import { useState, useEffect, useMemo, useRef, useCallback, type ComponentType } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Avatar, Dropdown, Select, Tag, Tooltip, message } from 'antd';
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
  FileDoneOutlined,
  FileAddOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';
import { useTabStore } from '../store/tabStore';
import { useSettingsStore } from '../store/settingsStore';
import { useQueryClient } from '@tanstack/react-query';
import { RGLogo } from './RGLogo';
import { TabBar } from './TabBar';
import { QuickProductLookupModal } from './products/QuickProductLookupModal';

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
import { CtaCorrienteProvPage } from '../pages/CtaCorrienteProvPage';
import { PurchasesPage } from '../pages/PurchasesPage';
import { SettingsPage } from '../pages/SettingsPage';
import { NCComprasPage } from '../pages/NCComprasPage';
import { NCVentasPage } from '../pages/NCVentasPage';
import { EtiquetasPage } from '../pages/EtiquetasPage';
import { MesasPage } from '../pages/MesasPage';
import { PaymentMethodsPage } from '../pages/PaymentMethodsPage';
import { RemitosPage } from '../pages/RemitosPage';
import { StockPage } from '../pages/StockPage';
import { ListadoComandasPage } from '../pages/ListadoComandasPage';
import { CobranzasPage } from '../pages/CobranzasPage';
import { OrdenesPagoPage } from '../pages/OrdenesPagoPage';
import { ExpensesPage } from '../pages/ExpensesPage';
import { LibroIvaVentasPage } from '../pages/LibroIvaVentasPage';
import { LibroIvaComprasPage } from '../pages/LibroIvaComprasPage';
import { UsuariosPage } from '../pages/UsuariosPage';
import { PuntosVentaPage } from '../pages/PuntosVentaPage';
import { BackupsPage } from '../pages/BackupsPage';

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
  '/expenses':       { label: 'Gastos y Servicios', icon: <CreditCardOutlined />, component: ExpensesPage,    closable: true },
  '/deposits':       { label: 'Depósitos',    icon: <InboxOutlined />,        component: DepositsPage,     closable: true },
  '/categories':     { label: 'Categorías',   icon: <TagsOutlined />,         component: CategoriesPage,   closable: true },
  '/brands':         { label: 'Marcas',        icon: <TagOutlined />,          component: BrandsPage,       closable: true },
  '/payment-methods': { label: 'Métodos de Pago', icon: <CreditCardOutlined />, component: PaymentMethodsPage, closable: true },
  '/cobranzas':      { label: 'Cobranzas',       icon: <DollarOutlined />,       component: CobranzasPage,    closable: true },
  '/ordenes-pago':   { label: 'Órdenes de Pago', icon: <WalletOutlined />,       component: OrdenesPagoPage,  closable: true },
  '/cta-corriente':  { label: 'Cta. Cte. Cli. ', icon: <WalletOutlined />,       component: CtaCorrientePage, closable: true },
  '/cta-corriente-prov': { label: 'Cta. Cte. Prov.', icon: <ShopOutlined />,     component: CtaCorrienteProvPage, closable: true },
  '/purchases':      { label: 'Compras',       icon: <ShoppingCartOutlined />, component: PurchasesPage,    closable: true },
  '/nc-compras':        { label: 'NC Compras',      icon: <FileAddOutlined />,         component: NCComprasPage,   closable: true },
  '/nc-ventas':         { label: 'NC Ventas',       icon: <FileAddOutlined />,         component: NCVentasPage,    closable: true },
  '/etiquetas':        { label: 'Etiquetas',       icon: <TagOutlined />,             component: EtiquetasPage,   closable: true },
  '/settings/general': { label: 'Configuración', icon: <SettingOutlined />,       component: SettingsPage,     closable: true },
  '/gastronomy/tables': { label: 'Gestión de Mesas', icon: <CoffeeOutlined />,    component: MesasPage,        closable: true },
  '/gastronomy/comandas': { label: 'Listado Comandas', icon: <UnorderedListOutlined />, component: ListadoComandasPage, closable: true },
  '/remitos':          { label: 'Remitos',         icon: <FileTextOutlined />,   component: RemitosPage,      closable: true },
  '/stock':            { label: 'Stock',           icon: <InboxOutlined />,      component: StockPage,        closable: true },
  '/libro-iva-ventas':   { label: 'Libro IVA Ventas',   icon: <AuditOutlined />,        component: LibroIvaVentasPage,  closable: true },
  '/libro-iva-compras':  { label: 'Libro IVA Compras',  icon: <ShoppingCartOutlined />, component: LibroIvaComprasPage, closable: true },
  '/users/users':      { label: 'Usuarios',         icon: <SafetyOutlined />,     component: UsuariosPage,      closable: true },
  '/settings/pos':     { label: 'Puntos de Venta',  icon: <EnvironmentOutlined />, component: PuntosVentaPage,   closable: true },
  '/settings/backups': { label: 'Backups',          icon: <DatabaseOutlined />,    component: BackupsPage,       closable: true },
};

/** Icon map for TabBar */
const ICON_MAP: Record<string, React.ReactNode> = Object.fromEntries(
  Object.entries(TAB_ROUTES).map(([key, r]) => [key, r.icon])
);

/* ── Permission map: route key → required permiso LLAVE ─ */
const ROUTE_PERMISSIONS: Record<string, string> = {
  // '/dashboard' is intentionally omitted — every authenticated user sees their role-appropriate view
  '/customers':           'clientes.ver',
  '/products':            'productos.ver',
  '/etiquetas':           'productos.ver',
  '/stock':               'stock.ver',
  '/sales':               'ventas.ver',
  '/purchases':           'compras.ver',
  '/nc-ventas':           'ventas.ver',
  '/nc-compras':          'compras.ver',
  '/suppliers':           'proveedores.ver',
  '/cashregisters':       'caja.ver',
  '/cashcentral':         'caja.central.ver',
  '/deposits':            'caja.depositos.ver',
  '/categories':          'catalogo.ver',
  '/brands':              'catalogo.ver',
  '/payment-methods':     'configuracion.ver',
  '/cobranzas':           'cobranzas.ver',
  '/ordenes-pago':        'ordenes_pago.ver',
  '/cta-corriente':       'cta_corriente.ver',
  '/cta-corriente-prov':  'cta_corriente_prov.ver',
  '/remitos':             'remitos.ver',
  '/gastronomy/tables':   'gastronomy.mesas.ver',
  '/gastronomy/comandas': 'gastronomy.mesas.ver',
  '/libro-iva-ventas':    'reportes.iva.ver',
  '/libro-iva-compras':   'reportes.iva.compras.ver',
  '/users/users':         'usuarios.ver',
  '/settings/general':    'configuracion.ver',
  '/settings/pos':        'configuracion.ver',
  '/settings/backups':    'backups.administrar',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filterMenuItems(items: any[], canAccess: (key: string) => boolean): any[] {
  return items
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((item: any) => {
      if (item?.children) {
        const filtered = filterMenuItems(item.children, canAccess);
        if (filtered.length === 0) return null;
        return { ...item, children: filtered };
      }
      if (typeof item?.key === 'string' && item.key.startsWith('/')) {
        if (!canAccess(item.key)) return null;
      }
      return item;
    })
    .filter(Boolean);
}

function AccessDenied() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12 }}>
      <LockOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />
      <Typography.Title level={4} style={{ color: '#999', margin: 0 }}>Sin acceso</Typography.Title>
      <Typography.Text type="secondary">No tenés permisos para acceder a esta sección.</Typography.Text>
    </div>
  );
}

/* ── Menu sections matching Río Gestión desktop ─ */
const menuItems = [
  {
    key: 'archivos',
    icon: <FolderOutlined />,
    label: 'Archivos',
    children: [
      { type: 'group' as const, label: 'Archivos', className: 'rg-popup-group-title', children: [
        { key: 'productos-sub', icon: <ShoppingOutlined />, label: 'Productos', children: [
          { key: '/products', icon: <ShoppingOutlined />, label: 'ABM Productos' },
          { key: '/stock', icon: <InboxOutlined />, label: 'Stock' },
          { key: '/etiquetas', icon: <TagOutlined />, label: 'Etiquetas de Precios' },
        ]},
        { key: '/customers', icon: <TeamOutlined />, label: 'Clientes' },
        { key: '/suppliers', icon: <ShopOutlined />, label: 'Proveedores' },
        { key: '/deposits', icon: <InboxOutlined />, label: 'Depósitos' },
        { key: '/categories', icon: <TagsOutlined />, label: 'Categorías' },
        { key: '/brands', icon: <TagOutlined />, label: 'Marcas' },
        { key: '/payment-methods', icon: <CreditCardOutlined />, label: 'Métodos de Pago' },
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
        { key: '/remitos', icon: <FileTextOutlined />, label: 'Remitos' },
        { key: '/cashregisters', icon: <BankOutlined />, label: 'Cajas' },
        { key: '/cashcentral', icon: <WalletOutlined />, label: 'Caja Central' },
        { key: 'ctas-corrientes', icon: <WalletOutlined />, label: 'Cuentas Corrientes', children: [
          { key: '/cobranzas', icon: <DollarOutlined />, label: 'Cobranzas' },
          { key: '/cta-corriente', icon: <TeamOutlined />, label: 'Cta Cte Clientes' },
          { key: '/ordenes-pago', icon: <WalletOutlined />, label: 'Órdenes de Pago' },
          { key: '/cta-corriente-prov', icon: <ShopOutlined />, label: 'Cta Cte Proveedores' },
        ]},
        { key: 'notas-credito', icon: <FileAddOutlined />, label: 'Notas de Crédito', children: [
          { key: '/nc-ventas', icon: <DollarOutlined />, label: 'Ventas' },
          { key: '/nc-compras', icon: <ShoppingCartOutlined />, label: 'Compras' },
        ]},
        { key: 'notas-debito', icon: <FileDoneOutlined />, label: 'Notas de Débito', children: [
          { key: '/nd-ventas', icon: <DollarOutlined />, label: 'Ventas' },
          { key: '/nd-compras', icon: <ShoppingCartOutlined />, label: 'Compras' },
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
        { key: '/gastronomy/comandas', icon: <UnorderedListOutlined />, label: 'Listado Comandas' },
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
        { key: '/libro-iva-ventas',  icon: <AuditOutlined />,        label: 'Libro IVA Ventas' },
        { key: '/libro-iva-compras', icon: <ShoppingCartOutlined />, label: 'Libro IVA Compras' },
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
        { key: '/settings/general', icon: <SettingOutlined />, label: 'Generales' },
        { key: '/settings/company', icon: <HomeOutlined />, label: 'Mi Empresa' },
        { key: '/settings/pos', icon: <EnvironmentOutlined />, label: 'Puntos de Venta' },
        { key: '/settings/backups', icon: <DatabaseOutlined />, label: 'Backups' },
      ]},
    ],
  },
];

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, puntosVenta, puntoVentaActivo, setPuntoVentaActivo, logout, permisos, isCajero } = useAuthStore();
  const cajero = isCajero();
  const { tabs, activeKey, openTab } = useTabStore();
  const { fetchSettings, loaded: settingsLoaded } = useSettingsStore();
  const queryClient = useQueryClient();

  // Dashboard tab is rebranded as "Inicio" for cajero users
  const dashboardLabel = cajero ? 'Inicio' : 'Dashboard';
  const dashboardIcon  = cajero ? <HomeOutlined /> : <DashboardOutlined />;

  const iconMap = useMemo<Record<string, React.ReactNode>>(
    () => ({ ...ICON_MAP, '/dashboard': dashboardIcon }),
    [dashboardIcon],
  );

  const getRouteLabel = useCallback(
    (key: string) => (key === '/dashboard' ? dashboardLabel : TAB_ROUTES[key]?.label ?? ''),
    [dashboardLabel],
  );

  // When cajero state changes, sync the existing /dashboard tab label
  useEffect(() => {
    const state = useTabStore.getState();
    const idx = state.tabs.findIndex(t => t.key === '/dashboard');
    const existing = state.tabs[idx];
    if (idx >= 0 && existing && existing.label !== dashboardLabel) {
      const next = [...state.tabs];
      next[idx] = { ...existing, label: dashboardLabel };
      useTabStore.setState({ tabs: next });
    }
  }, [dashboardLabel]);

  const canAccessRoute = useCallback(
    (key: string) => {
      const perm = ROUTE_PERMISSIONS[key];
      if (!perm) return true;
      return permisos.includes(perm);
    },
    [permisos],
  );

  const filteredMenuItems = useMemo(
    () => filterMenuItems(menuItems, canAccessRoute),
    [canAccessRoute],
  );

  // Load user settings on mount
  useEffect(() => {
    if (!settingsLoaded) fetchSettings();
  }, [settingsLoaded, fetchSettings]);

  // ── Global keyboard shortcuts ──────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs/textareas
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      const isContentEditable = (e.target as HTMLElement).isContentEditable;

      // Build the combo string to match against settings
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      const key = e.key;
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return;
      const keyMap: Record<string, string> = {
        ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
        Escape: 'Esc', Delete: 'Del',
      };
      const mapped = key.startsWith('F') && key.length <= 3
        ? key.toUpperCase()
        : keyMap[key] || key.toUpperCase();
      parts.push(mapped);
      const combo = parts.join('+');

      // '+' key → "Nuevo" en la página activa
      if (e.key === '+' && !isInput && !isContentEditable) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('rg:nuevo'));
        return;
      }

      // Check against configured shortcuts
      const settings = useSettingsStore.getState().settings;
      const shortcuts = settings.filter(s => s.TIPO === 'shortcut');
      
      for (const sc of shortcuts) {
        const val = sc.VALOR ?? sc.VALOR_DEFECTO;
        if (val && val.toUpperCase() === combo.toUpperCase()) {
          // For function keys, always intercept. For other combos, skip if in input
          const isFnKey = /^F\d+$/i.test(val);
          if (!isFnKey && isInput) continue;
          if (!isFnKey && isContentEditable) continue;
          
          e.preventDefault();
          e.stopPropagation();

          // Dispatch based on clave
          switch (sc.CLAVE) {
            case 'atajo_nueva_venta':
              if (canAccessRoute('/sales')) {
                openTab({ key: '/sales', label: 'Ventas', closable: true });
                navigate('/sales');
                // Delay so SalesPage has time to mount & register the listener
                setTimeout(() => window.dispatchEvent(new CustomEvent('rg:open-new-sale')), 150);
              }
              break;
            case 'atajo_nueva_compra':
              if (canAccessRoute('/purchases')) {
                openTab({ key: '/purchases', label: 'Compras', closable: true });
                navigate('/purchases');
                window.dispatchEvent(new CustomEvent('rg:open-new-purchase'));
              }
              break;
            case 'atajo_abrir_caja':
              if (canAccessRoute('/cashregisters')) {
                openTab({ key: '/cashregisters', label: 'Cajas', closable: true });
                navigate('/cashregisters');
              }
              break;
            case 'atajo_busqueda_rapida_producto':
              setQuickLookupOpen(true);
              break;
          }
          return;
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, openTab, canAccessRoute]);

  // Auto-refresh data when switching tabs (only the active tab's queries)
  const prevActiveKey = useRef(activeKey);
  useEffect(() => {
    if (activeKey !== prevActiveKey.current) {
      prevActiveKey.current = activeKey;
      const keyMap: Record<string, string[]> = {
        '/dashboard':     ['dashboard-stats', 'ventas-por-dia'],
        '/customers':     ['customers'],
        '/products':      ['products'],
        '/sales':         ['sales'],
        '/suppliers':     ['suppliers'],
        '/cashregisters': ['cajas', 'mi-caja', 'fondo-cambio', 'fondo-cambio-apertura'],
        '/cashcentral':   ['caja-central-mov', 'caja-central-totales', 'caja-central-historico', 'caja-central-fondo'],
        '/deposits':      ['deposits'],
        '/categories':    ['categories'],
        '/brands':        ['brands'],
        '/payment-methods': ['payment-methods'],
        '/cta-corriente': ['cta-corriente-list', 'cta-movimientos', 'cta-cobranzas'],
        '/cta-corriente-prov': ['cta-corriente-prov-list', 'cta-prov-movimientos', 'cta-prov-ordenes-pago'],
        '/gastronomy/tables': ['mesas-sectores', 'mesas-mesas'],
        '/stock':         ['stock', 'stock-depositos'],
      };
      const keys = keyMap[activeKey];
      if (keys) {
        keys.forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
      }
    }
  }, [activeKey, queryClient]);

  // Sync: if URL changes externally (e.g. browser back/forward), open/activate the tab
  useEffect(() => {
    const path = location.pathname;
    const route = TAB_ROUTES[path];
    if (route) {
      if (canAccessRoute(path)) {
        openTab({ key: path, label: getRouteLabel(path), closable: route.closable });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate from sidebar → open tab
  const handleMenuClick = (key: string) => {
    const route = TAB_ROUTES[key];
    if (route) {
      if (!canAccessRoute(key)) {
        void message.warning('No tenés permisos para acceder a esta sección');
        return;
      }
      openTab({ key, label: getRouteLabel(key), closable: route.closable });
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
            {canAccessRoute(tab.key) ? <Comp /> : <AccessDenied />}
          </div>
        );
      });
  }, [tabs, activeKey, canAccessRoute]);

  const handleLogout = () => {
    useSettingsStore.getState().clear();
    logout();
    navigate('/login');
  };

  const [quickLookupOpen, setQuickLookupOpen] = useState(false);

  // Global event for other sources (e.g. cajero dashboard button)
  useEffect(() => {
    const handler = () => setQuickLookupOpen(true);
    window.addEventListener('rg:open-quick-product-lookup', handler);
    return () => window.removeEventListener('rg:open-quick-product-lookup', handler);
  }, []);

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
      archivos: ['/customers', '/suppliers', '/deposits', '/categories', '/brands', '/payment-methods', '/products', '/etiquetas', '/promotions', '/stock'],
      movimientos: ['/sales', '/purchases', '/cashregisters', '/cashcentral', '/arca', '/expenses', '/audit'],
      produccion: ['/production/structures', '/production/orders'],
      gastronomia: ['/gastronomy/tables', '/gastronomy/comandas'],
      reportes: ['/reports/reports', '/reports/listings'],
      usuarios: ['/users/users', '/users/staff', '/users/permissions'],
      configuracion: ['/settings/general', '/settings/company', '/settings/pos'],
    };
    const subGroups: Record<string, string[]> = {
      'productos-sub': ['/products', '/etiquetas'],
      'ctas-corrientes': ['/cta-corriente', '/cta-corriente-prov', '/cobranzas', '/ordenes-pago'],
      'notas-credito': ['/nc-ventas', '/nc-compras'],
      'notas-debito': ['/nd-ventas', '/nd-compras'],
    };
    const keys: string[] = [];
    for (const [group, paths] of Object.entries(groups)) {
      if (paths.includes(activeKey)) { keys.push(group); break; }
    }
    for (const [sub, paths] of Object.entries(subGroups)) {
      if (paths.includes(activeKey)) { keys.push(sub); break; }
    }
    return keys;
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
          height: 'calc(100dvh - 44px)',
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
            transition: 'padding 0.15s ease-out, justify-content 0.15s ease-out',
            flexShrink: 0,
          }}
        >
          <div
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            onClick={() => handleMenuClick('/dashboard')}
          >
            <RGLogo size={collapsed ? 40 : 40} collapsed={collapsed} variant="white" />
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
            items={filteredMenuItems}
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
        <Header className="rg-header" style={{
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
              <span className="rg-header-web">Web</span>
            </Text>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            {/* Punto de Venta Activo */}
            {puntosVenta.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                  Pto. Venta:
                </Text>
                {puntosVenta.length === 1 || cajero ? (
                  <Tooltip title={cajero ? 'Tu punto de venta es asignado por el administrador' : undefined}>
                    <Tag color="#EABD23" style={{ color: '#1E1F22', fontWeight: 600, margin: 0 }}>
                      {pvNombre}
                    </Tag>
                  </Tooltip>
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
        <TabBar iconMap={iconMap} />
      </Layout>

      {/* ── Global: Quick product lookup modal ── */}
      <QuickProductLookupModal open={quickLookupOpen} onClose={() => setQuickLookupOpen(false)} />
    </Layout>
  );
}
