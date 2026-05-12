import api from './api';

export interface ProductListingFilter {
  listaPrecio?: number;
  categoriaId?: number;
  marcaId?: number;
  soloActivos?: boolean;
  soloConStock?: boolean;
  search?: string;
}

export interface ProductListingItem {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  NOMBRE: string;
  MARCA: string;
  CATEGORIA: string;
  STOCK: number;
  PRECIO: number;
  LISTA_DEFECTO: number | null;
}

function buildParams(filter: ProductListingFilter) {
  const params: Record<string, string> = {
    listaPrecio: String(filter.listaPrecio ?? 0),
    soloActivos: filter.soloActivos === false ? 'false' : 'true',
    soloConStock: filter.soloConStock ? 'true' : 'false',
  };

  if (filter.categoriaId) params.categoriaId = String(filter.categoriaId);
  if (filter.marcaId) params.marcaId = String(filter.marcaId);
  if (filter.search?.trim()) params.search = filter.search.trim();

  return params;
}

export const productListingApi = {
  getProductos: (filter: ProductListingFilter) =>
    api.get<ProductListingItem[]>('/reports/listings/products', { params: buildParams(filter) }).then(r => r.data),
};
