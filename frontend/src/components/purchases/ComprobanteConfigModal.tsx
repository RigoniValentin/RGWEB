import { useEffect, useMemo, useState } from 'react';
import {
  Modal, Input, Select, Button, DatePicker, Switch, Tooltip,
  Tag, InputNumber, Checkbox, Space, Typography,
} from 'antd';
import {
  ShopOutlined, FileTextOutlined, InboxOutlined,
  CalendarOutlined, SwapOutlined, QuestionCircleOutlined,
  ArrowRightOutlined, CloseOutlined, DownOutlined, UpOutlined,
  LinkOutlined, FileDoneOutlined, DeleteOutlined,
  CheckCircleOutlined, WarningOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { purchasesApi } from '../../services/purchases.api';
import { usePurchaseDraftStore } from '../../store/purchaseDraftStore';
import { fmtMoney } from '../../utils/format';
import { notify } from '../../utils/notify';
import { RemitoPickerModal } from './RemitoPickerModal';

const { Title, Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  onContinue: () => void;
  /**
   * Si viene, es un "editar" desde dentro del modal de compra: al continuar,
   * simplemente cerramos esta modal y volvemos al modal de compra (NO abrimos
   * uno nuevo). Si es `undefined`, al continuar se abre el modal de compra.
   */
  mode?: 'setup' | 'edit';
}

/**
 * Modal de configuración del comprobante de compra.
 *
 * Se abre ANTES del modal de compra para que el usuario defina proveedor,
 * fecha, tipo de comprobante, numeración, depósito, cta cte,
 * actualización de stock/costos/precios y (opcional) remito + percepciones
 * + descuento general. Una vez configurado, hace click en "Continuar a la
 * compra" para abrir el modal de carga de productos.
 *
 * El estado se sincroniza con el draft store para que `NewPurchaseModal`
 * pueda leerlo cuando se monte.
 */
export function ComprobanteConfigModal({ open, onClose, onContinue, mode = 'setup' }: Props) {
  const draft = usePurchaseDraftStore(s => s.draft);
  const updateDraft = usePurchaseDraftStore(s => s.updateDraft);

  // ── Local form state (synced with draft) ──
  const [proveedorId, setProveedorId] = useState<number | null>(draft.proveedorId);
  const [depositoId, setDepositoId] = useState<number | null>(draft.depositoId);
  const [tipoComprobante, setTipoComprobante] = useState<string>(draft.tipoComprobante);
  const [fechaCompra, setFechaCompra] = useState<dayjs.Dayjs>(dayjs(draft.fechaCompra));
  const [ptoVta, setPtoVta] = useState<string>(draft.ptoVta);
  const [nroComprobante, setNroComprobante] = useState<string>(draft.nroComprobante);
  const [esCtaCorriente, setEsCtaCorriente] = useState<boolean>(draft.esCtaCorriente);
  const [actualizarStock, setActualizarStock] = useState<boolean>(draft.actualizarStock);
  const [actualizarCostos, setActualizarCostos] = useState<boolean>(draft.actualizarCostos);
  const [actualizarPrecios, setActualizarPrecios] = useState<boolean>(draft.actualizarPrecios);
  const [ivaIncluido, setIvaIncluido] = useState<boolean>(draft.ivaIncluido);
  const [ivaManual, setIvaManual] = useState<number>(draft.ivaManual);
  const [percepcionIva, setPercepcionIva] = useState<number>(draft.percepcionIva);
  const [percepcionIibb, setPercepcionIibb] = useState<number>(draft.percepcionIibb);
  const [dtoGral, setDtoGral] = useState<number>(draft.dtoGral);
  const [impIntGravaIva, setImpIntGravaIva] = useState<boolean>(draft.impIntGravaIva);
  const [remitoId, setRemitoId] = useState<number | null>(draft.remitoId);
  const [remitoSnap, setRemitoSnap] = useState<typeof draft.remitoSnap>(draft.remitoSnap);
  const [remitoPickerOpen, setRemitoPickerOpen] = useState(false);

  // ── UI state ──
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // ── Re-sync from draft when modal opens (so edits from purchase modal reflect) ──
  useEffect(() => {
    if (open) {
      setProveedorId(draft.proveedorId);
      setDepositoId(draft.depositoId);
      setTipoComprobante(draft.tipoComprobante);
      setFechaCompra(dayjs(draft.fechaCompra));
      setPtoVta(draft.ptoVta);
      setNroComprobante(draft.nroComprobante);
      setEsCtaCorriente(draft.esCtaCorriente);
      setActualizarStock(draft.actualizarStock);
      setActualizarCostos(draft.actualizarCostos);
      setActualizarPrecios(draft.actualizarPrecios);
      setIvaIncluido(draft.ivaIncluido);
      setIvaManual(draft.ivaManual);
      setPercepcionIva(draft.percepcionIva);
      setPercepcionIibb(draft.percepcionIibb);
      setDtoGral(draft.dtoGral);
      setImpIntGravaIva(draft.impIntGravaIva);
      setRemitoId(draft.remitoId);
      setRemitoSnap(draft.remitoSnap);
    }
  }, [open]);

  // ── Data queries ──
  const { data: proveedores = [] } = useQuery({
    queryKey: ['purchases-proveedores'],
    queryFn: () => purchasesApi.getProveedores(),
    enabled: open,
    staleTime: 60000,
  });

  const { data: depositos = [] } = useQuery({
    queryKey: ['purchases-depositos'],
    queryFn: () => purchasesApi.getDepositos(),
    enabled: open,
    staleTime: 60000,
  });

  // Auto-select first deposit
  useEffect(() => {
    if (open && depositos.length > 0 && !depositoId) {
      setDepositoId(depositos[0]!.DEPOSITO_ID);
    }
  }, [open, depositos, depositoId]);

  // ── Derived ──
  const isFacturaA = tipoComprobante === 'FA';

  const comprobanteCompleto = useMemo(() => {
    if (!proveedorId) return false;
    if (!ptoVta || ptoVta === '0000') return false;
    if (!nroComprobante || nroComprobante === '00000000') return false;
    return true;
  }, [proveedorId, ptoVta, nroComprobante]);

  // Checklist for the bottom hint
  const checks = [
    {
      done: !!proveedorId,
      label: proveedorId
        ? `Proveedor: ${proveedores.find(p => p.PROVEEDOR_ID === proveedorId)?.NOMBRE ?? ''}`
        : 'Seleccionar proveedor',
    },
    {
      done: !!(ptoVta && ptoVta !== '0000'),
      label: ptoVta && ptoVta !== '0000' ? `Pto. Vta: ${ptoVta}` : 'Cargar punto de venta',
    },
    {
      done: !!(nroComprobante && nroComprobante !== '00000000'),
      label: nroComprobante && nroComprobante !== '00000000'
        ? `Número: ${nroComprobante}`
        : 'Cargar número de comprobante',
    },
  ];

  // ── Remito: aplicar y auto-popular el cart (mismo flujo que NewPurchaseModal) ──
  const applyRemito = async (remitoSeleccionado: {
    REMITO_ID: number; PTO_VTA: string; NRO_REMITO: string;
    FECHA: string; TOTAL: number; PROVEEDOR_ID: number | null;
  }) => {
    try {
      // Si el remito tiene proveedor, autoseleccionarlo
      if (remitoSeleccionado.PROVEEDOR_ID && !proveedorId) {
        setProveedorId(remitoSeleccionado.PROVEEDOR_ID);
      }
      setRemitoId(remitoSeleccionado.REMITO_ID);
      setRemitoSnap({
        REMITO_ID: remitoSeleccionado.REMITO_ID,
        PTO_VTA: remitoSeleccionado.PTO_VTA,
        NRO_REMITO: remitoSeleccionado.NRO_REMITO,
        FECHA: remitoSeleccionado.FECHA,
        TOTAL: remitoSeleccionado.TOTAL,
      });
      // Forzar ACTUALIZAR_STOCK=false (el remito ya ajustó stock)
      setActualizarStock(false);
      notify.success(
        `Remito ${remitoSeleccionado.PTO_VTA}-${remitoSeleccionado.NRO_REMITO} asociado. Stock ya ajustado por el remito.`
      );
      setRemitoPickerOpen(false);
    } catch (err: any) {
      notify.error(err?.response?.data?.error || 'No se pudo asociar el remito');
    }
  };

  const clearRemito = () => {
    setRemitoId(null);
    setRemitoSnap(null);
    setActualizarStock(true);
  };

  // ── Persist to draft on every change ──
  useEffect(() => {
    if (!open) return;
    updateDraft({
      proveedorId, depositoId, tipoComprobante,
      fechaCompra: fechaCompra.toISOString(),
      ptoVta, nroComprobante,
      esCtaCorriente,
      actualizarStock, actualizarCostos, actualizarPrecios,
      ivaIncluido, ivaManual,
      percepcionIva, percepcionIibb, dtoGral, impIntGravaIva,
      remitoId, remitoSnap,
    });
  }, [
    open, proveedorId, depositoId, tipoComprobante, fechaCompra,
    ptoVta, nroComprobante, esCtaCorriente,
    actualizarStock, actualizarCostos, actualizarPrecios,
    ivaIncluido, ivaManual, percepcionIva, percepcionIibb, dtoGral, impIntGravaIva,
    remitoId, remitoSnap,
  ]);

  // ── Continue handler ──
  const handleContinue = () => {
    if (!proveedorId) {
      notify.warning('Seleccione un proveedor');
      return;
    }
    if (!ptoVta || ptoVta === '0000') {
      notify.warning('Ingrese el punto de venta');
      return;
    }
    if (!nroComprobante || nroComprobante === '00000000') {
      notify.warning('Ingrese el número de comprobante');
      return;
    }
    onContinue();
  };

  const handleTipoComprobanteChange = (val: string) => {
    setTipoComprobante(val);
    if (val === 'FA') {
      setIvaIncluido(true);
    } else {
      setIvaManual(0);
      setIvaIncluido(true);
    }
  };

  // ── Render ──
  return (
    <>
      <Modal
        open={open}
        onCancel={onClose}
        width={900}
        centered
        destroyOnClose
        maskClosable={false}
        closable={false}
        footer={null}
        className="new-sale-modal"
        styles={{ body: { padding: 0, overflow: 'hidden' } }}
      >
        {/* ── Header (RG style) ── */}
        <div className="nsm-header">
          <div className="nsm-header-left">
            <FileTextOutlined className="nsm-header-icon" />
            <div>
              <Title level={4} style={{ margin: 0, color: '#fff' }}>
                {mode === 'edit' ? 'Editar comprobante' : 'Configuración del comprobante'}
              </Title>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
                {mode === 'edit'
                  ? 'Modificá los datos del comprobante de esta compra.'
                  : 'Antes de cargar productos, completá los datos del comprobante.'}
              </Text>
            </div>
          </div>
          <Button
            type="text"
            onClick={onClose}
            style={{ color: 'rgba(255,255,255,0.7)', fontSize: 22, lineHeight: 1 }}
            icon={<CloseOutlined />}
          />
        </div>

        <div className="ccm-body">
          {/* ── Row 1: required comprobante fields ── */}
          <div className="ccm-section">
            <div className="ccm-section-title">
              <FileTextOutlined /> Datos del comprobante
            </div>

            <div className="ccm-grid ccm-grid-required">
              <div className="ccm-field ccm-field-proveedor">
                <label className="ccm-label">
                  <ShopOutlined /> Proveedor <span className="ccm-required">*</span>
                </label>
                <Select
                  showSearch
                  placeholder="Seleccionar proveedor"
                  optionFilterProp="label"
                  value={proveedorId}
                  onChange={(val) => {
                    setProveedorId(val ?? null);
                    // Si había un remito asociado, ya no es válido para el nuevo proveedor
                    if (remitoSnap) {
                      setRemitoId(null);
                      setRemitoSnap(null);
                      setActualizarStock(true);
                    }
                  }}
                  allowClear
                  size="large"
                  autoFocus
                  options={proveedores.map(p => ({
                    value: p.PROVEEDOR_ID,
                    label: `${p.CODIGOPARTICULAR} - ${p.NOMBRE}`,
                  }))}
                />
                {(() => {
                  const prov = proveedores.find(p => p.PROVEEDOR_ID === proveedorId);
                  if (!prov) return null;
                  const cond = (prov.CONDICION_IVA || '').toUpperCase();
                  const esMono = cond.includes('MONOTRIBUT');
                  const esExento = cond.includes('EXENT') || cond.includes('CONSUMIDOR');
                  const noDiscrimina = esMono || esExento;
                  if (!cond) return null;
                  return (
                    <div className="ccm-prov-tag">
                      <Tag color={noDiscrimina ? 'orange' : 'blue'} style={{ margin: 0, fontSize: 11 }}>
                        {prov.CONDICION_IVA}
                      </Tag>
                      {noDiscrimina && (
                        <Tooltip title="Este proveedor no discrimina IVA en sus comprobantes. El costo sin impuestos coincidirá con el costo con impuestos al cargar la compra.">
                          <Text type="warning" style={{ fontSize: 11 }}>
                            ⓘ No discrimina IVA
                          </Text>
                        </Tooltip>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="ccm-field">
                <label className="ccm-label">
                  <CalendarOutlined /> Fecha
                </label>
                <DatePicker
                  value={fechaCompra}
                  onChange={value => setFechaCompra(value || dayjs())}
                  format="DD/MM/YYYY"
                  allowClear={false}
                  size="large"
                  style={{ width: '100%' }}
                />
              </div>

              <div className="ccm-field">
                <label className="ccm-label">
                  <FileTextOutlined /> Tipo <span className="ccm-required">*</span>
                </label>
                <Select
                  value={tipoComprobante}
                  onChange={handleTipoComprobanteChange}
                  size="large"
                  options={[
                    { value: 'FA', label: 'Factura A' },
                    { value: 'FB', label: 'Factura B' },
                    { value: 'FC', label: 'Factura C' },
                    { value: 'FM', label: 'Factura M' },
                    { value: 'X', label: 'Comprobante X' },
                  ]}
                />
              </div>

              <div className="ccm-field ccm-field-numero">
                <label className="ccm-label">
                  Numeración <span className="ccm-required">*</span>
                </label>
                <div className="ccm-numero">
                  <Input
                    value={ptoVta}
                    onChange={e => setPtoVta(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
                    onBlur={() => setPtoVta(prev => prev.padStart(4, '0'))}
                    onFocus={e => e.target.select()}
                    size="large"
                    placeholder="0000"
                    style={{ width: 90, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}
                    maxLength={4}
                  />
                  <span className="ccm-numero-sep">-</span>
                  <Input
                    value={nroComprobante}
                    onChange={e => setNroComprobante(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
                    onBlur={() => setNroComprobante(prev => prev.padStart(8, '0'))}
                    onFocus={e => e.target.select()}
                    size="large"
                    placeholder="00000000"
                    style={{ flex: 1, fontFamily: 'monospace', textAlign: 'center', letterSpacing: 1 }}
                    maxLength={8}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Row 2: depósito, tipo carga, cta cte, actualizar ── */}
          <div className="ccm-section">
            <div className="ccm-section-title">
              <InboxOutlined /> Opciones de carga
            </div>

            <div className="ccm-grid ccm-grid-secondary">
              <div className="ccm-field">
                <label className="ccm-label">
                  <InboxOutlined /> Depósito
                </label>
                <Select
                  placeholder="Depósito"
                  value={depositoId}
                  onChange={setDepositoId}
                  size="large"
                  style={{ width: '100%' }}
                  options={depositos.map(d => ({
                    value: d.DEPOSITO_ID,
                    label: d.NOMBRE,
                  }))}
                />
              </div>

              <div className="ccm-field">
                <label className="ccm-label">
                  <SwapOutlined /> Cuenta Corriente
                  <Tooltip title="Si el proveedor no tiene cuenta corriente, se creará automáticamente al finalizar la operación.">
                    <QuestionCircleOutlined style={{ marginLeft: 4, color: '#8c8c8c', cursor: 'help' }} />
                  </Tooltip>
                </label>
                <div className="ccm-switch-row">
                  <Switch
                    checked={esCtaCorriente}
                    onChange={setEsCtaCorriente}
                  />
                  <span className="ccm-switch-label">
                    {esCtaCorriente ? 'Compra a cta. cte.' : 'Pago inmediato'}
                  </span>
                </div>
              </div>

              <div className="ccm-field">
                <label className="ccm-label">Actualizar al registrar</label>
                <div className="ccm-update-row">
                  <Checkbox
                    checked={actualizarStock}
                    onChange={e => setActualizarStock(e.target.checked)}
                  >
                    Stock
                  </Checkbox>
                  <Checkbox
                    checked={actualizarCostos}
                    onChange={e => setActualizarCostos(e.target.checked)}
                  >
                    Costos
                  </Checkbox>
                  <Checkbox
                    checked={actualizarPrecios}
                    onChange={e => setActualizarPrecios(e.target.checked)}
                    disabled={!actualizarCostos}
                  >
                    Precios
                  </Checkbox>
                </div>
              </div>
            </div>
          </div>

          {/* ── Advanced (collapsible) ── */}
          <div className="ccm-advanced">
            <div
              className="ccm-advanced-trigger"
              onClick={() => setAdvancedOpen(o => !o)}
            >
              {advancedOpen ? <UpOutlined /> : <DownOutlined />}
              Opciones avanzadas (remito, percepciones, descuento general)
            </div>
            {advancedOpen && (
              <div className="ccm-advanced-grid">
                {/* Remito */}
                <div className="ccm-advanced-col">
                  <label className="ccm-label">
                    <LinkOutlined /> Remito de entrada
                  </label>
                  {remitoSnap ? (
                    <div className="ccm-remito-card">
                      <div className="ccm-remito-card-row">
                        <FileDoneOutlined className="ccm-remito-card-icon" />
                        <div className="ccm-remito-card-info">
                          <Text strong style={{ fontSize: 12 }}>
                            Remito {remitoSnap.PTO_VTA}-{remitoSnap.NRO_REMITO}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {dayjs(remitoSnap.FECHA).format('DD/MM/YYYY')} · {fmtMoney(remitoSnap.TOTAL)}
                          </Text>
                        </div>
                        <Tooltip
                          title="Stock ya ajustado por el remito — la compra sólo registrará la factura, sin incrementar stock nuevamente."
                          placement="top"
                        >
                          <InfoCircleOutlined className="ccm-remito-card-hint" />
                        </Tooltip>
                        <Button
                          size="small"
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={clearRemito}
                        />
                      </div>
                    </div>
                  ) : (
                    <Button
                      block
                      icon={<LinkOutlined />}
                      onClick={() => setRemitoPickerOpen(true)}
                    >
                      Asociar remito de entrada
                    </Button>
                  )}
                </div>

                {/* Percepciones */}
                <div className="ccm-advanced-col">
                  <label className="ccm-label">Percepciones</label>
                  <div className="ccm-perc-row">
                    <InputNumber
                      value={percepcionIva}
                      min={0}
                      onChange={val => setPercepcionIva(val || 0)}
                      placeholder="0.00"
                      prefix="$"
                      addonBefore="IVA"
                      controls={false}
                      style={{ flex: 1, width: '100%' }}
                    />
                    <InputNumber
                      value={percepcionIibb}
                      min={0}
                      onChange={val => setPercepcionIibb(val || 0)}
                      placeholder="0.00"
                      prefix="$"
                      addonBefore="IIBB"
                      controls={false}
                      style={{ flex: 1, width: '100%' }}
                    />
                  </div>
                </div>

                {/* Descuento + imp int */}
                <div className="ccm-advanced-col">
                  <label className="ccm-label">Descuento General %</label>
                  <InputNumber
                    value={dtoGral}
                    min={0}
                    max={100}
                    step={0.5}
                    onChange={val => setDtoGral(val || 0)}
                    style={{ width: '100%' }}
                    suffix="%"
                    controls={false}
                  />
                  {isFacturaA && (
                    <Checkbox
                      checked={impIntGravaIva}
                      onChange={e => setImpIntGravaIva(e.target.checked)}
                    >
                      Imp. internos gravan IVA
                    </Checkbox>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="ccm-footer">
          <div className="ccm-footer-checklist">
            {checks.map((c, i) => (
              <span key={i} className={`ccm-check ${c.done ? 'done' : 'pending'}`}>
                {c.done ? <CheckCircleOutlined /> : <WarningOutlined />}
                {c.label}
              </span>
            ))}
          </div>

          <Space>
            <Button size="large" onClick={onClose} icon={<CloseOutlined />}>
              Cancelar
            </Button>
            <Button
              type="primary"
              size="large"
              className="btn-gold"
              icon={mode === 'edit' ? <CheckCircleOutlined /> : <ArrowRightOutlined />}
              onClick={handleContinue}
              disabled={!comprobanteCompleto}
            >
              {mode === 'edit' ? 'Guardar cambios' : 'Continuar a la compra'}
            </Button>
          </Space>
        </div>
      </Modal>

      <RemitoPickerModal
        open={remitoPickerOpen}
        proveedorId={proveedorId}
        onClose={() => setRemitoPickerOpen(false)}
        onSelect={applyRemito}
      />
    </>
  );
}