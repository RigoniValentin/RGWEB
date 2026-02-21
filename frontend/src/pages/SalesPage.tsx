import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, DatePicker, Drawer, Descriptions, Spin,
} from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { salesApi } from '../services/sales.api';
import type { Venta, VentaDetalle } from '../types';

const { Title } = Typography;
const { RangePicker } = DatePicker;

export function SalesPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [fechaDesde, setFechaDesde] = useState<string | undefined>();
  const [fechaHasta, setFechaHasta] = useState<string | undefined>();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── List query ─────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['sales', page, pageSize, fechaDesde, fechaHasta],
    queryFn: () => salesApi.getAll({ page, pageSize, fechaDesde, fechaHasta }),
  });

  // ── Detail query ───────────────────────────────
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['sale', selectedId],
    queryFn: () => salesApi.getById(selectedId!) as Promise<VentaDetalle>,
    enabled: !!selectedId,
  });

  const openDetail = (record: Venta) => {
    setSelectedId(record.VENTA_ID);
    setDrawerOpen(true);
  };

  const handleDateChange = (dates: any) => {
    if (dates) {
      setFechaDesde(dates[0]?.format('YYYY-MM-DD'));
      setFechaHasta(dates[1]?.format('YYYY-MM-DD'));
    } else {
      setFechaDesde(undefined);
      setFechaHasta(undefined);
    }
    setPage(1);
  };

  // ── Columns ────────────────────────────────────
  const columns = [
    { title: '#', dataIndex: 'VENTA_ID', key: 'id', width: 70 },
    {
      title: 'Fecha',
      dataIndex: 'FECHA_VENTA',
      key: 'date',
      width: 110,
      render: (v: string) => new Date(v).toLocaleDateString('es-AR'),
    },
    { title: 'Cliente', dataIndex: 'CLIENTE_NOMBRE', key: 'client' },
    { title: 'Usuario', dataIndex: 'USUARIO_NOMBRE', key: 'user', width: 120 },
    { title: 'Tipo', dataIndex: 'TIPO_COMPROBANTE', key: 'type', width: 60 },
    { title: 'Punto Venta', dataIndex: 'PUNTO_VENTA', key: 'pv', width: 90 },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      key: 'total',
      width: 120,
      align: 'right' as const,
      render: (v: number) => `$ ${(v ?? 0).toFixed(2)}`,
    },
    {
      title: 'Cobrada',
      dataIndex: 'COBRADA',
      key: 'paid',
      width: 90,
      render: (v: boolean) => <Tag color={v ? 'green' : 'orange'}>{v ? 'Sí' : 'No'}</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      render: (_: unknown, record: Venta) => (
        <EyeOutlined style={{ cursor: 'pointer', color: '#EABD23' }} onClick={() => openDetail(record)} />
      ),
    },
  ];

  return (
    <div className="page-enter">
      <div className="page-header">
        <Title level={3}>Ventas</Title>
        <Space wrap>
          <RangePicker onChange={handleDateChange} format="DD/MM/YYYY" />
        </Space>
      </div>

      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="VENTA_ID"
        loading={isLoading}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          showTotal: (total) => `Total: ${total} registros`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 900 }}
      />

      {/* ── Detail Drawer ─────────────────────── */}
      <Drawer
        title={`Venta #${selectedId}`}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={640}
        className="rg-drawer"
      >
        {detailLoading ? <Spin /> : detail && (
          <>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Fecha">{new Date(detail.FECHA_VENTA).toLocaleDateString('es-AR')}</Descriptions.Item>
              <Descriptions.Item label="Cliente">{detail.CLIENTE_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Usuario">{detail.USUARIO_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Tipo">{detail.TIPO_COMPROBANTE}</Descriptions.Item>
              <Descriptions.Item label="Punto Venta">{detail.PUNTO_VENTA}</Descriptions.Item>
              <Descriptions.Item label="Nro. Fiscal">{detail.NUMERO_FISCAL || '-'}</Descriptions.Item>
              <Descriptions.Item label="CAE">{detail.CAE || '-'}</Descriptions.Item>
              <Descriptions.Item label="Cobrada">
                <Tag color={detail.COBRADA ? 'green' : 'orange'}>{detail.COBRADA ? 'Sí' : 'No'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Efectivo">$ {(detail.MONTO_EFECTIVO ?? 0).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="Digital">$ {(detail.MONTO_DIGITAL ?? 0).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="Vuelto">$ {(detail.VUELTO ?? 0).toFixed(2)}</Descriptions.Item>
              <Descriptions.Item label="Total" span={2}>
                <span style={{ fontSize: 18, fontWeight: 'bold' }}>$ {detail.TOTAL.toFixed(2)}</span>
              </Descriptions.Item>
            </Descriptions>

            {detail.items && detail.items.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <Title level={5}>Items</Title>
                <Table
                  dataSource={detail.items}
                  rowKey="ITEM_ID"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: 'Código', dataIndex: 'PRODUCTO_CODIGO', width: 90 },
                    { title: 'Producto', dataIndex: 'PRODUCTO_NOMBRE', ellipsis: true },
                    { title: 'Cant.', dataIndex: 'CANTIDAD', width: 60, align: 'right' as const },
                    { title: 'P. Unit.', dataIndex: 'PRECIO_UNITARIO', width: 100, align: 'right' as const, render: (v: number) => `$ ${v.toFixed(2)}` },
                    { title: 'Dto.', dataIndex: 'DESCUENTO', width: 60, align: 'right' as const, render: (v: number) => `${v}%` },
                    {
                      title: 'Subtotal',
                      key: 'sub',
                      width: 110,
                      align: 'right' as const,
                      render: (_: unknown, r: any) => `$ ${(r.PRECIO_UNITARIO_DTO * r.CANTIDAD).toFixed(2)}`,
                    },
                  ]}
                />
              </div>
            )}
          </>
        )}
      </Drawer>
    </div>
  );
}
