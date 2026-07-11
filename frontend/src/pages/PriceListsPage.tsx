import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, Card, Col, Divider, Form, Input, InputNumber, Modal, Radio, Row,
  Select, Space, Spin, Statistic, Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  DeleteOutlined, EditOutlined, FilterOutlined, PercentageOutlined,
  PlusOutlined, ReloadOutlined, RiseOutlined, SearchOutlined, TagsOutlined,
} from '@ant-design/icons';
import { priceListApi, type PriceListWithStats } from '../services/priceList.api';
import { useTabStore } from '../store/tabStore';
import { fmtMoney, fmtNum } from '../utils/format';
import { RowContextMenu } from '../components/RowContextMenu';
import { useRowActions, type RowAction } from '../hooks/useRowActions';

const { Title } = Typography;

export function PriceListsPage() {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();

  const [listPage, setListPage] = useState(1);
  const [listPageSize, setListPageSize] = useState(10);
  const [listSearch, setListSearch] = useState('');
  const [listActiva, setListActiva] = useState<boolean | undefined>();
  const [listOrderBy, setListOrderBy] = useState('LISTA_ID');
  const [listOrderDir, setListOrderDir] = useState<'ASC' | 'DESC'>('ASC');

  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [originalMargen, setOriginalMargen] = useState<number>(0);

  // Modal de redondeo (reutilizado para dos modos: post-recálculo al editar, o standalone)
  const [redondeoOpen, setRedondeoOpen] = useState(false);
  const [redondeoContext, setRedondeoContext] = useState<
    | { mode: 'recalc'; margenAnterior: number; margenNuevo: number }
    | { mode: 'standalone'; listaId: number; listName: string }
    | null
  >(null);
  const [redondeoStep, setRedondeoStep] = useState<number>(50);
  const [redondeoDireccion, setRedondeoDireccion] = useState<'arriba' | 'cercano'>('arriba');

  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const [listForm] = Form.useForm();
  const [applyForm] = Form.useForm();
  const applyPorcentaje: number | undefined = Form.useWatch('porcentaje', applyForm);
  const applyActualizarMargen: boolean = Form.useWatch('actualizarMargen', applyForm) ?? false;
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

  const { data: editData, isLoading: editLoading } = useQuery({
    queryKey: ['price-list-edit', editId],
    queryFn: () => priceListApi.getById(editId!),
    enabled: !!editId && formOpen,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const applyList = useMemo(() => {
    if (!editId) return null;
    return lists?.data.find(l => l.LISTA_ID === editId) ?? null;
  }, [lists, editId]);

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
    qc.invalidateQueries({ queryKey: ['price-list-edit'] });
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['listas-precios'] });
  }, [qc]);

  useEffect(() => {
    if (editData && formOpen && editId) {
      listForm.setFieldsValue({
        CODIGOPARTICULAR: editData.CODIGOPARTICULAR ?? null,
        NOMBRE: editData.NOMBRE,
        DESCRIPCION: editData.DESCRIPCION ?? null,
        MARGEN: editData.MARGEN ?? 0,
        ACTIVA: editData.ACTIVA,
      });
      setOriginalMargen(editData.MARGEN ?? 0);
    }
  }, [editData, formOpen, editId, listForm]);

  // ── Form (Create / Edit) ──────────────────────────
  const handleNew = () => {
    setEditId(null);
    setOriginalMargen(0);
    listForm.resetFields();
    listForm.setFieldsValue({ ACTIVA: true, MARGEN: 0, aplicarMargenInicial: true });
    setFormOpen(true);
  };

  const handleEditList = (record: PriceListWithStats) => {
    setEditId(record.LISTA_ID);
    listForm.resetFields();
    setFormOpen(true);
  };

  const handleDelete = (record: PriceListWithStats) => {
    modal.confirm({
      title: 'Eliminar lista de precios',
      content: (
        <div>
          <p style={{ marginBottom: 4 }}>
            ¿Eliminar la lista <strong>"{record.NOMBRE}"</strong>?
          </p>
          <p style={{ marginBottom: 0, color: 'rgba(0,0,0,0.65)' }}>
            Si tiene precios asignados o productos que la usan como predeterminada,
            se desactivará en lugar de eliminarse.
          </p>
        </div>
      ),
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        try {
          const result = await priceListApi.delete(record.LISTA_ID);
          message.success(
            result.mode === 'soft'
              ? 'Lista desactivada (tiene precios o productos asociados)'
              : 'Lista eliminada'
          );
          if (editId === record.LISTA_ID) setEditId(null);
          invalidate();
        } catch (err: any) {
          message.error(err?.response?.data?.error || 'Error al eliminar la lista');
        }
      },
    });
  };

  useEffect(() => {
    const handler = () => { if (useTabStore.getState().activeKey === '/price-lists') handleNew(); };
    window.addEventListener('rg:nuevo', handler);
    return () => window.removeEventListener('rg:nuevo', handler);
  }, []);

  const performUpdate = async (
    recalcularPorMargen: boolean,
    redondeoStep: number | null = null,
    redondeoDireccion: 'arriba' | 'cercano' | null = null,
  ) => {
    if (!editId) return;
    setSaving(true);
    try {
      const result = await priceListApi.update(editId, {
        CODIGOPARTICULAR: listForm.getFieldValue('CODIGOPARTICULAR')?.trim() || null,
        NOMBRE: listForm.getFieldValue('NOMBRE'),
        DESCRIPCION: listForm.getFieldValue('DESCRIPCION')?.trim() || null,
        MARGEN: listForm.getFieldValue('MARGEN') ?? 0,
        ACTIVA: listForm.getFieldValue('ACTIVA') !== false,
        recalcularPorMargen,
        redondeoStep,
        redondeoDireccion,
      });
      const margenNuevo = listForm.getFieldValue('MARGEN') ?? 0;
      let msg = 'Lista de precio actualizada';
      if (recalcularPorMargen && result?.affected) {
        msg += ` · ${result.affected} producto(s) recalculado(s) con margen ${fmtNum(margenNuevo)}%`;
      }
      if (recalcularPorMargen && redondeoStep && redondeoDireccion) {
        msg += ` y redondeados a ${fmtNum(redondeoStep)} (${redondeoDireccion === 'arriba' ? 'hacia arriba' : 'al más cercano'})`;
      }
      message.success(msg);
      setFormOpen(false);
      setRedondeoOpen(false);
      listForm.resetFields();
      setEditId(null);
      setOriginalMargen(0);
      setRedondeoContext(null);
      invalidate();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Error al guardar la lista');
    } finally {
      setSaving(false);
    }
  };

  const handleAplicarRedondeo = async () => {
    if (!redondeoContext) return;
    if (redondeoContext.mode === 'recalc') {
      await performUpdate(true, redondeoStep, redondeoDireccion);
    } else {
      await performStandaloneRound(redondeoContext.listaId);
    }
  };

  const handleCancelRedondeo = () => {
    if (redondeoContext?.mode === 'recalc') {
      performUpdate(true);
    } else {
      setRedondeoOpen(false);
      setRedondeoContext(null);
    }
  };

  const performStandaloneRound = async (listaId: number) => {
    setSaving(true);
    try {
      const result = await priceListApi.roundPrices(listaId, redondeoStep, redondeoDireccion);
      const dirLabel = redondeoDireccion === 'arriba' ? 'hacia arriba' : 'al más cercano';
      if (result.affected === 0) {
        message.info(`La lista no tiene productos con precio para redondear.`);
      } else {
        message.success(
          `Precios redondeados: ${result.affected} producto(s) a múltiplos de ${fmtMoney(redondeoStep)} (${dirLabel})`
        );
      }
      setRedondeoOpen(false);
      setRedondeoContext(null);
      invalidate();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Error al redondear precios');
    } finally {
      setSaving(false);
    }
  };

  const handleRoundOpen = (record: PriceListWithStats) => {
    setRedondeoContext({ mode: 'standalone', listaId: record.LISTA_ID, listName: record.NOMBRE });
    setRedondeoStep(50);
    setRedondeoDireccion('arriba');
    setRedondeoOpen(true);
  };

  const handleSaveList = async () => {
    let values;
    try {
      values = await listForm.validateFields();
    } catch {
      return;
    }

    if (editId) {
      const margenAnterior = originalMargen;
      const margenNuevo = values.MARGEN ?? 0;
      const margenCambio = Math.abs(margenAnterior - margenNuevo) > 0.001;

      if (margenCambio) {
        modal.confirm({
          title: 'Recalcular precios',
          content: (
            <div>
              <p style={{ marginBottom: 4 }}>
                El margen cambió de <strong>{fmtNum(margenAnterior)}%</strong> a{' '}
                <strong>{fmtNum(margenNuevo)}%</strong>.
              </p>
              <p style={{ marginBottom: 0 }}>
                ¿Deseás recalcular el precio de todos los productos en esta lista
                usando el nuevo margen?
              </p>
            </div>
          ),
          okText: 'Sí, recalcular',
          cancelText: 'Solo guardar margen',
          okButtonProps: { className: 'btn-gold' },
          onOk: () => {
            setRedondeoContext({ mode: 'recalc', margenAnterior, margenNuevo });
            setRedondeoOpen(true);
          },
          onCancel: () => performUpdate(false),
        });
      } else {
        await performUpdate(false);
      }
    } else {
      setSaving(true);
      try {
        const result = await priceListApi.create({
          CODIGOPARTICULAR: values.CODIGOPARTICULAR?.trim() || null,
          NOMBRE: values.NOMBRE,
          DESCRIPCION: values.DESCRIPCION?.trim() || null,
          MARGEN: values.MARGEN ?? 0,
          ACTIVA: values.ACTIVA !== false,
          aplicarMargenInicial: values.aplicarMargenInicial !== false,
        });
        let msg = `Lista creada (#${result.LISTA_ID})`;
        if (result.productosConPrecio > 0) {
          msg += ` · ${result.productosConPrecio} producto(s) con precio inicial`;
        }
        message.success(msg);
        setFormOpen(false);
        listForm.resetFields();
        setOriginalMargen(0);
        invalidate();
      } catch (err: any) {
        message.error(err?.response?.data?.error || 'Error al crear la lista');
      } finally {
        setSaving(false);
      }
    }
  };

  // ── Ajustar Precios ───────────────────────────────
  const handleApplyOpen = (record: PriceListWithStats) => {
    setEditId(record.LISTA_ID);
    applyForm.setFieldsValue({
      porcentaje: 0,
      redondeo: 'ninguno',
      incluirInactivos: false,
      actualizarMargen: true,
    });
    setApplyOpen(true);
  };

  const handleApplyPercentage = async () => {
    if (!editId || !applyList) return;
    try {
      const values = await applyForm.validateFields();
      const porcentaje = Number(values.porcentaje);
      const margenActual = applyList.MARGEN ?? 0;
      const margenNuevo = applyActualizarMargen
        ? Math.round(margenActual * (1 + porcentaje / 100) * 100) / 100
        : null;

      modal.confirm({
        title: 'Actualizar precios de lista',
        content: (
          <div>
            <p style={{ marginBottom: applyActualizarMargen ? 4 : 0 }}>
              Se {porcentaje >= 0 ? 'aumentarán' : 'reducirán'} los precios de{' '}
              <strong>"{applyList.NOMBRE}"</strong> un{' '}
              <strong>{fmtNum(Math.abs(porcentaje))}%</strong>.
            </p>
            {applyActualizarMargen && (
              <p style={{ marginBottom: 0 }}>
                Margen actual: <strong>{fmtNum(margenActual)}%</strong> → nuevo margen:{' '}
                <strong>{fmtNum(margenNuevo ?? margenActual)}%</strong>
              </p>
            )}
          </div>
        ),
        okText: porcentaje >= 0 ? 'Aumentar' : 'Reducir',
        cancelText: 'Cancelar',
        onOk: async () => {
          setApplying(true);
          try {
            const result = await priceListApi.applyPercentage(editId, {
              porcentaje,
              incluirInactivos: values.incluirInactivos,
              redondeo: values.redondeo,
              actualizarMargen: applyActualizarMargen,
            });
            let msg = `Precios actualizados: ${result.affected} producto(s)`;
            if (result.margenActualizado && result.margenNuevo != null) {
              msg += ` · Margen: ${fmtNum(result.margenAnterior ?? margenActual)}% → ${fmtNum(result.margenNuevo)}%`;
            }
            message.success(msg);
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

  // ── Tabla ─────────────────────────────────────────
  const handleListTableChange = (_pagination: any, _filters: any, sorter: any) => {
    const colMap: Record<string, string> = {
      LISTA_ID: 'LISTA_ID', CODIGOPARTICULAR: 'CODIGOPARTICULAR', NOMBRE: 'NOMBRE', MARGEN: 'MARGEN',
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
    { title: 'Con precio', dataIndex: 'productosConPrecio', key: 'productosConPrecio', width: 120, align: 'center' },
    { title: 'Precio promedio', dataIndex: 'precioPromedio', key: 'precioPromedio', width: 160, align: 'center', render: (v: number) => fmtMoney(v) },
    {
      title: 'Estado', dataIndex: 'ACTIVA', key: 'ACTIVA', width: 95,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Activa' : 'Inactiva'}</Tag>,
    },
  ];

  const contextMenuActions = useMemo<RowAction<PriceListWithStats>[]>(() => [
    { key: 'apply', label: 'Ajustar precios', icon: <PercentageOutlined />, onClick: handleApplyOpen },
    { key: 'round', label: 'Redondear precios', icon: <RiseOutlined />, onClick: handleRoundOpen },
    { key: 'edit', label: 'Editar', icon: <EditOutlined />, onClick: handleEditList },
    { type: 'divider' },
    { key: 'delete', label: 'Eliminar', icon: <DeleteOutlined />, danger: true, onClick: handleDelete },
  ], []);

  const { onRow, rowClassName, contextMenu, contextMenuItems, closeContextMenu } = useRowActions<PriceListWithStats>({
    getRowId: (r) => r.LISTA_ID,
    primaryAction: handleEditList,
    actions: contextMenuActions,
  });

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
            icon={<PlusOutlined />}
            onClick={handleNew}
          >
            Nueva Lista
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
        onRow={onRow}
        rowClassName={rowClassName}
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

      <RowContextMenu
        open={contextMenu !== null}
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        items={contextMenuItems}
        onClose={closeContextMenu}
      />

      {/* ── Crear / Editar lista ──────────────────── */}
      <Modal
        title={editId ? `Editar Lista #${editId}` : 'Nueva Lista de Precio'}
        open={formOpen}
        onCancel={() => { setFormOpen(false); setEditId(null); setOriginalMargen(0); listForm.resetFields(); }}
        onOk={handleSaveList}
        okText={editId ? 'Guardar Cambios' : 'Crear Lista'}
        cancelText="Cancelar"
        confirmLoading={saving}
        width={560}
        destroyOnClose
        className="rg-modal"
      >
        {editId && editLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : (
          <Form form={listForm} layout="vertical" size="middle">
            <Form.Item
              name="CODIGOPARTICULAR"
              label="Código"
              tooltip="Identificador opcional. Si lo dejás vacío se asigna el ID numérico."
            >
              <Input placeholder="Se autogenera si se deja vacío" />
            </Form.Item>
            <Form.Item name="NOMBRE" label="Nombre" rules={[{ required: true, whitespace: true, message: 'Ingresá el nombre de la lista' }]}>
              <Input placeholder="Ej. Minorista, Mayorista, Promo..." />
            </Form.Item>
            <Form.Item name="DESCRIPCION" label="Descripción">
              <Input.TextArea rows={3} placeholder="Notas internas sobre el uso de esta lista" />
            </Form.Item>
            <Form.Item
              name="MARGEN"
              label="Margen por defecto"
              tooltip="Margen que se aplica por defecto a productos nuevos que se asignen a esta lista."
              rules={[{ required: true, message: 'Ingresá el margen' }]}
            >
              <InputNumber min={-99.99} max={1000} precision={2} addonAfter="%" style={{ width: '100%' }} />
            </Form.Item>
            {!editId && (
              <Form.Item
                name="aplicarMargenInicial"
                label="Inicializar precios con este margen"
                valuePropName="checked"
                extra="Genera automáticamente el precio de cada producto (costo × (1 + margen/100)) para esta nueva lista."
              >
                <Switch />
              </Form.Item>
            )}
            <Form.Item name="ACTIVA" label="Activa" valuePropName="checked" extra="Las listas inactivas no aparecen al elegir lista predeterminada en productos.">
              <Switch />
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* ── Redondeo (post-recálculo o standalone) ─── */}
      <Modal
        title={
          redondeoContext?.mode === 'standalone'
            ? `Redondear precios — ${redondeoContext.listName}`
            : 'Redondear precios'
        }
        open={redondeoOpen}
        onCancel={handleCancelRedondeo}
        onOk={handleAplicarRedondeo}
        okText="Aplicar redondeo"
        cancelText={redondeoContext?.mode === 'recalc' ? 'No redondear' : 'Cancelar'}
        confirmLoading={saving}
        width={480}
        destroyOnClose
        className="rg-modal"
      >
        {redondeoContext?.mode === 'recalc' && (
          <>
            <p style={{ marginBottom: 12 }}>
              Los precios se recalcularán con el margen{' '}
              <strong>{fmtNum(redondeoContext.margenNuevo)}%</strong>.
            </p>
            <p style={{ marginBottom: 16 }}>
              ¿Querés redondear los precios actualizados?
            </p>
          </>
        )}
        {redondeoContext?.mode === 'standalone' && (
          <p style={{ marginBottom: 16 }}>
            Se redondearán los precios actuales de la lista{' '}
            <strong>"{redondeoContext.listName}"</strong> según el paso y la dirección que elijas.
          </p>
        )}
        <Form layout="vertical" size="middle">
          <Form.Item label="Redondear a" style={{ marginBottom: 12 }}>
            <Radio.Group
              value={redondeoStep}
              onChange={e => setRedondeoStep(e.target.value)}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value={50}>$ 50</Radio.Button>
              <Radio.Button value={100}>$ 100</Radio.Button>
              <Radio.Button value={500}>$ 500</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item label="Dirección" style={{ marginBottom: 0 }}>
            <Radio.Group
              value={redondeoDireccion}
              onChange={e => setRedondeoDireccion(e.target.value)}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio.Button value="arriba">Para arriba</Radio.Button>
              <Radio.Button value="cercano">Más cercano</Radio.Button>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Ajustar precios lista ─────────────────── */}
      <Modal
        title={applyList ? `${isAumento ? 'Aumentar' : 'Reducir'} precios — ${applyList.NOMBRE}` : 'Ajustar precios'}
        open={applyOpen}
        onCancel={() => setApplyOpen(false)}
        onOk={handleApplyPercentage}
        okText={isAumento ? 'Aplicar Aumento' : 'Aplicar Reducción'}
        cancelText="Cancelar"
        confirmLoading={applying}
        width={520}
        destroyOnClose
        className="rg-modal"
      >
        <Form
          form={applyForm}
          layout="vertical"
          size="middle"
          initialValues={{ porcentaje: 0, redondeo: 'ninguno', incluirInactivos: false, actualizarMargen: true }}
        >
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
          <Divider style={{ margin: '8px 0 16px' }} />
          <Form.Item
            name="actualizarMargen"
            label="Aplicar el mismo porcentaje al margen de la lista"
            valuePropName="checked"
            extra="Afecta al margen que se utiliza como base para nuevos productos en esta lista."
          >
            <Switch />
          </Form.Item>
          {applyActualizarMargen && applyList && (
            <div
              style={{
                background: '#fafafa',
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                padding: '10px 12px',
                fontSize: 13,
                color: 'rgba(0,0,0,0.65)',
              }}
            >
              Margen actual: <strong>{fmtNum(applyList.MARGEN ?? 0)}%</strong>
              {' → '}
              nuevo margen:{' '}
              <strong>
                {fmtNum(
                  Math.round(((applyList.MARGEN ?? 0) * (1 + (applyPorcentaje ?? 0) / 100)) * 100) / 100
                )}%
              </strong>
            </div>
          )}
        </Form>
      </Modal>
    </div>
  );
}
