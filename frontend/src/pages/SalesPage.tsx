import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Drawer, Descriptions, Spin,
  Button, Input, Dropdown, Popconfirm, message, Checkbox,
} from 'antd';
import {
  EyeOutlined, PlusOutlined, DeleteOutlined, DollarOutlined,
  SearchOutlined, MoreOutlined, WalletOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { salesApi } from '../services/sales.api';
import { NewSaleModal } from '../components/sales/NewSaleModal';
import { PaymentModal } from '../components/sales/PaymentModal';
import { DateFilterPopover, type DatePreset } from '../components/DateFilterPopover';
import { PuntoVentaFilter } from '../components/PuntoVentaFilter';
import { useAuthStore } from '../store/authStore';
import { fmtMoney, fmtNum } from '../utils/format';
import type { Venta, VentaDetalle } from '../types';

const { Title, Text } = Typography;

export function SalesPage() {
  const queryClient = useQueryClient();
  const { puntoVentaActivo } = useAuthStore();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('hoy');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(dayjs().format('YYYY-MM-DD'));
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(dayjs().format('YYYY-MM-DD'));
  const [filterCobrada, setFilterCobrada] = useState<boolean | undefined>();
  const [pvFilter, setPvFilter] = useState<number | undefined>(() => puntoVentaActivo ?? undefined);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newSaleOpen, setNewSaleOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentMode, setPaymentMode] = useState<'total' | 'parcial'>('total');
  const [paymentVenta, setPaymentVenta] = useState<Venta | null>(null);

  // ── Debounced search ───────────────────────────
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimer) clearTimeout(searchTimer);
    const timer = setTimeout(() => {
      setSearchDebounced(value);
      setPage(1);
    }, 400);
    setSearchTimer(timer);
  };

  // ── List query ─────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sales', page, pageSize, searchDebounced, fechaDesde, fechaHasta, filterCobrada, pvFilter],
    queryFn: () => salesApi.getAll({
      page, pageSize,
      search: searchDebounced || undefined,
      fechaDesde, fechaHasta,
      cobrada: filterCobrada,
      puntoVentaId: pvFilter,
    }),
  });

  // ── Detail query ───────────────────────────────
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['sale', selectedId],
    queryFn: () => salesApi.getById(selectedId!) as Promise<VentaDetalle>,
    enabled: !!selectedId,
  });

  // ── Delete mutation ────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: number) => salesApi.delete(id),
    onSuccess: () => {
      message.success('Venta eliminada');
      refetch();
      if (drawerOpen) { setDrawerOpen(false); setSelectedId(null); }
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al eliminar');
    },
  });

  // ── Unpay mutation ─────────────────────────────
  const unpayMutation = useMutation({
    mutationFn: (id: number) => salesApi.unpay(id),
    onSuccess: () => {
      message.success('Cobro removido');
      refetch();
      queryClient.invalidateQueries({ queryKey: ['sale'] });
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al quitar cobro');
    },
  });

  const openDetail = (record: Venta) => {
    setSelectedId(record.VENTA_ID);
    setDrawerOpen(true);
  };



  const openPayment = (venta: Venta, mode: 'total' | 'parcial') => {
    setPaymentVenta(venta);
    setPaymentMode(mode);
    setPaymentOpen(true);
  };

  const handleSaleCreated = () => {
    setNewSaleOpen(false);
    refetch();
  };

  const handlePaymentSuccess = () => {
    setPaymentOpen(false);
    setPaymentVenta(null);
    refetch();
    queryClient.invalidateQueries({ queryKey: ['sale'] });
  };

  // ── Action menu for each row ───────────────────
  const getRowActions = (record: Venta) => {
    const items: any[] = [
      { key: 'detail', label: 'Ver detalle', icon: <EyeOutlined />, onClick: () => openDetail(record) },
    ];

    if (!record.COBRADA) {
      items.push(
        { key: 'pay-total', label: 'Cobro total', icon: <WalletOutlined />, onClick: () => openPayment(record, 'total') },
        { key: 'pay-partial', label: 'Cobro parcial', icon: <DollarOutlined />, onClick: () => openPayment(record, 'parcial') },
      );
    } else {
      items.push(
        { key: 'unpay', label: 'Quitar cobro', icon: <CloseCircleOutlined />, danger: true, onClick: () => unpayMutation.mutate(record.VENTA_ID) },
      );
    }

    if (!record.NUMERO_FISCAL) {
      items.push(
        { type: 'divider' as const },
        { key: 'delete', label: 'Eliminar', icon: <DeleteOutlined />, danger: true, onClick: () => deleteMutation.mutate(record.VENTA_ID) },
      );
    }

    return items;
  };

  // ── Columns ────────────────────────────────────
  const columns = [
    { title: '#', dataIndex: 'VENTA_ID', key: 'id', width: 70, align: 'center' as const },
    {
      title: 'Fecha', dataIndex: 'FECHA_VENTA', key: 'date', width: 160, align: 'center' as const,
      render: (v: string) => new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
    },
    { title: 'Cliente', dataIndex: 'CLIENTE_NOMBRE', key: 'client', ellipsis: true },
    { title: 'Vendedor', dataIndex: 'USUARIO_NOMBRE', key: 'user', width: 120, ellipsis: true },
    {
      title: 'Tipo', dataIndex: 'TIPO_COMPROBANTE', key: 'type', width: 65, align: 'center' as const,
      render: (v: string | null) => v ? <Tag>{v.replace('Fa.', '')}</Tag> : '-',
    },
    {
      title: 'Total', dataIndex: 'TOTAL', key: 'total', width: 120, align: 'right' as const,
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
    },
    {
      title: 'Cobrada', dataIndex: 'COBRADA', key: 'paid', width: 100, align: 'center' as const,
      render: (v: boolean) => <Tag color={v ? 'green' : 'orange'}>{v ? 'Cobrada' : 'Pendiente'}</Tag>,
    },
    {
      title: '', key: 'actions', width: 80, fixed: 'right' as const,
      render: (_: unknown, record: Venta) => (
        <Space size={4}>
          <EyeOutlined
            style={{ cursor: 'pointer', color: '#EABD23', fontSize: 16 }}
            onClick={() => openDetail(record)}
          />
          <Dropdown
            menu={{ items: getRowActions(record) }}
            trigger={['click']}
            placement="bottomRight"
          >
            <MoreOutlined style={{ cursor: 'pointer', fontSize: 16, padding: 4 }} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-enter">
      {/* ── Header ─────────────────────────────── */}
      <div className="page-header">
        <Title level={3}>Ventas</Title>
        <Space wrap>
          <Input
            placeholder="Buscar..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            allowClear
            style={{ width: 220 }}
          />
          <DateFilterPopover
            preset={datePreset}
            fechaDesde={fechaDesde}
            fechaHasta={fechaHasta}
            onPresetChange={(p, d, h) => { setDatePreset(p); setFechaDesde(d); setFechaHasta(h); setPage(1); }}
            onRangeChange={(d, h) => { setDatePreset(undefined as any); setFechaDesde(d); setFechaHasta(h); setPage(1); }}
          />
          <PuntoVentaFilter value={pvFilter} onChange={(v) => { setPvFilter(v); setPage(1); }} />
          <Checkbox
            checked={filterCobrada === false}
            onChange={e => {
              setFilterCobrada(e.target.checked ? false : undefined);
              setPage(1);
            }}
          >
            Cobro pendiente
          </Checkbox>
          <Button
            type="primary"
            className="btn-gold"
            icon={<PlusOutlined />}
            onClick={() => setNewSaleOpen(true)}
          >
            Nueva Venta
          </Button>
        </Space>
      </div>

      {/* ── Table ──────────────────────────────── */}
      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="VENTA_ID"
        loading={isLoading}
        pagination={{
          current: page, pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          showTotal: (total) => `Total: ${total} ventas`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 800 }}
        onRow={(record) => ({
          onDoubleClick: () => openDetail(record),
        })}
      />

      {/* ── Detail Drawer ─────────────────────── */}
      <Drawer
        title={`Venta #${selectedId}`}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={680}
        className="rg-drawer"
        extra={
          detail && (
            <Space>
              {!detail.COBRADA && (
                <Button
                  type="primary"
                  className="btn-gold"
                  size="small"
                  icon={<WalletOutlined />}
                  onClick={() => openPayment(detail as Venta, 'total')}
                >
                  Cobrar
                </Button>
              )}
              {!detail.NUMERO_FISCAL && (
                <Popconfirm
                  title="¿Eliminar esta venta?"
                  description="Se restaurará el stock de los productos."
                  onConfirm={() => deleteMutation.mutate(detail.VENTA_ID)}
                  okText="Sí, eliminar"
                  cancelText="Cancelar"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="text" danger size="small" icon={<DeleteOutlined />}>
                    Eliminar
                  </Button>
                </Popconfirm>
              )}
            </Space>
          )
        }
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : detail && (
          <>
            <Descriptions column={2} bordered size="small" style={{ marginBottom: 20 }}>
              <Descriptions.Item label="Fecha">
                {new Date(detail.FECHA_VENTA).toLocaleDateString('es-AR')}
              </Descriptions.Item>
              <Descriptions.Item label="Cliente">{detail.CLIENTE_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Vendedor">{detail.USUARIO_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Comprobante">{detail.TIPO_COMPROBANTE || '-'}</Descriptions.Item>
              <Descriptions.Item label="Nro. Fiscal">{detail.NUMERO_FISCAL || 'Sin emitir'}</Descriptions.Item>
              <Descriptions.Item label="CAE">{detail.CAE || '-'}</Descriptions.Item>
              <Descriptions.Item label="Estado">
                <Tag color={detail.COBRADA ? 'green' : 'orange'}>
                  {detail.COBRADA ? 'Cobrada' : 'Cobro Pendiente'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Cta. Corriente">
                {detail.ES_CTA_CORRIENTE ? <Tag color="blue">Sí</Tag> : 'No'}
              </Descriptions.Item>
              <Descriptions.Item label="Efectivo">
                {fmtMoney(detail.MONTO_EFECTIVO)}
              </Descriptions.Item>
              <Descriptions.Item label="Digital">
                {fmtMoney(detail.MONTO_DIGITAL)}
              </Descriptions.Item>
              <Descriptions.Item label="Vuelto">
                {fmtMoney(detail.VUELTO)}
              </Descriptions.Item>
              {(detail.DTO_GRAL ?? 0) > 0 && (
                <Descriptions.Item label="Dto. General">
                  {detail.DTO_GRAL}%
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Total" span={2}>
                <span style={{ fontSize: 20, fontWeight: 'bold', color: '#EABD23' }}>
                  {fmtMoney(detail.TOTAL)}
                </span>
              </Descriptions.Item>
            </Descriptions>

            {detail.items && detail.items.length > 0 && (
              <div>
                <Title level={5} style={{ marginBottom: 12 }}>Detalle de productos</Title>
                <Table
                  className="rg-table"
                  dataSource={detail.items}
                  rowKey="ITEM_ID"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: 'Código', dataIndex: 'PRODUCTO_CODIGO', width: 90 },
                    { title: 'Producto', dataIndex: 'PRODUCTO_NOMBRE', ellipsis: true },
                    {
                      title: 'Cant.', dataIndex: 'CANTIDAD', width: 65, align: 'right' as const,
                      render: (v: number) => v % 1 === 0 ? v : fmtNum(v),
                    },
                    {
                      title: 'P. Unit.', dataIndex: 'PRECIO_UNITARIO', width: 100,
                      align: 'right' as const,
                      render: (v: number) => fmtMoney(v),
                    },
                    {
                      title: 'Dto.', dataIndex: 'DESCUENTO', width: 55,
                      align: 'right' as const,
                      render: (v: number) => v > 0 ? `${v}%` : '-',
                    },
                    {
                      title: 'Subtotal', key: 'sub', width: 110, align: 'right' as const,
                      render: (_: unknown, r: any) => (
                        <Text strong>{fmtMoney(r.PRECIO_UNITARIO_DTO * r.CANTIDAD)}</Text>
                      ),
                    },
                  ]}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={5}>
                        <Text strong>Total</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">
                        <Text strong style={{ color: '#EABD23' }}>
                          {fmtMoney(detail.items.reduce((s, i) => s + (i.PRECIO_UNITARIO_DTO * i.CANTIDAD), 0))}
                        </Text>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  )}
                />
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* ── New Sale Modal ────────────────────── */}
      <NewSaleModal
        open={newSaleOpen}
        onClose={() => setNewSaleOpen(false)}
        onSuccess={handleSaleCreated}
      />

      {/* ── Payment Modal ─────────────────────── */}
      <PaymentModal
        open={paymentOpen}
        venta={paymentVenta}
        mode={paymentMode}
        onClose={() => { setPaymentOpen(false); setPaymentVenta(null); }}
        onSuccess={handlePaymentSuccess}
      />
    </div>
  );
}
