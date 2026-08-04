import { useQuery } from '@tanstack/react-query';
import { Modal, Spin, Tag, Typography, Row, Col, Button } from 'antd';
import dayjs from 'dayjs';
import { cajaApi } from '../../services/caja.api';
import { fmtMoney } from '../../utils/format';
import { RGCajaModalHeader } from '../RGCajaModalHeader';
import { rgIcon } from '../rg-icons';
import type { MovimientoCaja } from '../../types';

const { Text } = Typography;

interface DetalleCierreSesionModalProps {
  open: boolean;
  cierre: MovimientoCaja | null;
  onClose: () => void;
}

const metodoVisual = (categoria: string) => {
  if (categoria === 'EFECTIVO') return { tag: 'green', background: 'rgba(82,196,26,0.06)', border: '#b7eb8f' };
  if (categoria === 'CHEQUES') return { tag: 'orange', background: 'rgba(250,140,22,0.07)', border: '#ffd591' };
  return { tag: 'blue', background: 'rgba(22,119,255,0.06)', border: '#91caff' };
};

export function DetalleCierreSesionModal({ open, cierre, onClose }: DetalleCierreSesionModalProps) {
  const sesionId = cierre?.ID_ENTIDAD ?? null;

  const { data: sesion, isLoading: loadingSesion } = useQuery({
    queryKey: ['caja-sesion', sesionId],
    queryFn: () => cajaApi.getSesionById(sesionId!),
    enabled: !!sesionId,
  });

  const { data: metodos = [], isLoading: loadingMetodos } = useQuery({
    queryKey: ['caja-sesion-desglose', sesionId],
    queryFn: () => cajaApi.getDesgloseMetodos(sesionId!),
    enabled: !!sesionId,
  });

  const items = sesion?.items ?? [];

  // Ingresos del período (totales de ventas, neto de egresos)
  const ventasEfectivo = items
    .filter(i => i.ORIGEN_TIPO === 'VENTA')
    .reduce((s, i) => s + (i.MONTO_EFECTIVO ?? 0), 0);
  const ventasDigital = items
    .filter(i => i.ORIGEN_TIPO === 'VENTA')
    .reduce((s, i) => s + (i.MONTO_DIGITAL ?? 0), 0);
  const egresosEfectivo = items
    .filter(i => i.ORIGEN_TIPO === 'EGRESO')
    .reduce((s, i) => s + Math.abs(i.MONTO_EFECTIVO ?? 0), 0);
  const egresosDigital = items
    .filter(i => i.ORIGEN_TIPO === 'EGRESO')
    .reduce((s, i) => s + Math.abs(i.MONTO_DIGITAL ?? 0), 0);

  // "Ingresos del periodo" → neto (ventas − egresos) por categoría
  const ingresosEfectivo = ventasEfectivo - egresosEfectivo;
  const ingresosDigital = ventasDigital - egresosDigital;
  const totalIngresado = ingresosEfectivo + ingresosDigital;

  // "Efectivo en caja al cierre" → fondo inicial + delta efectivo
  const fondoInicial = Number(sesion?.MONTO_APERTURA ?? 0);
  const depositado = Number(sesion?.MONTO_CIERRE ?? 0);
  const retenido = Number(sesion?.SALDO_RETENIDO_FIN ?? 0);

  const cantMovimientos = items.length;

  const isLoading = loadingSesion || loadingMetodos;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={<Button onClick={onClose}>Cerrar</Button>}
      title={
        <RGCajaModalHeader
          icon={rgIcon('caja-cierre')}
          title={cierre ? `Detalle Cierre Caja #${cierre.CAJA_ID ?? '—'}` : 'Detalle Cierre'}
          subtitle={cierre ? `Sesión de caja #${cierre.ID} · ${dayjs(cierre.FECHA).format('DD/MM/YYYY HH:mm')}` : 'Resumen del cierre de la sesión'}
        />
      }
      width={820}
      destroyOnClose
      className="rg-modal"
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', overflowX: 'hidden', paddingRight: 4 } }}
    >
      {isLoading || !sesion ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          {/* ── Header info ─────────────────────── */}
          <Row gutter={[16, 8]} style={{ marginBottom: 16 }}>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>Usuario:</Text>{' '}
              <Text strong>{sesion.USUARIO_NOMBRE ?? '—'}</Text>
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>Punto de Venta:</Text>{' '}
              <Text strong>{sesion.PUNTO_VENTA_NOMBRE ?? '—'}</Text>
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>Apertura:</Text>{' '}
              <Text strong>{dayjs(sesion.FECHA_APERTURA).format('DD/MM/YYYY, HH:mm')}</Text>
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>Cierre:</Text>{' '}
              <Text strong>
                {sesion.FECHA_CIERRE ? dayjs(sesion.FECHA_CIERRE).format('DD/MM/YYYY, HH:mm') : '—'}
              </Text>
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>Movimientos:</Text>{' '}
              <Text strong>{cantMovimientos}</Text>
            </Col>
            <Col span={12}>
              <Text type="secondary" style={{ fontSize: 12 }}>Estado:</Text>{' '}
              <Tag color={sesion.ESTADO === 'ACTIVA' ? 'green' : 'default'} style={{ marginInlineEnd: 0 }}>
                {sesion.ESTADO}
              </Tag>
            </Col>
          </Row>

          {/* ── Ingresos del periodo ────────────── */}
          <SectionHeader>Ingresos del periodo</SectionHeader>
          <Row gutter={16} align="bottom" style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>Total ingresado</Text>
              <div style={{ color: '#52c41a', fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>
                {fmtMoney(totalIngresado)}
              </div>
            </Col>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>↳ Efectivo</Text>
              <div style={{
                color: ingresosEfectivo < 0 ? '#ff4d4f' : '#000',
                fontSize: 16, fontWeight: 600, lineHeight: 1.4,
              }}>
                {fmtMoney(ingresosEfectivo)}
              </div>
            </Col>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>↳ Digital</Text>
              <div style={{ color: '#1677ff', fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>
                {fmtMoney(ingresosDigital)}
              </div>
            </Col>
          </Row>

          {/* ── Efectivo en caja al cierre ──────── */}
          <SectionHeader>Efectivo en caja al cierre</SectionHeader>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>Fondo inicial</Text>
              <div style={{ color: '#EABD23', fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>
                {fmtMoney(fondoInicial)}
              </div>
            </Col>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>+ Efectivo de ventas</Text>
              <div style={{
                color: ingresosEfectivo < 0 ? '#ff4d4f' : '#000',
                fontSize: 16, fontWeight: 600, lineHeight: 1.4,
              }}>
                {ingresosEfectivo >= 0 ? '+ ' : ''}{fmtMoney(ingresosEfectivo)}
              </div>
            </Col>
            <Col span={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>= Total físico → depositado</Text>
              <div style={{ color: '#13c2c2', fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>
                {fmtMoney(depositado)}
              </div>
              {retenido > 0 && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  (retenido p/ próxima: {fmtMoney(retenido)})
                </Text>
              )}
            </Col>
          </Row>

          {/* ── Detalle por método de pago ──────── */}
          <SectionHeader>Detalle por método de pago</SectionHeader>
          {metodos.length === 0 ? (
            <Text type="secondary">No hay métodos de pago registrados para esta sesión.</Text>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {metodos.map(m => {
                const visual = metodoVisual(m.CATEGORIA);
                const isNegative = m.TOTAL < 0;
                return (
                  <div
                    key={m.METODO_PAGO_ID}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      gap: 12,
                      padding: '8px 12px', borderRadius: 8,
                      background: visual.background,
                      border: `1px solid ${visual.border}`,
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1, overflow: 'hidden' }}>
                      {m.IMAGEN_BASE64 ? (
                        <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 22, height: 22, objectFit: 'contain', borderRadius: 3, flexShrink: 0 }} />
                      ) : null}
                      <Text strong style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {m.NOMBRE}
                      </Text>
                      <Tag color={visual.tag} style={{ fontSize: 10, marginInlineEnd: 0, flexShrink: 0 }}>
                        {m.CATEGORIA}
                      </Tag>
                    </div>
                    <Text
                      strong
                      style={{
                        fontSize: 14,
                        color: isNegative ? '#ff4d4f' : '#000',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}
                    >
                      {fmtMoney(m.TOTAL)}
                    </Text>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        margin: '16px 0 8px',
      }}
    >
      <span style={{
        fontSize: 13,
        fontWeight: 600,
        color: '#000',
        whiteSpace: 'nowrap',
      }}>
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: '#EABD23' }} />
    </div>
  );
}
