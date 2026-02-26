import { useState } from 'react';
import { Card, Col, Row, Statistic, Table, Typography, Spin, Tag, Space } from 'antd';
import {
  TeamOutlined, ShoppingOutlined, DollarOutlined, ShopOutlined,
  WarningOutlined, RiseOutlined, WalletOutlined, CreditCardOutlined,
  BankOutlined, TrophyOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../services/dashboard.api';
import { useAuthStore } from '../store/authStore';
import { fmtMoney, statFormatter } from '../utils/format';
import { PuntoVentaFilter } from '../components/PuntoVentaFilter';
import { RGLogo } from '../components/RGLogo';

const { Title, Text } = Typography;

export function DashboardPage() {
  const puntoVentaActivo = useAuthStore((s) => s.puntoVentaActivo);
  const [pvFilter, setPvFilter] = useState<number | undefined>(() => puntoVentaActivo ?? undefined);

  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats', pvFilter],
    queryFn: () => dashboardApi.getStats(pvFilter),
  });

  const { data: ventasDiarias } = useQuery({
    queryKey: ['ventas-por-dia', pvFilter],
    queryFn: () => dashboardApi.getVentasPorDia(14, pvFilter),
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;

  return (
    <div>
      {/* ── Welcome Banner ────────────────────── */}
      <div style={{
        background: 'linear-gradient(135deg, #1E1F22 0%, #2A2B2F 100%)',
        borderRadius: 14,
        padding: '28px 32px',
        marginBottom: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        overflow: 'hidden',
        position: 'relative',
      }}
        className="animate-fade-in"
      >
        <div>
          <Title level={3} style={{ color: '#EABD23', margin: 0, fontWeight: 700 }}>
            Dashboard
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 4, display: 'block' }}>
            Gestionamos con vos, <span style={{ color: '#EABD23', fontWeight: 600 }}>CRECEMOS JUNTOS.</span>
          </Text>
          <Space style={{ marginTop: 8 }}>
            <PuntoVentaFilter value={pvFilter} onChange={setPvFilter} />
          </Space>
        </div>
        <div style={{ opacity: 0.15 }}>
          <RGLogo size={80} showText={false} variant="white" />
        </div>
        {/* Gold accent line */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'linear-gradient(90deg, #EABD23, transparent)',
        }} />
      </div>

      {/* ── KPI Cards ─────────────────────────── */}
      <Row gutter={[16, 16]} className="stagger">
        <Col xs={24} sm={12} lg={6}>
          <Card className="kpi-card animate-fade-up" hoverable>
            <Statistic title="Clientes" value={stats?.totalClientes ?? 0} prefix={<TeamOutlined style={{ color: '#EABD23' }} />} valueStyle={{ color: '#1E1F22', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="kpi-card animate-fade-up" hoverable>
            <Statistic title="Productos" value={stats?.totalProductos ?? 0} prefix={<ShoppingOutlined style={{ color: '#EABD23' }} />} valueStyle={{ color: '#1E1F22', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="kpi-card animate-fade-up" hoverable>
            <Statistic title="Proveedores" value={stats?.totalProveedores ?? 0} prefix={<ShopOutlined style={{ color: '#EABD23' }} />} valueStyle={{ color: '#1E1F22', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="kpi-card animate-fade-up" hoverable>
            <Statistic title="Ventas Hoy" value={stats?.ventasHoy ?? 0} prefix={<DollarOutlined style={{ color: '#EABD23' }} />} valueStyle={{ color: '#1E1F22', fontWeight: 700 }} />
          </Card>
        </Col>
      </Row>

      {/* ── Montos Hoy ────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }} className="stagger">
        <Col xs={24} sm={8}>
          <Card className="kpi-card animate-fade-up">
            <Statistic title="Monto Hoy" value={stats?.montoHoy ?? 0} formatter={statFormatter} prefix={<DollarOutlined />} valueStyle={{ color: '#EABD23', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="kpi-card animate-fade-up">
            <Statistic title="Efectivo Hoy" value={stats?.efectivoHoy ?? 0} formatter={statFormatter} prefix={<WalletOutlined />} valueStyle={{ color: '#52c41a', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="kpi-card animate-fade-up">
            <Statistic title="Digital Hoy" value={stats?.digitalHoy ?? 0} formatter={statFormatter} prefix={<CreditCardOutlined />} valueStyle={{ color: '#722ed1', fontWeight: 700 }} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }} className="stagger">
        <Col xs={24} sm={8}>
          <Card className="kpi-card animate-fade-up">
            <Statistic title="Monto Mes" value={stats?.montoMes ?? 0} formatter={statFormatter} prefix={<BankOutlined />} suffix={<RiseOutlined style={{ color: '#52c41a' }} />} valueStyle={{ color: '#1E1F22', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="kpi-card animate-fade-up">
            <Statistic title="Ganancia Hoy" value={stats?.gananciaHoy ?? 0} formatter={statFormatter} prefix={<TrophyOutlined />} valueStyle={{ color: '#52c41a', fontWeight: 700 }} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="kpi-card animate-fade-up">
            <Statistic title="Ganancia Mes" value={stats?.gananciaMes ?? 0} formatter={statFormatter} prefix={<TrophyOutlined />} valueStyle={{ color: '#13c2c2', fontWeight: 700 }} />
          </Card>
        </Col>
      </Row>

      {/* ── Ventas Recientes + Stock Bajo ─────── */}
      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={14}>
          <Card
            title="Últimas Ventas"
            className="animate-fade-in"
          >
            <Table
              className="rg-table"
              dataSource={stats?.ventasRecientes}
              rowKey="VENTA_ID"
              size="small"
              pagination={false}
              columns={[
                { title: '#', dataIndex: 'VENTA_ID', width: 60 },
                { title: 'Fecha', dataIndex: 'FECHA_VENTA', render: (v: string) => new Date(v).toLocaleDateString('es-AR') },
                { title: 'Cliente', dataIndex: 'CLIENTE_NOMBRE' },
                { title: 'Tipo', dataIndex: 'TIPO_COMPROBANTE', width: 60 },
                { title: 'Total', dataIndex: 'TOTAL', align: 'right' as const, render: (v: number) => <span style={{ fontWeight: 600, color: '#1E1F22' }}>{fmtMoney(v)}</span> },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card
            title={<><WarningOutlined style={{ color: '#EABD23' }} /> Productos Stock Bajo</>}
            className="animate-fade-in"
          >
            <Table
              className="rg-table"
              dataSource={stats?.productosStockBajo}
              rowKey="PRODUCTO_ID"
              size="small"
              pagination={false}
              columns={[
                { title: 'Código', dataIndex: 'CODIGOPARTICULAR', width: 90, align: 'center' as const },
                { title: 'Producto', dataIndex: 'NOMBRE', ellipsis: true },
                {
                  title: 'Stock',
                  dataIndex: 'CANTIDAD',
                  width: 90,
                  align: 'center' as const,
                  render: (v: number) => <Tag color="red">{v}</Tag>,
                },
                { title: 'Mín', dataIndex: 'STOCK_MINIMO', width: 60, align: 'center' as const },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Ventas últimos 14 días ────────────── */}
      {ventasDiarias && ventasDiarias.length > 0 && (
        <Card title="Ventas últimos 14 días" style={{ marginTop: 16 }} className="animate-fade-in">
          <Table
            className="rg-table"
            dataSource={ventasDiarias}
            rowKey="fecha"
            size="small"
            pagination={false}
            columns={[
              { title: 'Fecha', dataIndex: 'fecha', render: (v: string) => new Date(v).toLocaleDateString('es-AR') },
              { title: 'Cantidad', dataIndex: 'cantidad', align: 'right' as const },
              { title: 'Total', dataIndex: 'total', align: 'right' as const, render: (v: number) => <span style={{ fontWeight: 600 }}>{fmtMoney(v)}</span> },
              { title: 'Ganancia', dataIndex: 'ganancia', align: 'right' as const, render: (v: number) => <span style={{ color: '#52c41a', fontWeight: 600 }}>{fmtMoney(v)}</span> },
            ]}
          />
        </Card>
      )}

      {/* ── Cajas Abiertas ────────────────────── */}
      {stats?.cajasAbiertas && stats.cajasAbiertas.length > 0 && (
        <Card title="Cajas Abiertas" style={{ marginTop: 16 }} className="animate-fade-in">
          <Table
            className="rg-table"
            dataSource={stats.cajasAbiertas}
            rowKey="CAJA_ID"
            size="small"
            pagination={false}
            columns={[
              { title: '#', dataIndex: 'CAJA_ID', width: 60 },
              { title: 'Apertura', dataIndex: 'FECHA_APERTURA', render: (v: string) => new Date(v).toLocaleString('es-AR') },
              { title: 'Monto Apertura', dataIndex: 'MONTO_APERTURA', align: 'right' as const, render: (v: number) => fmtMoney(v) },
              { title: 'Usuario', dataIndex: 'USUARIO_NOMBRE' },
              { title: 'Punto Venta', dataIndex: 'PUNTO_VENTA_NOMBRE' },
              { title: 'Estado', dataIndex: 'ESTADO', render: (v: string) => <Tag color="green">{v}</Tag> },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
