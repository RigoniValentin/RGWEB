import { useState, useEffect, useMemo } from 'react';
import {
  Modal, Button, Upload, Spin, Tag, Space, Typography, Table, Select,
  Input, InputNumber, Tooltip, Popover, Result, Alert, Empty, Divider, Badge, message,
} from 'antd';
import type { UploadProps, TableColumnsType } from 'antd';
import {
  CameraOutlined, InboxOutlined, CloseCircleOutlined, CheckCircleOutlined,
  PlusOutlined, SyncOutlined, FileImageOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useQuery } from '@tanstack/react-query';
import { purchasesApi } from '../../services/purchases.api';
import { productApi } from '../../services/product.api';
import { supplierApi } from '../../services/supplier.api';
import type {
  ParsedReceiptResponse, EnrichedReceiptItem, ProductoCandidato, ProveedorMatch,
} from '../../services/purchases.api';
import { notify } from '../../utils/notify';
import type { CompraItemInput, ProveedorCompra } from '../../types';
import { ProductSearchCreatePopover } from './ProductSearchCreatePopover';

const { Title, Text } = Typography;
const { Dragger } = Upload;

// ── Tipos locales ──────────────────────────────────────────────────────
type MatchAction = 'VINCULAR' | 'CREAR_NUEVO' | 'OMITIR';

interface LineItemDecision {
  /** Editables a nivel de fila. */
  cantidad: number;
  precio_unitario: number;
  descuento_porcentaje: number;
  /** Producto al que quedó ligado (manual desde candidatos o creado on-the-fly). */
  linked_producto_id: number | null;
  linked_producto?: ProductoCandidato;
  /** Si el usuario lo marcó para crear. */
  mark_as_new: boolean;
  /** Si el usuario lo excluye del envío (OMITIR o VINCULAR con producto no resuelto). */
  excluded: boolean;
}

export interface ReceiptAppliedData {
  proveedorId: number;
  proveedorNombre: string;
  tipoComprobante: string;
  ptoVta: string;
  nroComprobante: string;
  fechaEmision: string | null;
  items: CompraItemInput[];
  saved_path: string;
  public_url: string;
  proveedor_creado: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Invocado cuando el usuario confirma "Aplicar al carrito". */
  onApplied: (data: ReceiptAppliedData) => void;
  /** Depósito por defecto donde aterrizan los nuevos ítems. */
  defaultDepositoId: number | null;
}

// ── Helpers ────────────────────────────────────────────────────────────
function splitNumeroCompleto(numCompleto: string | null): { ptoVta: string; nro: string } {
  if (!numCompleto) return { ptoVta: '', nro: '' };
  // Acepta formatos "0001-00001234" o "0001 00001234" o "0001/00001234"
  const m = numCompleto.match(/^(\d{1,5})[\s\-/]+(\d{1,8}).*$/);
  if (m) return { ptoVta: m[1]!.padStart(4, '0'), nro: m[2]!.padStart(8, '0') };
  // Si no hay separador claro, intentar partir al medio.
  if (numCompleto.length >= 5) {
    const half = Math.floor(numCompleto.length / 2);
    return { ptoVta: numCompleto.slice(0, half).padStart(4, '0'), nro: numCompleto.slice(half).padStart(8, '0') };
  }
  return { ptoVta: '', nro: numCompleto };
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 });
}

function actionTagColor(action: MatchAction): string {
  if (action === 'VINCULAR') return 'green';
  if (action === 'CREAR_NUEVO') return 'blue';
  return 'default';
}

function statusTag(status: EnrichedReceiptItem['match_status']): { color: string; label: string } {
  switch (status) {
    case 'vinculado': return { color: 'success', label: 'Vinculado' };
    case 'candidatos_multiples': return { color: 'warning', label: 'Elegir candidato' };
    case 'crear_nuevo': return { color: 'processing', label: 'A crear' };
    case 'omitir': return { color: 'default', label: 'Omitido' };
    case 'sin_match': return { color: 'error', label: 'Sin match' };
  }
}

