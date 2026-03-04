import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Modal, Table, Button, Space, Typography, Input,
  Tag, message, Alert,
} from 'antd';
import {
  SaveOutlined, SearchOutlined,
  CheckCircleOutlined, WarningOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { purchasesApi, type PriceCheckProduct, type PriceCheckUpdate } from '../../services/purchases.api';
import { ProductPriceEditorModal } from './ProductPriceEditorModal';

const { Text } = Typography;

interface Props {
  open: boolean;
  compraId: number | null;
  onClose: () => void;
}

interface ProductRow extends PriceCheckProduct {
  LISTA_1_ORIG: number;
  LISTA_2_ORIG: number;
  LISTA_3_ORIG: number;
  LISTA_4_ORIG: number;
  LISTA_5_ORIG: number;
  MODIFICADO: boolean;
}

export function PriceCheckModal({ open, compraId, onClose }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [searchText, setSearchText] = useState('');
  const [listNames, setListNames] = useState<Record<number, string>>({});
  const [listMargins, setListMargins] = useState<Record<number, number>>({});
  const [impIntGravaIva, setImpIntGravaIva] = useState(false);
  const [editorProduct, setEditorProduct] = useState<PriceCheckProduct | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  // ── Fetch price check data ─────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['price-check', compraId],
    queryFn: () => purchasesApi.getPriceCheckData(compraId!),
    enabled: open && !!compraId,
  });

  // Initialize products when data arrives
  useEffect(() => {
    if (data) {
      setListNames(data.listNames);
      setListMargins(data.listMargins || {});
      setImpIntGravaIva(data.impIntGravaIva);
      setProducts(data.products.map(p => ({
        ...p,
        LISTA_1_ORIG: p.LISTA_1,
        LISTA_2_ORIG: p.LISTA_2,
        LISTA_3_ORIG: p.LISTA_3,
        LISTA_4_ORIG: p.LISTA_4,
        LISTA_5_ORIG: p.LISTA_5,
        MODIFICADO: false,
      })));
    }
  }, [data]);

  // ── Save mutation ──────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (updates: PriceCheckUpdate[]) => purchasesApi.savePriceCheck(updates),
    onSuccess: (result) => {
      message.success(`Se actualizaron los precios de ${result.updated} producto(s)`);
      onClose();
    },
    onError: (err: any) => {
      message.error(err.response?.data?.error || 'Error al guardar precios');
    },
  });

  // ── Handle product editor save ─────────────────
  const handleProductSave = useCallback((update: {
    PRODUCTO_ID: number;
    LISTA_1: number; LISTA_2: number; LISTA_3: number;
    LISTA_4: number; LISTA_5: number;
  }) => {
    setProducts(prev => prev.map(p => {
      if (p.PRODUCTO_ID !== update.PRODUCTO_ID) return p;
      const updated: ProductRow = {
        ...p,
        LISTA_1: update.LISTA_1,
        LISTA_2: update.LISTA_2,
        LISTA_3: update.LISTA_3,
        LISTA_4: update.LISTA_4,
        LISTA_5: update.LISTA_5,
      };
      // Check if any list differs from original
      let modified = false;
      for (let i = 1; i <= 5; i++) {
        const orig = (updated as any)[`LISTA_${i}_ORIG`];
        const curr = (updated as any)[`LISTA_${i}`];
        if (Math.abs(curr - orig) > 0.01) { modified = true; break; }
      }
      updated.MODIFICADO = modified;
      return updated;
    }));
    setEditorOpen(false);
    setEditorProduct(null);
    message.success('Precios del producto actualizados');
  }, []);

  // ── Open editor with current product state ─────
  const openEditor = useCallback((record: ProductRow) => {
    const productWithCurrentPrices: PriceCheckProduct = {
      ...record,
      LISTA_1: record.LISTA_1,
      LISTA_2: record.LISTA_2,
      LISTA_3: record.LISTA_3,
      LISTA_4: record.LISTA_4,
      LISTA_5: record.LISTA_5,
    };
    setEditorProduct(productWithCurrentPrices);
    setEditorOpen(true);
  }, []);

  // ── Derived data ───────────────────────────────
  const filteredProducts = useMemo(() => {
    if (!searchText.trim()) return products;
    const s = searchText.trim().toLowerCase();
    return products.filter(p =>
      p.CODIGO.toLowerCase().includes(s) ||
      p.DESCRIPCION.toLowerCase().includes(s)
    );
  }, [products, searchText]);

  const modifiedCount = useMemo(() => products.filter(p => p.MODIFICADO).length, [products]);
  const hasCambios = modifiedCount > 0;
  const sinMargenes = useMemo(() => products.filter(p => !p.TIENE_MARGENES_INDIV).length, [products]);

  // ── Handle save all ────────────────────────────
  const handleSaveAll = () => {
    const modified = products.filter(p => p.MODIFICADO);
    if (modified.length === 0) {
      onClose();
      return;
    }

    const updates: PriceCheckUpdate[] = modified.map(p => ({
      PRODUCTO_ID: p.PRODUCTO_ID,
      LISTA_1: p.LISTA_1,
      LISTA_2: p.LISTA_2,
      LISTA_3: p.LISTA_3,
      LISTA_4: p.LISTA_4,
      LISTA_5: p.LISTA_5,
    }));

    saveMutation.mutate(updates);
  };

  // ── Handle close ───────────────────────────────
  const handleClose = () => {
    if (hasCambios) {
      Modal.confirm({
        title: 'Cambios sin guardar',
        content: `Hay ${modifiedCount} producto(s) con precios modificados sin guardar. ¿Desea salir sin guardar?`,
        okText: 'Salir sin guardar',
        cancelText: 'Seguir editando',
        okButtonProps: { danger: true },
        onOk: () => {
          setProducts([]);
          setSearchText('');
          onClose();
        },
      });
    } else {
      setProducts([]);
      setSearchText('');
      onClose();
    }
  };

  // ── Table columns ──────────────────────────────
  const columns: any[] = [
    {
      title: 'Código',
      dataIndex: 'CODIGO',
      width: 100,
      align: 'center' as const,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Producto',
      dataIndex: 'DESCRIPCION',
      ellipsis: true,
    },
{
      title: '',
      width: 110,
      align: 'center' as const,
      render: (_: unknown, record: ProductRow) => (
        <Button
          type="link"
          size="small"
          icon={<EditOutlined />}
          onClick={() => openEditor(record)}
        >
          Chequear
        </Button>
      ),
    },
    {
      title: '',
      width: 50,
      align: 'center' as const,
      render: (_: unknown, record: ProductRow) =>
        record.MODIFICADO
          ? <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />
          : null,
    },
    
  ];

  return (
    <>
      <Modal
        open={open}
        onCancel={handleClose}
        title={
          <Space>
            <CheckCircleOutlined style={{ color: '#1890ff' }} />
            <span>Chequeo de Precios — Compra #{compraId}</span>
          </Space>
        }
        width={820}
        centered
        styles={{ body: { padding: '12px 16px', maxHeight: 'calc(100vh - 200px)', overflow: 'auto' } }}
        footer={
          <Space style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
            <Space>
              <Text type="secondary">
                {products.length} productos
              </Text>
              {hasCambios && (
                <Tag color="green">{modifiedCount} modificado(s)</Tag>
              )}
            </Space>
            <Space>
              <Button onClick={handleClose}>
                {hasCambios ? 'Cerrar sin guardar' : 'Cerrar'}
              </Button>
              {hasCambios && (
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={saveMutation.isPending}
                  onClick={handleSaveAll}
                  className="btn-gold"
                >
                  Guardar {modifiedCount} cambio(s)
                </Button>
              )}
            </Space>
          </Space>
        }
        destroyOnClose
      >
        {/* Warnings */}
        {sinMargenes > 0 && (
          <Alert
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            message={`${sinMargenes} producto(s) sin márgenes individuales — se usarán los márgenes de lista al recalcular`}
            style={{ marginBottom: 12 }}
          />
        )}

        {/* Search */}
        <Input
          placeholder="Buscar por código o descripción..."
          prefix={<SearchOutlined />}
          allowClear
          value={searchText}
          onChange={e => setSearchText(e.target.value)}
          style={{ marginBottom: 12 }}
        />

        {/* Products table */}
        <Table
          className="price-check-table"
          dataSource={filteredProducts}
          columns={columns}
          rowKey="PRODUCTO_ID"
          loading={isLoading}
          size="small"
          pagination={false}
          scroll={{ y: 'calc(100vh - 420px)' }}
          rowClassName={(record: ProductRow) => record.MODIFICADO ? 'price-check-row-modified' : ''}
        />

        <style>{`
          .price-check-table .ant-table-body {
            overflow-x: hidden !important;
          }
          .price-check-row-modified {
            background-color: #f6ffed !important;
          }
          .price-check-row-modified td {
            background-color: #f6ffed !important;
          }
          .price-check-row-modified:hover td {
            background-color: #d9f7be !important;
          }
        `}</style>
      </Modal>

      {/* Product price editor modal */}
      <ProductPriceEditorModal
        open={editorOpen}
        product={editorProduct}
        listNames={listNames}
        listMargins={listMargins}
        impIntGravaIva={impIntGravaIva}
        onClose={() => { setEditorOpen(false); setEditorProduct(null); }}
        onSave={handleProductSave}
      />
    </>
  );
}
