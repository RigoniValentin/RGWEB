import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Drawer, Descriptions, Spin, Alert,
  Button, Input, Dropdown, Popconfirm, message, Checkbox,
} from 'antd';
import {
  EyeOutlined, PlusOutlined, DeleteOutlined,
  SearchOutlined, MoreOutlined, ReloadOutlined, SwapOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { purchasesApi } from '../services/purchases.api';
import { NewPurchaseModal } from '../components/purchases/NewPurchaseModal';
import { PriceCheckModal } from '../components/purchases/PriceCheckModal';
import { DateFilterPopover, type DatePreset } from '../components/DateFilterPopover';
import { useTabStore } from '../store/tabStore';
import { useNavigationStore } from '../store/navigationStore';
import { fmtComprobanteTipo, fmtMoney, fmtNum } from '../utils/format';
import type { Compra, CompraDetalle } from '../types';

const { Title, Text } = Typography;

export function PurchasesPage() {
  const navigate = useNavigate();
  const openTab = useTabStore(s => s.openTab);
  const navTo = useNavigationStore(s => s.navigate);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset>('hoy');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(dayjs().format('YYYY-MM-DD'));
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(dayjs().format('YYYY-MM-DD'));
  const [filterCobrada, setFilterCobrada] = useState<boolean | undefined>();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newPurchaseOpen, setNewPurchaseOpen] = useState(false);
  const [priceCheckCompraId, setPriceCheckCompraId] = useState<number | null>(null);
  const [priceCheckOpen, setPriceCheckOpen] = useState(false);

  // ── Listen for global shortcut event ───────────
  useEffect(() => {
    const handler = () => setNewPurchaseOpen(true);
    window.addEventListener('rg:open-new-purchase', handler);
    return () => window.removeEventListener('rg:open-new-purchase', handler);
  }, []);

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
    queryKey: ['purchases', page, pageSize, searchDebounced, fechaDesde, fechaHasta, filterCobrada],
    queryFn: () => purchasesApi.getAll({
      page, pageSize,
      search: searchDebounced || undefined,
      fechaDesde, fechaHasta,
      cobrada: filterCobrada,
    }),
  });

  // Refetch when tab becomes active
  const activeKey = useTabStore(s => s.activeKey);
  useEffect(() => {
    if (activeKey === '/purchases') refetch();
  }, [activeKey]);

  // ── Detail query ───────────────────────────────
  const { data: detail, isLoading: detailLoading, error: detailError } = useQuery({
    queryKey: ['purchase', selectedId],
    queryFn: () => purchasesApi.getById(selectedId!) as Promise<CompraDetalle>,
    enabled: !!selectedId,
  });

  // ── Delete mutation ────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: number) => purchasesApi.delete(id),
    onSuccess: () => {
      message.success('Compra eliminada');
      refetch();
      if (drawerOpen) { setDrawerOpen(false); setSelectedId(null); }
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al eliminar');
    },
  });

  const openDetail = (record: Compra) => {
    setSelectedId(record.COMPRA_ID);
    setDrawerOpen(true);
  };

  const handlePurchaseCreated = (result?: { compraId: number; actualizoCostos: boolean }) => {
    setNewPurchaseOpen(false);
    refetch();
    if (result?.actualizoCostos) {
      setPriceCheckCompraId(result.compraId);
      setPriceCheckOpen(true);
    }
  };

  // ── Action menu for each row ───────────────────
  const getRowActions = (record: Compra) => {
    const items: any[] = [
      { key: 'detail', label: 'Ver detalle', icon: <EyeOutlined />, onClick: () => openDetail(record) },
      {
        key: 'price-check', label: 'Chequeo de precios', icon: <CheckCircleOutlined />,
        onClick: () => { setPriceCheckCompraId(record.COMPRA_ID); setPriceCheckOpen(true); },
      },
    ];

    items.push(
      { type: 'divider' as const },
      { key: 'delete', label: 'Eliminar', icon: <DeleteOutlined />, danger: true, onClick: () => deleteMutation.mutate(record.COMPRA_ID) },
    );

    if (record.ES_CTA_CORRIENTE) {
      items.push(
        { type: 'divider' as const },
        {
          key: 'cta-corriente-prov',
          label: 'Ver Cta. Cte. Prov.',
          icon: <SwapOutlined />,
          onClick: () => {
            openTab({ key: '/cta-corriente-prov', label: 'Cta. Cte. Prov.', closable: true });
            navTo('/cta-corriente-prov', { proveedorId: record.PROVEEDOR_ID });
            navigate('/cta-corriente-prov');
          },
        },
      );
    }

    return items;
  };

  // ── Columns ────────────────────────────────────
  const columns = [
    { title: '#', dataIndex: 'COMPRA_ID', key: 'id', width: 70, align: 'center' as const },
    {
      title: 'Fecha', dataIndex: 'FECHA_COMPRA', key: 'date', width: 160, align: 'center' as const,
      render: (v: string) => new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
    },
    { title: 'Proveedor', dataIndex: 'PROVEEDOR_NOMBRE', key: 'provider', ellipsis: true },
    {
      title: 'Comprobante', key: 'voucher', width: 210, align: 'center' as const,
      render: (_: unknown, record: Compra) => {
        const tipo = record.TIPO_COMPROBANTE || '';
        const pv = record.PTO_VTA || '0000';
        const nro = record.NRO_COMPROBANTE || '00000000';
        if (!tipo && pv === '0000' && nro === '00000000') return '-';
        const tipoLabel = fmtComprobanteTipo(tipo);
        return `${tipoLabel} ${pv}-${nro}`;
      },
    },
    {
      title: 'Total', dataIndex: 'TOTAL', key: 'total', width: 130, align: 'right' as const,
      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
    },
    {
      title: 'Pagada', dataIndex: 'COBRADA', key: 'paid', width: 100, align: 'center' as const,
      render: (v: boolean) => <Tag color={v ? 'green' : 'orange'}>{v ? 'Pagada' : 'Pendiente'}</Tag>,
    },
    {
      title: '', key: 'actions', width: 80, fixed: 'right' as const,
      render: (_: unknown, record: Compra) => (
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
        <Title level={3}>Compras</Title>
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
          <Checkbox
            checked={filterCobrada === false}
            onChange={e => {
              setFilterCobrada(e.target.checked ? false : undefined);
              setPage(1);
            }}
          >
            Pago pendiente
          </Checkbox>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          <Button
            type="primary"
            className="btn-gold"
            icon={<PlusOutlined />}
            onClick={() => setNewPurchaseOpen(true)}
          >
            Nueva Compra
          </Button>
        </Space>
      </div>

      {/* ── Table ──────────────────────────────── */}
      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="COMPRA_ID"
        loading={isLoading}
        pagination={{
          current: page, pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          showTotal: (total) => `Total: ${total} compras`,
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
        title={`Compra #${selectedId}`}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={900}
        className="rg-drawer"
        extra={
          detail && (
            <Space>
              <Popconfirm
                title="¿Eliminar esta compra?"
                description="Se restaurará el stock de los productos."
                onConfirm={() => deleteMutation.mutate(detail.COMPRA_ID)}
                okText="Sí, eliminar"
                cancelText="Cancelar"
                okButtonProps={{ danger: true }}
              >
                <Button type="text" danger size="small" icon={<DeleteOutlined />}>
                  Eliminar
                </Button>
              </Popconfirm>
            </Space>
          )
        }
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : detailError ? (
          <Alert type="error" message="Error al cargar detalle" description={(detailError as any)?.response?.data?.error || (detailError as Error).message} />
        ) : detail && (
          <>
            <Descriptions column={2} bordered size="middle" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Fecha">
                {new Date(detail.FECHA_COMPRA).toLocaleDateString('es-AR')}
              </Descriptions.Item>
              <Descriptions.Item label="Proveedor">{detail.PROVEEDOR_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Comprobante">
                {detail.TIPO_COMPROBANTE
                  ? `${detail.TIPO_COMPROBANTE.startsWith('F') ? `Fact.${detail.TIPO_COMPROBANTE.slice(1)}` : detail.TIPO_COMPROBANTE} ${detail.PTO_VTA || '0000'}-${detail.NRO_COMPROBANTE || '00000000'}`
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Estado">
                <Tag color={detail.COBRADA ? 'green' : 'orange'}>
                  {detail.COBRADA ? 'Pagada' : 'Pago Pendiente'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Cta. Corriente">
                {detail.ES_CTA_CORRIENTE ? <Tag color="blue">Sí</Tag> : 'No'}
              </Descriptions.Item>
              <Descriptions.Item label="Precios sin IVA">
                {detail.PRECIOS_SIN_IVA ? 'Sí' : 'No'}
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
              {(detail.BONIFICACION_TOTAL ?? 0) > 0 && (
                <Descriptions.Item label="Bonificación Total">
                  {fmtMoney(detail.BONIFICACION_TOTAL)}
                </Descriptions.Item>
              )}
              {(detail.IVA_TOTAL ?? 0) > 0 && (
                <Descriptions.Item label="IVA Total">
                  {fmtMoney(detail.IVA_TOTAL)}
                </Descriptions.Item>
              )}
              {(detail.PERCEPCION_IVA ?? 0) > 0 && (
                <Descriptions.Item label="Perc. IVA">
                  {fmtMoney(detail.PERCEPCION_IVA)}
                </Descriptions.Item>
              )}
              {(detail.PERCEPCION_IIBB ?? 0) > 0 && (
                <Descriptions.Item label="Perc. IIBB">
                  {fmtMoney(detail.PERCEPCION_IIBB)}
                </Descriptions.Item>
              )}
              {(detail.IMPUESTO_INTERNO ?? 0) > 0 && (
                <Descriptions.Item label="Impuestos Internos">
                  {fmtMoney(detail.IMPUESTO_INTERNO)}
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Total" span={2}>
                <span style={{ fontSize: 20, fontWeight: 'bold', color: '#EABD23' }}>
                  {fmtMoney(detail.TOTAL)}
                </span>
              </Descriptions.Item>
            </Descriptions>

            {detail.items && detail.items.length > 0 && (
              <div className="rg-sale-items">
                <Title level={5} style={{ marginBottom: 12, fontWeight: 700 }}>Detalle de productos</Title>
                <Table
                  dataSource={detail.items}
                  rowKey="PRODUCTO_ID"
                  size="middle"
                  pagination={false}
                  columns={[
                    { title: 'Código', dataIndex: 'PRODUCTO_CODIGO', width: 90, align: 'center' as const },
                    { title: 'Producto', dataIndex: 'PRODUCTO_NOMBRE', ellipsis: true },
                    {
                      title: 'Cant', dataIndex: 'CANTIDAD', width: 65, align: 'center' as const,
                      render: (v: number) => v % 1 === 0 ? v : fmtNum(v),
                    },
                    {
                      title: 'P. Compra', dataIndex: 'PRECIO_COMPRA', width: 120,
                      align: 'center' as const,
                      render: (v: number) => fmtMoney(v),
                    },
                    {
                      title: 'Bonif.', dataIndex: 'PORCENTAJE_DESCUENTO', width: 72,
                      align: 'center' as const,
                      render: (v: number) => v > 0 ? `${fmtNum(v)}%` : '-',
                    },
                    {
                      title: 'IVA', dataIndex: 'IVA_IMPORTE', width: 100,
                      align: 'center' as const,
                      render: (v: number, r: any) => v > 0 ? `${fmtMoney(v)} (${(r.IVA_ALICUOTA * 100).toFixed(0)}%)` : '-',
                    },
                    {
                      title: 'Subtotal', dataIndex: 'TOTAL_PRODUCTO', width: 120, align: 'center' as const,
                      render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
                    },
                  ]}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={6}>
                        <Text strong style={{ marginLeft: 13 }}>Total</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={6} align="center">
                        <Text strong style={{ color: '#EABD23' }}>
                          {fmtMoney(detail.items.reduce((s, i) => s + i.TOTAL_PRODUCTO, 0))}
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

      {/* ── New Purchase Modal ────────────────── */}
      <NewPurchaseModal
        open={newPurchaseOpen}
        onClose={() => setNewPurchaseOpen(false)}
        onSuccess={handlePurchaseCreated}
      />

      {/* ── Price Check Modal ─────────────────── */}
      <PriceCheckModal
        open={priceCheckOpen}
        compraId={priceCheckCompraId}
        onClose={() => { setPriceCheckOpen(false); setPriceCheckCompraId(null); }}
      />
    </div>
  );
}
