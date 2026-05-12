import { getPool, sql } from '../database/connection.js';

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

function getPrecioExpression(listaPrecio: number): string {
  if (listaPrecio >= 1 && listaPrecio <= 5) {
    return `ISNULL(p.LISTA_${listaPrecio}, 0)`;
  }

  return `CASE
    WHEN ISNULL(p.LISTA_DEFECTO, 1) = 1 THEN ISNULL(p.LISTA_1, 0)
    WHEN ISNULL(p.LISTA_DEFECTO, 1) = 2 THEN ISNULL(p.LISTA_2, 0)
    WHEN ISNULL(p.LISTA_DEFECTO, 1) = 3 THEN ISNULL(p.LISTA_3, 0)
    WHEN ISNULL(p.LISTA_DEFECTO, 1) = 4 THEN ISNULL(p.LISTA_4, 0)
    WHEN ISNULL(p.LISTA_DEFECTO, 1) = 5 THEN ISNULL(p.LISTA_5, 0)
    ELSE ISNULL(p.LISTA_1, 0)
  END`;
}

export const productListingService = {
  async getProductos(filter: ProductListingFilter = {}): Promise<ProductListingItem[]> {
    const pool = await getPool();
    const listaPrecio = Number.isInteger(filter.listaPrecio) ? filter.listaPrecio! : 0;
    const precioExpression = getPrecioExpression(listaPrecio);

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.soloActivos !== false) {
      where += ' AND (p.ACTIVO = 1 OR p.ACTIVO IS NULL)';
    }

    if (filter.categoriaId) {
      where += ' AND p.CATEGORIA_ID = @categoriaId';
      params.push({ name: 'categoriaId', type: sql.Int, value: filter.categoriaId });
    }

    if (filter.marcaId) {
      where += ' AND p.MARCA_ID = @marcaId';
      params.push({ name: 'marcaId', type: sql.Int, value: filter.marcaId });
    }

    if (filter.search?.trim()) {
      const tokens = filter.search.trim().split(/\s+/).filter(Boolean);
      tokens.forEach((token, i) => {
        where += ` AND (p.NOMBRE LIKE @search${i} OR p.CODIGOPARTICULAR LIKE @search${i}
                    OR c.NOMBRE LIKE @search${i} OR m.NOMBRE LIKE @search${i})`;
        params.push({ name: `search${i}`, type: sql.NVarChar, value: `%${token}%` });
      });
    }

    const stockExpression = `CASE
      WHEN EXISTS (SELECT 1 FROM STOCK_DEPOSITOS sdExists WHERE sdExists.PRODUCTO_ID = p.PRODUCTO_ID)
        THEN (SELECT ISNULL(SUM(sd.CANTIDAD), 0) FROM STOCK_DEPOSITOS sd WHERE sd.PRODUCTO_ID = p.PRODUCTO_ID)
      ELSE ISNULL(p.CANTIDAD, 0)
    END`;

    if (filter.soloConStock) {
      where += ` AND ${stockExpression} > 0`;
    }

    const req = pool.request();
    for (const param of params) req.input(param.name, param.type, param.value);

    const result = await req.query<ProductListingItem>(`
      SELECT
        p.PRODUCTO_ID,
        p.CODIGOPARTICULAR,
        p.NOMBRE,
        ISNULL(m.NOMBRE, 'Sin Marca') AS MARCA,
        ISNULL(c.NOMBRE, 'Sin Categoría') AS CATEGORIA,
        CAST(${stockExpression} AS DECIMAL(18, 2)) AS STOCK,
        CAST(${precioExpression} AS DECIMAL(18, 2)) AS PRECIO,
        p.LISTA_DEFECTO
      FROM PRODUCTOS p
      LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      ${where}
      ORDER BY p.NOMBRE
    `);

    return result.recordset;
  },
};
