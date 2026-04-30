import { Select, Tag } from 'antd';
import { EnvironmentOutlined } from '@ant-design/icons';
import { useAuthStore } from '../store/authStore';

interface PuntoVentaFilterProps {
  /** Currently selected PV ID, or undefined for "all" */
  value: number | undefined;
  /** Called when selection changes — undefined means "Todos" */
  onChange: (pvId: number | undefined) => void;
  /** Allow selecting "Todos" (default true) */
  allowAll?: boolean;
  /** Component width (default 160) */
  width?: number;
  disabled?: boolean;
  /** Override the default user-assigned PV list (e.g. to show all PVs) */
  overridePuntosVenta?: { PUNTO_VENTA_ID: number; NOMBRE: string }[];
}

/**
 * Shared Punto de Venta selector for page toolbars.
 * Shows "Todos" + the user's assigned puntos de venta.
 * If the user only has 1 PV, renders a compact tag instead of a Select.
 */
export function PuntoVentaFilter({
  value,
  onChange,
  allowAll = true,
  width = 160,
  disabled,
  overridePuntosVenta,
}: PuntoVentaFilterProps) {
  const { puntosVenta: userPuntosVenta } = useAuthStore();
  const puntosVenta = overridePuntosVenta ?? userPuntosVenta;

  if (puntosVenta.length <= 1 && !allowAll) {
    const nombre = puntosVenta[0]?.NOMBRE ?? '—';
    return (
      <Tag
        icon={<EnvironmentOutlined />}
        color="default"
        style={{ margin: 0, lineHeight: '28px' }}
      >
        {nombre}
      </Tag>
    );
  }

  const options = [
    ...(allowAll && puntosVenta.length > 1 ? [{ label: 'Todos los PV', value: 0 as number }] : []),
    ...puntosVenta.map(pv => ({
      label: pv.NOMBRE,
      value: pv.PUNTO_VENTA_ID,
    })),
  ];

  return (
    <Select
      size="middle"
      placeholder="Punto de Venta"
      prefix={<EnvironmentOutlined />}
      style={{ width }}
      value={value ?? 0}
      onChange={(v) => onChange(v === 0 ? undefined : v)}
      options={options}
      popupMatchSelectWidth={false}
      disabled={disabled}
    />
  );
}
