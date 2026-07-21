import { Modal, Alert, Button, Table, Spin, Empty, Typography } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { purchasesApi } from '../../services/purchases.api';

const { Text } = Typography;

export interface RemitoPickerModalProps {
  open: boolean;
  proveedorId: number | null;
  onClose: () => void;
  onSelect: (remito: {
    REMITO_ID: number; PTO_VTA: string; NRO_REMITO: string;
    FECHA: string; TOTAL: number; PROVEEDOR_ID: number | null;
  }) => void;
}

export function RemitoPickerModal({ open, proveedorId, onClose, onSelect }: RemitoPickerModalProps) {
  const { data: remitos = [], isLoading } = useQuery({
    queryKey: ['remitos-sin-compra', proveedorId],
    queryFn: () => purchasesApi.getRemitosSinCompraAsociada(proveedorId ?? undefined),
    enabled: open,
    staleTime: 30000,
  });

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title={
        <span>
          <LinkOutlined /> Remitos de entrada sin compra asociada
        </span>
      }
      width={720}
      destroyOnClose
    >
      {proveedorId ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Filtrado por el proveedor seleccionado."
        />
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="Mostrando todos los remitos sin compra. Si asocia uno con proveedor, la compra adoptará ese proveedor automáticamente."
        />
      )}

      {isLoading ? (
        <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
      ) : remitos.length === 0 ? (
        <Empty description="No hay remitos de entrada pendientes de asociar a una compra" />
      ) : (
        <Table
          rowKey="REMITO_ID"
          size="middle"
          pagination={{ pageSize: 8, showSizeChanger: false }}
          dataSource={remitos}
          columns={[
            {
              title: 'Comprobante',
              key: 'comp',
              render: (_: any, r: any) => (
                <Text strong>{r.PTO_VTA}-{r.NRO_REMITO}</Text>
              ),
            },
            {
              title: 'Fecha',
              dataIndex: 'FECHA',
              key: 'fecha',
              render: (f: string) => dayjs(f).format('DD/MM/YYYY'),
              width: 110,
            },
            {
              title: 'Proveedor',
              dataIndex: 'PROVEEDOR_NOMBRE',
              key: 'prov',
              render: (v: string | null) => v || <Text type="secondary">—</Text>,
            },
            {
              title: '',
              key: 'actions',
              align: 'center',
              width: 110,
              render: (_: any, r: any) => (
                <Button type="primary" size="small" onClick={() => onSelect(r)}>
                  Seleccionar
                </Button>
              ),
            },
          ]}
        />
      )}
    </Modal>
  );
}