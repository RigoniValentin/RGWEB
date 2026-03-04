import { useState, useEffect, useMemo } from 'react';
import {
  Modal, Select, Button, InputNumber, Table, Space, Typography,
  Radio, message, Tag, Input, Empty, Alert,
  DatePicker,
} from 'antd';
import {
  FileExclamationOutlined, UndoOutlined,
  DollarOutlined, PercentageOutlined, ShopOutlined,
  ShoppingCartOutlined, CheckCircleOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ncComprasApi, type NCCompraInput, type NCCompraItemInput, type CompraParaNC } from '../../services/ncCompras.api';
import { purchasesApi } from '../../services/purchases.api';
import { cajaApi } from '../../services/caja.api';
import { fmtMoney, fmtNum } from '../../utils/format';
import dayjs from 'dayjs';

const { Text } = Typography;
const { TextArea } = Input;
const { RangePicker } = DatePicker;

type Motivo = 'POR DEVOLUCION' | 'POR ANULACION' | 'POR DESCUENTO' | 'POR DIFERENCIA PRECIO';
type MedioPago = 'CN' | 'CC';

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
  // Step 1: Proveedor + Config
  const [proveedorId, setProveedorId] = useState<number | null>(null);
  const [medioPago, setMedioPago] = useState<MedioPago>('CN');
  const [motivo, setMotivo] = useState<Motivo>('POR DEVOLUCION');
  const [destinoPago, setDestinoPago] = useState<'CAJA_CENTRAL' | 'CAJA'>('CAJA_CENTRAL');
  const [descripcion, setDescripcion] = useState('');

  // Step 2: Compra selection
  const [compraId, setCompraId] = useState<number | null>(null);
  const [fechaDesde, setFechaDesde] = useState<string | undefined>();
  const [fechaHasta, setFechaHasta] = useState<string | undefined>();

  // Step 3: Items (for devolucion/anulacion)
  const [devItems, setDevItems] = useState<DevolucionItem[]>([]);

  // Descuento / Diferencia Precio
  const [descuentoPct, setDescuentoPct] = useState<number>(0);
  const [montoManual, setMontoManual] = useState<number>(0);

  // Fetch proveedores
  const { data: proveedores = [] } = useQuery({
    queryKey: ['purchases-proveedores'],
    queryFn: () => purchasesApi.getProveedores(),
    enabled: open,
    staleTime: 60000,
  });

  // Fetch compras para NC
  const { data: compras = [], isLoading: loadingCompras } = useQuery({
    queryKey: ['compras-para-nc', proveedorId, fechaDesde, fechaHasta],
    queryFn: () => ncComprasApi.getComprasParaNC(proveedorId!, { fechaDesde, fechaHasta }),
    enabled: !!proveedorId,
  });

  // Fetch items de compra
  const { data: itemsCompra = [], isLoading: loadingItems } = useQuery({
    queryKey: ['items-compra-nc', compraId],
    queryFn: () => ncComprasApi.getItemsCompra(compraId!),
    enabled: !!compraId && (motivo === 'POR DEVOLUCION' || motivo === 'POR ANULACION'),
  });

  // Check for existing NCs on the selected purchase
  const { data: existeNC } = useQuery({
    queryKey: ['existe-nc', compraId],
    queryFn: () => ncComprasApi.existeNC(compraId!),
    enabled: !!compraId,
  });

  // Check if user has an open cash register
  const { data: miCaja } = useQuery({
    queryKey: ['mi-caja'],
    queryFn: () => cajaApi.getMiCaja(),
    enabled: open && medioPago === 'CN',
    staleTime: 30000,
  });

  // Populate devolucion items from purchase items
  useEffect(() => {
    if (itemsCompra.length > 0 && compraId) {
      if (motivo === 'POR ANULACION') {
        // Auto-select all available quantities
        setDevItems(itemsCompra.map(item => ({
          PRODUCTO_ID: item.PRODUCTO_ID,
          PRODUCTO_NOMBRE: item.PRODUCTO_NOMBRE,
          PRODUCTO_CODIGO: item.PRODUCTO_CODIGO,
          UNIDAD_ABREVIACION: item.UNIDAD_ABREVIACION,
          CANTIDAD_ORIGINAL: item.CANTIDAD,
          CANTIDAD_YA_DEVUELTA: item.CANTIDAD_YA_DEVUELTA,
          CANTIDAD_DEVOLVER: Math.max(0, item.CANTIDAD - item.CANTIDAD_YA_DEVUELTA),
          PRECIO_COMPRA: item.PRECIO_COMPRA,
          DEPOSITO_ID: item.DEPOSITO_ID,
        })));
      } else {
        // Devolucion: user picks quantities
        setDevItems(itemsCompra.map(item => ({
          PRODUCTO_ID: item.PRODUCTO_ID,
          PRODUCTO_NOMBRE: item.PRODUCTO_NOMBRE,
          PRODUCTO_CODIGO: item.PRODUCTO_CODIGO,
          UNIDAD_ABREVIACION: item.UNIDAD_ABREVIACION,
          CANTIDAD_ORIGINAL: item.CANTIDAD,
          CANTIDAD_YA_DEVUELTA: item.CANTIDAD_YA_DEVUELTA,
          CANTIDAD_DEVOLVER: 0,
          PRECIO_COMPRA: item.PRECIO_COMPRA,
          DEPOSITO_ID: item.DEPOSITO_ID,
        })));
      }
    }
  }, [itemsCompra, motivo, compraId]);

  // Reset when proveedor changes
  useEffect(() => {
    setCompraId(null);
    setDevItems([]);
    setDescuentoPct(0);
    setMontoManual(0);
  }, [proveedorId]);

  // Reset items when compra changes
  useEffect(() => {
    setDevItems([]);
    setDescuentoPct(0);
    setMontoManual(0);
  }, [compraId]);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setProveedorId(null);
      setMedioPago('CN');
      setMotivo('POR DEVOLUCION');
      setDestinoPago('CAJA_CENTRAL');
      setDescripcion('');
      setCompraId(null);
      setFechaDesde(undefined);
      setFechaHasta(undefined);
      setDevItems([]);
      setDescuentoPct(0);
      setMontoManual(0);
    }
  }, [open]);

  // ── Selected compra info ───────────────────────
  const compraSeleccionada = useMemo(() => compras.find(c => c.COMPRA_ID === compraId), [compras, compraId]);

  // When CC selected, check if proveedor has CTA CTE
  const proveedorSeleccionado = useMemo(
    () => proveedores.find((p: any) => p.PROVEEDOR_ID === proveedorId),
    [proveedores, proveedorId],
  );

  // ── Auto-set medioPago if purchase is CC ───────
  useEffect(() => {
    if (compraSeleccionada?.ES_CTA_CORRIENTE) {
      setMedioPago('CC');
    }
  }, [compraSeleccionada]);

  // ── Calculate total ────────────────────────────
  const montoNC = useMemo(() => {
    if (!compraSeleccionada) return 0;
    switch (motivo) {
      case 'POR DEVOLUCION':
        return devItems.reduce((s, i) => s + i.CANTIDAD_DEVOLVER * i.PRECIO_COMPRA, 0);
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

  // ── Create mutation ────────────────────────────
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

  // ── Handle submit ─────────────────────────────
  const handleSubmit = () => {
    if (!proveedorId || !compraId) return;
    if (montoNC <= 0) {
      message.warning('El monto de la NC debe ser mayor a 0');
      return;
    }

    const items: NCCompraItemInput[] | undefined =
      (motivo === 'POR DEVOLUCION' || motivo === 'POR ANULACION')
        ? devItems
            .filter(i => i.CANTIDAD_DEVOLVER > 0)
            .map(i => ({
              PRODUCTO_ID: i.PRODUCTO_ID,
              CANTIDAD_DEVUELTA: i.CANTIDAD_DEVOLVER,
              PRECIO_COMPRA: i.PRECIO_COMPRA,
              DEPOSITO_ID: i.DEPOSITO_ID,
            }))
        : undefined;

    if ((motivo === 'POR DEVOLUCION' || motivo === 'POR ANULACION') && (!items || items.length === 0)) {
      message.warning('Seleccioná al menos un ítem con cantidad a devolver');
      return;
    }

    const input: NCCompraInput = {
      COMPRA_ID: compraId,
      PROVEEDOR_ID: proveedorId,
      MOTIVO: motivo,
      MEDIO_PAGO: medioPago,
      MONTO: motivo === 'POR DIFERENCIA PRECIO' ? montoManual : undefined,
      DESCUENTO: motivo === 'POR DESCUENTO' ? descuentoPct : undefined,
      DESCRIPCION: descripcion || undefined,
      DESTINO_PAGO: medioPago === 'CN' ? destinoPago : undefined,
      items,
    };

    createMutation.mutate(input);
  };

  // ── Item columns for devolucion/anulacion ──────
  const itemColumns = [
    {
      title: 'Código', dataIndex: 'PRODUCTO_CODIGO', width: 90, align: 'center' as const,
    },
    {
      title: 'Producto', dataIndex: 'PRODUCTO_NOMBRE', ellipsis: true,
    },
    {
      title: 'Cant. Comprada', dataIndex: 'CANTIDAD_ORIGINAL', width: 120, align: 'center' as const,
      render: (v: number) => v % 1 === 0 ? v : fmtNum(v),
    },
    {
      title: 'Devueltas', dataIndex: 'CANTIDAD_YA_DEVUELTA', width: 100, align: 'center' as const,
      render: (v: number) => v > 0 ? <Text type="danger">{v % 1 === 0 ? v : fmtNum(v)}</Text> : '-',
    },
    {
      title: 'Disponible', key: 'dispo', width: 100, align: 'center' as const,
      render: (_: unknown, r: DevolucionItem) => {
        const dispo = Math.max(0, r.CANTIDAD_ORIGINAL - r.CANTIDAD_YA_DEVUELTA);
        return <Text type="secondary">{dispo % 1 === 0 ? dispo : fmtNum(dispo)}</Text>;
      },
    },
    {
      title: 'A devolver', key: 'devolver', width: 120, align: 'center' as const,
      render: (_: unknown, r: DevolucionItem, idx: number) => {
        const max = Math.max(0, r.CANTIDAD_ORIGINAL - r.CANTIDAD_YA_DEVUELTA);
        return (
          <InputNumber
            min={0}
            max={max}
            value={r.CANTIDAD_DEVOLVER}
            disabled={motivo === 'POR ANULACION'}
            size="small"
            style={{ width: 80 }}
            onChange={(val) => {
              const newItems = [...devItems];
              newItems[idx] = { ...r, CANTIDAD_DEVOLVER: val ?? 0 };
              setDevItems(newItems);
            }}
          />
        );
      },
    },
    {
      title: 'P. Compra', dataIndex: 'PRECIO_COMPRA', width: 110, align: 'center' as const,
      render: (v: number) => fmtMoney(v),
    },
    {
      title: 'Subtotal', key: 'sub', width: 120, align: 'right' as const,
      render: (_: unknown, r: DevolucionItem) => (
        <Text strong>{fmtMoney(r.CANTIDAD_DEVOLVER * r.PRECIO_COMPRA)}</Text>
      ),
    },
  ];

  // ── Compra selection columns ───────────────────
  const compraColumns = [
    { title: '#', dataIndex: 'COMPRA_ID', width: 70, align: 'center' as const },
    {
      title: 'Fecha', dataIndex: 'FECHA_COMPRA', width: 110, align: 'center' as const,
      render: (v: string) => new Date(v).toLocaleDateString('es-AR'),
    },
    {
      title: 'Comprobante', key: 'voucher', width: 180, align: 'center' as const,
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
      title: 'Total', dataIndex: 'TOTAL', width: 120, align: 'right' as const,
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
    },
    {
      title: 'Tipo', key: 'tipo', width: 90, align: 'center' as const,
      render: (_: unknown, r: CompraParaNC) => (
        <Tag color={r.ES_CTA_CORRIENTE ? 'blue' : 'green'}>{r.ES_CTA_CORRIENTE ? 'Cta.Cte.' : 'Contado'}</Tag>
      ),
    },
  ];

  // Check if form is valid
  const canSubmit = !!(proveedorId && compraId && montoNC > 0 && !createMutation.isPending);

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
      width={950}
      footer={[
        <Button key="cancel" onClick={onClose}>Cancelar</Button>,
        <Button
          key="submit"
          type="primary"
          className="btn-gold"
          icon={<CheckCircleOutlined />}
          disabled={!canSubmit}
          loading={createMutation.isPending}
          onClick={handleSubmit}
        >
          Crear NC por {fmtMoney(montoNC)}
        </Button>,
      ]}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* ── SECTION 1: Proveedor & Config ─────── */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>
              <ShopOutlined /> Proveedor
            </Text>
            <Select
              showSearch
              placeholder="Seleccioná un proveedor"
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
            />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Motivo</Text>
            <Select
              value={motivo}
              onChange={(v) => { setMotivo(v); setDevItems([]); setDescuentoPct(0); setMontoManual(0); }}
              style={{ width: '100%' }}
              options={[
                { value: 'POR DEVOLUCION', label: '📦 Devolución' },
                { value: 'POR ANULACION', label: '🚫 Anulación' },
                { value: 'POR DESCUENTO', label: '💰 Descuento' },
                { value: 'POR DIFERENCIA PRECIO', label: '📊 Dif. Precio' },
              ]}
            />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Medio de pago</Text>
            <Radio.Group
              value={medioPago}
              onChange={e => setMedioPago(e.target.value)}
              disabled={!!compraSeleccionada?.ES_CTA_CORRIENTE}
            >
              <Radio.Button value="CN">Contado</Radio.Button>
              <Radio.Button value="CC">Cta. Cte.</Radio.Button>
            </Radio.Group>
          </div>
        </div>

        {/* ── SECTION 2: Contado destination ────── */}
        {medioPago === 'CN' && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Text strong>Destino ingreso:</Text>
            <Radio.Group value={destinoPago} onChange={e => setDestinoPago(e.target.value)}>
              <Radio.Button value="CAJA_CENTRAL">Caja Central</Radio.Button>
              <Radio.Button value="CAJA" disabled={!miCaja}>Caja Usuario</Radio.Button>
            </Radio.Group>
            {!miCaja && medioPago === 'CN' && (
              <Tag color="orange">No tenés caja abierta (solo Caja Central disponible)</Tag>
            )}
          </div>
        )}

        {/* ── SECTION 3: Purchase Selection ─────── */}
        {proveedorId && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Text strong><ShoppingCartOutlined /> Seleccioná la compra a asociar</Text>
              <Space>
                <RangePicker
                  size="small"
                  format="DD/MM/YYYY"
                  value={[
                    fechaDesde ? dayjs(fechaDesde) : null,
                    fechaHasta ? dayjs(fechaHasta) : null,
                  ]}
                  onChange={(dates) => {
                    setFechaDesde(dates?.[0]?.format('YYYY-MM-DD'));
                    setFechaHasta(dates?.[1]?.format('YYYY-MM-DD'));
                  }}
                  allowClear
                  placeholder={['Desde', 'Hasta']}
                />
              </Space>
            </div>

            {existeNC?.existe && compraId && (
              <Alert
                type="warning"
                message={`Esta compra ya tiene ${existeNC.notas.length} NC activa(s)`}
                style={{ marginBottom: 8 }}
                showIcon
              />
            )}

            <Table
              dataSource={compras}
              columns={compraColumns}
              loading={loadingCompras}
              rowKey="COMPRA_ID"
              size="small"
              pagination={{ pageSize: 5, size: 'small' }}
              scroll={{ y: 200 }}
              rowSelection={{
                type: 'radio',
                selectedRowKeys: compraId ? [compraId] : [],
                onChange: (keys) => setCompraId(keys[0] as number),
              }}
              onRow={(record) => ({
                onClick: () => setCompraId(record.COMPRA_ID),
                style: { cursor: 'pointer' },
              })}
              locale={{ emptyText: <Empty description="Sin compras para este proveedor" /> }}
            />
          </div>
        )}

        {/* ── SECTION 4: Motivo-specific content ── */}
        {compraId && compraSeleccionada && (
          <>
            {/* Devolucion / Anulacion: items grid */}
            {(motivo === 'POR DEVOLUCION' || motivo === 'POR ANULACION') && (
              <div>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>
                  <UndoOutlined /> {motivo === 'POR ANULACION' ? 'Todos los ítems serán devueltos' : 'Seleccioná cantidades a devolver'}
                </Text>
                <Table
                  dataSource={devItems}
                  columns={itemColumns}
                  loading={loadingItems}
                  rowKey="PRODUCTO_ID"
                  size="small"
                  pagination={false}
                  scroll={{ y: 250 }}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={7}>
                        <Text strong style={{ marginLeft: 8 }}>Total NC</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={7} align="right">
                        <Text strong style={{ color: '#EABD23', fontSize: 15 }}>
                          {fmtMoney(montoNC)}
                        </Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
              </div>
            )}

            {/* Descuento */}
            {motivo === 'POR DESCUENTO' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', background: '#1a1a1e', borderRadius: 8 }}>
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>
                    <PercentageOutlined /> Porcentaje de descuento
                  </Text>
                  <InputNumber
                    min={0.01}
                    max={100}
                    value={descuentoPct}
                    onChange={v => setDescuentoPct(v ?? 0)}
                    addonAfter="%"
                    style={{ width: 150 }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ display: 'block' }}>Total compra: {fmtMoney(compraSeleccionada.TOTAL)}</Text>
                  <Text strong style={{ fontSize: 18, color: '#EABD23' }}>
                    NC: {fmtMoney(montoNC)}
                  </Text>
                </div>
              </div>
            )}

            {/* Diferencia de precio */}
            {motivo === 'POR DIFERENCIA PRECIO' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', background: '#1a1a1e', borderRadius: 8 }}>
                <div>
                  <Text strong style={{ display: 'block', marginBottom: 4 }}>
                    <DollarOutlined /> Monto de la NC
                  </Text>
                  <InputNumber
                    min={0.01}
                    max={compraSeleccionada.TOTAL}
                    value={montoManual}
                    onChange={v => setMontoManual(v ?? 0)}
                    addonBefore="$"
                    style={{ width: 200 }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <Text type="secondary" style={{ display: 'block' }}>Total compra: {fmtMoney(compraSeleccionada.TOTAL)}</Text>
                  <Text strong style={{ fontSize: 18, color: '#EABD23' }}>
                    NC: {fmtMoney(montoNC)}
                  </Text>
                </div>
              </div>
            )}

            {/* Descripcion */}
            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Descripción (opcional)</Text>
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
              padding: '12px 20px', background: 'linear-gradient(135deg, #1E1F22, #2a2b2e)',
              borderRadius: 8, border: '1px solid #EABD23',
            }}>
              <div>
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Compra #{compraId}</Text>
                <Text type="secondary">
                  {compraSeleccionada.PROVEEDOR_NOMBRE || proveedorSeleccionado?.NOMBRE || ''}
                  {' — '}
                  {medioPago === 'CC' ? 'Cta. Corriente' : `Contado → ${destinoPago === 'CAJA' ? 'Caja' : 'Caja Central'}`}
                </Text>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>Monto NC</Text>
                <span style={{ fontSize: 22, fontWeight: 'bold', color: '#EABD23' }}>
                  {fmtMoney(montoNC)}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
