import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Modal, Table, Tag, Typography, Select, Space, Tooltip,
} from 'antd';
import type { TableColumnType } from 'antd';
import {
  ArrowUpOutlined, ArrowDownOutlined, SwapOutlined,
} from '@ant-design/icons';
import { stockApi, type StockHistorialItem } from '../../services/stock.api';
import { fmtNum } from '../../utils/format';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  productoId: number | null;
  productoNombre: string;
}

const TIPO_LABELS: Record<string, { label: string; color: string }> = {
  VENTA:            { label: 'Venta',              color: 'red' },
  COMPRA:           { label: 'Compra',             color: 'green' },
  AJUSTE_MANUAL:    { label: 'Ajuste Manual',      color: 'blue' },
  REMITO:           { label: 'Remito',             color: 'purple' },
  NC_COMPRA:        { label: 'NC Compra',          color: 'orange' },
  TRANSFERENCIA:    { label: 'Transferencia',      color: 'cyan' },
};

export function StockHistoryModal({ open, onClose, productoId, productoNombre }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [depositoId, setDepositoId] = useState<number | undefined>();

  const { data, isLoading } = useQuery({
    queryKey: ['stock-history', productoId, depositoId, page, pageSize],
    queryFn: () => stockApi.getHistory(productoId!, { depositoId, page, pageSize }),
    enabled: !!productoId && open,
  });

  const { data: depositos } = useQuery({
    queryKey: ['stock-depositos'],
    queryFn: () => stockApi.getDepositos(),
  });

  const columns: TableColumnType<StockHistorialItem>[] = [
    {
      title: 'Fecha',
      dataIndex: 'FECHA',
      key: 'FECHA',
      width: 145,
      align: 'center',
      render: (fecha: string) => {
        const d = new Date(fecha);
        return (
          <Tooltip title={d.toLocaleString('es-AR')}>
            <Text>
              {d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              {' '}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}
              </Text>
            </Text>
          </Tooltip>
        );
      },
    },
    {
      title: 'Tipo',
      dataIndex: 'TIPO_OPERACION',
      key: 'TIPO_OPERACION',
      align: 'center',
      width: 140,
      render: (tipo: string) => {
        const cfg = TIPO_LABELS[tipo] || { label: tipo, color: 'default' };
        return <Tag color={cfg.color}>{cfg.label}</Tag>;
      },
    },
    {
      title: 'Depósito',
      dataIndex: 'DEPOSITO_NOMBRE',
      key: 'DEPOSITO_NOMBRE',
      align: 'center',
      width: 150,
      ellipsis: true,
    },
    {
      title: 'Anterior',
      dataIndex: 'CANTIDAD_ANTERIOR',
      key: 'CANTIDAD_ANTERIOR',
      width: 105,
      align: 'center',
      render: (v: number) => <Text type="secondary">{fmtNum(v)}</Text>,
    },
    {
      title: '+ -',
      dataIndex: 'DIFERENCIA',
      key: 'DIFERENCIA',
      width: 105,
      align: 'center',
      render: (dif: number) => {
        if (dif === 0) return <Tag icon={<SwapOutlined />}>0</Tag>;
        return (
          <Tag
            color={dif > 0 ? 'green' : 'red'}
            icon={dif > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            style={{ fontWeight: 600 }}
          >
            {dif > 0 ? '+' : ''}{fmtNum(dif)}
          </Tag>
        );
      },
    },
    {
      title: 'Nuevo',
      dataIndex: 'CANTIDAD_NUEVA',
      key: 'CANTIDAD_NUEVA',
      width: 85,
      align: 'center',
      render: (v: number) => <Text strong>{fmtNum(v)}</Text>,
    },
    {
      title: 'Detalle',
      dataIndex: 'REFERENCIA_DETALLE',
      key: 'REFERENCIA_DETALLE',
      ellipsis: true,
      render: (detalle: string | null, record: StockHistorialItem) => (
        <Space direction="vertical" size={0} style={{ lineHeight: 1.3 }}>
          {detalle && <Text style={{ fontSize: 13 }}>{detalle}</Text>}
          {record.OBSERVACIONES && <Text type="secondary" style={{ fontSize: 12 }} italic>{record.OBSERVACIONES}</Text>}
          {record.USUARIO_NOMBRE && <Text type="secondary" style={{ fontSize: 11 }}>Por: {record.USUARIO_NOMBRE}</Text>}
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title={
        <Space>
          <Text>Historial de Stock</Text>
          {productoNombre && <Tag>{productoNombre}</Tag>}
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={1000}
      centered
      destroyOnClose
      styles={{ body: { maxHeight: 'calc(80dvh - 120px)', overflowY: 'auto', paddingRight: 4 } }}
    >
      {/* Filter by deposit */}
      <Space style={{ marginBottom: 12 }}>
        <Select
          placeholder="Filtrar por depósito"
          value={depositoId}
          onChange={(v) => { setDepositoId(v); setPage(1); }}
          style={{ width: 200 }}
          allowClear
          options={depositos?.map(d => ({ label: d.NOMBRE, value: d.DEPOSITO_ID }))}
        />
        {data && (
          <Tag>{data.total} movimiento{data.total !== 1 ? 's' : ''}</Tag>
        )}
      </Space>

      <Table
        className="rg-table"
        dataSource={data?.data || []}
        columns={columns}
        rowKey="HISTORIAL_ID"
        loading={isLoading}
        size="small"
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          pageSizeOptions: ['10', '15', '25', '50'],
          showTotal: (total) => `${total} registros`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </Modal>
  );
}
