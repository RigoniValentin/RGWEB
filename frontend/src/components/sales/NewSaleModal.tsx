import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Modal, Input, Select, Button, InputNumber, Table, Space, Typography,
  Divider, Spin, Switch, Badge, Tag, Checkbox, Popover, Tabs, Tooltip,
} from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, ShoppingCartOutlined,
  UserOutlined, MinusOutlined, ShopOutlined,
  FileTextOutlined, SwapOutlined, DollarOutlined, CreditCardOutlined,
  WalletOutlined, ArrowLeftOutlined, CheckCircleOutlined,
  WarningOutlined, BankOutlined, PrinterOutlined, WhatsAppOutlined,
  SendOutlined, ExclamationCircleOutlined, QuestionCircleOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi } from '../../services/sales.api';
import { remitosApi } from '../../services/remitos.api';
import { cajaApi } from '../../services/caja.api';
import { catalogApi } from '../../services/catalog.api';
import { useAuthStore } from '../../store/authStore';
import { useTabStore } from '../../store/tabStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useSaleDraftsStore, type CartItem, type ModalStep } from '../../store/saleDraftsStore';
import { fmtMoney } from '../../utils/format';
import { printReceipt } from '../../utils/printReceipt';
import { generateFacturaPdf } from './facturaPdf';
import { printFacturaTicket } from './facturaTicket';
import { settingsApi } from '../../services/settings.api';
import { invalidateInventoryQueries } from '../../utils/invalidateInventoryQueries';
import { invalidateCashQueries } from '../../utils/invalidateCashQueries';
import { usePaymentMethodKeyboardNavigation } from '../../hooks/usePaymentMethodKeyboardNavigation';
import { useStockValidator } from '../../hooks/useStockValidator';
import { FilePdfOutlined } from '@ant-design/icons';

import type { ReceiptData } from '../../utils/printReceipt';
import type { ProductoSearch, VentaInput, ClienteVenta, RemitoPendiente } from '../../types';
import { ProductSearchModal } from '../ProductSearchModal';
import { StockInsuficienteModal } from './StockInsuficienteModal';
import { StockExcedidoCeldaModal } from './StockExcedidoCeldaModal';
import { notify, extractErrorMessage } from '../../utils/notify';
import { RGCajaModalHeader } from '../RGCajaModalHeader';
import { rgIcon } from '../rg-icons';

const { Title, Text } = Typography;

export type { CartItem } from '../../store/saleDraftsStore';

export interface PedidoParaVenta {
  PEDIDO_ID: number;
  MESA_ID: number;
  items: { PRODUCTO_ID: number; NOMBRE: string; CODIGO: string; CANTIDAD: number; PRECIO_UNITARIO: number; LISTA_PRECIO_SELECCIONADA?: number }[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  pedido?: PedidoParaVenta | null;
}

export function NewSaleModal({ open, onClose, onSuccess, pedido }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openTab = useTabStore(s => s.openTab);
  const { puntoVentaActivo, user } = useAuthStore();

  // ── Draft store (persistent state) ─────────────
  const drafts = useSaleDraftsStore(s => s.drafts);
  const activeDraftId = useSaleDraftsStore(s => s.activeDraftId);
  const activeDraft = useSaleDraftsStore(s => s.getActiveDraft());
  const createDraft = useSaleDraftsStore(s => s.createDraft);
  const createDraftFrom = useSaleDraftsStore(s => s.createDraftFrom);
  const removeDraft = useSaleDraftsStore(s => s.removeDraft);
  const setActiveDraft = useSaleDraftsStore(s => s.setActiveDraft);
  const updateDraft = useSaleDraftsStore(s => s.updateDraft);

  // Read draft-backed state (falls back to defaults if no active draft)
  const cart = activeDraft?.cart ?? [];
  const clienteId = activeDraft?.clienteId ?? 1;
  const depositoId = activeDraft?.depositoId ?? null;
  const tipoComprobante = activeDraft?.tipoComprobante ?? '';
  const esCtaCorriente = activeDraft?.esCtaCorriente ?? false;
  const dtoGral = activeDraft?.dtoGral ?? 0;
  const gramosMode = activeDraft?.gramosMode ?? {};
  const precioFinalMode = activeDraft?.precioFinalMode ?? {};
  const precioFinalValues = activeDraft?.precioFinalValues ?? {};
  const step = activeDraft?.step ?? 'cart' as ModalStep;
  const selectedMetodos = activeDraft?.selectedMetodos ?? [];
  const montosPorMetodo = activeDraft?.montosPorMetodo ?? {};
  const wantPrint = activeDraft?.wantPrint ?? false;
  const wantWhatsApp = activeDraft?.wantWhatsApp ?? false;
  const wantFacturar = activeDraft?.wantFacturar ?? false;
  const wantFEPdf = activeDraft?.wantFEPdf ?? false;
  const wantFETicket = activeDraft?.wantFETicket ?? false;
  const selectedRemitoIds = activeDraft?.selectedRemitoIds ?? [];
  const searchText = activeDraft?.searchText ?? '';
  const productSearchOpen = activeDraft?.productSearchOpen ?? false;

  const { data: marcas } = useQuery({
    queryKey: ['marcas'],
    queryFn: () => catalogApi.getMarcas(),
    staleTime: 300000,
  });
  const productSearchInitial = activeDraft?.productSearchInitial ?? '';

  // Helper: update a field on the active draft.
  // Reads activeDraftId from getState() at call-time to avoid stale closures.
  const ud = useCallback(<K extends keyof import('../../store/saleDraftsStore').SaleDraft>(
    field: K, value: import('../../store/saleDraftsStore').SaleDraft[K]
  ) => {
    const id = useSaleDraftsStore.getState().activeDraftId;
    if (id) useSaleDraftsStore.getState().updateDraft(id, { [field]: value });
  }, []);

  // Wrapper setters that write to the store (read activeDraftId dynamically)
  const setCart = useCallback((v: CartItem[] | ((prev: CartItem[]) => CartItem[])) => {
    const st = useSaleDraftsStore.getState();
    const id = st.activeDraftId;
    if (!id) return;
    const newVal = typeof v === 'function' ? v(st.getActiveDraft()?.cart ?? []) : v;
    st.updateDraft(id, { cart: newVal });
  }, []);
  const setClienteId = useCallback((v: number) => ud('clienteId', v), [ud]);
  const setDepositoId = useCallback((v: number | null) => {
    ud('depositoId', v);
    setCart(prev => prev.map(item =>
      item.DESDE_REMITO ? item : { ...item, DEPOSITO_ID: v || undefined }
    ));
  }, [ud, setCart]);
  const setTipoComprobante = useCallback((v: string) => ud('tipoComprobante', v), [ud]);
  const setEsCtaCorriente = useCallback((v: boolean) => ud('esCtaCorriente', v), [ud]);
  const setDtoGral = useCallback((v: number) => ud('dtoGral', v), [ud]);
  const setGramosMode = useCallback((v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    const st = useSaleDraftsStore.getState();
    const id = st.activeDraftId;
    if (!id) return;
    const newVal = typeof v === 'function' ? v(st.getActiveDraft()?.gramosMode ?? {}) : v;
    st.updateDraft(id, { gramosMode: newVal });
  }, []);
  const setPrecioFinalMode = useCallback((v: Record<string, boolean> | ((prev: Record<string, boolean>) => Record<string, boolean>)) => {
    const st = useSaleDraftsStore.getState();
    const id = st.activeDraftId;
    if (!id) return;
    const newVal = typeof v === 'function' ? v(st.getActiveDraft()?.precioFinalMode ?? {}) : v;
    st.updateDraft(id, { precioFinalMode: newVal });
  }, []);
  const setPrecioFinalValues = useCallback((v: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => {
    const st = useSaleDraftsStore.getState();
    const id = st.activeDraftId;
    if (!id) return;
    const newVal = typeof v === 'function' ? v(st.getActiveDraft()?.precioFinalValues ?? {}) : v;
    st.updateDraft(id, { precioFinalValues: newVal });
  }, []);
  const setStep = useCallback((v: ModalStep) => ud('step', v), [ud]);
  const setSelectedMetodos = useCallback((v: number[]) => ud('selectedMetodos', v), [ud]);
  const setMontosPorMetodo = useCallback((v: Record<number, number> | ((prev: Record<number, number>) => Record<number, number>)) => {
    const st = useSaleDraftsStore.getState();
    const id = st.activeDraftId;
    if (!id) return;
    const newVal = typeof v === 'function' ? v(st.getActiveDraft()?.montosPorMetodo ?? {}) : v;
    st.updateDraft(id, { montosPorMetodo: newVal });
  }, []);
  const setWantPrint = useCallback((v: boolean) => ud('wantPrint', v), [ud]);
  const setWantWhatsApp = useCallback((v: boolean) => ud('wantWhatsApp', v), [ud]);
  const setWantFacturar = useCallback((v: boolean) => ud('wantFacturar', v), [ud]);
  const setWantFEPdf = useCallback((v: boolean) => ud('wantFEPdf', v), [ud]);
  const setWantFETicket = useCallback((v: boolean) => ud('wantFETicket', v), [ud]);
  const setSelectedRemitoIds = useCallback((v: number[] | ((prev: number[]) => number[])) => {
    const st = useSaleDraftsStore.getState();
    const id = st.activeDraftId;
    if (!id) return;
    const newVal = typeof v === 'function' ? v(st.getActiveDraft()?.selectedRemitoIds ?? []) : v;
    st.updateDraft(id, { selectedRemitoIds: newVal });
  }, []);

  // ── Stock validator (issues persiste en el carrito) ─────
  const stockValidator = useStockValidator(cart, setCart);

  // ── Local-only state (ephemeral / UI) ──────────
  const searchRef = useRef<any>(null);

  // Per-draft search state writers (driven through the draft store so multiple
  // simultaneous sales each preserve their own search input / advanced search).
  const setSearchText = useCallback((v: string) => {
    const id = useSaleDraftsStore.getState().activeDraftId;
    if (id) useSaleDraftsStore.getState().updateDraft(id, { searchText: v });
  }, []);
  const setProductSearchOpen = useCallback((v: boolean) => {
    const id = useSaleDraftsStore.getState().activeDraftId;
    if (id) useSaleDraftsStore.getState().updateDraft(id, { productSearchOpen: v });
  }, []);
  const setProductSearchInitial = useCallback((v: string) => {
    const id = useSaleDraftsStore.getState().activeDraftId;
    if (id) useSaleDraftsStore.getState().updateDraft(id, { productSearchInitial: v });
  }, []);

  const efectivoRef = useRef<any>(null);
  const [metodoModalOpen, setMetodoModalOpen] = useState(false);
  const [metodoModalSelection, setMetodoModalSelection] = useState<number[]>([]);
  // Multi-method popover (for combined payment methods) and first-amount ref
  const [multiMetodoPopoverOpen, setMultiMetodoPopoverOpen] = useState(false);
  const primerMontoRef = useRef<any>(null);
  const montoRapidoRef = useRef<any>(null);


  // ── Refs for Enter-flow: price → qty → dto → search ──
  const priceRefs = useRef<Record<string, any>>({});
  const qtyRefs = useRef<Record<string, any>>({});
  const dtoRefs = useRef<Record<string, any>>({});
  // Track last added item key for auto-focus
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null);
  const [listaPopoverKey, setListaPopoverKey] = useState<string | null>(null);
  const [wspModalOpen, setWspModalOpen] = useState(false);
  const [wspTelefono, setWspTelefono] = useState('');
  const [wspNombre, setWspNombre] = useState('');
  const [wspSending, setWspSending] = useState(false);
  const [pendingVentaId, setPendingVentaId] = useState<number | null>(null);
  const [pendingWhatsappDraftId, setPendingWhatsappDraftId] = useState<string | null>(null);
  const [facturando, setFacturando] = useState(false);
  const submittingDraftIdsRef = useRef(new Set<string>());
  const completedDraftIdsRef = useRef(new Set<string>());
  const [, refreshSubmitLocks] = useState(0);
  const refocusSearchAfterProductModalClose = useRef(true);
  const productSearchKey = useRef(0);

  // ── Search request lifecycle ─────────────────────────────────────────────
  // Single in-flight controller. A new search aborts the previous one so the
  // input never freezes if the network/server is slow.
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const cancelInFlightSearch = useCallback(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    setSearchLoading(false);
  }, []);

  // ── Remitos pendientes state ──
  const [remitosPendientes, setRemitosPendientes] = useState<RemitoPendiente[]>([]);
  const [loadingRemitos, setLoadingRemitos] = useState(false);
  const [loadingRemitoItems, setLoadingRemitoItems] = useState(false);

  // Saldo CTA CTE confirmation
  const [saldoModalOpen, setSaldoModalOpen] = useState(false);
  const [saldoInfo, setSaldoInfo] = useState<{ saldo: number; creditoDisponible: number; cobertura: 'total' | 'parcial' } | null>(null);
  const [checkingSaldo, setCheckingSaldo] = useState(false);

  // ── Check if user has an open caja ─────────────
  const [cajaCheckState, setCajaCheckState] = useState<'checking' | 'open' | 'closed'>('checking');

  // ── Draft lifecycle: ensure at least one draft exists when modal opens ──
  useEffect(() => {
    if (open && drafts.length === 0 && !pedido) {
      createDraft();
    }
  }, [open, drafts.length, pedido, createDraft]);

  // ── Create draft from pedido (mesa → venta flow) ──
  useEffect(() => {
    if (open && pedido && pedido.items.length > 0) {
      // Check if we already have a draft for this pedido
      const existing = drafts.find(d => d.label === `Mesa #${pedido.MESA_ID}`);
      if (!existing) {
        const pedidoCart: CartItem[] = pedido.items.map(item => ({
          key: `pedido-${item.PRODUCTO_ID}-${Date.now()}-${Math.random()}`,
          PRODUCTO_ID: item.PRODUCTO_ID,
          NOMBRE: item.NOMBRE || `Producto #${item.PRODUCTO_ID}`,
          CODIGO: item.CODIGO || '',
          PRECIO_UNITARIO: item.PRECIO_UNITARIO,
          CANTIDAD: item.CANTIDAD,
          DESCUENTO: 0,
          PRECIO_COMPRA: 0,
          STOCK: 999,
          UNIDAD: 'u',
          UNIDAD_NOMBRE: '',
          LISTA_ID: item.LISTA_PRECIO_SELECCIONADA || 1,
        }));
        createDraftFrom({ cart: pedidoCart, label: `Mesa #${pedido.MESA_ID}` });
      } else {
        setActiveDraft(existing.id);
      }
    }
  }, [open, pedido]);

