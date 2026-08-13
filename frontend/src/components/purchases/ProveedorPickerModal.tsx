import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Select } from 'antd';
import { RGCajaModalHeader } from '../RGCajaModalHeader';
import { rgIcon } from '../rg-icons';
import type { ProveedorCompra } from '../../types';

interface Props {
  open: boolean;
  proveedores: ProveedorCompra[];
  onClose: () => void;
  /** Confirma el proveedor elegido y abre el flujo de carga de comprobante
   *  por imagen. */
  onConfirm: (proveedorId: number) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ProveedorPickerModal
//
//  Modal mínimo que se muestra antes del flujo "Cargar comprobante por
//  imagen" cuando todavía no hay proveedor seleccionado en el modal de
//  Nueva Compra. Garantiza que el matcher corra con un proveedor ya
//  conocido, para que PRODUCTOS_PROVEEDORES.CODIGO_PROVEEDOR vincule bien
//  cada ítem sin confundirse entre proveedores.
// ═══════════════════════════════════════════════════════════════════════════

export function ProveedorPickerModal({ open, proveedores, onClose, onConfirm }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    if (open) setSelectedId(null);
  }, [open]);

  const opciones = useMemo(
    () => [...proveedores]
      .sort((a, b) => a.NOMBRE.localeCompare(b.NOMBRE))
      .map((p) => ({
        value: p.PROVEEDOR_ID,
        label: p.NUMERO_DOC ? `${p.NOMBRE}  ·  ${p.NUMERO_DOC}` : p.NOMBRE,
      })),
    [proveedores],
  );

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      maskClosable={false}
      width={520}
      centered
      className="rg-modal proveedor-picker-modal"
      title={
        <RGCajaModalHeader
          icon={rgIcon('proveedor')}
          title="Proveedor del comprobante"
          subtitle="Elegí a quién le comprás antes de procesar la imagen"
        />
      }
    >
      <div style={{ padding: '20px 24px' }}>
        <Select
          showSearch
          size="large"
          placeholder="Buscar proveedor…"
          value={selectedId ?? undefined}
          onChange={(v) => setSelectedId(v)}
          filterOption={(input, option) => {
            const label = (option?.label as string) ?? '';
            return label.toLowerCase().includes(input.toLowerCase());
          }}
          options={opciones}
          style={{ width: '100%', marginBottom: 16 }}
          autoFocus
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            type="primary"
            disabled={!selectedId}
            onClick={() => selectedId && onConfirm(selectedId)}
          >
            Confirmar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
