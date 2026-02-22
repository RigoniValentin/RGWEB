import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, Space, Input, Typography, Tag, Drawer, Descriptions, Spin } from 'antd';
import { SearchOutlined, EyeOutlined } from '@ant-design/icons';
import { customerApi } from '../services/customer.api';
import { fmtMoney } from '../utils/format';
import type { Cliente } from '../types';

const { Title } = Typography;

export function CustomersPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ── List query ─────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['customers', page, pageSize, search],
    queryFn: () => customerApi.getAll({ page, pageSize, search: search || undefined }),
  });

  // ── Detail query ───────────────────────────────
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['customer', selectedId],
    queryFn: () => customerApi.getById(selectedId!),
    enabled: !!selectedId,
  });

  // ── Cta corriente ──────────────────────────────
  const { data: ctaCorriente } = useQuery({
    queryKey: ['customer-cta', selectedId],
    queryFn: () => customerApi.getCtaCorriente(selectedId!),
    enabled: !!selectedId,
  });

  const openDetail = (record: Cliente) => {
    setSelectedId(record.CLIENTE_ID);
    setDrawerOpen(true);
  };

  // ── Columns ────────────────────────────────────
  const columns = [
    { title: 'Código', dataIndex: 'CODIGOPARTICULAR', key: 'code', width: 100 },
    { title: 'Nombre', dataIndex: 'NOMBRE', key: 'name' },
    { title: 'Documento', key: 'doc', width: 130, render: (_: unknown, r: Cliente) => r.NUMERO_DOC ? `${r.TIPO_DOCUMENTO} ${r.NUMERO_DOC}` : '-' },
    { title: 'Teléfono', dataIndex: 'TELEFONO', key: 'phone', width: 130 },
    { title: 'Email', dataIndex: 'EMAIL', key: 'email', ellipsis: true },
    { title: 'Provincia', dataIndex: 'PROVINCIA', key: 'prov', width: 120 },
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
      render: (_: unknown, record: Cliente) => (
        <EyeOutlined style={{ cursor: 'pointer', color: '#EABD23' }} onClick={() => openDetail(record)} />
      ),
    },
  ];

  return (
    <div className="page-enter">
      <div className="page-header">
        <Title level={3}>Clientes</Title>
        <Space>
          <Input
            placeholder="Buscar nombre, código, documento..."
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
        rowKey="CLIENTE_ID"
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
        scroll={{ x: 900 }}
      />

      {/* ── Detail Drawer ─────────────────────── */}
      <Drawer
        title="Detalle del Cliente"
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setSelectedId(null); }}
        width={520}
        className="rg-drawer"
      >
        {detailLoading ? <Spin /> : detail && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Código">{detail.CODIGOPARTICULAR}</Descriptions.Item>
            <Descriptions.Item label="Nombre">{detail.NOMBRE}</Descriptions.Item>
            <Descriptions.Item label="Tipo Doc.">{detail.TIPO_DOCUMENTO}</Descriptions.Item>
            <Descriptions.Item label="Nro. Doc.">{detail.NUMERO_DOC}</Descriptions.Item>
            <Descriptions.Item label="Cond. IVA">{detail.CONDICION_IVA}</Descriptions.Item>
            <Descriptions.Item label="Domicilio">{detail.DOMICILIO}</Descriptions.Item>
            <Descriptions.Item label="Provincia">{detail.PROVINCIA}</Descriptions.Item>
            <Descriptions.Item label="Teléfono">{detail.TELEFONO}</Descriptions.Item>
            <Descriptions.Item label="Email">{detail.EMAIL}</Descriptions.Item>
            <Descriptions.Item label="Cta. Corriente">{detail.CTA_CORRIENTE ? 'Sí' : 'No'}</Descriptions.Item>
            <Descriptions.Item label="Estado">
              <Tag color={detail.ACTIVO ? 'green' : 'red'}>{detail.ACTIVO ? 'Activo' : 'Inactivo'}</Tag>
            </Descriptions.Item>
          </Descriptions>
        )}

        {ctaCorriente && (
          <div style={{ marginTop: 24 }}>
            <Title level={5}>Cuenta Corriente</Title>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="Saldo">
                <span style={{ fontWeight: 'bold', color: ctaCorriente.saldo > 0 ? '#f5222d' : '#52c41a' }}>
                  {fmtMoney(ctaCorriente.saldo)}
                </span>
              </Descriptions.Item>
            </Descriptions>
          </div>
        )}
      </Drawer>
    </div>
  );
}
