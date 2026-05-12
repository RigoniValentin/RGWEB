import { getPool, sql } from '../database/connection.js';
import type { ListaPrecio, PaginatedResult, Producto } from '../types/index.js';

export interface PriceListFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  activa?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface PriceListInput {
  CODIGOPARTICULAR?: string | null;
  NOMBRE: string;
  DESCRIPCION?: string | null;
  MARGEN?: number;
  MARGEN_REAL?: number | null;
  ACTIVA?: boolean;
}

export interface PriceListProductFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  categoriaId?: number;
  marcaId?: number;
  activo?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface PriceListProduct extends Producto {
  PRECIO_LISTA: number;
  MARGEN_LISTA: number | null;
}

export interface PriceListStats {
  totalProductos: number;
  productosActivos: number;
  productosConPrecio: number;
  precioPromedio: number;
  precioMinimo: number;
  precioMaximo: number;
}

export interface ApplyPercentageInput {
  porcentaje: number;
  incluirInactivos?: boolean;
  redondeo?: 'ninguno' | 'entero' | '50' | '100';
}

function validateListId(listaId: number) {
  if (!Number.isInteger(listaId) || listaId < 1 || listaId > 5) {
    throw Object.assign(new Error('Lista inválida. Solo se admiten las listas 1 a 5.'), { name: 'ValidationError' });
  }
}

function priceColumn(listaId: number) {
  validateListId(listaId);
  return `LISTA_${listaId}`;
}

function marginColumn(listaId: number) {
  validateListId(listaId);
  return `MARGEN_LISTA_${listaId}`;
}

function marginInsertValues(listaId: number) {
  return [1, 2, 3, 4, 5].map(i => (i === listaId ? 'src.MARGEN' : '0')).join(', ');
}

async function syncMarginsForList(listaId: number, whereSql: string) {
  const pool = await getPool();
  const listaCol = priceColumn(listaId);
  const margenCol = marginColumn(listaId);

  await pool.request().query(`
    MERGE PRODUCTO_MARGENES AS target
    USING (
      SELECT
        PRODUCTO_ID,
        CAST(CASE
          WHEN ISNULL(PRECIO_COMPRA, 0) > 0
            THEN ROUND(((ISNULL(${listaCol}, 0) / PRECIO_COMPRA) - 1) * 100, 4)
          ELSE 0
        END AS DECIMAL(9, 4)) AS MARGEN
      FROM PRODUCTOS
      WHERE ${whereSql}
    ) AS src
    ON target.PRODUCTO_ID = src.PRODUCTO_ID
    WHEN MATCHED THEN
      UPDATE SET ${margenCol} = src.MARGEN
    WHEN NOT MATCHED THEN
      INSERT (PRODUCTO_ID, MARGEN_LISTA_1, MARGEN_LISTA_2, MARGEN_LISTA_3, MARGEN_LISTA_4, MARGEN_LISTA_5)
      VALUES (src.PRODUCTO_ID, ${marginInsertValues(listaId)});
  `);
}

