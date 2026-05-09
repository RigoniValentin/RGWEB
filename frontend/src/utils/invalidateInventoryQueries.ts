import type { QueryClient } from '@tanstack/react-query';

export function invalidateInventoryQueries(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: ['products'] });
  queryClient.invalidateQueries({ queryKey: ['product-edit'] });
  queryClient.invalidateQueries({ queryKey: ['product-stock'] });
  queryClient.invalidateQueries({ queryKey: ['stock'] });
  queryClient.invalidateQueries({ queryKey: ['stock-detail'] });
  queryClient.invalidateQueries({ queryKey: ['stock-history'] });
}