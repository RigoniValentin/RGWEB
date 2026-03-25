import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Modal, Input, Select, Button, InputNumber, Table, Space, Typography,
  Divider, Spin, message, AutoComplete, Tag, Checkbox, Segmented, Badge, Switch,
} from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, ShoppingCartOutlined,
  MinusOutlined, ShopOutlined, FileTextOutlined, SwapOutlined,
  ArrowLeftOutlined, CheckCircleOutlined,
  DollarOutlined, CreditCardOutlined, WalletOutlined,
  BankOutlined, InboxOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { purchasesApi } from '../../services/purchases.api';
import { cajaApi } from '../../services/caja.api';
import { fmtMoney } from '../../utils/format';
import type { CompraItemInput, CompraInput, ProductoSearchCompra, MetodoPago, MetodoPagoItem } from '../../types';

const { Title, Text } = Typography;

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

type ModalStep = 'cart' | 'pago';

interface CartItem extends CompraItemInput {
  key: string;
  NOMBRE: string;
  CODIGO: string;
  STOCK: number;
  UNIDAD: string;
  IVA_PORCENTAJE: number;
  PRECIO_FINAL: number; // total for the line, entered by user
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (result?: { compraId: number; actualizoCostos: boolean }) => void;
}

export function NewPurchaseModal({ open, onClose, onSuccess }: Props) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [proveedorId, setProveedorId] = useState<number | null>(null);
  const [depositoId, setDepositoId] = useState<number | null>(null);
  const [tipoComprobante, setTipoComprobante] = useState<string>('FB');
  const [ptoVta, setPtoVta] = useState('0000');
  const [nroComprobante, setNroComprobante] = useState('00000000');
  const [esCtaCorriente, setEsCtaCorriente] = useState(false);
  const [ivaIncluido, setIvaIncluido] = useState(true);
  const [ivaManual, setIvaManual] = useState(0);
  const [actualizarCostos, setActualizarCostos] = useState(true);
  const [actualizarPrecios, setActualizarPrecios] = useState(true);
  const [percepcionIva, setPercepcionIva] = useState(0);
  const [percepcionIibb, setPercepcionIibb] = useState(0);
  const [tipoCarga, setTipoCarga] = useState<'simple' | 'detallada'>('detallada');
  const [impIntGravaIva, setImpIntGravaIva] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchOptions, setSearchOptions] = useState<{ value: string; label: React.ReactNode; product: ProductoSearchCompra }[]>([]);
  const searchRef = useRef<any>(null);

  // ── Refs for Enter-flow: editable fields navigation ──
  const fieldRefs = useRef<Record<string, Record<string, any>>>({});
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null);

  // Payment step state
  const [step, setStep] = useState<ModalStep>('cart');
  const [selectedMetodos, setSelectedMetodos] = useState<number[]>([]);
  const [montosPorMetodo, setMontosPorMetodo] = useState<Record<number, number>>({});
  const [metodoModalOpen, setMetodoModalOpen] = useState(false);
  const [metodoModalSelection, setMetodoModalSelection] = useState<number[]>([]);
  const [destinoPago, setDestinoPago] = useState<'CAJA_CENTRAL' | 'CAJA'>('CAJA_CENTRAL');
  const efectivoRef = useRef<any>(null);

  // Saldo CTA CTE state
  const [saldoModalOpen, setSaldoModalOpen] = useState(false);
  const [saldoInfo, setSaldoInfo] = useState<{ saldo: number; creditoDisponible: number; cobertura: 'total' | 'parcial' } | null>(null);
  const [checkingSaldo, setCheckingSaldo] = useState(false);

  // Fetch proveedores
  const { data: proveedores = [] } = useQuery({
    queryKey: ['purchases-proveedores'],
    queryFn: () => purchasesApi.getProveedores(),
    enabled: open,
    staleTime: 60000,
  });

  // Fetch depositos
  const { data: depositos = [] } = useQuery({
    queryKey: ['purchases-depositos'],
    queryFn: () => purchasesApi.getDepositos(),
    enabled: open,
    staleTime: 60000,
  });

  // Check if user has an open cash register
  const { data: miCaja } = useQuery({
    queryKey: ['mi-caja'],
    queryFn: () => cajaApi.getMiCaja(),
    enabled: open,
    staleTime: 30000,
  });

  // Fetch active payment methods
  const { data: metodosPago = [] } = useQuery({
    queryKey: ['purchases-active-payment-methods'],
    queryFn: () => purchasesApi.getActivePaymentMethods(),
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

  // Set default deposit
  useEffect(() => {
    if (depositos.length > 0 && !depositoId) {
      setDepositoId(depositos[0]!.DEPOSITO_ID);
    }
  }, [depositos]);

  // ── Product search (debounced) ─────────────────
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (text: string) => {
    setSearching(true);
    try {
      const products = await purchasesApi.searchProducts(text);
      setSearchOptions(
        products.map(p => ({
          value: `${p.PRODUCTO_ID}`,
          label: (
            <div className="nsm-search-item">
              <div className="nsm-search-item-left">
                <div className="nsm-search-item-name">{p.NOMBRE}</div>
                <div className="nsm-search-item-meta">
                  <span className="nsm-search-item-code">{p.CODIGOPARTICULAR}</span>
                  <span className="nsm-search-item-stock">Stock: {p.STOCK} {p.UNIDAD_ABREVIACION || 'u'}</span>
                </div>
              </div>
              <div className="nsm-search-item-right">
                <div className="nsm-search-item-price">{fmtMoney(p.PRECIO_COMPRA)}</div>
                <div className="nsm-search-item-unit">costo</div>
              </div>
            </div>
          ),
          product: p,
        }))
      );
    } catch {
      setSearchOptions([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSearch = (text: string) => {
    setSearchText(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (text.length >= 1) {
      searchTimeout.current = setTimeout(() => doSearch(text), 300);
    } else {
      setSearchOptions([]);
    }
  };

  const isDetallada = tipoCarga === 'detallada';

  const handleSelectProduct = useCallback((_value: string, option: any) => {
    const p = option.product as ProductoSearchCompra;
    const existingIndex = cart.findIndex(item => item.PRODUCTO_ID === p.PRODUCTO_ID && item.DEPOSITO_ID === depositoId);

    if (isDetallada) {
      // ── Detailed mode: base price + bonif + imp int ──
      if (existingIndex >= 0) {
        const updated = [...cart];
        const existing = updated[existingIndex]!;
        const newQty = existing.CANTIDAD + 1;
        const bonif = existing.BONIFICACION || 0;
        const netoUnit = existing.PRECIO_COMPRA * (1 - bonif / 100);
        updated[existingIndex] = {
          ...existing,
          CANTIDAD: newQty,
          PRECIO_FINAL: r2(netoUnit * newQty),
        };
        setCart(updated);
        setLastAddedKey(existing.key);
      } else {
        const newKey = `${p.PRODUCTO_ID}-${Date.now()}`;
        setLastAddedKey(newKey);
        const newItem: CartItem = {
          key: newKey,
          PRODUCTO_ID: p.PRODUCTO_ID,
          PRECIO_COMPRA: p.PRECIO_COMPRA, // base price (PRECIO_COMPRA_BASE from search)
          CANTIDAD: 1,
          DEPOSITO_ID: depositoId || undefined,
          BONIFICACION: 0,
          IMP_INTERNOS: p.IMP_INT || 0,
          IVA_ALICUOTA: p.IVA_PORCENTAJE / 100,
          TASA_IVA_ID: p.TASA_IVA_ID,
          NOMBRE: p.NOMBRE,
          CODIGO: p.CODIGOPARTICULAR,
          STOCK: p.STOCK,
          UNIDAD: p.UNIDAD_ABREVIACION || 'u',
          IVA_PORCENTAJE: p.IVA_PORCENTAJE,
          PRECIO_FINAL: p.PRECIO_COMPRA, // net = base * 1 qty, no discount
        };
        setCart(prev => [...prev, newItem]);
      }
    } else {
      // ── Simple mode (current behavior): price final / qty ──
      if (existingIndex >= 0) {
        const updated = [...cart];
        const existing = updated[existingIndex]!;
        const newQty = existing.CANTIDAD + 1;
        const unitPriceRaw = existing.PRECIO_FINAL / newQty;
        const ivaAliE = existing.IVA_ALICUOTA || 0;
        const extractIva = tipoComprobante === 'FA' && ivaIncluido;
        updated[existingIndex] = {
          ...existing,
          CANTIDAD: newQty,
          PRECIO_COMPRA: extractIva ? unitPriceRaw / (1 + ivaAliE) : unitPriceRaw,
        };
        setCart(updated);
        setLastAddedKey(existing.key);
      } else {
        const ivaAliN = p.IVA_PORCENTAJE / 100;
        const extractIva = tipoComprobante === 'FA' && ivaIncluido;
        const newKey = `${p.PRODUCTO_ID}-${Date.now()}`;
        setLastAddedKey(newKey);
        const newItem: CartItem = {
          key: newKey,
          PRODUCTO_ID: p.PRODUCTO_ID,
          PRECIO_COMPRA: extractIva ? p.PRECIO_COMPRA / (1 + ivaAliN) : p.PRECIO_COMPRA,
          CANTIDAD: 1,
          DEPOSITO_ID: depositoId || undefined,
          BONIFICACION: 0,
          IMP_INTERNOS: 0,
          IVA_ALICUOTA: p.IVA_PORCENTAJE / 100,
          TASA_IVA_ID: p.TASA_IVA_ID,
          NOMBRE: p.NOMBRE,
          CODIGO: p.CODIGOPARTICULAR,
          STOCK: p.STOCK,
          UNIDAD: p.UNIDAD_ABREVIACION || 'u',
          IVA_PORCENTAJE: p.IVA_PORCENTAJE,
          PRECIO_FINAL: p.PRECIO_COMPRA,
        };
        setCart(prev => [...prev, newItem]);
      }
    }

    setSearchText('');
    setSearchOptions([]);
  }, [cart, depositoId, tipoComprobante, ivaIncluido, isDetallada]);

  // Auto-focus first editable field when a new product is added
  useEffect(() => {
    if (!lastAddedKey) return;
    const timer = setTimeout(() => {
      const firstField = isDetallada ? 'precioCompra' : 'cantidad';
      const el = fieldRefs.current[lastAddedKey]?.[firstField];
      if (el) {
        el.focus();
        const inp = el?.input || el?.nativeElement?.querySelector?.('input');
        if (inp) inp.select();
      }
      setLastAddedKey(null);
    }, 100);
    return () => clearTimeout(timer);
  }, [lastAddedKey, isDetallada]);

  // Helper: focus a field ref and select its value
  const focusField = (key: string, field: string) => {
    setTimeout(() => {
      const el = fieldRefs.current[key]?.[field];
      if (el) {
        el.focus();
        const inp = el?.input || el?.nativeElement?.querySelector?.('input');
        if (inp) inp.select();
      } else {
        // If field doesn't exist (e.g. no IVA column), go to search
        searchRef.current?.focus();
      }
    }, 50);
  };

  const focusSearch = () => {
    setTimeout(() => searchRef.current?.focus(), 50);
  };

  // Auto-focus search input when modal opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 150);
    }
  }, [open]);

  // Handle F2 keyboard shortcut for search focus
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

  // ── Update cart item ───────────────────────────
  const updateCartItem = (key: string, field: keyof CartItem, value: any) => {
    setCart(prev => prev.map(item => {
      if (item.key !== key) return item;
      const updated = { ...item, [field]: value };

      if (isDetallada) {
        // Detailed: recalculate net total when base price, qty, or bonif changes
        if (field === 'PRECIO_COMPRA' || field === 'CANTIDAD' || field === 'BONIFICACION') {
          const pc = field === 'PRECIO_COMPRA' ? (value as number) : item.PRECIO_COMPRA;
          const qty = field === 'CANTIDAD' ? (value as number) : item.CANTIDAD;
          const bonif = field === 'BONIFICACION' ? (value as number) : item.BONIFICACION;
          const netoUnit = pc * (1 - (bonif || 0) / 100);
          updated.PRECIO_FINAL = r2(netoUnit * qty);
        }
      } else {
        // Simple: recalculate net unit price when precio final or cantidad changes
        if (field === 'PRECIO_FINAL' || field === 'CANTIDAD') {
          const pf = field === 'PRECIO_FINAL' ? (value as number) : item.PRECIO_FINAL;
          const qty = field === 'CANTIDAD' ? (value as number) : item.CANTIDAD;
          const unitPrice = qty > 0 ? pf / qty : 0;
          const extractIva = tipoComprobante === 'FA' && ivaIncluido;
          const ivaAli = updated.IVA_ALICUOTA || 0;
          updated.PRECIO_COMPRA = extractIva ? unitPrice / (1 + ivaAli) : unitPrice;
        }
      }
      return updated;
    }));
  };

  const removeCartItem = (key: string) => {
    setCart(prev => prev.filter(item => item.key !== key));
  };

  // Recalculate net unit prices when IVA inclusion or comprobante type changes
  useEffect(() => {
    if (cart.length === 0) return;
    const extractIva = tipoComprobante === 'FA' && ivaIncluido;
    setCart(prev => prev.map(item => {
      const unitPrice = item.CANTIDAD > 0 ? item.PRECIO_FINAL / item.CANTIDAD : 0;
      const ivaAli = item.IVA_ALICUOTA || 0;
      return {
        ...item,
        PRECIO_COMPRA: extractIva ? unitPrice / (1 + ivaAli) : unitPrice,
      };
    }));
  }, [ivaIncluido, tipoComprobante]);

  // ── Total calculations ─────────────────────────
  const isFacturaA = tipoComprobante === 'FA';

  const subtotal = useMemo(() =>
    cart.reduce((s, i) => s + i.PRECIO_FINAL, 0), [cart]);

  // Detailed mode memos
  const ivaCalculado = useMemo(() => {
    if (!isDetallada || !isFacturaA) return 0;
    return cart.reduce((s, item) => {
      const iva = (item as any).IVA_PORCENTAJE ?? 21;
      const impInt = (item as any).IMP_INTERNOS ?? 0;
      const netoUnit = item.PRECIO_COMPRA;
      const bonifPct = (item as any).BONIFICACION ?? 0;
      const netoConBonif = netoUnit * (1 - bonifPct / 100);
      const baseIva = impIntGravaIva ? (netoConBonif - impInt) : netoConBonif;
      return s + baseIva * item.CANTIDAD * (iva / 100);
    }, 0);
  }, [cart, isDetallada, isFacturaA, impIntGravaIva]);

  const impInternoCalculado = useMemo(() => {
    if (!isDetallada) return 0;
    return cart.reduce((s, item) => s + ((item as any).IMP_INTERNOS ?? 0) * item.CANTIDAD, 0);
  }, [cart, isDetallada]);

  const total = useMemo(() => {
    let t = subtotal;
    if (isDetallada) {
      t += ivaCalculado + impInternoCalculado;
    } else {
      if (isFacturaA && !ivaIncluido) t += ivaManual;
    }
    t += percepcionIva + percepcionIibb;
    return Math.round(t * 100) / 100;
  }, [subtotal, isDetallada, isFacturaA, ivaIncluido, ivaManual, ivaCalculado, impInternoCalculado, percepcionIva, percepcionIibb]);

  const vuelto = useMemo(() => {
    if (esCtaCorriente) return 0;
    if (selectedMetodos.length === 0) return 0;
    if (soloEfectivo) return Math.max(0, totalRecibido - total);
    if (hayEfectivo) return Math.max(0, totalRecibido - total);
    return 0; // all digital: no change
  }, [selectedMetodos, totalRecibido, total, soloEfectivo, hayEfectivo, esCtaCorriente]);

  const pagoValido = useMemo(() => {
    if (selectedMetodos.length === 0 || totalRecibido <= 0) return false;
    if (soloEfectivo) return totalRecibido >= total;
    if (soloDigital) return Math.abs(totalRecibido - total) < 0.01;
    if (hayEfectivo) return totalRecibido >= total;
    return Math.abs(totalRecibido - total) < 0.01;
  }, [selectedMetodos, totalRecibido, total, soloEfectivo, soloDigital, hayEfectivo]);

  // When a single method is selected, auto-fill total to it
  useEffect(() => {
    if (step !== 'pago') return;
    if (selectedMetodos.length === 1) {
      setMontosPorMetodo({ [selectedMetodos[0]!]: total });
    }
  }, [selectedMetodos, step, total]);

  // Reset on close
  const handleClose = () => {
    setCart([]);
    setProveedorId(null);
    setDepositoId(depositos.length > 0 ? depositos[0]!.DEPOSITO_ID : null);
    setTipoComprobante('FB');
    setPtoVta('0000');
    setNroComprobante('00000000');
    setEsCtaCorriente(false);
    setIvaIncluido(true);
    setIvaManual(0);
    setActualizarCostos(true);
    setActualizarPrecios(true);
    setPercepcionIva(0);
    setPercepcionIibb(0);
    setTipoCarga('detallada');
    setImpIntGravaIva(false);
    setSearchText('');
    setSearchOptions([]);
    setStep('cart');
    setSelectedMetodos([]);
    setMontosPorMetodo({});
    setMetodoModalOpen(false);
    setMetodoModalSelection([]);
    setDestinoPago('CAJA_CENTRAL');
    setSaldoModalOpen(false);
    setSaldoInfo(null);
    onClose();
  };

  // ── Create mutation ────────────────────────────
  const createMutation = useMutation({
    mutationFn: (data: CompraInput) => purchasesApi.create(data),
    onSuccess: (result) => {
      // Show appropriate message based on anticipo usage
      if (result.MONTO_ANTICIPO && result.MONTO_ANTICIPO > 0) {
        if (result.COBRADA) {
          message.success(
            `Compra #${result.COMPRA_ID} registrada — Total: ${fmtMoney(result.TOTAL)}. Pagada con saldo de cta corriente.`,
            5
          );
        } else {
          message.success(
            `Compra #${result.COMPRA_ID} registrada — Total: ${fmtMoney(result.TOTAL)}. Anticipo aplicado: ${fmtMoney(result.MONTO_ANTICIPO)}. Pendiente: ${fmtMoney(result.TOTAL - result.MONTO_ANTICIPO)}`,
            5
          );
        }
      } else {
        message.success(`Compra #${result.COMPRA_ID} registrada — Total: ${fmtMoney(result.TOTAL)}`);
      }
      const didUpdateCosts = actualizarCostos;
      handleClose();
      onSuccess({ compraId: result.COMPRA_ID, actualizoCostos: didUpdateCosts });
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al registrar compra');
    },
  });

  // ── Submit ─────────────────────────────────────
  const handleSubmit = () => {
    if (!proveedorId) {
      message.warning('Seleccione un proveedor');
      return;
    }
    if (cart.length === 0) {
      message.warning('Agregue al menos un producto');
      return;
    }

    if (!esCtaCorriente && !pagoValido) return;

    const vueltoFinal = vuelto;

    // Build metodos_pago array — adjust efectivo amounts to subtract change
    const metodosPagoInput: MetodoPagoItem[] = esCtaCorriente ? [] : selectedMetodos
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

    // Derive category totals
    let efectivoFinal = 0;
    let digitalFinal = 0;
    for (const mp of metodosPagoInput) {
      const m = metodosPago.find(x => x.METODO_PAGO_ID === mp.METODO_PAGO_ID);
      if (m?.CATEGORIA === 'EFECTIVO') efectivoFinal += mp.MONTO;
      else digitalFinal += mp.MONTO;
    }

    const payload: CompraInput = {
      PROVEEDOR_ID: proveedorId,
      TIPO_COMPROBANTE: tipoComprobante,
      PTO_VTA: ptoVta,
      NRO_COMPROBANTE: nroComprobante,
      ES_CTA_CORRIENTE: esCtaCorriente,
      MONTO_EFECTIVO: esCtaCorriente ? 0 : efectivoFinal,
      MONTO_DIGITAL: esCtaCorriente ? 0 : digitalFinal,
      VUELTO: vueltoFinal,
      COBRADA: !esCtaCorriente,
      PRECIOS_SIN_IVA: isDetallada ? !isFacturaA : (isFacturaA ? !ivaIncluido : true),
      IMP_INT_GRAVA_IVA: isDetallada ? impIntGravaIva : false,
      PERCEPCION_IVA: percepcionIva,
      PERCEPCION_IIBB: percepcionIibb,
      IVA_TOTAL: isDetallada && isFacturaA ? r2(ivaCalculado) : (isFacturaA ? ivaManual : 0),
      ACTUALIZAR_COSTOS: actualizarCostos,
      ACTUALIZAR_PRECIOS: actualizarPrecios,
      DESTINO_PAGO: esCtaCorriente ? undefined : destinoPago,
      metodos_pago: metodosPagoInput.length > 0 ? metodosPagoInput : undefined,
      items: cart.map(item => ({
        PRODUCTO_ID: item.PRODUCTO_ID,
        PRECIO_COMPRA: item.PRECIO_COMPRA,
        CANTIDAD: item.CANTIDAD,
        DEPOSITO_ID: item.DEPOSITO_ID,
        BONIFICACION: isDetallada ? item.BONIFICACION : 0,
        IMP_INTERNOS: isDetallada ? item.IMP_INTERNOS : 0,
        IVA_ALICUOTA: isFacturaA ? item.IVA_ALICUOTA : 0,
        TASA_IVA_ID: isFacturaA ? item.TASA_IVA_ID : null,
      })),
    };

    createMutation.mutate(payload);
  };

  // ── Going to payment step ──────────────────────
  const goToPayment = async () => {
    if (!proveedorId) {
      message.warning('Seleccione un proveedor');
      return;
    }
    if (cart.length === 0) {
      message.warning('Agregue al menos un producto');
      return;
    }

    // Auto-fill for cta corriente
    if (esCtaCorriente) {
      // Check saldo before saving
      setCheckingSaldo(true);
      try {
        const { saldo } = await purchasesApi.getSaldoCtaCteP(proveedorId);
        // saldo < 0 means supplier has credit (overpayment / anticipo available)
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
      // No saldo available — save directly
      doSaveCtaCte();
      return;
    }

    // Open payment method selection modal
    const initialSelection = selectedMetodos.length > 0
      ? [...selectedMetodos]
      : (defaultMetodoEfectivoId ? [defaultMetodoEfectivoId] : []);
    setMetodoModalSelection(initialSelection);
    setMetodoModalOpen(true);
  };

  // Confirmed save after saldo modal (or direct cta cte save)
  const doSaveCtaCte = () => {
    setSaldoModalOpen(false);
    setSaldoInfo(null);
    handleSubmit();
  };

  // ── Item columns ───────────────────────────────
  const productColumn = {
    title: 'PRODUCTO', dataIndex: 'NOMBRE', key: 'name', ellipsis: true,
    render: (name: string, record: CartItem) => (
      <div className="nsm-cart-product">
        <div className="nsm-cart-product-name">{name}</div>
        <div className="nsm-cart-product-meta">
          <span className="nsm-cart-product-code">{record.CODIGO}</span>
          <span className="nsm-cart-product-stock">Stock: {record.STOCK} {record.UNIDAD}</span>
        </div>
      </div>
    ),
  };

  const deleteColumn = {
    title: '', key: 'actions', width: 48, align: 'center' as const,
    render: (_: unknown, record: CartItem) => (
      <Button type="text" danger size="small" icon={<DeleteOutlined />}
        onClick={() => {
          delete fieldRefs.current[record.key];
          removeCartItem(record.key);
        }}
        className="nsm-cart-delete"
      />
    ),
  };

  const cartColumns = isDetallada ? [
    // ── DETAILED MODE COLUMNS ──
    productColumn,
    {
      title: 'P. COMPRA', width: 120, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <InputNumber
          ref={el => { if (el) { if (!fieldRefs.current[record.key]) fieldRefs.current[record.key] = {}; fieldRefs.current[record.key]!.precioCompra = el; } }}
          value={record.PRECIO_COMPRA}
          min={0} step={0.01} size="middle"
          style={{ width: '100%' }}
          className="nsm-cart-input"
          onChange={val => updateCartItem(record.key, 'PRECIO_COMPRA', val || 0)}
          formatter={v => `$ ${v}`}
          onPressEnter={() => focusField(record.key, 'cantidad')}
        />
      ),
    },
    {
      title: 'CANT.', dataIndex: 'CANTIDAD', width: 100, align: 'center' as const,
      render: (_: number, record: CartItem) => (
        <Space size={4}>
          <Button size="small" icon={<MinusOutlined />} className="nsm-qty-btn"
            onClick={() => {
              if (record.CANTIDAD <= 1) removeCartItem(record.key);
              else updateCartItem(record.key, 'CANTIDAD', record.CANTIDAD - 1);
            }}
          />
          <InputNumber
            ref={el => { if (el) { if (!fieldRefs.current[record.key]) fieldRefs.current[record.key] = {}; fieldRefs.current[record.key]!.cantidad = el; } }}
            value={record.CANTIDAD} min={0.01} step={1} size="middle"
            style={{ width: 64 }}
            className="nsm-cart-input"
            onChange={val => updateCartItem(record.key, 'CANTIDAD', val || 1)}
            onPressEnter={() => focusField(record.key, 'bonificacion')}
          />
          <Button size="small" icon={<PlusOutlined />} className="nsm-qty-btn"
            onClick={() => updateCartItem(record.key, 'CANTIDAD', record.CANTIDAD + 1)}
          />
        </Space>
      ),
    },
    {
      title: 'BONIF. %', width: 90, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <InputNumber
          ref={el => { if (el) { if (!fieldRefs.current[record.key]) fieldRefs.current[record.key] = {}; fieldRefs.current[record.key]!.bonificacion = el; } }}
          value={record.BONIFICACION} min={0} max={100} step={1} size="middle"
          style={{ width: '100%' }}
          className="nsm-cart-input"
          onChange={val => updateCartItem(record.key, 'BONIFICACION', val || 0)}
          onPressEnter={() => focusField(record.key, 'impInternos')}
        />
      ),
    },
    {
      title: 'IMP. INT.', width: 100, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <InputNumber
          ref={el => { if (el) { if (!fieldRefs.current[record.key]) fieldRefs.current[record.key] = {}; fieldRefs.current[record.key]!.impInternos = el; } }}
          value={record.IMP_INTERNOS} min={0} step={0.01} size="middle"
          style={{ width: '100%' }}
          className="nsm-cart-input"
          onChange={val => updateCartItem(record.key, 'IMP_INTERNOS', val || 0)}
          formatter={v => `$ ${v}`}
          onPressEnter={focusSearch}
        />
      ),
    },
    ...(isFacturaA ? [{
      title: 'IVA %', width: 65, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <Text type="secondary">{((record.IVA_ALICUOTA || 0) * 100).toFixed(0)}%</Text>
      ),
    }] : []),
    {
      title: 'SUBTOTAL', width: 110, align: 'right' as const,
      render: (_: unknown, record: CartItem) => (
        <Text strong style={{ fontSize: 14 }}>{fmtMoney(record.PRECIO_FINAL)}</Text>
      ),
    },
    deleteColumn,
  ] : [
    // ── SIMPLE MODE COLUMNS ──
    productColumn,
    {
      title: 'P. UNIT.', width: 110, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <Text type="secondary" style={{ fontSize: 13 }}>{fmtMoney(record.PRECIO_COMPRA)}</Text>
      ),
    },
    {
      title: 'CANT.', dataIndex: 'CANTIDAD', width: 140, align: 'center' as const,
      render: (_: number, record: CartItem) => (
        <Space size={4}>
          <Button size="small" icon={<MinusOutlined />} className="nsm-qty-btn"
            onClick={() => {
              if (record.CANTIDAD <= 1) removeCartItem(record.key);
              else updateCartItem(record.key, 'CANTIDAD', record.CANTIDAD - 1);
            }}
          />
          <InputNumber
            ref={el => { if (el) { if (!fieldRefs.current[record.key]) fieldRefs.current[record.key] = {}; fieldRefs.current[record.key]!.cantidad = el; } }}
            value={record.CANTIDAD} min={0.01} step={1} size="middle"
            style={{ width: 64 }}
            className="nsm-cart-input"
            onChange={val => updateCartItem(record.key, 'CANTIDAD', val || 1)}
            onPressEnter={() => focusField(record.key, 'precioFinal')}
          />
          <Button size="small" icon={<PlusOutlined />} className="nsm-qty-btn"
            onClick={() => updateCartItem(record.key, 'CANTIDAD', record.CANTIDAD + 1)}
          />
        </Space>
      ),
    },
    {
      title: 'PRECIO FINAL', width: 140, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <InputNumber
          ref={el => { if (el) { if (!fieldRefs.current[record.key]) fieldRefs.current[record.key] = {}; fieldRefs.current[record.key]!.precioFinal = el; } }}
          value={record.PRECIO_FINAL} min={0} step={0.01} size="middle"
          style={{ width: '100%' }}
          className="nsm-cart-input"
          onChange={val => updateCartItem(record.key, 'PRECIO_FINAL', val || 0)}
          formatter={v => `$ ${v}`}
          onPressEnter={focusSearch}
        />
      ),
    },
    ...(isFacturaA ? [{
      title: 'IVA %', width: 70, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <Text type="secondary">{((record.IVA_ALICUOTA || 0) * 100).toFixed(0)}%</Text>
      ),
    }] : []),
    deleteColumn,
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
          {step === 'pago' ? (
            <>
              <WalletOutlined className="nsm-header-icon" />
              <Title level={4} style={{ margin: 0, color: '#fff' }}>Registrar Pago</Title>
            </>
          ) : (
            <>
              <ShoppingCartOutlined className="nsm-header-icon" />
              <Title level={4} style={{ margin: 0, color: '#fff' }}>Nueva Compra</Title>
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

      <div className="nsm-body" onFocusCapture={(e) => {
        const target = e.target as HTMLInputElement;
        if (target.tagName === 'INPUT' && target.type === 'text') {
          requestAnimationFrame(() => target.select());
        }
      }}>
        {/* ══ LEFT COLUMN — Search + Cart ══════════ */}
        <div className="nsm-main">
          <div className="nsm-cart-area">
            {/* Embedded search */}
            <div className="nsm-search-embedded">
              <AutoComplete
                ref={searchRef}
                value={searchText}
                options={searchOptions}
                onSearch={handleSearch}
                onSelect={handleSelectProduct}
                style={{ width: '100%' }}
                popupClassName="nsm-search-dropdown"
                popupMatchSelectWidth={true}
                notFoundContent={searching ? <Spin size="small" /> : searchText.length > 0 ? 'Sin resultados' : null}
              >
                <Input
                  prefix={<SearchOutlined style={{ fontSize: 16, color: '#EABD23' }} />}
                  suffix={
                    <Tag color="default" style={{ margin: 0, fontSize: 11, opacity: 0.5 }}>
                      F2
                    </Tag>
                  }
                  placeholder="Buscar producto por código o nombre..."
                  size="large"
                  allowClear
                  className="nsm-search-input"
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    if (searchOptions.length > 0) return;
                    const text = searchText.trim();
                    if (!text) return;
                    e.preventDefault();
                    purchasesApi.searchProducts(text).then(products => {
                      if (products.length === 1) {
                        handleSelectProduct(`${products[0]!.PRODUCTO_ID}`, { product: products[0] });
                      } else if (products.length > 1) {
                        const exact = products.find(p => p.CODIGOPARTICULAR?.toUpperCase() === text.toUpperCase());
                        if (exact) {
                          handleSelectProduct(`${exact.PRODUCTO_ID}`, { product: exact });
                        } else {
                          handleSearch(text);
                        }
                      } else {
                        message.warning('No se encontró ningún producto');
                      }
                    });
                  }}
                />
              </AutoComplete>
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

        {/* ══ RIGHT COLUMN — Config / Pago ═══════ */}
        <div className="nsm-sidebar">
          {step === 'cart' ? (
            /* ── STEP 1: Cart configuration ───────── */
            <>
              <div className="npm-sidebar-scroll">
              {/* Proveedor */}
              <div className="nsm-field-group">
                <label className="nsm-label">
                  <ShopOutlined style={{ marginRight: 6 }} />
                  Proveedor
                </label>
                <Select
                  showSearch
                  placeholder="Seleccionar proveedor"
                  optionFilterProp="label"
                  value={proveedorId}
                  onChange={val => setProveedorId(val)}
                  style={{ width: '100%' }}
                  size="large"
                  options={proveedores.map(p => ({
                    value: p.PROVEEDOR_ID,
                    label: `${p.CODIGOPARTICULAR} - ${p.NOMBRE}`,
                  }))}
                />
              </div>

              {/* Depósito */}
              <div className="nsm-field-group">
                <label className="nsm-label">
                  <InboxOutlined style={{ marginRight: 6 }} />
                  Depósito
                </label>
                <Select
                  placeholder="Depósito"
                  value={depositoId}
                  onChange={val => setDepositoId(val)}
                  style={{ width: '100%' }}
                  size="large"
                  options={depositos.map(d => ({
                    value: d.DEPOSITO_ID,
                    label: d.NOMBRE,
                  }))}
                />
              </div>

              {/* Comprobante */}
              <div className="nsm-field-group">
                <label className="nsm-label">
                  <FileTextOutlined style={{ marginRight: 6 }} />
                  Comprobante
                </label>
                <Select
                  value={tipoComprobante}
                  onChange={val => {
                    setTipoComprobante(val);
                    if (val === 'FA') {
                      setTipoCarga('detallada');
                      setIvaIncluido(true);
                    } else {
                      setIvaManual(0);
                      setIvaIncluido(true);
                    }
                  }}
                  style={{ width: '100%' }}
                  size="large"
                  options={[
                    { value: 'FA', label: 'Factura A' },
                    { value: 'FB', label: 'Factura B' },
                    { value: 'FC', label: 'Factura C' },
                    { value: 'FM', label: 'Factura M' },
                    { value: 'NCA', label: 'NC A' },
                    { value: 'NCB', label: 'NC B' },
                    { value: 'NCC', label: 'NC C' },
                    { value: 'R', label: 'Remito' },
                    { value: 'X', label: 'Comprobante X' },
                  ]}
                />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                  <Input
                    value={ptoVta}
                    onChange={e => setPtoVta(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                    onBlur={() => setPtoVta(prev => prev.padStart(4, '0'))}
                    onFocus={e => e.target.select()}
                    style={{ width: 65, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}
                    maxLength={4}
                    size="large"
                  />
                  <span style={{ fontFamily: 'monospace', fontSize: 16, userSelect: 'none' }}>-</span>
                  <Input
                    value={nroComprobante}
                    onChange={e => setNroComprobante(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
                    onBlur={() => setNroComprobante(prev => prev.padStart(8, '0'))}
                    onFocus={e => e.target.select()}
                    style={{ flex: 1, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}
                    maxLength={8}
                    size="large"
                  />
                </div>
              </div>

              {/* Tipo de carga */}
              <div className="nsm-field-group">
                <label className="nsm-label">Tipo de carga</label>
                <Segmented
                  value={tipoCarga}
                  onChange={val => {
                    const v = val as 'simple' | 'detallada';
                    if (v === 'simple' && isFacturaA) {
                      message.info('Factura A requiere carga detallada');
                      return;
                    }
                    setTipoCarga(v);
                    if (cart.length > 0) setCart([]);
                  }}
                  options={[
                    { value: 'detallada', label: 'Detallada' },
                    { value: 'simple', label: 'Simple' },
                  ]}
                  size="middle"
                  block
                />
              </div>

              {/* Options */}
              <div className="nsm-field-group">
                {isFacturaA && !isDetallada && (
                  <Checkbox checked={ivaIncluido} onChange={e => setIvaIncluido(e.target.checked)} style={{ marginBottom: 8, display: 'block' }}>
                    IVA incluido
                  </Checkbox>
                )}
                <div className="nsm-switch-row">
                  <Switch
                    size="default"
                    checked={esCtaCorriente}
                    onChange={setEsCtaCorriente}
                  />
                  <span className="nsm-switch-label">
                    <SwapOutlined style={{ marginRight: 6 }} />
                    Cuenta Corriente
                  </span>
                </div>
              </div>

              {/* Percepciones */}
              <div className="nsm-field-group">
                <label className="nsm-label">Percepciones e impuestos</label>
                {isFacturaA && !isDetallada && (
                  <div style={{ marginBottom: 8 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>IVA manual</Text>
                    <InputNumber
                      size="small"
                      value={ivaManual}
                      min={0}
                      onChange={val => setIvaManual(val || 0)}
                      style={{ width: '100%' }}
                      prefix="$"
                      controls={false}
                    />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Perc. IVA</Text>
                    <InputNumber
                      size="small"
                      value={percepcionIva}
                      min={0}
                      onChange={val => setPercepcionIva(val || 0)}
                      style={{ width: '100%' }}
                      prefix="$"
                      controls={false}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <Text type="secondary" style={{ fontSize: 11 }}>Perc. IIBB</Text>
                    <InputNumber
                      size="small"
                      value={percepcionIibb}
                      min={0}
                      onChange={val => setPercepcionIibb(val || 0)}
                      style={{ width: '100%' }}
                      prefix="$"
                      controls={false}
                    />
                  </div>
                </div>
              </div>

              {/* Actualizar costos / precios */}
              <div className="nsm-field-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <Checkbox checked={actualizarCostos} onChange={e => setActualizarCostos(e.target.checked)}>
                  Actualizar costos
                </Checkbox>
                <Checkbox checked={actualizarPrecios} onChange={e => setActualizarPrecios(e.target.checked)} disabled={!actualizarCostos}>
                  Actualizar precios
                </Checkbox>
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
                <div className="nsm-total-line">
                  <Text type="secondary">Subtotal</Text>
                  <Text>{fmtMoney(subtotal)}</Text>
                </div>
                {isDetallada && isFacturaA && ivaCalculado > 0 && (
                  <div className="nsm-total-line">
                    <Text type="secondary">IVA</Text>
                    <Text>{fmtMoney(r2(ivaCalculado))}</Text>
                  </div>
                )}
                {!isDetallada && isFacturaA && ivaManual > 0 && (
                  <div className="nsm-total-line">
                    <Text type="secondary">IVA</Text>
                    <Text>{fmtMoney(ivaManual)}</Text>
                  </div>
                )}
                {isDetallada && impInternoCalculado > 0 && (
                  <div className="nsm-total-line">
                    <Text type="secondary">Imp. Int.</Text>
                    <Text>{fmtMoney(r2(impInternoCalculado))}</Text>
                  </div>
                )}
                {percepcionIva > 0 && (
                  <div className="nsm-total-line">
                    <Text type="secondary">Perc. IVA</Text>
                    <Text>{fmtMoney(percepcionIva)}</Text>
                  </div>
                )}
                {percepcionIibb > 0 && (
                  <div className="nsm-total-line">
                    <Text type="secondary">Perc. IIBB</Text>
                    <Text>{fmtMoney(percepcionIibb)}</Text>
                  </div>
                )}
                <Divider style={{ margin: '8px 0' }} />
                <div className="nsm-total-final">
                  <span>TOTAL</span>
                  <span className="nsm-total-amount">{fmtMoney(total)}</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="nsm-actions">
                {esCtaCorriente ? (
                  <Button
                    block
                    size="large"
                    onClick={goToPayment}
                    loading={checkingSaldo}
                    disabled={cart.length === 0 || !proveedorId}
                    style={{ height: 48 }}
                  >
                    Registrar Compra (Cta. Cte.)
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    block
                    size="large"
                    className="btn-gold nsm-btn-cobrar"
                    onClick={goToPayment}
                    disabled={cart.length === 0 || !proveedorId}
                    icon={<ShoppingCartOutlined />}
                  >
                    Continuar al Pago {fmtMoney(total)}
                  </Button>
                )}
              </div>
            </>
          ) : (
            /* ── STEP 2: Payment ──────────────────── */
            <>
              <div className="npm-sidebar-scroll">
              {/* Total a pagar */}
              <div className="nsm-cobro-total-box">
                <Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Total a pagar
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
                        if (pagoValido) handleSubmit();
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

              {/* Payment destination */}
              <div className="nsm-field-group">
                <label className="nsm-label">Origen del pago</label>
                <Segmented
                  value={destinoPago}
                  onChange={val => setDestinoPago(val as 'CAJA_CENTRAL' | 'CAJA')}
                  options={[
                    {
                      value: 'CAJA_CENTRAL',
                      label: (
                        <Space>
                          <BankOutlined />
                          <span>Caja Central</span>
                        </Space>
                      ),
                    },
                    ...(miCaja ? [{
                      value: 'CAJA',
                      label: (
                        <Space>
                          <InboxOutlined />
                          <span>Mi Caja</span>
                        </Space>
                      ),
                    }] : []),
                  ]}
                  block
                />
                {!miCaja && (
                  <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                    No tenés una caja abierta — el egreso se registra en Caja Central
                  </Text>
                )}
              </div>

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
              </div>{/* /npm-sidebar-scroll */}

              {/* Cobro action buttons */}
              <div className="nsm-actions">
                <Button
                  type="primary"
                  block
                  size="large"
                  className="btn-gold nsm-btn-cobrar"
                  onClick={handleSubmit}
                  loading={createMutation.isPending}
                  disabled={!pagoValido}
                  icon={<CheckCircleOutlined />}
                >
                  Confirmar Compra
                </Button>
                <Button
                  block
                  size="large"
                  onClick={() => setStep('cart')}
                  icon={<ArrowLeftOutlined />}
                  style={{ height: 44 }}
                >
                  Volver al detalle
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
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
              setMontosPorMetodo(prev => {
                const next: Record<number, number> = {};
                for (const id of metodoModalSelection) {
                  next[id] = prev[id] || 0;
                }
                return next;
              });
              setMetodoModalOpen(false);
              setStep('pago');
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
          Seleccione uno o más métodos. Si elige varios, podrá distribuir los montos.
        </Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {metodosPagoOrdenados.map(m => {
            const isSelected = metodoModalSelection.includes(m.METODO_PAGO_ID);
            return (
              <div
                key={m.METODO_PAGO_ID}
                onClick={() => {
                  setMetodoModalSelection(prev =>
                    isSelected
                      ? prev.filter(id => id !== m.METODO_PAGO_ID)
                      : [...prev, m.METODO_PAGO_ID]
                  );
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
                El proveedor tiene un saldo a favor de <Text strong style={{ color: '#52c41a' }}>{fmtMoney(saldoInfo.creditoDisponible)}</Text> en su cuenta corriente.
              </Text>
              <Text>
                Se utilizará el saldo para cubrir el total de la compra de <Text strong>{fmtMoney(total)}</Text>.
                La compra quedará registrada como <Tag color="green">PAGADA</Tag>.
              </Text>
              <div style={{ background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Saldo anterior:</Text>
                  <Text strong>{fmtMoney(saldoInfo.creditoDisponible)}</Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Monto compra:</Text>
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
                El proveedor tiene un saldo a favor de <Text strong style={{ color: '#52c41a' }}>{fmtMoney(saldoInfo.creditoDisponible)}</Text> en su cuenta corriente.
              </Text>
              <Text>
                Se aplicará como anticipo parcial. Quedan pendientes <Text strong style={{ color: '#cf1322' }}>{fmtMoney(total - saldoInfo.creditoDisponible)}</Text>.
              </Text>
              <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 6, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Monto compra:</Text>
                  <Text strong>{fmtMoney(total)}</Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Saldo aplicado:</Text>
                  <Text strong style={{ color: '#52c41a' }}>-{fmtMoney(saldoInfo.creditoDisponible)}</Text>
                </div>
                <Divider style={{ margin: '6px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Text type="secondary">Pendiente de pago:</Text>
                  <Text strong style={{ color: '#cf1322' }}>{fmtMoney(total - saldoInfo.creditoDisponible)}</Text>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
    </>
  );
}
