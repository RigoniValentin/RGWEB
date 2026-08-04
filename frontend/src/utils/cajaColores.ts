import { useEffect, useState } from 'react';

const STORAGE_KEY = 'rg-caja-colores';

export const CAJA_COLOR_PRESETS: { label: string; value: string }[] = [
  { label: 'Dorado (default)', value: '#EABD23' },
  { label: 'Azul', value: '#1677ff' },
  { label: 'Verde', value: '#52c41a' },
  { label: 'Violeta', value: '#722ed1' },
  { label: 'Naranja', value: '#fa8c16' },
  { label: 'Rojo', value: '#cf1322' },
  { label: 'Cian', value: '#13c2c2' },
  { label: 'Magenta', value: '#eb2f96' },
  { label: 'Gris', value: '#595959' },
];

function readAll(): Record<number, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<number, string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore quota errors
  }
}

export function getColorForCaja(cajaId: number | null | undefined): string | null {
  if (!cajaId) return null;
  const map = readAll();
  return map[cajaId] || null;
}

export function setColorForCaja(cajaId: number, color: string | null): void {
  const map = readAll();
  if (color) {
    map[cajaId] = color;
  } else {
    delete map[cajaId];
  }
  writeAll(map);
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
}

/**
 * Hook que devuelve el color configurado para una caja y se re-renderiza
 * cuando otro componente lo modifica (vía evento `storage`).
 */
export function useCajaColor(cajaId: number | null | undefined): string | null {
  const [color, setColor] = useState<string | null>(() => getColorForCaja(cajaId));

  useEffect(() => {
    setColor(getColorForCaja(cajaId));
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) {
        setColor(getColorForCaja(cajaId));
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [cajaId]);

  return color;
}
