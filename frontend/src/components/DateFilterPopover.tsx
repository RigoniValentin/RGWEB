import { useState } from 'react';
import { Button, DatePicker, Popover } from 'antd';
import { CalendarOutlined, DownOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

export type DatePreset = 'hoy' | 'semana' | 'mes' | 'mesAnterior' | 'todas';
export interface DateFilterOption<TPreset extends string = DatePreset> {
  label: string;
  value: TPreset;
}

const PRESET_LABELS: Record<DatePreset, string> = {
  hoy: 'Hoy',
  semana: 'Esta semana',
  mes: 'Este mes',
  mesAnterior: 'Mes anterior',
  todas: 'Todas',
};

const PRESET_OPTIONS: DateFilterOption<DatePreset>[] = [
  { label: 'Hoy', value: 'hoy' },
  { label: 'Esta semana', value: 'semana' },
  { label: 'Este mes', value: 'mes' },
  { label: 'Mes anterior', value: 'mesAnterior' },
  { label: 'Todas', value: 'todas' },
];

export function getPresetRange(preset: DatePreset): [string, string] | [undefined, undefined] {
  const today = dayjs();
  switch (preset) {
    case 'hoy':
      return [today.format('YYYY-MM-DD'), today.format('YYYY-MM-DD')];
    case 'semana':
      return [today.startOf('week').format('YYYY-MM-DD'), today.endOf('week').format('YYYY-MM-DD')];
    case 'mes':
      return [today.startOf('month').format('YYYY-MM-DD'), today.endOf('month').format('YYYY-MM-DD')];
    case 'mesAnterior': {
      const prev = today.subtract(1, 'month');
      return [prev.startOf('month').format('YYYY-MM-DD'), prev.endOf('month').format('YYYY-MM-DD')];
    }
    case 'todas':
      return [undefined, undefined];
  }
}

interface DateFilterPopoverProps<TPreset extends string = DatePreset> {
  preset: TPreset | undefined;
  fechaDesde: string | undefined;
  fechaHasta: string | undefined;
  onPresetChange: (preset: TPreset, desde: string | undefined, hasta: string | undefined) => void;
  onRangeChange: (desde: string | undefined, hasta: string | undefined) => void;
  disabled?: boolean;
  presetLabels?: Partial<Record<TPreset, string>>;
  presetOptions?: DateFilterOption<TPreset>[];
  getPresetRange?: (preset: TPreset) => [string | undefined, string | undefined];
  emptyLabel?: string;
}

export function DateFilterPopover<TPreset extends string = DatePreset>({
  preset, fechaDesde, fechaHasta,
  onPresetChange, onRangeChange, disabled,
  presetLabels, presetOptions, getPresetRange: resolvePresetRange, emptyLabel = 'Fechas',
}: DateFilterPopoverProps<TPreset>) {
  const [open, setOpen] = useState(false);

  const labels = (presetLabels ?? PRESET_LABELS) as Partial<Record<TPreset, string>>;
  const options = (presetOptions ?? PRESET_OPTIONS) as DateFilterOption<TPreset>[];
  const getRange = resolvePresetRange ?? ((value: TPreset) => getPresetRange(value as DatePreset));

  const handlePreset = (value: TPreset) => {
    const [desde, hasta] = getRange(value);
    onPresetChange(value, desde, hasta);
    setOpen(false);
  };

  const handleRange = (dates: any) => {
    if (dates) {
      onRangeChange(dates[0]?.format('YYYY-MM-DD'), dates[1]?.format('YYYY-MM-DD'));
    } else {
      onRangeChange(undefined, undefined);
    }
  };

  const buttonLabel = preset
    ? labels[preset] ?? emptyLabel
    : fechaDesde && fechaHasta
      ? `${dayjs(fechaDesde).format('DD/MM')} – ${dayjs(fechaHasta).format('DD/MM')}`
      : emptyLabel;

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      placement="bottomRight"
      content={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 220 }}>
          {options.map(opt => (
            <Button
              key={opt.value}
              type={preset === opt.value ? 'primary' : 'text'}
              size="small"
              block
              style={preset === opt.value ? { background: '#EABD23', borderColor: '#EABD23', color: '#1a1a2e' } : {}}
              onClick={() => handlePreset(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
          <div style={{ borderTop: '1px solid #303050', margin: '4px 0' }} />
          <RangePicker
            onChange={handleRange}
            format="DD/MM/YYYY"
            size="small"
            value={fechaDesde && fechaHasta ? [dayjs(fechaDesde), dayjs(fechaHasta)] : null}
            style={{ width: '100%' }}
          />
        </div>
      }
    >
      <Button icon={<CalendarOutlined />} disabled={disabled}>
        {buttonLabel}
        <DownOutlined style={{ fontSize: 10, marginLeft: 4 }} />
      </Button>
    </Popover>
  );
}
