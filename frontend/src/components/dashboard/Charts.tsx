import { useMemo, useState } from 'react';
import { fmtMoney } from '../../utils/format';

const GOLD = '#EABD23';
const GOLD_DIM = '#A88719';
const GREEN = '#52c41a';
const PALETTE = ['#EABD23', '#52c41a', '#1677ff', '#13c2c2', '#722ed1', '#eb2f96', '#fa8c16', '#a0d911'];

// ────────────────────────────────────────────────────────────────────
// BarChart — vertical bars with optional secondary line (ganancia)
// ────────────────────────────────────────────────────────────────────
export interface BarPoint {
  label: string;
  value: number;
  secondary?: number;     // ganancia
  count?: number;         // cantidad de ventas
}

interface BarChartProps {
  data: BarPoint[];
  height?: number;
  showSecondary?: boolean;
  emptyLabel?: string;
}

export function BarChart({ data, height = 280, showSecondary = true, emptyLabel = 'Sin datos en el período' }: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const layout = useMemo(() => {
    const padL = 56, padR = 16, padT = 16, padB = 44;
    const innerH = height - padT - padB;
    const maxV = Math.max(1, ...data.map(d => d.value));
    const niceMax = niceCeil(maxV);
    const ticks = 4;
    return { padL, padR, padT, padB, innerH, niceMax, ticks };
  }, [data, height]);

  if (!data.length) {
    return <div className="rg-chart-empty" style={{ height }}>{emptyLabel}</div>;
  }

  // Use a wide fixed viewBox so the SVG scales uniformly without distorting text.
  const W = 800;
  const H = height;
  const innerW = W - layout.padL - layout.padR;
  const slot = innerW / data.length;
  const barW = Math.max(2, slot * 0.62);

  const yFor = (v: number) => layout.padT + layout.innerH - (v / layout.niceMax) * layout.innerH;

  // Secondary line points
  const secondaryPath = showSecondary
    ? data.map((d, i) => {
        const x = layout.padL + slot * i + slot / 2;
        const y = yFor(d.secondary ?? 0);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      }).join(' ')
    : '';

  const tickLabels = Array.from({ length: layout.ticks + 1 }, (_, i) => {
    const v = (layout.niceMax / layout.ticks) * i;
    return { v, y: yFor(v) };
  });

  // Skip x-labels if too crowded
  const labelStep = Math.max(1, Math.ceil(data.length / 14));

  return (
    <div className="rg-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" role="img"
        style={{ display: 'block', maxHeight: H }}>
        {/* Y grid + labels */}
        {tickLabels.map((t, i) => (
          <g key={i}>
            <line x1={layout.padL} x2={W - layout.padR} y1={t.y} y2={t.y}
              stroke="#e8e8e8" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <text x={layout.padL - 8} y={t.y + 4} fontSize="11" textAnchor="end" fill="#999"
              style={{ fontVariantNumeric: 'tabular-nums' }}>
              {compactNumber(t.v)}
            </text>
          </g>
        ))}

        {/* Bars */}
        {data.map((d, i) => {
          const x = layout.padL + slot * i + (slot - barW) / 2;
          const y = yFor(d.value);
          const h = layout.padT + layout.innerH - y;
          const isHover = hover === i;
          return (
            <g key={i}
               onMouseEnter={() => setHover(i)}
               onMouseLeave={() => setHover(null)}
               style={{ cursor: 'pointer' }}>
              <rect x={layout.padL + slot * i} y={layout.padT} width={slot}
                    height={layout.innerH} fill="transparent" />
              <rect
                x={x} y={y} width={barW} height={Math.max(1, h)}
                rx="3" ry="3"
                fill={isHover ? GOLD : 'url(#rg-bar-grad)'}
                style={{ transition: 'fill 0.2s' }}
              />
            </g>
          );
        })}

        {/* Secondary line (ganancia) */}
        {showSecondary && (
          <path d={secondaryPath} fill="none" stroke={GREEN} strokeWidth="2"
            vectorEffect="non-scaling-stroke" />
        )}
        {showSecondary && data.map((d, i) => {
          const x = layout.padL + slot * i + slot / 2;
          const y = yFor(d.secondary ?? 0);
          return <circle key={`pt${i}`} cx={x} cy={y} r="3" fill={GREEN} />;
        })}

        {/* X labels */}
        {data.map((d, i) => {
          if (i % labelStep !== 0 && i !== data.length - 1) return null;
          const x = layout.padL + slot * i + slot / 2;
          return (
            <text key={`lx${i}`} x={x} y={H - layout.padB + 18}
              fontSize="11" textAnchor="middle" fill="#666">
              {d.label}
            </text>
          );
        })}

        {/* Gradient definition */}
        <defs>
          <linearGradient id="rg-bar-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GOLD} />
            <stop offset="100%" stopColor={GOLD_DIM} />
          </linearGradient>
        </defs>
      </svg>

      {/* Tooltip */}
      {hover != null && data[hover] && (
        <div className="rg-chart-tooltip">
          <div className="rg-chart-tooltip-title">{data[hover].label}</div>
          <div><span className="rg-chart-dot" style={{ background: GOLD }} />Total: <strong>{fmtMoney(data[hover].value)}</strong></div>
          {showSecondary && (
            <div><span className="rg-chart-dot" style={{ background: GREEN }} />Ganancia: <strong>{fmtMoney(data[hover].secondary ?? 0)}</strong></div>
          )}
          {data[hover].count != null && (
            <div style={{ color: '#999', fontSize: 12 }}>{data[hover].count} {data[hover].count === 1 ? 'venta' : 'ventas'}</div>
          )}
        </div>
      )}

      {/* Legend */}
      <div className="rg-chart-legend">
        <span><i style={{ background: GOLD }} /> Total facturado</span>
        {showSecondary && <span><i style={{ background: GREEN }} /> Ganancia</span>}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// DonutChart — categorical with center label
// ────────────────────────────────────────────────────────────────────
export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

export function DonutChart({ data, size = 200, centerLabel, centerValue }: {
  data: DonutSlice[]; size?: number; centerLabel?: string; centerValue?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total <= 0) {
    return <div className="rg-chart-empty" style={{ height: size }}>Sin datos</div>;
  }
  const r = size / 2 - 6;
  const inner = r * 0.62;
  const cx = size / 2, cy = size / 2;

  let acc = 0;
  const slices = data.map((d, i) => {
    const startAngle = (acc / total) * 2 * Math.PI;
    acc += d.value;
    const endAngle = (acc / total) * 2 * Math.PI;
    return {
      ...d,
      i,
      color: d.color || PALETTE[i % PALETTE.length],
      pct: d.value / total,
      path: arcPath(cx, cy, r, inner, startAngle, endAngle),
    };
  });

  return (
    <div className="rg-donut-wrap" style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map(s => (
          <path key={s.i} d={s.path} fill={s.color}
            opacity={hover == null || hover === s.i ? 1 : 0.35}
            style={{ transition: 'opacity 0.2s', cursor: 'pointer' }}
            onMouseEnter={() => setHover(s.i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fill="#999">
          {hover != null ? slices[hover]?.label : centerLabel || 'Total'}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="16" fontWeight="700" fill="#1E1F22">
          {hover != null ? fmtMoney(slices[hover]?.value ?? 0) : (centerValue ?? fmtMoney(total))}
        </text>
        {hover != null && (
          <text x={cx} y={cy + 30} textAnchor="middle" fontSize="10" fill="#666">
            {((slices[hover]?.pct ?? 0) * 100).toFixed(1)}%
          </text>
        )}
      </svg>
      <div className="rg-donut-legend">
        {slices.map(s => (
          <div key={s.i} className="rg-donut-legend-row"
               onMouseEnter={() => setHover(s.i)}
               onMouseLeave={() => setHover(null)}>
            <span className="rg-donut-dot" style={{ background: s.color }} />
            <span className="rg-donut-name">{s.label}</span>
            <span className="rg-donut-pct">{(s.pct * 100).toFixed(1)}%</span>
            <span className="rg-donut-val">{fmtMoney(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Heatmap — day-of-week × hour
// ────────────────────────────────────────────────────────────────────
export interface HeatPoint { dow: number; hour: number; value: number; }

const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function Heatmap({ data, hourFrom = 7, hourTo = 23 }: {
  data: HeatPoint[]; hourFrom?: number; hourTo?: number;
}) {
  const hours = Array.from({ length: hourTo - hourFrom + 1 }, (_, i) => hourFrom + i);
  const max = Math.max(1, ...data.map(d => d.value));

  // dow comes from SQL Server with DATEFIRST default = 7 (US English): 1=Sun..7=Sat
  const map = new Map<string, number>();
  data.forEach(d => map.set(`${d.dow}-${d.hour}`, d.value));

  const cell = 22;
  const labelW = 36;
  const headerH = 18;
  const W = labelW + hours.length * cell;
  const H = headerH + 7 * cell;

  return (
    <div className="rg-heatmap-wrap">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMinYMin meet">
        {hours.map((h, i) => (
          <text key={`hh${h}`} x={labelW + i * cell + cell / 2} y={12}
            fontSize="9" fill="#999" textAnchor="middle">{h}</text>
        ))}
        {DOW_LABELS.map((lbl, di) => (
          <g key={`dr${di}`}>
            <text x={labelW - 6} y={headerH + di * cell + cell / 2 + 3}
              fontSize="9" fill="#666" textAnchor="end" fontWeight="600">{lbl}</text>
            {hours.map((h, hi) => {
              const v = map.get(`${di + 1}-${h}`) ?? 0;
              const ratio = v / max;
              const fill = ratio === 0
                ? '#f7f7f7'
                : `rgba(234,189,35,${0.18 + ratio * 0.82})`;
              return (
                <g key={`c${di}-${h}`}>
                  <rect x={labelW + hi * cell + 1} y={headerH + di * cell + 1}
                    width={cell - 2} height={cell - 2} rx="2" fill={fill}
                    stroke="#fff" strokeWidth="0.5" />
                  <title>{`${DOW_LABELS[di]} ${h}:00 — ${v} ${v === 1 ? 'venta' : 'ventas'}`}</title>
                </g>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────
function arcPath(cx: number, cy: number, r: number, ir: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + r * Math.sin(a0), y0 = cy - r * Math.cos(a0);
  const x1 = cx + r * Math.sin(a1), y1 = cy - r * Math.cos(a1);
  const xi0 = cx + ir * Math.sin(a0), yi0 = cy - ir * Math.cos(a0);
  const xi1 = cx + ir * Math.sin(a1), yi1 = cy - ir * Math.cos(a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi1} ${yi1} A ${ir} ${ir} 0 ${large} 0 ${xi0} ${yi0} Z`;
}

function compactNumber(v: number): string {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return Math.round(v).toString();
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const norm = v / base;
  let mult: number;
  if (norm <= 1) mult = 1;
  else if (norm <= 2) mult = 2;
  else if (norm <= 2.5) mult = 2.5;
  else if (norm <= 5) mult = 5;
  else mult = 10;
  return mult * base;
}
