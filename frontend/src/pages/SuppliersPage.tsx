import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Space, Input, Typography, Tag, Drawer, Descriptions, Spin } from 'antd';
import { SearchOutlined, EyeOutlined } from '@ant-design/icons';
import { supplierApi } from '../services/supplier.api';
import type { Proveedor } from '../types';

const { Title } = Typography;

export function SuppliersPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', page, pageSize, search],
    queryFn: () => supplierApi.getAll({ page, pageSize, search: search || undefined }),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['supplier', selectedId],
    queryFn: () => supplierApi.getById(selectedId!),
    enabled: !!selectedId,
  });

  const openDetail = (record: Proveedor) => {
    setSelectedId(record.PROVEEDOR_ID);
    setDrawerOpen(true);
  };

  const columns = [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', key: 'code', width: 100 },
    { title: 'Nombre', dataIndex: 'NOMBRE', key: 'name' },
    { title: 'Teléfono', dataIndex: 'TELEFONO', key: 'phone', width: 130 },
    { title: 'Email', dataIndex: 'EMAIL', key: 'email', ellipsis: true },
    { title: 'Ciudad', dataIndex: 'CIUDAD', key: 'city', width: 120 },
    {
      title: 'Cta Cte',
      dataIndex: 'CTA_CORRIENTE',
      key: 'ctacte',
      width: 80,
      render: (v: boolean) => v ? <Tag color="blue">Sí</Tag> : <Tag>No</Tag>,
    },
    {
      title: 'Estado',
      dataIndex: 'ACTIVO',
      key: 'active',
      width: 90,
      render: (v: boolean) => <Tag color={v ? 'green' : 'red'}>{v ? 'Activo' : 'Inactivo'}</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      render: (_: unknown, record: Proveedor) => (
        <EyeOutlined style={{ cursor: 'pointer', color: '#EABD23' }} onClick={() => openDetail(record)} />
      ),
    },
  ];

  return (
    <div className="page-enter">
      <div className="page-header">
        <Title level={3}>Proveedores</Title>
        <Space>
          <Input
            placeholder="Buscar nombre, código..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ width: 300 }}
            allowClear
          />
        </Space>
      </div>

      <Table
        className="rg-table"
        columns={columns}
        dataSource={data?.data}
        rowKey="PROVEEDOR_ID"
        loading={isLoading}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          showTotal: (total) => `Total: ${total} registros`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
        size="middle"
        scroll={{ x: 800 }}
      />

      <Drawer
        title="Detalle del Proveedor"
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={520}
        className="rg-drawer"
      >
        {detailLoading ? <Spin /> : detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Código">{detail.CODIGOPARTICULAR}</Descriptions.Item>
            <Descriptions.Item label="Nombre">{detail.NOMBRE}</Descriptions.Item>
            <Descriptions.Item label="Tipo Doc.">{detail.TIPO_DOCUMENTO || '-'}</Descriptions.Item>
            <Descriptions.Item label="Nro. Doc.">{detail.NUMERO_DOC || '-'}</Descriptions.Item>
            <Descriptions.Item label="Dirección">{detail.DIRECCION || '-'}</Descriptions.Item>
            <Descriptions.Item label="Ciudad">{detail.CIUDAD || '-'}</Descriptions.Item>
            <Descriptions.Item label="CP">{detail.CP || '-'}</Descriptions.Item>
            <Descriptions.Item label="Teléfono">{detail.TELEFONO || '-'}</Descriptions.Item>
            <Descriptions.Item label="Email">{detail.EMAIL || '-'}</Descriptions.Item>
            <Descriptions.Item label="Cta. Corriente">{detail.CTA_CORRIENTE ? 'Sí' : 'No'}</Descriptions.Item>
            <Descriptions.Item label="Estado">
              <Tag color={detail.ACTIVO ? 'green' : 'red'}>{detail.ACTIVO ? 'Activo' : 'Inactivo'}</Tag>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
