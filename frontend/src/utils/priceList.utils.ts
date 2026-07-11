import type { PrecioLista } from '../types';

/** Devuelve el precio de un producto para una lista dada, o 0. */
export function getPrecioByLista(
  precios: PrecioLista[] | undefined | null,
  listaId: number,
): number {
  if (!precios) return 0;
  return precios.find(p => p.LISTA_ID === listaId)?.PRECIO ?? 0;
}

/** Convierte el array PRECIOS en un mapa { LISTA_ID: PRECIO } para acceso rápido. */
export function preciosToMap(precios: PrecioLista[] | undefined | null): Record<number, number> {
  const map: Record<number, number> = {};
  if (!precios) return map;
  for (const p of precios) map[p.LISTA_ID] = p.PRECIO;
  return map;
}

/** Suma total de precios (útil para vista "ver todos los precios"). */
export function sumPrecios(precios: PrecioLista[] | undefined | null): number {
  if (!precios) return 0;
  return precios.reduce((acc, p) => acc + (p.PRECIO || 0), 0);
}
