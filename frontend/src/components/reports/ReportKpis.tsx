import { ReactNode } from 'react';
import { Card, Col, Row, Statistic } from 'antd';
import { fmtMoney, fmtNum } from '../../utils/format';

export interface ReportKpiSpec {
  title: string;
  value: number;
  prefix?: ReactNode;
  suffix?: ReactNode;
  money?: boolean;
  numeric?: boolean;
  highlight?: boolean;
  precision?: number;
  formatter?: (value: number) => string;
}

interface ReportKpisProps {
  kpis: ReportKpiSpec[];
  columns?: number;
}

function formatValue(kpi: ReportKpiSpec): string {
  if (kpi.formatter) return kpi.formatter(kpi.value);
  if (kpi.money) return fmtMoney(kpi.value);
  if (kpi.numeric) return fmtNum(kpi.value);
  return fmtNum(kpi.value);
}

export function ReportKpis({ kpis, columns = 4 }: ReportKpisProps) {
  if (!kpis.length) return null;
  const xs = 24;
  const md = Math.max(8, Math.floor(24 / Math.min(columns, kpis.length)));
  const lg = Math.max(6, Math.floor(24 / Math.min(columns, kpis.length)));

  return (
    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
      {kpis.map((kpi, i) => (
        <Col key={i} xs={xs} sm={12} md={md} lg={lg}>
          <Card
            size="small"
            className="rg-card-flat"
            style={kpi.highlight ? { borderColor: 'var(--rg-gold)', borderWidth: 2 } : undefined}
          >
            <Statistic
              title={kpi.title}
              value={kpi.value}
              precision={kpi.precision ?? (kpi.money ? 2 : 0)}
              prefix={kpi.prefix}
              suffix={kpi.suffix}
              valueRender={value => formatValue({ ...kpi, value: Number(value) })}
            />
          </Card>
        </Col>
      ))}
    </Row>
  );
}