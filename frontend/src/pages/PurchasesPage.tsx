import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Space, Typography, Tag, Drawer, Descriptions, Spin, Alert, Button, Input, Popconfirm, Checkbox, Badge } from 'antd';
import {
  EyeOutlined, PlusOutlined, DeleteOutlined,
  SearchOutlined, ReloadOutlined, SwapOutlined,
  CheckCircleOutlined, LinkOutlined,
} from '@ant-design/icons';
import { usePurchaseDraftStore } from '../store/purchaseDraftStore';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { purchasesApi } from '../services/purchases.api';
import { invalidateInventoryQueries } from '../utils/invalidateInventoryQueries';
import { NewPurchaseModal } from '../components/purchases/NewPurchaseModal';
import { PriceCheckModal } from '../components/purchases/PriceCheckModal';
import { DateFilterPopover, type DatePreset } from '../components/DateFilterPopover';
import { ExportButtons, type ExportColumn } from '../components/ExportButtons';
import { useTabStore } from '../store/tabStore';
import { useNavigationStore } from '../store/navigationStore';
import { fmtComprobanteTipo, fmtMoney, fmtNum } from '../utils/format';
import type { Compra, CompraDetalle } from '../types';
import { RowContextMenu } from '../components/RowContextMenu';
import { useRowActions, type RowAction } from '../hooks/useRowActions';
import { notify } from '../utils/notify.ts';
import { RGCajaModalHeader } from '../components/RGCajaModalHeader';
import { rgIcon } from '../components/rg-icons';

const { Title, Text } = Typography;

