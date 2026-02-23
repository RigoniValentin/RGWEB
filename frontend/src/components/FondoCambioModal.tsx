import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal, Form, Select, InputNumber, Input, Space, Typography, Tag, Alert, Divider, Spin,
} from 'antd';
import {
  SwapOutlined, BankOutlined, WalletOutlined, ShopOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { cajaApi } from '../services/caja.api';
import { useAuthStore } from '../store/authStore';
import { fmtMoney } from '../utils/format';
import type { TransferEntity, CajaAbierta } from '../types';

const { Text } = Typography;

interface EntityOption {
  value: TransferEntity;
  label: string;
  icon: React.ReactNode;
}

const ENTITY_OPTIONS: EntityOption[] = [
  { value: 'CAJA_CENTRAL', label: 'Caja Central', icon: <BankOutlined /> },
  { value: 'FONDO_CAMBIO', label: 'Fondo de Cambio', icon: <WalletOutlined /> },
  { value: 'CAJA', label: 'Caja Abierta', icon: <ShopOutlined /> },
];

/**
 * Returns the valid destination options given an origin.
 * Rule: all transfers must pass through Fondo de Cambio.
 */
function getValidDestinos(origen: TransferEntity | undefined): TransferEntity[] {
  if (!origen) return [];
  if (origen === 'FONDO_CAMBIO') return ['CAJA_CENTRAL', 'CAJA'];
  return ['FONDO_CAMBIO']; // CC→FC or CAJA→FC only
}

interface FondoCambioModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** If provided, the caja is pre-selected (opened from CajaPage with active caja) */
  preselectedCajaId?: number;
}

