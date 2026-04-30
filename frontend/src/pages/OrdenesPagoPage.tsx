import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Input, Typography, Button, App, Descriptions, Modal,
  Statistic, Card, Row, Col, Tooltip, Popconfirm, Tag,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, ReloadOutlined, DollarOutlined, BankOutlined,
  CreditCardOutlined, PrinterOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  ordenesPagoApi,
  type OrdenPagoGeneralItem,
} from '../services/ordenesPago.api';
import { fmtMoney } from '../utils/format';
import { printOrdenPago } from '../utils/printOrdenPago';
import { NuevaOrdenPagoGeneralModal } from '../components/ordenesPago/NuevaOrdenPagoGeneralModal';
import { useTabStore } from '../store/tabStore';
import { DateFilterPopover, getPresetRange, type DatePreset } from '../components/DateFilterPopover';

const { Title, Text } = Typography;

export function OrdenesPagoPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  // ── Filters ─────────────────────────────────────
  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset | undefined>('mes');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(() => getPresetRange('mes')[0]);
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(() => getPresetRange('mes')[1]);

  // ── Modal state ─────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [editPagoId, setEditPagoId] = useState<number | null>(null);
  const [editProveedorId, setEditProveedorId] = useState<number | undefined>();
  const [editCtaCorrienteId, setEditCtaCorrienteId] = useState<number | undefined>();
  const [editProveedorNombre, setEditProveedorNombre] = useState<string | undefined>();
  const [detalleOrdenPago, setDetalleOrdenPago] = useState<OrdenPagoGeneralItem | null>(null);
  const [desgloseModalOpen, setDesgloseModalOpen] = useState(false);
  const [desgloseFilter, setDesgloseFilter] = useState<'EFECTIVO' | 'DIGITAL' | null>(null);

  // ── Queries ─────────────────────────────────────
  const { data: ordenesPago, isLoading } = useQuery({
    queryKey: ['ordenes-pago-general', fechaDesde, fechaHasta, search],
    queryFn: () => ordenesPagoApi.getAll(fechaDesde, fechaHasta, search || undefined),
  });

  const { data: metodosTotales } = useQuery({
    queryKey: ['ordenes-pago-metodos-totales', fechaDesde, fechaHasta, search],
    queryFn: () => ordenesPagoApi.getMetodosTotales(fechaDesde, fechaHasta, search || undefined),
  });

  // ── Mutations ───────────────────────────────────
  const eliminarMut = useMutation({
    mutationFn: (pagoId: number) => ordenesPagoApi.eliminarOrdenPago(pagoId),
    onSuccess: () => {
      message.success('Orden de pago eliminada');
      qc.invalidateQueries({ queryKey: ['ordenes-pago-general'] });
      qc.invalidateQueries({ queryKey: ['ctaProv-ordenes-pago'] });
      qc.invalidateQueries({ queryKey: ['ctaProv-movimientos'] });
      qc.invalidateQueries({ queryKey: ['cta-corriente-prov-list'] });
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  // ── Handlers ────────────────────────────────────
  const handleNew = () => {
    setEditPagoId(null);
    setEditProveedorId(undefined);
    setEditCtaCorrienteId(undefined);
    setEditProveedorNombre(undefined);
    setModalOpen(true);
  };
  useEffect(() => {
    const handler = () => { if (useTabStore.getState().activeKey === '/ordenes-pago') handleNew(); };
    window.addEventListener('rg:nuevo', handler);
    return () => window.removeEventListener('rg:nuevo', handler);
  }, []);
  const handleEdit = (record: OrdenPagoGeneralItem) => {
    setEditPagoId(record.PAGO_ID);
    setEditProveedorId(record.PROVEEDOR_ID);
    setEditCtaCorrienteId(record.CTA_CORRIENTE_ID);
    setEditProveedorNombre(record.PROVEEDOR_NOMBRE);
    setModalOpen(true);
  };

  const handleSuccess = () => {
    setModalOpen(false);
    setEditPagoId(null);
    qc.invalidateQueries({ queryKey: ['ordenes-pago-general'] });
    qc.invalidateQueries({ queryKey: ['ctaProv-ordenes-pago'] });
    qc.invalidateQueries({ queryKey: ['ctaProv-movimientos'] });
    qc.invalidateQueries({ queryKey: ['cta-corriente-prov-list'] });
  };

  const handlePrint = async (pagoId: number) => {
    try {
      const data = await ordenesPagoApi.getReciboData(pagoId);
      await printOrdenPago(data);
    } catch {
      message.error('No se pudo generar la orden de pago');
    }
  };

  // ── Statistics ──────────────────────────────────
  const stats = useMemo(() => {
    if (!ordenesPago) return { cantidad: 0, totalPagado: 0, totalEfectivo: 0, totalDigital: 0 };
    return {
      cantidad: ordenesPago.length,
      totalPagado: ordenesPago.reduce((s, c) => s + c.TOTAL, 0),
      totalEfectivo: ordenesPago.reduce((s, c) => s + c.EFECTIVO, 0),
      totalDigital: ordenesPago.reduce((s, c) => s + c.DIGITAL, 0),
    };
  }, [ordenesPago]);

  // ── Table columns ───────────────────────────────
  const columns: TableColumnType<OrdenPagoGeneralItem>[] = [
    {
      title: 'Fecha', dataIndex: 'FECHA', width: 155, align: 'center',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'),
      sorter: (a, b) => dayjs(a.FECHA).unix() - dayjs(b.FECHA).unix(),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Proveedor', dataIndex: 'PROVEEDOR_NOMBRE', ellipsis: true,
      sorter: (a, b) => a.PROVEEDOR_NOMBRE.localeCompare(b.PROVEEDOR_NOMBRE),
    },
    {
      title: 'Concepto', dataIndex: 'CONCEPTO', ellipsis: true,
    },
    {
      title: 'Usuario', dataIndex: 'USUARIO', width: 150, align: 'center',
      responsive: ['lg'],
    },
    {
      title: 'Total', dataIndex: 'TOTAL', width: 130, align: 'center',
      render: (_: number, record: OrdenPagoGeneralItem) => (
        <Button
          type="link" size="small" style={{ padding: 0, fontWeight: 600 }}
          onClick={() => setDetalleOrdenPago(record)}
        >
          {fmtMoney(record.TOTAL)} <EyeOutlined style={{ fontSize: 12, marginLeft: 4 }} />
        </Button>
      ),
      sorter: (a, b) => a.TOTAL - b.TOTAL,
    },
    {
      title: '', width: 110, align: 'center',
      render: (_: any, record: OrdenPagoGeneralItem) => (
        <Space size={4}>
          <Tooltip title="Imprimir Orden de Pago">
            <Button
              type="text" size="small"
              icon={<PrinterOutlined />}
              onClick={() => handlePrint(record.PAGO_ID)}
            />
          </Tooltip>
          <Tooltip title="Editar">
            <Button
              type="text" size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="¿Eliminar esta orden de pago?"
            description="Se revertirán las imputaciones asociadas."
            onConfirm={() => eliminarMut.mutate(record.PAGO_ID)}
            okText="Sí, eliminar"
            cancelText="No"
          >
            <Tooltip title="Eliminar">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Render ──────────────────────────────────────
  return (
    <div className="page-enter">
      {/* Header */}
      <div className="page-header">
        <Title level={3}>Órdenes de Pago</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['ordenes-pago-general'] })}>
            Actualizar
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
            Nueva Orden de Pago
          </Button>
        </Space>
      </div>

      {/* Stats */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic title="Cantidad" value={stats.cantidad} prefix={<BankOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Total pagado"
              value={stats.totalPagado}
              precision={2} prefix="$"
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card" hoverable style={{ cursor: 'pointer' }}
            onClick={() => { setDesgloseFilter('EFECTIVO'); setDesgloseModalOpen(true); }}>
            <Statistic
              title="Efectivo"
              value={stats.totalEfectivo}
              precision={2} prefix={<DollarOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card" hoverable style={{ cursor: 'pointer' }}
            onClick={() => { setDesgloseFilter('DIGITAL'); setDesgloseModalOpen(true); }}>
            <Statistic
              title="Digital"
              value={stats.totalDigital}
              precision={2} prefix={<CreditCardOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
      </Row>

      {/* Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <DateFilterPopover
          preset={datePreset}
          fechaDesde={fechaDesde}
          fechaHasta={fechaHasta}
          onPresetChange={(p, d, h) => { setDatePreset(p); setFechaDesde(d); setFechaHasta(h); }}
          onRangeChange={(d, h) => { setDatePreset(undefined); setFechaDesde(d); setFechaHasta(h); }}
        />
        <Input
          placeholder="Buscar por proveedor..."
          prefix={<SearchOutlined />}
          allowClear
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 280 }}
          size="small"
        />
      </div>

      {/* Main table */}
      <Table<OrdenPagoGeneralItem>
        className="rg-table"
        rowKey="PAGO_ID"
        columns={columns}
        dataSource={ordenesPago}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 25, showSizeChanger: true, showTotal: t => `${t} órdenes de pago` }}
      />

      {/* Detalle Orden de Pago Modal */}
      <DetalleOrdenPagoModal
        detalleOrdenPago={detalleOrdenPago}
        onClose={() => setDetalleOrdenPago(null)}
      />

      {/* Desglose modal */}
      <Modal
        open={desgloseModalOpen}
        onCancel={() => setDesgloseModalOpen(false)}
        footer={<Button onClick={() => setDesgloseModalOpen(false)}>Cerrar</Button>}
        title={`Desglose por método de pago — ${desgloseFilter === 'EFECTIVO' ? 'Efectivo' : 'Digital'}`}
        width={480}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        {(() => {
          const items = (metodosTotales || []).filter(m =>
            desgloseFilter === 'EFECTIVO' ? m.CATEGORIA === 'EFECTIVO' : m.CATEGORIA !== 'EFECTIVO'
          );
          if (!items.length) {
            return <Text type="secondary">No hay métodos de pago registrados para este período.</Text>;
          }
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
              {items.map((d, idx) => (
                <div key={idx} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', borderRadius: 8,
                  background: d.CATEGORIA === 'EFECTIVO' ? 'rgba(82,196,26,0.06)' : 'rgba(22,119,255,0.06)',
                  border: `1px solid ${d.CATEGORIA === 'EFECTIVO' ? '#b7eb8f' : '#91caff'}`,
                }}>
                  <Space>
                    {d.IMAGEN_BASE64 ? (
                      <img src={d.IMAGEN_BASE64} alt={d.METODO_NOMBRE}
                        style={{ width: 28, height: 28, objectFit: 'contain', borderRadius: 4 }} />
                    ) : null}
                    <div>
                      <Text strong>{d.METODO_NOMBRE}</Text>
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
          );
        })()}
      </Modal>

      <NuevaOrdenPagoGeneralModal
        open={modalOpen}
        pagoId={editPagoId}
        editProveedorId={editProveedorId}
        editCtaCorrienteId={editCtaCorrienteId}
        editProveedorNombre={editProveedorNombre}
        onSuccess={handleSuccess}
        onCancel={() => {
          setModalOpen(false);
          setEditPagoId(null);
        }}
      />
    </div>
  );
}

// ── Detalle Orden de Pago sub-component ──────────
function DetalleOrdenPagoModal({ detalleOrdenPago, onClose }: {
  detalleOrdenPago: OrdenPagoGeneralItem | null;
  onClose: () => void;
}) {
  const { data: detalle } = useQuery({
    queryKey: ['orden-pago-detalle', detalleOrdenPago?.PAGO_ID],
    queryFn: () => ordenesPagoApi.getOrdenPagoById(detalleOrdenPago!.PAGO_ID),
    enabled: !!detalleOrdenPago,
  });

  const { data: metodosPago = [] } = useQuery({
    queryKey: ['op-active-payment-methods'],
    queryFn: () => ordenesPagoApi.getActivePaymentMethods(),
    enabled: !!detalleOrdenPago,
    staleTime: 60000,
  });

  return (
    <Modal
      title="Detalle de Orden de Pago"
      open={!!detalleOrdenPago}
      onCancel={onClose}
      footer={
        detalleOrdenPago ? (
          <Button
            icon={<PrinterOutlined />}
            onClick={async () => {
              try {
                const data = await ordenesPagoApi.getReciboData(detalleOrdenPago.PAGO_ID);
                await printOrdenPago(data);
              } catch {
                // silently ignore
              }
            }}
          >
            Imprimir Orden de Pago
          </Button>
        ) : null
      }
      width={420}
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
    >
      {detalleOrdenPago && (
        <>
          <Descriptions column={1} bordered size="small" style={{ marginTop: 12 }}>
            <Descriptions.Item label="Fecha">
              {dayjs(detalleOrdenPago.FECHA).format('DD/MM/YYYY HH:mm')}
            </Descriptions.Item>
            <Descriptions.Item label="Proveedor">
              {detalleOrdenPago.PROVEEDOR_NOMBRE}
            </Descriptions.Item>
            <Descriptions.Item label="Concepto">
              {detalleOrdenPago.CONCEPTO || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Usuario">
              {detalleOrdenPago.USUARIO}
            </Descriptions.Item>
          </Descriptions>

          {/* Payment method breakdown */}
          {detalle?.metodos_pago && detalle.metodos_pago.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
                Desglose por método de pago
              </Text>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {detalle.metodos_pago.map((mp, idx) => {
                  const m = metodosPago.find(x => x.METODO_PAGO_ID === mp.METODO_PAGO_ID);
                  return (
                    <div key={idx} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '6px 12px', background: '#fafafa', borderRadius: 6,
                    }}>
                      <Space size={8}>
                        {m?.IMAGEN_BASE64 ? (
                          <img src={m.IMAGEN_BASE64} alt={m.NOMBRE} style={{ width: 20, height: 20, objectFit: 'contain', borderRadius: 3 }} />
                        ) : m?.CATEGORIA === 'EFECTIVO' ? (
                          <DollarOutlined style={{ color: '#52c41a' }} />
                        ) : (
                          <CreditCardOutlined style={{ color: '#1890ff' }} />
                        )}
                        <Text>{m?.NOMBRE || `Método #${mp.METODO_PAGO_ID}`}</Text>
                      </Space>
                      <Text strong>{fmtMoney(mp.MONTO)}</Text>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <Descriptions column={1} bordered size="small" style={{ marginTop: 12 }}>
              <Descriptions.Item label="Efectivo">
                {fmtMoney(detalleOrdenPago.EFECTIVO)}
              </Descriptions.Item>
              <Descriptions.Item label="Digital">
                {fmtMoney(detalleOrdenPago.DIGITAL)}
              </Descriptions.Item>
              {detalleOrdenPago.CHEQUES > 0 && (
                <Descriptions.Item label="Cheques">
                  {fmtMoney(detalleOrdenPago.CHEQUES)}
                </Descriptions.Item>
              )}
            </Descriptions>
          )}

          <div style={{
            marginTop: 12, background: '#f5f5f5', borderRadius: 8, padding: '10px 16px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <Text strong style={{ fontSize: 15 }}>Total:</Text>
            <Text strong style={{ fontSize: 18, color: '#cf1322' }}>
              {fmtMoney(detalleOrdenPago.TOTAL)}
            </Text>
          </div>
        </>
      )}
    </Modal>
  );
}
