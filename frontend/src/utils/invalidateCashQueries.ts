import type { QueryClient } from '@tanstack/react-query';

/**
 * Invalida las queries relacionadas a caja/transferencias y FUERZA el refetch
 * de las queries inactivas (sin observers).
 *
 * ¿Por qué `refetchType: 'all'`?
 * La configuración global de TanStack Query tiene `refetchOnMount: false`,
 * lo que significa que cuando un componente se monta, NO refetchéa aunque
 * los datos estén stale. `invalidateQueries` por defecto sólo refetchéa
 * queries con observers activos; cuando `CajaPage` aún no estaba abierto
 * (sin tab), no había observers y los datos quedaban stale hasta un
 * refresh manual. Con `refetchType: 'all'` el refetch se dispara igual y
 * la cache queda fresca antes de que el componente se monte.
 */
export function invalidateCashQueries(queryClient: QueryClient) {
  const opts = { refetchType: 'all' as const };
  queryClient.invalidateQueries({ queryKey: ['caja-central-mov'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['caja-central-totales'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['caja-central-historico'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['cajas'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['cajas-list'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['caja'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['caja-sesion'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['caja-sesiones'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['mi-caja'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['mi-sesion-activa'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['mis-cajas'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['transfer-modal'], ...opts });
  queryClient.invalidateQueries({ queryKey: ['cc-efectivo'], ...opts });
}