  useEffect(() => {
    if (!open) {
      setCajaCheckState('checking');
      return;
    }
    let cancelled = false;
    setCajaCheckState('checking');
    cajaApi.getMiCaja().then(result => {
      if (cancelled) return;
      const hasCaja = result && typeof result === 'object' && 'CAJA_ID' in result;
      setCajaCheckState(hasCaja ? 'open' : 'closed');
    }).catch(() => {
      if (!cancelled) setCajaCheckState('closed');
    });
    return () => { cancelled = true; };
  }, [open]);

  // Auto-focus search when modal opens (after animation completes)
  const handleAfterOpenChange = useCallback((visible: boolean) => {
    if (visible && cajaCheckState === 'open') {
      searchRef.current?.focus();
    }
  }, [cajaCheckState]);

  // Also focus when caja check resolves to 'open' while modal is already visible
  useEffect(() => {
    if (open && cajaCheckState === 'open') {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open, cajaCheckState]);

  // When switching between draft tabs: abort any in-flight search request
  // (results would be discarded anyway) and refocus the search field. The
  // search text and advanced-search state are now per-draft, so we no longer
  // clear them — each tab resumes exactly where the user left off.
  useEffect(() => {
    if (!activeDraftId) return;
    cancelInFlightSearch();
    if (open && cajaCheckState === 'open') {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDraftId]);

  // Abort any pending search when the modal closes / unmounts.
  useEffect(() => {
    if (!open) cancelInFlightSearch();
    return () => cancelInFlightSearch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleGoToCaja = () => {
    handleClose();
    openTab({ key: '/cashregisters', label: 'Cajas', closable: true });
    navigate('/cashregisters', { state: { autoAbrirCaja: true } });
  };

  // Fetch clients
  const { data: clientes = [] } = useQuery({
    queryKey: ['sales-clientes'],
    queryFn: () => salesApi.getClientes(),
    enabled: open,
    staleTime: 60000,
  });

  // Fetch depositos for the active punto de venta.
  // When puntoVentaActivo is set the backend resolves PV-specific deposits (with
  // ES_PREFERIDO), falling back to ALL deposits when PUNTOS_VENTA_DEPOSITOS is
  // empty for that PV (e.g. PVs created via the C# desktop app).
  // When there is no active PV (admin without assignment) we fall back to all deposits.
  const { data: depositosPV = [] } = useQuery({
    queryKey: ['sales-depositos-pv', puntoVentaActivo ?? 'all'],
    queryFn: () =>
      puntoVentaActivo
        ? salesApi.getDepositosPV(puntoVentaActivo)
        : salesApi.getDepositos().then(list =>
            list.map(d => ({ ...d, ES_PREFERIDO: false as boolean }))
          ),
    enabled: open,
    staleTime: 60000,
  });

  const defaultDepositoId = useMemo(() => {
    const preferido = depositosPV.find(d => d.ES_PREFERIDO);
    return preferido?.DEPOSITO_ID || depositosPV[0]?.DEPOSITO_ID || null;
  }, [depositosPV]);

  const depositoVentaId = depositoId ?? defaultDepositoId;

  // When the active PV changes (e.g. user switches PV) clear any previously
  // auto-selected deposit so the useEffect below re-evaluates the preference.
  const prevPVRef = useRef<number | null>(puntoVentaActivo);
  useEffect(() => {
    if (prevPVRef.current !== puntoVentaActivo) {
      prevPVRef.current = puntoVentaActivo;
      setDepositoId(null);
    }
  }, [puntoVentaActivo, setDepositoId]);

  // Fetch empresa IVA condition
  const { data: empresaIva } = useQuery({
    queryKey: ['sales-empresa-iva'],
    queryFn: () => salesApi.getEmpresaIva(),
    enabled: open,
    staleTime: 300000,
  });

  // Fetch empresa info (for receipts)
  const { data: empresaInfo } = useQuery({
    queryKey: ['sales-empresa-info'],
    queryFn: () => salesApi.getEmpresaInfo(),
    enabled: open,
    staleTime: 300000,
  });

  // Fetch FE config
  const { data: feConfig } = useQuery({
    queryKey: ['sales-fe-config'],
    queryFn: () => salesApi.getFEConfig(),
    enabled: open,
    staleTime: 300000,
  });

  // Fetch active payment methods
  const { data: metodosPago = [] } = useQuery({
    queryKey: ['sales-active-payment-methods'],
    queryFn: () => salesApi.getActivePaymentMethods(),
    enabled: open,
    staleTime: 60000,
  });

  const { data: listasPrecios = [] } = useQuery({
    queryKey: ['listas-precios'],
    queryFn: () => catalogApi.getListasPrecios(),
    enabled: open,
    staleTime: 60000,
  });

  const metodosPagoOrdenados = useMemo(() => {
    const copy = [...metodosPago];
    copy.sort((a, b) => {
      const aScore = a.CATEGORIA === 'EFECTIVO' && a.POR_DEFECTO ? 0 : a.CATEGORIA === 'EFECTIVO' ? 1 : 2;
      const bScore = b.CATEGORIA === 'EFECTIVO' && b.POR_DEFECTO ? 0 : b.CATEGORIA === 'EFECTIVO' ? 1 : 2;
      if (aScore !== bScore) return aScore - bScore;
      return a.NOMBRE.localeCompare(b.NOMBRE);
    });
    return copy;
  }, [metodosPago]);

  const defaultMetodoEfectivoId = useMemo(() => {
    const efectivoPorDefecto = metodosPago.find(m => m.CATEGORIA === 'EFECTIVO' && m.POR_DEFECTO);
    if (efectivoPorDefecto) return efectivoPorDefecto.METODO_PAGO_ID;
    const primerEfectivo = metodosPago.find(m => m.CATEGORIA === 'EFECTIVO');
    if (primerEfectivo) return primerEfectivo.METODO_PAGO_ID;
    return metodosPago[0]?.METODO_PAGO_ID;
  }, [metodosPago]);

  const utilizaFE = feConfig?.utilizaFE === true;

  // Derived payment values from selectedMetodos + montosPorMetodo
  const totalRecibido = useMemo(
    () => selectedMetodos.reduce((sum, id) => sum + (montosPorMetodo[id] || 0), 0),
    [selectedMetodos, montosPorMetodo]
  );

  const pagoEfectivo = useMemo(
    () => selectedMetodos.reduce((sum, id) => {
      const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
      return m?.CATEGORIA === 'EFECTIVO' ? sum + (montosPorMetodo[id] || 0) : sum;
    }, 0),
    [selectedMetodos, montosPorMetodo, metodosPago]
  );

  const pagoDigital = useMemo(
    () => selectedMetodos.reduce((sum, id) => {
      const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
      return m?.CATEGORIA === 'DIGITAL' ? sum + (montosPorMetodo[id] || 0) : sum;
    }, 0),
    [selectedMetodos, montosPorMetodo, metodosPago]
  );

  const soloEfectivo = selectedMetodos.length > 0 && selectedMetodos.every(id => {
    const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
    return m?.CATEGORIA === 'EFECTIVO';
  });

  const soloDigital = selectedMetodos.length > 0 && selectedMetodos.every(id => {
    const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
    return m?.CATEGORIA === 'DIGITAL';
  });

  // Set default deposito when data loads
  useEffect(() => {
    if (depositoId === null && defaultDepositoId !== null) {
      setDepositoId(defaultDepositoId);
    }
  }, [activeDraftId, defaultDepositoId, depositoId, setDepositoId]);

  // Auto-determine tipo comprobante based on empresa IVA + client IVA
  const selectedCliente = useMemo(
    () => clientes.find((c: ClienteVenta) => c.CLIENTE_ID === clienteId),
    [clientes, clienteId]
  );

  // Update draft label when client changes
  useEffect(() => {
    if (!activeDraftId || !activeDraft) return;
    const baseName = activeDraft.label.replace(/ — .+$/, '');
    if (selectedCliente && clienteId !== 1) {
      updateDraft(activeDraftId, { label: `${baseName} — ${selectedCliente.NOMBRE}` });
    } else if (activeDraft.label.includes(' — ')) {
      updateDraft(activeDraftId, { label: baseName });
    }
  }, [clienteId, selectedCliente?.NOMBRE]);

  const esMonotributo = (empresaIva?.CONDICION_IVA || '').toUpperCase() === 'MONOTRIBUTO';

  const esRI = (empresaIva?.CONDICION_IVA || '').toUpperCase() === 'RESPONSABLE INSCRIPTO';
  const clienteEsRI = (selectedCliente?.CONDICION_IVA || '').toUpperCase() === 'RESPONSABLE INSCRIPTO';

  const comprobanteOptions = useMemo(() => {
    if (esMonotributo) {
      return [{ value: 'Fa.C', label: 'Factura C' }];
    }
    if (esRI) {
      return clienteEsRI
        ? [{ value: 'Fa.A', label: 'Factura A' }]
        : [{ value: 'Fa.B', label: 'Factura B' }];
    }
    return [
      { value: 'Fa.A', label: 'Factura A' },
      { value: 'Fa.B', label: 'Factura B' },
      { value: 'Fa.C', label: 'Factura C' },
    ];
  }, [esMonotributo, esRI, clienteEsRI]);

  // Derive the correct comprobante type
  const comprobanteAutoValue = useMemo(() => {
    if (!empresaIva?.CONDICION_IVA) return 'Fa.B'; // default until loaded
    const empresaCond = empresaIva.CONDICION_IVA.toUpperCase();

    if (empresaCond === 'MONOTRIBUTO') return 'Fa.C';

    if (empresaCond === 'RESPONSABLE INSCRIPTO') {
      const clienteCond = (selectedCliente?.CONDICION_IVA || '').toUpperCase();
      return clienteCond === 'RESPONSABLE INSCRIPTO' ? 'Fa.A' : 'Fa.B';
    }

    // EXENTO, CONSUMIDOR FINAL, or any other condition
    return 'Fa.C';
  }, [empresaIva, selectedCliente]);

  useEffect(() => {
    if (comprobanteAutoValue) {
      setTipoComprobante(comprobanteAutoValue);
    }
  }, [comprobanteAutoValue]);

  // Auto-disable cta corriente if selected customer doesn't have CTA_CORRIENTE
  const clienteTieneCtaCte = selectedCliente?.CTA_CORRIENTE === true;
  useEffect(() => {
    if (!clienteTieneCtaCte) {
      setEsCtaCorriente(false);
    }
  }, [clienteTieneCtaCte]);

  // Fetch pending remitos when client changes (only for non-Consumidor Final)
  useEffect(() => {
    if (!open || !clienteId || clienteId === 1) {
      setRemitosPendientes([]);
      setSelectedRemitoIds([]);
      return;
    }
    let cancelled = false;
    setLoadingRemitos(true);
    remitosApi.getPendientesCliente(clienteId).then(data => {
      if (!cancelled) {
        setRemitosPendientes(data);
        setSelectedRemitoIds([]);
      }
    }).catch(() => {
      if (!cancelled) setRemitosPendientes([]);
    }).finally(() => {
      if (!cancelled) setLoadingRemitos(false);
    });
    return () => { cancelled = true; };
  }, [open, clienteId]);

  // When switching to CTA CTE, turn off facturación
  useEffect(() => {
    if (esCtaCorriente) {
      setWantFacturar(false);
    }
  }, [esCtaCorriente]);

  const paymentMethodKeyboard = usePaymentMethodKeyboardNavigation({
    enabled: metodoModalOpen,
    items: metodosPagoOrdenados,
    selectedIds: metodoModalSelection,
    getId: metodo => metodo.METODO_PAGO_ID,
    onToggle: id => {
      setMetodoModalSelection(prev =>
        prev.includes(id)
          ? prev.filter(metodoId => metodoId !== id)
          : [...prev, id]
      );
    },
    onConfirm: () => {
      if (metodoModalSelection.length === 0) return;
      setSelectedMetodos(metodoModalSelection);
      setMontosPorMetodo(prev => {
        const next: Record<number, number> = {};
        for (const id of metodoModalSelection) {
          next[id] = prev[id] || 0;
        }
        return next;
      });
      setMetodoModalOpen(false);
      setStep('cobro');
      // Focus strategy:
      // - single method → focus the quick amount input in the footer
      // - multiple methods → open the combined-methods popover and focus the first amount input
      if (metodoModalSelection.length === 1) {
        setTimeout(() => montoRapidoRef.current?.focus(), 50);
      } else {
        setMultiMetodoPopoverOpen(true);
        setTimeout(() => primerMontoRef.current?.focus(), 150);
      }
    },
  });

  // Create sale mutation
  const createMutation = useMutation({
    mutationFn: ({ input }: { input: VentaInput; draftId: string }) => salesApi.create(input),
    onSuccess: async (result, variables) => {
      completedDraftIdsRef.current.add(variables.draftId);
      refreshSubmitLocks(v => v + 1);
      invalidateInventoryQueries(queryClient);
      // La venta genera movimientos en la sesión de caja activa. Invalidar
      // todas las queries de caja para que el cajero vea los datos frescos
      // al hacer click en "Ver mi caja" sin tener que refrescar el navegador.
      invalidateCashQueries(queryClient);

      // Show appropriate message based on anticipo usage
      if (result.MONTO_ANTICIPO && result.MONTO_ANTICIPO > 0) {
        if (result.COBRADA) {
          notify.success(
            `Venta #${result.VENTA_ID} creada — Total: ${fmtMoney(result.TOTAL)}. Cobrada con saldo de cta corriente.`,
            5
          );
        } else {
          notify.success(
            `Venta #${result.VENTA_ID} creada — Total: ${fmtMoney(result.TOTAL)}. Anticipo aplicado: ${fmtMoney(result.MONTO_ANTICIPO)}. Pendiente: ${fmtMoney(result.TOTAL - result.MONTO_ANTICIPO)}`,
            5
          );
        }
      } else {
        notify.success(`Venta #${result.VENTA_ID} creada — Total: ${fmtMoney(result.TOTAL)}`);
      }

      // Track whether FE succeeded
      let feSuccess = false;

      // ── Post-sale: Facturación Electrónica ──
      if (wantFacturar && utilizaFE) {
        setFacturando(true);
        try {
          const feResult = await salesApi.facturar(result.VENTA_ID);
          if (feResult.success) {
            feSuccess = true;
            notify.success(
              `Factura emitida: ${feResult.tipo_comprobante} Nº ${feResult.comprobante_nro} — CAE: ${feResult.cae}`,
              6
            );
            // ── Post-factura: PDF / Ticket ──
            try {
              if (wantFEPdf) {
                const [facturaData, logoDataUrl] = await Promise.all([
                  salesApi.getFacturaData(result.VENTA_ID),
                  settingsApi.getLogoDataUrl(),
                ]);
                await generateFacturaPdf(facturaData, 'original', logoDataUrl);
              }
              if (wantFETicket) {
                const facturaData = await salesApi.getFacturaData(result.VENTA_ID);
                printFacturaTicket(facturaData);
              }
            } catch (printErr: any) {
              notify.warning('Factura emitida, pero no se pudo generar el PDF/ticket: ' + (printErr.message || ''));
            }
          } else {
            notify.error(
              `Error al facturar: ${(feResult.errores || []).join(', ') || 'Error desconocido'}`,
              8
            );
          }
        } catch (err: any) {
          notify.error(`Error al emitir factura: ${err.response?.data?.error || err.message}`, 8);
        } finally {
          setFacturando(false);
        }
      }

      // ── Post-sale: Print local receipt (only when FE is NOT used or FE failed) ──
      if (wantPrint && !feSuccess) {
        const receiptData: ReceiptData = {
          ventaId: result.VENTA_ID,
          nombreFantasia: empresaInfo?.NOMBRE_FANTASIA || 'Empresa',
          clienteNombre: selectedCliente?.NOMBRE || 'Consumidor Final',
          usuarioNombre: user?.NOMBRE || '',
          fecha: new Date(),
          items: cart.map(item => ({
            nombre: item.NOMBRE,
            cantidad: item.CANTIDAD,
            unidad: item.UNIDAD,
            precioUnitario: item.PRECIO_UNITARIO,
            descuento: item.DESCUENTO,
            subtotal: precioFinalMode[item.key]
              ? (precioFinalValues[item.key] ?? 0)
              : Math.round(((item.DESCUENTO > 0
                ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
                : item.PRECIO_UNITARIO) * item.CANTIDAD) * 100) / 100,
          })),
          dtoGral,
          subtotal,
          total,
          esCtaCorriente,
          montoEfectivo: pagoEfectivo,
          montoDigital: pagoDigital,
          vuelto: vuelto,
          metodoPago: step === 'cobro'
            ? (soloEfectivo ? 'efectivo' : soloDigital ? 'digital' : 'mixto')
            : undefined,
        };
        printReceipt(receiptData);
      }

      // ── Post-sale: WhatsApp ──
      if (wantWhatsApp) {
        setPendingVentaId(result.VENTA_ID);
        setPendingWhatsappDraftId(variables.draftId);
        // Pre-fill name only for real clients; leave empty for Consumidor Final so the user can type it
        setWspNombre(clienteId !== 1 ? (selectedCliente?.NOMBRE || '') : '');
        setWspTelefono('');
        setWspModalOpen(true);
        // Don't resetForm yet — wait for WhatsApp modal to close
        onSuccess();
        return;
      }

      // Check if the user wants to reopen the new sale form
      const reabrir = useSettingsStore.getState().getBool('reabrir_nueva_venta');
      const remainingDrafts = useSaleDraftsStore.getState().drafts.filter(d => d.id !== variables.draftId);
      resetForm(variables.draftId);
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      invalidateCashQueries(queryClient);
      if (reabrir || remainingDrafts.length > 0) {
        // Keep modal open: either setting says reopen, or there are other drafts
        if (reabrir && remainingDrafts.length === 0) {
          // Create a fresh draft for the next sale
          createDraft();
        }
        setTimeout(() => searchRef.current?.focus(), 0);
      } else {
        onSuccess();
      }
    },
    onError: (err: any) => {
      const code = err?.response?.data?.code || err?.code;
      if (code === 'STOCK_INSUFICIENTE') {
        // El stock cambió mientras el carrito estaba abierto. Refrescamos
        // el carrito al stock disponible y devolvemos al usuario al paso
        // del carrito para que vea el banner con el detalle.
        const detalles = err?.response?.data?.detalles;
        if (detalles) {
          setCart(prev => prev.map(item => {
            if (item.PRODUCTO_ID !== detalles.PRODUCTO_ID) return item;
            const nuevoStock = Number(detalles.STOCK_ACTUAL) || 0;
            const clamped = item.PERMITE_STOCK_NEGATIVO || item.ES_SERVICIO || item.ES_CONJUNTO
              ? item.CANTIDAD
              : Math.min(item.CANTIDAD, nuevoStock);
            return { ...item, STOCK: nuevoStock, CANTIDAD: clamped };
          }));
        } else {
          // Si no tenemos detalles, clampamos todo el carrito.
          stockValidator.autoFixAll();
        }
        setStep('cart');
        notify.error(extractErrorMessage(err, 'Stock insuficiente. Se ajustaron las cantidades al stock disponible.'));
        return;
      }
      notify.error(extractErrorMessage(err, 'Error al crear la venta'));
    },
    onSettled: (_data, _error, variables) => {
      if (variables?.draftId && !completedDraftIdsRef.current.has(variables.draftId)) {
        submittingDraftIdsRef.current.delete(variables.draftId);
        refreshSubmitLocks(v => v + 1);
      }
    },
  });

  const getActiveSubmitContext = useCallback(() => {
    const store = useSaleDraftsStore.getState();
    const draft = store.getActiveDraft();
    if (!draft) return null;
    let clientRequestId = draft.clientRequestId;
    if (!clientRequestId) {
      clientRequestId = crypto.randomUUID();
      store.updateDraft(draft.id, { clientRequestId });
    }
    return { draftId: draft.id, clientRequestId };
  }, []);

  const isActiveDraftSubmitLocked = useCallback(() => {
    const draftId = useSaleDraftsStore.getState().activeDraftId;
    return !!draftId && (
      submittingDraftIdsRef.current.has(draftId) ||
      completedDraftIdsRef.current.has(draftId)
    );
  }, []);

  const activeDraftSubmitLocked = !!activeDraftId && (
    submittingDraftIdsRef.current.has(activeDraftId) ||
    completedDraftIdsRef.current.has(activeDraftId)
  );
  const saleSubmitBusy = createMutation.isPending || facturando || activeDraftSubmitLocked;

  const submitSale = useCallback((input: VentaInput) => {
    const context = getActiveSubmitContext();
    if (!context) return;
    if (createMutation.isPending || facturando || isActiveDraftSubmitLocked()) {
      notify.info('La venta ya se está procesando');
      return;
    }
    submittingDraftIdsRef.current.add(context.draftId);
    refreshSubmitLocks(v => v + 1);
    createMutation.mutate({
      draftId: context.draftId,
      input: {
        ...input,
        CLIENT_REQUEST_ID: context.clientRequestId,
      },
    });
  }, [createMutation, facturando, getActiveSubmitContext, isActiveDraftSubmitLocked]);

  // ── Send WhatsApp ──
  const handleSendWhatsApp = async () => {
    if (!pendingVentaId || !wspTelefono.trim()) {
      notify.warning('Ingrese un número de teléfono');
      return;
    }
    // Validate: at least 10 digits
    const digits = wspTelefono.replace(/\D/g, '');
    if (digits.length < 10) {
      notify.warning('El teléfono debe tener al menos 10 dígitos');
      return;
    }
    setWspSending(true);
    try {
      await salesApi.sendWhatsApp(pendingVentaId, wspTelefono, wspNombre || 'Cliente');
      notify.success('Detalle enviado por WhatsApp');
      setWspModalOpen(false);
      setPendingVentaId(null);
      const draftIdToReset = pendingWhatsappDraftId;
      setPendingWhatsappDraftId(null);
      resetForm(draftIdToReset || undefined);
    } catch (err: any) {
      notify.error(err.response?.data?.error || 'Error al enviar WhatsApp');
    } finally {
      setWspSending(false);
    }
  };

  const handleCloseWspModal = () => {
    setWspModalOpen(false);
    setPendingVentaId(null);
    const draftIdToReset = pendingWhatsappDraftId;
    setPendingWhatsappDraftId(null);
    resetForm(draftIdToReset || undefined);
  };

  // Remove the current draft from the store (after a sale is completed)
  const resetForm = useCallback((draftId = activeDraftId) => {
    if (draftId) {
      submittingDraftIdsRef.current.delete(draftId);
      completedDraftIdsRef.current.delete(draftId);
      removeDraft(draftId);
      refreshSubmitLocks(v => v + 1);
    }
    // Note: search-related state is per-draft, so removing the draft above
    // already cleans it up. Don't write to the next active draft.
    cancelInFlightSearch();
    setMetodoModalOpen(false);
    setMetodoModalSelection([]);
    setMultiMetodoPopoverOpen(false);
    setLastAddedKey(null);
    setFacturando(false);
    setRemitosPendientes([]);
  }, [activeDraftId, removeDraft, cancelInFlightSearch]);

  // Close modal — purge empty drafts and reset counter if none remain
  const handleClose = () => {
    useSaleDraftsStore.getState().purgeEmptyDrafts();
    onClose();
  };

  // Discard a specific draft tab (with confirmation if it has items)
  const handleDiscardDraft = useCallback((draftId: string) => {
    const draft = drafts.find(d => d.id === draftId);
    if (draft && draft.cart.length > 0) {
      Modal.confirm({
        title: '¿Descartar borrador?',
        icon: <ExclamationCircleOutlined />,
        content: `El borrador "${draft.label}" tiene ${draft.cart.length} producto(s). ¿Desea descartarlo?`,
        okText: 'Descartar',
        okType: 'danger',
        cancelText: 'Cancelar',
        onOk: () => {
          const newActive = removeDraft(draftId);
          if (!newActive) {
            // All drafts removed — close the modal
            onClose();
          }
        },
      });
    } else {
      const newActive = removeDraft(draftId);
      if (!newActive) {
        onClose();
      }
    }
  }, [drafts, removeDraft, onClose]);

  // Search loading state lives above (driven by the AbortController lifecycle)

  // Add product to cart
  const addProduct = useCallback((
    product: ProductoSearch,
    options?: { focusPrice?: boolean; focusSearch?: boolean }
  ) => {
    if (!depositoVentaId && product.DESCUENTA_STOCK !== false) {
      notify.warning('Seleccione un depósito para descontar stock');
      return;
    }

    const focusPrice = options?.focusPrice !== false;
    const focusSearch = options?.focusSearch === true;

    setCart(prev => {
      const existing = prev.find(i => i.PRODUCTO_ID === product.PRODUCTO_ID);
      if (existing) {
        return prev.map(i =>
          i.PRODUCTO_ID === product.PRODUCTO_ID
            ? { ...i, CANTIDAD: i.CANTIDAD + 1, DEPOSITO_ID: i.DEPOSITO_ID || depositoVentaId || undefined }
            : i
        );
      }
      const isLt = (product.UNIDAD_NOMBRE || '').toUpperCase().includes('LITRO');
      const newKey = `${product.PRODUCTO_ID}-${Date.now()}`;
      setLastAddedKey(focusPrice ? newKey : null);
      return [...prev, {
        key: newKey,
        PRODUCTO_ID: product.PRODUCTO_ID,
        NOMBRE: product.NOMBRE,
        CODIGO: product.CODIGOPARTICULAR,
        PRECIO_UNITARIO: product.PRECIO_VENTA,
        CANTIDAD: isLt ? 0 : 1,
        DESCUENTO: 0,
        PRECIO_COMPRA: product.PRECIO_COMPRA || 0,
        STOCK: product.STOCK,
        UNIDAD: product.UNIDAD_ABREVIACION || 'u',
        UNIDAD_NOMBRE: product.UNIDAD_NOMBRE || '',
        DEPOSITO_ID: depositoVentaId || undefined,
        LISTA_ID: product.LISTA_DEFECTO || 1,
        PRECIOS: product.PRECIOS,
        PERMITE_STOCK_NEGATIVO: !!product.PERMITE_STOCK_NEGATIVO,
        ES_SERVICIO: !!product.ES_SERVICIO,
        ES_CONJUNTO: !!product.ES_CONJUNTO,
      }];
    });
    setSearchText('');
    if (focusSearch) {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [depositoVentaId]);

  // Add product from barcode balanza with pre-set quantity (weight)
  // Does NOT set lastAddedKey so the search input stays focused for the next scan
  const addBalanzaProduct = useCallback((product: ProductoSearch, cantidad: number) => {
    if (!depositoVentaId && product.DESCUENTA_STOCK !== false) {
      notify.warning('Seleccione un depósito para descontar stock');
      return;
    }

    setCart(prev => {
      const newKey = `${product.PRODUCTO_ID}-${Date.now()}`;
      return [...prev, {
        key: newKey,
        PRODUCTO_ID: product.PRODUCTO_ID,
        NOMBRE: product.NOMBRE,
        CODIGO: product.CODIGOPARTICULAR,
        PRECIO_UNITARIO: product.PRECIO_VENTA,
        CANTIDAD: cantidad,
        DESCUENTO: 0,
        PRECIO_COMPRA: product.PRECIO_COMPRA || 0,
        STOCK: product.STOCK,
        UNIDAD: product.UNIDAD_ABREVIACION || 'kg',
        UNIDAD_NOMBRE: product.UNIDAD_NOMBRE || '',
        DEPOSITO_ID: depositoVentaId || undefined,
        LISTA_ID: product.LISTA_DEFECTO || 1,
        PRECIOS: product.PRECIOS,
        PERMITE_STOCK_NEGATIVO: !!product.PERMITE_STOCK_NEGATIVO,
        ES_SERVICIO: !!product.ES_SERVICIO,
        ES_CONJUNTO: !!product.ES_CONJUNTO,
      }];
    });
    setSearchText('');
    setTimeout(() => searchRef.current?.focus(), 0);
  }, [depositoVentaId]);

  // Detect barcode balanza code: 13 digits starting with "2"
  const isBalanzaBarcode = (code: string): boolean => {
    return /^2\d{12}$/.test(code);
  };

  // Load items from selected remitos into the cart
  const handleCargarRemitos = useCallback(async (remitoIds: number[]) => {
    if (remitoIds.length === 0) return;
    setLoadingRemitoItems(true);
    try {
      const allItems: CartItem[] = [];
      for (const rId of remitoIds) {
        const items = await remitosApi.getItemsParaVenta(rId);
        for (const item of items) {
          allItems.push({
            key: `remito-${rId}-${item.PRODUCTO_ID}-${Date.now()}-${Math.random()}`,
            PRODUCTO_ID: item.PRODUCTO_ID,
            NOMBRE: item.PRODUCTO_NOMBRE,
            CODIGO: item.PRODUCTO_CODIGO,
            PRECIO_UNITARIO: item.PRECIO_VENTA || item.PRECIO_UNITARIO,
            CANTIDAD: item.CANTIDAD,
            DESCUENTO: 0,
            PRECIO_COMPRA: item.PRECIO_COMPRA || 0,
            STOCK: item.STOCK,
            UNIDAD: item.UNIDAD_ABREVIACION || 'u',
            UNIDAD_NOMBRE: item.UNIDAD_NOMBRE || '',
            DEPOSITO_ID: item.DEPOSITO_ID || depositoVentaId || undefined,
            LISTA_ID: 1,
            DESDE_REMITO: true,
          });
        }
      }
      setCart(allItems);
      setSelectedRemitoIds(remitoIds);
      notify.success(`Se cargaron ${allItems.length} producto(s) desde ${remitoIds.length} remito(s)`);
    } catch (err: any) {
      notify.error('Error al cargar productos del remito');
    } finally {
      setLoadingRemitoItems(false);
    }
  }, [depositoVentaId]);

  // Auto-focus price field when a new product is added
  useEffect(() => {
    if (!lastAddedKey) return;
    const timer = setTimeout(() => {
      const priceEl = priceRefs.current[lastAddedKey];
      if (priceEl) {
        priceEl.focus();
        // select the value for quick overwrite
        const input = priceEl?.input || priceEl?.nativeElement?.querySelector?.('input');
        if (input) input.select();
      }
      setLastAddedKey(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [lastAddedKey]);

  // Auto-focus the first amount input when the multi-method popover opens
  // (only if user opens it manually after methods are already selected)
  useEffect(() => {
    if (!multiMetodoPopoverOpen) return;
    if (selectedMetodos.length < 2) return;
    const timer = setTimeout(() => {
      primerMontoRef.current?.focus();
    }, 120);
    return () => clearTimeout(timer);
  }, [multiMetodoPopoverOpen, selectedMetodos.length]);

  // On Enter: barcode balanza → auto-add; single match → auto-add; otherwise → open advanced search modal
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const text = searchText.trim();
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();

    // Capture the draft id at request-issue time. If the active draft changes
    // before the response arrives, we drop the result instead of applying it
    // to the wrong cart.
    const issuingDraftId = useSaleDraftsStore.getState().activeDraftId;
    if (!issuingDraftId) return;

    // Abort any previous in-flight request and start fresh. This keeps the
    // input responsive even if the previous request hangs (slow backend,
    // dropped connection, etc.).
    cancelInFlightSearch();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    setSearchLoading(true);

    // Safety net: if the request takes longer than 15s, abort it and unlock
    // the input so the user can keep working.
    searchTimeoutRef.current = setTimeout(() => {
      if (searchAbortRef.current === controller) {
        controller.abort();
        notify.warning('La búsqueda demoró demasiado. Intente nuevamente.');
      }
    }, 15000);

    const isStillActive = () =>
      searchAbortRef.current === controller &&
      useSaleDraftsStore.getState().activeDraftId === issuingDraftId;

    const finishLifecycle = () => {
      if (searchAbortRef.current === controller) {
        searchAbortRef.current = null;
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
          searchTimeoutRef.current = null;
        }
        setSearchLoading(false);
      }
    };

    // ── Barcode balanza detection ──
    if (isBalanzaBarcode(text)) {
      salesApi.getBalanzaProduct(text, undefined, controller.signal).then(data => {
        if (!isStillActive()) return;
        if (data && data.product) {
          addBalanzaProduct(data.product, data.cantidad);
          notify.success(`${data.product.NOMBRE} — ${data.cantidad.toFixed(3)} kg`);
        } else {
          notify.warning('Producto de balanza no encontrado');
        }
      }).catch((err: any) => {
        if (controller.signal.aborted) return;
        if (!isStillActive()) return;
        const code = err?.code || err?.name;
        if (code === 'ERR_CANCELED' || code === 'CanceledError' || code === 'AbortError') return;
        notify.error('Error al buscar producto de balanza');
      }).finally(finishLifecycle);
      return;
    }

    const isNormalBarcode = /^\d{6,}$/.test(text);

    // Quick search — if exactly 1 match or exact code, add directly; otherwise open modal
    salesApi.searchProducts(text, undefined, controller.signal)
      .then(products => {
        if (!isStillActive()) return;
        if (products.length === 1) {
          addProduct(products[0]!, {
            focusPrice: !isNormalBarcode,
            focusSearch: isNormalBarcode,
          });
        } else if (products.length > 1) {
          const exact = products.find(
            p => p.CODIGOPARTICULAR?.toUpperCase() === text.toUpperCase()
          );
          if (exact) {
            addProduct(exact, {
              focusPrice: !isNormalBarcode,
              focusSearch: isNormalBarcode,
            });
          } else {
            setProductSearchInitial(text);
            productSearchKey.current += 1;
            setProductSearchOpen(true);
            setSearchText('');
          }
        } else {
          setProductSearchInitial(text);
          productSearchKey.current += 1;
          setProductSearchOpen(true);
          setSearchText('');
        }
      })
      .catch((err: any) => {
        if (controller.signal.aborted) return;
        if (!isStillActive()) return;
        const code = err?.code || err?.name;
        if (code === 'ERR_CANCELED' || code === 'CanceledError' || code === 'AbortError') return;
        notify.error('No se pudo buscar el producto. Verifique la conexión.');
      })
      .finally(finishLifecycle);
  }, [searchText, addProduct, addBalanzaProduct, cancelInFlightSearch, setProductSearchInitial, setProductSearchOpen, setSearchText]);

  const updateCartItem = (key: string, field: string, value: any) => {
    setCart(prev => prev.map(item =>
      item.key === key ? { ...item, [field]: value } : item
    ));
  };

  const removeCartItem = (key: string) => {
    setCart(prev => prev.filter(item => item.key !== key));
  };

  const getListPrice = (item: CartItem, listaId: number): number => {
    const found = item.PRECIOS?.find(p => p.LISTA_ID === listaId);
    return found?.PRECIO ?? item.PRECIO_UNITARIO;
  };

  const handleListaChange = (key: string, newListaId: number) => {
    setCart(prev => prev.map(item => {
      if (item.key !== key) return item;
      const newPrice = getListPrice(item, newListaId);
      return { ...item, LISTA_ID: newListaId, PRECIO_UNITARIO: newPrice };
    }));
  };

  // Calculate totals (round to 2 decimals to avoid floating-point artifacts)
  const subtotal = Math.round(cart.reduce((sum, item) => {
    if (precioFinalMode[item.key]) {
      return sum + (precioFinalValues[item.key] ?? 0);
    }
    const precio = item.DESCUENTO > 0
      ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
      : item.PRECIO_UNITARIO;
    return sum + precio * item.CANTIDAD;
  }, 0) * 100) / 100;

  const descuentoMonto = Math.round((dtoGral > 0 ? subtotal * (dtoGral / 100) : 0) * 100) / 100;
  const total = Math.round((subtotal - descuentoMonto) * 100) / 100;

  const buildVentaItems = useCallback((): VentaInput['items'] => (
    cart.map(({ PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID, DESDE_REMITO }) => ({
      PRODUCTO_ID,
      PRECIO_UNITARIO,
      CANTIDAD,
      DESCUENTO,
      PRECIO_COMPRA,
      DEPOSITO_ID: DEPOSITO_ID || depositoVentaId || undefined,
      LISTA_ID,
      ...(DESDE_REMITO ? { DESDE_REMITO: true } : {}),
    }))
  ), [cart, depositoVentaId]);

  const ensureDepositoParaVenta = useCallback(() => {
    const faltaDeposito = cart.some(item => !item.DESDE_REMITO && !(item.DEPOSITO_ID || depositoVentaId));
    if (faltaDeposito) {
      notify.warning('Seleccione un depósito antes de continuar con la venta');
      return false;
    }
    return true;
  }, [cart, depositoVentaId]);

  const ensureCantidadesValidas = useCallback(() => {
    const itemsSinCantidad = cart.filter(item => !item.CANTIDAD || item.CANTIDAD <= 0);
    if (itemsSinCantidad.length > 0) {
      notify.warning(`Hay ${itemsSinCantidad.length === 1 ? 'un producto' : `${itemsSinCantidad.length} productos`} con cantidad 0. Ingrese una cantidad válida antes de continuar.`);
      return false;
    }
    return true;
  }, [cart]);

  // ── Stock-insuficiente modal flow ──────────────
  // Mientras el modal está abierto, recordamos la acción pendiente
  // (cobrar / confirmar cobro) para ejecutarla después de aceptar.
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const pendingActionRef = useRef<null | (() => void | Promise<void>)>(null);

  const requestStockValidation = useCallback((action: () => void | Promise<void>) => {
    if (stockValidator.issues.length === 0) {
      action();
      return;
    }
    pendingActionRef.current = action;
    setStockModalOpen(true);
  }, [stockValidator.issues]);

  const handleStockAccept = useCallback(() => {
    stockValidator.autoFixAll();
    setStockModalOpen(false);
    const pending = pendingActionRef.current;
    pendingActionRef.current = null;
    // Damos un microtask para que React aplique el state del cart antes de
    // ejecutar la acción que enviará la venta al backend.
    if (pending) {
      setTimeout(() => { void pending(); }, 0);
    }
  }, [stockValidator]);

  const handleStockCancel = useCallback(() => {
    setStockModalOpen(false);
    pendingActionRef.current = null;
    setStep('cart');
  }, []);

  // ── Cell-event modal flow ──────────────────────
  // Se dispara en tiempo real cuando el usuario escribe en la celda de
  // cantidad un valor que excede el stock disponible. Al cerrar el modal
  // (cualquier forma: botón, X, ESC) la cantidad se ajusta al stock.
  const [cellModal, setCellModal] = useState<{
    key: string;
    cantidadIngresada: number;
    stock: number;
    nombre: string;
    unidad: string;
    esPrecioFinal: boolean;
    precioUnitario: number;
  } | null>(null);

  const handleCellModalClose = useCallback(() => {
    setCellModal(prev => {
      if (prev) {
        // Ajusta la cantidad al stock disponible
        updateCartItem(prev.key, 'CANTIDAD', prev.stock);
        // Si está en modo precio final, recalcular el total
        if (prev.esPrecioFinal && prev.precioUnitario > 0) {
          const newTotal = prev.stock * prev.precioUnitario;
          setPrecioFinalValues(p => ({ ...p, [prev.key]: Math.round(newTotal * 100) / 100 }));
        }
      }
      return null;
    });
  }, []);

  // Submit sale
  const handleSubmit = async (cobrar: boolean) => {
    if (saleSubmitBusy) {
      notify.info('La venta ya se está procesando');
      return;
    }
    if (cart.length === 0) {
      notify.warning('Agregue al menos un producto');
      return;
    }

    if (!ensureCantidadesValidas()) return;

    if (!ensureDepositoParaVenta()) return;

    const doContinue = () => {
      if (cobrar) {
        const initialSelection = selectedMetodos.length > 0
          ? [...selectedMetodos]
          : (defaultMetodoEfectivoId ? [defaultMetodoEfectivoId] : []);
        setMetodoModalSelection(initialSelection);
        setMetodoModalOpen(true);
        return;
      }

      if (esCtaCorriente) {
        setCheckingSaldo(true);
        (async () => {
          try {
            const { saldo } = await salesApi.getSaldoCtaCte(clienteId);
            if (saldo < 0) {
              const creditoDisponible = Math.abs(saldo);
              const cobertura = creditoDisponible >= total ? 'total' : 'parcial';
              setSaldoInfo({ saldo, creditoDisponible, cobertura });
              setSaldoModalOpen(true);
            } else {
              doSaveCtaCte();
            }
          } catch {
            doSaveCtaCte();
          } finally {
            setCheckingSaldo(false);
          }
        })();
      }
    };

    if (stockValidator.issues.length > 0) {
      requestStockValidation(doContinue);
      return;
    }
    doContinue();
  };

  // Confirmed save after saldo modal
  const doSaveCtaCte = () => {
    setSaldoModalOpen(false);
    setSaldoInfo(null);
    const input: VentaInput = {
      CLIENTE_ID: clienteId,
      PUNTO_VENTA_ID: puntoVentaActivo || 1,
      TIPO_COMPROBANTE: tipoComprobante || comprobanteAutoValue,
      ES_CTA_CORRIENTE: esCtaCorriente,
      DTO_GRAL: dtoGral,
      COBRADA: false, // backend will override if anticipo covers total
      MONTO_EFECTIVO: 0,
      MONTO_DIGITAL: 0,
      VUELTO: 0,
      items: buildVentaItems(),
      ...(pedido ? { PEDIDO_ID: pedido.PEDIDO_ID, MESA_ID: pedido.MESA_ID } : {}),
      ...(selectedRemitoIds.length > 0 ? { REMITO_IDS: selectedRemitoIds } : {}),
    };
    submitSale(input);
  };

  // Payment step logic
  const vuelto = useMemo(() => {
    if (selectedMetodos.length === 0) return 0;
    // Only effective cash methods can produce change
    if (soloEfectivo) return Math.max(0, totalRecibido - total);
    return 0; // mixed or all-digital: exact amount required, no change
  }, [selectedMetodos, totalRecibido, total, soloEfectivo]);

  const pagoValido = useMemo(() => {
    if (selectedMetodos.length === 0 || totalRecibido <= 0) return false;
    // If all selected methods are efectivo: overpay is OK (change is returned)
    if (soloEfectivo) return totalRecibido >= total;
    // Any mix with non-efectivo methods, or multiple methods: exact amount required
    return Math.abs(totalRecibido - total) < 0.01;
  }, [selectedMetodos, totalRecibido, total, soloEfectivo]);

  const executeConfirmCobro = useCallback(() => {
    const vueltoFinal = vuelto;

    const metodosPagoInput = selectedMetodos
      .filter(id => (montosPorMetodo[id] || 0) > 0)
      .map(id => {
        const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
        let monto = montosPorMetodo[id] || 0;
        if (m?.CATEGORIA === 'EFECTIVO' && vueltoFinal > 0 && soloEfectivo) {
          monto = monto - vueltoFinal;
        }
        return { METODO_PAGO_ID: id, MONTO: monto };
      })
      .filter(mp => mp.MONTO > 0);

    let efectivoFinal = 0;
    let digitalFinal = 0;
    for (const mp of metodosPagoInput) {
      const m = metodosPago.find(x => x.METODO_PAGO_ID === mp.METODO_PAGO_ID);
      if (m?.CATEGORIA === 'EFECTIVO') efectivoFinal += mp.MONTO;
      else digitalFinal += mp.MONTO;
    }

    const input: VentaInput = {
      CLIENTE_ID: clienteId,
      PUNTO_VENTA_ID: puntoVentaActivo || 1,
      TIPO_COMPROBANTE: tipoComprobante || comprobanteAutoValue,
      ES_CTA_CORRIENTE: esCtaCorriente,
      DTO_GRAL: dtoGral,
      COBRADA: true,
      MONTO_EFECTIVO: efectivoFinal,
      MONTO_DIGITAL: digitalFinal,
      VUELTO: vueltoFinal,
      items: buildVentaItems(),
      metodos_pago: metodosPagoInput,
      ...(pedido ? { PEDIDO_ID: pedido.PEDIDO_ID, MESA_ID: pedido.MESA_ID } : {}),
      ...(selectedRemitoIds.length > 0 ? { REMITO_IDS: selectedRemitoIds } : {}),
    };
    submitSale(input);
  }, [vuelto, selectedMetodos, montosPorMetodo, metodosPago, soloEfectivo, clienteId, puntoVentaActivo, tipoComprobante, comprobanteAutoValue, esCtaCorriente, dtoGral, buildVentaItems, submitSale, pedido, selectedRemitoIds]);

  const handleConfirmCobro = () => {
    if (saleSubmitBusy) {
      notify.info('La venta ya se está procesando');
      return;
    }
    if (!pagoValido) return;
    if (!ensureCantidadesValidas()) return;
    if (!ensureDepositoParaVenta()) return;

    if (stockValidator.issues.length > 0) {
      requestStockValidation(executeConfirmCobro);
      return;
    }
    executeConfirmCobro();
  };

  // When a single method is selected, auto-fill total to it
  useEffect(() => {
    if (step !== 'cobro') return;
    if (selectedMetodos.length === 1) {
      setMontosPorMetodo({ [selectedMetodos[0]!]: total });
    }
  }, [selectedMetodos, step, total]);

  // Handle keyboard shortcuts from settings (ir a cobro, confirmar cobro, buscar producto)
  // Use capture phase + stopImmediatePropagation so this fires BEFORE AppLayout's handler
  // (allows same shortcut for nueva_venta and ir_cobro — when modal is open, it goes to cobro)
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      // Cuando el sub-modal de selección de método de pago está abierto,
      // cedemos el control al hook de navegación de métodos de pago.
      if (metodoModalOpen) return;

      const settings = useSettingsStore.getState();
      const atajoIrCobro = (settings.get('atajo_ir_cobro') || 'F2').toUpperCase();
      const atajoCobrar = (settings.get('atajo_cobrar') || 'F4').toUpperCase();
      const atajoBuscar = (settings.get('atajo_buscar_producto') || 'F3').toUpperCase();

      // Build the pressed key combo
      const parts: string[] = [];
      if (e.ctrlKey) parts.push('CTRL');
      if (e.altKey) parts.push('ALT');
      if (e.shiftKey) parts.push('SHIFT');
      const key = e.key.startsWith('F') && e.key.length <= 3
        ? e.key.toUpperCase()
        : e.key.toUpperCase();
      parts.push(key);
      const combo = parts.join('+');

      if (step === 'cart' && combo === atajoIrCobro && cart.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleSubmit(true);
        return;
      }

      if (step === 'cobro' && combo === atajoCobrar && pagoValido) {
        e.preventDefault();
        e.stopImmediatePropagation();
        handleConfirmCobro();
        return;
      }

      if (step === 'cart' && combo === atajoBuscar) {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
        return;
      }

      // ── Draft navigation shortcuts ──
      // Ctrl+T → new draft
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toUpperCase() === 'T') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (drafts.length >= 10) {
          notify.warning('Máximo 10 borradores simultáneos');
        } else {
          createDraft();
        }
        return;
      }
      // Ctrl+W → close current draft
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toUpperCase() === 'W') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (activeDraftId) handleDiscardDraft(activeDraftId);
        return;
      }
      // Alt+← / Alt+→ → switch between drafts
      if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (drafts.length <= 1) return;
        const currentIdx = drafts.findIndex(d => d.id === activeDraftId);
        const nextIdx = e.key === 'ArrowRight'
          ? (currentIdx + 1) % drafts.length
          : (currentIdx - 1 + drafts.length) % drafts.length;
        const nextDraft = drafts[nextIdx];
        if (nextDraft) setActiveDraft(nextDraft.id);
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, step, cart.length, pagoValido, drafts, activeDraftId, metodoModalOpen]);

  const activeListasPrecios = useMemo(() => listasPrecios.filter(l => l.ACTIVA), [listasPrecios]);

  const cartColumns = [
    {
      title: 'PRODUCTO', dataIndex: 'NOMBRE', key: 'name', ellipsis: true,
      render: (name: string, record: CartItem) => {
        const upperUnidad = (record.UNIDAD_NOMBRE || '').toUpperCase();
        const isKg = upperUnidad.includes('KILOGRAMO');
        const isLt = upperUnidad.includes('LITRO');
        const unitTag = isKg ? 'Peso' : isLt ? 'Volumen' : null;
        const listaId = record.LISTA_ID || 1;
        const listaName = activeListasPrecios.find(l => l.LISTA_ID === listaId)?.NOMBRE || `Lista ${listaId}`;
        const hasListPrices = !!(record.PRECIOS && record.PRECIOS.length > 0);
        return (
          <div className="nsm-cart-product">
            <div className="nsm-cart-product-name">{name}</div>
            <div className="nsm-cart-product-meta">
              <span className="nsm-cart-product-code">{record.CODIGO}</span>
              {unitTag && <span className="nsm-cart-product-unit-tag">{unitTag}</span>}
              <span className="nsm-cart-product-stock">Stock: {record.STOCK} {record.UNIDAD}</span>
              {record.PERMITE_STOCK_NEGATIVO && !record.ES_SERVICIO && !record.ES_CONJUNTO && (
                <Tooltip title="Este producto puede venderse sin stock suficiente">
                  <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>Permite neg.</Tag>
                </Tooltip>
              )}
              {record.CANTIDAD > record.STOCK && !record.PERMITE_STOCK_NEGATIVO && !record.ES_SERVICIO && !record.ES_CONJUNTO && (
                <Tooltip title="La cantidad supera el stock disponible">
                  <WarningOutlined style={{ color: '#cf1322', marginLeft: 4 }} />
                </Tooltip>
              )}
              {hasListPrices && activeListasPrecios.length > 1 ? (
                <Popover
                  trigger="click"
                  placement="bottomLeft"
                  open={listaPopoverKey === record.key}
                  onOpenChange={(visible) => setListaPopoverKey(visible ? record.key : null)}
                  content={
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 140 }}>
                      {activeListasPrecios.map(l => {
                        const price = getListPrice(record, l.LISTA_ID);
                        const isSelected = l.LISTA_ID === listaId;
                        return (
                          <div
                            key={l.LISTA_ID}
                            onClick={() => { handleListaChange(record.key, l.LISTA_ID); setListaPopoverKey(null); }}
                            style={{
                              padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                              background: isSelected ? '#e6f4ff' : 'transparent',
                              fontWeight: isSelected ? 600 : 400,
                              display: 'flex', justifyContent: 'space-between', gap: 12,
                            }}
                            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#f5f5f5'; }}
                            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                          >
                            <span>{l.NOMBRE}</span>
                            <span style={{ color: '#888' }}>{fmtMoney(price)}</span>
                          </div>
                        );
                      })}
                    </div>
                  }
                >
                  <Tag
                    style={{ cursor: 'pointer', fontSize: 11, lineHeight: '18px', marginRight: 0 }}
                  >
                    {listaName} ▾
                  </Tag>
                </Popover>
              ) : (
                <Tag style={{ fontSize: 11, lineHeight: '18px', marginRight: 0, color: '#999' }}>{listaName}</Tag>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: 'P. UNIT.', dataIndex: 'PRECIO_UNITARIO', key: 'price', width: 140, align: 'center' as const,
      render: (val: number, record: CartItem) => {
        return (
        <InputNumber
          ref={el => { if (el) priceRefs.current[record.key] = el; }}
          value={val}
          min={0}
          step={0.01}
          size="middle"
          style={{ width: '100%' }}
          className="nsm-cart-input"
          formatter={v => `$ ${v}`}
          onChange={(v) => {
            const newPrice = v || 0;
            updateCartItem(record.key, 'PRECIO_UNITARIO', newPrice);
            const upperUnidad = (record.UNIDAD_NOMBRE || '').toUpperCase();
            const isWeightOrVolume = upperUnidad.includes('KILOGRAMO') || upperUnidad.includes('LITRO');
            if (isWeightOrVolume && precioFinalMode[record.key] && newPrice > 0) {
              const pf = precioFinalValues[record.key] ?? 0;
              if (pf > 0) {
                const qty = Math.round((pf / newPrice) * 1000000) / 1000000;
                updateCartItem(record.key, 'CANTIDAD', qty);
              }
            }
          }}
          onPressEnter={() => {
            // Enter flow: price → qty
            setTimeout(() => {
              const qtyEl = qtyRefs.current[record.key];
              if (qtyEl) {
                qtyEl.focus();
                const inp = qtyEl?.input || qtyEl?.nativeElement?.querySelector?.('input');
                if (inp) inp.select();
              }
            }, 0);
          }}
        />
      );
      },
    },
    {
      title: 'CANT.', dataIndex: 'CANTIDAD', key: 'qty', width: 220, align: 'center' as const,
      render: (val: number, record: CartItem) => {
        const upperUnidad = (record.UNIDAD_NOMBRE || '').toUpperCase();
        const isKg = upperUnidad.includes('KILOGRAMO');
        const isLt = upperUnidad.includes('LITRO');
        const isWeightOrVolume = isKg || isLt;
        const inGramos = isKg && gramosMode[record.key];
        const inPrecioFinal = isWeightOrVolume && precioFinalMode[record.key];
        const displayVal = inGramos ? Math.round(val * 1000) : val;
        const step = inGramos ? 1 : (isWeightOrVolume ? 0.1 : 1);
        const unitLabel = isKg ? 'kg' : (isLt ? 'lt' : record.UNIDAD);

        // Reglas de stock:
        //   - Si el producto es servicio, kit, viene de remito o permite
        //     stock negativo, no validamos.
        //   - En el input directo (handleChange) NO clampeamos al stock: dejamos
        //     que el valor escrito quede visible y el banner (StockIssuesBanner)
        //     muestra el aviso con detalle. El botón "Ajustar a stock disponible"
        //     del banner hace el clamp real.
        //   - En los botones +/- (handleStep) sí clampeamos para evitar que el
        //     usuario quede varado con un valor fuera de control.
        const canHaveNegative = !!(record.PERMITE_STOCK_NEGATIVO || record.ES_SERVICIO || record.ES_CONJUNTO || record.DESDE_REMITO);
        const stockLimite = canHaveNegative ? Infinity : (record.STOCK || 0);

        const clampCantidad = (cantidad: number): number => {
          if (!Number.isFinite(cantidad) || cantidad < 0) return Math.max(0, cantidad || 0);
          if (canHaveNegative) return Math.max(0.01, cantidad);
          if (cantidad > stockLimite) return stockLimite;
          return Math.max(0.01, cantidad);
        };

        const handleChange = (v: number | null) => {
          const raw = v ?? (inGramos ? 0 : 1);
          const finalVal = inGramos ? raw / 1000 : raw;
          // Sólo clampamos mínimo a 0. Si excede el stock, dejamos que el
          // input lo muestre y disparamos el modal de cell-event.
          const validated = Math.max(0, finalVal);
          updateCartItem(record.key, 'CANTIDAD', validated);
          if (inPrecioFinal && record.PRECIO_UNITARIO > 0) {
            const newTotal = validated * record.PRECIO_UNITARIO;
            setPrecioFinalValues(prev => ({ ...prev, [record.key]: Math.round(newTotal * 100) / 100 }));
          }
          // Detectar exceso en tiempo real (sólo si el producto no permite
          // stock negativo). El modal queda a la espera del usuario; al
          // cerrarlo, se ajusta la cantidad al stock.
          if (!canHaveNegative && validated > stockLimite) {
            setCellModal({
              key: record.key,
              cantidadIngresada: validated,
              stock: stockLimite,
              nombre: record.NOMBRE,
              unidad: record.UNIDAD,
              esPrecioFinal: !!inPrecioFinal,
              precioUnitario: record.PRECIO_UNITARIO,
            });
          }
        };

        const handleStep = (delta: number) => {
          let newVal: number;
          if (inGramos) {
            const newG = Math.max(0, Math.round(val * 1000) + delta);
            newVal = newG / 1000;
          } else {
            newVal = Math.max(0.01, val + delta);
          }
          // En botones +/- sí clampeamos para evitar que crezca sin freno.
          const validated = clampCantidad(newVal);
          updateCartItem(record.key, 'CANTIDAD', validated);
          if (inPrecioFinal) setPrecioFinalValues(prev => ({ ...prev, [record.key]: Math.round(validated * record.PRECIO_UNITARIO * 100) / 100 }));
        };

        // Non-weight/volume: simple inline controls
        if (!isWeightOrVolume) {
          return (
            <Space size={4}>
              <Button size="small" icon={<MinusOutlined />}
                onClick={() => handleStep(-1)}
                className="nsm-qty-btn"
              />
              <InputNumber
                ref={el => { if (el) qtyRefs.current[record.key] = el; }}
                value={val} min={0.01} step={1} size="middle" style={{ width: 64 }}
                className="nsm-cart-input"
                onChange={(v) => {
                  const num = v || 0;
                  updateCartItem(record.key, 'CANTIDAD', num);
                  if (inPrecioFinal && record.PRECIO_UNITARIO > 0) {
                    const newTotal = num * record.PRECIO_UNITARIO;
                    setPrecioFinalValues(prev => ({ ...prev, [record.key]: Math.round(newTotal * 100) / 100 }));
                  }
                  // Detectar exceso en tiempo real (sólo si el producto no
                  // permite stock negativo). El modal ajustará al cerrar.
                  if (!canHaveNegative && num > stockLimite) {
                    setCellModal({
                      key: record.key,
                      cantidadIngresada: num,
                      stock: stockLimite,
                      nombre: record.NOMBRE,
                      unidad: record.UNIDAD,
                      esPrecioFinal: !!inPrecioFinal,
                      precioUnitario: record.PRECIO_UNITARIO,
                    });
                  }
                }}
                onPressEnter={() => {
                  // Enter flow: qty → dto
                  setTimeout(() => {
                    const dtoEl = dtoRefs.current[record.key];
                    if (dtoEl) {
                      dtoEl.focus();
                      const inp = dtoEl?.input || dtoEl?.nativeElement?.querySelector?.('input');
                      if (inp) inp.select();
                    }
                  }, 0);
                }}
              />
              <Button size="small" icon={<PlusOutlined />}
                onClick={() => handleStep(1)}
                className="nsm-qty-btn"
              />
            </Space>
          );
        }

        // Weight/volume: main row always has the quantity input/display, extras below
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {/* Row 1: always the quantity value */}
            {inPrecioFinal ? (
              <div style={{ height: 32, display: 'flex', alignItems: 'center' }}>
                <Text strong style={{ fontSize: 14 }}>{val.toFixed(4)} {unitLabel}</Text>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Button size="small" icon={<MinusOutlined />}
                  onClick={() => handleStep(inGramos ? -10 : -1)}
                  className="nsm-qty-btn"
                />
                <InputNumber
                  ref={el => { if (el) qtyRefs.current[record.key] = el; }}
                  value={inGramos ? displayVal : val}
                  min={0}
                  step={step}
                  size="middle"
                  style={{ width: 90 }}
                  className="nsm-cart-input"
                  precision={inGramos ? 0 : 3}
                  onChange={handleChange}
                  onPressEnter={() => {
                    setTimeout(() => {
                      const dtoEl = dtoRefs.current[record.key];
                      if (dtoEl) {
                        dtoEl.focus();
                        const inp = dtoEl?.input || dtoEl?.nativeElement?.querySelector?.('input');
                        if (inp) inp.select();
                      }
                    }, 0);
                  }}
                />
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{inGramos ? 'g' : unitLabel}</Text>
                <Button size="small" icon={<PlusOutlined />}
                  onClick={() => handleStep(inGramos ? 10 : 1)}
                  className="nsm-qty-btn"
                />
              </div>
            )}
            {/* Row 2: secondary controls */}
            {inPrecioFinal ? (
              <Text type="secondary" style={{ fontSize: 11 }}>Calculado</Text>
            ) : isKg ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Switch
                  size="small"
                  checked={!!gramosMode[record.key]}
                  onChange={(checked) => setGramosMode(prev => ({ ...prev, [record.key]: checked }))}
                />
                <Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                  {gramosMode[record.key] ? `= ${val.toFixed(3)} kg` : 'gramos'}
                </Text>
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      title: 'DTO %', dataIndex: 'DESCUENTO', key: 'discount', width: 90, align: 'center' as const,
      render: (val: number, record: CartItem) => {
        return (
        <InputNumber
          ref={el => { if (el) dtoRefs.current[record.key] = el; }}
          value={val} min={0} max={100} size="middle" style={{ width: '100%' }}
          className="nsm-cart-input"
          onChange={(v) => updateCartItem(record.key, 'DESCUENTO', v || 0)}
          onPressEnter={() => {
            // Enter flow: dto → back to search
            setTimeout(() => searchRef.current?.focus(), 0);
          }}
        />
      );
      },
    },
    {
      title: 'SUBTOTAL', key: 'sub', width: 150, align: 'center' as const,
      render: (_: unknown, record: CartItem) => {
        const upperUnidad = (record.UNIDAD_NOMBRE || '').toUpperCase();
        const isKg = upperUnidad.includes('KILOGRAMO');
        const isLt = upperUnidad.includes('LITRO');
        const isWeightOrVolume = isKg || isLt;
        const inPrecioFinal = isWeightOrVolume && precioFinalMode[record.key];

        const precio = record.DESCUENTO > 0
          ? record.PRECIO_UNITARIO * (1 - record.DESCUENTO / 100)
          : record.PRECIO_UNITARIO;
        const subtotalCalculado = Math.round(precio * record.CANTIDAD * 100) / 100;

        const handlePrecioFinalChange = (v: number | null) => {
          const precioFinal = v ?? 0;
          setPrecioFinalValues(prev => ({ ...prev, [record.key]: precioFinal }));
          if (record.PRECIO_UNITARIO > 0 && precioFinal > 0) {
            const rawQty = precioFinal / record.PRECIO_UNITARIO;
            const qty = Math.round(rawQty * 1000000) / 1000000;
            updateCartItem(record.key, 'CANTIDAD', qty);
          } else {
            updateCartItem(record.key, 'CANTIDAD', 0);
          }
        };

        // Non-weight/volume: just show the subtotal
        if (!isWeightOrVolume) {
          return <Text strong style={{ fontSize: 14 }}>{fmtMoney(subtotalCalculado)}</Text>;
        }

        // Weight/volume: main row is always the subtotal value, switch below
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
            {/* Row 1: always the subtotal value or editable input */}
            {inPrecioFinal ? (
              <InputNumber
                value={precioFinalValues[record.key] ?? 0}
                min={0}
                step={100}
                size="middle"
                style={{ width: '100%' }}
                precision={2}
                prefix="$"
                onChange={handlePrecioFinalChange}
              />
            ) : (
              <div style={{ height: 32, display: 'flex', alignItems: 'center' }}>
                <Text strong style={{ fontSize: 14 }}>{fmtMoney(subtotalCalculado)}</Text>
              </div>
            )}
            {/* Row 2: toggle switch */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Switch
                size="small"
                checked={!!precioFinalMode[record.key]}
                onChange={(checked) => {
                  setPrecioFinalMode(prev => ({ ...prev, [record.key]: checked }));
                  if (checked) {
                    const currentTotal = Math.round(subtotalCalculado * 100) / 100;
                    setPrecioFinalValues(prev => ({ ...prev, [record.key]: currentTotal }));
                    setGramosMode(prev => ({ ...prev, [record.key]: false }));
                  }
                }}
              />
              <DollarOutlined style={{ fontSize: 11, color: inPrecioFinal ? '#d4a017' : '#999' }} />
            </div>
          </div>
        );
      },
    },
    {
      title: '', key: 'actions', width: 48, align: 'center' as const,
      render: (_: unknown, record: CartItem) => {
        return (
          <Button type="text" danger size="small" icon={<DeleteOutlined />}
            onClick={() => {
              // Clean up refs
              delete priceRefs.current[record.key];
              delete qtyRefs.current[record.key];
              delete dtoRefs.current[record.key];
              removeCartItem(record.key);
            }}
            className="nsm-cart-delete"
          />
        );
      },
    },
  ];

  const totalItems = cart.length;
  const totalUnits = cart.reduce((s, i) => s + i.CANTIDAD, 0);

  return (
    <>
    <Modal
      open={open}
      onCancel={handleClose}
      width="95vw"
      style={{ top: 20, maxWidth: 1400 }}
      footer={null}
      closable={false}
      className="new-sale-modal rg-modal"
      styles={{ body: { padding: 0, overflow: 'hidden' } }}
      afterOpenChange={handleAfterOpenChange}
    >
      {/* ── Dark header bar ─────────────────────── */}
      <div className="nsm-header">
        <div className="nsm-header-left">
          {step === 'cobro' ? (
            <>
              <WalletOutlined className="nsm-header-icon" />
              <Title level={4} style={{ margin: 0, color: '#fff' }}>Pantalla de Cobro</Title>
            </>
          ) : (
            <>
              <ShoppingCartOutlined className="nsm-header-icon" />
              <Title level={4} style={{ margin: 0, color: '#fff' }}>Nueva Venta</Title>
            </>
          )}
        </div>
        <Button
          type="text"
          onClick={handleClose}
          style={{ color: 'rgba(255,255,255,0.6)', fontSize: 22, lineHeight: 1 }}
        >
          ✕
        </Button>
      </div>

      {/* ── Draft tabs bar ──────────────────────── */}
      {drafts.length > 0 && (
        <div className="nsm-drafts-bar">
          <Tabs
            type="editable-card"
            size="small"
            activeKey={activeDraftId ?? undefined}
            onChange={(key) => {
              if (saleSubmitBusy) return;
              setActiveDraft(key);
            }}
            onEdit={(targetKey, action) => {
              if (saleSubmitBusy) return;
              if (action === 'add') {
                if (drafts.length >= 10) {
                  notify.warning('Máximo 10 borradores simultáneos');
                } else {
                  createDraft();
                }
              } else if (action === 'remove' && typeof targetKey === 'string') {
                handleDiscardDraft(targetKey);
              }
            }}
            items={drafts.map((d) => {
              const itemCount = d.cart.length;
              return {
                key: d.id,
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {d.label}
                    {itemCount > 0 && (
                      <Badge
                        count={itemCount}
                        size="small"
                        style={{ backgroundColor: d.id === activeDraftId ? '#EABD23' : '#999', color: '#1E1F22', fontSize: 10 }}
                      />
                    )}
                  </span>
                ),
                closable: !saleSubmitBusy,
                disabled: saleSubmitBusy,
              };
            })}
            tabBarStyle={{ margin: 0, paddingLeft: 12, paddingRight: 12 }}
          />
        </div>
      )}

      {cajaCheckState === 'checking' ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '80px 0' }}>
          <Spin size="large" />
        </div>
      ) : cajaCheckState === 'closed' ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '80px 40px', textAlign: 'center', gap: 16,
        }}>
          <WarningOutlined style={{ fontSize: 64, color: '#faad14' }} />
          <Title level={4} style={{ margin: 0 }}>No hay caja abierta</Title>
          <Text type="secondary" style={{ fontSize: 15, maxWidth: 420 }}>
            Para registrar una venta es necesario que abras una caja primero.
            Dirigite a la sección de Cajas para abrir una.
          </Text>
          <Space size="middle" style={{ marginTop: 8 }}>
            <Button
              type="primary"
              size="large"
              icon={<BankOutlined />}
              className="btn-gold"
              onClick={handleGoToCaja}
              autoFocus
            >
              Ir a Cajas
            </Button>
            <Button size="large" onClick={handleClose}>
              Cancelar
            </Button>
          </Space>
        </div>
      ) : (
      <div className="nsm-body" onFocusCapture={(e) => {
        const target = e.target as HTMLInputElement;
        if (target.tagName === 'INPUT' && target.type === 'text') {
          requestAnimationFrame(() => target.select());
        }
      }}>
        {/* ══ LEFT COLUMN — Search + Cart ══════════ */}
        <div className="nsm-main">
          {/* Cart container (search embedded inside) */}
          <div className="nsm-cart-area">
            {/* Embedded search */}
            <div className="nsm-search-embedded">
              <Input
                ref={searchRef}
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                prefix={<SearchOutlined style={{ fontSize: 16, color: '#bbb' }} />}
                suffix={
                  searchLoading
                    ? <Spin size="small" />
                    : <Tag color="default" style={{ margin: 0, fontSize: 11, opacity: 0.45 }}>Enter</Tag>
                }
                placeholder="Buscar producto, código o escanear..."
                size="large"
                allowClear
                onKeyDown={handleSearchKeyDown}
                className="nsm-search-input"
              />
            </div>
            {cart.length === 0 ? (
              <div className="nsm-empty-state">
                <ShoppingCartOutlined className="nsm-empty-icon" />
                <Title level={5} style={{ color: '#999', margin: '12px 0 4px' }}>
                  Carrito vacío
                </Title>
                <Text type="secondary">
                  Busque y agregue productos con el buscador
                </Text>
              </div>
            ) : (
              <Table
                className="rg-table nsm-cart-table"
                dataSource={cart}
                columns={cartColumns}
                rowKey="key"
                pagination={false}
                size="middle"
                scroll={{ y: 'calc(100vh - 340px)' }}
              />
            )}
          </div>
        </div>

        {/* ══ BOTTOM FOOTER — Totals + Config + Actions ═══════ */}
        <div className="nsm-sidebar">
          {step === 'cart' ? (
            /* ── STEP 1: Cart footer ─────────────────── */
            <div className="nsm-footer-content">
              {/* ── Left zone: stats + totals + config ── */}
              <div className="nsm-footer-zone nsm-footer-zone-totals">
                {/* Quick stats */}
                <Space size={16} wrap>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600 }}>Ítems</Text>
                    <Badge
                      count={totalItems}
                      showZero
                      style={{ backgroundColor: totalItems > 0 ? '#EABD23' : '#d9d9d9', color: '#1E1F22', fontWeight: 600 }}
                    />
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, fontWeight: 600 }}>Unidades</Text>
                    <Badge
                      count={totalUnits}
                      showZero
                      style={{ backgroundColor: totalUnits > 0 ? '#EABD23' : '#d9d9d9', color: '#1E1F22', fontWeight: 600 }}
                    />
                  </span>
                </Space>

                {/* Subtotal / Dto if any */}
                {dtoGral > 0 && (
                  <div className="nsm-footer-summary-inline">
                    <span className="label">Subtotal</span>
                    <span className="value">{fmtMoney(subtotal)}</span>
                    <span className="label" style={{ marginLeft: 8 }}>Dto. {dtoGral}%</span>
                    <span className="value" style={{ color: '#ff4d4f', fontSize: 14 }}>- {fmtMoney(descuentoMonto)}</span>
                  </div>
                )}

                {/* Total */}
                <div className="nsm-footer-summary-inline gold">
                  <span className="label">TOTAL</span>
                  <span className="value" style={{ fontSize: 26 }}>{fmtMoney(total)}</span>
                </div>

                {/* ── Config Popover ── */}
                <Popover
                  trigger="click"
                  placement="topRight"
                  destroyTooltipOnHide
                  content={
                    <div className="nsm-config-popover">
                      <div className="nsm-field-group">
                        <label className="nsm-label">
                          <UserOutlined style={{ marginRight: 6 }} />
                          Cliente
                        </label>
                        <Select
                          showSearch
                          placeholder="Seleccionar cliente"
                          style={{ width: '100%' }}
                          value={clienteId}
                          onChange={setClienteId}
                          optionFilterProp="label"
                          size="middle"
                          options={clientes.map((c: ClienteVenta) => ({
                            value: c.CLIENTE_ID,
                            label: `${c.NOMBRE || ''}  (${c.CODIGOPARTICULAR})`,
                          }))}
                        />
                      </div>

                      {/* Remitos pendientes */}
                      {loadingRemitos && clienteId !== 1 && (
                        <div className="nsm-field-group">
                          <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>Buscando remitos...</Text>
                        </div>
                      )}
                      {remitosPendientes.length > 0 && (
                        <div className="nsm-field-group">
                          <label className="nsm-label">
                            <FileTextOutlined style={{ marginRight: 6, color: '#1677ff' }} />
                            Remitos pendientes
                            <Badge count={remitosPendientes.length} style={{ backgroundColor: '#1677ff', marginLeft: 8 }} />
                          </label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 140, overflowY: 'auto' }}>
                            {remitosPendientes.map(r => {
                              const isSelected = selectedRemitoIds.includes(r.REMITO_ID);
                              return (
                                <div
                                  key={r.REMITO_ID}
                                  onClick={() => {
                                    setSelectedRemitoIds(prev =>
                                      isSelected
                                        ? prev.filter(id => id !== r.REMITO_ID)
                                        : [...prev, r.REMITO_ID]
                                    );
                                  }}
                                  style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                                    border: isSelected ? '2px solid #1677ff' : '1px solid #d9d9d9',
                                    background: isSelected ? 'rgba(22, 119, 255, 0.06)' : 'transparent',
                                    transition: 'all 0.15s',
                                  }}
                                >
                                  <div>
                                    <Text strong style={{ fontSize: 12 }}>
                                      R {String(r.PTO_VTA).padStart(4, '0')}-{String(r.NRO_REMITO).padStart(8, '0')}
                                    </Text>
                                    <br />
                                    <Text type="secondary" style={{ fontSize: 10 }}>
                                      {new Date(r.FECHA).toLocaleDateString('es-AR')}
                                    </Text>
                                  </div>
                                  <div style={{ textAlign: 'right' }}>
                                    <Text strong style={{ fontSize: 12 }}>{fmtMoney(r.TOTAL)}</Text>
                                    {isSelected && <CheckCircleOutlined style={{ color: '#1677ff', marginLeft: 6, fontSize: 11 }} />}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                          <Button
                            type="primary"
                            size="small"
                            icon={<PlusOutlined />}
                            disabled={selectedRemitoIds.length === 0}
                            loading={loadingRemitoItems}
                            onClick={() => handleCargarRemitos(selectedRemitoIds)}
                            style={{ marginTop: 6 }}
                            block
                          >
                            Cargar {selectedRemitoIds.length > 0 ? `${selectedRemitoIds.length} remito(s)` : 'remitos'}
                          </Button>
                        </div>
                      )}

                      <div className="nsm-field-group">
                        <label className="nsm-label">
                          <ShopOutlined style={{ marginRight: 6 }} />
                          Depósito
                        </label>
                        <Select
                          placeholder="Depósito"
                          style={{ width: '100%' }}
                          value={depositoVentaId ?? undefined}
                          onChange={setDepositoId}
                          size="middle"
                          options={depositosPV.map(d => ({
                            value: d.DEPOSITO_ID,
                            label: d.ES_PREFERIDO ? `${d.NOMBRE} (preferido)` : d.NOMBRE,
                          }))}
                        />
                      </div>

                      <div className="nsm-field-group">
                        <label className="nsm-label">
                          <FileTextOutlined style={{ marginRight: 6 }} />
                          Tipo Comprobante
                        </label>
                        <Select
                          placeholder="Tipo"
                          style={{ width: '100%' }}
                          value={tipoComprobante || undefined}
                          onChange={setTipoComprobante}
                          disabled={esMonotributo || esRI}
                          size="middle"
                          options={comprobanteOptions}
                        />
                      </div>

                      <div className="nsm-field-group">
                        <div className="nsm-switch-row">
                          <Switch
                            size="small"
                            checked={esCtaCorriente}
                            onChange={setEsCtaCorriente}
                            disabled={!clienteTieneCtaCte}
                          />
                          <span className="nsm-switch-label" style={{ opacity: clienteTieneCtaCte ? 1 : 0.45, fontSize: 12 }}>
                            <SwapOutlined style={{ marginRight: 6 }} />
                            Cuenta Corriente
                            <Tooltip title="Si el cliente no tiene cuenta corriente, se creará automáticamente al finalizar la operación.">
                              <QuestionCircleOutlined style={{ marginLeft: 6, color: '#8c8c8c', cursor: 'help' }} />
                            </Tooltip>
                          </span>
                        </div>
                      </div>

                      <div className="nsm-field-group">
                        <label className="nsm-label">Descuento General %</label>
                        <InputNumber
                          value={dtoGral}
                          min={0}
                          max={100}
                          size="middle"
                          style={{ width: '100%' }}
                          onChange={(v) => setDtoGral(v || 0)}
                        />
                      </div>
                    </div>
                  }
                >
                  <Button
                    icon={<SettingOutlined />}
                    size="large"
                  >
                    Comprobante
                    {(selectedCliente?.NOMBRE && clienteId !== 1) ? `: ${selectedCliente.NOMBRE}` : ''}
                  </Button>
                </Popover>
              </div>

              {/* ── Right zone: actions ── */}
              <div className="nsm-footer-zone nsm-footer-zone-actions">
                {esCtaCorriente && (
                  <Popover
                    trigger="click"
                    placement="topRight"
                    destroyTooltipOnHide
                    content={
                      <div className="nsm-config-popover" style={{ width: 260 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {!wantFacturar && (
                            <Checkbox
                              checked={wantPrint}
                              onChange={e => setWantPrint(e.target.checked)}
                            >
                              <Space size={6}>
                                <PrinterOutlined />
                                <span>Imprimir ticket</span>
                              </Space>
                            </Checkbox>
                          )}
                          {utilizaFE && (
                            <>
                              <Checkbox
                                checked={wantFacturar}
                                onChange={e => {
                                  setWantFacturar(e.target.checked);
                                  if (e.target.checked) setWantPrint(false);
                                }}
                              >
                                <Space size={6}>
                                  <FileTextOutlined style={{ color: '#1677ff' }} />
                                  <span>Emitir Factura Electrónica</span>
                                </Space>
                              </Checkbox>
                              {wantFacturar && (
                                <div style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <Checkbox
                                    checked={wantFEPdf}
                                    onChange={e => setWantFEPdf(e.target.checked)}
                                  >
                                    <Space size={6}>
                                      <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                                      <span>Descargar PDF</span>
                                    </Space>
                                  </Checkbox>
                                  <Checkbox
                                    checked={wantFETicket}
                                    onChange={e => setWantFETicket(e.target.checked)}
                                  >
                                    <Space size={6}>
                                      <PrinterOutlined />
                                      <span>Imprimir ticket 80mm</span>
                                    </Space>
                                  </Checkbox>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    }
                  >
                    <Button icon={<SettingOutlined />} size="large">
                      Impr
                    </Button>
                  </Popover>
                )}
                {!esCtaCorriente && (
                  <Popover
                    trigger="click"
                    placement="topRight"
                    destroyTooltipOnHide
                    content={
                      <div className="nsm-config-popover" style={{ width: 260 }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <Checkbox
                            checked={wantPrint}
                            onChange={e => setWantPrint(e.target.checked)}
                          >
                            <Space size={6}>
                              <PrinterOutlined />
                              <span>Imprimir ticket</span>
                            </Space>
                          </Checkbox>
                          <Checkbox
                            checked={wantWhatsApp}
                            onChange={e => setWantWhatsApp(e.target.checked)}
                          >
                            <Space size={6}>
                              <WhatsAppOutlined style={{ color: '#25D366' }} />
                              <span>Enviar por WhatsApp</span>
                            </Space>
                          </Checkbox>
                          {utilizaFE && (
                            <Checkbox
                              checked={wantFacturar}
                              onChange={e => {
                                setWantFacturar(e.target.checked);
                                if (e.target.checked) setWantPrint(false);
                              }}
                            >
                              <Space size={6}>
                                <FileTextOutlined style={{ color: '#1677ff' }} />
                                <span>Emitir Factura Electrónica</span>
                              </Space>
                            </Checkbox>
                          )}
                          {wantFacturar && utilizaFE && (
                            <div style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <Checkbox
                                checked={wantFEPdf}
                                onChange={e => setWantFEPdf(e.target.checked)}
                              >
                                <Space size={6}>
                                  <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                                  <span>Descargar PDF</span>
                                </Space>
                              </Checkbox>
                              <Checkbox
                                checked={wantFETicket}
                                onChange={e => setWantFETicket(e.target.checked)}
                              >
                                <Space size={6}>
                                  <PrinterOutlined />
                                  <span>Imprimir ticket 80mm</span>
                                </Space>
                              </Checkbox>
                            </div>
                          )}
                        </div>
                      </div>
                    }
                  >
                    <Button icon={<SettingOutlined />} size="large">
                      Impr
                    </Button>
                  </Popover>
                )}

                {esCtaCorriente ? (
                  <Button
                    type="primary"
                    size="large"
                    onClick={() => handleSubmit(false)}
                    loading={saleSubmitBusy || checkingSaldo}
                    disabled={cart.length === 0 || saleSubmitBusy}
                    style={{ height: 56, minWidth: 200, fontSize: 16, fontWeight: 700 }}
                  >
                    Guardar (Pendiente)
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    size="large"
                    className="btn-gold nsm-btn-cobrar"
                    onClick={() => handleSubmit(true)}
                    loading={saleSubmitBusy}
                    disabled={cart.length === 0 || saleSubmitBusy}
                    icon={<ShoppingCartOutlined />}
                    style={{ height: 56, minWidth: 220, fontSize: 16, fontWeight: 700 }}
                  >
                    Cobrar {fmtMoney(total)}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            /* ── STEP 2: Cobro footer ───────────────── */
            <div className="nsm-footer-content">
              {/* ── Zone 1: Totals + Status ── */}
              <div className="nsm-footer-zone nsm-footer-zone-totals">
                <div className="nsm-footer-summary-inline gold">
                  <span className="label">Total</span>
                  <span className="value" style={{ fontSize: 22 }}>{fmtMoney(total)}</span>
                </div>
                <div className="nsm-footer-summary-inline blue">
                  <span className="label">Recibido</span>
                  <span className="value" style={{ fontSize: 22 }}>{fmtMoney(totalRecibido)}</span>
                </div>
                {/* Status pill */}
                {vuelto > 0 ? (
                  <div className="nsm-footer-status status-success">
                    <span className="status-label">Vuelto</span>
                    <span className="status-amount">{fmtMoney(vuelto)}</span>
                  </div>
                ) : totalRecibido < total ? (
                  <div className="nsm-footer-status status-danger">
                    <span className="status-label">Faltan</span>
                    <span className="status-amount">{fmtMoney(total - totalRecibido)}</span>
                  </div>
                ) : !soloEfectivo && totalRecibido > total ? (
                  <div className="nsm-footer-status status-warning">
                    <span className="status-label">Exceso</span>
                    <span className="status-amount">{fmtMoney(totalRecibido - total)}</span>
                  </div>
                ) : (
                  <div className="nsm-footer-status status-success">
                    <span className="status-label">Estado</span>
                    <span className="status-amount" style={{ fontSize: 14 }}>PAGO EXACTO</span>
                  </div>
                )}
              </div>

              {/* ── Zone 2: Amount Input + Methods ── */}
              <div className="nsm-footer-zone">
                {/* Method tags (clickable to open modal) */}
                <Popover
                  trigger="click"
                  placement="top"
                  destroyTooltipOnHide
                  open={multiMetodoPopoverOpen}
                  onOpenChange={(open) => setMultiMetodoPopoverOpen(open)}
                  content={
                    <div className="nsm-config-popover">
                      <div className="nsm-field-group">
                        <label className="nsm-label">Métodos de pago</label>
                        <div className="nsm-method-tags-inline">
                          {selectedMetodos.map(id => {
                            const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                            return m ? (
                              <Tag key={id} color={m.CATEGORIA === 'EFECTIVO' ? 'gold' : 'blue'}>
                                {m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined /> : <CreditCardOutlined />}
                                {' '}{m.NOMBRE}
                              </Tag>
                            ) : null;
                          })}
                        </div>
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, marginTop: 6 }}
                          onClick={() => {
                            setMultiMetodoPopoverOpen(false);
                            setMetodoModalSelection([...selectedMetodos]);
                            setMetodoModalOpen(true);
                          }}
                        >
                          Cambiar métodos
                        </Button>
                      </div>

                      {/* Amount inputs per selected method (multi) */}
                      {selectedMetodos.length > 1 && selectedMetodos.map((id, idx) => {
                        const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                        if (!m) return null;
                        return (
                          <div className="nsm-field-group" key={id}>
                            <label className="nsm-label">
                              {m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined style={{ marginRight: 6 }} /> : <CreditCardOutlined style={{ marginRight: 6 }} />}
                              {m.NOMBRE}
                            </label>
                            <InputNumber
                              ref={idx === 0 ? primerMontoRef : undefined}
                              value={montosPorMetodo[id] || 0}
                              min={0}
                              step={100}
                              size="middle"
                              style={{ width: '100%' }}
                              formatter={v => `$ ${v}`}
                              onChange={v => setMontosPorMetodo(prev => ({ ...prev, [id]: v || 0 }))}
                              onPressEnter={() => { if (pagoValido) handleConfirmCobro(); }}
                            />
                          </div>
                        );
                      })}

                      {/* Single method: inline amount input */}
                      {selectedMetodos.length === 1 && (() => {
                        const id = selectedMetodos[0]!;
                        const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                        if (!m) return null;
                        return (
                          <>
                            <div className="nsm-field-group">
                              <label className="nsm-label">
                                {m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined style={{ marginRight: 6 }} /> : <CreditCardOutlined style={{ marginRight: 6 }} />}
                                Monto {m.NOMBRE}
                              </label>
                              <InputNumber
                                ref={efectivoRef}
                                value={montosPorMetodo[id] || 0}
                                min={0}
                                step={100}
                                size="middle"
                                style={{ width: '100%' }}
                                formatter={v => `$ ${v}`}
                                onChange={v => setMontosPorMetodo(prev => ({ ...prev, [id]: v || 0 }))}
                                onPressEnter={() => { if (pagoValido) handleConfirmCobro(); }}
                                autoFocus
                              />
                              {m.CATEGORIA === 'EFECTIVO' && (
                                <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                                  Puede ingresar un monto mayor — se calculará el vuelto
                                </Text>
                              )}
                              {m.CATEGORIA === 'DIGITAL' && (
                                <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                                  El monto debe ser exacto
                                </Text>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  }
                >
                  <Button size="large" icon={<WalletOutlined />}>
                    {selectedMetodos.length === 0
                      ? 'Método de pago'
                      : selectedMetodos.map(id => {
                          const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                          return m?.NOMBRE;
                        }).join(' + ')}
                  </Button>
                </Popover>

                {/* Quick amount input for the active method (if single) */}
                {selectedMetodos.length === 1 && (() => {
                  const id = selectedMetodos[0]!;
                  return (
                    <InputNumber
                      ref={montoRapidoRef}
                      value={montosPorMetodo[id] || 0}
                      min={0}
                      step={100}
                      size="large"
                      style={{ width: 180 }}
                      placeholder="Monto"
                      formatter={v => `$ ${v}`}
                      onChange={v => setMontosPorMetodo(prev => ({ ...prev, [id]: v || 0 }))}
                      onPressEnter={() => { if (pagoValido) handleConfirmCobro(); }}
                    />
                  );
                })()}
              </div>

              {/* ── Zone 3: Print / WhatsApp / FE ── */}
              <div className="nsm-footer-zone">
                <Popover
                  trigger="click"
                  placement="top"
                  destroyTooltipOnHide
                  content={
                    <div className="nsm-config-popover" style={{ width: 260 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {!wantFacturar && (
                          <Checkbox
                            checked={wantPrint}
                            onChange={e => setWantPrint(e.target.checked)}
                          >
                            <Space size={6}>
                              <PrinterOutlined />
                              <span>Imprimir ticket</span>
                            </Space>
                          </Checkbox>
                        )}
                        <Checkbox
                          checked={wantWhatsApp}
                          onChange={e => setWantWhatsApp(e.target.checked)}
                        >
                          <Space size={6}>
                            <WhatsAppOutlined style={{ color: '#25D366' }} />
                            <span>Enviar por WhatsApp</span>
                          </Space>
                        </Checkbox>
                        {utilizaFE && (
                          <Checkbox
                            checked={wantFacturar}
                            onChange={e => setWantFacturar(e.target.checked)}
                          >
                            <Space size={6}>
                              <FileTextOutlined style={{ color: '#1677ff' }} />
                              <span>Emitir Factura Electrónica</span>
                            </Space>
                          </Checkbox>
                        )}
                        {wantFacturar && utilizaFE && (
                          <div style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <Checkbox
                              checked={wantFEPdf}
                              onChange={e => setWantFEPdf(e.target.checked)}
                            >
                              <Space size={6}>
                                <FilePdfOutlined style={{ color: '#ff4d4f' }} />
                                <span>Descargar PDF</span>
                              </Space>
                            </Checkbox>
                            <Checkbox
                              checked={wantFETicket}
                              onChange={e => setWantFETicket(e.target.checked)}
                            >
                              <Space size={6}>
                                <PrinterOutlined />
                                <span>Imprimir ticket 80mm</span>
                              </Space>
                            </Checkbox>
                          </div>
                        )}
                      </div>
                    </div>
                  }
                >
                  <Button size="large" icon={<SettingOutlined />}>
                    Impr
                  </Button>
                </Popover>
              </div>

              {/* ── Zone 4: Actions ── */}
              <div className="nsm-footer-zone nsm-footer-zone-actions">
                <Button
                  size="large"
                  onClick={() => { setStep('cart'); setMultiMetodoPopoverOpen(false); }}
                  icon={<ArrowLeftOutlined />}
                  style={{ height: 56 }}
                >
                  Volver
                </Button>
                <Button
                  type="primary"
                  size="large"
                  className="btn-gold nsm-btn-cobrar"
                  onClick={handleConfirmCobro}
                  loading={saleSubmitBusy}
                  disabled={!pagoValido || saleSubmitBusy}
                  icon={<CheckCircleOutlined />}
                  style={{ height: 56, minWidth: 200, fontSize: 16, fontWeight: 700 }}
                >
                  Confirmar Cobro
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </Modal>

    {/* ── Payment Method Selection Modal ── */}
    <Modal
      open={metodoModalOpen}
      onCancel={() => setMetodoModalOpen(false)}
      centered
      width={520}
      destroyOnClose
      className="rg-modal"
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      title={
        <RGCajaModalHeader
          icon={rgIcon('pago')}
          title="Seleccionar método de pago"
          subtitle="Elegí uno o más métodos para cobrar la venta"
        />
      }
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={() => setMetodoModalOpen(false)}>Cancelar</Button>
          <Button
            type="primary"
            className="btn-gold"
            disabled={metodoModalSelection.length === 0}
            onClick={() => {
              setSelectedMetodos(metodoModalSelection);
              // Clear amounts for methods that were removed
              setMontosPorMetodo(prev => {
                const next: Record<number, number> = {};
                for (const id of metodoModalSelection) {
                  next[id] = prev[id] || 0;
                }
                return next;
              });
              setMetodoModalOpen(false);
              setStep('cobro');
              // Focus strategy:
              // - single method → focus the quick amount input in the footer
              // - multiple methods → open the combined-methods popover and focus the first amount input
              if (metodoModalSelection.length === 1) {
                setTimeout(() => montoRapidoRef.current?.focus(), 50);
              } else {
                setMultiMetodoPopoverOpen(true);
                setTimeout(() => primerMontoRef.current?.focus(), 150);
              }
            }}
            icon={<CheckCircleOutlined />}
          >
            Confirmar ({metodoModalSelection.length})
          </Button>
        </div>
      }
    >
      <div style={{ marginTop: 12 }}>
        <Text type="secondary" style={{ fontSize: 12, marginBottom: 12, display: 'block' }}>
          Haga click para seleccionar un método. Mantenga Ctrl presionado para seleccionar varios.
        </Text>
        <div ref={paymentMethodKeyboard.gridRef} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, padding: 6 }}>
          {metodosPagoOrdenados.map(m => {
            const isSelected = metodoModalSelection.includes(m.METODO_PAGO_ID);
            const isActive = paymentMethodKeyboard.activeId === m.METODO_PAGO_ID;
            return (
              <div
                key={m.METODO_PAGO_ID}
                onClick={(e: React.MouseEvent) => {
                  paymentMethodKeyboard.setActiveId(m.METODO_PAGO_ID);
                  if (e.ctrlKey || e.metaKey) {
                    // Ctrl+Click: toggle individual
                    setMetodoModalSelection(prev =>
                      isSelected
                        ? prev.filter(id => id !== m.METODO_PAGO_ID)
                        : [...prev, m.METODO_PAGO_ID]
                    );
                  } else {
                    // Plain click: select only this one
                    setMetodoModalSelection([m.METODO_PAGO_ID]);
                  }
                }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  padding: '22px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                  border: isSelected ? '2px solid #EABD23' : '1px solid #d9d9d9',
                  background: isSelected ? 'rgba(234, 189, 35, 0.08)' : 'transparent',
                  transition: 'all 0.15s', position: 'relative',
                  outline: isActive ? '2px solid rgba(234, 189, 35, 0.55)' : 'none',
                  outlineOffset: 2,
                }}
              >
                {m.IMAGEN_BASE64 ? (
                  <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 6 }} />
                ) : (
                  <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: isSelected ? '#EABD23' : '#999' }}>
                    {m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined /> : <CreditCardOutlined />}
                  </div>
                )}
                <Text strong style={{ fontSize: 13, lineHeight: 1.2 }}>{m.NOMBRE}</Text>
                <Tag
                  color={m.CATEGORIA === 'EFECTIVO' ? 'green' : 'blue'}
                  style={{ fontSize: 10, margin: 0 }}
                >
                  {m.CATEGORIA}
                </Tag>
                {isSelected && (
                  <CheckCircleOutlined style={{ color: '#EABD23', fontSize: 16, position: 'absolute', top: 6, right: 6 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>

    {/* ── Saldo CTA CTE confirmation modal ── */}
    <Modal
      open={saldoModalOpen}
      title={
        <RGCajaModalHeader
          icon={rgIcon('pago')}
          title="Saldo en cuenta corriente"
          subtitle="Crédito disponible del cliente para aplicar a la venta"
        />
      }
      onCancel={() => { setSaldoModalOpen(false); setSaldoInfo(null); }}
      centered
      width={460}
      destroyOnClose
      className="rg-modal"
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={() => { setSaldoModalOpen(false); setSaldoInfo(null); }}>
            Cancelar
          </Button>
          <Button
            type="primary"
            onClick={doSaveCtaCte}
            loading={saleSubmitBusy}
            disabled={saleSubmitBusy}
            icon={<CheckCircleOutlined />}
          >
            Confirmar
          </Button>
        </div>
      }
    >
      {saldoInfo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
          {saldoInfo.cobertura === 'total' ? (
            <>
              <Text>
                El cliente tiene un saldo a favor de <Text strong style={{ color: '#52c41a' }}>{fmtMoney(saldoInfo.creditoDisponible)}</Text> en su cuenta corriente.
              </Text>
              <Text>
                Se utilizará el saldo para cubrir el total de la venta de <Text strong>{fmtMoney(total)}</Text>.
                La venta quedará registrada como <Tag color="green">COBRADA</Tag>.
              </Text>
              <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Saldo anterior:</Text>
                  <Text strong>{fmtMoney(saldoInfo.creditoDisponible)}</Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Monto venta:</Text>
                  <Text strong style={{ color: '#cf1322' }}>-{fmtMoney(total)}</Text>
                </div>
                <Divider style={{ margin: '6px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Saldo resultante:</Text>
                  <Text strong style={{ color: '#52c41a' }}>{fmtMoney(saldoInfo.creditoDisponible - total)}</Text>
                </div>
              </div>
            </>
          ) : (
            <>
              <Text>
                El cliente tiene un saldo a favor de <Text strong style={{ color: '#52c41a' }}>{fmtMoney(saldoInfo.creditoDisponible)}</Text> en su cuenta corriente.
              </Text>
              <Text>
                Se aplicará como anticipo parcial. Quedan pendientes <Text strong style={{ color: '#cf1322' }}>{fmtMoney(total - saldoInfo.creditoDisponible)}</Text>.
              </Text>
              <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Monto venta:</Text>
                  <Text strong>{fmtMoney(total)}</Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Saldo aplicado:</Text>
                  <Text strong style={{ color: '#52c41a' }}>-{fmtMoney(saldoInfo.creditoDisponible)}</Text>
                </div>
                <Divider style={{ margin: '6px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Pendiente de cobro:</Text>
                  <Text strong style={{ color: '#cf1322' }}>{fmtMoney(total - saldoInfo.creditoDisponible)}</Text>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>

    {/* ── WhatsApp phone number modal ── */}
    <Modal
      open={wspModalOpen}
      title={
        <RGCajaModalHeader
          icon={rgIcon('venta-detalle')}
          title="Enviar detalle por WhatsApp"
          subtitle="Compartí el comprobante de la venta al cliente"
        />
      }
      onCancel={handleCloseWspModal}
      footer={null}
      centered
      width={420}
      destroyOnClose
      className="rg-modal"
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Nombre del cliente</Text>
          <Input
            value={wspNombre}
            onChange={e => setWspNombre(e.target.value)}
            placeholder="Nombre del destinatario"
            prefix={<UserOutlined />}
            autoFocus
          />
        </div>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Teléfono (con código de área)</Text>
          <Input
            value={wspTelefono}
            onChange={e => setWspTelefono(e.target.value)}
            placeholder="Ej: 3415551234"
            prefix={<span style={{ color: '#999' }}>+54</span>}
            onPressEnter={handleSendWhatsApp}
          />
          <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
            Ingrese el número sin 0 ni 15. Mínimo 10 dígitos.
          </Text>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <Button onClick={handleCloseWspModal} disabled={wspSending}>
            Omitir
          </Button>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSendWhatsApp}
            loading={wspSending}
            style={{ background: '#25D366', borderColor: '#25D366' }}
          >
            Enviar
          </Button>
        </div>
      </div>
    </Modal>

    {/* ── Stock insuficiente — message box desktop-style ── */}
    <StockInsuficienteModal
      open={stockModalOpen}
      issues={stockValidator.issues}
      onAccept={handleStockAccept}
      onCancel={handleStockCancel}
    />

    {/* ── Cell-event modal: se dispara al escribir en la celda de cantidad ── */}
    <StockExcedidoCeldaModal
      open={cellModal !== null}
      productoNombre={cellModal?.nombre ?? ''}
      unidad={cellModal?.unidad ?? ''}
      cantidadIngresada={cellModal?.cantidadIngresada ?? 0}
      stockDisponible={cellModal?.stock ?? 0}
      onClose={handleCellModalClose}
    />

    <ProductSearchModal
      key={productSearchKey.current}
      open={productSearchOpen}
      onClose={() => {
        setProductSearchOpen(false);
        if (refocusSearchAfterProductModalClose.current) {
          setTimeout(() => searchRef.current?.focus(), 0);
        }
        refocusSearchAfterProductModalClose.current = true;
      }}
      onSelect={(products) => {
        refocusSearchAfterProductModalClose.current = false;
        products.forEach(p => addProduct(p));
      }}
      initialSearch={productSearchInitial}
      searchFn={salesApi.searchProductsAdvanced}
      marcaOptions={marcas}
      onBarcodeBalanza={(code) => {
        salesApi.getBalanzaProduct(code).then(data => {
          if (data && data.product) {
            addBalanzaProduct(data.product, data.cantidad);
            notify.success(`${data.product.NOMBRE} — ${data.cantidad.toFixed(3)} kg`);
          } else {
            notify.warning('Producto de balanza no encontrado');
          }
        }).catch(() => {
          notify.error('Error al buscar producto de balanza');
        });
      }}
    />
    </>
  );
}
