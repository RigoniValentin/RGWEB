import { useMemo, useState } from 'react';
import { Modal, Table, Input, Tag, Typography, Empty, Space, Button } from 'antd';
import { SearchOutlined, BankOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { chequesApi } from '../../services/cheques.api';
import { fmtMoney } from '../../utils/format';
import type { Cheque } from '../../types';

const { Text } = Typography;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Devuelve los IDs de cheques seleccionados (estado EN_CARTERA) y el total. */
  onConfirm: (ids: number[], total: number) => void;
  /** IDs ya pre-seleccionados (para edición / re-apertura). */
  initialSelectedIds?: number[];
  title?: string;
}

/** Selector reutilizable de cheques EN_CARTERA, usado en pagos a proveedores. */
export function ChequePicker({ open, onClose, onConfirm, initialSelectedIds = [], title }: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>(initialSelectedIds);

  const { data: cheques = [], isLoading } = useQuery({
    queryKey: ['cheques-cartera'],
    queryFn: () => chequesApi.getEnCartera(),
    enabled: open,
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cheques;
    return cheques.filter(c =>
      c.NUMERO?.toLowerCase().includes(q) ||
      c.LIBRADOR?.toLowerCase().includes(q) ||
      c.BANCO?.toLowerCase().includes(q)
    );
  }, [cheques, search]);

  const total = useMemo(() => {
    const set = new Set(selected);
    return cheques.filter(c => set.has(c.CHEQUE_ID)).reduce((s, c) => s + (Number(c.IMPORTE) || 0), 0);
  }, [selected, cheques]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      width={780}
      title={
        <Space>
          <BankOutlined style={{ color: '#EABD23' }} />
          <span>{title || 'Seleccionar cheques en cartera'}</span>
        </Space>
      }
      footer={[
        <Button key="cancel" onClick={onClose}>Cancelar</Button>,
        <Button
          key="ok"
          type="primary"
          className="btn-gold"
          disabled={selected.length === 0}
          onClick={() => onConfirm(selected, total)}
        >
          Usar {selected.length} cheque{selected.length === 1 ? '' : 's'} — {fmtMoney(total)}
        </Button>,
      ]}
      destroyOnClose
    >
      <Input
        prefix={<SearchOutlined />}
        placeholder="Buscar por número, librador o banco"
        value={search}
        onChange={e => setSearch(e.target.value)}
        allowClear
        style={{ marginBottom: 12 }}
      />
      <Table<Cheque>
        rowKey="CHEQUE_ID"
        dataSource={filtered}
        loading={isLoading}
        size="small"
        pagination={{ pageSize: 8, hideOnSinglePage: true }}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: keys => setSelected(keys as number[]),
        }}
        locale={{ emptyText: <Empty description="No hay cheques en cartera" /> }}
        columns={[
          { title: 'N°', dataIndex: 'NUMERO', width: 100 },
          { title: 'Banco', dataIndex: 'BANCO' },
          { title: 'Librador', dataIndex: 'LIBRADOR' },
          {
            title: 'Vencimiento',
            dataIndex: 'FECHA_PRESENTACION',
            width: 120,
            render: (v: string | null) => v ? new Date(v).toLocaleDateString('es-AR') : <Text type="secondary">—</Text>,
          },
          {
            title: 'Importe',
            dataIndex: 'IMPORTE',
            width: 130,
            align: 'right',
            render: (v: number) => <Text strong>{fmtMoney(v)}</Text>,
          },
          { title: '', dataIndex: 'ESTADO', width: 90, render: () => <Tag color="gold">CARTERA</Tag> },
        ]}
      />
    </Modal>
  );
}
