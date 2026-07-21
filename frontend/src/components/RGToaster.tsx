import { Toaster, type SileoPosition, type SileoOptions } from 'sileo';

/**
 * Wrapper de <Toaster> con la identidad visual de Río Gestión.
 *
 * Posiciona los toasts en `top-right` con un offset que respeta el header
 * sticky de la app (~56 px) y los márgenes laterales del contenido.
 *
 * Defaults globales (pueden ser sobreescritos por toast):
 *  - duration: 3000ms (idéntico a antd message)
 *  - roundness: 14px (alineado con --rg-radius)
 *  - theme: light (coherente con el ERP)
 *
 * Los overrides finos de paleta se aplican en `index.css` (CSS variables:
 * --sileo-state-*).
 */

interface RGToasterProps {
  position?: SileoPosition;
  offset?: number | string | { top?: number; right?: number; bottom?: number; left?: number };
  options?: Partial<SileoOptions>;
}

export function RGToaster({
  position = 'top-right',
  offset = { top: 64, right: 16 },
  options,
}: RGToasterProps) {
  return (
    <Toaster
      position={position}
      offset={offset}
      theme="light"
      options={{
        duration: 3000,
        roundness: 14,
        ...options,
      }}
    />
  );
}

export default RGToaster;
