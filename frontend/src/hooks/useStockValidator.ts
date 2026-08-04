import { useCallback, useMemo } from 'react';
import type { CartItem } from '../store/saleDraftsStore';

// ═══════════════════════════════════════════════════
//  useStockValidator — Centralized stock validation
//  for the sale cart.
//
//  Exposes:
//   - issues: list of cart items that exceed available stock
//   - hasIssues: whether any item has stock problems
//   - autoFixSingle: clamps a single item's quantity to its stock limit
//   - autoFixAll: clamps all items to their stock limits
//   - clampQuantity: pure helper that returns the clamped value
//
//  Rules:
//   - Services (ES_SERVICIO) and kits (ES_CONJUNTO) are always ignored.
//   - Items from remitos (DESDE_REMITO) are always ignored (stock already handled).
//   - If PERMITE_STOCK_NEGATIVO is true, the item is never flagged.
// ═══════════════════════════════════════════════════

export interface StockIssue {
  key: string;
  productoId: number;
  nombre: string;
  unidad: string;
  cantidadActual: number;
  stockDisponible: number;
  excedente: number;
  /** Unidades que se deberían descontar para volver al límite. */
  cantidadARestar: number;
}

export interface StockValidator {
  issues: StockIssue[];
  hasIssues: boolean;
  totalExcedente: number;
  clampQuantity: (item: CartItem, cantidad: number) => number;
  autoFixSingle: (item: CartItem) => void;
  autoFixAll: () => void;
  buildIssue: (item: CartItem) => StockIssue | null;
}

export function useStockValidator(
  cart: CartItem[],
  setCart: (updater: (prev: CartItem[]) => CartItem[]) => void,
): StockValidator {
  const isExempt = (item: CartItem) =>
    !!item.ES_SERVICIO || !!item.ES_CONJUNTO || !!item.DESDE_REMITO || !!item.PERMITE_STOCK_NEGATIVO;

  const clampQuantity = useCallback((item: CartItem, cantidad: number): number => {
    if (isExempt(item)) return Math.max(0.01, cantidad);
    const stock = item.STOCK || 0;
    if (cantidad > stock) return stock;
    return Math.max(0.01, cantidad);
  }, []);

  const buildIssue = useCallback((item: CartItem): StockIssue | null => {
    if (isExempt(item)) return null;
    if (!item.CANTIDAD || item.CANTIDAD <= 0) return null;
    const stock = item.STOCK || 0;
    if (item.CANTIDAD <= stock) return null;
    return {
      key: item.key,
      productoId: item.PRODUCTO_ID,
      nombre: item.NOMBRE,
      unidad: item.UNIDAD,
      cantidadActual: item.CANTIDAD,
      stockDisponible: stock,
      excedente: item.CANTIDAD - stock,
      cantidadARestar: item.CANTIDAD - stock,
    };
  }, []);

  const issues = useMemo<StockIssue[]>(() => {
    return cart
      .map(buildIssue)
      .filter((x): x is StockIssue => x !== null);
  }, [cart, buildIssue]);

  const hasIssues = issues.length > 0;
  const totalExcedente = useMemo(() => issues.reduce((s, i) => s + i.excedente, 0), [issues]);

  const autoFixSingle = useCallback((item: CartItem) => {
    setCart(prev => prev.map(i => {
      if (i.key !== item.key) return i;
      const clamped = clampQuantity(i, item.CANTIDAD);
      if (clamped === i.CANTIDAD) return i;
      return { ...i, CANTIDAD: clamped };
    }));
  }, [setCart, clampQuantity]);

  const autoFixAll = useCallback(() => {
    setCart(prev => prev.map(i => {
      const clamped = clampQuantity(i, i.CANTIDAD);
      if (clamped === i.CANTIDAD) return i;
      return { ...i, CANTIDAD: clamped };
    }));
  }, [setCart, clampQuantity]);

  return {
    issues,
    hasIssues,
    totalExcedente,
    clampQuantity,
    autoFixSingle,
    autoFixAll,
    buildIssue,
  };
}
