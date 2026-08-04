import { useState, useMemo, useEffect } from 'react';
import { Modal, InputNumber, Input, Button, Alert, message, Popover, Divider } from 'antd';
import {
  BankOutlined, ShopOutlined, DollarOutlined, CheckCircleOutlined,
  RightOutlined, DownOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cajaApi } from '../services/caja.api';
import { useAuthStore } from '../store/authStore';
import { RGCajaModalHeader } from './RGCajaModalHeader';
import { rgIcon } from './rg-icons';
import type { CajaConSaldo } from '../types';

interface TransferenciaCajaModalProps {
  open: boolean;
  onClose: () => void;
  preselectedCajaId?: number;
}

type Origen = 'CAJA_CENTRAL' | 'CAJA';
type Destino = 'CAJA_CENTRAL' | 'CAJA';
type Side = 'origen' | 'destino';

function fmtMoney(n: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n);
}

export default function TransferenciaCajaModal({ open, onClose, preselectedCajaId }: TransferenciaCajaModalProps) {
  const [origen, setOrigen] = useState<Origen>('CAJA_CENTRAL');
  const [destino, setDestino] = useState<Destino>('CAJA');
  const [cajaId, setCajaId] = useState<number | null>(preselectedCajaId || null);
  const [monto, setMonto] = useState<number>(0);
  const [observaciones, setObservaciones] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openPopover, setOpenPopover] = useState<Side | null>(null);

  const puntoVentaActivo = useAuthStore((s: any) => s.puntoVentaActivo);
  const queryClient = useQueryClient();

  const { data: cajas = [] } = useQuery({
    queryKey: ['transfer-modal-cajas', puntoVentaActivo],
    queryFn: () => cajaApi.getCajasConSaldo(puntoVentaActivo || undefined),
    enabled: open,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: ccCash, isLoading: ccLoading } = useQuery({
    queryKey: ['transfer-modal-cc-efectivo', puntoVentaActivo],
    queryFn: () => cajaApi.getEfectivoCajaCentral(puntoVentaActivo || undefined),
    enabled: open,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const selectedCaja: CajaConSaldo | null = useMemo(
    () => cajas.find(c => c.CAJA_ID === cajaId) || null,
    [cajas, cajaId]
  );

  const cajaSinSesion = useMemo(
    () => (selectedCaja && !selectedCaja.SESION_ID ? selectedCaja : null),
    [selectedCaja]
  );

  const saldoCajaSeleccionada = useMemo(() => {
    if (!selectedCaja) return 0;
    if (selectedCaja.SESION_ID) return Number(selectedCaja.EFECTIVO_SESION) || 0;
    return Number(selectedCaja.SALDO_RETENIDO) || 0;
  }, [selectedCaja]);

  const maxMonto = useMemo(() => {
    if (origen === 'CAJA_CENTRAL') return ccCash?.efectivo ?? 0;
    if (origen === 'CAJA') return saldoCajaSeleccionada;
    return 0;
  }, [origen, ccCash, saldoCajaSeleccionada]);

  const efectivoCC = ccCash?.efectivo ?? 0;

  // Si la caja seleccionada no tiene sesión activa, la única dirección
  // válida es CAJA → CAJA_CENTRAL.
  useEffect(() => {
    if (cajaSinSesion && (origen !== 'CAJA' || destino !== 'CAJA_CENTRAL')) {
      setOrigen('CAJA');
      setDestino('CAJA_CENTRAL');
    }
  }, [cajaSinSesion, origen, destino]);

  // Preseleccionar primera caja con sesión activa al abrir.
  useEffect(() => {
    if (!open) return;
    if (!cajaId && cajas.length > 0) {
      const firstConSesion = cajas.find(c => c.SESION_ID);
      if (firstConSesion) setCajaId(firstConSesion.CAJA_ID);
    }
  }, [open, cajas, cajaId]);

  const transferMutation = useMutation({
    mutationFn: () =>
      cajaApi.transferir({
        origen,
        destino,
        monto,
        cajaId: cajaId || undefined,
        observaciones: observaciones.trim() || undefined,
      }),
    onSuccess: () => {
      message.success('Transferencia realizada');
      queryClient.invalidateQueries({ queryKey: ['transfer-modal-cajas'] });
      queryClient.invalidateQueries({ queryKey: ['transfer-modal-cc-efectivo'] });
      queryClient.invalidateQueries({ queryKey: ['cajas'] });
      queryClient.invalidateQueries({ queryKey: ['caja'] });
      queryClient.invalidateQueries({ queryKey: ['mi-caja'] });
      queryClient.invalidateQueries({ queryKey: ['mi-sesion-activa'] });
      queryClient.invalidateQueries({ queryKey: ['mis-cajas'] });
      queryClient.invalidateQueries({ queryKey: ['caja-central-mov'] });
      queryClient.invalidateQueries({ queryKey: ['caja-central-totales'] });
      queryClient.invalidateQueries({ queryKey: ['caja-central-historico'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] });
      queryClient.invalidateQueries({ queryKey: ['cajas-list'] });
      queryClient.invalidateQueries({ queryKey: ['caja-sesiones'] });
      onClose();
    },
    onError: (e: any) => {
      setError(e?.response?.data?.error || 'Error al transferir');
    },
  });

  const handleSelect = (side: Side, value: 'CAJA_CENTRAL' | 'CAJA', caja?: CajaConSaldo | null) => {
    setError(null);
    setOpenPopover(null);
    if (side === 'origen') {
      setOrigen(value);
      setDestino(value === 'CAJA_CENTRAL' ? 'CAJA' : 'CAJA_CENTRAL');
    } else {
      setDestino(value);
      setOrigen(value === 'CAJA_CENTRAL' ? 'CAJA' : 'CAJA_CENTRAL');
    }
    if (value === 'CAJA' && caja) {
      setCajaId(caja.CAJA_ID);
    }
  };

  const handleSubmit = () => {
    setError(null);
    if (monto <= 0) {
      setError('Ingrese un monto válido');
      return;
    }
    if (origen === 'CAJA' && !cajaId) {
      setError('Seleccione una caja de origen');
      return;
    }
    if (destino === 'CAJA' && !cajaId) {
      setError('Seleccione una caja de destino');
      return;
    }
    if (cajaSinSesion && destino !== 'CAJA_CENTRAL') {
      setError('Una caja sin sesión activa sólo puede transferir a Caja Central');
      return;
    }
    if (origen === destino) {
      setError('El origen y el destino deben ser distintos');
      return;
    }
    if (monto > maxMonto) {
      setError(`El monto (${fmtMoney(monto)}) supera el saldo disponible (${fmtMoney(maxMonto)})`);
      return;
    }
    transferMutation.mutate();
  };

  // ── Cajas ordenadas: con sesión primero, luego cerradas, luego inactivas ──
  const cajasOrdenadas = useMemo(() => {
    return [...cajas].sort((a, b) => {
      const rank = (c: CajaConSaldo) => {
        if (!c.ACTIVA) return 3;
        if (c.SESION_ID) return 1;
        return 2;
      };
      return rank(a) - rank(b);
    });
  }, [cajas]);

  // ── Resumen de selección actual ──
  const resumenOrigen = useMemo(() => {
    if (origen === 'CAJA_CENTRAL') {
      return { label: 'Caja Central', sub: 'Efectivo disponible', value: efectivoCC, type: 'cc' as const };
    }
    if (selectedCaja) {
      return {
        label: selectedCaja.CAJA_NOMBRE || `Caja #${selectedCaja.CAJA_ID}`,
        sub: selectedCaja.SESION_ID ? `Sesión #${selectedCaja.SESION_ID}` : 'Cerrada · Retenido',
        value: saldoCajaSeleccionada,
        type: 'caja' as const,
        inactive: !selectedCaja.ACTIVA,
      };
    }
    return null;
  }, [origen, selectedCaja, efectivoCC, saldoCajaSeleccionada]);

  const resumenDestino = useMemo(() => {
    if (destino === 'CAJA_CENTRAL') {
      return { label: 'Caja Central', sub: 'Recibirá el efectivo', value: null, type: 'cc' as const };
    }
    if (selectedCaja) {
      return {
        label: selectedCaja.CAJA_NOMBRE || `Caja #${selectedCaja.CAJA_ID}`,
        sub: selectedCaja.SESION_ID
          ? `Sesión #${selectedCaja.SESION_ID} · ${selectedCaja.USUARIO_NOMBRE || ''}`
          : 'Cerrada',
        value: null,
        type: 'caja' as const,
        inactive: !selectedCaja.ACTIVA,
      };
    }
    return null;
  }, [destino, selectedCaja]);

  // Helper para saber si un valor está seleccionado en un side
  const isSelectedSide = (side: Side): boolean => {
    if (side === 'origen') return origen === 'CAJA_CENTRAL' || cajaId !== null;
    return destino === 'CAJA_CENTRAL' || cajaId !== null;
  };

  // Helper para construir las opciones del popover según el side
  const buildPopoverContent = (side: Side) => {
    const pickOrigen = side === 'origen';
    return (
      <div className="rg-tx-popover">
        <div className="rg-tx-popover__section">Caja Central</div>
        <button
          type="button"
          className={`rg-tx-popover__item rg-tx-popover__item--cc ${
            (pickOrigen ? origen === 'CAJA_CENTRAL' : destino === 'CAJA_CENTRAL') ? 'is-selected' : ''
          }`}
          onClick={() => handleSelect(side, 'CAJA_CENTRAL', null)}
        >
          <div className="rg-tx-popover__icon is-cc"><BankOutlined /></div>
          <div className="rg-tx-popover__body">
            <div className="rg-tx-popover__name">Caja Central</div>
            <div className="rg-tx-popover__sub">Efectivo disponible</div>
          </div>
          <div className="rg-tx-popover__amount is-cc">
            {ccLoading ? '...' : fmtMoney(efectivoCC)}
          </div>
          {(pickOrigen ? origen === 'CAJA_CENTRAL' : destino === 'CAJA_CENTRAL') && (
            <CheckCircleOutlined className="rg-tx-popover__check" />
          )}
        </button>

        {cajasOrdenadas.length > 0 && (
          <>
            <Divider style={{ margin: '6px 0' }} />
            <div className="rg-tx-popover__section">Cajas operativas</div>
            {cajasOrdenadas.map(c => {
              const sinSesion = !c.SESION_ID;
              const inactiva = !c.ACTIVA;
              const saldo = sinSesion ? Number(c.SALDO_RETENIDO) || 0 : Number(c.EFECTIVO_SESION) || 0;
              const isOrigen = pickOrigen && origen === 'CAJA' && cajaId === c.CAJA_ID;
              const isDestino = !pickOrigen && destino === 'CAJA' && cajaId === c.CAJA_ID;
              const selected = isOrigen || isDestino;
              // Reglas de habilitación
              const canPickAsOrigen = !inactiva;
              const canPickAsDestino = !inactiva && !!c.SESION_ID;
              const disabled = pickOrigen ? !canPickAsOrigen : !canPickAsDestino;
              const statusLabel = inactiva
                ? 'Inactiva'
                : sinSesion
                  ? 'Cerrada · Retenido'
                  : `Sesión #${c.SESION_ID}`;
              const statusColor = inactiva
                ? '#8c8c8c'
                : sinSesion
                  ? '#faad14'
                  : '#52c41a';

              return (
                <button
                  type="button"
                  key={c.CAJA_ID}
                  className={`rg-tx-popover__item ${selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}
                  onClick={() => {
                    if (disabled) return;
                    handleSelect(side, 'CAJA', c);
                  }}
                  disabled={disabled}
                >
                  <div className="rg-tx-popover__icon" style={{ borderLeftColor: statusColor }}>
                    <ShopOutlined />
                  </div>
                  <div className="rg-tx-popover__body">
                    <div className="rg-tx-popover__name">
                      {c.CAJA_NOMBRE || `Caja #${c.CAJA_ID}`}
                    </div>
                    <div className="rg-tx-popover__sub">
                      <span style={{ color: statusColor, fontWeight: 600 }}>{statusLabel}</span>
                      {c.PUNTO_VENTA_NOMBRE && c.PUNTO_VENTA_NOMBRE !== statusLabel && (
                        <span style={{ color: 'var(--rg-text-light)' }}> · {c.PUNTO_VENTA_NOMBRE}</span>
                      )}
                    </div>
                  </div>
                  <div className="rg-tx-popover__amount">
                    {fmtMoney(saldo)}
                  </div>
                  {selected && <CheckCircleOutlined className="rg-tx-popover__check" />}
                </button>
              );
            })}
          </>
        )}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      className="rg-modal rg-modal-transferencia"
      destroyOnClose
      width={680}
      title={
        <RGCajaModalHeader
          icon={rgIcon('caja-transferencia')}
          title="Transferencia entre Caja Central y Caja"
          subtitle="Mové efectivo entre la cuenta central y una caja operativa"
        />
      }
      footer={[
        <Button key="cancel" onClick={onClose}>Cancelar</Button>,
        <Button
          key="submit"
          type="primary"
          loading={transferMutation.isPending}
          onClick={handleSubmit}
          disabled={!monto || monto <= 0 || !resumenOrigen || !resumenDestino}
        >
          Transferir {monto > 0 ? fmtMoney(monto) : ''}
        </Button>,
      ]}
    >
      {/* ── SELECTORES: Origen → Destino (compactos con Popover) ── */}
      <div className="rg-tx-selectors">
        {/* ORIGEN */}
        <div className={`rg-tx-selector ${isSelectedSide('origen') ? 'is-selected' : ''}`}>
          <div className="rg-tx-selector__label">
            <span className="rg-tx-selector__pill is-origen">Origen</span>
          </div>
          <Popover
            open={openPopover === 'origen'}
            onOpenChange={(o) => setOpenPopover(o ? 'origen' : null)}
            trigger="click"
            placement="bottomLeft"
            destroyTooltipOnHide
            overlayClassName="rg-tx-popover-overlay"
            content={buildPopoverContent('origen')}
          >
            <button
              type="button"
              className="rg-tx-selector__btn"
              onClick={(e) => e.stopPropagation()}
            >
              {resumenOrigen ? (
                <>
                  <div className={`rg-tx-selector__icon ${resumenOrigen.type === 'cc' ? 'is-cc' : ''}`}>
                    {resumenOrigen.type === 'cc' ? <BankOutlined /> : <ShopOutlined />}
                  </div>
                  <div className="rg-tx-selector__text">
                    <div className="rg-tx-selector__name">{resumenOrigen.label}</div>
                    <div className="rg-tx-selector__sub">{resumenOrigen.sub}</div>
                  </div>
                  <div className="rg-tx-selector__amount">{fmtMoney(resumenOrigen.value)}</div>
                  <DownOutlined className="rg-tx-selector__chevron" />
                </>
              ) : (
                <span className="rg-tx-selector__empty">Seleccioná una caja</span>
              )}
            </button>
          </Popover>
        </div>

        {/* FLECHA */}
        <div className="rg-tx-selector__arrow">
          <RightOutlined />
        </div>

        {/* DESTINO */}
        <div className={`rg-tx-selector ${isSelectedSide('destino') ? 'is-selected' : ''}`}>
          <div className="rg-tx-selector__label">
            <span className="rg-tx-selector__pill is-destino">Destino</span>
          </div>
          <Popover
            open={openPopover === 'destino'}
            onOpenChange={(o) => setOpenPopover(o ? 'destino' : null)}
            trigger="click"
            placement="bottomRight"
            destroyTooltipOnHide
            overlayClassName="rg-tx-popover-overlay"
            content={buildPopoverContent('destino')}
          >
            <button
              type="button"
              className="rg-tx-selector__btn"
              onClick={(e) => e.stopPropagation()}
            >
              {resumenDestino ? (
                <>
                  <div className={`rg-tx-selector__icon ${resumenDestino.type === 'cc' ? 'is-cc' : ''}`}>
                    {resumenDestino.type === 'cc' ? <BankOutlined /> : <ShopOutlined />}
                  </div>
                  <div className="rg-tx-selector__text">
                    <div className="rg-tx-selector__name">{resumenDestino.label}</div>
                    <div className="rg-tx-selector__sub">{resumenDestino.sub}</div>
                  </div>
                  <div className="rg-tx-selector__amount">
                    {monto > 0 ? `+ ${fmtMoney(monto)}` : (destino === 'CAJA_CENTRAL' ? 'recibirá' : 'recibirá')}
                  </div>
                  <DownOutlined className="rg-tx-selector__chevron" />
                </>
              ) : (
                <span className="rg-tx-selector__empty">Seleccioná una caja</span>
              )}
            </button>
          </Popover>
        </div>
      </div>

      {/* ── ALERTA caja sin sesión ── */}
      {cajaSinSesion && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Caja sin sesión activa"
          description="Solo se permite transferir el saldo retenido hacia Caja Central."
        />
      )}

      {/* ── FORMULARIO: monto + obs ── */}
      <div className="rg-tx-form">
        <div className="rg-tx-form__row">
          <div className="rg-tx-form__field">
            <label className="rg-tx-form__label">
              <DollarOutlined /> Monto a transferir
            </label>
            <InputNumber
              value={monto}
              onChange={(v) => setMonto(Number(v) || 0)}
              min={0}
              max={maxMonto}
              step={100}
              style={{ width: '100%' }}
              size="large"
              formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}
              parser={value => Number((value || '').replace(/[$.\s]/g, '')) || 0}
              addonAfter={
                <Button
                  size="small"
                  type="link"
                  onClick={() => setMonto(maxMonto)}
                  disabled={!selectedCaja && origen === 'CAJA'}
                >
                  Máx
                </Button>
              }
            />
            <div className="rg-tx-form__help">
              Máximo disponible: <strong>{fmtMoney(maxMonto)}</strong>
            </div>
          </div>
        </div>

        <div className="rg-tx-form__row">
          <div className="rg-tx-form__field">
            <label className="rg-tx-form__label">Observaciones</label>
            <Input.TextArea
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={
                cajaSinSesion
                  ? 'Motivo del retiro de retenido (ej: ajuste, traslado a bóveda, etc.)'
                  : 'Motivo o detalle de la transferencia'
              }
            />
          </div>
        </div>

        {monto > 0 && resumenOrigen && resumenDestino && (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 4 }}
            message={
              <span>
                <strong>{resumenOrigen.label}</strong> → <strong>{resumenDestino.label}</strong>:{' '}
                <strong style={{ color: 'var(--rg-gold-dark)' }}>{fmtMoney(monto)}</strong>
              </span>
            }
          />
        )}

        {error && <Alert type="error" message={error} showIcon style={{ marginTop: 8 }} />}
      </div>
    </Modal>
  );
}