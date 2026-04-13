import { useState, useEffect, useMemo } from 'react';
import {
  Modal, Select, Button, InputNumber, Table, Space, Typography,
  Radio, message, Tag, Input, Empty, Alert, Steps, Spin,
} from 'antd';
import {
  FileExclamationOutlined, UndoOutlined,
  DollarOutlined, PercentageOutlined, ShopOutlined,
  CheckCircleOutlined,
  ArrowLeftOutlined, ArrowRightOutlined,
  CreditCardOutlined, WalletOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ncComprasApi, type NCCompraInput, type NCCompraItemInput, type CompraParaNC } from '../../services/ncCompras.api';
import { purchasesApi } from '../../services/purchases.api';
import { cajaApi } from '../../services/caja.api';
import { fmtComprobanteTipo, fmtMoney, fmtNum } from '../../utils/format';
import type { MetodoPago } from '../../types';

const { Text } = Typography;
const { TextArea } = Input;

type Motivo = 'POR DEVOLUCION' | 'POR ANULACION' | 'POR DESCUENTO' | 'POR DIFERENCIA PRECIO';
type MedioPago = 'CN' | 'CC';

const MOTIVO_OPTIONS: { value: Motivo; label: string; icon: string }[] = [
  { value: 'POR DEVOLUCION', icon: '📦', label: 'Devolución' },
  { value: 'POR ANULACION', icon: '🚫', label: 'Anulación' },
  { value: 'POR DESCUENTO', icon: '💰', label: 'Descuento' },
  { value: 'POR DIFERENCIA PRECIO', icon: '📊', label: 'Dif. Precio' },
];

