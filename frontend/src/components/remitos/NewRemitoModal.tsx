import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Modal, Select, Button, InputNumber, Table, Space, Typography,
  message, Input, DatePicker, Divider, Checkbox, Radio,
} from 'antd';
import {
  DeleteOutlined, SearchOutlined,
  ImportOutlined, ExportOutlined, PrinterOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { remitosApi } from '../../services/remitos.api';
import { settingsApi } from '../../services/settings.api';
import type { RemitoInput, RemitoItemInput, ProductoSearch } from '../../types';
import { fmtMoney, fmtNum } from '../../utils/format';
import { ProductSearchModal } from '../ProductSearchModal';
import { generateRemitoPdf, type CopiasTipo } from './remitoPdf.js';
import dayjs from 'dayjs';

const { Text } = Typography;
const { TextArea } = Input;

interface RemitoItemRow extends RemitoItemInput {
  key: string;
  NOMBRE?: string;
  CODIGO?: string;
  STOCK?: number;
  UNIDAD_ABREVIACION?: string;
}

interface Props {
  open: boolean;
  tipo: 'ENTRADA' | 'SALIDA';
  onClose: () => void;
  onSuccess: () => void;
}

export function NewRemitoModal({ open, tipo, onClose, onSuccess }: Props) {
  const [items, setItems] = useState<RemitoItemRow[]>([]);
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [proveedorId, setProveedorId] = useState<number | null>(null);
  const [depositoId, setDepositoId] = useState<number | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [fecha, setFecha] = useState<string>(dayjs().format('YYYY-MM-DD'));
  const [ptoVta, setPtoVta] = useState('0001');

  // Print options
  const [printAfterCreate, setPrintAfterCreate] = useState(true);
  const [printCopias, setPrintCopias] = useState<CopiasTipo>('original');

  // Product search
  const [searchText, setSearchText] = useState('');
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearchInitial, setProductSearchInitial] = useState('');
  const productSearchKey = useRef(0);
  const searchRef = useRef<any>(null);

  // Fetch empresa data to preset PTO_VTA
  const { data: empresaData } = useQuery({
    queryKey: ['remitos-empresa'],
    queryFn: () => remitosApi.getEmpresaData(),
    staleTime: Infinity,
  });

  const defaultPtoVta = empresaData?.PUNTO_VENTA?.padStart(4, '0') || '0001';

  // Reset on open
  useEffect(() => {
    if (open) {
      setItems([]);
      setClienteId(null);
      setProveedorId(null);
      setDepositoId(null);
      setObservaciones('');
      setFecha(dayjs().format('YYYY-MM-DD'));
      setPtoVta(defaultPtoVta);
      setProductSearchOpen(false);
      setProductSearchInitial('');
      setSearchText('');
    }
  }, [open, defaultPtoVta]);

  // Queries
  const { data: clientes = [] } = useQuery({
    queryKey: ['remitos-clientes'],
    queryFn: () => remitosApi.getClientes(),
    enabled: open,
    staleTime: 60000,
  });

  const { data: proveedores = [] } = useQuery({
    queryKey: ['remitos-proveedores'],
    queryFn: () => remitosApi.getProveedores(),
    enabled: open,
    staleTime: 60000,
  });

  const { data: depositos = [] } = useQuery({
    queryKey: ['remitos-depositos'],
    queryFn: () => remitosApi.getDepositos(),
    enabled: open,
    staleTime: 60000,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: RemitoInput) => remitosApi.create(data),
    onSuccess: async (result) => {
      message.success(`Remito ${tipo} ${result.PTO_VTA}-${result.NRO_REMITO} creado`);
      if (printAfterCreate && result.REMITO_ID) {
        try {
          const [detail, empresa, logoDataUrl] = await Promise.all([
            remitosApi.getById(result.REMITO_ID),
            remitosApi.getEmpresaData(),
            settingsApi.getLogoDataUrl(),
          ]);
          generateRemitoPdf(detail, empresa, printCopias, logoDataUrl);
        } catch {
          message.warning('Remito creado pero no se pudo generar el PDF');
        }
      }
      onSuccess();
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al crear remito');
    },
  });

  // Add product to items
  const addProduct = useCallback((product: ProductoSearch) => {
    const exists = items.find(i => i.PRODUCTO_ID === product.PRODUCTO_ID);
    if (exists) {
      setItems(prev => prev.map(i =>
        i.PRODUCTO_ID === product.PRODUCTO_ID
          ? { ...i, CANTIDAD: i.CANTIDAD + 1 }
          : i
      ));
      return;
    }

    const newItem: RemitoItemRow = {
      key: `${product.PRODUCTO_ID}-${Date.now()}`,
      PRODUCTO_ID: product.PRODUCTO_ID,
      CANTIDAD: 1,
      PRECIO_UNITARIO: tipo === 'SALIDA' ? product.PRECIO_VENTA : product.PRECIO_COMPRA,
      NOMBRE: product.NOMBRE,
      CODIGO: product.CODIGOPARTICULAR,
      STOCK: product.STOCK,
      UNIDAD_ABREVIACION: product.UNIDAD_ABREVIACION,
    };
    setItems(prev => [...prev, newItem]);
    setSearchText('');
  }, [items, tipo]);

  // Handle Enter on search: quick search first, open advanced modal if ambiguous
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    const text = searchText.trim();
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();

    // Quick search to try auto-add
    remitosApi.searchProducts(text).then(products => {
      if (products.length === 1) {
        // Single match — add directly
        const p = products[0]!;
        addProduct({
          ...p,
          LISTA_DEFECTO: 0,
          IMP_INT: 0,
          TASA_IVA_ID: null,
          UNIDAD_ID: p.UNIDAD_ID ?? null,
          IVA_PORCENTAJE: 0,
        } as ProductoSearch);
      } else if (products.length > 1) {
        // Check for exact code match
        const exact = products.find(
          p => p.CODIGOPARTICULAR?.toUpperCase() === text.toUpperCase()
        );
        if (exact) {
          addProduct({
            ...exact,
            LISTA_DEFECTO: 0,
            IMP_INT: 0,
            TASA_IVA_ID: null,
            UNIDAD_ID: exact.UNIDAD_ID ?? null,
            IVA_PORCENTAJE: 0,
          } as ProductoSearch);
        } else {
          // Ambiguous — open advanced search
          setProductSearchInitial(text);
          productSearchKey.current += 1;
          setProductSearchOpen(true);
          setSearchText('');
        }
      } else {
        // No results — open advanced search
        setProductSearchInitial(text);
        productSearchKey.current += 1;
        setProductSearchOpen(true);
        setSearchText('');
      }
    });
  }, [searchText, addProduct]);

  // Remove item
  const removeItem = (key: string) => {
    setItems(prev => prev.filter(i => i.key !== key));
  };

  // Update item quantity
  const updateQuantity = (key: string, cantidad: number) => {
    setItems(prev => prev.map(i => i.key === key ? { ...i, CANTIDAD: cantidad } : i));
  };

  // Update item price
  const updatePrice = (key: string, precio: number) => {
    setItems(prev => prev.map(i => i.key === key ? { ...i, PRECIO_UNITARIO: precio } : i));
  };

  // Totals
  const subtotal = useMemo(() =>
    items.reduce((sum, i) => sum + (i.PRECIO_UNITARIO || 0) * i.CANTIDAD, 0),
    [items]
  );

  // Submit
  const handleSubmit = () => {
    if (items.length === 0) {
      message.warning('Agregue al menos un producto');
      return;
    }

    if (tipo === 'SALIDA' && !clienteId && !proveedorId) {
      // Allow without destinatario
    }

    const input: RemitoInput = {
      TIPO: tipo,
      FECHA: fecha,
      PTO_VTA: ptoVta,
      CLIENTE_ID: clienteId || undefined,
      PROVEEDOR_ID: proveedorId || undefined,
      DEPOSITO_ID: depositoId || undefined,
      OBSERVACIONES: observaciones || undefined,
      items: items.map(i => ({
        PRODUCTO_ID: i.PRODUCTO_ID,
        CANTIDAD: i.CANTIDAD,
        PRECIO_UNITARIO: i.PRECIO_UNITARIO || 0,
        DEPOSITO_ID: i.DEPOSITO_ID || depositoId || undefined,
      })),
    };

    createMutation.mutate(input);
  };

  // Item table columns
  const itemColumns = [
    { title: 'Código', dataIndex: 'CODIGO', width: 80, align: 'center' as const },
    { title: 'Producto', dataIndex: 'NOMBRE', ellipsis: true },
    {
      title: 'Stock', dataIndex: 'STOCK', width: 80, align: 'center' as const,
      render: (v: number) => <Text type={v <= 0 ? 'danger' : undefined}>{fmtNum(v)}</Text>,
    },
    {
      title: 'Cantidad', width: 110,
      render: (_: any, record: RemitoItemRow) => (
        <InputNumber
          min={0.01}
          step={1}
          value={record.CANTIDAD}
          onChange={v => updateQuantity(record.key, v || 1)}
          size="small"
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'P. Unitario', width: 120,
      render: (_: any, record: RemitoItemRow) => (
        <InputNumber
          min={0}
          step={0.01}
          value={record.PRECIO_UNITARIO}
          onChange={v => updatePrice(record.key, v || 0)}
          size="small"
          style={{ width: '100%' }}
          formatter={v => `$ ${v}`}
        />
      ),
    },
    {
      title: 'Subtotal', width: 125, align: 'center' as const,
      render: (_: any, record: RemitoItemRow) =>
        fmtMoney((record.PRECIO_UNITARIO || 0) * record.CANTIDAD),
    },
    {
      title: '', width: 40,
      render: (_: any, record: RemitoItemRow) => (
        <Button type="text" danger size="small" icon={<DeleteOutlined />}
          onClick={() => removeItem(record.key)} />
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          {tipo === 'ENTRADA' ? <ImportOutlined /> : <ExportOutlined />}
          <span>Nuevo Remito de {tipo === 'ENTRADA' ? 'Entrada' : 'Salida'}</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={900}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Text strong style={{ fontSize: 16 }}>Total: {fmtMoney(subtotal)}</Text>
          <Space style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Checkbox checked={printAfterCreate} onChange={e => setPrintAfterCreate(e.target.checked)}>
              <Space size={4}>
                <PrinterOutlined />
                Imprimir
              </Space>
            </Checkbox>
            {printAfterCreate && (
              <Radio.Group
                size="small"
                value={printCopias}
                onChange={e => setPrintCopias(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                options={[
                  { value: 'original', label: 'Original' },
                  { value: 'original-duplicado', label: 'Original + Duplicado' },
                ]}
              />
            )}
            <Button onClick={onClose}>Cancelar</Button>
            <Button type="primary" onClick={handleSubmit} loading={createMutation.isPending}
              disabled={items.length === 0}>
              Confirmar Remito
            </Button>
          </Space>
        </div>
      }
      destroyOnClose
    >
      {/* ── Config Section ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Fecha</Text>
          <DatePicker
            value={dayjs(fecha)}
            onChange={d => setFecha(d?.format('YYYY-MM-DD') || dayjs().format('YYYY-MM-DD'))}
            format="DD/MM/YYYY"
            style={{ width: '100%' }}
            size="small"
          />
        </div>
        <div style={{ flex: 1, minWidth: 100 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Pto. Venta</Text>
          <Input value={ptoVta} onChange={e => setPtoVta(e.target.value)} size="small"
            maxLength={5} style={{ width: '100%' }} />
        </div>
        <div style={{ flex: 2, minWidth: 200 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {tipo === 'SALIDA' ? 'Cliente (destinatario)' : 'Proveedor (origen)'}
          </Text>
          {tipo === 'SALIDA' ? (
            <Select
              showSearch
              allowClear
              placeholder="Seleccionar cliente..."
              value={clienteId}
              onChange={setClienteId}
              filterOption={(input, option) =>
                (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
              }
              options={clientes.map((c: any) => ({ value: c.CLIENTE_ID, label: c.NOMBRE }))}
              style={{ width: '100%' }}
              size="small"
            />
          ) : (
            <Select
              showSearch
              allowClear
              placeholder="Seleccionar proveedor..."
              value={proveedorId}
              onChange={setProveedorId}
              filterOption={(input, option) =>
                (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
              }
              options={proveedores.map((p: any) => ({ value: p.PROVEEDOR_ID, label: p.NOMBRE }))}
              style={{ width: '100%' }}
              size="small"
            />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>Depósito</Text>
          <Select
            showSearch
            allowClear
            placeholder="Depósito..."
            value={depositoId}
            onChange={setDepositoId}
            filterOption={(input, option) =>
              (option?.label as string || '').toLowerCase().includes(input.toLowerCase())
            }
            options={depositos.map(d => ({ value: d.DEPOSITO_ID, label: d.NOMBRE }))}
            style={{ width: '100%' }}
            size="small"
          />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>Observaciones</Text>
        <TextArea
          rows={2}
          value={observaciones}
          onChange={e => setObservaciones(e.target.value)}
          placeholder="Observaciones del remito..."
          maxLength={500}
        />
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {/* ── Product Search ── */}
      <div style={{ marginBottom: 12 }}>
        <Input
          ref={searchRef}
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          placeholder="Buscar producto, código o escanear... (Enter para buscar)"
          prefix={<SearchOutlined />}
          onKeyDown={handleSearchKeyDown}
          allowClear
          size="small"
        />
      </div>

      {/* ── Items Table ── */}
      <Table
        dataSource={items}
        columns={itemColumns}
        rowKey="key"
        size="small"
        pagination={false}
        scroll={{ y: 250 }}
        locale={{ emptyText: 'Busque y agregue productos al remito' }}
      />

      <ProductSearchModal
        key={productSearchKey.current}
        open={productSearchOpen}
        onClose={() => {
          setProductSearchOpen(false);
          setTimeout(() => searchRef.current?.focus(), 0);
        }}
        onSelect={(products) => {
          products.forEach(p => addProduct(p));
        }}
        initialSearch={productSearchInitial}
        searchFn={remitosApi.searchProductsAdvanced}
      />
    </Modal>
  );
}
