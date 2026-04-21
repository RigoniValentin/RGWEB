import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Typography, Tag, Drawer, Descriptions, Spin,
  Button, Input, Dropdown, Popconfirm, message, Checkbox, Modal, Tooltip, Badge,
} from 'antd';
import {
  EyeOutlined, PlusOutlined, DeleteOutlined, DollarOutlined,
  SearchOutlined, MoreOutlined, WalletOutlined, CloseCircleOutlined, ReloadOutlined,
  PrinterOutlined, WhatsAppOutlined, SendOutlined, UserOutlined,
  FileTextOutlined, FilePdfOutlined, SwapOutlined, BankOutlined,
  FileExclamationOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { printReceipt } from '../utils/printReceipt';
import type { ReceiptData } from '../utils/printReceipt';
import dayjs from 'dayjs';
import { salesApi } from '../services/sales.api';
import { cajaApi } from '../services/caja.api';
import { NewSaleModal } from '../components/sales/NewSaleModal';
import { PaymentModal } from '../components/sales/PaymentModal';
import { DateFilterPopover, type DatePreset } from '../components/DateFilterPopover';
import { PuntoVentaFilter } from '../components/PuntoVentaFilter';
import { useAuthStore } from '../store/authStore';
import { useTabStore } from '../store/tabStore';
import { useSaleDraftsStore } from '../store/saleDraftsStore';
import { useNavigationStore } from '../store/navigationStore';
import { fmtMoney, fmtNum, fmtComprobanteTipo } from '../utils/format';
import { generateFacturaPdf, type CopiasTipo } from '../components/sales/facturaPdf';
import { printFacturaTicket } from '../components/sales/facturaTicket';
import { NewNCVentaModal } from '../components/sales/NewNCVentaModal';
import { settingsApi } from '../services/settings.api';
import type { Venta, VentaDetalle } from '../types';

const { Title, Text } = Typography;

export function SalesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const openTab = useTabStore(s => s.openTab);
  const draftCount = useSaleDraftsStore(s => s.drafts.length);
  const navTo = useNavigationStore(s => s.navigate);
  const navEvent = useNavigationStore(s => s.event);
  const clearNavEvent = useNavigationStore(s => s.clearEvent);
  const lastNavTimestamp = useRef<number>(0);
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

  // Desglose métodos de pago
  const [desgloseModalOpen, setDesgloseModalOpen] = useState(false);

  // NC asociadas modal
  const [ncModalOpen, setNCModalOpen] = useState(false);

  // WhatsApp resend state
  const [wspModalOpen, setWspModalOpen] = useState(false);
  const [wspTelefono, setWspTelefono] = useState('');
  const [wspNombre, setWspNombre] = useState('');
  const [wspSending, setWspSending] = useState(false);
  const [wspVentaId, setWspVentaId] = useState<number | null>(null);

  // ── Mi caja activa ─────────────────────────────
  const { data: miCaja } = useQuery({
    queryKey: ['mi-caja'],
    queryFn: () => cajaApi.getMiCaja(),
    staleTime: 30000,
  });

  // ── Listen for global shortcut event ───────────
  useEffect(() => {
    const handler = () => setNewSaleOpen(true);
    window.addEventListener('rg:open-new-sale', handler);
    return () => window.removeEventListener('rg:open-new-sale', handler);
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
  const { data: detail, error: detailError } = useQuery({
    queryKey: ['sale', selectedId],
    queryFn: () => salesApi.getById(selectedId!) as Promise<VentaDetalle>,
    enabled: !!selectedId,
    retry: 1,
  });

  // ── Empresa info (for receipts) ────────────────
  const { data: empresaInfo } = useQuery({
    queryKey: ['sales-empresa-info'],
    queryFn: () => salesApi.getEmpresaInfo(),
    staleTime: 300000,
  });

  // ── FE config ──────────────────────────────────
  const { data: feConfig } = useQuery({
    queryKey: ['sales-fe-config'],
    queryFn: () => salesApi.getFEConfig(),
    staleTime: 300000,
  });
  const utilizaFE = feConfig?.utilizaFE === true;
  const [facturando, setFacturando] = useState(false);

  // ── NC Ventas state ────────────────────────────
  const [ncVentaOpen, setNCVentaOpen] = useState(false);
  const [ncVentaPreselected, setNCVentaPreselected] = useState<{ ventaId?: number; clienteId?: number }>({});

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

  // Consume navigation events to auto-open detail drawer
  useEffect(() => {
    if (!navEvent || navEvent.target !== '/sales' || !navEvent.payload?.ventaId) return;
    if (navEvent.timestamp === lastNavTimestamp.current) return;
    lastNavTimestamp.current = navEvent.timestamp;
    const targetId = navEvent.payload.ventaId as number;
    clearNavEvent();
    setSelectedId(targetId);
    setDrawerOpen(true);
  }, [navEvent, clearNavEvent]);

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

  // ── Reprint receipt ────────────────────────────
  const handleReprint = async (v: VentaDetalle) => {
    // If the sale has a fiscal number (FE emitted), print fiscal ticket
    if (v.NUMERO_FISCAL) {
      try {
        const facturaData = await salesApi.getFacturaData(v.VENTA_ID);
        printFacturaTicket(facturaData);
        return;
      } catch {
        // FE data not available, fall through to local receipt
      }
    }

    // Fallback: local receipt
    const receiptData: ReceiptData = {
      ventaId: v.VENTA_ID,
      nombreFantasia: empresaInfo?.NOMBRE_FANTASIA || 'Empresa',
      clienteNombre: v.CLIENTE_NOMBRE || 'Consumidor Final',
      usuarioNombre: v.USUARIO_NOMBRE || '',
      fecha: new Date(v.FECHA_VENTA),
      items: v.items.map(item => ({
        nombre: item.PRODUCTO_NOMBRE || '',
        cantidad: item.CANTIDAD,
        unidad: item.UNIDAD_ABREVIACION || 'u',
        precioUnitario: item.PRECIO_UNITARIO,
        descuento: item.DESCUENTO,
        subtotal: item.PRECIO_UNITARIO_DTO * item.CANTIDAD,
      })),
      dtoGral: v.DTO_GRAL || 0,
      subtotal: v.items.reduce((s, i) => s + (i.PRECIO_UNITARIO_DTO * i.CANTIDAD), 0),
      total: v.TOTAL,
      esCtaCorriente: v.ES_CTA_CORRIENTE,
      montoEfectivo: v.MONTO_EFECTIVO ?? 0,
      montoDigital: v.MONTO_DIGITAL ?? 0,
      vuelto: v.VUELTO ?? 0,
      metodoPago: (v.MONTO_EFECTIVO ?? 0) > 0 && (v.MONTO_DIGITAL ?? 0) > 0
        ? 'mixto'
        : (v.MONTO_DIGITAL ?? 0) > 0 ? 'digital' : 'efectivo',
    };
    printReceipt(receiptData);
  };

  // ── Open WhatsApp resend modal ─────────────────
  const openWspModal = (v: VentaDetalle) => {
    setWspVentaId(v.VENTA_ID);
    setWspNombre(v.NOMBRE_ENVIO_DETALLE || v.CLIENTE_NOMBRE || '');
    setWspTelefono(v.NRO_ENVIO_DETALLE || '');
    setWspModalOpen(true);
  };

  // ── Send WhatsApp ──────────────────────────────
  const handleSendWhatsApp = async () => {
    if (!wspVentaId || !wspTelefono.trim()) {
      message.warning('Ingrese un número de teléfono');
      return;
    }
    const digits = wspTelefono.replace(/\D/g, '');
    if (digits.length < 10) {
      message.warning('El teléfono debe tener al menos 10 dígitos');
      return;
    }
    setWspSending(true);
    try {
      await salesApi.sendWhatsApp(wspVentaId, wspTelefono, wspNombre || 'Cliente');
      message.success('Detalle enviado por WhatsApp');
      setWspModalOpen(false);
      // Refresh detail to show updated NRO_ENVIO_DETALLE
      queryClient.invalidateQueries({ queryKey: ['sale', wspVentaId] });
      setWspVentaId(null);
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Error al enviar WhatsApp');
    } finally {
      setWspSending(false);
    }
  };

  // ── Action menu for each row ───────────────────
  const handleFacturar = async (ventaId: number) => {
    setFacturando(true);
    try {
      const result = await salesApi.facturar(ventaId);
      if (result.success) {
        message.success(
          `Factura emitida: ${result.tipo_comprobante} Nº ${result.comprobante_nro} — CAE: ${result.cae}`,
          6
        );

        refetch();
        queryClient.invalidateQueries({ queryKey: ['sale', ventaId] });
      } else {
        message.error(
          `Error al facturar: ${(result.errores || []).join(', ') || 'Error desconocido'}`,
          8
        );
      }
    } catch (err: any) {
      message.error(`Error al emitir factura: ${err.response?.data?.error || err.message}`, 8);
    } finally {
      setFacturando(false);
    }
  };

  const handleFacturaPdf = async (ventaId: number, copias: CopiasTipo = 'original') => {
    try {
      const [facturaData, logoDataUrl] = await Promise.all([
        salesApi.getFacturaData(ventaId),
        settingsApi.getLogoDataUrl(),
      ]);
      await generateFacturaPdf(facturaData, copias, logoDataUrl);
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Error al generar PDF de factura');
    }
  };

  const handleFacturaTicket = async (ventaId: number) => {
    try {
      const facturaData = await salesApi.getFacturaData(ventaId);
      printFacturaTicket(facturaData);
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Error al generar ticket de factura');
    }
  };

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
      if (utilizaFE) {
        items.push(
          { type: 'divider' as const },
          { key: 'facturar', label: 'Emitir Factura Electrónica', icon: <FileTextOutlined />, onClick: () => handleFacturar(record.VENTA_ID) },
        );
      }
      items.push(
        { type: 'divider' as const },
        { key: 'delete', label: 'Eliminar', icon: <DeleteOutlined />, danger: true, onClick: () => deleteMutation.mutate(record.VENTA_ID) },
      );
    } else {
      items.push(
        { type: 'divider' as const },
        { key: 'fe-pdf', label: 'Descargar PDF', icon: <FilePdfOutlined />, onClick: () => handleFacturaPdf(record.VENTA_ID) },
        { key: 'fe-pdf-dup', label: 'PDF Original + Duplicado', icon: <FilePdfOutlined />, onClick: () => handleFacturaPdf(record.VENTA_ID, 'original-duplicado') },
        { key: 'fe-ticket', label: 'Imprimir ticket 80mm', icon: <PrinterOutlined />, onClick: () => handleFacturaTicket(record.VENTA_ID) },
      );
    }

    // Nota de Crédito
    if (record.COBRADA) {
      items.push(
        { type: 'divider' as const },
        {
          key: 'nc-venta',
          label: 'Nota de Crédito',
          icon: <FileExclamationOutlined />,
          onClick: () => {
            setNCVentaPreselected({ ventaId: record.VENTA_ID, clienteId: record.CLIENTE_ID });
            setNCVentaOpen(true);
          },
        },
      );
    }

    // Cta. Corriente — show for ES_CTA_CORRIENTE sales
    if (record.ES_CTA_CORRIENTE) {
      items.push(
        { type: 'divider' as const },
        {
          key: 'cta-corriente',
          label: 'Ver Cta. Corriente',
          icon: <SwapOutlined />,
          onClick: () => {
            openTab({ key: '/cta-corriente', label: 'Cta. Corriente', closable: true });
            navTo('/cta-corriente', { clienteId: record.CLIENTE_ID });
            navigate('/cta-corriente');
          },
        },
      );
    }

    return items;
  };

  // ── Columns ────────────────────────────────────
  const columns = [
    { title: '#', dataIndex: 'VENTA_ID', key: 'id', width: 100, align: 'center' as const },
    {
      title: 'Fecha', dataIndex: 'FECHA_VENTA', key: 'date', width: 160, align: 'center' as const,
      render: (v: string) => new Date(v).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
    },
    { title: 'Cliente', dataIndex: 'CLIENTE_NOMBRE', key: 'client', ellipsis: true },
    { title: 'Vendedor', dataIndex: 'USUARIO_NOMBRE', key: 'user', width: 120, ellipsis: true, align: 'center' as const },
    {
      title: 'Comprobante', key: 'voucher', width: 210, align: 'center' as const,
      render: (_: unknown, record: Venta) => {
        if (record.NUMERO_FISCAL) {
          const tipo = record.TIPO_COMPROBANTE || '';
          const pv = record.PUNTO_VENTA || '0000';
          const nro = record.NUMERO_FISCAL;
          const tipoLabel = fmtComprobanteTipo(tipo);
          return <Text style={{ fontSize: 12.5 }}>{`${tipoLabel} ${pv}-${nro}`}</Text>;
        }
        if (utilizaFE) {
          return (
            <Popconfirm
              title="Emitir Factura Electrónica"
              description="¿Desea emitir el comprobante fiscal para esta venta?"
              onConfirm={() => handleFacturar(record.VENTA_ID)}
              okText="Sí, emitir"
              cancelText="Cancelar"
              okButtonProps={{ className: 'btn-gold' }}
            >
              <Tag
                color="orange"
                style={{ cursor: 'pointer', fontWeight: 600 }}
                onClick={(e) => e.stopPropagation()}
              >
                <FileTextOutlined style={{ marginRight: 4 }} />
                Sin Emitir
              </Tag>
            </Popconfirm>
          );
        }
        return <Text type="secondary" style={{ fontSize: 12 }}>-</Text>;
      },
    },
    {
      title: 'Total', dataIndex: 'TOTAL', key: 'total', width: 150, align: 'right' as const,
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
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} />
          {miCaja && (
            <Button
              icon={<BankOutlined />}
              onClick={() => {
                openTab({ key: '/cashregisters', label: 'Cajas', closable: true });
                navigate('/cashregisters', { state: { openCajaId: miCaja.CAJA_ID } });
              }}
            >
              Ver mi Caja
            </Button>
          )}
          <Badge count={draftCount} offset={[-4, 4]} size="small" style={{ backgroundColor: '#EABD23', color: '#1E1F22' }}>
            <Button
              type="primary"
              className="btn-gold"
              icon={<PlusOutlined />}
              onClick={() => setNewSaleOpen(true)}
            >
              Nueva Venta
            </Button>
          </Badge>
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
        width={900}
        className="rg-drawer"
        extra={
          detail && (
            <Space>
              <Tooltip title="Reimprimir ticket">
                <Button
                  size="small"
                  icon={<PrinterOutlined />}
                  onClick={() => handleReprint(detail as VentaDetalle)}
                />
              </Tooltip>
              <Tooltip title={detail.NRO_ENVIO_DETALLE ? 'Reenviar por WhatsApp' : 'Enviar por WhatsApp'}>
                <Button
                  size="small"
                  icon={<WhatsAppOutlined />}
                  style={{ color: '#25D366', borderColor: '#25D366' }}
                  onClick={() => openWspModal(detail as VentaDetalle)}
                />
              </Tooltip>
              {utilizaFE && !detail.NUMERO_FISCAL && (
                <Tooltip title="Emitir Factura Electrónica">
                  <Button
                    size="small"
                    icon={<FileTextOutlined />}
                    loading={facturando}
                    onClick={() => handleFacturar(detail.VENTA_ID)}
                    style={{ color: '#1677ff', borderColor: '#1677ff' }}
                  />
                </Tooltip>
              )}
              {detail.NUMERO_FISCAL && (
                <Tooltip title="Descargar PDF del comprobante">
                  <Button
                    size="small"
                    icon={<FilePdfOutlined />}
                    style={{ color: '#e74c3c', borderColor: '#e74c3c' }}
                    onClick={() => handleFacturaPdf(detail.VENTA_ID)}
                  />
                </Tooltip>
              )}
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
        {detailError ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Text type="danger">Error al cargar la venta: {(detailError as any)?.response?.data?.error || (detailError as Error).message}</Text>
          </div>
        ) : detail ? (
          <>
            <Descriptions column={2} bordered size="middle" style={{ marginBottom: 24 }}>
              <Descriptions.Item label="Fecha">
                {new Date(detail.FECHA_VENTA).toLocaleDateString('es-AR')}
              </Descriptions.Item>
              <Descriptions.Item label="Cliente">{detail.CLIENTE_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Vendedor">{detail.USUARIO_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Comprobante">{detail.TIPO_COMPROBANTE || '-'}</Descriptions.Item>
              <Descriptions.Item label="Nro. Fiscal">{detail.NUMERO_FISCAL || 'Sin emitir'}</Descriptions.Item>
              <Descriptions.Item label="CAE">{detail.CAE || '-'}</Descriptions.Item>
              {detail.ERROR_FE === 'S' && (
                <Descriptions.Item label="Error FE" span={2}>
                  <Text type="danger">{detail.ERRORES || 'Error al emitir factura electrónica'}</Text>
                </Descriptions.Item>
              )}
              <Descriptions.Item label="Estado">
                <Tag color={detail.COBRADA ? 'green' : 'orange'}>
                  {detail.COBRADA ? 'Cobrada' : 'Cobro Pendiente'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Cta. Corriente">
                {detail.ES_CTA_CORRIENTE ? <Tag color="blue">Sí</Tag> : 'No'}
              </Descriptions.Item>
              <Descriptions.Item label="Cobrado">
                {detail.metodos_pago && detail.metodos_pago.length > 0 ? (
                  <span
                    style={{ fontWeight: 'bold', color: '#EABD23', cursor: 'pointer' }}
                    onClick={() => setDesgloseModalOpen(true)}
                  >
                    {fmtMoney((detail.MONTO_EFECTIVO ?? 0) + (detail.MONTO_DIGITAL ?? 0))} ▸
                  </span>
                ) : (
                  fmtMoney((detail.MONTO_EFECTIVO ?? 0) + (detail.MONTO_DIGITAL ?? 0))
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Vuelto">
                {fmtMoney(detail.VUELTO)}
              </Descriptions.Item>
              {(detail.DTO_GRAL ?? 0) > 0 && (
                <Descriptions.Item label="Dto. General">
                  {detail.DTO_GRAL}%
                </Descriptions.Item>
              )}
              {((detail.NETO_EXENTO ?? 0) > 0 || (detail.NETO_GRAVADO ?? 0) > 0 || (detail.IVA_TOTAL ?? 0) > 0) && (
                <>
                  {(detail.NETO_GRAVADO ?? 0) > 0 && (
                    <Descriptions.Item label="Neto Gravado">
                      {fmtMoney(detail.NETO_GRAVADO)}
                    </Descriptions.Item>
                  )}
                  {(detail.NETO_EXENTO ?? 0) > 0 && (
                    <Descriptions.Item label="Neto Exento">
                      {fmtMoney(detail.NETO_EXENTO)}
                    </Descriptions.Item>
                  )}
                  {(detail.NETO_NO_GRAVADO ?? 0) > 0 && (
                    <Descriptions.Item label="Neto No Gravado">
                      {fmtMoney(detail.NETO_NO_GRAVADO)}
                    </Descriptions.Item>
                  )}
                  {(detail.IVA_TOTAL ?? 0) > 0 && (
                    <Descriptions.Item label="IVA">
                      {fmtMoney(detail.IVA_TOTAL)}
                    </Descriptions.Item>
                  )}
                </>
              )}
              <Descriptions.Item label="Total" span={2}>
                <span style={{ fontSize: 20, fontWeight: 'bold', color: '#EABD23' }}>
                  {fmtMoney(detail.TOTAL)}
                </span>
              </Descriptions.Item>
              {detail.NRO_ENVIO_DETALLE && (
                <Descriptions.Item label="Enviado por WhatsApp" span={2}>
                  <Space size={4}>
                    <WhatsAppOutlined style={{ color: '#25D366' }} />
                    <Text>{detail.NOMBRE_ENVIO_DETALLE || 'Cliente'}</Text>
                    <Text type="secondary">({detail.NRO_ENVIO_DETALLE})</Text>
                  </Space>
                </Descriptions.Item>
              )}
              {detail.nc_asociadas && detail.nc_asociadas.length > 0 && (
                <Descriptions.Item label="Notas de Crédito">
                  <span
                    style={{ fontWeight: 'bold', color: '#EABD23', cursor: 'pointer' }}
                    onClick={() => setNCModalOpen(true)}
                  >
                    {detail.nc_asociadas.filter(nc => !nc.ANULADA).length} comprobante{detail.nc_asociadas.filter(nc => !nc.ANULADA).length !== 1 ? 's' : ''} ▸
                  </span>
                </Descriptions.Item>
              )}
            </Descriptions>

            {detail.remitos_asociados && detail.remitos_asociados.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <Title level={5} style={{ marginBottom: 12, fontWeight: 700 }}>Remitos asociados</Title>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {detail.remitos_asociados.map((r: any) => (
                    <div
                      key={r.REMITO_ID}
                      onClick={() => {
                        setDrawerOpen(false);
                        setSelectedId(null);
                        openTab({ key: '/remitos', label: 'Remitos', closable: true });
                        navTo('/remitos', { remitoId: r.REMITO_ID });
                        navigate('/remitos');
                      }}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '10px 16px', borderRadius: 8, border: '1px solid #d9d9d9',
                        background: 'rgba(22, 119, 255, 0.04)', cursor: 'pointer',
                        transition: 'border-color 0.2s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = '#1677ff')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = '#d9d9d9')}
                    >
                      <Space>
                        <FileTextOutlined style={{ color: '#1677ff' }} />
                        <Text strong>
                          R {String(r.PTO_VTA).padStart(4, '0')}-{String(r.NRO_REMITO).padStart(8, '0')}
                        </Text>
                        <Text type="secondary">
                          {new Date(r.FECHA).toLocaleDateString('es-AR')}
                        </Text>
                      </Space>
                      <Text strong>{fmtMoney(r.TOTAL)}</Text>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {detail.items && detail.items.length > 0 && (
              <div className="rg-sale-items">
                <Title level={5} style={{ marginBottom: 12, fontWeight: 700 }}>Detalle de productos</Title>
                <Table
                  dataSource={detail.items}
                  rowKey="ITEM_ID"
                  size="middle"
                  pagination={false}
                  columns={[
                    { title: 'Código', dataIndex: 'PRODUCTO_CODIGO', width: 90 , align: 'center' as const },
                    { title: 'Producto', dataIndex: 'PRODUCTO_NOMBRE', ellipsis: true },
                    {
                      title: 'Cant', dataIndex: 'CANTIDAD', width: 65, align: 'center' as const,
                      render: (v: number) => v % 1 === 0 ? v : fmtNum(v),
                    },
                    {
                      title: 'P. Unit', dataIndex: 'PRECIO_UNITARIO', width: 140,
                      align: 'center' as const,
                      render: (v: number) => fmtMoney(v),
                    },
                    {
                      title: 'Dto', dataIndex: 'DESCUENTO', width: 60,
                      align: 'center' as const,
                      render: (v: number) => v > 0 ? `${v}%` : '-',
                    },
                    {
                      title: 'Subtotal', key: 'sub', width: 140, align: 'center' as const,
                      render: (_: unknown, r: any) => (
                        <Text strong>{fmtMoney(r.PRECIO_UNITARIO_DTO * r.CANTIDAD)}</Text>
                      ),
                    },
                  ]}
                  summary={() => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={5}>
                        <Text strong style={{marginLeft: 13}}>Total</Text>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="center">
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
        ) : (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
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

      {/* ── NC Venta Modal ─────────────────────── */}
      <NewNCVentaModal
        open={ncVentaOpen}
        onClose={() => { setNCVentaOpen(false); setNCVentaPreselected({}); }}
        onSuccess={() => { setNCVentaOpen(false); setNCVentaPreselected({}); queryClient.invalidateQueries({ queryKey: ['ventas'] }); }}
        preselectedVentaId={ncVentaPreselected.ventaId}
        preselectedClienteId={ncVentaPreselected.clienteId}
        utilizaFE={utilizaFE}
      />

      {/* ── WhatsApp Resend Modal ───────────────── */}
      <Modal
        open={wspModalOpen}
        title={
          <Space>
            <WhatsAppOutlined style={{ color: '#25D366', fontSize: 20 }} />
            <span>Enviar detalle por WhatsApp</span>
          </Space>
        }
        onCancel={() => setWspModalOpen(false)}
        footer={null}
        centered
        width={420}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Nombre del cliente</Text>
            <Input
              value={wspNombre}
              onChange={e => setWspNombre(e.target.value)}
              placeholder="Nombre"
              prefix={<UserOutlined />}
            />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 4 }}>Teléfono (con código de área)</Text>
            <Input
              value={wspTelefono}
              onChange={e => setWspTelefono(e.target.value)}
              placeholder="Ej: 3415551234"
              prefix={<span style={{ color: '#999' }}>+54</span>}
              onPressEnter={handleSendWhatsApp}
            />
            <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
              Ingrese el número sin 0 ni 15. Mínimo 10 dígitos.
            </Text>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <Button onClick={() => setWspModalOpen(false)} disabled={wspSending}>
              Cancelar
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleSendWhatsApp}
              loading={wspSending}
              style={{ background: '#25D366', borderColor: '#25D366' }}
            >
              Enviar
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── NC Asociadas Modal ──────────── */}
      <Modal
        open={ncModalOpen}
        onCancel={() => setNCModalOpen(false)}
        footer={<Button onClick={() => setNCModalOpen(false)}>Cerrar</Button>}
        title={<><FileExclamationOutlined style={{ marginRight: 8 }} />Notas de Crédito asociadas</>}
        width={520}
        destroyOnClose
      >
        {detail?.nc_asociadas && detail.nc_asociadas.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            {detail.nc_asociadas.map((nc: any) => (
              <div
                key={nc.NC_ID}
                onClick={() => {
                  setNCModalOpen(false);
                  setDrawerOpen(false);
                  setSelectedId(null);
                  openTab({ key: '/nc-ventas', label: 'NC Ventas', closable: true });
                  navTo('/nc-ventas', { ncId: nc.NC_ID });
                  navigate('/nc-ventas');
                }}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 16px', borderRadius: 8, border: '1px solid #d9d9d9',
                  background: nc.ANULADA ? 'rgba(255, 77, 79, 0.04)' : 'rgba(234,189,35,0.06)',
                  cursor: 'pointer', opacity: nc.ANULADA ? 0.5 : 1,
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#EABD23')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#d9d9d9')}
              >
                <Space>
                  <FileExclamationOutlined style={{ color: nc.ANULADA ? '#ff4d4f' : '#EABD23' }} />
                  <div>
                    <Text strong>
                      NC #{nc.NC_ID}
                      {nc.NUMERO_FISCAL ? ` — ${nc.PUNTO_VENTA_FISCAL || ''}-${nc.NUMERO_FISCAL}` : ''}
                    </Text>
                    <br />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {nc.MOTIVO} · {new Date(nc.FECHA).toLocaleDateString('es-AR')}
                      {nc.ANULADA && <Tag color="red" style={{ marginLeft: 6, fontSize: 10 }}>Anulada</Tag>}
                    </Text>
                  </div>
                </Space>
                <Text strong style={{ color: nc.ANULADA ? '#ff4d4f' : '#EABD23' }}>
                  -{fmtMoney(nc.MONTO)}
                </Text>
              </div>
            ))}
          </div>
        ) : (
          <Text type="secondary">No hay notas de crédito asociadas.</Text>
        )}
      </Modal>

      {/* ── Desglose Métodos de Pago Modal ──── */}
      <Modal
        open={desgloseModalOpen}
        onCancel={() => setDesgloseModalOpen(false)}
        footer={<Button onClick={() => setDesgloseModalOpen(false)}>Cerrar</Button>}
        title="Desglose por método de pago"
        width={480}
        destroyOnClose
      >
        {!detail?.metodos_pago || detail.metodos_pago.length === 0 ? (
          <Text type="secondary">No hay métodos de pago registrados.</Text>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
            {detail.metodos_pago.map(d => (
              <div key={d.METODO_PAGO_ID} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8,
                background: d.CATEGORIA === 'EFECTIVO' ? 'rgba(82,196,26,0.06)' : 'rgba(22,119,255,0.06)',
                border: `1px solid ${d.CATEGORIA === 'EFECTIVO' ? '#b7eb8f' : '#91caff'}`,
              }}>
                <Space>
                  {d.IMAGEN_BASE64 ? (
                    <img src={d.IMAGEN_BASE64} alt={d.NOMBRE} style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4 }} />
                  ) : null}
                  <div>
                    <Text strong>{d.NOMBRE}</Text>
                    <br />
                    <Tag color={d.CATEGORIA === 'EFECTIVO' ? 'green' : 'blue'} style={{ fontSize: 10 }}>
                      {d.CATEGORIA}
                    </Tag>
                  </div>
                </Space>
                <Text strong style={{ fontSize: 16 }}>{fmtMoney(d.TOTAL)}</Text>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
