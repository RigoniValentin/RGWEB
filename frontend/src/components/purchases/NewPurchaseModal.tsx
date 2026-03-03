import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Modal, Input, Select, Button, InputNumber, Table, Space, Typography,
  Divider, message, AutoComplete, Tag, Checkbox, Segmented,
} from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, ShoppingCartOutlined,
  MinusOutlined, BarcodeOutlined, ShopOutlined,
  ArrowLeftOutlined, CheckCircleOutlined,
  DollarOutlined, CreditCardOutlined, WalletOutlined,
  BankOutlined, InboxOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { purchasesApi } from '../../services/purchases.api';
import { cajaApi } from '../../services/caja.api';
import { fmtMoney } from '../../utils/format';
import type { CompraItemInput, CompraInput, ProductoSearchCompra } from '../../types';

const { Title, Text } = Typography;

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

type ModalStep = 'cart' | 'pago';
type MetodoPago = 'efectivo' | 'digital' | 'mixto';

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
  const [tipoCarga, setTipoCarga] = useState<'simple' | 'detallada'>('simple');
  const [impIntGravaIva, setImpIntGravaIva] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchOptions, setSearchOptions] = useState<{ value: string; label: React.ReactNode; product: ProductoSearchCompra }[]>([]);
  const searchRef = useRef<any>(null);

  // Payment step state
  const [step, setStep] = useState<ModalStep>('cart');
  const [metodoPago, setMetodoPago] = useState<MetodoPago>('efectivo');
  const [pagoEfectivo, setPagoEfectivo] = useState(0);
  const [pagoDigital, setPagoDigital] = useState(0);
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

  // Set default deposit
  useEffect(() => {
    if (depositos.length > 0 && !depositoId) {
      setDepositoId(depositos[0]!.DEPOSITO_ID);
    }
  }, [depositos]);

  // ── Product search ─────────────────────────────
  const handleSearch = useCallback(async (value: string) => {
    setSearchText(value);
    if (!value || value.length < 1) {
      setSearchOptions([]);
      return;
    }
    try {
      const products = await purchasesApi.searchProducts(value);
      const opts = products.map((p) => ({
        value: `${p.PRODUCTO_ID}`,
        label: (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span>
              <BarcodeOutlined style={{ marginRight: 4, color: '#999' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>{p.CODIGOPARTICULAR}</Text>
              {' '}
              {p.NOMBRE}
            </span>
            <span style={{ whiteSpace: 'nowrap' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>Stock: {p.STOCK}</Text>
              {' · '}
              <Text strong>{fmtMoney(p.PRECIO_COMPRA)}</Text>
            </span>
          </div>
        ),
        product: p,
      }));
      setSearchOptions(opts);
    } catch {
      setSearchOptions([]);
    }
  }, []);

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
      } else {
        const newItem: CartItem = {
          key: `${p.PRODUCTO_ID}-${Date.now()}`,
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
      } else {
        const ivaAliN = p.IVA_PORCENTAJE / 100;
        const extractIva = tipoComprobante === 'FA' && ivaIncluido;
        const newItem: CartItem = {
          key: `${p.PRODUCTO_ID}-${Date.now()}`,
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
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [cart, depositoId, tipoComprobante, ivaIncluido, isDetallada]);

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
    const pagado = (metodoPago === 'efectivo' ? pagoEfectivo : metodoPago === 'digital' ? pagoDigital : pagoEfectivo + pagoDigital);
    return Math.max(0, Math.round((pagado - total) * 100) / 100);
  }, [pagoEfectivo, pagoDigital, total, metodoPago, esCtaCorriente]);

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
    setTipoCarga('simple');
    setImpIntGravaIva(false);
    setSearchText('');
    setSearchOptions([]);
    setStep('cart');
    setMetodoPago('efectivo');
    setPagoEfectivo(0);
    setPagoDigital(0);
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

    const montoEfectivo = esCtaCorriente ? 0
      : metodoPago === 'efectivo' ? pagoEfectivo
      : metodoPago === 'mixto' ? pagoEfectivo : 0;

    const montoDigital = esCtaCorriente ? 0
      : metodoPago === 'digital' ? pagoDigital
      : metodoPago === 'mixto' ? pagoDigital : 0;

    const payload: CompraInput = {
      PROVEEDOR_ID: proveedorId,
      TIPO_COMPROBANTE: tipoComprobante,
      PTO_VTA: ptoVta,
      NRO_COMPROBANTE: nroComprobante,
      ES_CTA_CORRIENTE: esCtaCorriente,
      MONTO_EFECTIVO: montoEfectivo,
      MONTO_DIGITAL: montoDigital,
      VUELTO: vuelto,
      COBRADA: !esCtaCorriente,
      PRECIOS_SIN_IVA: isDetallada ? !isFacturaA : (isFacturaA ? !ivaIncluido : true),
      IMP_INT_GRAVA_IVA: isDetallada ? impIntGravaIva : false,
      PERCEPCION_IVA: percepcionIva,
      PERCEPCION_IIBB: percepcionIibb,
      IVA_TOTAL: isDetallada && isFacturaA ? r2(ivaCalculado) : (isFacturaA ? ivaManual : 0),
      ACTUALIZAR_COSTOS: actualizarCostos,
      ACTUALIZAR_PRECIOS: actualizarPrecios,
      DESTINO_PAGO: esCtaCorriente ? undefined : destinoPago,
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

    setStep('pago');
    setPagoEfectivo(total);
    setPagoDigital(0);
    setTimeout(() => efectivoRef.current?.focus(), 100);
  };

  // Confirmed save after saldo modal (or direct cta cte save)
  const doSaveCtaCte = () => {
    setSaldoModalOpen(false);
    setSaldoInfo(null);
    handleSubmit();
  };

  // ── Item columns ───────────────────────────────
  const cartColumns = isDetallada ? [
    // ── DETAILED MODE COLUMNS ──
    {
      title: 'Código', dataIndex: 'CODIGO', width: 80, align: 'center' as const,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: 'Producto', dataIndex: 'NOMBRE', ellipsis: true },
    {
      title: 'P. Compra', width: 110, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <InputNumber
          size="small"
          value={record.PRECIO_COMPRA}
          min={0}
          step={0.01}
          onChange={val => updateCartItem(record.key, 'PRECIO_COMPRA', val || 0)}
          style={{ width: 95 }}
          controls={false}
          prefix="$"
        />
      ),
    },
    {
      title: 'Cant.', dataIndex: 'CANTIDAD', width: 90, align: 'center' as const,
      render: (_: number, record: CartItem) => (
        <InputNumber
          size="small"
          value={record.CANTIDAD}
          min={0.01}
          step={1}
          onChange={val => updateCartItem(record.key, 'CANTIDAD', val || 1)}
          style={{ width: 70 }}
          controls={false}
        />
      ),
    },
    {
      title: 'Bonif.%', width: 75, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <InputNumber
          size="small"
          value={record.BONIFICACION}
          min={0}
          max={100}
          step={1}
          onChange={val => updateCartItem(record.key, 'BONIFICACION', val || 0)}
          style={{ width: 58 }}
          controls={false}
        />
      ),
    },
    {
      title: 'Imp.Int.', width: 90, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <InputNumber
          size="small"
          value={record.IMP_INTERNOS}
          min={0}
          step={0.01}
          onChange={val => updateCartItem(record.key, 'IMP_INTERNOS', val || 0)}
          style={{ width: 75 }}
          controls={false}
          prefix="$"
        />
      ),
    },
    ...(isFacturaA ? [{
      title: 'IVA %', width: 60, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <Text type="secondary">{((record.IVA_ALICUOTA || 0) * 100).toFixed(0)}%</Text>
      ),
    }] : []),
    {
      title: 'Total s/Imp', width: 100, align: 'right' as const,
      render: (_: unknown, record: CartItem) => (
        <Text strong>{fmtMoney(record.PRECIO_FINAL)}</Text>
      ),
    },
    {
      title: '', width: 40, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <DeleteOutlined
          style={{ cursor: 'pointer', color: '#ff4d4f' }}
          onClick={() => removeCartItem(record.key)}
        />
      ),
    },
  ] : [
    // ── SIMPLE MODE COLUMNS (current) ──
    {
      title: 'Código', dataIndex: 'CODIGO', width: 80, align: 'center' as const,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: 'Producto', dataIndex: 'NOMBRE', ellipsis: true },
     {
      title: 'P. Unit.', width: 100, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <Text type="secondary">{fmtMoney(record.PRECIO_COMPRA)}</Text>
      ),
    },
    {
      title: 'Cantidad', dataIndex: 'CANTIDAD', width: 130, align: 'center' as const,
      render: (_: number, record: CartItem) => (
        <Space size={4}>
          <Button
            size="small" type="text" icon={<MinusOutlined />}
            onClick={() => {
              if (record.CANTIDAD <= 1) removeCartItem(record.key);
              else updateCartItem(record.key, 'CANTIDAD', record.CANTIDAD - 1);
            }}
          />
          <InputNumber
            size="small"
            value={record.CANTIDAD}
            min={0.01}
            step={1}
            onChange={val => updateCartItem(record.key, 'CANTIDAD', val || 1)}
            style={{ width: 60 }}
            controls={false}
          />
          <Button
            size="small" type="text" icon={<PlusOutlined />}
            onClick={() => updateCartItem(record.key, 'CANTIDAD', record.CANTIDAD + 1)}
          />
        </Space>
      ),
    },
    {
      title: 'Precio Final', width: 130, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <InputNumber
          size="small"
          value={record.PRECIO_FINAL}
          min={0}
          step={0.01}
          onChange={val => updateCartItem(record.key, 'PRECIO_FINAL', val || 0)}
          style={{ width: 110 }}
          controls={false}
          prefix="$"
        />
      ),
    },
   
    ...(isFacturaA ? [{
      title: 'IVA %', width: 70, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <Text type="secondary">{((record.IVA_ALICUOTA || 0) * 100).toFixed(0)}%</Text>
      ),
    }] : []),
    {
      title: '', width: 40, align: 'center' as const,
      render: (_: unknown, record: CartItem) => (
        <DeleteOutlined
          style={{ cursor: 'pointer', color: '#ff4d4f' }}
          onClick={() => removeCartItem(record.key)}
        />
      ),
    },
  ];

  // ── Render cart step ───────────────────────────
  const renderCartStep = () => (
    <>
      {/* ── Header controls ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Select
          showSearch
          placeholder="Proveedor"
          optionFilterProp="label"
          value={proveedorId}
          onChange={val => setProveedorId(val)}
          style={{ minWidth: 250, flex: 1 }}
          options={proveedores.map(p => ({
            value: p.PROVEEDOR_ID,
            label: `${p.CODIGOPARTICULAR} - ${p.NOMBRE}`,
          }))}
          suffixIcon={<ShopOutlined />}
        />
        <Select
          placeholder="Depósito"
          value={depositoId}
          onChange={val => setDepositoId(val)}
          style={{ width: 180 }}
          options={depositos.map(d => ({
            value: d.DEPOSITO_ID,
            label: d.NOMBRE,
          }))}
        />
      </div>

      {/* ── Comprobante info ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
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
          style={{ width: 120 }}
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
        <Input
          value={ptoVta}
          onChange={e => setPtoVta(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
          onBlur={() => setPtoVta(prev => prev.padStart(4, '0'))}
          onFocus={e => e.target.select()}
          style={{ width: 65, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}
          maxLength={4}
        />
        <span style={{ fontFamily: 'monospace', fontSize: 16, lineHeight: '32px', userSelect: 'none' }}>-</span>
        <Input
          value={nroComprobante}
          onChange={e => setNroComprobante(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
          onBlur={() => setNroComprobante(prev => prev.padStart(8, '0'))}
          onFocus={e => e.target.select()}
          style={{ width: 110, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}
          maxLength={8}
        />
        <Divider type="vertical" />
        {isFacturaA && !isDetallada && (
          <Checkbox checked={ivaIncluido} onChange={e => setIvaIncluido(e.target.checked)}>
            IVA incluido
          </Checkbox>
        )}
        <Checkbox checked={esCtaCorriente} onChange={e => setEsCtaCorriente(e.target.checked)}>
          Cta. Corriente
        </Checkbox>
      </div>

      {/* ── Tipo de carga toggle ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Text type="secondary" style={{ fontSize: 13 }}>Tipo de carga:</Text>
        <Segmented
          value={tipoCarga}
          onChange={val => {
            const v = val as 'simple' | 'detallada';
            if (v === 'simple' && isFacturaA) {
              message.info('Factura A requiere carga detallada');
              return;
            }
            setTipoCarga(v);
            // When switching, clear cart to avoid inconsistencies
            if (cart.length > 0) setCart([]);
          }}
          options={[
            { value: 'simple', label: 'Simple' },
            { value: 'detallada', label: 'Detallada' },
          ]}
          size="small"
        />
        {isDetallada && (
          <Checkbox checked={impIntGravaIva} onChange={e => setImpIntGravaIva(e.target.checked)}>
            Imp. Int. grava IVA
          </Checkbox>
        )}
      </div>

      {/* ── Product search ── */}
      <AutoComplete
        ref={searchRef}
        value={searchText}
        options={searchOptions}
        onSearch={handleSearch}
        onSelect={handleSelectProduct}
        placeholder="Buscar producto por código o nombre..."
        style={{ width: '100%', marginBottom: 12 }}
      >
        <Input prefix={<SearchOutlined />} size="large" />
      </AutoComplete>

      {/* ── Cart table ── */}
      <Table
        dataSource={cart}
        columns={cartColumns}
        rowKey="key"
        size="small"
        pagination={false}
        scroll={{ y: 300 }}
        locale={{ emptyText: 'Agregue productos a la compra' }}
      />

      {/* ── Percepciones & Cost Update ── */}
      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {isFacturaA && !isDetallada && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Text type="secondary">IVA:</Text>
            <InputNumber
              size="small"
              value={ivaManual}
              min={0}
              onChange={val => setIvaManual(val || 0)}
              style={{ width: 100 }}
              prefix="$"
              controls={false}
            />
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Text type="secondary">Perc. IVA:</Text>
          <InputNumber
            size="small"
            value={percepcionIva}
            min={0}
            onChange={val => setPercepcionIva(val || 0)}
            style={{ width: 90 }}
            prefix="$"
            controls={false}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Text type="secondary">Perc. IIBB:</Text>
          <InputNumber
            size="small"
            value={percepcionIibb}
            min={0}
            onChange={val => setPercepcionIibb(val || 0)}
            style={{ width: 90 }}
            prefix="$"
            controls={false}
          />
        </div>
        <Divider type="vertical" />
        <Checkbox checked={actualizarCostos} onChange={e => setActualizarCostos(e.target.checked)}>
          Actualizar costos
        </Checkbox>
        <Checkbox checked={actualizarPrecios} onChange={e => setActualizarPrecios(e.target.checked)} disabled={!actualizarCostos}>
          Actualizar precios
        </Checkbox>
      </div>

      {/* ── Footer totals ── */}
      <Divider />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Text type="secondary" style={{ display: 'block' }}>Subtotal: {fmtMoney(subtotal)}</Text>
          {isDetallada && isFacturaA && ivaCalculado > 0 && (
            <Text type="secondary" style={{ display: 'block' }}>IVA: {fmtMoney(r2(ivaCalculado))}</Text>
          )}
          {!isDetallada && isFacturaA && ivaManual > 0 && (
            <Text type="secondary" style={{ display: 'block' }}>IVA: {fmtMoney(ivaManual)}</Text>
          )}
          {isDetallada && impInternoCalculado > 0 && (
            <Text type="secondary" style={{ display: 'block' }}>Imp. Int.: {fmtMoney(r2(impInternoCalculado))}</Text>
          )}
          {percepcionIva > 0 && <Text type="secondary" style={{ display: 'block' }}>Perc. IVA: {fmtMoney(percepcionIva)}</Text>}
          {percepcionIibb > 0 && <Text type="secondary" style={{ display: 'block' }}>Perc. IIBB: {fmtMoney(percepcionIibb)}</Text>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <Text style={{ fontSize: 14 }}>TOTAL</Text>
          <Title level={2} style={{ margin: 0, color: '#EABD23' }}>
            {fmtMoney(total)}
          </Title>
        </div>
      </div>
    </>
  );

  // ── Render payment step ────────────────────────
  const renderPaymentStep = () => {
    const pagado = metodoPago === 'efectivo'
      ? pagoEfectivo
      : metodoPago === 'digital'
        ? pagoDigital
        : pagoEfectivo + pagoDigital;

    const faltante = Math.max(0, Math.round((total - pagado) * 100) / 100);

    return (
      <>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => setStep('cart')}
          style={{ marginBottom: 16 }}
        >
          Volver al detalle
        </Button>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Text type="secondary">Total a pagar</Text>
          <Title level={2} style={{ margin: '4px 0 0', color: '#EABD23' }}>
            {fmtMoney(total)}
          </Title>
        </div>

        {/* Method selector */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 24 }}>
          {(['efectivo', 'digital', 'mixto'] as MetodoPago[]).map(m => (
            <Button
              key={m}
              type={metodoPago === m ? 'primary' : 'default'}
              className={metodoPago === m ? 'btn-gold' : ''}
              icon={m === 'efectivo' ? <WalletOutlined /> : m === 'digital' ? <CreditCardOutlined /> : <DollarOutlined />}
              onClick={() => { setMetodoPago(m); if (m === 'efectivo') setPagoEfectivo(total); if (m === 'digital') setPagoDigital(total); }}
              style={{ textTransform: 'capitalize' }}
            >
              {m === 'efectivo' ? 'Efectivo' : m === 'digital' ? 'Digital' : 'Mixto'}
            </Button>
          ))}
        </div>

        {/* Payment destination selector */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>Origen del pago</Text>
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
          />
          {!miCaja && (
            <div style={{ marginTop: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>No tenés una caja abierta — el egreso se registra en Caja Central</Text>
            </div>
          )}
        </div>

        {/* Payment fields */}
        <div style={{ maxWidth: 350, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {(metodoPago === 'efectivo' || metodoPago === 'mixto') && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Efectivo</Text>
              <InputNumber
                ref={efectivoRef}
                value={pagoEfectivo}
                onChange={val => setPagoEfectivo(val || 0)}
                min={0}
                style={{ width: '100%' }}
                prefix="$"
                size="large"
                controls={false}
              />
            </div>
          )}
          {(metodoPago === 'digital' || metodoPago === 'mixto') && (
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Digital</Text>
              <InputNumber
                value={pagoDigital}
                onChange={val => setPagoDigital(val || 0)}
                min={0}
                style={{ width: '100%' }}
                prefix="$"
                size="large"
                controls={false}
              />
            </div>
          )}
          {vuelto > 0 && (
            <div style={{ textAlign: 'center', padding: 12, background: '#f6ffed', borderRadius: 8 }}>
              <Text type="secondary">Vuelto</Text>
              <Title level={4} style={{ margin: 0, color: '#52c41a' }}>
                {fmtMoney(vuelto)}
              </Title>
            </div>
          )}
          {faltante > 0 && (
            <div style={{ textAlign: 'center', padding: 12, background: '#fff2e8', borderRadius: 8 }}>
              <Text type="secondary">Faltante</Text>
              <Title level={4} style={{ margin: 0, color: '#fa8c16' }}>
                {fmtMoney(faltante)}
              </Title>
            </div>
          )}
        </div>
      </>
    );
  };

  return (
    <>
    <Modal
      open={open}
      onCancel={handleClose}
      width={step === 'cart' ? (isDetallada ? 1150 : 1050) : 500}
      centered
      destroyOnClose
      title={
        <Space>
          <ShoppingCartOutlined style={{ color: '#EABD23' }} />
          <span>{step === 'cart' ? 'Nueva Compra' : 'Registrar Pago'}</span>
          {cart.length > 0 && <Tag color="gold">{cart.length} ítems</Tag>}
        </Space>
      }
      footer={
        step === 'cart' ? (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={handleClose}>Cancelar</Button>
            <Button
              type="primary"
              className="btn-gold"
              icon={<CheckCircleOutlined />}
              disabled={cart.length === 0 || !proveedorId}
              onClick={goToPayment}
              loading={checkingSaldo}
            >
              {esCtaCorriente ? 'Registrar Compra' : 'Continuar al Pago'}
            </Button>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={() => setStep('cart')} icon={<ArrowLeftOutlined />}>
              Volver
            </Button>
            <Button
              type="primary"
              className="btn-gold"
              icon={<CheckCircleOutlined />}
              loading={createMutation.isPending}
              onClick={handleSubmit}
            >
              Confirmar Compra
            </Button>
          </div>
        )
      }
    >
      {step === 'cart' ? renderCartStep() : renderPaymentStep()}
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
