import { ReactNode } from 'react';
import { Card } from 'antd';
import { BarChart, BarPoint } from '../dashboard/Charts';
import { DonutChart, DonutSlice } from '../dashboard/Charts';
import { Heatmap, HeatPoint } from '../dashboard/Charts';

export type ReportChartKind =
  | { type: 'bar'; data: BarPoint[]; height?: number; showSecondary?: boolean; emptyLabel?: string }
  | { type: 'donut'; data: DonutSlice[]; size?: number; centerLabel?: string; centerValue?: string }
  | { type: 'heatmap'; data: HeatPoint[]; hourFrom?: number; hourTo?: number };

interface ReportChartProps {
  chart?: ReportChartKind;
  emptyFallback?: ReactNode;
}

export function ReportChart({ chart, emptyFallback }: ReportChartProps) {
  if (!chart) return null;

  if (chart.type === 'bar') {
    return (
      <Card size="small" className="rg-card-flat" styles={{ body: { padding: 12 } }}>
        <BarChart
          data={chart.data}
          height={chart.height ?? 260}
          showSecondary={chart.showSecondary ?? false}
          emptyLabel={chart.emptyLabel ?? 'Sin datos en el período'}
        />
      </Card>
    );
  }

  if (chart.type === 'donut') {
    return (
      <Card size="small" className="rg-card-flat" styles={{ body: { padding: 12 } }}>
        {chart.data.length === 0
          ? emptyFallback ?? <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>Sin datos</div>
          : <DonutChart data={chart.data} size={chart.size ?? 200} centerLabel={chart.centerLabel} centerValue={chart.centerValue} />}
      </Card>
    );
  }

  if (chart.type === 'heatmap') {
    return (
      <Card size="small" className="rg-card-flat" styles={{ body: { padding: 12 } }}>
        <Heatmap data={chart.data} hourFrom={chart.hourFrom ?? 7} hourTo={chart.hourTo ?? 23} />
      </Card>
    );
  }

  return null;
}