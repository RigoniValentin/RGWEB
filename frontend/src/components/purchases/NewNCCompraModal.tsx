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
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ncComprasApi, type NCCompraInput, type NCCompraItemInput, type CompraParaNC } from '../../services/ncCompras.api';
import { purchasesApi } from '../../services/purchases.api';
import { cajaApi } from '../../services/caja.api';
import { fmtMoney, fmtNum } from '../../utils/format';

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

  // Step 1: Compra selection
  const [compraId, setCompraId] = useState<number | null>(null);

  // Step 2: Items / amounts + descripcion
  const [cantidadEdits, setCantidadEdits] = useState<Record<number, number>>({});
  const [descuentoPct, setDescuentoPct] = useState<number>(0);
  const [montoManual, setMontoManual] = useState<number>(0);
  const [descripcion, setDescripcion] = useState('');

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
      setDescripcion('');
      setCompraId(null);
      setCantidadEdits({});
      setDescuentoPct(0);
      setMontoManual(0);
    }
  }, [open]);

  // Calculate total
  const montoNC = useMemo(() => {
    if (!compraSeleccionada) return 0;
    switch (motivo) {
      case 'POR DEVOLUCION':
      case 'POR ANULACION':
        return devItems.reduce((s, i) => s + i.CANTIDAD_DEVOLVER * i.PRECIO_COMPRA, 0);
      case 'POR DESCUENTO':
        return Math.round(compraSeleccionada.TOTAL * (descuentoPct / 100) * 100) / 100;
      case 'POR DIFERENCIA PRECIO':
        return montoManual;
      default:
        return 0;
    }
  }, [motivo, devItems, compraSeleccionada, descuentoPct, montoManual]);

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
      MONTO: motivo === 'POR DIFERENCIA PRECIO' ? montoManual : undefined,
      DESCUENTO: motivo === 'POR DESCUENTO' ? descuentoPct : undefined,
      DESCRIPCION: descripcion || undefined,
      DESTINO_PAGO: medioPago === 'CN' ? destinoPago : undefined,
      items,
    });
  };

  // Step validation
  const canGoToStep1 = !!proveedorId;
  const canGoToStep2 = !!compraId;
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
        const tipoLabel = tipo.startsWith('F') ? `Fact.${tipo.slice(1)}` : tipo;
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
    { title: 'Código', dataIndex: 'PRODUCTO_CODIGO', width: 100, align: 'center' as const },
    { title: 'Producto', dataIndex: 'PRODUCTO_NOMBRE', ellipsis: true },
    {
      title: 'Comprada', dataIndex: 'CANTIDAD_ORIGINAL', width: 130, align: 'center' as const,
      render: (v: number, r: DevolucionItem) => `${v % 1 === 0 ? v : fmtNum(v)} ${r.UNIDAD_ABREVIACION || ''}`,
    },
    {
      title: 'Devueltas', dataIndex: 'CANTIDAD_YA_DEVUELTA', width: 130, align: 'center' as const,
      render: (v: number) => v > 0 ? <Text type="danger">{v % 1 === 0 ? v : fmtNum(v)}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: 'Disponible', key: 'dispo', width: 130, align: 'center' as const,
      render: (_: unknown, r: DevolucionItem) => {
        const dispo = Math.max(0, r.CANTIDAD_ORIGINAL - r.CANTIDAD_YA_DEVUELTA);
        return <Text type="secondary">{dispo % 1 === 0 ? dispo : fmtNum(dispo)}</Text>;
      },
    },
    {
      title: 'A devolver', key: 'devolver', width: 130, align: 'center' as const,
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
      title: 'P. Compra', dataIndex: 'PRECIO_COMPRA', width: 100, align: 'right' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Subtotal', key: 'sub', width: 100, align: 'right' as const,
      render: (_: unknown, r: DevolucionItem) => {
        const sub = r.CANTIDAD_DEVOLVER * r.PRECIO_COMPRA;
        return sub > 0 ? <Text strong style={{ color: '#EABD23' }}>{fmtMoney(sub)}</Text> : <Text type="secondary">$ 0,00</Text>;
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
                  border: selected ? '2px solid #EABD23' : '1px solid #444',
                  background: selected ? 'rgba(234,189,35,0.12)' : '#2a2b2e',
                  cursor: 'pointer',
                  textAlign: 'center',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ fontSize: 20 }}>{opt.icon}</div>
                <Text strong style={{ fontSize: 12, color: selected ? '#EABD23' : '#e0e0e0' }}>
                  {opt.label}
                </Text>
              </div>
            );
          })}
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
          padding: '8px 12px', background: '#2a2b2e', borderRadius: 6, border: '1px solid #444',
        }}>
          <Space size="middle" style={{ fontSize: 12 }}>
            <Text style={{ color: '#e0e0e0' }}>Compra <Text strong style={{ color: '#fff' }}>#{compraId}</Text></Text>
            <Text style={{ color: '#aaa' }}>{new Date(compraSeleccionada.FECHA_COMPRA).toLocaleDateString('es-AR')}</Text>
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
                scroll={devItems.length > 6 ? { y: 230 } : undefined}
              />
            )}
          </>
        )}

        {/* Descuento */}
        {motivo === 'POR DESCUENTO' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '14px 16px', background: '#2a2b2e', borderRadius: 8, border: '1px solid #444' }}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 6, color: '#e0e0e0' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '14px 16px', background: '#2a2b2e', borderRadius: 8, border: '1px solid #444' }}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 6, color: '#e0e0e0' }}>
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
          padding: '10px 16px', background: 'linear-gradient(135deg, #1E1F22, #2a2b2e)',
          borderRadius: 8, border: '1px solid #EABD23',
        }}>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {compraSeleccionada.PROVEEDOR_NOMBRE || proveedorSeleccionado?.NOMBRE || ''}
              {' · '}Compra #{compraId}
              {' · '}{medioPago === 'CC' ? 'Cta. Corriente' : `Contado → ${destinoPago === 'CAJA' ? 'Caja' : 'Caja Central'}`}
            </Text>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Text type="secondary" style={{ fontSize: 10, display: 'block' }}>Total NC</Text>
            <span style={{ fontSize: 22, fontWeight: 'bold', color: '#EABD23' }}>
              {fmtMoney(montoNC)}
            </span>
          </div>
        </div>
      </div>
    );
  };

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
    if (step < 2) {
      const disabled = step === 0 ? !canGoToStep1 : !canGoToStep2;
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

  return (
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
      width={step === 0 ? 640 : 920}
      footer={footerButtons()}
      destroyOnClose
      styles={{
        body: { paddingTop: 12 },
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
        }}
        items={[
          { title: 'Configuración', description: proveedorId ? (proveedorSeleccionado?.NOMBRE || '') : undefined },
          { title: 'Compra', description: compraId ? `#${compraId}` : undefined },
          { title: 'Detalle NC' },
        ]}
      />

      {step === 0 && renderStep0()}
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
    </Modal>
  );
}