interface DevolucionItem {
  PRODUCTO_ID: number;
  PRODUCTO_NOMBRE: string;
  PRODUCTO_CODIGO: string;
  UNIDAD_ABREVIACION: string;
  CANTIDAD_ORIGINAL: number;
  CANTIDAD_YA_DEVUELTA: number;
  CANTIDAD_DEVOLVER: number;
  PRECIO_COMPRA: number;
  DEPOSITO_ID: number | null;
  IVA_ALICUOTA: number;
  PORCENTAJE_DESCUENTO: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function NewNCCompraModal({ open, onClose, onSuccess }: Props) {
  const [step, setStep] = useState(0);

  // Step 0: Config
  const [proveedorId, setProveedorId] = useState<number | null>(null);
  const [medioPago, setMedioPago] = useState<MedioPago>('CN');
  const [motivo, setMotivo] = useState<Motivo>('POR DEVOLUCION');
  const [destinoPago, setDestinoPago] = useState<'CAJA_CENTRAL' | 'CAJA'>('CAJA_CENTRAL');
  const [ptoVta, setPtoVta] = useState('0000');
  const [nroComprobante, setNroComprobante] = useState('00000000');

  // Step 1: Compra selection
  const [compraId, setCompraId] = useState<number | null>(null);

  // Step 2: Items / amounts + descripcion
  const [cantidadEdits, setCantidadEdits] = useState<Record<number, number>>({});
  const [descuentoPct, setDescuentoPct] = useState<number>(0);
  const [montoManual, setMontoManual] = useState<number>(0);
  const [descripcion, setDescripcion] = useState('');

  // Payment methods state
  const [selectedMetodos, setSelectedMetodos] = useState<number[]>([]);
  const [montosPorMetodo, setMontosPorMetodo] = useState<Record<number, number>>({});
  const [metodoModalOpen, setMetodoModalOpen] = useState(false);
  const [metodoModalSelection, setMetodoModalSelection] = useState<number[]>([]);

  // Queries
  const { data: proveedores = [] } = useQuery({
    queryKey: ['purchases-proveedores'],
    queryFn: () => purchasesApi.getProveedores(),
    enabled: open,
    staleTime: 60000,
  });

  const { data: compras = [], isLoading: loadingCompras } = useQuery({
    queryKey: ['compras-para-nc', proveedorId],
    queryFn: () => ncComprasApi.getComprasParaNC(proveedorId!),
    enabled: !!proveedorId,
  });

  const { data: itemsCompra = [], isLoading: loadingItems, error: itemsError } = useQuery({
    queryKey: ['items-compra-nc', compraId],
    queryFn: () => ncComprasApi.getItemsCompra(compraId!),
    enabled: !!compraId,
  });

  const { data: existeNC } = useQuery({
    queryKey: ['existe-nc', compraId],
    queryFn: () => ncComprasApi.existeNC(compraId!),
    enabled: !!compraId,
  });

  const { data: miCaja } = useQuery({
    queryKey: ['mi-caja'],
    queryFn: () => cajaApi.getMiCaja(),
    enabled: open && medioPago === 'CN',
    staleTime: 30000,
  });

  const { data: metodosPago = [] } = useQuery<MetodoPago[]>({
    queryKey: ['purchases-active-payment-methods'],
    queryFn: () => purchasesApi.getActivePaymentMethods(),
    enabled: open && medioPago === 'CN',
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

  // Derived items
  const devItems: DevolucionItem[] = useMemo(() => {
    if (!compraId || itemsCompra.length === 0) return [];
    return itemsCompra.map(item => {
      const disponible = Math.max(0, item.CANTIDAD - item.CANTIDAD_YA_DEVUELTA);
      const cantidadDevolver = motivo === 'POR ANULACION'
        ? disponible
        : (cantidadEdits[item.PRODUCTO_ID] ?? 0);
      return {
        PRODUCTO_ID: item.PRODUCTO_ID,
        PRODUCTO_NOMBRE: item.PRODUCTO_NOMBRE,
        PRODUCTO_CODIGO: item.PRODUCTO_CODIGO,
        UNIDAD_ABREVIACION: item.UNIDAD_ABREVIACION || 'u',
        CANTIDAD_ORIGINAL: item.CANTIDAD,
        CANTIDAD_YA_DEVUELTA: item.CANTIDAD_YA_DEVUELTA,
        CANTIDAD_DEVOLVER: cantidadDevolver,
        PRECIO_COMPRA: item.PRECIO_COMPRA,
        DEPOSITO_ID: item.DEPOSITO_ID,
        IVA_ALICUOTA: item.IVA_ALICUOTA || 0,
        PORCENTAJE_DESCUENTO: item.PORCENTAJE_DESCUENTO || 0,
      };
    });
  }, [itemsCompra, motivo, compraId, cantidadEdits]);

  const compraSeleccionada = useMemo(() => compras.find(c => c.COMPRA_ID === compraId), [compras, compraId]);

  const proveedorSeleccionado = useMemo(
    () => proveedores.find((p: any) => p.PROVEEDOR_ID === proveedorId),
    [proveedores, proveedorId],
  );

  // Auto-set medioPago if purchase is CC
  useEffect(() => {
    if (compraSeleccionada?.ES_CTA_CORRIENTE) setMedioPago('CC');
  }, [compraSeleccionada]);

  // Auto-select default payment method
  useEffect(() => {
    if (medioPago === 'CN' && selectedMetodos.length === 0 && defaultMetodoEfectivoId) {
      setSelectedMetodos([defaultMetodoEfectivoId]);
    }
  }, [medioPago, defaultMetodoEfectivoId]);

  // Reset on provider change
  useEffect(() => {
    setCompraId(null);
    setCantidadEdits({});
    setDescuentoPct(0);
    setMontoManual(0);
  }, [proveedorId]);

  // Reset on compra change
  useEffect(() => {
    setCantidadEdits({});
    setDescuentoPct(0);
    setMontoManual(0);
  }, [compraId]);

  // Reset all on close
  useEffect(() => {
    if (!open) {
      setStep(0);
      setProveedorId(null);
      setMedioPago('CN');
      setMotivo('POR DEVOLUCION');
      setDestinoPago('CAJA_CENTRAL');
      setPtoVta('0000');
      setNroComprobante('00000000');
      setDescripcion('');
      setCompraId(null);
      setCantidadEdits({});
      setDescuentoPct(0);
      setMontoManual(0);
      setSelectedMetodos([]);
      setMontosPorMetodo({});
      setMetodoModalOpen(false);
      setMetodoModalSelection([]);
    }
  }, [open]);

  // Is this a Factura A purchase? (prices are net, IVA must be added)
  const isFacturaA = compraSeleccionada?.TIPO_COMPROBANTE === 'FA';

  // Calculate totals
  const netoNC = useMemo(() => {
    if (!compraSeleccionada) return 0;
    switch (motivo) {
      case 'POR DEVOLUCION':
      case 'POR ANULACION':
        return devItems.reduce((s, i) => {
          const bruto = i.CANTIDAD_DEVOLVER * i.PRECIO_COMPRA;
          return s + Math.round(bruto * (1 - (i.PORCENTAJE_DESCUENTO || 0) / 100) * 100) / 100;
        }, 0);
      case 'POR DESCUENTO':
        return Math.round(compraSeleccionada.TOTAL * (descuentoPct / 100) * 100) / 100;
      case 'POR DIFERENCIA PRECIO':
        return montoManual;
      default:
        return 0;
    }
  }, [motivo, devItems, compraSeleccionada, descuentoPct, montoManual]);

  const ivaNC = useMemo(() => {
    if (!isFacturaA) return 0;
    if (motivo === 'POR DEVOLUCION' || motivo === 'POR ANULACION') {
      return devItems.reduce((s, i) => {
        const bruto = i.CANTIDAD_DEVOLVER * i.PRECIO_COMPRA;
        const lineNeto = Math.round(bruto * (1 - (i.PORCENTAJE_DESCUENTO || 0) / 100) * 100) / 100;
        return s + lineNeto * (i.IVA_ALICUOTA || 0.21);
      }, 0);
    }
    // For descuento/dif precio on FA, assume 21% IVA on the net amount
    return netoNC * 0.21;
  }, [isFacturaA, motivo, devItems, netoNC]);

  const montoNC = useMemo(() => {
    return Math.round((netoNC + ivaNC) * 100) / 100;
  }, [netoNC, ivaNC]);

  // Auto-fill amount when single method selected
  useEffect(() => {
    if (selectedMetodos.length === 1 && montoNC > 0) {
      setMontosPorMetodo({ [selectedMetodos[0]!]: montoNC });
    }
  }, [selectedMetodos, montoNC]);

  // Mutation
  const createMutation = useMutation({
    mutationFn: (data: NCCompraInput) => ncComprasApi.create(data),
    onSuccess: (result) => {
      message.success(`NC #${result.NC_ID} creada por ${fmtMoney(result.MONTO)}`);
      onSuccess();
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al crear NC');
    },
  });

  const handleSubmit = () => {
    if (!proveedorId || !compraId) return;
    if (montoNC <= 0) {
      message.warning('El monto de la NC debe ser mayor a 0');
      return;
    }

    const esConItems = motivo === 'POR DEVOLUCION' || motivo === 'POR ANULACION';
    const items: NCCompraItemInput[] | undefined = esConItems
      ? devItems
          .filter(i => i.CANTIDAD_DEVOLVER > 0)
          .map(i => ({
            PRODUCTO_ID: i.PRODUCTO_ID,
            CANTIDAD_DEVUELTA: i.CANTIDAD_DEVOLVER,
            PRECIO_COMPRA: i.PRECIO_COMPRA,
            DEPOSITO_ID: i.DEPOSITO_ID,
          }))
      : undefined;

    if (esConItems && (!items || items.length === 0)) {
      message.warning('Seleccioná al menos un ítem con cantidad a devolver');
      return;
    }

    createMutation.mutate({
      COMPRA_ID: compraId,
      PROVEEDOR_ID: proveedorId,
      MOTIVO: motivo,
      MEDIO_PAGO: medioPago,
      MONTO: montoNC,
      DESCUENTO: motivo === 'POR DESCUENTO' ? descuentoPct : undefined,
      DESCRIPCION: descripcion || undefined,
      PTO_VTA: ptoVta,
      NRO_COMPROBANTE: nroComprobante,
      DESTINO_PAGO: medioPago === 'CN' ? destinoPago : undefined,
      items,
      metodos_pago: medioPago === 'CN' && selectedMetodos.length > 0
        ? selectedMetodos
            .filter(id => (montosPorMetodo[id] || 0) > 0)
            .map(id => ({ METODO_PAGO_ID: id, MONTO: montosPorMetodo[id] || 0 }))
        : undefined,
    });
  };

  // Step validation
  const canGoToStep1 = !!proveedorId;
  const canGoToStep2 = !!compraId;
  const canGoToStep3 = montoNC > 0;
  const needsStep3 = medioPago === 'CN';
  const lastStep = needsStep3 ? 3 : 2;
  const canSubmit = !!(proveedorId && compraId && montoNC > 0 && !createMutation.isPending);

  // ── Compra selection columns ───────────────────
  const compraColumns = [
    { title: '#', dataIndex: 'COMPRA_ID', width: 60, align: 'center' as const },
    {
      title: 'Fecha', dataIndex: 'FECHA_COMPRA', width: 100, align: 'center' as const,
      render: (v: string) => new Date(v).toLocaleDateString('es-AR'),
    },
    {
      title: 'Comprobante', key: 'voucher', width: 160, align: 'center' as const,
      render: (_: unknown, r: CompraParaNC) => {
        const tipo = r.TIPO_COMPROBANTE || '';
        const pv = r.PTO_VTA || '0000';
        const nro = r.NRO_COMPROBANTE || '00000000';
        if (!tipo && pv === '0000' && nro === '00000000') return '-';
        const tipoLabel = fmtComprobanteTipo(tipo);
        return `${tipoLabel} ${pv}-${nro}`;
      },
    },
    {
      title: 'Total', dataIndex: 'TOTAL', width: 110, align: 'right' as const,
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
    },
    {
      title: 'Tipo', key: 'tipo', width: 90, align: 'center' as const,
      render: (_: unknown, r: CompraParaNC) => (
        <Tag color={r.ES_CTA_CORRIENTE ? 'blue' : 'green'}>{r.ES_CTA_CORRIENTE ? 'Cta.Cte.' : 'Contado'}</Tag>
      ),
    },
  ];

  // ── Item columns for devolucion/anulacion ──────
  const itemColumns = [
    { title: 'Código', dataIndex: 'PRODUCTO_CODIGO', width: 90, align: 'center' as const },
    { title: 'Producto', dataIndex: 'PRODUCTO_NOMBRE', ellipsis: true },
    {
      title: 'Comprada', dataIndex: 'CANTIDAD_ORIGINAL', width: 115, align: 'center' as const,
      render: (v: number, r: DevolucionItem) => `${v % 1 === 0 ? v : fmtNum(v)} ${r.UNIDAD_ABREVIACION || ''}`,
    },
    {
      title: 'Devueltas', dataIndex: 'CANTIDAD_YA_DEVUELTA', width: 115, align: 'center' as const,
      render: (v: number) => v > 0 ? <Text type="danger">{v % 1 === 0 ? v : fmtNum(v)}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Disponible', key: 'dispo', width: 115, align: 'center' as const,
      render: (_: unknown, r: DevolucionItem) => {
        const dispo = Math.max(0, r.CANTIDAD_ORIGINAL - r.CANTIDAD_YA_DEVUELTA);
        return <Text type="secondary">{dispo % 1 === 0 ? dispo : fmtNum(dispo)}</Text>;
      },
    },
    {
      title: 'Devuelve', key: 'devolver', width: 115, align: 'center' as const,
      render: (_: unknown, r: DevolucionItem) => {
        const max = Math.max(0, r.CANTIDAD_ORIGINAL - r.CANTIDAD_YA_DEVUELTA);
        return (
          <InputNumber
            min={0}
            max={max}
            value={r.CANTIDAD_DEVOLVER}
            disabled={motivo === 'POR ANULACION'}
            size="small"
            style={{ width: 72 }}
            onChange={(val) => {
              setCantidadEdits(prev => ({ ...prev, [r.PRODUCTO_ID]: val ?? 0 }));
            }}
          />
        );
      },
    },
    {
      title: 'P. Compra', dataIndex: 'PRECIO_COMPRA', width: 110, align: 'right' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Bonif.', key: 'desc', width: 90, align: 'center' as const,
      render: (_: unknown, r: DevolucionItem) => {
        const d = r.PORCENTAJE_DESCUENTO || 0;
        return d > 0 ? <Text type="warning">{fmtNum(d)}%</Text> : <Text type="secondary">—</Text>;
      },
    },
    {
      title: 'Subtotal', key: 'sub', width: 120, align: 'right' as const,
      render: (_: unknown, r: DevolucionItem) => {
        const bruto = r.CANTIDAD_DEVOLVER * r.PRECIO_COMPRA;
        const neto = Math.round(bruto * (1 - (r.PORCENTAJE_DESCUENTO || 0) / 100) * 100) / 100;
        return neto > 0 ? <Text strong style={{ color: '#EABD23' }}>{fmtMoney(neto)}</Text> : <Text type="secondary">$ 0,00</Text>;
      },
    },
  ];

  // ── Step content renderers ─────────────────────

  const renderStep0 = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Proveedor */}
      <div>
        <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>
          <ShopOutlined /> Proveedor
        </Text>
        <Select
          showSearch
          placeholder="Buscar proveedor..."
          value={proveedorId}
          onChange={setProveedorId}
          filterOption={(input, option) =>
            (option?.label as string ?? '').toLowerCase().includes(input.toLowerCase())
          }
          options={proveedores.map((p: any) => ({
            value: p.PROVEEDOR_ID,
            label: `${p.CODIGOPARTICULAR} - ${p.NOMBRE}`,
          }))}
          style={{ width: '100%' }}
          size="large"
          autoFocus
        />
      </div>

      {/* Motivo — horizontal cards */}
      <div>
        <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Motivo de la Nota de Crédito</Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
          {MOTIVO_OPTIONS.map(opt => {
            const selected = motivo === opt.value;
            return (
              <div
                key={opt.value}
                onClick={() => { setMotivo(opt.value); setDescuentoPct(0); setMontoManual(0); }}
                style={{
                  padding: '10px 8px',
                  borderRadius: 8,
                  border: selected ? '2px solid #EABD23' : '1px solid #d9d9d9',
                  background: selected ? 'rgba(234,189,35,0.12)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 20 }}>{opt.icon}</div>
                <Text strong style={{ fontSize: 12, color: selected ? '#EABD23' : undefined }}>
                  {opt.label}
                </Text>
              </div>
            );
          })}
        </div>
      </div>

      {/* Punto de Venta y Talonario */}
      <div>
        <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Punto de Venta / Talonario</Text>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
            style={{ width: 140, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}
            maxLength={8}
            size="large"
          />
        </div>
      </div>

      {/* Medio de pago + destino */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Medio de pago</Text>
          <Radio.Group
            value={medioPago}
            onChange={e => setMedioPago(e.target.value)}
            disabled={!!compraSeleccionada?.ES_CTA_CORRIENTE}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="CN">Contado</Radio.Button>
            <Radio.Button value="CC">Cta. Cte.</Radio.Button>
          </Radio.Group>
        </div>

        {medioPago === 'CN' && (
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4, fontSize: 13 }}>Destino ingreso</Text>
            <Radio.Group value={destinoPago} onChange={e => setDestinoPago(e.target.value)} optionType="button" buttonStyle="solid">
              <Radio.Button value="CAJA_CENTRAL">Caja Central</Radio.Button>
              <Radio.Button value="CAJA" disabled={!miCaja}>Caja Usuario</Radio.Button>
            </Radio.Group>
            {!miCaja && (
              <div style={{ marginTop: 4 }}>
                <Text type="warning" style={{ fontSize: 11 }}>No tenés caja abierta</Text>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderStep1 = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Proveedor: <Text strong>{proveedorSeleccionado?.NOMBRE || ''}</Text>
        {' · '}Motivo: <Text strong>{MOTIVO_OPTIONS.find(o => o.value === motivo)?.label}</Text>
      </Text>

      {existeNC?.existe && compraId && (
        <Alert
          type="warning"
          message={`Esta compra ya tiene ${existeNC.notas.length} NC asociada(s)`}
          showIcon
          style={{ padding: '4px 12px' }}
        />
      )}

      <Table
        className="rg-table"
        dataSource={compras}
        columns={compraColumns}
        loading={loadingCompras}
        rowKey="COMPRA_ID"
        size="small"
        pagination={{ pageSize: 8, size: 'small', showSizeChanger: false }}
        rowSelection={{
          type: 'radio',
          selectedRowKeys: compraId ? [compraId] : [],
          onChange: (keys) => setCompraId(keys[0] as number),
        }}
        onRow={(record) => ({
          onClick: () => setCompraId(record.COMPRA_ID),
          onDoubleClick: () => { setCompraId(record.COMPRA_ID); setTimeout(() => setStep(2), 100); },
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Sin compras para este proveedor" /> }}
      />
    </div>
  );

  const renderStep2 = () => {
    if (!compraSeleccionada) return null;
    const esConItems = motivo === 'POR DEVOLUCION' || motivo === 'POR ANULACION';

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Purchase banner */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 12px', background: 'transparent', borderRadius: 6, border: '1px solid #d9d9d9',
        }}>
          <Space size="middle" style={{ fontSize: 12 }}>
            <Text>Compra <Text strong>#{compraId}</Text></Text>
            <Text type="secondary">{new Date(compraSeleccionada.FECHA_COMPRA).toLocaleDateString('es-AR')}</Text>
            <Tag color={compraSeleccionada.ES_CTA_CORRIENTE ? 'blue' : 'green'} style={{ margin: 0 }}>
              {compraSeleccionada.ES_CTA_CORRIENTE ? 'Cta.Cte.' : 'Contado'}
            </Tag>
          </Space>
          <Text strong>{fmtMoney(compraSeleccionada.TOTAL)}</Text>
        </div>

        {existeNC?.existe && (
          <Alert type="warning" message={`Esta compra ya tiene ${existeNC.notas.length} NC asociada(s)`} showIcon style={{ padding: '4px 12px' }} />
        )}

        {/* Items grid (devolucion/anulacion) */}
        {esConItems && (
          <>
            <Text strong style={{ fontSize: 12 }}>
              <UndoOutlined /> {motivo === 'POR ANULACION' ? 'Todos los ítems serán devueltos' : 'Seleccioná cantidades a devolver'}
            </Text>
            {itemsError ? (
              <Alert
                type="error"
                message="Error al cargar ítems de la compra"
                description={(itemsError as any)?.response?.data?.error || (itemsError as Error).message}
                showIcon
              />
            ) : loadingItems ? (
              <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
            ) : (
              <Table
                className="rg-table"
                dataSource={devItems}
                columns={itemColumns}
                rowKey="PRODUCTO_ID"
                size="small"
                pagination={false}
                scroll={{ y: 300 }}
              />
            )}
          </>
        )}

        {/* Descuento */}
        {motivo === 'POR DESCUENTO' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '14px 16px', background: 'transparent', borderRadius: 8, border: '1px solid #d9d9d9' }}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 6 }}>
                <PercentageOutlined /> Porcentaje de descuento
              </Text>
              <InputNumber
                min={0.01}
                max={100}
                value={descuentoPct}
                onChange={v => setDescuentoPct(v ?? 0)}
                addonAfter="%"
                style={{ width: 150 }}
                autoFocus
              />
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Total compra: {fmtMoney(compraSeleccionada.TOTAL)}</Text>
              <span style={{ fontSize: 22, fontWeight: 'bold', color: '#EABD23' }}>{fmtMoney(montoNC)}</span>
            </div>
          </div>
        )}

        {/* Diferencia de precio */}
        {motivo === 'POR DIFERENCIA PRECIO' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '14px 16px', background: 'transparent', borderRadius: 8, border: '1px solid #d9d9d9' }}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 6 }}>
                <DollarOutlined /> Monto de la NC
              </Text>
              <InputNumber
                min={0.01}
                max={compraSeleccionada.TOTAL}
                value={montoManual}
                onChange={v => setMontoManual(v ?? 0)}
                addonBefore="$"
                style={{ width: 200 }}
                autoFocus
              />
            </div>
            <div style={{ flex: 1, textAlign: 'right' }}>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Total compra: {fmtMoney(compraSeleccionada.TOTAL)}</Text>
              <span style={{ fontSize: 22, fontWeight: 'bold', color: '#EABD23' }}>{fmtMoney(montoNC)}</span>
            </div>
          </div>
        )}

        {/* Descripcion */}
        <div>
          <Text strong style={{ fontSize: 12, display: 'block', marginBottom: 2 }}>Descripción (opcional)</Text>
          <TextArea
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Nota o motivo adicional..."
            rows={2}
            maxLength={500}
          />
        </div>

        {/* Summary bar */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '10px 16px', background: 'rgba(234, 189, 35, 0.06)',
          borderRadius: 8, border: '1px solid #EABD23',
        }}>
          <div>
            <Text style={{ fontSize: 11 }}>
              {compraSeleccionada.PROVEEDOR_NOMBRE || proveedorSeleccionado?.NOMBRE || ''}
              {' · '}Compra #{compraId}
              {' · '}{medioPago === 'CC' ? 'Cta. Corriente' : `Contado → ${destinoPago === 'CAJA' ? 'Caja' : 'Caja Central'}`}
            </Text>
          </div>
          <div style={{ textAlign: 'right' }}>
            {isFacturaA && netoNC > 0 && (
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Neto: {fmtMoney(netoNC)} + IVA: {fmtMoney(Math.round(ivaNC * 100) / 100)}</Text>
            )}
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Total NC</Text>
            <span style={{ fontSize: 22, fontWeight: 'bold', color: '#EABD23' }}>
              {fmtMoney(montoNC)}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderStep3 = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 16px', background: 'rgba(234, 189, 35, 0.06)',
        borderRadius: 8, border: '1px solid #EABD23',
      }}>
        <div>
          <Text style={{ fontSize: 11 }}>
            {compraSeleccionada?.PROVEEDOR_NOMBRE || proveedorSeleccionado?.NOMBRE || ''}
            {' · '}Compra #{compraId}
            {' · '}{MOTIVO_OPTIONS.find(o => o.value === motivo)?.label}
          </Text>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Total NC</Text>
          <span style={{ fontSize: 22, fontWeight: 'bold', color: '#EABD23' }}>{fmtMoney(montoNC)}</span>
        </div>
      </div>

      {/* Selected payment methods (compact Tags) */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text strong style={{ fontSize: 13 }}>
            <WalletOutlined style={{ marginRight: 6 }} />Método de pago
          </Text>
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

      {/* Amount inputs when multiple methods selected */}
      {selectedMetodos.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {selectedMetodos.map(id => {
            const m = metodosPago.find(mp => mp.METODO_PAGO_ID === id);
            if (!m) return null;
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Text style={{ width: 120, fontSize: 12 }}>
                  {m.CATEGORIA === 'EFECTIVO' ? <DollarOutlined style={{ marginRight: 4 }} /> : <CreditCardOutlined style={{ marginRight: 4 }} />}
                  {m.NOMBRE}
                </Text>
                <InputNumber
                  value={montosPorMetodo[id] || 0}
                  min={0}
                  step={100}
                  size="small"
                  style={{ width: 150 }}
                  formatter={v => `$ ${v}`}
                  onChange={v => setMontosPorMetodo(prev => ({ ...prev, [id]: v || 0 }))}
                />
              </div>
            );
          })}
          <Text type="secondary" style={{ fontSize: 11 }}>
            Total asignado: {fmtMoney(selectedMetodos.reduce((s, id) => s + (montosPorMetodo[id] || 0), 0))}
            {' / '}{fmtMoney(montoNC)}
          </Text>
        </div>
      )}
    </div>
  );

  // ── Footer buttons ─────────────────────────────
  const footerButtons = () => {
    const buttons: React.ReactNode[] = [];
    buttons.push(<Button key="cancel" onClick={onClose}>Cancelar</Button>);
    if (step > 0) {
      buttons.push(
        <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => setStep(s => s - 1)}>
          Anterior
        </Button>
      );
    }
    if (step < lastStep) {
      const disabled = step === 0 ? !canGoToStep1 : step === 1 ? !canGoToStep2 : !canGoToStep3;
      buttons.push(
        <Button key="next" type="primary" className="btn-gold" icon={<ArrowRightOutlined />}
          disabled={disabled} onClick={() => setStep(s => s + 1)}>
          Siguiente
        </Button>
      );
    } else {
      buttons.push(
        <Button key="submit" type="primary" className="btn-gold" icon={<CheckCircleOutlined />}
          disabled={!canSubmit} loading={createMutation.isPending} onClick={handleSubmit}>
          Crear NC por {fmtMoney(montoNC)}
        </Button>
      );
    }
    return buttons;
  };

  return (<>
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <FileExclamationOutlined />
          <span>Nueva Nota de Crédito — Compras</span>
        </Space>
      }
      className="rg-modal"
      width={step === 0 ? 640 : step === 1 ? 920 : step === 3 ? 640 : 1100}
      centered
      footer={footerButtons()}
      destroyOnClose
      styles={{
        body: { paddingTop: 12, maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' },
      }}
    >
      <Steps
        current={step}
        size="small"
        style={{ marginBottom: 16 }}
        onChange={(s) => {
          if (s < step) setStep(s);
          if (s === 1 && canGoToStep1) setStep(1);
          if (s === 2 && canGoToStep1 && canGoToStep2) setStep(2);
          if (s === 3 && canGoToStep1 && canGoToStep2 && canGoToStep3) setStep(3);
        }}
        items={[
          { title: 'Configuración', description: proveedorId ? (proveedorSeleccionado?.NOMBRE || '') : undefined },
          { title: 'Compra', description: compraId ? `#${compraId}` : undefined },
          { title: 'Detalle NC' },
          ...(needsStep3 ? [{ title: 'Pago' }] : []),
        ]}
      />

      {step === 0 && renderStep0()}
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && needsStep3 && renderStep3()}
    </Modal>

    {/* ── Payment method selection modal ── */}
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
                if (metodoModalSelection.length === 1) {
                  next[metodoModalSelection[0]!] = montoNC;
                }
                return next;
              });
              setMetodoModalOpen(false);
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
                    setMetodoModalSelection(prev =>
                      isSelected
                        ? prev.filter(id => id !== m.METODO_PAGO_ID)
                        : [...prev, m.METODO_PAGO_ID]
                    );
                  } else {
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
                <Tag color={m.CATEGORIA === 'EFECTIVO' ? 'green' : 'blue'} style={{ fontSize: 10, margin: 0 }}>{m.CATEGORIA}</Tag>
                {isSelected && (
                  <CheckCircleOutlined style={{ color: '#EABD23', fontSize: 16, position: 'absolute', top: 6, right: 6 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  </>);
}
