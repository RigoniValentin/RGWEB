// ═══════════════════════════════════════════════════════════════════════════
//  Prorrateo de bonificación global sobre ítems de comprobante.
//
//  Caso de uso: muchos proveedores emiten facturas con una bonificación global
//  aplicada al pie (en pesos) sin discriminar porcentaje línea por línea.
//  Si copiamos literalmente el `precio_unitario` de cada ítem, sobreestimamos
//  el costo porque la bonificación real nunca queda registrada. Esto distorsio-
//  na margen, valuación de stock y precio de venta sugerido.
//
//  Solución: prorratear la bonificación global en forma proporcional al
//  subtotal de cada línea. El porcentaje efectivo es único para toda la
//  factura, así que se aplica como factor uniforme:
//
//      porcentaje_efectivo = (bonificacion_total / subtotal) * 100
//      factor_neto        = 1 - porcentaje_efectivo / 100
//                         = (subtotal - bonificacion) / subtotal
//
//  Para cada ítem:
//
//      precio_unitario_neto = precio_unitario * factor_neto
//      subtotal_linea_neto   = cantidad * precio_unitario_neto
//
//  La suma de `subtotal_linea_neto` sobre todos los ítems resulta igual a
//  `subtotal - bonificacion`, lo cual cuadra con `total_final` cuando no hay
//  percepciones/IVA intermedio (el parser superior puede conciliar después).
//
//  Importante: el usuario pidió que la salida sea siempre enriquecida —incluso
//  cuando NO hay bonificación—, para que el frontend pueda leer siempre las
//  mismas claves sin branching.
// ═══════════════════════════════════════════════════════════════════════════

// ── Tipos ────────────────────────────────────────────────────────────────

/** Ítem de comprobante tal como lo entrega el parser IA (subset relevante). */
export interface ParsedReceiptItemForProrrateo {
  /** Código que el proveedor puso en su factura — opcional. */
  codigo_proveedor?: string | null;
  descripcion_proveedor: string;
  cantidad: number;
  precio_unitario: number;
  subtotal_linea: number;
  /** Cualesquiera otros campos se preservan intactos. */
  [k: string]: unknown;
}

/** Totales del comprobante (subset relevante). */
export interface ParsedReceiptTotalesForProrrateo {
  subtotal?: number | null;
  bonificacion_total?: number | null;
  iva_total?: number | null;
  percepciones?: number | null;
  total_final?: number | null;
}

/** Ítem enriquecido con bonificación prorrateada. */
export type EnrichedItemWithProrrateo<T extends ParsedReceiptItemForProrrateo> =
  T & {
    /** Precio unitario luego de aplicar la bonificación global prorrateada. */
    precio_unitario_neto: number;
    /** Subtotal de la línea ya bonificado (cantidad * precio_unitario_neto). */
    subtotal_linea_neto: number;
    /** Porcentaje de bonificación aplicado a esta factura (0 si no aplica). */
    porcentaje_bonificacion_aplicado: number;
  };

// ── Helpers ──────────────────────────────────────────────────────────────

/** Redondeo monetario a 2 decimales (con tolerancia para浮 point drift). */
export function r2(n: number): number {
  // Math.round puede fallar por 0.0000001 típico de IEEE-754; multiplicamos y
  // redondeamos a 2 decimales con un epsilon implícito del orden 1e-9.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── Función principal ────────────────────────────────────────────────────

/**
 * Aplica la bonificación global (`bonificacion_total`, en pesos) prorrateada
 * sobre cada ítem en proporción a su `subtotal_linea`. El resultado es una
 * versión enriquecida de los ítems con `precio_unitario_neto`,
 * `subtotal_linea_neto` y `porcentaje_bonificacion_aplicado`.
 *
 * Casos:
 *  - Si no hay bonificación (≤ 0) o no hay subtotal (≤ 0), los ítems se
 *    devuelven SIN enriquecer (shape original intacto).
 *  - Si la bonificación supera al subtotal (caso patológico — factura con
 *    items sin valor o bonificación mayor al subtotal), se devuelve los ítems
 *    SIN enriquecer (dejamos que el usuario decida en el modal de revisión).
 *
 * Pure function, sin efectos colaterales. Tipos estrictos.
 */
export function aplicarProrrateoBonificacion<T extends ParsedReceiptItemForProrrateo>(
  items: readonly T[],
  totales: ParsedReceiptTotalesForProrrateo,
): EnrichedItemWithProrrateo<T>[] {
  const subtotal = Number(totales?.subtotal ?? 0);
  const bonificacion = Number(totales?.bonificacion_total ?? 0);

  // Sin bonificación o sin subtotal: enriquecer igual con el mismo valor para
  // que el shape sea estable y el frontend no tenga que ramificar.
  if (bonificacion <= 0 || subtotal <= 0) {
    return items.map(item => ({
      ...item,
      precio_unitario_neto: r2(item.precio_unitario),
      subtotal_linea_neto: r2(item.subtotal_linea),
      porcentaje_bonificacion_aplicado: 0,
    }));
  }

  // Casos degenerados
  if (bonificacion >= subtotal) {
    return items.map(item => ({
      ...item,
      precio_unitario_neto: r2(item.precio_unitario),
      subtotal_linea_neto: r2(item.subtotal_linea),
      porcentaje_bonificacion_aplicado: 0,
    }));
  }

  // ── Núcleo del prorrateo ──────────────────────────────────────
  //   pct   = bonificacion / subtotal × 100            (porcentaje, 0..100)
  //   factor = 1 - pct/100 = (subtotal - bonificacion) / subtotal
  //   precio_unitario_neto = precio_unitario × factor
  //   subtotal_linea_neto  = cantidad × precio_unitario_neto
  //
  // La suma de subtotal_linea_neto = subtotal × factor = subtotal - bonificación,
  // por lo que cuadra contra el total (módulo IVA/percepciones que se calculan
  // aguas arriba).
  const porcentajeEfectivo = (bonificacion / subtotal) * 100;
  const factorNeto = 1 - bonificacion / subtotal; // equivalente a (subtotal - bonif)/subtotal

  return items.map(item => {
    const precioNetoRaw = item.precio_unitario * factorNeto;
    const subtotalNetoRaw = item.cantidad * precioNetoRaw;
    return {
      ...item,
      precio_unitario_neto: r2(precioNetoRaw),
      subtotal_linea_neto: r2(subtotalNetoRaw),
      porcentaje_bonificacion_aplicado: r2(porcentajeEfectivo),
    };
  });
}

// ── Tests inline (no se ejecutan, quedan como referencia) ────────────────
//
//   aplicarProrrateoBonificacion(
//     [
//       { descripcion_proveedor: 'A', cantidad: 5, precio_unitario: 1350, subtotal_linea: 6750 },
//       { descripcion_proveedor: 'B', cantidad: 1, precio_unitario: 284810.45, subtotal_linea: 284810.45 },
//     ],
//     { subtotal: 291560.45, bonificacion_total: 43734.07, total_final: 247826.38 }
//   )
//
//   → porcentaje_efectivo ≈ 15.00 %
//   → factor_neto ≈ 0.85
//   → A: precio_unitario_neto = 1147.50, subtotal_linea_neto = 5737.50
//   → B: precio_unitario_neto = 242088.88, subtotal_linea_neto = 242088.88
//   → Σ subtotal_linea_neto = 247826.38 (= subtotal − bonificación, ✓ concuerda)
