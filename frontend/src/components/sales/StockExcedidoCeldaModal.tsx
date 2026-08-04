import { Modal, Typography } from 'antd';
import { WarningFilled } from '@ant-design/icons';
import { RGCajaModalHeader } from '../RGCajaModalHeader';
import { rgIcon } from '../rg-icons';

const { Text } = Typography;

interface Props {
  open: boolean;
  productoNombre: string;
  unidad: string;
  cantidadIngresada: number;
  stockDisponible: number;
  /**
   * Handler único. Se dispara tanto al hacer click en "Aceptar" como al
   * cerrar el modal con la X, ESC, click fuera, etc. El padre del modal
   * debe ajustar la cantidad al stock en este momento.
   */
  onClose: () => void;
}

/**
 * Modal estilo message box de escritorio. Se dispara en tiempo real cuando
 * el usuario escribe en la celda de cantidad del carrito una cantidad que
 * excede el stock disponible (y el producto no permite stock negativo).
 *
 * Cualquier forma de cerrar el modal (botón Aceptar, X, ESC, click fuera)
 * ajustará la cantidad al stock disponible. El padre del modal es
 * responsable de aplicar el ajuste en el `onClose`.
 *
 * Estética: Header oscuro (rg-black) con borde dorado (rg-gold) y brand
 * "Río Gestión" al estilo del sistema. Cuerpo claro con alto contraste.
 */
export function StockExcedidoCeldaModal({
  open, productoNombre, unidad, cantidadIngresada, stockDisponible, onClose,
}: Props) {
  const excedente = Math.max(0, cantidadIngresada - stockDisponible);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={onClose}
      title={
        <RGCajaModalHeader
          icon={rgIcon('warning')}
          title="Cantidad excede el stock"
          subtitle="La cantidad ingresada supera el stock disponible"
        />
      }
      centered
      width={520}
      maskClosable={false}
      keyboard
      okText="Aceptar"
      cancelButtonProps={{ style: { display: 'none' } }}
      okButtonProps={{
        size: 'large',
        style: {
          minWidth: 160,
          fontWeight: 600,
          background: 'var(--rg-gold)',
          borderColor: 'var(--rg-gold)',
          color: 'var(--rg-black)',
        },
      }}
      styles={{
        body: { paddingTop: 4, paddingBottom: 8 },
      }}
      className="rg-modal stock-excedido-celda-modal"
    >
      {/* ── Banner de error — sistema ── */}
      <div
        style={{
          background: 'linear-gradient(135deg, #fff1f0 0%, #ffe7e7 100%)',
          border: '1px solid rgba(207, 19, 34, 0.4)',
          borderLeft: '4px solid #cf1322',
          borderRadius: 8,
          padding: '12px 14px',
          marginBottom: 14,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <WarningFilled
          style={{
            fontSize: 22,
            color: '#cf1322',
            marginTop: 2,
            flexShrink: 0,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text strong style={{ fontSize: 14, color: '#a8071a', display: 'block', lineHeight: 1.4 }}>
            No hay stock suficiente
          </Text>
          <Text style={{ fontSize: 13, color: '#5c0011', display: 'block', marginTop: 4, lineHeight: 1.5 }}>
            La cantidad de <b style={{ color: '#a8071a' }}>"{productoNombre}"</b> no puede
            superar el stock disponible.
          </Text>
        </div>
      </div>

      {/* ── Datos comparativos ── */}
      <div
        style={{
          border: '1px solid var(--rg-border)',
          borderRadius: 8,
          overflow: 'hidden',
          background: '#fff',
        }}
      >
        <Row
          label="Ingresaste"
          value={`${cantidadIngresada} ${unidad}`}
          valueColor="#cf1322"
          valueBg="rgba(207, 19, 34, 0.08)"
          border
        />
        <Row
          label="Stock disponible"
          value={`${stockDisponible} ${unidad}`}
          valueColor="#1E1F22"
          valueBg="rgba(30, 31, 35, 0.04)"
          border
        />
        <Row
          label="Excedente"
          value={`${excedente.toFixed(2)} ${unidad}`}
          valueColor="#d48806"
          valueBg="rgba(212, 136, 6, 0.08)"
          border={false}
        />
      </div>

      {/* ── Nota al pie con ayuda ── */}
      <div
        style={{
          marginTop: 12,
          padding: '10px 12px',
          background: 'rgba(234, 189, 35, 0.08)',
          border: '1px solid rgba(234, 189, 35, 0.3)',
          borderRadius: 6,
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
        }}
      >
        <span
          style={{
            fontSize: 14,
            color: 'var(--rg-gold-dark)',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          ⓘ
        </span>
        <Text style={{ fontSize: 12, color: '#5c0011', lineHeight: 1.5, display: 'block' }}>
          Al aceptar, la cantidad se ajustará automáticamente a{' '}
          <b style={{ color: '#1E1F22' }}>{stockDisponible} {unidad}</b>.
          Si necesitás otra cantidad, activá <b>"Permite stock negativo"</b> en el producto.
        </Text>
      </div>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────
//  Helper interno — fila de comparación con etiqueta + valor
// ─────────────────────────────────────────────────────────────────

interface RowProps {
  label: string;
  value: string;
  valueColor: string;
  valueBg: string;
  border: boolean;
}

function Row({ label, value, valueColor, valueBg, border }: RowProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: border ? '1px solid var(--rg-border)' : 'none',
        background: '#fff',
      }}
    >
      <Text style={{ fontSize: 13, color: '#1E1F22', fontWeight: 500 }}>
        {label}
      </Text>
      <span
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: valueColor,
          background: valueBg,
          padding: '4px 12px',
          borderRadius: 6,
          fontFamily: 'monospace',
          letterSpacing: 0.3,
        }}
      >
        {value}
      </span>
    </div>
  );
}
