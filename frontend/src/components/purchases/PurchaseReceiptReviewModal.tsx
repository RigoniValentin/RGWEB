import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Modal, Button, Upload, Spin, Tag, Space, Typography, Table, Select,
  Input, InputNumber, Tooltip, Result, Alert, Empty, Divider, Badge, message,
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
import { ProductPickerForReceiptModal } from './ProductPickerForReceiptModal';
import { RGCajaModalHeader } from '../RGCajaModalHeader';
import { rgIcon } from '../rg-icons';
import {
  useReceiptDraftStore,
  derivePublicUrlFromSavedPath,
  type ReceiptDraftLineItemDecision,
} from '../../store/receiptDraftStore';

const { Title, Text } = Typography;
const { Dragger } = Upload;

// ── Tipos locales ──────────────────────────────────────────────────────
type MatchAction = 'VINCULAR' | 'CREAR_NUEVO' | 'OMITIR';

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
  /** Proveedor pre-seleccionado desde el modal padre. Si está presente, se
   *  usa como valor inicial del encabezado (prevalece sobre el match del
   *  matcher cuando la IA no encuentra un proveedor por CUIT/razón social). */
  initialProveedorId?: number | null;
  initialProveedorNombre?: string;
  initialProveedorCUIT?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────
function splitNumeroCompleto(numCompleto: string | null): { ptoVta: string; nro: string } {
  if (!numCompleto) return { ptoVta: '', nro: '' };
  const normalized = numCompleto.trim();

  // Caso 1: formatos con etiqueta tipo "Pto Vta: 0001 - Nro: 00054261"
  //         o "Punto de Venta 1 / Número 54261" (común cuando la IA trae el
  //         texto literal del comprobante en lugar de un campo estructurado).
  const pvMatch = normalized.match(/(?:pto\s*\.?\s*vta|punto\s+de\s+venta|pv)[\s:]*?(\d{1,5})/i);
  const nroMatch = normalized.match(/(?:nro|n[uú]mero|nº|n°|comprobante)[\s:]*?(\d{1,8})/i);
  if (pvMatch && nroMatch) {
    return {
      ptoVta: pvMatch[1]!.padStart(4, '0'),
      nro: nroMatch[1]!.padStart(8, '0'),
    };
  }

  // Caso 2: separadores explícitos (0001-00099160, 0001 00099160, 0001/00099160)
  const m1 = normalized.match(/^(\d{1,5})[\s\-/.]+(\d{1,8})$/);
  if (m1) {
    return { ptoVta: m1[1]!.padStart(4, '0'), nro: m1[2]!.padStart(8, '0') };
  }

  // Caso 3: una sola cadena de dígitos — los últimos 8 son el número,
  //         el resto es el punto de venta.
  const onlyDigits = normalized.replace(/\D/g, '');
  if (onlyDigits.length >= 9 && onlyDigits.length <= 16) {
    const nroStr = onlyDigits.slice(-8);
    const ptoVtaStr = onlyDigits.slice(0, onlyDigits.length - 8);
    return { ptoVta: ptoVtaStr.padStart(4, '0'), nro: nroStr.padStart(8, '0') };
  }

  // Fallback: si solo parece un número suelto, devolver como nro
  return { ptoVta: '', nro: onlyDigits.padStart(8, '0').slice(-8) };
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
export function PurchaseReceiptReviewModal({
  open, onClose, onApplied, defaultDepositoId,
  initialProveedorId, initialProveedorNombre, initialProveedorCUIT,
}: Props) {
  // ── Estado persistido en localStorage (sobrevive a cierres/refreshes) ──
  const persisted = useReceiptDraftStore(s => s.draft);
  const updatePersisted = useReceiptDraftStore(s => s.updateDraft);
  const clearPersisted = useReceiptDraftStore(s => s.clearDraft);

  // ── Estado efímero del modal (no se persiste) ─────────────────────────
  const [phase, setPhase] = useState<'idle' | 'parsing' | 'review' | 'error'>(
    () => persisted.parsed ? 'review' : 'idle'
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(() => {
    if (persisted.parsed?.saved_path) return derivePublicUrlFromSavedPath(persisted.parsed.saved_path);
    return null;
  });
  const [tasaIvaDefault, setTasaIvaDefault] = useState<{ TASA_ID: number; PORCENTAJE: number } | null>(null);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerIdx, setProductPickerIdx] = useState<number | null>(null);
  const [imageModalOpen, setImageModalOpen] = useState(false);

  // Si al abrir hay draft persistido, salta directo a 'review' (sin pedir
  // otra imagen). Si NO hay draft persistido, forzamos 'idle' explícitamente:
  // el state `phase` puede sobrevivir entre aperturas según cómo Antd resuelva
  // destroyOnClose, y si quedó en 'review' con `parsed = null` el modal
  // muestra una pantalla en blanco.
  useEffect(() => {
    if (!open) return;
    if (persisted.parsed) {
      setPhase('review');
    } else {
      setPhase('idle');
      setErrorMsg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Proveedores del sistema ───────────────────────────────────────────
  const { data: proveedoresAll = [] } = useQuery<ProveedorCompra[]>({
    queryKey: ['purchases-proveedores'],
    queryFn: () => purchasesApi.getProveedores(),
    enabled: open,
    staleTime: 60000,
  });

  // ── Tasa de IVA default ──────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    productApi.getTasasImpuestos().then(tasas => {
      const def = tasas.find(t => t.PREDETERMINADA) ?? tasas.find(t => t.ACTIVA) ?? tasas[0];
      if (def) setTasaIvaDefault({ TASA_ID: def.TASA_ID, PORCENTAJE: def.PORCENTAJE });
    }).catch(() => { /* ignorar */ });
  }, [open]);

  // Cleanup del blob URL al desmontar/cambiar
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  // ── Helpers del store (alias de lectura) ───────────────────────────────
  const parsed: ParsedReceiptResponse | null = persisted.parsed;
  const decisions = persisted.decisions as Record<number, ReceiptDraftLineItemDecision>;
  const codigoProveedorOverrides = persisted.codigoProveedorOverrides;
  const editingCode = persisted.editingCode;
  const status = phase;

  const getEffectiveCode = (idx: number, aiCode: string | null): string => {
    const v = codigoProveedorOverrides[idx];
    return v !== undefined ? v : (aiCode ?? '');
  };

  const updateDecision = (idx: number, patch: Partial<ReceiptDraftLineItemDecision>) => {
    const current = persisted.decisions[idx];
    if (!current) return;
    updatePersisted({
      decisions: { ...persisted.decisions, [idx]: { ...current, ...patch } },
    });
  };

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
    setPhase('parsing');
    setErrorMsg(null);
    // Limpiamos cualquier persistencia previa para evitar mezclar drafts.
    clearPersisted();
    // Re-sembramos el proveedor pre-seleccionado (si lo hay) para que la IA
    // no lo pise cuando no encuentra match por CUIT/razón social. El matcher
    // luego decide si gana el match o el pre-seleccionado.
    if (initialProveedorId) {
      updatePersisted({
        proveedorId: initialProveedorId,
        proveedorNombre: initialProveedorNombre ?? '',
        proveedorCUIT: initialProveedorCUIT ?? '',
        proveedorCrear: false,
      });
    }
    if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));

    purchasesApi.parseReceipt(file, initialProveedorId)
      .then((resp) => {
        const pm = resp.proveedor_match;
        const numeroCrudo = resp.comprobante.numero_comprobante;
        const { ptoVta: pv, nro } = splitNumeroCompleto(numeroCrudo);
        // eslint-disable-next-line no-console
        console.debug('[parse-image] numero_comprobante:', JSON.stringify(numeroCrudo), '→', { pv, nro });

        // Decisiones iniciales derivadas de los matches de la IA
        //
        // Importante: usamos `precio_unitario_neto` como precio inicial (no
        // `precio_unitario`) para que el campo "P. Compra" y el subtotal
        // del carrito YA tengan descontada la bonificación global prorrateada
        // por el backend (ver purchaseReceipt.prorrateo.ts). Si la factura
        // no tiene bonificación, los dos campos son iguales.
        const initialDecisions: Record<number, ReceiptDraftLineItemDecision> = {};
        resp.items.forEach((it, idx) => {
          initialDecisions[idx] = {
            cantidad: it.cantidad,
            precio_unitario: it.precio_unitario_neto ?? it.precio_unitario,
            descuento_porcentaje: it.descuento_porcentaje,
            linked_producto_id: it.linked_producto?.PRODUCTO_ID ?? null,
            linked_producto: it.linked_producto,
            mark_as_new: it.match_status === 'crear_nuevo',
            excluded: it.match_status === 'omitir',
          };
        });

        // Persistir todo de una sola vez
        // Proveedor: si la IA encontró match por CUIT/razón social gana ese;
        // si no, conservamos el pre-seleccionado por el modal padre.
        // Si tampoco hay pre-seleccionado, caemos a la razón social del comprobante.
        const resolvedProveedorId = pm?.PROVEEDOR_ID ?? initialProveedorId ?? null;
        const resolvedProveedorNombre = pm?.NOMBRE
          ?? initialProveedorNombre
          ?? resp.comprobante.proveedor.razon_social
          ?? '';
        const resolvedProveedorCUIT = pm?.CUIT
          ?? initialProveedorCUIT
          ?? resp.comprobante.proveedor.cuit
          ?? '';
        updatePersisted({
          parsed: resp,
          status: 'review',
          proveedorId: resolvedProveedorId,
          proveedorNombre: resolvedProveedorNombre,
          proveedorCUIT: resolvedProveedorCUIT,
          proveedorCrear: false,
          tipoComprobante: resp.tipo_comprobante_interno,
          ptoVta: pv || '0000',
          nroComprobante: nro || '00000000',
          // Fecha de registro = hoy. La fecha del comprobante queda como
          // dato informativo en el parseo pero NO pisa la fecha con la que
          // se va a registrar la compra (mismo criterio que aplicamos en el
          // modal padre).
          fechaEmision: dayjs().toISOString(),
          decisions: initialDecisions,
          codigoProveedorOverrides: {},
          editingCode: null,
        });
        // Reemplazamos el blob local por la URL del backend (si re-abre el modal desde el store)
        if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(derivePublicUrlFromSavedPath(resp.saved_path));
        setPhase('review');
      })
      .catch((err) => {
        setPhase('error');
        setErrorMsg(err?.response?.data?.error ?? err?.message ?? 'Error desconocido al analizar la imagen.');
      });

    return false; //阻止 auto-upload (lo gestionamos manualmente)
  };

  const handleCancel = async () => {
    // Descartar explícitamente: borramos la imagen en el backend y limpiamos
    // el draft. Típicamente disparado por el botón "Cancelar" del footer o
    // la X explícita — NO por el shake del click afuera ni por refresh.
    const savedPath = parsed?.saved_path;
    clearPersisted();
    if (savedPath) {
      try { await purchasesApi.discardParsedImage(savedPath); } catch { /* ignore */ }
    }
    onClose();
  };

  // ── Manejo de items ──────────────────────────────────────────────
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
      updatePersisted({
        proveedorId: result.PROVEEDOR_ID,
        proveedorNombre: nombre,
        proveedorCUIT: cuit,
        proveedorCrear: false,
      });
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
      // Resolver el código de proveedor efectivo (override del usuario > AI).
      const effectiveCodigo = getEffectiveCode(idx, it.codigo_proveedor)?.trim() || null;
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
        codigo_proveedor: effectiveCodigo,
      });
    });
    return { items, warnings };
  }, [parsed, decisions, defaultDepositoId, tasaIvaDefault, codigoProveedorOverrides]);

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

    let finalProveedorId = persisted.proveedorId;

    // Si tildó "Crear proveedor nuevo" pero aún no lo creó
    if (persisted.proveedorCrear && !persisted.proveedorId) {
      notify.warning('Creá el proveedor nuevo antes de aplicar.');
      return;
    }
    if (!finalProveedorId) {
      notify.warning('Seleccioná un proveedor o creá uno nuevo.');
      return;
    }

    onApplied({
      proveedorId: finalProveedorId,
      proveedorNombre: persisted.proveedorNombre,
      tipoComprobante: persisted.tipoComprobante,
      ptoVta: persisted.ptoVta,
      nroComprobante: persisted.nroComprobante,
      fechaEmision: persisted.fechaEmision,
      items: decisionesParaAplicar.items,
      saved_path: parsed.saved_path,
      public_url: parsed.public_url,
      proveedor_creado: persisted.proveedorCrear,
    });

    // El comprobante ya fue volcado al carrito: limpia el draft de IA.
    // La imagen ya quedó persistida en purchaseDraftStore.comprobanteImagePath
    // del modal principal, donde viajará al backend al confirmar la compra.
    clearPersisted();
  };

  // ── Columnas de la tabla de items ────────────────────────────────
  const itemColumns: TableColumnsType<{ item: EnrichedReceiptItem; idx: number }> = [
    {
      title: 'Acción IA',
      dataIndex: ['item', 'sugerencia_accion'],
      width: 90,
      render: (_: any, { item }) => (
        <Tag color={actionTagColor(item.sugerencia_accion)}>
          {item.sugerencia_accion}
        </Tag>
      ),
    },
    {
      title: 'Descripción',
      dataIndex: ['item', 'descripcion_proveedor'],
      width: 360,
      render: (_: any, { item, idx }) => {
        const d = decisions[idx];
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{item.descripcion_proveedor}</div>
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text type="secondary" style={{ fontSize: 11 }}>Cód. proveedor:</Text>
              <EditableCodeTag
                value={getEffectiveCode(idx, item.codigo_proveedor)}
                aiOriginal={item.codigo_proveedor ?? ''}
                editing={editingCode === idx}
                onStartEdit={() => updatePersisted({ editingCode: idx })}
                onChange={(v) => updatePersisted({
                  codigoProveedorOverrides: { ...codigoProveedorOverrides, [idx]: v },
                })}
                onReset={() => updatePersisted({
                  codigoProveedorOverrides: (() => {
                    const next = { ...codigoProveedorOverrides };
                    delete next[idx];
                    return next;
                  })(),
                })}
              />
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
      width: 80,
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
      width: 100,
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
      width: 70,
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
      width: 100,
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
      width: 320,
      render: (_: any, { item, idx }) => {
        const d = decisions[idx];
        if (!d) return null;
        if (d.excluded) return <Text type="secondary">No se incluye</Text>;

        const openPicker = () => {
          setProductPickerIdx(idx);
          setProductPickerOpen(true);
        };

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
                <Button size="small" icon={<SyncOutlined />} onClick={openPicker}>
                  Buscar / Crear
                </Button>
              </Space>
            </Space>
          );
        }

        // Sin match o crear nuevo
        return (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Tag color={statusTag(item.match_status).color}>{statusTag(item.match_status).label}</Tag>
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openPicker} block>
              Buscar / Crear producto
            </Button>
          </Space>
        );
      },
    },
    {
      title: '',
      width: 40,
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
    <>
    <Modal
      open={open}
      onCancel={handleCancel}
      width="95vw"
      style={{ top: 20, maxWidth: 1400 }}
      footer={null}
      destroyOnClose
      maskClosable={false}
      className="rg-modal purchase-receipt-modal"
      title={
        <RGCajaModalHeader
          icon={rgIcon('imagen-ia')}
          title="Cargar comprobante por imagen"
          subtitle="La IA extrae proveedor, número, fecha e ítems del comprobante"
        />
      }
      styles={{ body: { padding: 0, overflow: 'hidden', height: 'calc(100vh - 110px)' } }}
    >
      <div style={{ padding: '20px 24px', height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
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
            <Button key="retry" type="primary" onClick={() => { clearPersisted(); setPhase('idle'); setErrorMsg(null); }}>Elegir otra imagen</Button>,
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
            proveedorId={persisted.proveedorId}
            proveedorNombre={persisted.proveedorNombre}
            proveedorCUIT={persisted.proveedorCUIT}
            proveedoresCandidatos={parsed.proveedores_candidatos}
            proveedoresAll={proveedoresAll}
            onSelectProveedor={(p: ProveedorMatch | null) => {
              updatePersisted({
                proveedorId: p?.PROVEEDOR_ID ?? null,
                proveedorNombre: p?.NOMBRE ?? '',
                proveedorCUIT: p?.CUIT ?? '',
                proveedorCrear: false,
              });
            }}
            onCreateNew={(creating) => updatePersisted({ proveedorCrear: creating })}
            onCrearProveedor={handleCreateProveedor}
            proveedorCrear={persisted.proveedorCrear}
            tipoComprobante={persisted.tipoComprobante}
            onTipoComprobante={(v) => updatePersisted({ tipoComprobante: v })}
            ptoVta={persisted.ptoVta}
            onPtoVta={(v) => updatePersisted({ ptoVta: v })}
            nroComprobante={persisted.nroComprobante}
            onNroComprobante={(v) => updatePersisted({ nroComprobante: v })}
            fechaEmision={persisted.fechaEmision ? dayjs(persisted.fechaEmision) : null}
            onFechaEmision={(d) => updatePersisted({ fechaEmision: d?.toISOString() ?? null })}
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
              scroll={{ y: 'calc(100vh - 480px)' }}
            />
          )}

          <Divider />

          {/* Totales */}
          <TotalesCard parsed={parsed} subtotalItems={subtotalItems} />

            <Divider />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Space>
                <Button
                  onClick={async () => {
                    const sp = parsed?.saved_path;
                    clearPersisted();
                    setPhase('idle');
                    setErrorMsg(null);
                    if (sp) { try { await purchasesApi.discardParsedImage(sp); } catch { /* ignore */ } }
                  }}
                  icon={<CameraOutlined />}
                >Elegir otra imagen</Button>
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
      </div>

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

    <ProductPickerForReceiptModal
      open={productPickerOpen}
      onClose={() => {
        setProductPickerOpen(false);
        setProductPickerIdx(null);
      }}
      onPick={(producto) => {
        if (productPickerIdx !== null) {
          handlePickCandidato(productPickerIdx, producto.PRODUCTO_ID, producto);
        }
        setProductPickerOpen(false);
        setProductPickerIdx(null);
      }}
      initialQuery={productPickerIdx !== null ? parsed?.items[productPickerIdx]?.descripcion_proveedor ?? '' : ''}
      initialCodigoProveedor={productPickerIdx !== null
        ? (codigoProveedorOverrides[productPickerIdx] ?? parsed?.items[productPickerIdx]?.codigo_proveedor ?? null)
        : null}
      initialPrecio={productPickerIdx !== null ? decisions[productPickerIdx]?.precio_unitario : undefined}
      tasaIvaDefault={tasaIvaDefault}
    />
    </>
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
    tipoComprobante, onTipoComprobante, fechaEmision, onFechaEmision,
  } = props;

  // State local para ptoVta / nroComprobante. Mismo patrón que el modal
  // ComprobanteConfigModal: mientras el usuario tipea, sólo se sanitiza
  // (sin padStart) para no pisar lo digitado; al perder foco, se hace
  // padStart y se propaga al padre (store).
  const [ptoVtaDraft, setPtoVtaDraft] = useState(props.ptoVta);
  const [nroDraft, setNroDraft] = useState(props.nroComprobante);

  // Sincronizar si la prop cambia externamente (ej. aplicar al carrito).
  useEffect(() => {
    if (props.ptoVta !== ptoVtaDraft) setPtoVtaDraft(props.ptoVta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.ptoVta]);
  useEffect(() => {
    if (props.nroComprobante !== nroDraft) setNroDraft(props.nroComprobante);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.nroComprobante]);

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
            value={ptoVtaDraft}
            placeholder="0000"
            onChange={e => setPtoVtaDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            onBlur={() => {
              const formatted = ptoVtaDraft.padStart(4, '0');
              setPtoVtaDraft(formatted);
              if (formatted !== props.ptoVta) props.onPtoVta(formatted);
            }}
            onFocus={e => e.target.select()}
            style={{ fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}
            maxLength={4}
          />
        </div>

        <div>
          <Text type="secondary" style={{ fontSize: 11 }}>NÚMERO</Text>
          <Input
            value={nroDraft}
            placeholder="00000000"
            onChange={e => setNroDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
            onBlur={() => {
              const formatted = nroDraft.padStart(8, '0');
              setNroDraft(formatted);
              if (formatted !== props.nroComprobante) props.onNroComprobante(formatted);
            }}
            onFocus={e => e.target.select()}
            style={{ fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}
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
  // Cuadramos contra `subtotal - bonificacion_total` (que es lo que debería
  // sumar el carrito si el prorrateo se aplicó bien). Esto refleja el "neto"
  // de la factura, no el subtotal bruto.
  const subtotalEsperadoNeto = (t.subtotal ?? 0) - (t.bonificacion_total ?? 0);
  const diff = Math.abs(subtotalEsperadoNeto - subtotalItems);
  const diffPct = subtotalEsperadoNeto > 0 ? (diff / subtotalEsperadoNeto) * 100 : 0;
  const hayBonificacion = (t.bonificacion_total ?? 0) > 0.01;

  // Porcentaje de bonificación detectado — viene en cualquier ítem (es el mismo
  // para toda la factura, el backend lo aplica uniforme).
  const pctBonif = parsed.items.find(it => it.porcentaje_bonificacion_aplicado)?.porcentaje_bonificacion_aplicado ?? 0;

  return (
    <Card size="small" title="Totales">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <TotalCell label="Subtotal IA" value={fmtMoney(t.subtotal)} />
        <TotalCell label="Bonificación" value={fmtMoney(t.bonificacion_total)} />
        <TotalCell label="IVA" value={fmtMoney(t.iva_total)} />
        <TotalCell label="Percepciones" value={fmtMoney(t.percepciones)} />
        <TotalCell label="TOTAL IA" value={fmtMoney(t.total_final)} accent />
      </div>
      {hayBonificacion && (
        <div style={{
          marginTop: 10, padding: '8px 12px',
          background: 'rgba(234, 189, 35, 0.12)',
          border: '1px solid rgba(234, 189, 35, 0.4)',
          borderRadius: 6,
          display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
        }}>
          <Tag color="gold" style={{ marginRight: 0 }}>% {pctBonif.toFixed(2)}</Tag>
          <Text>
            <strong>Bonificación global aplicada.</strong> El precio unitario de cada
            ítem ya viene descontado proporcionalmente (−{(t.bonificacion_total ?? 0).toLocaleString('es-AR', {
              style: 'currency', currency: 'ARS', minimumFractionDigits: 2,
            })}).
          </Text>
        </div>
      )}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Text>{hayBonificacion ? 'Subtotal neto calculado:' : 'Subtotal calculado desde ítems:'}</Text>
        <Text strong>{fmtMoney(subtotalItems)}</Text>
        {hayBonificacion && (
          <Text type="secondary" style={{ fontSize: 11 }}>
            (esperado {fmtMoney(subtotalEsperadoNeto)})
          </Text>
        )}
        {diff > 0.01 && (
          <Badge
            count={`Diferencia ${fmtMoney(diff)} (${diffPct.toFixed(1)}%)`}
            style={{ backgroundColor: diffPct > 1 ? '#ff4d4f' : '#faad14' }}
          />
        )}
        {diff <= 0.01 && (
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

// ── Sub-componente: Tag de código de proveedor editable al click ──────
// Muestra un <Tag> compacto. Al hacer click (o presionar Enter sobre el),
// se reemplaza por un <Input size="small"> cuyo ancho crece con el contenido.
// Al perder foco o presionar Enter fuera de foco, se confirma.
function EditableCodeTag(props: {
  value: string;
  aiOriginal: string;
  editing: boolean;
  onStartEdit: () => void;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  const { value, aiOriginal, editing, onStartEdit, onChange, onReset } = props;
  const inputRef = useRef<any>(null);
  const wasEdited = aiOriginal !== '' && value !== aiOriginal;
  const isEmpty = !value;

  useEffect(() => {
    if (editing && inputRef.current) {
      const t = setTimeout(() => {
        try { inputRef.current?.focus?.({ cursor: 'end' }); } catch { /* noop */ }
        try { inputRef.current?.select?.(); } catch { /* noop */ }
      }, 20);
      return () => clearTimeout(t);
    }
  }, [editing]);

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Input
          ref={inputRef}
          size="small"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={() => { /* el padre mantiene el foco del producto con click */ }}
          onPressEnter={() => (document.activeElement as HTMLElement | null)?.blur?.()}
          style={{
            width: 'auto',
            minWidth: 80,
            maxWidth: 220,
            fontFamily: 'monospace',
          }}
          placeholder="(sin código)"
        />
        {wasEdited && (
          <Tooltip title={`Original IA: ${aiOriginal}`}>
            <Button size="small" type="link" onMouseDown={(e) => { e.preventDefault(); onReset(); }}>
              Restablecer IA
            </Button>
          </Tooltip>
        )}
      </span>
    );
  }

  return (
    <Tooltip title={isEmpty ? 'Click para cargar código' : 'Click para editar'}>
      <Tag
        onClick={onStartEdit}
        style={{
          cursor: 'text',
          fontFamily: 'monospace',
          background: isEmpty ? '#fafafa' : (wasEdited ? 'rgba(250, 173, 20, 0.12)' : '#f0f0f0'),
          color: isEmpty ? '#999' : (wasEdited ? '#d48806' : '#333'),
          borderStyle: 'dashed',
          borderColor: wasEdited ? '#faad14' : '#d9d9d9',
        }}
      >
        {isEmpty ? '(sin código)' : value}
      </Tag>
    </Tooltip>
  );
}
