import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Modal, Input, Select, Button, InputNumber, Table, Space, Typography,
  Divider, Spin, Switch, message, AutoComplete, Badge, Tag, Checkbox,
} from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, ShoppingCartOutlined,
  UserOutlined, MinusOutlined, BarcodeOutlined, ShopOutlined,
  FileTextOutlined, SwapOutlined, DollarOutlined, CreditCardOutlined,
  WalletOutlined, ArrowLeftOutlined, CheckCircleOutlined,
  WarningOutlined, BankOutlined, PrinterOutlined, WhatsAppOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { salesApi } from '../../services/sales.api';
import { cajaApi } from '../../services/caja.api';
import { useAuthStore } from '../../store/authStore';
import { useTabStore } from '../../store/tabStore';
import { fmtMoney } from '../../utils/format';
import { printReceipt } from '../../utils/printReceipt';
import { printFETicket, openFEPdf } from '../../utils/printReceipt';
import type { ReceiptData } from '../../utils/printReceipt';
import type { VentaItemInput, ProductoSearch, VentaInput, ClienteVenta } from '../../types';

const { Title, Text } = Typography;

type ModalStep = 'cart' | 'cobro';
type MetodoPago = 'efectivo' | 'digital' | 'mixto';

interface CartItem extends VentaItemInput {
  key: string;
  NOMBRE: string;
  CODIGO: string;
  STOCK: number;
  UNIDAD: string;
  UNIDAD_NOMBRE: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function NewSaleModal({ open, onClose, onSuccess }: Props) {
  const navigate = useNavigate();
  const openTab = useTabStore(s => s.openTab);
  const { puntoVentaActivo, user } = useAuthStore();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clienteId, setClienteId] = useState<number>(1);
  const [depositoId, setDepositoId] = useState<number | null>(null);
  const [tipoComprobante, setTipoComprobante] = useState<string>('');
  const [esCtaCorriente, setEsCtaCorriente] = useState(false);
  const [dtoGral, setDtoGral] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [searchOptions, setSearchOptions] = useState<{ value: string; label: React.ReactNode; product: ProductoSearch }[]>([]);
  const searchRef = useRef<any>(null);

  // Track which cart items are in grams mode (key -> true)
  const [gramosMode, setGramosMode] = useState<Record<string, boolean>>({});
  // Track which cart items are in "precio final" mode (key -> target price)
  const [precioFinalMode, setPrecioFinalMode] = useState<Record<string, boolean>>({});
  const [precioFinalValues, setPrecioFinalValues] = useState<Record<string, number>>({});

  // Payment step state
  const [step, setStep] = useState<ModalStep>('cart');
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo');
  const [pagoEfectivo, setPagoEfectivo] = useState(0);
  const [pagoDigital, setPagoDigital] = useState(0);
  const efectivoRef = useRef<any>(null);

  // Print / WhatsApp toggles
  const [wantPrint, setWantPrint] = useState(true);
  const [wantWhatsApp, setWantWhatsApp] = useState(false);
  const [wantFacturar, setWantFacturar] = useState(false);
  const [wantFETicket, setWantFETicket] = useState(true);
  const [wantFEPdf, setWantFEPdf] = useState(false);
  const [wspModalOpen, setWspModalOpen] = useState(false);
  const [wspTelefono, setWspTelefono] = useState('');
  const [wspNombre, setWspNombre] = useState('');
  const [wspSending, setWspSending] = useState(false);
  const [pendingVentaId, setPendingVentaId] = useState<number | null>(null);
  const [facturando, setFacturando] = useState(false);

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

