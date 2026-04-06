import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Table, Typography, Tag, Space, Button, Select, Drawer, Spin,
  Descriptions, Empty, Tooltip, message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  EyeOutlined, PrinterOutlined, DollarOutlined, ReloadOutlined,
  UserOutlined, ShoppingCartOutlined, LinkOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import * as mesasApi from '../services/mesas.api';
import { useAuthStore } from '../store/authStore';
import { useTabStore } from '../store/tabStore';
import { useNavigationStore } from '../store/navigationStore';
import { fmtMoney } from '../utils/format';
import { DateFilterPopover, type DatePreset } from '../components/DateFilterPopover';
import { NewSaleModal } from '../components/sales/NewSaleModal';
import type { PedidoParaVenta } from '../components/sales/NewSaleModal';
import type { ComandaListItem, PedidoItem } from '../types';

const { Title, Text } = Typography;

export function ListadoComandasPage() {
  const { puntoVentaActivo } = useAuthStore();
  const { openTab } = useTabStore();
  const navTo = useNavigationStore(s => s.navigate);

  // ── Filters ──
  const [datePreset, setDatePreset] = useState<DatePreset>('hoy');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(dayjs().format('YYYY-MM-DD'));
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(dayjs().format('YYYY-MM-DD'));
  const [filtroEstado, setFiltroEstado] = useState<string>('TODOS');

  // ── Detail drawer ──
  const [detallePedidoId, setDetallePedidoId] = useState<number | null>(null);

  // ── Sale modal ──
  const [pasarVentaModal, setPasarVentaModal] = useState<PedidoParaVenta | null>(null);

  // ── Computed date params ──
  const fechaDesdeParam = fechaDesde || dayjs().format('YYYY-MM-DD');
  const fechaHastaParam = fechaHasta || dayjs().format('YYYY-MM-DD');
  // Add end-of-day to fechaHasta so queries include the full day
  const fechaHastaEOD = dayjs(fechaHastaParam).endOf('day').format('YYYY-MM-DDTHH:mm:ss');

  const { data: comandas = [], isLoading, refetch } = useQuery({
    queryKey: ['listado-comandas', puntoVentaActivo, fechaDesdeParam, fechaHastaParam, filtroEstado],
    queryFn: () => mesasApi.getListadoComandas({
      puntoVentaId: puntoVentaActivo!,
      fechaDesde: fechaDesdeParam,
      fechaHasta: fechaHastaEOD,
      estado: filtroEstado !== 'TODOS' ? filtroEstado : undefined,
    }),
    enabled: !!puntoVentaActivo,
  });

  // ── Detail query ──
  const { data: pedidoDetalle, isLoading: loadingDetalle } = useQuery({
    queryKey: ['pedido-detalle', detallePedidoId],
    queryFn: () => mesasApi.getPedidoById(detallePedidoId!),
    enabled: !!detallePedidoId,
  });

  // ── Actions ──
  const handleVerDetalle = (pedidoId: number) => setDetallePedidoId(pedidoId);

  const handlePrint = async (pedidoId: number) => {
    try {
      const data = await mesasApi.getComandaData(pedidoId);
      if (!data) { message.error('No se encontraron datos'); return; }
      const itemsHtml = (data.items || []).map((item: any) =>
        `<tr>
          <td style="padding:2px 0">${item.NOMBRE}</td>
          <td style="text-align:center;padding:2px 2px;font-weight:bold">${item.CANTIDAD}</td>
        </tr>`
      ).join('');
      const html = `<!DOCTYPE html><html><head><title>Comanda #${pedidoId}</title>
        <style>
          @page{size:80mm auto;margin:0}
          *{margin:0;padding:0;box-sizing:border-box}
          body{font-family:'Lucida Console','Courier New',monospace;padding:3mm;width:80mm;font-size:11px;line-height:1.2}
          table{width:100%;border-collapse:collapse}
          th,td{font-size:11px}
        </style></head><body>
        ${data.NOMBRE_FANTASIA ? `<div style="text-align:center;font-weight:bold;font-size:14px;margin-bottom:1px;text-transform:uppercase">${data.NOMBRE_FANTASIA}</div>` : ''}
        <div style="text-align:center;font-weight:bold;font-size:12px;margin-bottom:2px">COMANDA</div>
        <div style="text-align:center;font-size:10px;margin-bottom:1px">Mesa: ${data.MESA} | Sector: ${data.SECTOR}</div>
        <div style="text-align:center;font-size:10px;margin-bottom:1px">Mozo: ${data.MOZO}</div>
        <div style="text-align:center;font-size:10px;margin-bottom:4px">${dayjs(data.FECHA).format('DD/MM/YYYY HH:mm')}</div>
        <hr style="border:none;border-top:1px dashed #000;margin:2px 0">
        <table style="margin-top:3px">
          <thead><tr style="border-bottom:1px solid #000">
            <th style="text-align:left;padding:2px 0">Producto</th>
            <th style="text-align:center;width:50px;padding:2px 0">Cant.</th>
          </tr></thead>
          <tbody>${itemsHtml}</tbody>
        </table>
        <hr style="border:none;border-top:1px dashed #000;margin:6px 0 2px 0">
        <div style="text-align:center;font-size:8px;color:#555">Río Gestión Software</div>
        </body></html>`;
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;visibility:hidden';
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc || !iframe.contentWindow) { message.error('Error de impresión'); document.body.removeChild(iframe); return; }
      doc.open(); doc.write(html); doc.close();
      iframe.contentWindow.onafterprint = () => { document.body.removeChild(iframe); };
      setTimeout(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => { if (iframe.parentNode) document.body.removeChild(iframe); }, 60000);
      }, 200);
    } catch { message.error('Error al imprimir comanda'); }
  };

  const handleFacturar = async (pedidoId: number) => {
    try {
      const pedido = await mesasApi.getPedidoById(pedidoId);
      if (!pedido) { message.error('No se encontró el pedido'); return; }
      setPasarVentaModal({
        PEDIDO_ID: pedido.PEDIDO_ID,
        MESA_ID: pedido.MESA_ID ?? 0,
        items: (pedido.items || []).map((i: PedidoItem) => ({
          PRODUCTO_ID: i.PRODUCTO_ID || 0,
          NOMBRE: i.PRODUCTO_NOMBRE || `Producto #${i.PRODUCTO_ID}`,
          CODIGO: i.PRODUCTO_CODIGO || '',
          CANTIDAD: i.CANTIDAD,
          PRECIO_UNITARIO: i.PRECIO_UNITARIO,
          LISTA_PRECIO_SELECCIONADA: i.LISTA_PRECIO_SELECCIONADA,
        })),
      });
    } catch { message.error('Error al cargar pedido'); }
  };

  // ── Stats ──
  const totalComandas = comandas.length;
  const totalMonto = comandas.reduce((acc, c) => acc + (c.TOTAL || 0), 0);
  const abiertas = comandas.filter(c => c.ESTADO === 'ABIERTO' || c.ESTADO === 'EN_PREPARACION').length;
  const cerradas = comandas.filter(c => c.ESTADO === 'CERRADO').length;

  // ── Table columns ──
  const columns: ColumnsType<ComandaListItem> = [
    {
      title: '#',
      dataIndex: 'PEDIDO_ID',
      width: 70,
      sorter: (a, b) => a.PEDIDO_ID - b.PEDIDO_ID,
      render: (v: number) => <Text strong style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Mesa',
      width: 100,
      render: (_: any, record: ComandaListItem) => (
        <span>
          {record.NUMERO_MESA ? `Mesa ${record.NUMERO_MESA}` : <Text type="secondary">—</Text>}
        </span>
      ),
      sorter: (a, b) => (a.NUMERO_MESA || '').localeCompare(b.NUMERO_MESA || ''),
    },
    {
      title: 'Sector',
      dataIndex: 'SECTOR_NOMBRE',
      width: 130,
      render: (v: string | null) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Estado',
      dataIndex: 'ESTADO',
      width: 120,
      filters: [
        { text: 'Abierto', value: 'ABIERTO' },
        { text: 'En preparación', value: 'EN_PREPARACION' },
        { text: 'Cerrado', value: 'CERRADO' },
      ],
      onFilter: (value, record) => record.ESTADO === value,
      render: (v: string) => {
        const map: Record<string, { color: string; label: string }> = {
          ABIERTO: { color: 'green', label: 'Abierto' },
          EN_PREPARACION: { color: 'processing', label: 'En prep.' },
          CERRADO: { color: 'default', label: 'Cerrado' },
        };
        const info = map[v] || { color: 'default', label: v };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: 'Items',
      dataIndex: 'CANT_ITEMS',
      width: 70,
      align: 'center',
      sorter: (a, b) => a.CANT_ITEMS - b.CANT_ITEMS,
      render: (v: number) => <Tag>{v}</Tag>,
    },
    {
      title: 'Total',
      dataIndex: 'TOTAL',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.TOTAL - b.TOTAL,
      render: (v: number) => <Text strong style={{ color: '#b8960e' }}>{fmtMoney(v)}</Text>,
    },
    {
      title: 'Mozo',
      dataIndex: 'MOZO',
      width: 130,
      render: (v: string | null) => v || <Text type="secondary">Sin asignar</Text>,
    },
    {
      title: 'Fecha',
      dataIndex: 'FECHA_CREACION',
      width: 140,
      sorter: (a, b) => dayjs(a.FECHA_CREACION).unix() - dayjs(b.FECHA_CREACION).unix(),
      defaultSortOrder: 'descend',
      render: (v: string) => (
        <Text style={{ fontSize: 12 }}>{dayjs(v).format('DD/MM/YYYY HH:mm')}</Text>
      ),
    },
    {
      title: '',
      width: 130,
      fixed: 'right',
      render: (_: any, record: ComandaListItem) => (
        <Space size={4}>
          <Tooltip title="Ver detalle">
            <Button type="text" size="small" icon={<EyeOutlined />}
              onClick={() => handleVerDetalle(record.PEDIDO_ID)}
              style={{ color: '#666' }}
            />
          </Tooltip>
          <Tooltip title="Imprimir comanda">
            <Button type="text" size="small" icon={<PrinterOutlined />}
              onClick={() => handlePrint(record.PEDIDO_ID)}
              style={{ color: '#666' }}
            />
          </Tooltip>
          {record.ESTADO === 'CERRADO' && (
            record.VENTA_ID ? (
              <Tooltip title="Ir a venta">
                <Button type="text" size="small" icon={<LinkOutlined />}
                  onClick={() => { openTab({ key: '/sales', label: 'Ventas', closable: true }); navTo('/sales', { ventaId: record.VENTA_ID }); }}
                  style={{ color: '#1890ff' }}
                />
              </Tooltip>
            ) : (
              <Tooltip title="Facturar">
                <Button type="text" size="small" icon={<DollarOutlined />}
                  onClick={() => handleFacturar(record.PEDIDO_ID)}
                  style={{ color: '#b8960e' }}
                />
              </Tooltip>
            )
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-enter" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div className="page-header" style={{ padding: '16px 20px 12px', marginBottom: 0, borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
        <Title level={3}>Listado de Comandas</Title>
        <Space wrap>
          <DateFilterPopover
            preset={datePreset}
            fechaDesde={fechaDesde}
            fechaHasta={fechaHasta}
            onPresetChange={(p, d, h) => { setDatePreset(p); setFechaDesde(d); setFechaHasta(h); }}
            onRangeChange={(d, h) => { setDatePreset(undefined as any); setFechaDesde(d); setFechaHasta(h); }}
          />
          <Select
            value={filtroEstado}
            onChange={setFiltroEstado}
            style={{ width: 150 }}
            size="small"
            options={[
              { label: 'Todos los estados', value: 'TODOS' },
              { label: 'Abierto', value: 'ABIERTO' },
              { label: 'En preparación', value: 'EN_PREPARACION' },
              { label: 'Cerrado', value: 'CERRADO' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} size="small">
            Actualizar
          </Button>
        </Space>
      </div>

      {/* ── Stats bar ── */}
      <div style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #f0f0f0', flexShrink: 0, flexWrap: 'wrap' }}>
        <Tag icon={<ShoppingCartOutlined />} style={{ margin: 0, fontSize: 12, padding: '2px 8px' }}>
          {totalComandas} comandas
        </Tag>
        {abiertas > 0 && (
          <Tag color="green" style={{ margin: 0, fontSize: 12, padding: '2px 8px' }}>
            {abiertas} abiertas
          </Tag>
        )}
        {cerradas > 0 && (
          <Tag color="default" style={{ margin: 0, fontSize: 12, padding: '2px 8px' }}>
            {cerradas} cerradas
          </Tag>
        )}
        <Tag color="gold" style={{ margin: 0, fontSize: 12, padding: '2px 8px', fontWeight: 600 }}>
          Total: {fmtMoney(totalMonto)}
        </Tag>
      </div>

      {/* ── Table ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px' }}>
        <Table<ComandaListItem>
          dataSource={comandas}
          columns={columns}
          rowKey="PEDIDO_ID"
          size="small"
          loading={isLoading}
          pagination={{
            pageSize: 25,
            showSizeChanger: true,
            pageSizeOptions: ['15', '25', '50', '100'],
            showTotal: (total) => `${total} registros`,
            size: 'small',
          }}
          scroll={{ x: 1000 }}
          style={{ marginTop: 8 }}
          locale={{ emptyText: <Empty description="Sin comandas en el período seleccionado" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </div>

      {/* ── Detail Drawer ── */}
      <Drawer
        open={!!detallePedidoId}
        onClose={() => setDetallePedidoId(null)}
        title={
          <><EyeOutlined style={{ color: '#EABD23', marginRight: 8 }} />
          Detalle Comanda #{detallePedidoId}</>
        }
        width={520}
        destroyOnHidden
      >
        {loadingDetalle ? <Spin style={{ display: 'block', margin: '40px auto' }} /> :
          !pedidoDetalle ? <Empty description="No se encontró el pedido" /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Descriptions
              size="small"
              column={2}
              bordered
              labelStyle={{ fontWeight: 600, fontSize: 12, background: '#fafafa' }}
              contentStyle={{ fontSize: 12 }}
            >
              <Descriptions.Item label="Pedido #">{pedidoDetalle.PEDIDO_ID}</Descriptions.Item>
              <Descriptions.Item label="Estado">
                <Tag color={
                  pedidoDetalle.ESTADO === 'ABIERTO' ? 'green' :
                  pedidoDetalle.ESTADO === 'EN_PREPARACION' ? 'processing' : 'default'
                }>{pedidoDetalle.ESTADO}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Mesa">
                {pedidoDetalle.MESA_NUMERO ? `Mesa ${pedidoDetalle.MESA_NUMERO}` : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="Mozo">
                <UserOutlined style={{ marginRight: 4 }} />
                {pedidoDetalle.MOZO || 'Sin asignar'}
              </Descriptions.Item>
              <Descriptions.Item label="Apertura">
                {dayjs(pedidoDetalle.FECHA_CREACION).format('DD/MM/YYYY HH:mm')}
              </Descriptions.Item>
              <Descriptions.Item label="Cierre">
                {pedidoDetalle.FECHA_CIERRE
                  ? dayjs(pedidoDetalle.FECHA_CIERRE).format('DD/MM/YYYY HH:mm')
                  : <Text type="secondary">—</Text>}
              </Descriptions.Item>
              <Descriptions.Item label="Total" span={2}>
                <Text strong style={{ color: '#b8960e', fontSize: 16 }}>
                  {fmtMoney(pedidoDetalle.TOTAL)}
                </Text>
              </Descriptions.Item>
            </Descriptions>

            {/* Items table */}
            <div>
              <Text strong style={{ fontSize: 13, marginBottom: 8, display: 'block' }}>
                <ShoppingCartOutlined style={{ marginRight: 6, color: '#EABD23' }} />
                Items del pedido ({pedidoDetalle.items?.length || 0})
              </Text>
              <Table
                dataSource={pedidoDetalle.items || []}
                rowKey="PEDIDO_ITEM_ID"
                size="small"
                pagination={false}
                columns={[
                  {
                    title: 'Producto',
                    dataIndex: 'PRODUCTO_NOMBRE',
                    render: (v: string, record: PedidoItem) => (
                      <div>
                        <Text style={{ fontSize: 12, fontWeight: 500 }}>{v || `#${record.PRODUCTO_ID}`}</Text>
                        {record.PRODUCTO_CODIGO && (
                          <Text style={{ fontSize: 10, color: '#999', marginLeft: 6 }}>{record.PRODUCTO_CODIGO}</Text>
                        )}
                      </div>
                    ),
                  },
                  {
                    title: 'Cant.',
                    dataIndex: 'CANTIDAD',
                    width: 60,
                    align: 'center',
                    render: (v: number) => <Text style={{ fontWeight: 600 }}>{v}</Text>,
                  },
                  {
                    title: 'Precio',
                    dataIndex: 'PRECIO_UNITARIO',
                    width: 90,
                    align: 'right',
                    render: (v: number) => fmtMoney(v),
                  },
                  {
                    title: 'Subtotal',
                    width: 100,
                    align: 'right',
                    render: (_: any, record: PedidoItem) => (
                      <Text strong>{fmtMoney(record.CANTIDAD * record.PRECIO_UNITARIO)}</Text>
                    ),
                  },
                ]}
              />
            </div>

            {/* Actions */}
            <Space style={{ justifyContent: 'flex-end', display: 'flex' }}>
              <Button icon={<PrinterOutlined />}
                onClick={() => { if (detallePedidoId) handlePrint(detallePedidoId); }}>
                Imprimir
              </Button>
              {pedidoDetalle.ESTADO === 'CERRADO' && (
                (() => {
                  const comanda = comandas.find(c => c.PEDIDO_ID === detallePedidoId);
                  return comanda?.VENTA_ID ? (
                    <Button type="primary" icon={<LinkOutlined />}
                      onClick={() => { setDetallePedidoId(null); openTab({ key: '/sales', label: 'Ventas', closable: true }); navTo('/sales', { ventaId: comanda.VENTA_ID }); }}>
                      Ir a venta #{comanda.VENTA_ID}
                    </Button>
                  ) : (
                    <Button type="primary" icon={<DollarOutlined />}
                      style={{ background: '#EABD23', borderColor: '#EABD23', color: '#1E1F22' }}
                      onClick={() => { if (detallePedidoId) { setDetallePedidoId(null); handleFacturar(detallePedidoId); } }}>
                      Facturar
                    </Button>
                  );
                })()
              )}
            </Space>
          </div>
        )}
      </Drawer>

      {/* ── Sale Modal ── */}
      <NewSaleModal
        open={!!pasarVentaModal}
        pedido={pasarVentaModal}
        onClose={() => { setPasarVentaModal(null); refetch(); }}
        onSuccess={() => { setPasarVentaModal(null); refetch(); }}
      />
    </div>
  );
}