export function PurchasesPage() {
  const queryClient = useQueryClient();
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
    const nuevoHandler = () => { if (useTabStore.getState().activeKey === '/purchases') setNewPurchaseOpen(true); };
    window.addEventListener('rg:open-new-purchase', handler);
    window.addEventListener('rg:nuevo', nuevoHandler);
    return () => {
      window.removeEventListener('rg:open-new-purchase', handler);
      window.removeEventListener('rg:nuevo', nuevoHandler);
    };
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

  // ── Query para exportar TODAS las compras (sin paginación) ──
  // Esta query carga todas las compras aplicadas los mismos filtros para exportar
  const { data: allPurchasesData } = useQuery({
    queryKey: ["purchases-all", searchDebounced, fechaDesde, fechaHasta, filterCobrada],
    queryFn: () => purchasesApi.getAll({
      page: 1,
      pageSize: 999999, // Número grande para obtener todos
      search: searchDebounced || undefined,
      fechaDesde, fechaHasta,
      cobrada: filterCobrada,
    }),
    staleTime: 30 * 1000, // 30 segundos de cache
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
      invalidateInventoryQueries(queryClient);
      notify.success('Compra eliminada');
      refetch();
      if (drawerOpen) { setDrawerOpen(false); setSelectedId(null); }
    },
    onError: (err: any) => {
      notify.error(err.response?.data?.error || 'Error al eliminar');
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

  // ── Context menu actions ─────────────────────────
  const contextMenuActions = useMemo<RowAction<Compra>[]>(() => [
    { key: 'view', label: 'Ver detalle', icon: <EyeOutlined />, onClick: openDetail },
    {
      key: 'price-check', label: 'Chequeo de precios', icon: <CheckCircleOutlined />,
      onClick: (r) => { setPriceCheckCompraId(r.COMPRA_ID); setPriceCheckOpen(true); },
    },
    { type: 'divider' },
    {
      key: 'delete', label: 'Eliminar', icon: <DeleteOutlined />, danger: true,
      onClick: (r) => deleteMutation.mutate(r.COMPRA_ID),
    },
    { type: 'divider' },
    {
      key: 'cta-corriente-prov', label: 'Ver Cta. Cte. Prov.', icon: <SwapOutlined />,
      onClick: (r) => {
        openTab({ key: '/cta-corriente-prov', label: 'Cta. Cte. Prov.', closable: true });
        navTo('/cta-corriente-prov', { proveedorId: r.PROVEEDOR_ID });
        navigate('/cta-corriente-prov');
      },
      disabled: (r) => !r.ES_CTA_CORRIENTE,
    },
  ], []);

  const { onRow, rowClassName, contextMenu, contextMenuItems, closeContextMenu } = useRowActions<Compra>({
    getRowId: (r) => r.COMPRA_ID,
    primaryAction: openDetail,
    actions: contextMenuActions,
  });

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
  ];

  // ── Export columns ──────────────────────────────
  const exportColumns: ExportColumn<Compra>[] = [
    { title: "ID", dataIndex: "COMPRA_ID", align: "center", width: 8 },
    {
      title: "Fecha",
      dataIndex: "FECHA_COMPRA",
      align: "center",
      width: 20,
      render: (v: string) => new Date(v).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }),
    },
    { title: "Proveedor", dataIndex: "PROVEEDOR_NOMBRE", width: 30 },
    {
      title: "Comprobante",
      align: "center",
      width: 24,
      render: (_v: unknown, r: Compra) => {
        const tipo = r.TIPO_COMPROBANTE || "";
        const pv = r.PTO_VTA || "0000";
        const nro = r.NRO_COMPROBANTE || "00000000";
        if (!tipo && pv === "0000" && nro === "00000000") return "-";
        return fmtComprobanteTipo(tipo) + " " + pv + "-" + nro;
      },
    },
    { title: "PV", dataIndex: "PTO_VTA", align: "center", width: 8 },
    { title: "Nro.", dataIndex: "NRO_COMPROBANTE", align: "center", width: 14 },
    { title: "Subtotal", dataIndex: "BONIFICACION_TOTAL", numeric: true, money: true, align: "right", width: 14 },
    { title: "IVA", dataIndex: "IVA_TOTAL", numeric: true, money: true, align: "right", width: 14 },
    { title: "Total", dataIndex: "TOTAL", numeric: true, money: true, align: "right", width: 14 },
    {
      title: "Estado",
      align: "center",
      width: 12,
      render: (_v: unknown, r: Compra) => r.COBRADA ? "Pagada" : "Pendiente",
    },
  ];

  // ── Meta de filtros aplicados ──
  const exportMeta: string | undefined = (() => {
    const parts: string[] = [];
    if (searchDebounced) parts.push("Búsqueda: " + searchDebounced + "");
    if (fechaDesde && fechaHasta && fechaDesde === fechaHasta) parts.push("Fecha: " + fechaDesde);
    else if (fechaDesde || fechaHasta) parts.push("Rango: " + (fechaDesde || "...") + " → " + (fechaHasta || "..."));
    if (filterCobrada === false) parts.push("Sólo pago pendiente");
    return parts.length > 0 ? "Filtros: " + parts.join(" · ") : undefined;
  })();

  // ── Footer summary con totales de la página actual ──
  const exportSummary: string[][] | undefined = (() => {
    const arr: Compra[] = data?.data ?? [];
    if (arr.length === 0) return undefined;
    const totalBonif = arr.reduce((s, r) => s + (r.BONIFICACION_TOTAL ?? 0), 0);
    const totalIva = arr.reduce((s, r) => s + (r.IVA_TOTAL ?? 0), 0);
    const totalTotal = arr.reduce((s, r) => s + (r.TOTAL ?? 0), 0);
    return [[
      "", "", "", "", "", "",
      totalBonif > 0 ? fmtMoney(totalBonif) : "",
      fmtMoney(totalIva),
      fmtMoney(totalTotal),
      "",
    ]];
  })();

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
          <ExportButtons
            data={data?.data ?? []}
            allData={allPurchasesData?.data}
            totalCount={allPurchasesData?.total}
            columns={exportColumns}
            title="Listado de Compras"
            subtitle="Compras registradas"
            meta={exportMeta}
            footerSummary={exportSummary}
            fileName="compras"
            sheetName="Compras"
          />
          <Badge count={usePurchaseDraftStore(s => s.hasDraft()) ? 1 : 0} offset={[-4, 4]} size="small" style={{ backgroundColor: '#EABD23', color: '#1E1F22' }}>
            <Button
              type="primary"
              className="btn-gold"
              icon={<PlusOutlined />}
              onClick={() => setNewPurchaseOpen(true)}
            >
              Nueva Compra
            </Button>
          </Badge>
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
        onRow={onRow}
        rowClassName={rowClassName}
      />

      <RowContextMenu
        open={contextMenu !== null}
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />

      {/* ── Detail Drawer ─────────────────────── */}
      <Drawer
        title={
          <RGCajaModalHeader
            icon={rgIcon('compra')}
            title={`Compra #${selectedId}`}
            subtitle="Detalle de la compra"
          />
        }
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={1000}
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
              {detail.REMITO_ID && (
                <Descriptions.Item label="Remito origen" span={2}>
                  <Tag
                    color="gold"
                    style={{ fontSize: 13, cursor: 'pointer' }}
                    onClick={() => {
                      setDrawerOpen(false);
                      setSelectedId(null);
                      openTab({ key: '/remitos', label: 'Remitos', closable: true });
                      navTo('/remitos', { remitoId: detail.REMITO_ID });
                      navigate('/remitos');
                    }}
                  >
                    <LinkOutlined /> Remito #{detail.REMITO_ID}
                  </Tag>
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    Esta compra se originó en un remito de entrada. Stock ya ajustado por el remito.
                  </Text>
                </Descriptions.Item>
              )}
              {detail.metodos_pago && detail.metodos_pago.length > 0 ? (
                <Descriptions.Item label="Métodos de Pago" span={2}>
                  <Space direction="vertical" size={2}>
                    {detail.metodos_pago.map((mp) => (
                      <span key={mp.METODO_PAGO_ID}>
                        {mp.METODO_PAGO_NOMBRE}: <Text strong>{fmtMoney(mp.MONTO)}</Text>
                      </span>
                    ))}
                    {(detail.VUELTO ?? 0) > 0 && (
                      <span>Vuelto: <Text type="warning">{fmtMoney(detail.VUELTO)}</Text></span>
                    )}
                  </Space>
                </Descriptions.Item>
              ) : (
                <>
                  <Descriptions.Item label="Efectivo">
                    {fmtMoney(detail.MONTO_EFECTIVO)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Digital">
                    {fmtMoney(detail.MONTO_DIGITAL)}
                  </Descriptions.Item>
                  <Descriptions.Item label="Vuelto">
                    {fmtMoney(detail.VUELTO)}
                  </Descriptions.Item>
                </>
              )}
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
                      title: 'P. Compra', dataIndex: 'PRECIO_COMPRA', width: 140,
                      align: 'center' as const,
                      render: (v: number) => fmtMoney(v),
                    },
                    {
                      title: 'Bonif.', dataIndex: 'PORCENTAJE_DESCUENTO', width: 80,
                      align: 'center' as const,
                      render: (v: number) => v > 0 ? `${fmtNum(v)}%` : '-',
                    },
                    {
                      title: 'IVA', dataIndex: 'IVA_IMPORTE', width: 150,
                      align: 'center' as const,
                      render: (v: number, r: any) => v > 0 ? `${fmtMoney(v)} (${(r.IVA_ALICUOTA * 100).toFixed(0)}%)` : '-',
                    },
                    {
                      title: 'Subtotal', dataIndex: 'TOTAL_PRODUCTO', width: 140, align: 'center' as const,
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
