import { ReactNode } from 'react';
import { InputNumber, Space, Switch, Typography } from 'antd';
import { DateFilterPopover, type DatePreset } from '../DateFilterPopover';
import { PuntoVentaFilter } from '../PuntoVentaFilter';

const { Text } = Typography;

export interface ReportFiltersValues {
  fechaDesde: string;
  fechaHasta: string;
  puntoVentaId?: number;
  incluirNc?: boolean;
  limit?: number;
  categoriaId?: number;
  marcaId?: number;
  proveedorId?: number;
}

interface ReportsFiltersBarProps {
  fechaDesde: string;
  fechaHasta: string;
  puntoVentaId?: number;
  incluirNc?: boolean;
  limit?: number;
  preset?: DatePreset;
  onChange: (next: Partial<ReportFiltersValues> & { preset?: DatePreset }) => void;
  extra?: ReactNode;
  showLimit?: boolean;
  showIncluirNc?: boolean;
}

export function ReportsFiltersBar({
  fechaDesde,
  fechaHasta,
  puntoVentaId,
  incluirNc,
  limit,
  preset = 'mes',
  onChange,
  extra,
  showLimit,
  showIncluirNc,
}: ReportsFiltersBarProps) {
  return (
    <Space wrap size={8}>
      <DateFilterPopover
        preset={preset}
        fechaDesde={fechaDesde}
        fechaHasta={fechaHasta}
        onPresetChange={(p, d, h) => onChange({ preset: p, fechaDesde: d!, fechaHasta: h! })}
        onRangeChange={(d, h) => onChange({ fechaDesde: d!, fechaHasta: h! })}
      />
      <PuntoVentaFilter value={puntoVentaId} onChange={id => onChange({ puntoVentaId: id })} />
      {showIncluirNc && (
        <Space size={6}>
          <Switch
            size="small"
            checked={!!incluirNc}
            onChange={v => onChange({ incluirNc: v })}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>Incluye NC/ND</Text>
        </Space>
      )}
      {showLimit && (
        <Space size={6}>
          <Text type="secondary" style={{ fontSize: 12 }}>Top</Text>
          <InputNumber
            size="small"
            min={1}
            max={500}
            value={limit ?? 50}
            onChange={v => onChange({ limit: typeof v === 'number' ? v : 50 })}
            style={{ width: 80 }}
          />
        </Space>
      )}
      {extra}
    </Space>
  );
}