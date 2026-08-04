import { Alert, List, Modal, Space, Tag, Typography } from 'antd';
import { WarningFilled, CloseCircleFilled } from '@ant-design/icons';
import type { StockIssue } from '../../hooks/useStockValidator';
import { RGCajaModalHeader } from '../RGCajaModalHeader';
import { rgIcon } from '../rg-icons';

const { Text } = Typography;

interface Props {
  open: boolean;
  issues: StockIssue[];
  /** Acción principal: ajusta cantidades al stock y deja que el flujo continúe. */
  onAccept: () => void;
  onCancel: () => void;
}

/**
 * Modal estilo message box de escritorio que se muestra cuando el usuario
 * intenta finalizar una venta con productos que exceden el stock disponible.
 *
 * Al confirmar, las cantidades se ajustan al stock disponible y la venta
 * continúa con el flujo que haya disparado el modal (cobrar / guardar / confirmar).
 *
 * Es NO BLOQUEANTE para el usuario: si cancela, puede ir al carrito y
 * editar las cantidades manualmente.
 */
export function StockInsuficienteModal({
  open, issues, onAccept, onCancel,
}: Props) {
  const total = issues.length;
  const totalExcedente = issues.reduce((s, i) => s + i.excedente, 0);

  return (
    <Modal
      open={open}
      onCancel={onCancel}
      title={
        <RGCajaModalHeader
          icon={rgIcon('warning')}
          title="Stock insuficiente"
          subtitle={`${total} producto${total > 1 ? 's' : ''} exceden el stock disponible`}
        />
      }
      centered
      width={520}
      maskClosable={false}
      keyboard
      className="rg-modal stock-insuficiente-modal"
      okText={`Ajustar y continuar (${total})`}
      cancelText="Volver al carrito"
      onOk={onAccept}
      okButtonProps={{
        danger: true,
        size: 'large',
        style: { minWidth: 180, fontWeight: 600 },
      }}
      cancelButtonProps={{
        size: 'large',
        style: { minWidth: 120 },
      }}
      styles={{
        body: { paddingTop: 4 },
        footer: { marginTop: 12 },
      }}
    >
      <Alert
        type="error"
        showIcon
        icon={<WarningFilled style={{ fontSize: 20, color: '#cf1322' }} />}
        message={
          <Text strong style={{ color: '#a8071a' }}>
            No es posible continuar con la operación tal como está.
          </Text>
        }
        description={
          <Text style={{ color: '#5c0011', fontSize: 13 }}>
            Al confirmar, las cantidades se ajustarán automáticamente al stock
            disponible en el depósito (se restarán{' '}
            <b>{totalExcedente.toFixed(2)} unidad{totalExcedente !== 1 ? 'es' : ''}</b>{' '}
            en total) y la venta continuará normalmente.
          </Text>
        }
        style={{
          marginBottom: 12,
          border: '1px solid rgba(207, 19, 34, 0.35)',
          background: '#fff1f0',
        }}
      />

      <div
        style={{
          maxHeight: 280,
          overflowY: 'auto',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
        }}
      >
        <List
          size="small"
          dataSource={issues}
          locale={{ emptyText: 'Sin problemas' }}
          renderItem={(it, idx) => (
            <List.Item
              style={{
                padding: '10px 14px',
                borderBottom: idx < issues.length - 1 ? '1px solid #f5f5f5' : 'none',
                background: idx % 2 === 0 ? '#fafafa' : '#fff',
              }}
            >
              <div style={{ width: '100%' }}>
                <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
                  <Text strong style={{ fontSize: 13 }}>{it.nombre}</Text>
                  <CloseCircleFilled style={{ color: '#cf1322', fontSize: 14, marginTop: 4 }} />
                </Space>
                <Space size={4} wrap style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Pediste:</Text>
                  <Tag color="red" style={{ fontWeight: 600, margin: 0 }}>
                    {it.cantidadActual} {it.unidad}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>· Disponible:</Text>
                  <Tag color="default" style={{ margin: 0 }}>
                    {it.stockDisponible} {it.unidad}
                  </Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>· Se restarán:</Text>
                  <Tag color="orange" style={{ margin: 0 }}>
                    {it.excedente.toFixed(2)} {it.unidad}
                  </Tag>
                </Space>
              </div>
            </List.Item>
          )}
        />
      </div>

      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 8 }}>
        Si necesitás otra cantidad, cancelá y editá los items en el carrito.
        Si querés permitir ventas sin stock, activá "Permite stock negativo" en el producto.
      </Text>
    </Modal>
  );
}