// ── Componente ─────────────────────────────────────────────────────────
export function PurchaseReceiptReviewModal({ open, onClose, onApplied, defaultDepositoId }: Props) {
  const [status, setStatus] = useState<'idle' | 'parsing' | 'review' | 'error'>('idle');
  const [parsed, setParsed] = useState<ParsedReceiptResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [proveedorId, setProveedorId] = useState<number | null>(null);
  const [proveedorNombre, setProveedorNombre] = useState<string>('');
  const [proveedorCUIT, setProveedorCUIT] = useState<string>('');
  const [proveedorCrear, setProveedorCrear] = useState<boolean>(false);

  const [tipoComprobante, setTipoComprobante] = useState<string>('FB');
  const [ptoVta, setPtoVta] = useState<string>('0000');
  const [nroComprobante, setNroComprobante] = useState<string>('00000000');
  const [fechaEmision, setFechaEmision] = useState<dayjs.Dayjs | null>(null);

  const [decisions, setDecisions] = useState<Record<number, LineItemDecision>>({});
  const [tasaIvaDefault, setTasaIvaDefault] = useState<{ TASA_ID: number; PORCENTAJE: number } | null>(null);

  // ── Lista completa de proveedores del sistema (para el select del encabezado)
  const { data: proveedoresAll = [] } = useQuery<ProveedorCompra[]>({
    queryKey: ['purchases-proveedores'],
    queryFn: () => purchasesApi.getProveedores(),
    enabled: open,
    staleTime: 60000,
  });

  // ── Códigos de proveedor editables por índice de ítem (null = usar el de la IA) ──
  const [codigoProveedorOverrides, setCodigoProveedorOverrides] = useState<Record<number, string>>({});

  // ── Modal de vista previa ampliada ─────────────────────────────
  const [imageModalOpen, setImageModalOpen] = useState(false);

  // ── Cargar tasa IVA por defecto al montar ────────────────────────
  useEffect(() => {
    if (!open) return;
    productApi.getTasasImpuestos().then(tasas => {
      const def = tasas.find(t => t.PREDETERMINADA) ?? tasas.find(t => t.ACTIVA) ?? tasas[0];
      if (def) setTasaIvaDefault({ TASA_ID: def.TASA_ID, PORCENTAJE: def.PORCENTAJE });
    }).catch(() => { /* ignorar */ });
  }, [open]);

  // ── Reset al cerrar / abrir ──────────────────────────────────────
  useEffect(() => {
    if (open) {
      setStatus('idle');
      setParsed(null);
      setErrorMsg(null);
      setProveedorId(null);
      setProveedorNombre('');
      setProveedorCUIT('');
      setProveedorCrear(false);
      setDecisions({});
      setCodigoProveedorOverrides({});
      setImageModalOpen(false);
    } else {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [open]);

  // ── Upload handler ───────────────────────────────────────────────
  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    const ok = /^image\/(jpeg|png|webp|heic)$/i.test(file.type);
    if (!ok) {
      message.error('Formato no soportado. Usá JPG, PNG o WebP.');
      return Upload.LIST_IGNORE;
    }
    if (file.size / 1024 / 1024 > 10) {
      message.error('La imagen supera 10 MB.');
      return Upload.LIST_IGNORE;
    }
    setStatus('parsing');
    setErrorMsg(null);
    setParsed(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));

    purchasesApi.parseReceipt(file)
      .then((resp) => {
        setParsed(resp);
        // Encabezado desde respuesta
        const pm = resp.proveedor_match;
        setProveedorId(pm?.PROVEEDOR_ID ?? null);
        setProveedorNombre(pm?.NOMBRE ?? resp.comprobante.proveedor.razon_social ?? '');
        setProveedorCUIT(pm?.CUIT ?? resp.comprobante.proveedor.cuit ?? '');
        setTipoComprobante(resp.tipo_comprobante_interno);
        const { ptoVta: pv, nro } = splitNumeroCompleto(resp.comprobante.numero_comprobante);
        setPtoVta(pv || '0000');
        setNroComprobante(nro || '00000000');
        if (resp.comprobante.fecha_emision) {
          setFechaEmision(dayjs(resp.comprobante.fecha_emision));
        }
        // Decisiones iniciales
        const initial: Record<number, LineItemDecision> = {};
        resp.items.forEach((it, idx) => {
          initial[idx] = {
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario,
            descuento_porcentaje: it.descuento_porcentaje,
            linked_producto_id: it.linked_producto?.PRODUCTO_ID ?? null,
            linked_producto: it.linked_producto,
            mark_as_new: it.match_status === 'crear_nuevo',
            excluded: it.match_status === 'omitir',
          };
        });
        setDecisions(initial);
        setStatus('review');
      })
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err?.response?.data?.error ?? err?.message ?? 'Error desconocido al analizar la imagen.');
      });

    return false; //阻止 auto-upload (lo gestionamos manualmente)
  };

  const handleCancel = async () => {
    if (parsed?.saved_path) {
      try { await purchasesApi.discardParsedImage(parsed.saved_path); } catch { /* ignore */ }
    }
    onClose();
  };

  // ── Manejo de items ──────────────────────────────────────────────
  const updateDecision = (idx: number, patch: Partial<LineItemDecision>) => {
    setDecisions(prev => ({ ...prev, [idx]: { ...prev[idx]!, ...patch } }));
  };

  const handlePickCandidato = (idx: number, productoId: number, producto?: ProductoCandidato) => {
    // Si recibimos el producto completo (vía popover), guardamos; si no, lo
    // buscamos entre los candidatos ya conocidos para esa fila.
    let prod = producto;
    if (!prod) {
      prod = parsed?.items[idx]?.candidatos.find(c => c.PRODUCTO_ID === productoId);
      if (!prod) return;
    }
    updateDecision(idx, {
      linked_producto_id: productoId,
      linked_producto: prod,
      mark_as_new: false,
      excluded: false,
    });
  };

  const handleCreateProveedor = async (nombre: string, cuit: string) => {
    try {
      const result = await supplierApi.create({ NOMBRE: nombre, CUIT: cuit || undefined } as any);
      setProveedorId(result.PROVEEDOR_ID);
      setProveedorNombre(nombre);
      setProveedorCUIT(cuit);
      setProveedorCrear(false);
      notify.success(`Proveedor "${nombre}" creado.`);
    } catch (err: any) {
      notify.error(err?.response?.data?.error ?? 'No se pudo crear el proveedor');
    }
  };

  // ── Calcular totales cruzados ─────────────────────────────────────
  const subtotalItems = useMemo(() => {
    if (!parsed) return 0;
    return parsed.items.reduce((acc, _it, idx) => {
      const d = decisions[idx];
      if (!d || d.excluded) return acc;
      const neto = d.precio_unitario * (1 - (d.descuento_porcentaje || 0) / 100);
      return acc + neto * d.cantidad;
    }, 0);
  }, [parsed, decisions]);

  // ── Validación para poder aplicar ────────────────────────────────
  const decisionesParaAplicar = useMemo(() => {
    if (!parsed) return { items: [], warnings: [] as string[] };
    const items: CompraItemInput[] = [];
    const warnings: string[] = [];
    parsed.items.forEach((it, idx) => {
      const d = decisions[idx];
      if (!d || d.excluded) return;
      if (!it.sugerencia_accion || it.sugerencia_accion === 'OMITIR') return;
      if (!d.linked_producto_id && !d.mark_as_new) {
        warnings.push(`Item #${idx + 1} (${it.descripcion_proveedor}): requiere producto o marcar como "crear nuevo".`);
        return;
      }
      const prod = d.linked_producto;
      items.push({
        PRODUCTO_ID: d.linked_producto_id ?? 0,
        PRECIO_COMPRA: d.precio_unitario,
        CANTIDAD: d.cantidad,
        DEPOSITO_ID: defaultDepositoId ?? undefined,
        BONIFICACION: d.descuento_porcentaje,
        IMP_INTERNOS: 0,
        IVA_ALICUOTA: (prod?.IVA_PORCENTAJE ?? tasaIvaDefault?.PORCENTAJE ?? 21) / 100,
        TASA_IVA_ID: prod?.TASA_IVA_ID ?? tasaIvaDefault?.TASA_ID ?? null,
        NOMBRE: prod?.NOMBRE ?? it.descripcion_proveedor,
        CODIGO: prod?.CODIGOPARTICULAR ?? it.codigo_proveedor ?? '',
      });
    });
    return { items, warnings };
  }, [parsed, decisions, defaultDepositoId, tasaIvaDefault]);

  const handleApply = async () => {
    if (!parsed) return;
    if (decisionesParaAplicar.warnings.length > 0) {
      notify.warning(decisionesParaAplicar.warnings[0]!);
      return;
    }
    if (decisionesParaAplicar.items.length === 0) {
      notify.warning('No hay ítems para volcar al carrito. Revisá la revisión.');
      return;
    }

    let finalProveedorId = proveedorId;

    // Si tildó "Crear proveedor nuevo" pero aún no lo creó
    if (proveedorCrear && !proveedorId) {
      notify.warning('Creá el proveedor nuevo antes de aplicar.');
      return;
    }
    if (!finalProveedorId) {
      notify.warning('Seleccioná un proveedor o creá uno nuevo.');
      return;
    }

    onApplied({
      proveedorId: finalProveedorId,
      proveedorNombre,
      tipoComprobante,
      ptoVta,
      nroComprobante,
      fechaEmision: fechaEmision?.toISOString() ?? null,
      items: decisionesParaAplicar.items,
      saved_path: parsed.saved_path,
      public_url: parsed.public_url,
      proveedor_creado: proveedorCrear,
    });
  };

  // ── Columnas de la tabla de items ────────────────────────────────
  const itemColumns: TableColumnsType<{ item: EnrichedReceiptItem; idx: number }> = [
    {
      title: 'Acción IA',
      dataIndex: ['item', 'sugerencia_accion'],
      width: 110,
      render: (_: any, { item }) => (
        <Tag color={actionTagColor(item.sugerencia_accion)}>
          {item.sugerencia_accion}
        </Tag>
      ),
    },
    {
      title: 'Descripción',
      dataIndex: ['item', 'descripcion_proveedor'],
      render: (_: any, { item, idx }) => {
        const d = decisions[idx];
        const codeOverride = codigoProveedorOverrides[idx];
        const effectiveCode = codeOverride !== undefined ? codeOverride : (item.codigo_proveedor ?? '');
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{item.descripcion_proveedor}</div>
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Cód. proveedor:</Text>
              <Input
                size="small"
                style={{ width: 140 }}
                value={effectiveCode}
                placeholder="(sin código)"
                onChange={e => setCodigoProveedorOverrides(prev => ({ ...prev, [idx]: e.target.value }))}
              />
              {item.codigo_proveedor && codeOverride !== undefined && codeOverride !== item.codigo_proveedor && (
                <Button
                  size="small"
                  type="link"
                  onClick={() => setCodigoProveedorOverrides(prev => {
                    const next = { ...prev };
                    delete next[idx];
                    return next;
                  })}
                >
                  Restablecer IA
                </Button>
              )}
              <Tooltip title={item.motivo_sugerencia}>
                <Text type="secondary" style={{ fontSize: 11 }}>{item.motivo_sugerencia}</Text>
              </Tooltip>
            </div>
            {item.unidad_medida && (
              <Text type="secondary" style={{ fontSize: 11 }}>Unidad: {item.unidad_medida}</Text>
            )}
            {d?.excluded && (
              <Tag color="default" style={{ marginTop: 4 }}>Excluido</Tag>
            )}
          </div>
        );
      },
    },
    {
      title: 'Cant.',
      width: 90,
      render: (_: any, { idx }) => {
        const d = decisions[idx];
        if (!d || d.excluded) return <Text type="secondary">—</Text>;
        return (
          <InputNumber
            value={d.cantidad}
            min={0.01}
            step={1}
            size="small"
            style={{ width: '100%' }}
            onChange={(v) => updateDecision(idx, { cantidad: Number(v) || 0 })}
          />
        );
      },
    },
    {
      title: 'P. Unit.',
      width: 110,
      render: (_: any, { idx }) => {
        const d = decisions[idx];
        if (!d || d.excluded) return <Text type="secondary">—</Text>;
        return (
          <InputNumber
            value={d.precio_unitario}
            min={0}
            step={0.01}
            size="small"
            style={{ width: '100%' }}
            formatter={v => `$ ${v}`}
            parser={(v) => Number((v ?? '').replace(/[^0-9.,]/g, '').replace(',', '.'))}
            onChange={(v) => updateDecision(idx, { precio_unitario: Number(v) || 0 })}
          />
        );
      },
    },
    {
      title: 'Bonif %',
      width: 80,
      render: (_: any, { idx }) => {
        const d = decisions[idx];
        if (!d || d.excluded) return <Text type="secondary">—</Text>;
        return (
          <InputNumber
            value={d.descuento_porcentaje}
            min={0}
            max={100}
            step={1}
            size="small"
            style={{ width: '100%' }}
            onChange={(v) => updateDecision(idx, { descuento_porcentaje: Number(v) || 0 })}
          />
        );
      },
    },
    {
      title: 'Subtotal',
      width: 110,
      align: 'right',
      render: (_: any, { idx }) => {
        const d = decisions[idx];
        if (!d || d.excluded) return <Text type="secondary">—</Text>;
        const neto = d.precio_unitario * (1 - (d.descuento_porcentaje || 0) / 100);
        const sub = neto * d.cantidad;
        return <Text strong>{fmtMoney(sub)}</Text>;
      },
    },
    {
      title: 'Producto',
      width: 340,
      render: (_: any, { item, idx }) => {
        const d = decisions[idx];
        if (!d) return null;
        if (d.excluded) return <Text type="secondary">No se incluye</Text>;

        // Caso vinculado
        if (d.linked_producto) {
          const isAuto = item.match_status === 'vinculado';
          return (
            <Space direction="vertical" size={4} style={{ width: '100%' }}>
              <Tag color={isAuto ? 'green' : 'gold'} icon={isAuto ? <CheckCircleOutlined /> : <RobotOutlined />}>
                {isAuto ? 'Vinculado' : 'Elegido manualmente'}
              </Tag>
              <Text strong style={{ fontSize: 13 }}>{d.linked_producto.NOMBRE}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {d.linked_producto.CODIGOPARTICULAR ?? '(sin código)'} · Stock: {d.linked_producto.STOCK_ACTUAL ?? 0}
              </Text>
              <Space size={4} wrap>
                {item.candidatos.length > 0 && (
                  <Select
                    size="small"
                    style={{ minWidth: 180 }}
                    placeholder="Cambiar candidato IA"
                    value={undefined}
                    onChange={(v) => { if (typeof v === 'number') handlePickCandidato(idx, v); }}
                    options={item.candidatos.map(c => ({
                      value: c.PRODUCTO_ID,
                      label: `${c.NOMBRE} (${c.CODIGOPARTICULAR ?? 's/c'})`,
                    }))}
                  />
                )}
                <Popover
                  trigger="click"
                  content={
                    <ProductSearchCreatePopover
                      initialQuery={item.descripcion_proveedor}
                      initialCodigoProveedor={codigoProveedorOverrides[idx] ?? item.codigo_proveedor}
                      initialPrecio={d.precio_unitario}
                      tasaDefault={tasaIvaDefault}
                      onPick={(id, prod) => { handlePickCandidato(idx, id, prod); }}
                    />
                  }
                  title="Buscar o crear producto"
                >
                  <Button size="small" icon={<SyncOutlined />}>Buscar / Crear</Button>
                </Popover>
              </Space>
            </Space>
          );
        }

        // Sin match o crear nuevo
        return (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Tag color={statusTag(item.match_status).color}>{statusTag(item.match_status).label}</Tag>
            <Popover
              trigger="click"
              content={
                <ProductSearchCreatePopover
                  initialQuery={item.descripcion_proveedor}
                  initialCodigoProveedor={codigoProveedorOverrides[idx] ?? item.codigo_proveedor}
                  initialPrecio={d.precio_unitario}
                  tasaDefault={tasaIvaDefault}
                  onPick={(id, prod) => { handlePickCandidato(idx, id, prod); }}
                />
              }
              title="Buscar o crear producto"
            >
              <Button size="small" type="primary" icon={<PlusOutlined />} block>
                Buscar / Crear producto
              </Button>
            </Popover>
          </Space>
        );
      },
    },
    {
      title: '',
      width: 44,
      render: (_: any, { item, idx }) => {
        const d = decisions[idx];
        if (!d || item.sugerencia_accion === 'OMITIR') return null;
        return (
          <Tooltip title={d.excluded ? 'Incluir' : 'Excluir'}>
            <Button
              type="text"
              size="small"
              icon={d.excluded ? <PlusOutlined /> : <CloseCircleOutlined />}
              onClick={() => updateDecision(idx, { excluded: !d.excluded })}
            />
          </Tooltip>
        );
      },
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title={<><RobotOutlined /> Cargar comprobante por imagen</>}
      width="95vw"
      style={{ top: 20, maxWidth: 1280 }}
      footer={null}
      destroyOnClose
      className="rg-modal purchase-receipt-modal"
      styles={{ body: { maxHeight: 'calc(100vh - 160px)', overflowY: 'auto', padding: '20px 24px' } }}
    >
      {/* ── IDLE: Dropzone ── */}
      {status === 'idle' && (
        <Dragger
          name="image"
          accept="image/jpeg,image/png,image/webp,image/heic"
          multiple={false}
          showUploadList={false}
          beforeUpload={beforeUpload}
          style={{ padding: '40px 0' }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined style={{ color: '#EABD23', fontSize: 64 }} />
          </p>
          <p className="ant-upload-text" style={{ fontSize: 18, fontWeight: 500 }}>
            Arrastrá una foto de tu factura o remito
          </p>
          <p className="ant-upload-hint" style={{ color: '#888' }}>
            La IA extraerá proveedor, número, fecha e ítems. JPG/PNG/WebP hasta 10&nbsp;MB.
          </p>
        </Dragger>
      )}

      {/* ── PARSING: Spinner ── */}
      {status === 'parsing' && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Spin size="large" />
          <Title level={4} style={{ marginTop: 20 }}>
            <RobotOutlined /> Analizando comprobante con IA…
          </Title>
          <Text type="secondary">Esto puede tomar entre 5 y 20 segundos según la calidad de la foto.</Text>
          {previewUrl && (
            <div style={{ marginTop: 20 }}>
              <img src={previewUrl} alt="preview" style={{ maxWidth: 360, maxHeight: 360, borderRadius: 8, border: '1px solid #eee' }} />
            </div>
          )}
        </div>
      )}

      {/* ── ERROR ── */}
      {status === 'error' && (
        <Result
          status="error"
          title="No se pudo analizar la imagen"
          subTitle={errorMsg ?? 'Verificá que la foto sea legible y reintentá.'}
          extra={[
            <Button key="retry" type="primary" onClick={() => setStatus('idle')}>Elegir otra imagen</Button>,
            <Button key="manual" onClick={handleCancel}>Cargar comprobante manualmente</Button>,
          ]}
        />
      )}

      {/* ── REVIEW ── */}
      {status === 'review' && parsed && (
        <>
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              <span>
                <strong>Análisis completado.</strong> {parsed.items.length} ítems detectados ·
                Tokens usados: <Text code>{parsed.usage?.totalTokens ?? '?'}</Text>
              </span>
            }
          />

          {/* Encabezado */}
          <EncabezadoCard
            proveedorId={proveedorId}
            proveedorNombre={proveedorNombre}
            proveedorCUIT={proveedorCUIT}
            proveedoresCandidatos={parsed.proveedores_candidatos}
            proveedoresAll={proveedoresAll}
            onSelectProveedor={(p: ProveedorMatch | null) => {
              setProveedorId(p?.PROVEEDOR_ID ?? null);
              setProveedorNombre(p?.NOMBRE ?? '');
              setProveedorCUIT(p?.CUIT ?? '');
              setProveedorCrear(false);
            }}
            onCreateNew={setProveedorCrear}
            onCrearProveedor={handleCreateProveedor}
            proveedorCrear={proveedorCrear}
            tipoComprobante={tipoComprobante}
            onTipoComprobante={setTipoComprobante}
            ptoVta={ptoVta}
            onPtoVta={setPtoVta}
            nroComprobante={nroComprobante}
            onNroComprobante={setNroComprobante}
            fechaEmision={fechaEmision}
            onFechaEmision={setFechaEmision}
          />

          <Divider />

          {/* Items */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Title level={5} style={{ margin: 0 }}>Ítems del comprobante</Title>
            <Space>
              <Text type="secondary">{parsed.items.length} líneas detectadas</Text>
              {previewUrl && (
                <Button size="small" icon={<FileImageOutlined />} onClick={() => setImageModalOpen(true)}>
                  Ver imagen
                </Button>
              )}
            </Space>
          </div>
          {parsed.items.length === 0 ? (
            <Empty description="No se detectaron ítems. Cargá el comprobante manualmente." />
          ) : (
            <Table
              rowKey={(_, idx) => String(idx)}
              columns={itemColumns}
              dataSource={parsed.items.map((it, idx) => ({ item: it, idx }))}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
          )}

          <Divider />

          {/* Totales */}
          <TotalesCard parsed={parsed} subtotalItems={subtotalItems} />

            <Divider />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Button onClick={() => setStatus('idle')} icon={<CameraOutlined />}>Elegir otra imagen</Button>
                <Button onClick={handleCancel} icon={<CloseCircleOutlined />}>Cancelar</Button>
              </Space>
              <Button
                type="primary"
                size="large"
                icon={<CheckCircleOutlined />}
                onClick={handleApply}
                disabled={decisionesParaAplicar.items.length === 0}
              >
                Aplicar al carrito ({decisionesParaAplicar.items.length} ítems)
              </Button>
            </div>

            {decisionesParaAplicar.warnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                message={decisionesParaAplicar.warnings.join(' · ')}
              />
            )}
          </>
        )}

        <Modal
          open={imageModalOpen}
          onCancel={() => setImageModalOpen(false)}
          footer={null}
          width="90vw"
          style={{ top: 20, maxWidth: 900 }}
          destroyOnClose
          title="Vista previa del comprobante"
          closable
          className="rg-modal purchase-receipt-image-modal"
        >
          {previewUrl && (
            <img
              src={previewUrl}
              alt="comprobante ampliado"
              style={{ width: '100%', height: 'auto', borderRadius: 6 }}
            />
          )}
        </Modal>
    </Modal>
  );
}