  const handleGoToCaja = () => {
    handleClose();
    openTab({ key: '/cashregisters', label: 'Cajas', closable: true });
    navigate('/cashregisters');
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

  const utilizaFE = feConfig?.utilizaFE === true;

  // Auto-enable facturar toggle when FE is active
  useEffect(() => {
    if (utilizaFE) setWantFacturar(true);
  }, [utilizaFE]);

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

  const comprobanteOptions = useMemo(() => {
    if (esMonotributo) {
      return [{ value: 'Fa.C', label: 'Factura C' }];
    }
    return [
      { value: 'Fa.A', label: 'Factura A' },
      { value: 'Fa.B', label: 'Factura B' },
      { value: 'Fa.C', label: 'Factura C' },
    ];
  }, [esMonotributo]);

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

  // Product search
  const { mutate: doSearch, isPending: searching } = useMutation({
    mutationFn: (text: string) => salesApi.searchProducts(text),
    onSuccess: (products) => {
      setSearchOptions(
        products.map(p => ({
          value: `${p.PRODUCTO_ID}`,
          label: (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Text strong style={{ fontSize: 13 }}>{p.NOMBRE}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 11 }}>{p.CODIGOPARTICULAR} · Stock: {p.STOCK} {p.UNIDAD_ABREVIACION}</Text>
              </div>
              <Text strong style={{ color: '#EABD23' }}>{fmtMoney(p.PRECIO_VENTA)}</Text>
            </div>
          ),
          product: p,
        }))
      );
    },
  });

  // Create sale mutation
  const createMutation = useMutation({
    mutationFn: (data: VentaInput) => salesApi.create(data),
    onSuccess: async (result) => {
      message.success(`Venta #${result.VENTA_ID} creada — Total: ${fmtMoney(result.TOTAL)}`);

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
            subtotal: (item.DESCUENTO > 0
              ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
              : item.PRECIO_UNITARIO) * item.CANTIDAD,
          })),
          dtoGral,
          subtotal,
          total,
          esCtaCorriente,
          montoEfectivo: metodoPago === 'digital' ? 0 : pagoEfectivo,
          montoDigital: metodoPago === 'efectivo' ? 0 : pagoDigital,
          vuelto: vuelto,
          metodoPago: step === 'cobro' ? metodoPago : undefined,
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

      resetForm();
      onSuccess();
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
    setSearchOptions([]);
    setStep('cart');
    setMetodoPago('efectivo');
    setPagoEfectivo(0);
    setPagoDigital(0);
    setWantPrint(true);
    setWantWhatsApp(false);
    setWantFacturar(utilizaFE);
    setWantFETicket(true);
    setWantFEPdf(false);
    setFacturando(false);
  }, [utilizaFE, comprobanteAutoValue]);

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Search handler with debounce
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = (text: string) => {
    setSearchText(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (text.length >= 1) {
      searchTimeout.current = setTimeout(() => doSearch(text), 300);
    } else {
      setSearchOptions([]);
    }
  };

  // Add product to cart
  const addProduct = useCallback((product: ProductoSearch) => {
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
      return [...prev, {
        key: `${product.PRODUCTO_ID}-${Date.now()}`,
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
      }];
    });
    setSearchText('');
    setSearchOptions([]);
    setTimeout(() => searchRef.current?.focus(), 100);
  }, [depositoId]);

  // Barcode quick-pick: on Enter, search immediately and auto-add if single result
  // If dropdown is already showing options, let AutoComplete handle the selection natively
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    // If dropdown has options visible, let AutoComplete's onSelect handle it
    if (searchOptions.length > 0) return;
    const text = searchText.trim();
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    // Cancel any pending debounced search
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    // Immediate search — if exactly 1 product matches, add it directly
    salesApi.searchProducts(text).then(products => {
      if (products.length === 1) {
        addProduct(products[0]!);
      } else if (products.length > 1) {
        // Check for exact barcode/code match among results
        const exact = products.find(
          p => p.CODIGOPARTICULAR?.toUpperCase() === text.toUpperCase()
        );
        if (exact) {
          addProduct(exact);
        } else {
          // Multiple results, no exact match: just show them in dropdown
          doSearch(text);
        }
      } else {
        message.warning('No se encontró ningún producto');
      }
    });
  }, [searchText, searchOptions, addProduct, doSearch]);

  const updateCartItem = (key: string, field: string, value: any) => {
    setCart(prev => prev.map(item =>
      item.key === key ? { ...item, [field]: value } : item
    ));
  };

  const removeCartItem = (key: string) => {
    setCart(prev => prev.filter(item => item.key !== key));
  };

  // Calculate totals
  const subtotal = cart.reduce((sum, item) => {
    const precio = item.DESCUENTO > 0
      ? item.PRECIO_UNITARIO * (1 - item.DESCUENTO / 100)
      : item.PRECIO_UNITARIO;
    return sum + precio * item.CANTIDAD;
  }, 0);

  const descuentoMonto = dtoGral > 0 ? subtotal * (dtoGral / 100) : 0;
  const total = subtotal - descuentoMonto;

  // Submit sale
  const handleSubmit = (cobrar: boolean) => {
    if (cart.length === 0) {
      message.warning('Agregue al menos un producto');
      return;
    }

    if (cobrar) {
      // Transition to payment step
      setPagoEfectivo(total);
      setPagoDigital(0);
      setMetodoPago('efectivo');
      setStep('cobro');
      return;
    }

    // Save as pending (cta corriente)
    const input: VentaInput = {
      CLIENTE_ID: clienteId,
      PUNTO_VENTA_ID: puntoVentaActivo || 1,
      TIPO_COMPROBANTE: tipoComprobante || comprobanteAutoValue,
      ES_CTA_CORRIENTE: esCtaCorriente,
      DTO_GRAL: dtoGral,
      COBRADA: false,
      MONTO_EFECTIVO: 0,
      MONTO_DIGITAL: 0,
      VUELTO: 0,
      items: cart.map(({ PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID }) => ({
        PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID,
      })),
    };
    createMutation.mutate(input);
  };

  // Payment step logic
  const vuelto = useMemo(() => {
    if (metodoPago === 'efectivo') return Math.max(0, pagoEfectivo - total);
    if (metodoPago === 'mixto') return Math.max(0, (pagoEfectivo + pagoDigital) - total);
    return 0; // digital: no change
  }, [metodoPago, pagoEfectivo, pagoDigital, total]);

  const pagoValido = useMemo(() => {
    const recibido = pagoEfectivo + pagoDigital;
    if (recibido <= 0) return false;

    if (metodoPago === 'efectivo') {
      return pagoEfectivo >= total;
    }
    if (metodoPago === 'digital') {
      // Digital must be exact
      return Math.abs(pagoDigital - total) < 0.01;
    }
    // Mixto: must be exact (no change)
    return Math.abs(recibido - total) < 0.01;
  }, [metodoPago, pagoEfectivo, pagoDigital, total]);

  const handleConfirmCobro = () => {
    if (!pagoValido) return;

    // Determine real amounts stored
    let efectivoFinal = pagoEfectivo;
    let digitalFinal = pagoDigital;
    let vueltoFinal = 0;

    if (metodoPago === 'efectivo') {
      efectivoFinal = total; // store the sale amount, not what was given
      digitalFinal = 0;
      vueltoFinal = Math.max(0, pagoEfectivo - total);
    } else if (metodoPago === 'digital') {
      efectivoFinal = 0;
      digitalFinal = total;
      vueltoFinal = 0;
    } else {
      // mixto: exact split
      vueltoFinal = 0;
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
      items: cart.map(({ PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID }) => ({
        PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID,
      })),
    };
    createMutation.mutate(input);
  };

  // When payment method changes, auto-fill amounts
  useEffect(() => {
    if (step !== 'cobro') return;
    if (metodoPago === 'efectivo') {
      setPagoEfectivo(total);
      setPagoDigital(0);
    } else if (metodoPago === 'digital') {
      setPagoEfectivo(0);
      setPagoDigital(total);
    } else {
      // mixto: don't auto-fill, let user split
      setPagoEfectivo(0);
      setPagoDigital(0);
    }
  }, [metodoPago, step, total]);

  // Handle keyboard shortcut for search focus
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  const cartColumns = [
    {
      title: 'PRODUCTO', dataIndex: 'NOMBRE', key: 'name', ellipsis: true,
      render: (name: string, record: CartItem) => (
        <div style={{ padding: '4px 0' }}>
          <Text strong style={{ fontSize: 14 }}>{name}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>{record.CODIGO}</Text>
        </div>
      ),
    },
    {
      title: 'P. UNIT.', dataIndex: 'PRECIO_UNITARIO', key: 'price', width: 140,
      render: (val: number, record: CartItem) => (
        <InputNumber
          value={val}
          min={0}
          step={0.01}
          size="middle"
          style={{ width: '100%' }}
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
        />
      ),
    },
    {
      title: 'CANT.', dataIndex: 'CANTIDAD', key: 'qty', width: 220,
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
                style={{ borderColor: '#d9d9d9' }}
              />
              <InputNumber value={val} min={0.01} step={1} size="middle" style={{ width: 64 }}
                onChange={(v) => updateCartItem(record.key, 'CANTIDAD', v || 1)} />
              <Button size="small" icon={<PlusOutlined />}
                onClick={() => handleStep(1)}
                style={{ borderColor: '#d9d9d9' }}
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
                  style={{ borderColor: '#d9d9d9' }}
                />
                <InputNumber
                  value={inGramos ? displayVal : val}
                  min={0}
                  step={step}
                  size="middle"
                  style={{ width: 90 }}
                  precision={inGramos ? 0 : 3}
                  onChange={handleChange}
                />
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{inGramos ? 'g' : unitLabel}</Text>
                <Button size="small" icon={<PlusOutlined />}
                  onClick={() => handleStep(inGramos ? 10 : 1)}
                  style={{ borderColor: '#d9d9d9' }}
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
      title: 'DTO %', dataIndex: 'DESCUENTO', key: 'discount', width: 90,
      render: (val: number, record: CartItem) => (
        <InputNumber value={val} min={0} max={100} size="middle" style={{ width: '100%' }}
          onChange={(v) => updateCartItem(record.key, 'DESCUENTO', v || 0)} />
      ),
    },
    {
      title: 'SUBTOTAL', key: 'sub', width: 150, align: 'right' as const,
      render: (_: unknown, record: CartItem) => {
        const upperUnidad = (record.UNIDAD_NOMBRE || '').toUpperCase();
        const isKg = upperUnidad.includes('KILOGRAMO');
        const isLt = upperUnidad.includes('LITRO');
        const isWeightOrVolume = isKg || isLt;
        const inPrecioFinal = isWeightOrVolume && precioFinalMode[record.key];

        const precio = record.DESCUENTO > 0
          ? record.PRECIO_UNITARIO * (1 - record.DESCUENTO / 100)
          : record.PRECIO_UNITARIO;
        const subtotalCalculado = precio * record.CANTIDAD;

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
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
      title: '', key: 'actions', width: 48,
      render: (_: unknown, record: CartItem) => (
        <Button type="text" danger size="small" icon={<DeleteOutlined />}
          onClick={() => removeCartItem(record.key)}
          style={{ fontSize: 16 }}
        />
      ),
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
          {/* Search bar */}
          <div className="nsm-search-wrap">
            <AutoComplete
              ref={searchRef}
              value={searchText}
              options={searchOptions}
              onSearch={handleSearch}
              onSelect={(val) => {
                const opt = searchOptions.find(o => o.value === val);
                if (opt) addProduct(opt.product);
              }}
              style={{ width: '100%' }}
              popupClassName="nsm-search-dropdown"
              popupMatchSelectWidth={true}
              notFoundContent={searching ? <Spin size="small" /> : searchText.length > 0 ? 'Sin resultados' : null}
            >
              <Input
                prefix={<SearchOutlined style={{ fontSize: 18, color: '#EABD23' }} />}
                suffix={
                  <Tag color="default" style={{ margin: 0, fontSize: 11, opacity: 0.5 }}>
                    F2
                  </Tag>
                }
                placeholder="Buscar por nombre, código o escanear código de barras..."
                size="large"
                allowClear
                onKeyDown={handleSearchKeyDown}
                className="nsm-search-input"
              />
            </AutoComplete>
            <div className="nsm-search-hint">
              <BarcodeOutlined style={{ marginRight: 4 }} />
              Escanee o ingrese busqueda manual. Presione Enter para confirmar. 
            </div>
          </div>

          {/* Cart area */}
          <div className="nsm-cart-area">
            {cart.length === 0 ? (
              <div className="nsm-empty-state">
                <ShoppingCartOutlined className="nsm-empty-icon" />
                <Title level={5} style={{ color: '#999', margin: '12px 0 4px' }}>
                  Carrito vacío
                </Title>
                <Text type="secondary">
                  Busque y agregue productos usando el buscador superior
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
                scroll={{ y: 'calc(100vh - 380px)' }}
              />
            )}
          </div>
        </div>

        {/* ══ RIGHT COLUMN — Config / Cobro ═══════ */}
        <div className="nsm-sidebar">
          {step === 'cart' ? (
            /* ── STEP 1: Cart configuration ───────── */
            <>
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
                  disabled={esMonotributo}
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

              <Divider style={{ margin: '16px 0' }} />

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
                  <Button
                    block
                    size="large"
                    onClick={() => handleSubmit(false)}
                    loading={createMutation.isPending}
                    disabled={cart.length === 0}
                    style={{ height: 48 }}
                  >
                    Guardar (Cobro Pendiente)
                  </Button>
                )}
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
                <Button
                  block
                  size="large"
                  onClick={handleClose}
                  style={{ height: 44 }}
                >
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            /* ── STEP 2: Payment / Cobro ──────────── */
            <>
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

              {/* Payment method */}
              <div className="nsm-field-group">
                <label className="nsm-label">Método de pago</label>
                <div className="nsm-metodo-group">
                  {[
                    { key: 'efectivo' as MetodoPago, icon: <DollarOutlined />, label: 'Efectivo' },
                    { key: 'digital' as MetodoPago, icon: <CreditCardOutlined />, label: 'Digital' },
                    { key: 'mixto' as MetodoPago, icon: <SwapOutlined />, label: 'Mixto' },
                  ].map(m => (
                    <button
                      key={m.key}
                      type="button"
                      className={`nsm-metodo-btn${metodoPago === m.key ? ' active' : ''}`}
                      onClick={() => setMetodoPago(m.key)}
                    >
                      <span className="nsm-metodo-icon">{m.icon}</span>
                      <span className="nsm-metodo-label">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Cash input */}
              {(metodoPago === 'efectivo' || metodoPago === 'mixto') && (
                <div className="nsm-field-group">
                  <label className="nsm-label">
                    <DollarOutlined style={{ marginRight: 6 }} />
                    Monto Efectivo
                  </label>
                  <InputNumber
                    ref={efectivoRef}
                    value={pagoEfectivo}
                    min={0}
                    step={100}
                    size="large"
                    style={{ width: '100%' }}
                    formatter={v => `$ ${v}`}
                    onChange={v => setPagoEfectivo(v || 0)}
                    autoFocus
                    onPressEnter={() => {
                      if (metodoPago === 'efectivo' && pagoValido) handleConfirmCobro();
                    }}
                  />
                  {metodoPago === 'efectivo' && (
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                      Puede ingresar un monto mayor — se calculará el vuelto
                    </Text>
                  )}
                </div>
              )}

              {/* Digital input */}
              {(metodoPago === 'digital' || metodoPago === 'mixto') && (
                <div className="nsm-field-group">
                  <label className="nsm-label">
                    <CreditCardOutlined style={{ marginRight: 6 }} />
                    Monto Digital
                  </label>
                  <InputNumber
                    value={pagoDigital}
                    min={0}
                    step={100}
                    size="large"
                    style={{ width: '100%' }}
                    formatter={v => `$ ${v}`}
                    onChange={v => setPagoDigital(v || 0)}
                    autoFocus={metodoPago === 'digital'}
                    onPressEnter={() => {
                      if (pagoValido) handleConfirmCobro();
                    }}
                  />
                  {metodoPago === 'digital' && (
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                      El monto digital debe ser exacto
                    </Text>
                  )}
                  {metodoPago === 'mixto' && (
                    <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                      La suma de efectivo + digital debe ser exacta
                    </Text>
                  )}
                </div>
              )}

              <Divider style={{ margin: '12px 0' }} />

              {/* Payment summary */}
              <div className="nsm-cobro-summary">
                <div className="nsm-cobro-line">
                  <Text type="secondary">Total recibido</Text>
                  <Text strong>{fmtMoney(pagoEfectivo + pagoDigital)}</Text>
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
                {(metodoPago === 'mixto' || metodoPago === 'digital') && (pagoEfectivo + pagoDigital) > 0 && Math.abs((pagoEfectivo + pagoDigital) - total) >= 0.01 && (
                  <div style={{ marginTop: 8 }}>
                    <Text type="danger" style={{ fontSize: 12 }}>
                      {(pagoEfectivo + pagoDigital) < total
                        ? `Faltan ${fmtMoney(total - pagoEfectivo - pagoDigital)}`
                        : `Exceso de ${fmtMoney(pagoEfectivo + pagoDigital - total)} — el monto debe ser exacto`
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
    </>
  );
}
