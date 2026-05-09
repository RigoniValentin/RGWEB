import type { QueryClient } from '@tanstack/react-query';

export function invalidateCashQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['caja-central-mov'] });
  queryClient.invalidateQueries({ queryKey: ['caja-central-totales'] });
  queryClient.invalidateQueries({ queryKey: ['caja-central-historico'] });
  queryClient.invalidateQueries({ queryKey: ['caja-central-fondo'] });
  queryClient.invalidateQueries({ queryKey: ['cajas'] });
  queryClient.invalidateQueries({ queryKey: ['caja'] });
  queryClient.invalidateQueries({ queryKey: ['mi-caja'] });
}