// ── Sub-componente: encabezado editable ─────────────────────────────
import { Card } from 'antd';

function EncabezadoCard(props: {
  proveedorId: number | null;
  proveedorNombre: string;
  proveedorCUIT: string;
  proveedoresCandidatos: ProveedorMatch[];
  proveedoresAll: ProveedorCompra[];
  onSelectProveedor: (p: ProveedorMatch | null) => void;
  onCreateNew: (creating: boolean) => void;
  onCrearProveedor: (nombre: string, cuit: string) => void;
  proveedorCrear: boolean;
  tipoComprobante: string;
  onTipoComprobante: (s: string) => void;
  ptoVta: string;
  onPtoVta: (s: string) => void;
  nroComprobante: string;
  onNroComprobante: (s: string) => void;
  fechaEmision: dayjs.Dayjs | null;
  onFechaEmision: (d: dayjs.Dayjs | null) => void;
}) {
  const {
    proveedorId, proveedorNombre, proveedorCUIT, proveedoresCandidatos, proveedoresAll,
    onSelectProveedor, onCreateNew, onCrearProveedor, proveedorCrear,
    tipoComprobante, onTipoComprobante, ptoVta, onPtoVta, nroComprobante, onNroComprobante,
    fechaEmision, onFechaEmision,
  } = props;

  // Mezcla candidatos IA (arriba, marcados) + todos los proveedores del sistema.
  const iaIds = new Set(proveedoresCandidatos.map(p => p.PROVEEDOR_ID));
  const allForSelect: { id: number; label: React.ReactNode }[] = [];
  proveedoresCandidatos.forEach(p => {
    allForSelect.push({
      id: p.PROVEEDOR_ID,
      label: (
        <span>
          <Tag color="gold" style={{ marginRight: 4 }}>IA</Tag>
          {p.NOMBRE}{p.CUIT ? ` (${p.CUIT})` : ''}
        </span>
      ),
    });
  });
  proveedoresAll.forEach(p => {
    if (!iaIds.has(p.PROVEEDOR_ID)) {
      const docLabel = p.NUMERO_DOC ? ` (${p.NUMERO_DOC})` : '';
      allForSelect.push({
        id: p.PROVEEDOR_ID,
        label: `${p.NOMBRE}${docLabel}`,
      });
    }
  });

  return (
    <Card size="small" title={<>Encabezado</>} style={{ marginBottom: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>PROVEEDOR</Text>
          {!proveedorCrear ? (
            <Select
              style={{ width: '100%' }}
              placeholder="Elegí o buscá un proveedor"
              value={proveedorId ?? undefined}
              showSearch
              optionFilterProp="label"
              optionLabelProp="label"
              options={[
                ...allForSelect.map(p => ({ value: p.id, label: p.label })),
                { value: -1, label: '+ Crear proveedor nuevo' },
              ]}
              onChange={(v) => {
                if (v === -1) {
                  onSelectProveedor(null);
                  onCreateNew(true);
                } else {
                  const candidato = proveedoresCandidatos.find(x => x.PROVEEDOR_ID === v);
                  if (candidato) {
                    onSelectProveedor(candidato);
                  } else {
                    const p = proveedoresAll.find(x => x.PROVEEDOR_ID === v);
                    if (p) {
                      onSelectProveedor({
                        PROVEEDOR_ID: p.PROVEEDOR_ID,
                        NOMBRE: p.NOMBRE,
                        CUIT: p.NUMERO_DOC ?? null,
                      });
                    }
                  }
                }
              }}
            />
          ) : (
            <Space.Compact style={{ width: '100%' }}>
              <Input
                placeholder="Razón social"
                value={proveedorNombre}
                onChange={e => onCrearProveedor(e.target.value, proveedorCUIT)}
              />
              <Input
                placeholder="CUIT 20-XXXXXXXX-X"
                value={proveedorCUIT}
                onChange={e => onCrearProveedor(proveedorNombre, e.target.value)}
              />
            </Space.Compact>
          )}
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>TIPO</Text>
          <Select
            style={{ width: '100%' }}
            value={tipoComprobante}
            onChange={onTipoComprobante}
            options={[
              { value: 'FA', label: 'Factura A' },
              { value: 'FB', label: 'Factura B' },
              { value: 'FC', label: 'Factura C' },
              { value: 'FM', label: 'Factura M' },
              { value: 'RM', label: 'Remito' },
              { value: 'TK', label: 'Ticket' },
            ]}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>PTO. VTA.</Text>
          <Input
            value={ptoVta}
            onChange={e => onPtoVta(e.target.value.replace(/\D/g, '').slice(0, 4).padStart(4, '0'))}
            maxLength={4}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>NÚMERO</Text>
          <Input
            value={nroComprobante}
            onChange={e => onNroComprobante(e.target.value.replace(/\D/g, '').slice(0, 8).padStart(8, '0'))}
            maxLength={8}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>FECHA</Text>
          <DatePickerLite value={fechaEmision} onChange={onFechaEmision} />
        </div>
      </div>
    </Card>
  );
}

// ── Sub-componente: input date minimalista ──────────────────────────
import { DatePicker } from 'antd';
function DatePickerLite(props: { value: dayjs.Dayjs | null; onChange: (d: dayjs.Dayjs | null) => void }) {
  return (
    <DatePicker
      style={{ width: '100%' }}
      value={props.value}
      onChange={props.onChange}
      format="DD/MM/YYYY"
      allowClear
    />
  );
}

// ── Sub-componente: totales ─────────────────────────────────────────
function TotalesCard(props: { parsed: ParsedReceiptResponse; subtotalItems: number }) {
  const { parsed, subtotalItems } = props;
  const t = parsed.totales;
  const diff = t.subtotal != null ? Math.abs(t.subtotal - subtotalItems) : 0;
  const diffPct = t.subtotal && t.subtotal > 0 ? (diff / t.subtotal) * 100 : 0;

  return (
    <Card size="small" title="Totales">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <TotalCell label="Subtotal IA" value={fmtMoney(t.subtotal)} />
        <TotalCell label="Bonificación" value={fmtMoney(t.bonificacion_total)} />
        <TotalCell label="IVA" value={fmtMoney(t.iva_total)} />
        <TotalCell label="Percepciones" value={fmtMoney(t.percepciones)} />
        <TotalCell label="TOTAL IA" value={fmtMoney(t.total_final)} accent />
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Text>Subtotal calculado desde ítems:</Text>
        <Text strong>{fmtMoney(subtotalItems)}</Text>
        {t.subtotal != null && diff > 0.01 && (
          <Badge
            count={`Diferencia ${fmtMoney(diff)} (${diffPct.toFixed(1)}%)`}
            style={{ backgroundColor: diffPct > 1 ? '#ff4d4f' : '#faad14' }}
          />
        )}
        {diff <= 0.01 && t.subtotal != null && (
          <Tag color="success" icon={<CheckCircleOutlined />}>Cuadra OK</Tag>
        )}
      </div>
    </Card>
  );
}

function TotalCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      padding: 8,
      borderRadius: 6,
      background: accent ? 'rgba(234, 189, 35, 0.12)' : '#fafafa',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: accent ? 18 : 14, fontWeight: accent ? 700 : 500, marginTop: 4 }}>{value}</div>
    </div>
  );
}
