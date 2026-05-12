import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, Card, Col, Form, Input, InputNumber, Modal, Row,
  Select, Space, Statistic, Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  EditOutlined, FilterOutlined, PercentageOutlined,
  ReloadOutlined, SearchOutlined, TagsOutlined,
} from '@ant-design/icons';
import { priceListApi, type PriceListInput, type PriceListWithStats } from '../services/priceList.api';
import { useTabStore } from '../store/tabStore';
import { fmtMoney, fmtNum } from '../utils/format';

const { Title } = Typography;

export function PriceListsPage() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState(10);
  const [listSearch, setListSearch] = useState('');
  const [listActiva, setListActiva] = useState<boolean | undefined>();
  const [selectedListId, setSelectedListId] = useState<number | null>(null);
  const [listOrderBy, setListOrderBy] = useState('LISTA_ID');
  const [listOrderDir, setListOrderDir] = useState<'ASC' | 'DESC'>('ASC');

  const [formOpen, setFormOpen] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);

  const [listForm] = Form.useForm();
  const [applyForm] = Form.useForm();
  const applyPorcentaje: number | undefined = Form.useWatch('porcentaje', applyForm);
  const isAumento = (applyPorcentaje ?? 0) >= 0;

  const { data: lists, isLoading: listsLoading, refetch: refetchLists } = useQuery({
    queryKey: ['price-lists', listPage, listPageSize, listSearch, listActiva, listOrderBy, listOrderDir],
    queryFn: () => priceListApi.getAll({
      page: listPage,
      pageSize: listPageSize,
      search: listSearch || undefined,
      activa: listActiva,
      orderBy: listOrderBy,
      orderDir: listOrderDir,
    }),
  });

  const selectedList = useMemo(
    () => lists?.data.find(item => item.LISTA_ID === selectedListId) ?? null,
    [lists, selectedListId]
  );

  const kpis = useMemo(() => {
    const all = lists?.data ?? [];
    const activas = all.filter(l => l.ACTIVA).length;
    const totalProductos = all.reduce((s, l) => s + (l.productosConPrecio ?? 0), 0);
    const activeLists = all.filter(l => l.ACTIVA);
    const avgMargen = activeLists.length
      ? activeLists.reduce((s, l) => s + (l.MARGEN ?? 0), 0) / activeLists.length
      : 0;
    const listsWithPrecio = activeLists.filter(l => (l.precioPromedio ?? 0) > 0);
    const avgPrecio = listsWithPrecio.length
      ? listsWithPrecio.reduce((s, l) => s + (l.precioPromedio ?? 0), 0) / listsWithPrecio.length
      : 0;
    return { activas, total: all.length, totalProductos, avgMargen, avgPrecio };
  }, [lists]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['price-lists'] });
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['listas-precios'] });
  }, [qc]);

  const handleEditList = (record: PriceListWithStats) => {
    listForm.setFieldsValue({
      CODIGOPARTICULAR: record.CODIGOPARTICULAR,
      NOMBRE: record.NOMBRE,
      DESCRIPCION: record.DESCRIPCION,
      MARGEN: record.MARGEN ?? 0,
      MARGEN_REAL: record.MARGEN_REAL ?? record.MARGEN ?? 0,
      ACTIVA: record.ACTIVA,
    });
    setSelectedListId(record.LISTA_ID);
    setFormOpen(true);
  };

  useEffect(() => {
    const handler = () => {
      if (useTabStore.getState().activeKey === '/price-lists' && selectedList) handleEditList(selectedList);
    };
    window.addEventListener('rg:nuevo', handler);
    return () => window.removeEventListener('rg:nuevo', handler);
  }, [selectedList]);

  const handleSaveList = async () => {
    if (!selectedListId) return;
    try {
      const values = await listForm.validateFields();
      setSaving(true);
      const payload: PriceListInput = {
        CODIGOPARTICULAR: values.CODIGOPARTICULAR || null,
        NOMBRE: values.NOMBRE,
        DESCRIPCION: values.DESCRIPCION || null,
        MARGEN: values.MARGEN ?? 0,
        MARGEN_REAL: values.MARGEN_REAL ?? 0,
        ACTIVA: values.ACTIVA !== false,
      };
      await priceListApi.update(selectedListId, payload);
      message.success('Lista de precio actualizada');
      setFormOpen(false);
      invalidate();
    } catch (err: any) {
      if (err?.response?.data?.error) message.error(err.response.data.error);
    } finally {
      setSaving(false);
    }
  };

  const handleApplyPercentage = async () => {
    if (!selectedListId || !selectedList) return;
    try {
      const values = await applyForm.validateFields();
      Modal.confirm({
        title: 'Actualizar precios de lista',
        content: `Se ${values.porcentaje >= 0 ? 'aumentarán' : 'reducirán'} los precios de "${selectedList.NOMBRE}" un ${fmtNum(Math.abs(values.porcentaje))}%.`,
        okText: values.porcentaje >= 0 ? 'Aumentar' : 'Reducir',
        cancelText: 'Cancelar',
        onOk: async () => {
          setApplying(true);
          try {
            const result = await priceListApi.applyPercentage(selectedListId, {
              porcentaje: values.porcentaje,
              incluirInactivos: values.incluirInactivos,
              redondeo: values.redondeo,
            });
            message.success(`Precios actualizados: ${result.affected} producto(s)`);
            setApplyOpen(false);
            applyForm.resetFields();
            invalidate();
          } catch (err: any) {
            message.error(err?.response?.data?.error || 'Error al actualizar precios');
          } finally {
            setApplying(false);
          }
        },
      });
    } catch {
      // Ant Design marks invalid fields in the form.
    }
  };

  const handleListTableChange = (_pagination: any, _filters: any, sorter: any) => {
    const colMap: Record<string, string> = {
      LISTA_ID: 'LISTA_ID', CODIGOPARTICULAR: 'CODIGOPARTICULAR', NOMBRE: 'NOMBRE', MARGEN: 'MARGEN', MARGEN_REAL: 'MARGEN_REAL',
    };
    const mapped = colMap[sorter.field];
    if (mapped) {
      setListOrderBy(mapped);
      setListOrderDir(sorter.order === 'descend' ? 'DESC' : 'ASC');
    }
  };

  const listColumns: TableColumnType<PriceListWithStats>[] = [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', align: 'center', key: 'CODIGOPARTICULAR', width: 110, sorter: true, render: (v) => v || '-' },
    { title: 'Nombre', dataIndex: 'NOMBRE', key: 'NOMBRE', ellipsis: true, sorter: true },
    { title: 'Descripción', dataIndex: 'DESCRIPCION', key: 'DESCRIPCION', ellipsis: true, render: (v) => v || '-' },
    { title: 'Margen', dataIndex: 'MARGEN', key: 'MARGEN', width: 110, align: 'center', sorter: true, render: (v: number) => `${fmtNum(v)}%` },
    { title: 'Margen real', dataIndex: 'MARGEN_REAL', key: 'MARGEN_REAL', width: 150, align: 'center', sorter: true, render: (v: number | null) => v != null ? `${fmtNum(v)}%` : '-' },
    { title: 'Con precio', dataIndex: 'productosConPrecio', key: 'productosConPrecio', width: 120, align: 'center' },
    { title: 'Precio promedio', dataIndex: 'precioPromedio', key: 'precioPromedio', width: 160, align: 'center', render: (v: number) => fmtMoney(v) },
    {
      title: 'Estado', dataIndex: 'ACTIVA', key: 'ACTIVA', width: 95,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Activa' : 'Inactiva'}</Tag>,
    },
    {
      title: '', key: 'actions', width: 88, fixed: 'right',
      render: (_: unknown, record) => (
        <Space size={2}>
          <Tooltip title="Ajustar precios %">
            <Button
              type="text"
              size="small"
              icon={<PercentageOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedListId(record.LISTA_ID);
                applyForm.setFieldsValue({ porcentaje: 0, redondeo: 'ninguno', incluirInactivos: false });
                setApplyOpen(true);
              }}
              style={{ color: '#1677ff' }}
            />
          </Tooltip>
          <Tooltip title="Editar">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={(e) => { e.stopPropagation(); handleEditList(record); }}
              style={{ color: '#EABD23' }}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-enter price-lists-page">
      <div className="page-header">
        <Title level={3} style={{ margin: 0 }}>
          <TagsOutlined style={{ marginRight: 8 }} />
          Listas de Precio
        </Title>
        <Space wrap size="small">
          <Input
            placeholder="Buscar lista..."
            prefix={<SearchOutlined />}
            value={listSearch}
            onChange={(e) => { setListSearch(e.target.value); setListPage(1); }}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            placeholder="Estado"
            allowClear
            style={{ width: 120 }}
            value={listActiva}
            onChange={(v) => { setListActiva(v); setListPage(1); }}
            options={[{ label: 'Activas', value: true }, { label: 'Inactivas', value: false }]}
            suffixIcon={<FilterOutlined />}
          />
          <Tooltip title="Refrescar">
            <Button icon={<ReloadOutlined />} onClick={() => refetchLists()} />
          </Tooltip>
          <Button
            type="primary"
            icon={<PercentageOutlined />}
            className="btn-gold"
            disabled={!selectedList}
            onClick={() => {
              applyForm.setFieldsValue({ porcentaje: 0, redondeo: 'ninguno', incluirInactivos: false });
              setApplyOpen(true);
            }}
            title={selectedList ? `Aplicar a: ${selectedList.NOMBRE}` : 'Seleccioná una lista primero'}
          >
            Ajustar Precios
          </Button>
        </Space>
      </div>

      {/* ── Dashboard KPIs ───────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Listas activas"
              value={`${kpis.activas} / ${kpis.total}`}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Productos con precio"
              value={kpis.totalProductos}
              valueStyle={{ color: '#EABD23' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Margen promedio (activas)"
              value={fmtNum(kpis.avgMargen)}
              suffix="%"
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card size="small" className="rg-card">
            <Statistic
              title="Precio promedio (activas)"
              value={fmtMoney(kpis.avgPrecio)}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Grilla de listas ─────────────────────── */}
      <Table
        className="rg-table"
        columns={listColumns}
        dataSource={lists?.data}
        rowKey="LISTA_ID"
        loading={listsLoading}
        onChange={handleListTableChange}
        onRow={(record) => ({
          onClick: () => setSelectedListId(record.LISTA_ID),
        })}
        rowClassName={(record) => record.LISTA_ID === selectedListId ? 'price-list-row-selected' : ''}
        pagination={{
          current: listPage,
          pageSize: listPageSize,
          total: lists?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: ['5', '10', '25'],
          showTotal: (total) => `${total} lista${total !== 1 ? 's' : ''}`,
          onChange: (p, ps) => { setListPage(p); setListPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 900 }}
      />

      {/* ── Editar lista ──────────────────────────── */}
      <Modal
        title="Editar Lista de Precio"
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={handleSaveList}
        okText="Guardar Cambios"
        cancelText="Cancelar"
        confirmLoading={saving}
        width={560}
        destroyOnClose
        className="rg-modal"
      >
        <Form form={listForm} layout="vertical" size="middle">
          <Form.Item name="CODIGOPARTICULAR" label="Código" rules={[{ required: true, whitespace: true, message: 'El código es obligatorio' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="NOMBRE" label="Nombre" rules={[{ required: true, whitespace: true, message: 'Ingresá el nombre de la lista' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="DESCRIPCION" label="Descripción">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Space size="middle" style={{ width: '100%' }}>
            <Form.Item name="MARGEN" label="Margen" rules={[{ required: true, message: 'Ingresá el margen' }]} style={{ flex: 1 }}>
              <InputNumber min={-99.99} max={1000} precision={2} addonAfter="%" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="MARGEN_REAL" label="Margen Real" rules={[{ required: true, message: 'Ingresá el margen real' }]} style={{ flex: 1 }}>
              <InputNumber min={-99.99} max={1000} precision={2} addonAfter="%" style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="ACTIVA" label="Activa" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Ajustar precios lista ─────────────────── */}
      <Modal
        title={selectedList ? `${isAumento ? 'Aumentar' : 'Reducir'} precios — ${selectedList.NOMBRE}` : 'Ajustar precios'}
        open={applyOpen}
        onCancel={() => setApplyOpen(false)}
        onOk={handleApplyPercentage}
        okText={isAumento ? 'Aplicar Aumento' : 'Aplicar Reducción'}
        cancelText="Cancelar"
        confirmLoading={applying}
        width={480}
        destroyOnClose
        className="rg-modal"
      >
        <Form form={applyForm} layout="vertical" size="middle" initialValues={{ porcentaje: 0, redondeo: 'ninguno', incluirInactivos: false }}>
          <Form.Item
            name="porcentaje"
            label={`Porcentaje (positivo = aumento, negativo = reducción)`}
            rules={[{ required: true, message: 'Ingresá el porcentaje' }, { type: 'number', min: -99.99, max: 1000, message: 'Valor entre -99.99 y 1000' }]}
          >
            <InputNumber min={-99.99} max={1000} precision={2} addonAfter="%" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="redondeo" label="Redondeo">
            <Select options={[
              { label: 'Sin redondeo', value: 'ninguno' },
              { label: 'Entero superior', value: 'entero' },
              { label: 'Múltiplo de 50', value: '50' },
              { label: 'Múltiplo de 100', value: '100' },
            ]} />
          </Form.Item>
          <Form.Item name="incluirInactivos" label="Incluir productos inactivos" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}