import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Modal, Input, Select, Button, InputNumber, Table, Space, Typography,
  Divider, Spin, Switch, message, Badge, Tag, Checkbox, Popover,
} from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, ShoppingCartOutlined,
  UserOutlined, MinusOutlined, ShopOutlined,
  FileTextOutlined, SwapOutlined, DollarOutlined, CreditCardOutlined,
  WalletOutlined, ArrowLeftOutlined, CheckCircleOutlined,
  WarningOutlined, BankOutlined, PrinterOutlined, WhatsAppOutlined,
  SendOutlined,
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
import { fmtMoney } from '../../utils/format';
import { printReceipt } from '../../utils/printReceipt';
import { printFETicket, openFEPdf } from '../../utils/printReceipt';
import type { ReceiptData } from '../../utils/printReceipt';
import type { VentaItemInput, ProductoSearch, VentaInput, ClienteVenta, RemitoPendiente } from '../../types';
import { ProductSearchModal } from '../ProductSearchModal';

const { Title, Text } = Typography;

type ModalStep = 'cart' | 'cobro';

interface CartItem extends VentaItemInput {
  key: string;
  NOMBRE: string;
  CODIGO: string;
  STOCK: number;
  UNIDAD: string;
  UNIDAD_NOMBRE: string;
  DESDE_REMITO?: boolean;
  LISTA_1?: number;
  LISTA_2?: number;
  LISTA_3?: number;
  LISTA_4?: number;
  LISTA_5?: number;
}

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
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clienteId, setClienteId] = useState<number>(1);
  const [depositoId, setDepositoId] = useState<number | null>(null);
  const [tipoComprobante, setTipoComprobante] = useState<string>('');
  const [esCtaCorriente, setEsCtaCorriente] = useState(false);
  const [dtoGral, setDtoGral] = useState(0);
  const [searchText, setSearchText] = useState('');
  const searchRef = useRef<any>(null);

  // Track which cart items are in grams mode (key -> true)
  const [gramosMode, setGramosMode] = useState<Record<string, boolean>>({});
  // Track which cart items are in "precio final" mode (key -> target price)
  const [precioFinalMode, setPrecioFinalMode] = useState<Record<string, boolean>>({});
  const [precioFinalValues, setPrecioFinalValues] = useState<Record<string, number>>({});

  // Payment step state
  const [step, setStep] = useState<ModalStep>('cart');
  const [selectedMetodos, setSelectedMetodos] = useState<number[]>([]);
  const [montosPorMetodo, setMontosPorMetodo] = useState<Record<number, number>>({});
  const efectivoRef = useRef<any>(null);
  const [metodoModalOpen, setMetodoModalOpen] = useState(false);
  const [metodoModalSelection, setMetodoModalSelection] = useState<number[]>([]);

  // Print / WhatsApp toggles
  const [wantPrint, setWantPrint] = useState(false);
  const [wantWhatsApp, setWantWhatsApp] = useState(false);
  const [wantFacturar, setWantFacturar] = useState(false);
  const [wantFETicket, setWantFETicket] = useState(false);
  const [wantFEPdf, setWantFEPdf] = useState(false);

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
  const [facturando, setFacturando] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchInitial, setProductSearchInitial] = useState('');
  const refocusSearchAfterProductModalClose = useRef(true);
  const productSearchKey = useRef(0);

  // ── Remitos pendientes state ──
  const [remitosPendientes, setRemitosPendientes] = useState<RemitoPendiente[]>([]);
  const [selectedRemitoIds, setSelectedRemitoIds] = useState<number[]>([]);
  const [loadingRemitos, setLoadingRemitos] = useState(false);
  const [loadingRemitoItems, setLoadingRemitoItems] = useState(false);

  // Saldo CTA CTE confirmation
  const [saldoModalOpen, setSaldoModalOpen] = useState(false);
  const [saldoInfo, setSaldoInfo] = useState<{ saldo: number; creditoDisponible: number; cobertura: 'total' | 'parcial' } | null>(null);
  const [checkingSaldo, setCheckingSaldo] = useState(false);

  // ── Check if user has an open caja ─────────────
  const [cajaCheckState, setCajaCheckState] = useState<'checking' | 'open' | 'closed'>('checking');

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

  // Pre-populate cart from pedido (mesa → venta flow)
  useEffect(() => {
    if (open && pedido && pedido.items.length > 0 && cart.length === 0) {
      setCart(pedido.items.map(item => ({
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
      })));
    }
  }, [open, pedido]);

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

  // Fetch depositos for the active punto de venta
  const { data: depositosPV = [] } = useQuery({
    queryKey: ['sales-depositos-pv', puntoVentaActivo],
    queryFn: () => salesApi.getDepositosPV(puntoVentaActivo!),
    enabled: open && !!puntoVentaActivo,
    staleTime: 60000,
  });

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

  const hayEfectivo = selectedMetodos.some(id => {
    const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
    return m?.CATEGORIA === 'EFECTIVO';
  });

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
    if (depositosPV.length > 0 && depositoId === null) {
      const preferido = depositosPV.find(d => d.ES_PREFERIDO);
      setDepositoId(preferido?.DEPOSITO_ID || depositosPV[0]?.DEPOSITO_ID || null);
    }
  }, [depositosPV, depositoId]);

  // Auto-determine tipo comprobante based on empresa IVA + client IVA
  const selectedCliente = useMemo(
    () => clientes.find((c: ClienteVenta) => c.CLIENTE_ID === clienteId),
    [clientes, clienteId]
  );

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

  // Create sale mutation
  const createMutation = useMutation({
    mutationFn: (data: VentaInput) => salesApi.create(data),
    onSuccess: async (result) => {
      // Show appropriate message based on anticipo usage
      if (result.MONTO_ANTICIPO && result.MONTO_ANTICIPO > 0) {
        if (result.COBRADA) {
          message.success(
            `Venta #${result.VENTA_ID} creada — Total: ${fmtMoney(result.TOTAL)}. Cobrada con saldo de cta corriente.`,
            5
          );
        } else {
          message.success(
            `Venta #${result.VENTA_ID} creada — Total: ${fmtMoney(result.TOTAL)}. Anticipo aplicado: ${fmtMoney(result.MONTO_ANTICIPO)}. Pendiente: ${fmtMoney(result.TOTAL - result.MONTO_ANTICIPO)}`,
            5
          );
        }
      } else {
        message.success(`Venta #${result.VENTA_ID} creada — Total: ${fmtMoney(result.TOTAL)}`);
      }

      // Track whether FE succeeded and has ticket/pdf URLs
      let feTicketUrl = '';
      let fePdfUrl = '';
      let feSuccess = false;

      // ── Post-sale: Facturación Electrónica ──
      if (wantFacturar && utilizaFE) {
        setFacturando(true);
        try {
          const feResult = await salesApi.facturar(result.VENTA_ID);
          if (feResult.success) {
            feSuccess = true;
            feTicketUrl = feResult.ticket_url || '';
            fePdfUrl = feResult.pdf_url || '';
            message.success(
              `Factura emitida: ${feResult.tipo_comprobante} Nº ${feResult.comprobante_nro} — CAE: ${feResult.cae}`,
              6
            );
          } else {
            message.error(
              `Error al facturar: ${(feResult.errores || []).join(', ') || 'Error desconocido'}`,
              8
            );
          }
        } catch (err: any) {
          message.error(`Error al emitir factura: ${err.response?.data?.error || err.message}`, 8);
        } finally {
          setFacturando(false);
        }
      }

      // ── Post-sale: FE ticket 80mm (from TusFacturas) ──
      if (feSuccess && wantFETicket && feTicketUrl) {
        printFETicket(feTicketUrl);
      }

      // ── Post-sale: FE PDF download ──
      if (feSuccess && wantFEPdf && fePdfUrl) {
        openFEPdf(fePdfUrl);
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
            subtotal: Math.round(((item.DESCUENTO > 0
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
        // Pre-fill name from selected client
        setWspNombre(selectedCliente?.NOMBRE || '');
        setWspTelefono('');
        setWspModalOpen(true);
        // Don't resetForm yet — wait for WhatsApp modal to close
        onSuccess();
        return;
      }

      // Check if the user wants to reopen the new sale form
      const reabrir = useSettingsStore.getState().getBool('reabrir_nueva_venta');
      resetForm();
      if (reabrir) {
        // Refetch sales list but keep modal open for the next sale
        queryClient.invalidateQueries({ queryKey: ['sales'] });
        // Focus product search for the next sale
        setTimeout(() => searchRef.current?.focus(), 0);
      } else {
        onSuccess();
      }
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al crear la venta');
    },
  });

  // ── Send WhatsApp ──
  const handleSendWhatsApp = async () => {
    if (!pendingVentaId || !wspTelefono.trim()) {
      message.warning('Ingrese un número de teléfono');
      return;
    }
    // Validate: at least 10 digits
    const digits = wspTelefono.replace(/\D/g, '');
    if (digits.length < 10) {
      message.warning('El teléfono debe tener al menos 10 dígitos');
      return;
    }
    setWspSending(true);
    try {
      await salesApi.sendWhatsApp(pendingVentaId, wspTelefono, wspNombre || 'Cliente');
      message.success('Detalle enviado por WhatsApp');
      setWspModalOpen(false);
      setPendingVentaId(null);
      resetForm();
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Error al enviar WhatsApp');
    } finally {
      setWspSending(false);
    }
  };

  const handleCloseWspModal = () => {
    setWspModalOpen(false);
    setPendingVentaId(null);
    resetForm();
  };

  const resetForm = useCallback(() => {
    setCart([]);
    setClienteId(1);
    setDepositoId(null);
    setTipoComprobante(comprobanteAutoValue);
    setEsCtaCorriente(false);
    setDtoGral(0);
    setSearchText('');
    setStep('cart');
    setSelectedMetodos([]);
    setMontosPorMetodo({});
    setMetodoModalOpen(false);
    setMetodoModalSelection([]);
    setWantPrint(false);
    setWantWhatsApp(false);
    setWantFacturar(false);
    setWantFETicket(false);
    setWantFEPdf(false);
    setLastAddedKey(null);
    setFacturando(false);
    setRemitosPendientes([]);
    setSelectedRemitoIds([]);
  }, [comprobanteAutoValue]);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Add product to cart
  const addProduct = useCallback((
    product: ProductoSearch,
    options?: { focusPrice?: boolean; focusSearch?: boolean }
  ) => {
    const focusPrice = options?.focusPrice !== false;
    const focusSearch = options?.focusSearch === true;

    setCart(prev => {
      const existing = prev.find(i => i.PRODUCTO_ID === product.PRODUCTO_ID);
      if (existing) {
        return prev.map(i =>
          i.PRODUCTO_ID === product.PRODUCTO_ID
            ? { ...i, CANTIDAD: i.CANTIDAD + 1 }
            : i
        );
      }
      const isKg = (product.UNIDAD_NOMBRE || '').toUpperCase().includes('KILOGRAMO');
      const isLt = (product.UNIDAD_NOMBRE || '').toUpperCase().includes('LITRO');
      const isWeightOrVolume = isKg || isLt;
      const newKey = `${product.PRODUCTO_ID}-${Date.now()}`;
      setLastAddedKey(focusPrice ? newKey : null);
      return [...prev, {
        key: newKey,
        PRODUCTO_ID: product.PRODUCTO_ID,
        NOMBRE: product.NOMBRE,
        CODIGO: product.CODIGOPARTICULAR,
        PRECIO_UNITARIO: product.PRECIO_VENTA,
        CANTIDAD: isWeightOrVolume ? 0 : 1,
        DESCUENTO: 0,
        PRECIO_COMPRA: product.PRECIO_COMPRA || 0,
        STOCK: product.STOCK,
        UNIDAD: product.UNIDAD_ABREVIACION || 'u',
        UNIDAD_NOMBRE: product.UNIDAD_NOMBRE || '',
        DEPOSITO_ID: depositoId || undefined,
        LISTA_ID: product.LISTA_DEFECTO || 1,
        LISTA_1: product.LISTA_1,
        LISTA_2: product.LISTA_2,
        LISTA_3: product.LISTA_3,
        LISTA_4: product.LISTA_4,
        LISTA_5: product.LISTA_5,
      }];
    });
    setSearchText('');
    if (focusSearch) {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [depositoId]);

  // Add product from barcode balanza with pre-set quantity (weight)
  // Does NOT set lastAddedKey so the search input stays focused for the next scan
  const addBalanzaProduct = useCallback((product: ProductoSearch, cantidad: number) => {
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
        DEPOSITO_ID: depositoId || undefined,
        LISTA_ID: product.LISTA_DEFECTO || 1,
        LISTA_1: product.LISTA_1,
        LISTA_2: product.LISTA_2,
        LISTA_3: product.LISTA_3,
        LISTA_4: product.LISTA_4,
        LISTA_5: product.LISTA_5,
      }];
    });
    setSearchText('');
    setTimeout(() => searchRef.current?.focus(), 0);
  }, [depositoId]);

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
            DEPOSITO_ID: item.DEPOSITO_ID || depositoId || undefined,
            LISTA_ID: 1,
            DESDE_REMITO: true,
          });
        }
      }
      setCart(allItems);
      setSelectedRemitoIds(remitoIds);
      message.success(`Se cargaron ${allItems.length} producto(s) desde ${remitoIds.length} remito(s)`);
    } catch (err: any) {
      message.error('Error al cargar productos del remito');
    } finally {
      setLoadingRemitoItems(false);
    }
  }, [depositoId]);

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

  // On Enter: barcode balanza → auto-add; single match → auto-add; otherwise → open advanced search modal
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const text = searchText.trim();
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    if (searchTimeout.current) clearTimeout(searchTimeout.current);

    // ── Barcode balanza detection ──
    if (isBalanzaBarcode(text)) {
      salesApi.getBalanzaProduct(text).then(data => {
        if (data && data.product) {
          addBalanzaProduct(data.product, data.cantidad);
          message.success(
            `${data.product.NOMBRE} — ${data.cantidad.toFixed(3)} kg`
          );
        } else {
          message.warning('Producto de balanza no encontrado');
        }
      }).catch(() => {
        message.error('Error al buscar producto de balanza');
      });
      return;
    }

    const isNormalBarcode = /^\d{6,}$/.test(text);

    // Quick search — if exactly 1 match or exact code, add directly; otherwise open modal
    salesApi.searchProducts(text).then(products => {
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
    });
  }, [searchText, addProduct, addBalanzaProduct]);

  const updateCartItem = (key: string, field: string, value: any) => {
    setCart(prev => prev.map(item =>
      item.key === key ? { ...item, [field]: value } : item
    ));
  };

  const removeCartItem = (key: string) => {
    setCart(prev => prev.filter(item => item.key !== key));
  };

  const getListPrice = (item: CartItem, listaId: number): number => {
    const map: Record<number, number | undefined> = {
      1: item.LISTA_1, 2: item.LISTA_2, 3: item.LISTA_3,
      4: item.LISTA_4, 5: item.LISTA_5,
    };
    return map[listaId] ?? item.PRECIO_UNITARIO;
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
    const precio = item.DESCUENTO > 0
      ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
      : item.PRECIO_UNITARIO;
    return sum + precio * item.CANTIDAD;
  }, 0) * 100) / 100;

  const descuentoMonto = Math.round((dtoGral > 0 ? subtotal * (dtoGral / 100) : 0) * 100) / 100;
  const total = Math.round((subtotal - descuentoMonto) * 100) / 100;

  // Submit sale
  const handleSubmit = async (cobrar: boolean) => {
    if (cart.length === 0) {
      message.warning('Agregue al menos un producto');
      return;
    }

    if (cobrar) {
      // Open payment method selection modal
      const initialSelection = selectedMetodos.length > 0
        ? [...selectedMetodos]
        : (defaultMetodoEfectivoId ? [defaultMetodoEfectivoId] : []);
      setMetodoModalSelection(initialSelection);
      setMetodoModalOpen(true);
      return;
    }

    // CTA CTE: check saldo before saving
    if (esCtaCorriente) {
      setCheckingSaldo(true);
      try {
        const { saldo } = await salesApi.getSaldoCtaCte(clienteId);
        // saldo < 0 means client has credit
        if (saldo < 0) {
          const creditoDisponible = Math.abs(saldo);
          const cobertura = creditoDisponible >= total ? 'total' : 'parcial';
          setSaldoInfo({ saldo, creditoDisponible, cobertura });
          setSaldoModalOpen(true);
          setCheckingSaldo(false);
          return; // Wait for user confirmation
        }
      } catch {
        // Ignore saldo check errors, proceed without anticipo
      } finally {
        setCheckingSaldo(false);
      }
    }

    // Save as pending (cta corriente) — no saldo disponible
    doSaveCtaCte();
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
      items: cart.map(({ PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID, DESDE_REMITO }) => ({
        PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID,
        ...(DESDE_REMITO ? { DESDE_REMITO: true } : {}),
      })),
      ...(pedido ? { PEDIDO_ID: pedido.PEDIDO_ID, MESA_ID: pedido.MESA_ID } : {}),
      ...(selectedRemitoIds.length > 0 ? { REMITO_IDS: selectedRemitoIds } : {}),
    };
    createMutation.mutate(input);
  };

  // Payment step logic
  const vuelto = useMemo(() => {
    if (selectedMetodos.length === 0) return 0;
    // Only effective cash methods can produce change
    if (soloEfectivo) return Math.max(0, totalRecibido - total);
    if (hayEfectivo) {
      // Mixed: only if total received > total, change comes from efectivo
      return Math.max(0, totalRecibido - total);
    }
    return 0; // all digital: no change
  }, [selectedMetodos, totalRecibido, total, soloEfectivo, hayEfectivo]);

  const pagoValido = useMemo(() => {
    if (selectedMetodos.length === 0 || totalRecibido <= 0) return false;
    if (soloEfectivo) return totalRecibido >= total;
    if (soloDigital) return Math.abs(totalRecibido - total) < 0.01;
    // Mixed: efectivo can cover the excess (change), but total must be >= total
    if (hayEfectivo) return totalRecibido >= total;
    return Math.abs(totalRecibido - total) < 0.01;
  }, [selectedMetodos, totalRecibido, total, soloEfectivo, soloDigital, hayEfectivo]);

  const handleConfirmCobro = () => {
    if (!pagoValido) return;

    const vueltoFinal = vuelto;

    // Build metodos_pago array — adjust efectivo amounts to subtract change
    const metodosPagoInput = selectedMetodos
      .filter(id => (montosPorMetodo[id] || 0) > 0)
      .map(id => {
        const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
        let monto = montosPorMetodo[id] || 0;
        // If only one efectivo method and there's change, store the sale amount
        if (m?.CATEGORIA === 'EFECTIVO' && vueltoFinal > 0 && soloEfectivo) {
          monto = monto - vueltoFinal;
        }
        return { METODO_PAGO_ID: id, MONTO: monto };
      })
      .filter(mp => mp.MONTO > 0);

    // Derive category totals
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
      items: cart.map(({ PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID, DESDE_REMITO }) => ({
        PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID,
        ...(DESDE_REMITO ? { DESDE_REMITO: true } : {}),
      })),
      metodos_pago: metodosPagoInput,
      ...(pedido ? { PEDIDO_ID: pedido.PEDIDO_ID, MESA_ID: pedido.MESA_ID } : {}),
      ...(selectedRemitoIds.length > 0 ? { REMITO_IDS: selectedRemitoIds } : {}),
    };
    createMutation.mutate(input);
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
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, step, cart.length, pagoValido]);

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
        const hasListPrices = record.LISTA_1 != null;
        return (
          <div className="nsm-cart-product">
            <div className="nsm-cart-product-name">{name}</div>
            <div className="nsm-cart-product-meta">
              <span className="nsm-cart-product-code">{record.CODIGO}</span>
              {unitTag && <span className="nsm-cart-product-unit-tag">{unitTag}</span>}
              <span className="nsm-cart-product-stock">Stock: {record.STOCK} {record.UNIDAD}</span>
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
                const qty = Math.round((pf / newPrice) * 10000) / 10000;
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

        const handleChange = (v: number | null) => {
          const raw = v ?? (inGramos ? 0 : 1);
          const finalVal = inGramos ? raw / 1000 : raw;
          updateCartItem(record.key, 'CANTIDAD', Math.max(0, finalVal));
          if (inPrecioFinal && record.PRECIO_UNITARIO > 0) {
            const newTotal = finalVal * record.PRECIO_UNITARIO;
            setPrecioFinalValues(prev => ({ ...prev, [record.key]: Math.round(newTotal * 100) / 100 }));
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
          updateCartItem(record.key, 'CANTIDAD', newVal);
          if (inPrecioFinal) setPrecioFinalValues(prev => ({ ...prev, [record.key]: Math.round(newVal * record.PRECIO_UNITARIO * 100) / 100 }));
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
                onChange={(v) => updateCartItem(record.key, 'CANTIDAD', v || 1)}
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
            const qty = Math.round(rawQty * 10000) / 10000;
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
      destroyOnClose
      closable={false}
      className="new-sale-modal"
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
                  <Tag color="default" style={{ margin: 0, fontSize: 11, opacity: 0.45 }}>Enter</Tag>
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

        {/* ══ RIGHT COLUMN — Config / Cobro ═══════ */}
        <div className="nsm-sidebar">
          {step === 'cart' ? (
            /* ── STEP 1: Cart configuration ───────── */
            <>
              <div className="npm-sidebar-scroll">
              {/* Client */}
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
                  size="large"
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
                    Remitos pendientes de facturar
                    <Badge count={remitosPendientes.length} style={{ backgroundColor: '#1677ff', marginLeft: 8 }} />
                  </label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
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
                            padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
                            border: isSelected ? '2px solid #1677ff' : '1px solid #d9d9d9',
                            background: isSelected ? 'rgba(22, 119, 255, 0.06)' : 'transparent',
                            transition: 'all 0.15s',
                          }}
                        >
                          <div>
                            <Text strong style={{ fontSize: 13 }}>
                              R {String(r.PTO_VTA).padStart(4, '0')}-{String(r.NRO_REMITO).padStart(8, '0')}
                            </Text>
                            <br />
                            <Text type="secondary" style={{ fontSize: 11 }}>
                              {new Date(r.FECHA).toLocaleDateString('es-AR')}
                            </Text>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <Text strong style={{ fontSize: 13 }}>{fmtMoney(r.TOTAL)}</Text>
                            {isSelected && <CheckCircleOutlined style={{ color: '#1677ff', marginLeft: 8 }} />}
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
                    style={{ marginTop: 8 }}
                  >
                    Cargar {selectedRemitoIds.length > 0 ? `${selectedRemitoIds.length} remito(s)` : 'remitos'} en la venta
                  </Button>
                </div>
              )}

              {/* Deposito */}
              <div className="nsm-field-group">
                <label className="nsm-label">
                  <ShopOutlined style={{ marginRight: 6 }} />
                  Depósito
                </label>
                <Select
                  placeholder="Depósito"
                  style={{ width: '100%' }}
                  value={depositoId}
                  onChange={setDepositoId}
                  size="large"
                  options={depositosPV.map(d => ({
                    value: d.DEPOSITO_ID,
                    label: d.NOMBRE,
                  }))}
                />
              </div>

              {/* Comprobante */}
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
                  size="large"
                  options={comprobanteOptions}
                />
              </div>

              {/* Cta Corriente switch — only enabled if customer has CTA_CORRIENTE */}
              <div className="nsm-field-group">
                <div className="nsm-switch-row">
                  <Switch
                    size="default"
                    checked={esCtaCorriente}
                    onChange={setEsCtaCorriente}
                    disabled={!clienteTieneCtaCte}
                  />
                  <span className="nsm-switch-label" style={{ opacity: clienteTieneCtaCte ? 1 : 0.45 }}>
                    <SwapOutlined style={{ marginRight: 6 }} />
                    Cuenta Corriente
                  </span>
                </div>
              </div>

              {/* Dto general */}
              <div className="nsm-field-group">
                <label className="nsm-label">Descuento General %</label>
                <InputNumber
                  value={dtoGral}
                  min={0}
                  max={100}
                  size="large"
                  style={{ width: '100%' }}
                  onChange={(v) => setDtoGral(v || 0)}
                />
              </div>

              <Divider style={{ margin: '10px 0' }} />

              {/* Stats */}
              <div className="nsm-stats">
                <div className="nsm-stat">
                  <Text type="secondary" style={{ fontSize: 12 }}>Ítems</Text>
                  <Badge
                    count={totalItems}
                    showZero
                    style={{ backgroundColor: totalItems > 0 ? '#EABD23' : '#d9d9d9', color: '#1E1F22', fontWeight: 600 }}
                  />
                </div>
                <div className="nsm-stat">
                  <Text type="secondary" style={{ fontSize: 12 }}>Unidades</Text>
                  <Badge
                    count={totalUnits}
                    showZero
                    style={{ backgroundColor: totalUnits > 0 ? '#EABD23' : '#d9d9d9', color: '#1E1F22', fontWeight: 600 }}
                  />
                </div>
              </div>
              </div>{/* /npm-sidebar-scroll */}

              {/* Totals */}
              <div className="nsm-totals-box">
                {dtoGral > 0 && (
                  <>
                    <div className="nsm-total-line">
                      <Text type="secondary">Subtotal</Text>
                      <Text>{fmtMoney(subtotal)}</Text>
                    </div>
                    <div className="nsm-total-line">
                      <Text type="secondary">Dto. {dtoGral}%</Text>
                      <Text type="danger">- {fmtMoney(descuentoMonto)}</Text>
                    </div>
                    <Divider style={{ margin: '8px 0' }} />
                  </>
                )}
                <div className="nsm-total-final">
                  <span>TOTAL</span>
                  <span className="nsm-total-amount">{fmtMoney(total)}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="nsm-actions">
                {esCtaCorriente && (
                  <>
                    {/* Print & FE options inline for CTA CTE (payment step is skipped) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
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
                                checked={wantFETicket}
                                onChange={e => setWantFETicket(e.target.checked)}
                              >
                                <Space size={6}>
                                  <PrinterOutlined />
                                  <span>Descargar ticket 80mm</span>
                                </Space>
                              </Checkbox>
                              <Checkbox
                                checked={wantFEPdf}
                                onChange={e => setWantFEPdf(e.target.checked)}
                              >
                                <Space size={6}>
                                  <FileTextOutlined style={{ color: '#ff4d4f' }} />
                                  <span>Descargar PDF</span>
                                </Space>
                              </Checkbox>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <Button
                      block
                      size="large"
                      onClick={() => handleSubmit(false)}
                      loading={createMutation.isPending || checkingSaldo}
                      disabled={cart.length === 0}
                      style={{ height: 48 }}
                    >
                      Guardar (Cobro Pendiente)
                    </Button>
                  </>
                )}
                {!esCtaCorriente && (
                  <Button
                    type="primary"
                    block
                    size="large"
                    className="btn-gold nsm-btn-cobrar"
                    onClick={() => handleSubmit(true)}
                    loading={createMutation.isPending}
                    disabled={cart.length === 0}
                    icon={<ShoppingCartOutlined />}
                  >
                    Cobrar {fmtMoney(total)}
                  </Button>
                )}
              </div>
            </>
          ) : (
            /* ── STEP 2: Payment / Cobro ──────────── */
            <>
              <div className="npm-sidebar-scroll">
              {/* Total a cobrar - prominent */}
              <div className="nsm-cobro-total-box">
                <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Total a cobrar
                </Text>
                <div className="nsm-cobro-total-amount">{fmtMoney(total)}</div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {totalItems} ítem{totalItems !== 1 ? 's' : ''} · {totalUnits} unidad{totalUnits !== 1 ? 'es' : ''}
                </Text>
              </div>

              <Divider style={{ margin: '16px 0' }} />

              {/* Selected payment methods summary */}
              <div className="nsm-field-group">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label className="nsm-label" style={{ margin: 0 }}>Método de pago</label>
                  <Button type="link" size="small" onClick={() => {
                    setMetodoModalSelection([...selectedMetodos]);
                    setMetodoModalOpen(true);
                  }}>Cambiar</Button>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {selectedMetodos.map(id => {
                    const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                    if (!m) return null;
                    return (
                      <Tag key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', fontSize: 13 }}>
                        {m.IMAGEN_BASE64 ? (
                          <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 16, height: 16, objectFit: 'contain', borderRadius: 2 }} />
                        ) : (
                          m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined /> : <CreditCardOutlined />
                        )}
                        {m.NOMBRE}
                      </Tag>
                    );
                  })}
                </div>
              </div>

              {/* Amount inputs per selected method */}
              {selectedMetodos.length > 1 && selectedMetodos.map(id => {
                const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                if (!m) return null;
                return (
                  <div className="nsm-field-group" key={id}>
                    <label className="nsm-label">
                      {m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined style={{ marginRight: 6 }} /> : <CreditCardOutlined style={{ marginRight: 6 }} />}
                      {m.NOMBRE}
                    </label>
                    <InputNumber
                      value={montosPorMetodo[id] || 0}
                      min={0}
                      step={100}
                      size="large"
                      style={{ width: '100%' }}
                      formatter={v => `$ ${v}`}
                      onChange={v => setMontosPorMetodo(prev => ({ ...prev, [id]: v || 0 }))}
                    />
                  </div>
                );
              })}

              {/* Single method selected: one editable input */}
              {selectedMetodos.length === 1 && (() => {
                const id = selectedMetodos[0]!;
                const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
                if (!m) return null;
                return (
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
                      size="large"
                      style={{ width: '100%' }}
                      formatter={v => `$ ${v}`}
                      onChange={v => setMontosPorMetodo(prev => ({ ...prev, [id]: v || 0 }))}
                      autoFocus
                      onPressEnter={() => {
                        if (pagoValido) handleConfirmCobro();
                      }}
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
                );
              })()}

              <Divider style={{ margin: '12px 0' }} />

              {/* Payment summary */}
              <div className="nsm-cobro-summary">
                <div className="nsm-cobro-line">
                  <Text type="secondary">Total recibido</Text>
                  <Text strong>{fmtMoney(totalRecibido)}</Text>
                </div>
                <div className="nsm-cobro-line">
                  <Text type="secondary">Total a abonar</Text>
                  <Text strong>{fmtMoney(total)}</Text>
                </div>
                {vuelto > 0 && (
                  <div className="nsm-cobro-vuelto">
                    <Text strong>Vuelto</Text>
                    <Text strong className="nsm-cobro-vuelto-amount">{fmtMoney(vuelto)}</Text>
                  </div>
                )}
                {!soloEfectivo && totalRecibido > 0 && Math.abs(totalRecibido - total) >= 0.01 && (
                  <div style={{ marginTop: 8 }}>
                    <Text type="danger" style={{ fontSize: 12 }}>
                      {totalRecibido < total
                        ? `Faltan ${fmtMoney(total - totalRecibido)}`
                        : `Exceso de ${fmtMoney(totalRecibido - total)} — el monto debe ser exacto`
                      }
                    </Text>
                  </div>
                )}
              </div>

              {/* Print / WhatsApp toggles */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '12px 0' }}>
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
                {wantFacturar && (
                  <div style={{ marginLeft: 24, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <Checkbox
                      checked={wantFETicket}
                      onChange={e => setWantFETicket(e.target.checked)}
                    >
                      <Space size={6}>
                        <PrinterOutlined />
                        <span>Descargar ticket 80mm</span>
                      </Space>
                    </Checkbox>
                    <Checkbox
                      checked={wantFEPdf}
                      onChange={e => setWantFEPdf(e.target.checked)}
                    >
                      <Space size={6}>
                        <FileTextOutlined />
                        <span>Descargar PDF</span>
                      </Space>
                    </Checkbox>
                  </div>
                )}
              </div>
              </div>{/* /npm-sidebar-scroll */}

              {/* Cobro action buttons */}
              <div className="nsm-actions">
                <Button
                  type="primary"
                  block
                  size="large"
                  className="btn-gold nsm-btn-cobrar"
                  onClick={handleConfirmCobro}
                  loading={createMutation.isPending || facturando}
                  disabled={!pagoValido}
                  icon={<CheckCircleOutlined />}
                >
                  Confirmar Cobro
                </Button>
                <Button
                  block
                  size="large"
                  onClick={() => setStep('cart')}
                  icon={<ArrowLeftOutlined />}
                  style={{ height: 44 }}
                >
                  Volver al carrito
                </Button>
              </div>
            </>
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
      title={
        <Space>
          <WalletOutlined style={{ color: '#EABD23', fontSize: 20 }} />
          <span>Seleccionar método de pago</span>
        </Space>
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {metodosPagoOrdenados.map(m => {
            const isSelected = metodoModalSelection.includes(m.METODO_PAGO_ID);
            return (
              <div
                key={m.METODO_PAGO_ID}
                onClick={(e: React.MouseEvent) => {
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
                  padding: '16px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                  border: isSelected ? '2px solid #EABD23' : '1px solid #d9d9d9',
                  background: isSelected ? 'rgba(234, 189, 35, 0.08)' : 'transparent',
                  transition: 'all 0.15s', position: 'relative',
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
        <Space>
          <WalletOutlined style={{ color: '#52c41a', fontSize: 20 }} />
          <span>Saldo disponible en cuenta corriente</span>
        </Space>
      }
      onCancel={() => { setSaldoModalOpen(false); setSaldoInfo(null); }}
      centered
      width={460}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={() => { setSaldoModalOpen(false); setSaldoInfo(null); }}>
            Cancelar
          </Button>
          <Button
            type="primary"
            onClick={doSaveCtaCte}
            loading={createMutation.isPending}
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
        <Space>
          <WhatsAppOutlined style={{ color: '#25D366', fontSize: 20 }} />
          <span>Enviar detalle por WhatsApp</span>
        </Space>
      }
      onCancel={handleCloseWspModal}
      footer={null}
      centered
      width={420}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4 }}>Nombre del cliente</Text>
          <Input
            value={wspNombre}
            onChange={e => setWspNombre(e.target.value)}
            placeholder="Nombre"
            prefix={<UserOutlined />}
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
      onBarcodeBalanza={(code) => {
        salesApi.getBalanzaProduct(code).then(data => {
          if (data && data.product) {
            addBalanzaProduct(data.product, data.cantidad);
            message.success(`${data.product.NOMBRE} — ${data.cantidad.toFixed(3)} kg`);
          } else {
            message.warning('Producto de balanza no encontrado');
          }
        }).catch(() => {
          message.error('Error al buscar producto de balanza');
        });
      }}
    />
    </>
  );
}
