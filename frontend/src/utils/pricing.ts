// ═══════════════════════════════════════════════════════════════════
//  Helpers de cálculo de precios de venta según método de margen.
//  Espejo del helper backend (src/utils/pricing.ts).
//
//    'M' (Markup)   → Precio = Costo × (1 + Margen/100)
//    'U' (Utilidad) → Precio = Costo / (1 - Margen/100)
// ═══════════════════════════════════════════════════════════════════

export const TIPO_MARGEN = {
  MARKUP: 'M',
  UTILIDAD: 'U',
} as const;

export type TipoMargen = 'M' | 'U';

/** Normaliza un TIPO_MARGEN recibido de la API o UI. Default = Markup. */
export function normalizarTipoMargen(tipo: string | null | undefined): TipoMargen {
  return tipo === 'U' ? 'U' : 'M';
}

/** Calcula el precio de venta a partir del costo y un margen. */
export function precioFromMargen(
  costo: number,
  margen: number,
  tipo: TipoMargen,
): number {
  if (!Number.isFinite(costo) || costo <= 0) return 0;
  if (!Number.isFinite(margen)) return 0;

  if (tipo === 'U') {
    if (margen >= 100) return Number.NaN;
    if (margen < 0) return Number.NaN;
    return costo / (1 - margen / 100);
  }
  return costo * (1 + margen / 100);
}

/** Inversa: dado un costo y un precio, devuelve el margen en la moneda de la lista. */
export function margenFromPrecio(
  costo: number,
  precio: number,
  tipo: TipoMargen,
): number {
  if (!Number.isFinite(costo) || costo <= 0) return 0;
  if (!Number.isFinite(precio) || precio <= 0) return 0;

  if (tipo === 'U') {
    return (1 - costo / precio) * 100;
  }
  return ((precio / costo) - 1) * 100;
}

/** Etiqueta legible para UI / reportes. */
export function labelTipoMargen(tipo: TipoMargen): string {
  return tipo === 'U' ? 'Utilidad' : 'Markup';
}

/** Etiqueta de fórmula para mostrar en tooltips. */
export function formulaLabel(tipo: TipoMargen): string {
  return tipo === 'U'
    ? 'Precio = costo / (1 - margen/100)'
    : 'Precio = costo × (1 + margen/100)';
}

/** Etiqueta corta (2 chars) para chips/badges. */
export function shortTipoMargen(tipo: TipoMargen): string {
  return tipo === 'U' ? 'U' : 'M';
}