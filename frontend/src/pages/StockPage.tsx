import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Table, Space, Input, Typography, Tag, Select, Button, Modal, App,
  InputNumber, Checkbox, Tooltip, Drawer, Descriptions, Spin,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  SearchOutlined, ReloadOutlined, HistoryOutlined,
  EditOutlined, WarningOutlined, InboxOutlined,
  ArrowUpOutlined, ArrowDownOutlined,
} from '@ant-design/icons';
import { stockApi, type StockProducto, type StockDepositoItem } from '../services/stock.api';
import { puntoVentaApi } from '../services/puntoVenta.api';
import { useAuthStore } from '../store/authStore';
import { fmtNum } from '../utils/format';
import { StockHistoryModal } from '../components/stock/StockHistoryModal';

const { Title, Text } = Typography;

export function StockPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  // Punto de venta del usuario logueado
  const userPuntosVenta = useAuthStore(s => s.puntosVenta);
  const userPuntoVentaActivo = useAuthStore(s => s.puntoVentaActivo);
  const pvPreferidoId =
    userPuntosVenta.find(pv => pv.ES_PREFERIDO)?.PUNTO_VENTA_ID
    ?? userPuntoVentaActivo
    ?? userPuntosVenta[0]?.PUNTO_VENTA_ID
    ?? undefined;

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [search, setSearch] = useState('');
  // Por defecto se filtra por el punto de venta preferido del usuario.
  const [puntoVentaId, setPuntoVentaId] = useState<number | undefined>(pvPreferidoId);
  const [depositoId, setDepositoId] = useState<number | undefined>();
  const [soloConStock, setSoloConStock] = useState(false);
  const [soloBajoMinimo, setSoloBajoMinimo] = useState(false);
  const [orderBy, setOrderBy] = useState<string>('NOMBRE');
  const [orderDir, setOrderDir] = useState<'ASC' | 'DESC'>('ASC');

  // Detail drawer
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailProductId, setDetailProductId] = useState<number | null>(null);

  // Inline stock edit
  const [editingStock, setEditingStock] = useState<{
    PRODUCTO_ID: number;
    DEPOSITO_ID: number;
    DEPOSITO_NOMBRE: string;
    PRODUCTO_NOMBRE: string;
    currentValue: number;
  } | null>(null);
  const [newStockValue, setNewStockValue] = useState<number>(0);
  const [stockObservation, setStockObservation] = useState('');
  const [saving, setSaving] = useState(false);

  // History modal
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyProductId, setHistoryProductId] = useState<number | null>(null);
  const [historyProductName, setHistoryProductName] = useState('');

  // ── Data queries ─────────────────────────────────
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['stock', page, pageSize, search, puntoVentaId, depositoId, soloConStock, soloBajoMinimo, orderBy, orderDir],
    queryFn: () => stockApi.getAll({
      page, pageSize,
      search: search || undefined,
      puntoVentaId,
      depositoId,
      soloConStock,
      soloBajoMinimo,
      orderBy, orderDir,
    }),
  });

  const { data: depositos } = useQuery({
    queryKey: ['stock-depositos', puntoVentaId],
    queryFn: () => stockApi.getDepositos({ puntoVentaId }),
  });

  const { data: puntosVenta } = useQuery({
    queryKey: ['puntos-venta-selector'],
    queryFn: () => puntoVentaApi.getSelector(),
  });

  // Detail
  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ['stock-detail', detailProductId],
    queryFn: () => stockApi.getProductStock(detailProductId!),
    enabled: !!detailProductId && detailOpen,
  });

  // ── Helpers ──────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['stock'] });
    qc.invalidateQueries({ queryKey: ['stock-detail'] });
  };

  // ── Stock edit modal ─────────────────────────────
  const openStockEdit = (producto: StockProducto, deposito: StockDepositoItem) => {
    setEditingStock({
      PRODUCTO_ID: producto.PRODUCTO_ID,
      DEPOSITO_ID: deposito.DEPOSITO_ID,
      DEPOSITO_NOMBRE: deposito.DEPOSITO_NOMBRE,
      PRODUCTO_NOMBRE: producto.NOMBRE,
      currentValue: deposito.CANTIDAD,
    });
    setNewStockValue(deposito.CANTIDAD);
    setStockObservation('');
  };

  const saveStockEdit = async () => {
    if (!editingStock) return;
    setSaving(true);
    try {
      const result = await stockApi.updateStock({
        PRODUCTO_ID: editingStock.PRODUCTO_ID,
        DEPOSITO_ID: editingStock.DEPOSITO_ID,
        CANTIDAD_NUEVA: newStockValue,
        OBSERVACIONES: stockObservation || undefined,
      });
      const dif = result.diferencia;
      message.success(`Stock actualizado (${dif >= 0 ? '+' : ''}${fmtNum(dif)})`);
      setEditingStock(null);
      invalidate();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Error al actualizar stock');
    } finally {
      setSaving(false);
    }
  };

  // ── Open history ─────────────────────────────────
  const openHistory = (producto: StockProducto) => {
    setHistoryProductId(producto.PRODUCTO_ID);
    setHistoryProductName(producto.NOMBRE);
    setHistoryOpen(true);
  };

  // ── Open detail ──────────────────────────────────
  const openDetail = (producto: StockProducto) => {
    setDetailProductId(producto.PRODUCTO_ID);
    setDetailOpen(true);
  };

  // ── Table sort change ────────────────────────────
  const handleTableChange = (_pagination: any, _filters: any, sorter: any) => {
    if (sorter.field) {
      const colMap: Record<string, string> = {
        CODIGOPARTICULAR: 'CODIGOPARTICULAR',
        NOMBRE: 'NOMBRE',
        CANTIDAD: 'CANTIDAD',
        STOCK_MINIMO: 'STOCK_MINIMO',
      };
      const mappedCol = colMap[sorter.field];
      if (mappedCol) {
        setOrderBy(mappedCol);
        setOrderDir(sorter.order === 'descend' ? 'DESC' : 'ASC');
      }
    }
  };

  // ── Table columns ────────────────────────────────
  const columns: TableColumnType<StockProducto>[] = [
    {
      title: 'Código',
      dataIndex: 'CODIGOPARTICULAR',
      key: 'CODIGOPARTICULAR',
      width: 110,
      sorter: true,
      ellipsis: true,
    },
    {
      title: 'Producto',
      dataIndex: 'NOMBRE',
      key: 'NOMBRE',
      sorter: true,
      ellipsis: true,
      render: (name: string, record: StockProducto) => (
        <Space>
          <Text strong>{name}</Text>
          {record.STOCK_MINIMO != null && record.CANTIDAD <= record.STOCK_MINIMO && (
            <Tooltip title="Stock bajo mínimo">
              <WarningOutlined style={{ color: '#ff4d4f' }} />
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Categoría',
      dataIndex: 'CATEGORIA_NOMBRE',
      key: 'CATEGORIA_NOMBRE',
      width: 140,
      ellipsis: true,
      render: (v: string) => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Stock',
      dataIndex: 'CANTIDAD',
      key: 'CANTIDAD',
      width: 120,
      sorter: true,
      align: 'center',
      render: (cant: number, record: StockProducto) => {
        const unit = record.UNIDAD_ABREVIACION || 'u';
        const isBajo = record.STOCK_MINIMO != null && cant <= record.STOCK_MINIMO;
        return (
          <Tag color={cant <= 0 ? 'red' : isBajo ? 'orange' : 'green'} style={{ fontWeight: 600 }}>
            {fmtNum(cant)} {unit}
          </Tag>
        );
      },
    },
    {
      title: 'Mínimo',
      dataIndex: 'STOCK_MINIMO',
      key: 'STOCK_MINIMO',
      width: 110,
      sorter: true,
      align: 'center',
      render: (v: number | null) => v != null ? fmtNum(v) : <Text type="secondary">—</Text>,
    },
    {
      title: 'Stock por Depósito',
      key: 'stockDepositos',
      width: 300,
      render: (_: any, record: StockProducto) => {
        if (!record.stockDepositos?.length) {
          return <Text type="secondary" italic>Sin depósitos asignados</Text>;
        }
        return (
          <Space wrap size={[4, 4]}>
            {record.stockDepositos.map((sd) => (
              <Tooltip key={sd.DEPOSITO_ID} title={`Click para editar stock en ${sd.DEPOSITO_NOMBRE}`}>
                <Tag
                  style={{ cursor: 'pointer', margin: 0 }}
                  color={sd.CANTIDAD > 0 ? 'blue' : 'default'}
                  onClick={() => openStockEdit(record, sd)}
                >
                  <InboxOutlined style={{ marginRight: 4 }} />
                  {sd.DEPOSITO_NOMBRE}: {fmtNum(sd.CANTIDAD)}
                </Tag>
              </Tooltip>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Acciones',
      key: 'actions',
      width: 110,
      align: 'center',
      render: (_: any, record: StockProducto) => (
        <Space size="small">
          <Tooltip title="Ver historial">
            <Button
              type="text"
              size="small"
              icon={<HistoryOutlined />}
              onClick={() => openHistory(record)}
            />
          </Tooltip>
          <Tooltip title="Detalle">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => openDetail(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // ── Render ───────────────────────────────────────
  return (
    <div className="page-enter">
      {/* Header */}
      <div className="page-header">
        <Title level={3}>Stock por Depósito</Title>
        <Button icon={<ReloadOutlined />} onClick={() => refetch()}>Actualizar</Button>
      </div>

      {/* Filters */}
      <Space wrap style={{ width: '100%', marginBottom: 16 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="Buscar producto..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          onPressEnter={() => refetch()}
          style={{ width: 260 }}
          allowClear
        />
        <Select
          placeholder="Punto de Venta"
          value={puntoVentaId}
          onChange={(v) => {
            setPuntoVentaId(v);
            setDepositoId(undefined);
            setPage(1);
          }}
          style={{ width: 200 }}
          allowClear
          options={(() => {
            const assignedIds = userPuntosVenta.map(pv => pv.PUNTO_VENTA_ID);
            const list = (puntosVenta ?? []).filter(pv => pv.ACTIVO);
            // Si el usuario tiene PV asignados, sólo mostrar esos; si no, todos.
            const filtered = assignedIds.length > 0
              ? list.filter(pv => assignedIds.includes(pv.PUNTO_VENTA_ID))
              : list;
            return filtered.map(pv => ({ label: pv.NOMBRE, value: pv.PUNTO_VENTA_ID }));
          })()}
        />
        <Select
          placeholder="Depósito"
          value={depositoId}
          onChange={(v) => { setDepositoId(v); setPage(1); }}
          style={{ width: 180 }}
          allowClear
          options={depositos?.map(d => ({ label: d.NOMBRE, value: d.DEPOSITO_ID }))}
        />
        <Checkbox checked={soloConStock} onChange={(e) => { setSoloConStock(e.target.checked); setPage(1); }}>
          Con stock
        </Checkbox>
        <Checkbox checked={soloBajoMinimo} onChange={(e) => { setSoloBajoMinimo(e.target.checked); setPage(1); }}>
          <Text type="danger">Bajo mínimo</Text>
        </Checkbox>
      </Space>

      {/* Table */}
      <Table
        className="rg-table"
        dataSource={data?.data || []}
        columns={columns}
        rowKey="PRODUCTO_ID"
        loading={isLoading}
        size="small"
        onChange={handleTableChange}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: ['15', '25', '50', '100'],
          showTotal: (total) => `${total} productos`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        onRow={(record) => ({
          onDoubleClick: () => openDetail(record),
        })}
      />

      {/* ── Stock Edit Modal ─────────────────────── */}
      <Modal
        title="Ajustar Stock"
        open={!!editingStock}
        onCancel={() => setEditingStock(null)}
        onOk={saveStockEdit}
        confirmLoading={saving}
        okText="Guardar"
        cancelText="Cancelar"
        width={420}
        destroyOnClose
        styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
      >
        {editingStock && (
          <div style={{ marginTop: 8 }}>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Producto">{editingStock.PRODUCTO_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Depósito">{editingStock.DEPOSITO_NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Stock actual">
                <Text strong>{fmtNum(editingStock.currentValue)}</Text>
              </Descriptions.Item>
            </Descriptions>

            <div style={{ marginBottom: 12 }}>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Nuevo stock:</Text>
              <InputNumber
                style={{ width: '100%' }}
                value={newStockValue}
                onChange={(v) => setNewStockValue(v ?? 0)}
                min={0}
                precision={2}
                size="large"
                autoFocus
              />
            </div>

            {newStockValue !== editingStock.currentValue && (
              <div style={{ marginBottom: 12 }}>
                <Tag
                  color={newStockValue > editingStock.currentValue ? 'green' : 'red'}
                  icon={newStockValue > editingStock.currentValue ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                  style={{ fontSize: 14, padding: '4px 12px' }}
                >
                  Diferencia: {newStockValue > editingStock.currentValue ? '+' : ''}
                  {fmtNum(newStockValue - editingStock.currentValue)}
                </Tag>
              </div>
            )}

            <div>
              <Text strong style={{ display: 'block', marginBottom: 4 }}>Observaciones (opcional):</Text>
              <Input.TextArea
                value={stockObservation}
                onChange={(e) => setStockObservation(e.target.value)}
                placeholder="Motivo del ajuste..."
                rows={2}
                maxLength={500}
              />
            </div>
          </div>
        )}
      </Modal>

      {/* ── Detail Drawer ────────────────────────── */}
      <Drawer
        title="Detalle de Stock"
        open={detailOpen}
        onClose={() => { setDetailOpen(false); setDetailProductId(null); }}
        width={520}
        destroyOnClose
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
        ) : detailData ? (
          <div>
            <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Código">{detailData.product.CODIGOPARTICULAR}</Descriptions.Item>
              <Descriptions.Item label="Producto">{detailData.product.NOMBRE}</Descriptions.Item>
              <Descriptions.Item label="Stock Total">
                <Tag
                  color={detailData.product.CANTIDAD <= 0 ? 'red' : 'green'}
                  style={{ fontWeight: 600, fontSize: 14 }}
                >
                  {fmtNum(detailData.product.CANTIDAD)} {detailData.product.UNIDAD_ABREVIACION || 'u'}
                </Tag>
              </Descriptions.Item>
              {detailData.product.STOCK_MINIMO != null && (
                <Descriptions.Item label="Stock Mínimo">
                  {fmtNum(detailData.product.STOCK_MINIMO)}
                </Descriptions.Item>
              )}
            </Descriptions>

            <Title level={5} style={{ marginBottom: 8 }}>Stock por Depósito</Title>
            <Table
              className="rg-table"
              dataSource={detailData.stockDepositos}
              rowKey="ITEM_ID"
              size="small"
              pagination={false}
              columns={[
                {
                  title: 'Depósito',
                  dataIndex: 'DEPOSITO_NOMBRE',
                  key: 'DEPOSITO_NOMBRE',
                },
                {
                  title: 'Cantidad',
                  dataIndex: 'CANTIDAD',
                  key: 'CANTIDAD',
                  align: 'center',
                  render: (cant: number) => (
                    <Tag color={cant > 0 ? 'blue' : 'default'} style={{ fontWeight: 600 }}>
                      {fmtNum(cant)}
                    </Tag>
                  ),
                },
                {
                  title: 'Editar',
                  key: 'edit',
                  width: 70,
                  align: 'center',
                  render: (_: any, sd: StockDepositoItem) => (
                    <Button
                      type="link"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => {
                        openStockEdit(
                          {
                            PRODUCTO_ID: detailData.product.PRODUCTO_ID,
                            CODIGOPARTICULAR: detailData.product.CODIGOPARTICULAR,
                            NOMBRE: detailData.product.NOMBRE,
                            CANTIDAD: detailData.product.CANTIDAD,
                            STOCK_MINIMO: detailData.product.STOCK_MINIMO,
                            UNIDAD_ABREVIACION: detailData.product.UNIDAD_ABREVIACION,
                            CATEGORIA_NOMBRE: null,
                            MARCA_NOMBRE: null,
                            stockDepositos: detailData.stockDepositos,
                          },
                          sd
                        );
                      }}
                    />
                  ),
                },
              ]}
            />

            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Button
                icon={<HistoryOutlined />}
                onClick={() => {
                  setHistoryProductId(detailData.product.PRODUCTO_ID);
                  setHistoryProductName(detailData.product.NOMBRE);
                  setHistoryOpen(true);
                }}
              >
                Ver Historial de Movimientos
              </Button>
            </div>
          </div>
        ) : null}
      </Drawer>

      {/* ── History Modal ────────────────────────── */}
      <StockHistoryModal
        open={historyOpen}
        onClose={() => { setHistoryOpen(false); setHistoryProductId(null); }}
        productoId={historyProductId}
        productoNombre={historyProductName}
      />
    </div>
  );
}