export const priceListService = {
  async getAll(filter: PriceListFilter = {}): Promise<PaginatedResult<ListaPrecio & PriceListStats>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE LISTA_ID BETWEEN 1 AND 5';
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.activa !== undefined) {
      where += ' AND ACTIVA = @activa';
      countReq.input('activa', sql.Bit, filter.activa ? 1 : 0);
      dataReq.input('activa', sql.Bit, filter.activa ? 1 : 0);
    }

    if (filter.search) {
      where += ' AND (NOMBRE LIKE @search OR CODIGOPARTICULAR LIKE @search OR DESCRIPCION LIKE @search)';
      countReq.input('search', sql.NVarChar, `%${filter.search}%`);
      dataReq.input('search', sql.NVarChar, `%${filter.search}%`);
    }

    const countResult = await countReq.query(`SELECT COUNT(*) AS total FROM LISTA_PRECIOS ${where}`);
    const total = countResult.recordset[0].total;

    const validCols: Record<string, string> = {
      LISTA_ID: 'LISTA_ID',
      CODIGOPARTICULAR: 'CODIGOPARTICULAR',
      NOMBRE: 'NOMBRE',
      MARGEN: 'MARGEN',
      MARGEN_REAL: 'MARGEN_REAL',
    };
    const orderCol = validCols[filter.orderBy || 'LISTA_ID'] || 'LISTA_ID';
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);
    const dataResult = await dataReq.query<ListaPrecio>(`
      SELECT LISTA_ID, CODIGOPARTICULAR, NOMBRE, DESCRIPCION, MARGEN, ACTIVA, MARGEN_REAL
      FROM LISTA_PRECIOS
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    const data = [] as (ListaPrecio & PriceListStats)[];
    for (const row of dataResult.recordset) {
      const stats = await this.getStats(row.LISTA_ID);
      data.push({ ...row, ...stats });
    }

    return { data, total, page, pageSize };
  },

  async getById(id: number): Promise<ListaPrecio & PriceListStats> {
    validateListId(id);
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, id)
      .query<ListaPrecio>(`
        SELECT LISTA_ID, CODIGOPARTICULAR, NOMBRE, DESCRIPCION, MARGEN, ACTIVA, MARGEN_REAL
        FROM LISTA_PRECIOS
        WHERE LISTA_ID = @id
      `);

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Lista de precio no encontrada'), { name: 'ValidationError' });
    }

    const stats = await this.getStats(id);
    return { ...result.recordset[0], ...stats };
  },

  async update(id: number, input: PriceListInput) {
    validateListId(id);
    if (!input.NOMBRE?.trim()) {
      throw Object.assign(new Error('El nombre es obligatorio'), { name: 'ValidationError' });
    }
    if (input.MARGEN_REAL != null && input.MARGEN != null && input.MARGEN_REAL > input.MARGEN) {
      throw Object.assign(new Error('El margen real no puede ser mayor que el margen.'), { name: 'ValidationError' });
    }

    const pool = await getPool();
    const duplicate = await pool.request()
      .input('id', sql.Int, id)
      .input('codigo', sql.NVarChar, input.CODIGOPARTICULAR?.trim() || null)
      .query(`
        SELECT 1
        FROM LISTA_PRECIOS
        WHERE CODIGOPARTICULAR = @codigo AND LISTA_ID != @id AND @codigo IS NOT NULL
      `);
    if (duplicate.recordset.length > 0) {
      throw Object.assign(new Error('El código ingresado ya existe.'), { name: 'ValidationError' });
    }

    await pool.request()
      .input('id', sql.Int, id)
      .input('codigo', sql.NVarChar, input.CODIGOPARTICULAR?.trim() || String(id))
      .input('nombre', sql.NVarChar, input.NOMBRE.trim())
      .input('descripcion', sql.NVarChar, input.DESCRIPCION?.trim() || null)
      .input('margen', sql.Decimal(18, 4), input.MARGEN ?? 0)
      .input('margenReal', sql.Decimal(18, 4), input.MARGEN_REAL ?? input.MARGEN ?? 0)
      .input('activa', sql.Bit, input.ACTIVA !== false ? 1 : 0)
      .query(`
        UPDATE LISTA_PRECIOS SET
          CODIGOPARTICULAR = @codigo,
          NOMBRE = @nombre,
          DESCRIPCION = @descripcion,
          MARGEN = @margen,
          MARGEN_REAL = @margenReal,
          ACTIVA = @activa
        WHERE LISTA_ID = @id
      `);
  },

  async getStats(listaId: number): Promise<PriceListStats> {
    const pool = await getPool();
    const col = priceColumn(listaId);
    const result = await pool.request().query(`
      SELECT
        COUNT(*) AS totalProductos,
        SUM(CASE WHEN ACTIVO = 1 THEN 1 ELSE 0 END) AS productosActivos,
        SUM(CASE WHEN ISNULL(${col}, 0) > 0 THEN 1 ELSE 0 END) AS productosConPrecio,
        ISNULL(AVG(NULLIF(CAST(${col} AS FLOAT), 0)), 0) AS precioPromedio,
        ISNULL(MIN(NULLIF(${col}, 0)), 0) AS precioMinimo,
        ISNULL(MAX(ISNULL(${col}, 0)), 0) AS precioMaximo
      FROM PRODUCTOS
    `);
    return result.recordset[0];
  },

  async getProducts(listaId: number, filter: PriceListProductFilter = {}): Promise<PaginatedResult<PriceListProduct>> {
    const pool = await getPool();
    const listaCol = priceColumn(listaId);
    const margenCol = marginColumn(listaId);
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 25;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.activo !== undefined) {
      where += ' AND p.ACTIVO = @activo';
      countReq.input('activo', sql.Bit, filter.activo ? 1 : 0);
      dataReq.input('activo', sql.Bit, filter.activo ? 1 : 0);
    }
    if (filter.categoriaId) {
      where += ' AND p.CATEGORIA_ID = @categoriaId';
      countReq.input('categoriaId', sql.Int, filter.categoriaId);
      dataReq.input('categoriaId', sql.Int, filter.categoriaId);
    }
    if (filter.marcaId) {
      where += ' AND p.MARCA_ID = @marcaId';
      countReq.input('marcaId', sql.Int, filter.marcaId);
      dataReq.input('marcaId', sql.Int, filter.marcaId);
    }
    if (filter.search) {
      const tokens = filter.search.trim().split(/\s+/).filter(Boolean);
      tokens.forEach((token, i) => {
        where += ` AND (p.NOMBRE LIKE @t${i} OR p.CODIGOPARTICULAR LIKE @t${i} OR p.DESCRIPCION LIKE @t${i} OR c.NOMBRE LIKE @t${i} OR m.NOMBRE LIKE @t${i})`;
        countReq.input(`t${i}`, sql.NVarChar, `%${token}%`);
        dataReq.input(`t${i}`, sql.NVarChar, `%${token}%`);
      });
    }

    const countResult = await countReq.query(`
      SELECT COUNT(*) AS total
      FROM PRODUCTOS p
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
      ${where}
    `);
    const total = countResult.recordset[0].total;

    const validCols: Record<string, string> = {
      CODIGOPARTICULAR: 'p.CODIGOPARTICULAR',
      NOMBRE: 'p.NOMBRE',
      CATEGORIA_NOMBRE: 'c.NOMBRE',
      MARCA_NOMBRE: 'm.NOMBRE',
      PRECIO_COMPRA: 'p.PRECIO_COMPRA',
      PRECIO_LISTA: `p.${listaCol}`,
      MARGEN_LISTA: `pm.${margenCol}`,
    };
    const orderCol = validCols[filter.orderBy || 'NOMBRE'] || 'p.NOMBRE';
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query<PriceListProduct>(`
      SELECT
        p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, p.DESCRIPCION,
        p.CANTIDAD, p.CATEGORIA_ID, p.PRECIO_COMPRA, p.MARCA_ID,
        p.STOCK_MINIMO, p.UNIDAD_ID, p.ACTIVO,
        p.LISTA_1, p.LISTA_2, p.LISTA_3, p.LISTA_4, p.LISTA_5,
        p.LISTA_DEFECTO, p.COSTO_USD, p.TASA_IVA_ID,
        p.ES_CONJUNTO, p.ES_SERVICIO, p.DESCUENTA_STOCK, p.PRECIO_COMPRA_BASE, p.IMP_INT,
        p.FECHA_VENCIMIENTO, p.MARGEN_INDIVIDUAL,
        c.NOMBRE AS CATEGORIA_NOMBRE,
        m.NOMBRE AS MARCA_NOMBRE,
        u.NOMBRE AS UNIDAD_NOMBRE,
        u.ABREVIACION AS UNIDAD_ABREVIACION,
        ISNULL(p.${listaCol}, 0) AS PRECIO_LISTA,
        pm.${margenCol} AS MARGEN_LISTA
      FROM PRODUCTOS p
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
      LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
      LEFT JOIN PRODUCTO_MARGENES pm ON pm.PRODUCTO_ID = p.PRODUCTO_ID
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  async updateProductPrice(listaId: number, productoId: number, precio: number) {
    const pool = await getPool();
    const listaCol = priceColumn(listaId);
    if (!Number.isFinite(precio) || precio < 0) {
      throw Object.assign(new Error('El precio debe ser mayor o igual a cero.'), { name: 'ValidationError' });
    }

    const result = await pool.request()
      .input('productoId', sql.Int, productoId)
      .input('precio', sql.Decimal(18, 4), precio)
      .query(`UPDATE PRODUCTOS SET ${listaCol} = @precio WHERE PRODUCTO_ID = @productoId`);

    if ((result.rowsAffected[0] || 0) === 0) {
      throw Object.assign(new Error('Producto no encontrado'), { name: 'ValidationError' });
    }

    await syncMarginsForList(listaId, `PRODUCTO_ID = ${productoId}`);
  },

  async applyPercentage(listaId: number, input: ApplyPercentageInput) {
    const pool = await getPool();
    const listaCol = priceColumn(listaId);
    const porcentaje = Number(input.porcentaje);
    if (!Number.isFinite(porcentaje) || porcentaje === 0 || porcentaje < -99.99 || porcentaje > 1000) {
      throw Object.assign(new Error('Ingresá un porcentaje válido entre -99,99 y 1000.'), { name: 'ValidationError' });
    }

    const before = await this.getStats(listaId);
    const activeWhere = input.incluirInactivos ? '' : 'AND ACTIVO = 1';
    const whereSql = `ISNULL(${listaCol}, 0) > 0 ${activeWhere}`;

    let expression = `ISNULL(${listaCol}, 0) * (1 + @porcentaje / 100.0)`;
    switch (input.redondeo) {
      case 'entero':
        expression = `CEILING(${expression})`;
        break;
      case '50':
        expression = `CEILING((${expression}) / 50.0) * 50`;
        break;
      case '100':
        expression = `CEILING((${expression}) / 100.0) * 100`;
        break;
      default:
        expression = `ROUND(${expression}, 2)`;
        break;
    }

    const result = await pool.request()
      .input('porcentaje', sql.Decimal(9, 4), porcentaje)
      .query(`
        UPDATE PRODUCTOS
        SET ${listaCol} = CAST(${expression} AS DECIMAL(18, 4))
        WHERE ${whereSql}
      `);

    await syncMarginsForList(listaId, whereSql);
    const after = await this.getStats(listaId);

    return {
      affected: result.rowsAffected[0] || 0,
      before,
      after,
    };
  },
};