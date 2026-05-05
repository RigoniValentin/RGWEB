import { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Input, Typography, Button, App, Descriptions, Modal,
  Statistic, Card, Row, Col, Tooltip, Popconfirm, Tag,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  SearchOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  EyeOutlined, ReloadOutlined, DollarOutlined, CreditCardOutlined,
  WalletOutlined, BankOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { expensesApi, type GastoServicioItem } from '../services/expenses.api';
import { catalogApi } from '../services/catalog.api';
import { fmtMoney } from '../utils/format';
import { NuevoGastoModal } from '../components/expenses/NuevoGastoModal';
import { useTabStore } from '../store/tabStore';
import { useAuthStore } from '../store/authStore';
import { DateFilterPopover, getPresetRange, type DatePreset } from '../components/DateFilterPopover';
import { PuntoVentaFilter } from '../components/PuntoVentaFilter';

const { Title, Text } = Typography;

export function ExpensesPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const openTab = useTabStore(s => s.openTab);
  const { puntoVentaActivo } = useAuthStore();

  // ── Filters ─────────────────────────────────────
  const [search, setSearch] = useState('');
  const [datePreset, setDatePreset] = useState<DatePreset | undefined>('mes');
  const [fechaDesde, setFechaDesde] = useState<string | undefined>(() => getPresetRange('mes')[0]);
  const [fechaHasta, setFechaHasta] = useState<string | undefined>(() => getPresetRange('mes')[1]);
  const [pvFilter, setPvFilter] = useState<number | undefined>(() => puntoVentaActivo ?? undefined);
  const pvIdsParam = pvFilter ? String(pvFilter) : undefined;

  // Catalog of all PVs for the filter (so a user assigned to multiple sees all of theirs)
  const { data: allPuntosVenta } = useQuery({
    queryKey: ['catalog-puntos-venta'],
    queryFn: () => catalogApi.getPuntosVenta(),
    staleTime: 5 * 60 * 1000,
  });

  // ── Modal state ─────────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [editGastoId, setEditGastoId] = useState<number | null>(null);
  const [detalleGasto, setDetalleGasto] = useState<GastoServicioItem | null>(null);
  const [desgloseModalOpen, setDesgloseModalOpen] = useState(false);
  const [desgloseFilter, setDesgloseFilter] = useState<'EFECTIVO' | 'DIGITAL' | null>(null);

  // ── Queries ─────────────────────────────────────
  const { data: gastos, isLoading } = useQuery({
    queryKey: ['expenses', fechaDesde, fechaHasta, search, pvIdsParam],
    queryFn: () => expensesApi.getAll(fechaDesde, fechaHasta, search || undefined, pvIdsParam),
  });

  const { data: metodosTotales } = useQuery({
    queryKey: ['expenses-metodos-totales', fechaDesde, fechaHasta, search, pvIdsParam],
    queryFn: () => expensesApi.getMetodosTotales(fechaDesde, fechaHasta, search || undefined, pvIdsParam),
  });

  // ── Mutations ───────────────────────────────────
  const eliminarMut = useMutation({
    mutationFn: (gastoId: number) => expensesApi.eliminar(gastoId),
    onSuccess: () => {
      message.success('Gasto eliminado');
      qc.invalidateQueries({ queryKey: ['expenses'] });
      qc.invalidateQueries({ queryKey: ['expenses-metodos-totales'] });
      qc.invalidateQueries({ queryKey: ['caja-central-mov'] });
      qc.invalidateQueries({ queryKey: ['caja-central-totales'] });
    },
    onError: (err: any) => message.error(err.response?.data?.error || err.message),
  });

  // ── Handlers ────────────────────────────────────
  const handleNew = () => {
    setEditGastoId(null);
    setModalOpen(true);
  };
  useEffect(() => {
    const handler = () => { if (useTabStore.getState().activeKey === '/expenses') handleNew(); };
    window.addEventListener('rg:nuevo', handler);
    return () => window.removeEventListener('rg:nuevo', handler);
  }, []);

  // Cross-nav: open detail from Caja Central
  useEffect(() => {
    const st = location.state as { openGastoId?: number } | null;
    if (st?.openGastoId && gastos) {
      const found = gastos.find(g => g.GASTO_ID === st.openGastoId);
      if (found) setDetalleGasto(found);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, gastos, navigate, location.pathname]);

  const handleEdit = (record: GastoServicioItem) => {
    setEditGastoId(record.GASTO_ID);
    setModalOpen(true);
  };

  const handleSuccess = () => {
    setModalOpen(false);
    setEditGastoId(null);
    qc.invalidateQueries({ queryKey: ['expenses'] });
    qc.invalidateQueries({ queryKey: ['expenses-metodos-totales'] });
    qc.invalidateQueries({ queryKey: ['caja-central-mov'] });
    qc.invalidateQueries({ queryKey: ['caja-central-totales'] });
  };

  // ── Statistics ──────────────────────────────────
  const stats = useMemo(() => {
    if (!gastos) return { cantidad: 0, totalGastado: 0, totalEfectivo: 0, totalDigital: 0 };
    return {
      cantidad: gastos.length,
      totalGastado: gastos.reduce((s, c) => s + c.MONTO, 0),
      totalEfectivo: gastos.reduce((s, c) => s + c.EFECTIVO, 0),
      totalDigital: gastos.reduce((s, c) => s + c.DIGITAL, 0),
    };
  }, [gastos]);

  // ── Table columns ───────────────────────────────
  const columns: TableColumnType<GastoServicioItem>[] = [
    {
      title: 'Fecha', dataIndex: 'FECHA', width: 155, align: 'center',
      render: (v: string) => dayjs(v).format('DD/MM/YYYY HH:mm'),
      sorter: (a, b) => dayjs(a.FECHA).unix() - dayjs(b.FECHA).unix(),
      defaultSortOrder: 'descend',
    },
    {
      title: 'Entidad', dataIndex: 'ENTIDAD', ellipsis: true,
      sorter: (a, b) => a.ENTIDAD.localeCompare(b.ENTIDAD),
    },
    {
      title: 'Categoría', dataIndex: 'CATEGORIA', width: 140, ellipsis: true,
      render: (v: string | null) => v ? <Tag color="geekblue">{v}</Tag> : '-',
    },
    {
      title: 'Descripción', dataIndex: 'DESCRIPCION', ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'Usuario', dataIndex: 'USUARIO_NOMBRE', width: 160, align: 'center',
      responsive: ['lg'],
      render: (v: string | null) => v || '-',
    },
    {
      title: 'Total', dataIndex: 'MONTO', width: 160, align: 'center',
      render: (_: number, record: GastoServicioItem) => (
        <Button
          type="link" size="small" style={{ padding: 0, fontWeight: 600 }}
          onClick={() => setDetalleGasto(record)}
        >
          {fmtMoney(record.MONTO)} <EyeOutlined style={{ fontSize: 12, marginLeft: 4 }} />
        </Button>
      ),
      sorter: (a, b) => a.MONTO - b.MONTO,
    },
    {
      title: '', width: 110, align: 'center',
      render: (_: any, record: GastoServicioItem) => (
        <Space size={4}>
          {record.MOVIMIENTO_CAJA_ID && (
            <Tooltip title={`Ver en Caja Central (Mov. #${record.MOVIMIENTO_CAJA_ID})`}>
              <Button
                type="text" size="small"
                icon={<BankOutlined />}
                onClick={() => {
                  openTab({ key: '/cashcentral', label: 'Caja Central', closable: true });
                  navigate('/cashcentral', { state: { highlightMovId: record.MOVIMIENTO_CAJA_ID } });
                }}
              />
            </Tooltip>
          )}
          <Tooltip title="Editar">
            <Button
              type="text" size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="¿Eliminar este gasto?"
            description="Se eliminará también el egreso en Caja Central."
            onConfirm={() => eliminarMut.mutate(record.GASTO_ID)}
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

  return (
    <div className="page-enter">
      <div className="page-header">
        <Title level={3}>Gastos y Servicios</Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={() => {
            qc.invalidateQueries({ queryKey: ['expenses'] });
            qc.invalidateQueries({ queryKey: ['expenses-metodos-totales'] });
          }}>
            Actualizar
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>
            Nuevo Gasto
          </Button>
        </Space>
      </div>

      {/* Stats */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic title="Cantidad" value={stats.cantidad} prefix={<WalletOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Total gastado"
              value={stats.totalGastado}
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
        <Space size={8} wrap>
          <DateFilterPopover
            preset={datePreset}
            fechaDesde={fechaDesde}
            fechaHasta={fechaHasta}
            onPresetChange={(p, d, h) => { setDatePreset(p); setFechaDesde(d); setFechaHasta(h); }}
            onRangeChange={(d, h) => { setDatePreset(undefined); setFechaDesde(d); setFechaHasta(h); }}
          />
          <PuntoVentaFilter
            value={pvFilter}
            onChange={setPvFilter}
            overridePuntosVenta={allPuntosVenta}
          />
        </Space>
        <Input
          placeholder="Buscar entidad, categoría o descripción..."
          prefix={<SearchOutlined />}
          allowClear
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: 320 }}
          size="small"
        />
      </div>

      {/* Main table */}
      <Table<GastoServicioItem>
        className="rg-table"
        rowKey="GASTO_ID"
        columns={columns}
        dataSource={gastos}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 25, showSizeChanger: true, showTotal: t => `${t} gastos` }}
      />

      {/* Detalle Gasto Modal */}
      <DetalleGastoModal
        detalleGasto={detalleGasto}
        onClose={() => setDetalleGasto(null)}
        onOpenCajaCentral={(movId) => {
          openTab({ key: '/cashcentral', label: 'Caja Central', closable: true });
          navigate('/cashcentral', { state: { highlightMovId: movId } });
          setDetalleGasto(null);
        }}
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
            desgloseFilter === 'EFECTIVO' ? m.CATEGORIA === 'EFECTIVO' : m.CATEGORIA !== 'EFECTIVO',
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

      <NuevoGastoModal
        open={modalOpen}
        gastoId={editGastoId}
        onSuccess={handleSuccess}
        onCancel={() => {
          setModalOpen(false);
          setEditGastoId(null);
        }}
      />
    </div>
  );
}

// ── Detalle Gasto sub-component ──────────────────
function DetalleGastoModal({ detalleGasto, onClose, onOpenCajaCentral }: {
  detalleGasto: GastoServicioItem | null;
  onClose: () => void;
  onOpenCajaCentral: (movId: number) => void;
}) {
  const { data: detalle } = useQuery({
    queryKey: ['expense-detail', detalleGasto?.GASTO_ID],
    queryFn: () => expensesApi.getById(detalleGasto!.GASTO_ID),
    enabled: !!detalleGasto,
  });

  const { data: metodosPago = [] } = useQuery({
    queryKey: ['expenses-active-payment-methods'],
    queryFn: () => expensesApi.getActivePaymentMethods(),
    enabled: !!detalleGasto,
    staleTime: 60000,
  });

  return (
    <Modal
      title="Detalle de Gasto"
      open={!!detalleGasto}
      onCancel={onClose}
      footer={
        detalleGasto?.MOVIMIENTO_CAJA_ID ? (
          <Button
            icon={<BankOutlined />}
            onClick={() => onOpenCajaCentral(detalleGasto.MOVIMIENTO_CAJA_ID!)}
          >
            Ver en Caja Central
          </Button>
        ) : <Button onClick={onClose}>Cerrar</Button>
      }
      width={420}
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
    >
      {detalleGasto && (
        <>
          <Descriptions column={1} bordered size="small" style={{ marginTop: 12 }}>
            <Descriptions.Item label="Fecha">
              {dayjs(detalleGasto.FECHA).format('DD/MM/YYYY HH:mm')}
            </Descriptions.Item>
            <Descriptions.Item label="Entidad">
              {detalleGasto.ENTIDAD}
            </Descriptions.Item>
            {detalleGasto.CATEGORIA && (
              <Descriptions.Item label="Categoría">
                <Tag color="geekblue">{detalleGasto.CATEGORIA}</Tag>
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Descripción">
              {detalleGasto.DESCRIPCION || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="Usuario">
              {detalleGasto.USUARIO_NOMBRE || '-'}
            </Descriptions.Item>
            {detalleGasto.MOVIMIENTO_CAJA_ID && (
              <Descriptions.Item label="Mov. Caja Central">
                #{detalleGasto.MOVIMIENTO_CAJA_ID}
              </Descriptions.Item>
            )}
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
                {fmtMoney(detalleGasto.EFECTIVO)}
              </Descriptions.Item>
              <Descriptions.Item label="Digital">
                {fmtMoney(detalleGasto.DIGITAL)}
              </Descriptions.Item>
            </Descriptions>
          )}

          <div style={{
            marginTop: 12, background: '#f5f5f5', borderRadius: 8, padding: '10px 16px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <Text strong style={{ fontSize: 15 }}>Total:</Text>
            <Text strong style={{ fontSize: 18, color: '#cf1322' }}>{fmtMoney(detalleGasto.MONTO)}</Text>
          </div>
        </>
      )}
    </Modal>
  );
}