export function FondoCambioModal({ open, onClose, onSuccess, preselectedCajaId }: FondoCambioModalProps) {
  const queryClient = useQueryClient();
  const { puntoVentaActivo } = useAuthStore();

  const [origen, setOrigen] = useState<TransferEntity | undefined>();
  const [destino, setDestino] = useState<TransferEntity | undefined>();
  const [cajaId, setCajaId] = useState<number | undefined>();
  const [monto, setMonto] = useState<number>(0);
  const [observaciones, setObservaciones] = useState('');

  // ── Queries ────────────────────────────────────
  const { data: fondoSaldo, isLoading: fondoLoading } = useQuery({
    queryKey: ['fc-modal-fondo', puntoVentaActivo],
    queryFn: () => cajaApi.getFondoCambioSaldo(puntoVentaActivo || undefined),
    enabled: open,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: cajasAbiertas, isLoading: cajasLoading } = useQuery({
    queryKey: ['fc-modal-cajas', puntoVentaActivo],
    queryFn: () => cajaApi.getCajasAbiertas(puntoVentaActivo || undefined),
    enabled: open,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: ccEfectivoData, isLoading: ccLoading } = useQuery({
    queryKey: ['fc-modal-cc-efectivo', puntoVentaActivo],
    queryFn: () => cajaApi.getEfectivoCajaCentral(puntoVentaActivo || undefined),
    enabled: open,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // ── Reset on open ──────────────────────────────
  useEffect(() => {
    if (open) {
      if (preselectedCajaId) {
        setOrigen('CAJA');
        setDestino('FONDO_CAMBIO');
        setCajaId(preselectedCajaId);
      } else {
        setOrigen(undefined);
        setDestino(undefined);
        setCajaId(undefined);
      }
      setMonto(0);
      setObservaciones('');
    }
  }, [open, preselectedCajaId]);

  // ── Auto-set destino when origen changes ──────
  useEffect(() => {
    if (origen === 'CAJA_CENTRAL' || origen === 'CAJA') {
      setDestino('FONDO_CAMBIO');
    } else if (origen === 'FONDO_CAMBIO') {
      setDestino(undefined); // let user choose CC or Caja
    }
  }, [origen]);

  // ── Determine if caja selector is needed ──────
  const needsCajaSelector = origen === 'CAJA' || destino === 'CAJA';

  // ── Available balance info ─────────────────────
  const saldoFondo = fondoSaldo?.saldo ?? 0;
  const efectivoCC = ccEfectivoData?.efectivo ?? 0;
  const selectedCaja = useMemo(
    () => cajasAbiertas?.find((c: CajaAbierta) => c.CAJA_ID === cajaId),
    [cajasAbiertas, cajaId],
  );

  const maxMonto = useMemo(() => {
    if (origen === 'FONDO_CAMBIO') return saldoFondo;
    if (origen === 'CAJA' && selectedCaja) return selectedCaja.EFECTIVO_DISPONIBLE;
    if (origen === 'CAJA_CENTRAL') return efectivoCC;
    return undefined; // no selection yet
  }, [origen, saldoFondo, selectedCaja, efectivoCC]);

  // ── Valid destination options ──────────────────
  const validDestinos = useMemo(() => getValidDestinos(origen), [origen]);

  // ── Transfer mutation ──────────────────────────
  const transferMutation = useMutation({
    mutationFn: () =>
      cajaApi.transferirFondoCambio({
        origen: origen!,
        destino: destino!,
        monto,
        observaciones: observaciones.trim() || undefined,
        cajaId: needsCajaSelector ? cajaId : undefined,
        puntoVentaId: puntoVentaActivo || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fc-modal'] });
      queryClient.invalidateQueries({ queryKey: ['fondo-cambio'] });
      queryClient.invalidateQueries({ queryKey: ['caja-central'] });
      queryClient.invalidateQueries({ queryKey: ['cajas'] });
      queryClient.invalidateQueries({ queryKey: ['caja'] });
      queryClient.invalidateQueries({ queryKey: ['mi-caja'] });
      onSuccess();
    },
  });

  const canSubmit = origen && destino && monto > 0 && (!needsCajaSelector || cajaId);

  // ── Transfer description ──────────────────────
  const origenLabel = ENTITY_OPTIONS.find(e => e.value === origen)?.label;
  const destinoLabel = ENTITY_OPTIONS.find(e => e.value === destino)?.label;
  const cajaLabel = selectedCaja ? `Caja #${selectedCaja.CAJA_ID} (${selectedCaja.USUARIO_NOMBRE})` : '';

  return (
    <Modal
      title={
        <Space>
          <SwapOutlined style={{ color: '#EABD23' }} />
          <span>Fondo de Cambio — Transferencia</span>
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={() => transferMutation.mutate()}
      confirmLoading={transferMutation.isPending}
      okText="Transferir"
      okButtonProps={{ className: 'btn-gold', disabled: !canSubmit }}
      width={520}
      destroyOnClose
    >
      {/* ── Balance info ────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Tag color="gold" style={{ fontSize: 13, padding: '4px 12px' }}>
          <WalletOutlined /> Fondo: {fondoLoading ? '...' : fmtMoney(saldoFondo)}
        </Tag>
        <Tag color="green" style={{ fontSize: 13, padding: '4px 12px' }}>
          <BankOutlined /> CC Efectivo: {ccLoading ? '...' : fmtMoney(efectivoCC)}
        </Tag>
        {selectedCaja && (
          <Tag color="blue" style={{ fontSize: 13, padding: '4px 12px' }}>
            <ShopOutlined /> Caja #{selectedCaja.CAJA_ID}: {fmtMoney(selectedCaja.EFECTIVO_DISPONIBLE)}
          </Tag>
        )}
      </div>

      <Form layout="vertical" size="middle">
        {/* ── Origen ──────────────────────────── */}
        <Form.Item label="Origen" required>
          <Select
            placeholder="Seleccione origen"
            value={origen}
            onChange={(v) => { setOrigen(v); setCajaId(undefined); }}
            options={ENTITY_OPTIONS.map(e => ({
              value: e.value,
              label: <Space>{e.icon} {e.label}</Space>,
            }))}
          />
        </Form.Item>

        {/* ── Destino ─────────────────────────── */}
        <Form.Item label="Destino" required>
          <Select
            placeholder="Seleccione destino"
            value={destino}
            onChange={setDestino}
            disabled={!origen || validDestinos.length <= 1}
            options={ENTITY_OPTIONS
              .filter(e => validDestinos.includes(e.value))
              .map(e => ({
                value: e.value,
                label: <Space>{e.icon} {e.label}</Space>,
              }))
            }
          />
        </Form.Item>

        {/* ── Caja selector (only if CAJA is involved) ── */}
        {needsCajaSelector && (
          <Form.Item label="Seleccionar Caja" required>
            {cajasLoading ? (
              <Spin size="small" />
            ) : cajasAbiertas && cajasAbiertas.length > 0 ? (
              <Select
                placeholder="Seleccione una caja abierta"
                value={cajaId}
                onChange={setCajaId}
                options={cajasAbiertas.map((c: CajaAbierta) => ({
                  value: c.CAJA_ID,
                  label: `#${c.CAJA_ID} — ${c.USUARIO_NOMBRE} (${c.PUNTO_VENTA_NOMBRE}) — Efect: ${fmtMoney(c.EFECTIVO_DISPONIBLE)}`,
                }))}
              />
            ) : (
              <Alert type="warning" message="No hay cajas abiertas disponibles" showIcon />
            )}
          </Form.Item>
        )}

        {/* ── Monto ───────────────────────────── */}
        <Form.Item
          label="Monto"
          required
          help={maxMonto !== undefined ? `Disponible: ${fmtMoney(maxMonto)}` : undefined}
        >
          <InputNumber
            style={{ width: '100%' }}
            min={0.01}
            max={maxMonto}
            precision={2}
            prefix="$"
            value={monto}
            onChange={v => setMonto(v ?? 0)}
            autoFocus
          />
        </Form.Item>

        {/* ── Observaciones ────────────────────── */}
        <Form.Item label="Observaciones">
          <Input.TextArea
            rows={2}
            value={observaciones}
            onChange={e => setObservaciones(e.target.value)}
            placeholder="Motivo de la transferencia (opcional)"
            maxLength={500}
          />
        </Form.Item>
      </Form>

      {/* ── Transfer preview ─────────────────── */}
      {origen && destino && monto > 0 && (
        <>
          <Divider style={{ margin: '8px 0 12px' }} />
          <div style={{ textAlign: 'center', padding: '4px 0' }}>
            <Text type="secondary" style={{ fontSize: 13 }}>
              {origen === 'CAJA' ? cajaLabel : origenLabel}
              <ArrowRightOutlined style={{ margin: '0 10px', color: '#EABD23' }} />
              {destino === 'CAJA' ? cajaLabel : destinoLabel}
            </Text>
            <div style={{ marginTop: 4 }}>
              <Text strong style={{ fontSize: 18, color: '#EABD23' }}>{fmtMoney(monto)}</Text>
            </div>
          </div>
        </>
      )}

      {/* ── Error ─────────────────────────────── */}
      {transferMutation.isError && (
        <Alert
          type="error"
          message={(transferMutation.error as any)?.response?.data?.error || 'Error al procesar la transferencia'}
          showIcon
          style={{ marginTop: 12 }}
        />
      )}
    </Modal>
  );
}
