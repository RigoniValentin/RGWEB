import {
  AccountBookOutlined,
  AlertOutlined,
  ApiOutlined,
  AppstoreOutlined,
  BarChartOutlined,
  CalculatorOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  ContainerOutlined,
  CreditCardOutlined,
  DashboardOutlined,
  DollarOutlined,
  EditOutlined,
  ExportOutlined,
  EyeOutlined,
  FallOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  HistoryOutlined,
  HomeOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  InboxOutlined,
  LinkOutlined,
  PrinterOutlined,
  ProfileOutlined,
  RetweetOutlined,
  SearchOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  ShoppingOutlined,
  SwapOutlined,
  TableOutlined,
  TagsOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';

export type RGModalIconKey =
  | 'cliente'
  | 'proveedor'
  | 'producto'
  | 'producto-buscar'
  | 'stock-editar'
  | 'stock-historial'
  | 'precio-lista'
  | 'precio-masivo'
  | 'precio-editor'
  | 'precio-check'
  | 'precio'
  | 'remito'
  | 'remito-picker'
  | 'venta'
  | 'venta-detalle'
  | 'cobranza'
  | 'cta-corriente'
  | 'compra'
  | 'comprobante-config'
  | 'orden-pago'
  | 'op-general'
  | 'cheque'
  | 'gasto'
  | 'gasto-calculadora'
  | 'gasto-tag'
  | 'gasto-revertir'
  | 'caja'
  | 'caja-cierre'
  | 'caja-central'
  | 'caja-desglose'
  | 'caja-transferencia'
  | 'caja-sesion'
  | 'pago'
  | 'etiqueta'
  | 'marca'
  | 'categoria'
  | 'deposito'
  | 'metodo-pago'
  | 'punto-venta'
  | 'backup-upload'
  | 'backup-download'
  | 'backup-restaurar'
  | 'integracion'
  | 'integracion-link'
  | 'export'
  | 'usuario'
  | 'tienda'
  | 'tienda-pedido'
  | 'mesa'
  | 'mesa-tabla'
  | 'comanda'
  | 'dashboard'
  | 'alerta'
  | 'warning'
  | 'info'
  | 'arca';

const RG_MODAL_ICON_MAP: Record<RGModalIconKey, ReactNode> = {
  cliente: <UserOutlined />,
  proveedor: <TeamOutlined />,
  producto: <AppstoreOutlined />,
  'producto-buscar': <SearchOutlined />,
  'stock-editar': <EditOutlined />,
  'stock-historial': <HistoryOutlined />,
  'precio-lista': <ProfileOutlined />,
  'precio-masivo': <DollarOutlined />,
  'precio-editor': <DollarOutlined />,
  'precio-check': <EyeOutlined />,
  precio: <DollarOutlined />,
  remito: <InboxOutlined />,
  'remito-picker': <InboxOutlined />,
  venta: <ShoppingCartOutlined />,
  'venta-detalle': <EyeOutlined />,
  cobranza: <DollarOutlined />,
  'cta-corriente': <AccountBookOutlined />,
  compra: <ShoppingOutlined />,
  'comprobante-config': <SettingOutlined />,
  'orden-pago': <DollarOutlined />,
  'op-general': <DollarOutlined />,
  cheque: <FileProtectOutlined />,
  gasto: <FallOutlined />,
  'gasto-calculadora': <CalculatorOutlined />,
  'gasto-tag': <TagsOutlined />,
  'gasto-revertir': <RetweetOutlined />,
  caja: <ShopOutlined />,
  'caja-cierre': <FileTextOutlined />,
  'caja-central': <SwapOutlined />,
  'caja-desglose': <BarChartOutlined />,
  'caja-transferencia': <SwapOutlined />,
  'caja-sesion': <ContainerOutlined />,
  pago: <CreditCardOutlined />,
  etiqueta: <PrinterOutlined />,
  marca: <TagsOutlined />,
  categoria: <AppstoreOutlined />,
  deposito: <HomeOutlined />,
  'metodo-pago': <CreditCardOutlined />,
  'punto-venta': <ShopOutlined />,
  'backup-upload': <CloudUploadOutlined />,
  'backup-download': <CloudDownloadOutlined />,
  'backup-restaurar': <HistoryOutlined />,
  integracion: <ApiOutlined />,
  'integracion-link': <LinkOutlined />,
  export: <ExportOutlined />,
  usuario: <UserOutlined />,
  tienda: <ShopOutlined />,
  'tienda-pedido': <ShopOutlined />,
  mesa: <AppstoreOutlined />,
  'mesa-tabla': <TableOutlined />,
  comanda: <UnorderedListOutlined />,
  dashboard: <DashboardOutlined />,
  alerta: <AlertOutlined />,
  warning: <WarningOutlined />,
  info: <InfoCircleOutlined />,
  arca: <FileTextOutlined />,
};

export function rgIcon(key: RGModalIconKey): ReactNode {
  return RG_MODAL_ICON_MAP[key];
}

export const RG_MODAL_ICONS = RG_MODAL_ICON_MAP;

export { ImportOutlined };
