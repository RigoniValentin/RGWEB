import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Modal, Input, Select, Button, InputNumber, Table, Space, Typography,
  Divider, Spin, Switch, message, AutoComplete, Badge, Tag,
} from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, ShoppingCartOutlined,
  UserOutlined, MinusOutlined, BarcodeOutlined, ShopOutlined,
  FileTextOutlined, SwapOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { salesApi } from '../../services/sales.api';
import { useAuthStore } from '../../store/authStore';
import { fmtMoney } from '../../utils/format';
import type { VentaItemInput, ProductoSearch, VentaInput, ClienteVenta } from '../../types';

const { Title, Text } = Typography;

interface CartItem extends VentaItemInput {
  key: string;
  NOMBRE: string;
  CODIGO: string;
  STOCK: number;
  UNIDAD: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function NewSaleModal({ open, onClose, onSuccess }: Props) {
  const { puntoVentaActivo } = useAuthStore();
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clienteId, setClienteId] = useState<number>(1);
  const [depositoId, setDepositoId] = useState<number | null>(null);
  const [tipoComprobante, setTipoComprobante] = useState<string>('');
  const [esCtaCorriente, setEsCtaCorriente] = useState(false);
  const [dtoGral, setDtoGral] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [searchOptions, setSearchOptions] = useState<{ value: string; label: React.ReactNode; product: ProductoSearch }[]>([]);
  const searchRef = useRef<any>(null);

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
    if (!empresaIva?.CONDICION_IVA) return '';
    const empresaCond = empresaIva.CONDICION_IVA.toUpperCase();

    if (empresaCond === 'MONOTRIBUTO') return 'Fa.C';

    if (empresaCond === 'RESPONSABLE INSCRIPTO') {
      const clienteCond = (selectedCliente?.CONDICION_IVA || '').toUpperCase();
      return clienteCond === 'RESPONSABLE INSCRIPTO' ? 'Fa.A' : 'Fa.B';
    }
    return '';
  }, [empresaIva, selectedCliente]);

  useEffect(() => {
    if (comprobanteAutoValue) {
      setTipoComprobante(comprobanteAutoValue);
    }
  }, [comprobanteAutoValue]);

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
    onSuccess: (result) => {
      message.success(`Venta #${result.VENTA_ID} creada — Total: ${fmtMoney(result.TOTAL)}`);
      resetForm();
      onSuccess();
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al crear la venta');
    },
  });

  const resetForm = useCallback(() => {
    setCart([]);
    setClienteId(1);
    setDepositoId(null);
    setTipoComprobante('');
    setEsCtaCorriente(false);
    setDtoGral(0);
    setSearchText('');
    setSearchOptions([]);
  }, []);

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
      return [...prev, {
        key: `${product.PRODUCTO_ID}-${Date.now()}`,
        PRODUCTO_ID: product.PRODUCTO_ID,
        NOMBRE: product.NOMBRE,
        CODIGO: product.CODIGOPARTICULAR,
        PRECIO_UNITARIO: product.PRECIO_VENTA,
        CANTIDAD: 1,
        DESCUENTO: 0,
        PRECIO_COMPRA: product.PRECIO_COMPRA || 0,
        STOCK: product.STOCK,
        UNIDAD: product.UNIDAD_ABREVIACION || 'u',
        DEPOSITO_ID: depositoId || undefined,
        LISTA_ID: product.LISTA_DEFECTO || 1,
      }];
    });
    setSearchText('');
    setSearchOptions([]);
    setTimeout(() => searchRef.current?.focus(), 100);
  }, [depositoId]);

  // Barcode quick-pick: on Enter, search immediately and auto-add if single result
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
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
  }, [searchText, addProduct, doSearch]);

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

    const input: VentaInput = {
      CLIENTE_ID: clienteId,
      PUNTO_VENTA_ID: puntoVentaActivo || 1,
      TIPO_COMPROBANTE: tipoComprobante || undefined,
      ES_CTA_CORRIENTE: esCtaCorriente,
      DTO_GRAL: dtoGral,
      COBRADA: cobrar,
      MONTO_EFECTIVO: cobrar ? total : 0,
      MONTO_DIGITAL: 0,
      VUELTO: 0,
      items: cart.map(({ PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, DESCUENTO, PRECIO_COMPRA, DEPOSITO_ID, LISTA_ID }) => ({
        PRODUCTO_ID,
        PRECIO_UNITARIO,
        CANTIDAD,
        DESCUENTO,
        PRECIO_COMPRA,
        DEPOSITO_ID,
        LISTA_ID,
      })),
    };
    createMutation.mutate(input);
  };

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
          onChange={(v) => updateCartItem(record.key, 'PRECIO_UNITARIO', v || 0)}
        />
      ),
    },
    {
      title: 'CANT.', dataIndex: 'CANTIDAD', key: 'qty', width: 140,
      render: (val: number, record: CartItem) => (
        <Space size={4}>
          <Button size="small" icon={<MinusOutlined />}
            onClick={() => updateCartItem(record.key, 'CANTIDAD', Math.max(0.01, val - 1))}
            style={{ borderColor: '#d9d9d9' }}
          />
          <InputNumber value={val} min={0.01} step={1} size="middle" style={{ width: 64 }}
            onChange={(v) => updateCartItem(record.key, 'CANTIDAD', v || 1)} />
          <Button size="small" icon={<PlusOutlined />}
            onClick={() => updateCartItem(record.key, 'CANTIDAD', val + 1)}
            style={{ borderColor: '#d9d9d9' }}
          />
        </Space>
      ),
    },
    {
      title: 'DTO %', dataIndex: 'DESCUENTO', key: 'discount', width: 90,
      render: (val: number, record: CartItem) => (
        <InputNumber value={val} min={0} max={100} size="middle" style={{ width: '100%' }}
          onChange={(v) => updateCartItem(record.key, 'DESCUENTO', v || 0)} />
      ),
    },
    {
      title: 'SUBTOTAL', key: 'sub', width: 120, align: 'right' as const,
      render: (_: unknown, record: CartItem) => {
        const precio = record.DESCUENTO > 0
          ? record.PRECIO_UNITARIO * (1 - record.DESCUENTO / 100)
          : record.PRECIO_UNITARIO;
        return <Text strong style={{ fontSize: 14 }}>{fmtMoney(precio * record.CANTIDAD)}</Text>;
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
          <ShoppingCartOutlined className="nsm-header-icon" />
          <Title level={4} style={{ margin: 0, color: '#fff' }}>Nueva Venta</Title>
        </div>
        <Button
          type="text"
          onClick={handleClose}
          style={{ color: 'rgba(255,255,255,0.6)', fontSize: 22, lineHeight: 1 }}
        >
          ✕
        </Button>
      </div>

      <div className="nsm-body">
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
              Escanee o ingrese el código y presione Enter para agregar rápidamente
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

        {/* ══ RIGHT COLUMN — Config + Totals ═══════ */}
        <div className="nsm-sidebar">
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

          {/* Cta Corriente switch */}
          <div className="nsm-field-group">
            <div className="nsm-switch-row">
              <Switch size="default" checked={esCtaCorriente} onChange={setEsCtaCorriente} />
              <span className="nsm-switch-label">
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
        </div>
      </div>
    </Modal>
  );
}
