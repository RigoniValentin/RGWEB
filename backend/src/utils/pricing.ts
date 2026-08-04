// ═══════════════════════════════════════════════════════════════════
//  Helpers de cálculo de precios de venta según método de margen.
//
//  Cada lista de precios define su propio TIPO_MARGEN:
//    'M' (Markup)   → Precio = Costo × (1 + Margen/100)
//                     Margen  = (Precio / Costo - 1) × 100
//    'U' (Utilidad) → Precio = Costo / (1 - Margen/100)
//                     Margen  = (1 - Costo / Precio) × 100
//
//  Estos helpers son la única fuente de verdad para aplicar y revertir
//  márgenes. Si la lógica se replica en SQL embebido, debe hacerse
//  con el mismo CASE (ver migraciones y servicios).
// ═══════════════════════════════════════════════════════════════════

export const TIPO_MARGEN = {
  MARKUP: 'M',
  UTILIDAD: 'U',
} as const;

export type TipoMargen = 'M' | 'U';

export class PricingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingValidationError';
  }
}

/** Normaliza un TIPO_MARGEN recibido de la base o la UI. Default = Markup. */
export function normalizarTipoMargen(tipo: string | null | undefined): TipoMargen {
  return tipo === 'U' ? 'U' : 'M';
}

/**
 * Calcula el precio de venta a partir del costo y un margen,
 * según el método de cálculo de la lista.
 *
 * @param costo    Costo con impuestos del producto.
 * @param margen   Margen en porcentaje (no fracción). Para Utilidad debe ser < 100.
 * @param tipo     'M' = Markup sobre costo, 'U' = Utilidad sobre venta.
 */
export function precioFromMargen(costo: number, margen: number, tipo: TipoMargen): number {
  if (!Number.isFinite(costo) || costo <= 0) return 0;
  if (!Number.isFinite(margen)) return 0;

  if (tipo === 'U') {
    if (margen >= 100) {
      throw new PricingValidationError('En modo Utilidad el margen debe ser menor a 100%.');
    }
    if (margen < 0) {
      throw new PricingValidationError('El margen no puede ser negativo.');
    }
    return costo / (1 - margen / 100);
  }

  // Markup
  return costo * (1 + margen / 100);
}

/**
 * Inversa: dado un costo y un precio, devuelve el margen expresado en
 * la moneda de la lista (Markup o Utilidad).
 */
export function margenFromPrecio(costo: number, precio: number, tipo: TipoMargen): number {
  if (!Number.isFinite(costo) || costo <= 0) return 0;
  if (!Number.isFinite(precio) || precio <= 0) return 0;

  if (tipo === 'U') {
    return (1 - costo / precio) * 100;
  }
  return ((precio / costo) - 1) * 100;
}

/**
 * Valida un margen para un tipo dado. Útil en endpoints create/update
 * de listas y productos para fallar con error claro.
 */
export function validateMargenPorTipo(margen: number, tipo: TipoMargen): void {
  if (!Number.isFinite(margen)) {
    throw new PricingValidationError('El margen debe ser un número.');
  }
  if (margen < 0) {
    throw new PricingValidationError('El margen no puede ser negativo.');
  }
  if (tipo === 'U' && margen >= 100) {
    throw new PricingValidationError('En modo Utilidad el margen debe ser menor a 100%.');
  }
}

/**
 * Etiqueta legible para UI / reportes.
 */
export function labelTipoMargen(tipo: TipoMargen): string {
  return tipo === 'U' ? 'Utilidad' : 'Markup';
}

/**
 * Etiqueta de fórmula para mostrar en tooltips.
 */
export function formulaLabel(tipo: TipoMargen): string {
  return tipo === 'U'
    ? 'Precio = costo / (1 - margen/100)'
    : 'Precio = costo × (1 + margen/100)';
}