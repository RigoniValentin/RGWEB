import { getPool, sql } from '../database/connection.js';

export interface ReportFilter {
  fechaDesde: string;
  fechaHasta: string;
  puntoVentaId?: number;
  categoriaId?: number;
  marcaId?: number;
  clienteId?: number;
  proveedorId?: number;
  incluirNc?: boolean;
  limit?: number;
}

export interface RevenueByDimensionRow {
  ID: number | null;
  NOMBRE: string;
  CANTIDAD_VENTAS: number;
  UNIDADES_VENDIDAS: number;
  TOTAL_VENDIDO: number;
  PARTICIPACION_PCT: number;
}

export interface SalesByClientRow {
  CLIENTE_ID: number | null;
  CODIGOPARTICULAR: string | null;
  CLIENTE: string;
  CANTIDAD_VENTAS: number;
  TOTAL: number;
  TICKET_PROMEDIO: number;
  ULTIMA_VENTA: string | null;
}

export interface SalesByProductRow {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  PRODUCTO: string;
  CATEGORIA: string;
  MARCA: string;
  CANTIDAD_VENDIDA: number;
  VENTAS_DISTINTAS: number;
  TOTAL_INGRESOS: number;
  PRECIO_PROMEDIO: number;
}

export interface SalesGeneralRow {
  VENTA_ID: number;
  FECHA_VENTA: string;
  CLIENTE: string;
  PRODUCTOS: string;
  TOTAL: number;
  GANANCIA: number;
  EFECTIVO: number;
  DIGITAL: number;
  TIPO_COMPROBANTE: string | null;
}

export interface SalesBySucursalRow {
  PUNTO_VENTA_ID: number | null;
  SUCURSAL: string;
  CANTIDAD_VENTAS: number;
  TOTAL_VENDIDO: number;
  GANANCIA: number;
  TICKET_PROMEDIO: number;
}

export interface SalesTimelineRow {
  BUCKET: string;
  VENTAS: number;
  TOTAL: number;
  GANANCIA: number;
}

export interface SalesHeatmapRow {
  DOW: number;
  HOUR: number;
  VENTAS: number;
  TOTAL: number;
}

export interface TopProductRow {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  NOMBRE: string;
  CATEGORIA: string;
  UNIDADES_VENDIDAS: number;
  TOTAL_VENDIDO: number;
  VENTAS_DISTINTAS: number;
}

export interface PurchasesBySupplierRow {
  PROVEEDOR_ID: number;
  CODIGOPARTICULAR: string | null;
  PROVEEDOR: string;
  CANTIDAD_COMPROBANTES: number;
  TOTAL: number;
  IVA_TOTAL: number;
  PERCEPCIONES: number;
}

export interface PurchasesByProductRow {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  PRODUCTO: string;
  CANTIDAD_COMPRADA: number;
  COMPRAS_DISTINTAS: number;
  TOTAL_COMPRADO: number;
  PRECIO_PROMEDIO: number;
}

export interface PurchasesGeneralRow {
  COMPROBANTE_ID: number;
  FECHA: string;
  TIPO_COMPROBANTE: string | null;
  PROVEEDOR: string;
  PRODUCTOS: string;
  TOTAL: number;
  COBRADA: boolean | number | null;
}

export interface ClientListRow {
  CLIENTE_ID: number;
  CODIGOPARTICULAR: string | null;
  NOMBRE: string;
  EMAIL: string | null;
  TELEFONO: string | null;
  NUMERO_DOC: string | null;
  CONDICION_IVA: string | null;
  CIUDAD: string | null;
  ACTIVO: boolean | number | null;
  TOTAL_VENTAS: number;
  ULTIMA_VENTA: string | null;
}

export interface ClienteTipoRow {
  TIPO: 'Nuevo' | 'Recurrente';
  CANTIDAD_CLIENTES: number;
  CANTIDAD_VENTAS: number;
  TOTAL: number;
}

export interface ProductMixRow {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  NOMBRE: string;
  CATEGORIA: string | null;
  MARCA: string | null;
  UNIDADES: number;
  TOTAL: number;
}

async function getRevenueByDimension(
  dimension: 'categoria' | 'marca',
  filter: ReportFilter,
): Promise<RevenueByDimensionRow[]> {
  const pool = await getPool();
  const join = dimension === 'categoria'
    ? `LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID`
    : `LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID`;
  const alias = dimension === 'categoria' ? 'Sin Categoría' : 'Sin Marca';

  const req = pool.request()
    .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
    .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
  let pv = '';
  if (filter.puntoVentaId) {
    pv = ' AND v.PUNTO_VENTA_ID = @pvId';
    req.input('pvId', sql.Int, filter.puntoVentaId);
  }
  let extra = '';
  if (dimension === 'categoria' && filter.categoriaId) {
    extra = ' AND p.CATEGORIA_ID = @dimId';
    req.input('dimId', sql.Int, filter.categoriaId);
  }
  if (dimension === 'marca' && filter.marcaId) {
    extra = ' AND p.MARCA_ID = @dimId';
    req.input('dimId', sql.Int, filter.marcaId);
  }

  const result = await req.query(`
    WITH base AS (
      SELECT
        ${dimension === 'categoria' ? 'c.CATEGORIA_ID' : 'm.MARCA_ID'} AS ID,
        ISNULL(${dimension === 'categoria' ? 'c.NOMBRE' : 'm.NOMBRE'}, '${alias}') AS NOMBRE,
        v.VENTA_ID,
        vi.CANTIDAD,
        vi.CANTIDAD * vi.PRECIO_UNITARIO AS IMPORTE
      FROM VENTAS_ITEMS vi
      JOIN VENTAS v ON vi.VENTA_ID = v.VENTA_ID
      JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
      ${join}
      WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv} ${extra}
        AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
    ),
    total AS (SELECT ISNULL(SUM(IMPORTE), 0) AS T FROM base)
    SELECT
      b.ID,
      b.NOMBRE,
      COUNT(DISTINCT b.VENTA_ID) AS CANTIDAD_VENTAS,
      ISNULL(SUM(b.CANTIDAD), 0) AS UNIDADES_VENDIDAS,
      CAST(ISNULL(SUM(b.IMPORTE), 0) AS DECIMAL(18, 2)) AS TOTAL_VENDIDO,
      CASE WHEN (SELECT T FROM total) > 0
        THEN CAST(ROUND(ISNULL(SUM(b.IMPORTE), 0) * 100.0 / (SELECT T FROM total), 2) AS DECIMAL(9, 2))
        ELSE 0 END AS PARTICIPACION_PCT
    FROM base b
    GROUP BY b.ID, b.NOMBRE
    ORDER BY TOTAL_VENDIDO DESC
  `);

  return result.recordset.map((r: any) => ({
    ...r,
    ID: r.ID ?? null,
  }));
}

export const reportsService = {
  async getRevenueByCategories(filter: ReportFilter): Promise<RevenueByDimensionRow[]> {
    return getRevenueByDimension('categoria', filter);
  },

  async getRevenueByBrands(filter: ReportFilter): Promise<RevenueByDimensionRow[]> {
    return getRevenueByDimension('marca', filter);
  },

  async getRevenueByProducts(filter: ReportFilter): Promise<RevenueByDimensionRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);

    const result = await req.query(`
      WITH base AS (
        SELECT
          p.PRODUCTO_ID,
          ISNULL(p.CODIGOPARTICULAR, '') AS CODIGO,
          p.NOMBRE,
          ISNULL(c.NOMBRE, 'Sin Categoría') AS CATEGORIA,
          v.VENTA_ID,
          vi.CANTIDAD,
          vi.CANTIDAD * vi.PRECIO_UNITARIO AS IMPORTE
        FROM VENTAS_ITEMS vi
        JOIN VENTAS v ON vi.VENTA_ID = v.VENTA_ID
        JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
        LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
        WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv}
          AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
      ),
      total AS (SELECT ISNULL(SUM(IMPORTE), 0) AS T FROM base)
      SELECT TOP (${limit})
        b.PRODUCTO_ID AS ID,
        b.NOMBRE,
        b.CODIGO,
        b.CATEGORIA,
        COUNT(DISTINCT b.VENTA_ID) AS CANTIDAD_VENTAS,
        ISNULL(SUM(b.CANTIDAD), 0) AS UNIDADES_VENDIDAS,
        CAST(ISNULL(SUM(b.IMPORTE), 0) AS DECIMAL(18, 2)) AS TOTAL_VENDIDO,
        CASE WHEN (SELECT T FROM total) > 0
          THEN CAST(ROUND(ISNULL(SUM(b.IMPORTE), 0) * 100.0 / (SELECT T FROM total), 2) AS DECIMAL(9, 2))
          ELSE 0 END AS PARTICIPACION_PCT
      FROM base b
      GROUP BY b.PRODUCTO_ID, b.NOMBRE, b.CODIGO, b.CATEGORIA
      ORDER BY TOTAL_VENDIDO DESC
    `);

    return result.recordset.map((r: any) => ({
      ID: r.ID,
      NOMBRE: r.NOMBRE,
      CODIGOPARTICULAR: r.CODIGO,
      CATEGORIA: r.CATEGORIA,
      CANTIDAD_VENTAS: r.CANTIDAD_VENTAS,
      UNIDADES_VENDIDAS: r.UNIDADES_VENDIDAS,
      TOTAL_VENDIDO: Number(r.TOTAL_VENDIDO),
      PARTICIPACION_PCT: Number(r.PARTICIPACION_PCT),
    }));
  },

  async getSalesByClient(filter: ReportFilter): Promise<SalesByClientRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 1000);

    const result = await req.query(`
      SELECT TOP (${limit})
        c.CLIENTE_ID,
        c.CODIGOPARTICULAR,
        ISNULL(c.NOMBRE, 'Consumidor Final') AS CLIENTE,
        COUNT(*) AS CANTIDAD_VENTAS,
        CAST(ISNULL(SUM(v.TOTAL), 0) AS DECIMAL(18, 2)) AS TOTAL,
        CAST(ISNULL(AVG(NULLIF(v.TOTAL, 0)), 0) AS DECIMAL(18, 2)) AS TICKET_PROMEDIO,
        MAX(CAST(v.FECHA_VENTA AS DATE)) AS ULTIMA_VENTA
      FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
      WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv}
        AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
      GROUP BY c.CLIENTE_ID, c.CODIGOPARTICULAR, c.NOMBRE
      ORDER BY TOTAL DESC
    `);
    return result.recordset;
  },

  async getSalesByProduct(filter: ReportFilter): Promise<SalesByProductRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    let extra = '';
    if (filter.categoriaId) {
      extra += ' AND p.CATEGORIA_ID = @catId';
      req.input('catId', sql.Int, filter.categoriaId);
    }
    if (filter.marcaId) {
      extra += ' AND p.MARCA_ID = @marcaId';
      req.input('marcaId', sql.Int, filter.marcaId);
    }

    const result = await req.query(`
      SELECT
        p.PRODUCTO_ID,
        p.CODIGOPARTICULAR,
        p.NOMBRE AS PRODUCTO,
        ISNULL(c.NOMBRE, 'Sin Categoría') AS CATEGORIA,
        ISNULL(m.NOMBRE, 'Sin Marca') AS MARCA,
        ISNULL(SUM(vi.CANTIDAD), 0) AS CANTIDAD_VENDIDA,
        COUNT(DISTINCT v.VENTA_ID) AS VENTAS_DISTINTAS,
        CAST(ISNULL(SUM(vi.CANTIDAD * vi.PRECIO_UNITARIO), 0) AS DECIMAL(18, 2)) AS TOTAL_INGRESOS,
        CAST(CASE WHEN ISNULL(SUM(vi.CANTIDAD), 0) > 0
          THEN SUM(vi.CANTIDAD * vi.PRECIO_UNITARIO) / SUM(vi.CANTIDAD) ELSE 0 END AS DECIMAL(18, 2)) AS PRECIO_PROMEDIO
      FROM VENTAS_ITEMS vi
      JOIN VENTAS v ON vi.VENTA_ID = v.VENTA_ID
      JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
      WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv} ${extra}
        AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
      GROUP BY p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, c.NOMBRE, m.NOMBRE
      ORDER BY TOTAL_INGRESOS DESC
    `);
    return result.recordset;
  },

  async getSalesBySucursal(filter: ReportFilter): Promise<SalesBySucursalRow[]> {
    const pool = await getPool();
    const result = await pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta)
      .query(`
        SELECT
          pv.PUNTO_VENTA_ID,
          ISNULL(pv.NOMBRE, 'Sin PV') AS SUCURSAL,
          COUNT(*) AS CANTIDAD_VENTAS,
          CAST(ISNULL(SUM(v.TOTAL), 0) AS DECIMAL(18, 2)) AS TOTAL_VENDIDO,
          CAST(ISNULL(SUM(v.GANANCIAS), 0) AS DECIMAL(18, 2)) AS GANANCIA,
          CAST(ISNULL(AVG(NULLIF(v.TOTAL, 0)), 0) AS DECIMAL(18, 2)) AS TICKET_PROMEDIO
        FROM VENTAS v
        LEFT JOIN PUNTO_VENTAS pv ON v.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
        WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta
          AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
        GROUP BY pv.PUNTO_VENTA_ID, pv.NOMBRE
        ORDER BY TOTAL_VENDIDO DESC
      `);
    return result.recordset;
  },

  async getSalesGeneral(filter: ReportFilter): Promise<SalesGeneralRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    let nc = '';
    if (!filter.incluirNc) {
      nc = ` AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')`;
    }

    const result = await req.query(`
      SELECT
        v.VENTA_ID,
        v.FECHA_VENTA,
        ISNULL(c.NOMBRE, 'Consumidor Final') AS CLIENTE,
        v.TIPO_COMPROBANTE,
        v.TOTAL,
        v.GANANCIAS AS GANANCIA,
        ISNULL(v.MONTO_EFECTIVO, 0) AS EFECTIVO,
        ISNULL(v.MONTO_DIGITAL, 0) AS DIGITAL,
        PRODUCTOS = (
          SELECT STRING_AGG('x' + CONVERT(VARCHAR(10), CONVERT(INT, vi2.CANTIDAD)) + ' ' + p.NOMBRE, ' · ')
            WITHIN GROUP (ORDER BY p.NOMBRE)
          FROM VENTAS_ITEMS vi2
          JOIN PRODUCTOS p ON p.PRODUCTO_ID = vi2.PRODUCTO_ID
          WHERE vi2.VENTA_ID = v.VENTA_ID
        )
      FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
      WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv} ${nc}
      ORDER BY v.FECHA_VENTA DESC, v.VENTA_ID DESC
    `);
    return result.recordset;
  },

  async getSalesTimeline(filter: ReportFilter, granularity: 'day' | 'week' | 'month' = 'day'): Promise<SalesTimelineRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    let bucket: string;
    switch (granularity) {
      case 'month':
        bucket = `DATEFROMPARTS(YEAR(v.FECHA_VENTA), MONTH(v.FECHA_VENTA), 1)`;
        break;
      case 'week':
        bucket = `DATEADD(DAY, -((DATEPART(WEEKDAY, v.FECHA_VENTA) + @@DATEFIRST - 2) % 7), CAST(v.FECHA_VENTA AS DATE))`;
        break;
      case 'day':
      default:
        bucket = `CAST(v.FECHA_VENTA AS DATE)`;
    }
    const result = await req.query(`
      SELECT
        ${bucket} AS BUCKET,
        COUNT(*) AS VENTAS,
        CAST(ISNULL(SUM(v.TOTAL), 0) AS DECIMAL(18, 2)) AS TOTAL,
        CAST(ISNULL(SUM(v.GANANCIAS), 0) AS DECIMAL(18, 2)) AS GANANCIA
      FROM VENTAS v
      WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv}
        AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
      GROUP BY ${bucket}
      ORDER BY BUCKET
    `);
    return result.recordset;
  },

  async getSalesHeatmap(filter: ReportFilter): Promise<SalesHeatmapRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    const result = await req.query(`
      SELECT
        DATEPART(WEEKDAY, v.FECHA_VENTA) AS DOW,
        DATEPART(HOUR, v.FECHA_VENTA) AS HOUR,
        COUNT(*) AS VENTAS,
        CAST(ISNULL(SUM(v.TOTAL), 0) AS DECIMAL(18, 2)) AS TOTAL
      FROM VENTAS v
      WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv}
        AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
      GROUP BY DATEPART(WEEKDAY, v.FECHA_VENTA), DATEPART(HOUR, v.FECHA_VENTA)
    `);
    return result.recordset;
  },

  async getTopProductsByUnidades(filter: ReportFilter): Promise<TopProductRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const result = await req.query(`
      SELECT TOP (${limit})
        p.PRODUCTO_ID,
        p.CODIGOPARTICULAR,
        p.NOMBRE,
        ISNULL(c.NOMBRE, 'Sin Categoría') AS CATEGORIA,
        ISNULL(SUM(vi.CANTIDAD), 0) AS UNIDADES_VENDIDAS,
        CAST(ISNULL(SUM(vi.CANTIDAD * vi.PRECIO_UNITARIO), 0) AS DECIMAL(18, 2)) AS TOTAL_VENDIDO,
        COUNT(DISTINCT v.VENTA_ID) AS VENTAS_DISTINTAS
      FROM VENTAS_ITEMS vi
      JOIN VENTAS v ON vi.VENTA_ID = v.VENTA_ID
      JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv}
        AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
      GROUP BY p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, c.NOMBRE
      ORDER BY UNIDADES_VENDIDAS DESC, TOTAL_VENDIDO DESC
    `);
    return result.recordset;
  },

  async getTopProductsByIngresos(filter: ReportFilter): Promise<TopProductRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    const result = await req.query(`
      SELECT TOP (${limit})
        p.PRODUCTO_ID,
        p.CODIGOPARTICULAR,
        p.NOMBRE,
        ISNULL(c.NOMBRE, 'Sin Categoría') AS CATEGORIA,
        ISNULL(SUM(vi.CANTIDAD), 0) AS UNIDADES_VENDIDAS,
        CAST(ISNULL(SUM(vi.CANTIDAD * vi.PRECIO_UNITARIO), 0) AS DECIMAL(18, 2)) AS TOTAL_VENDIDO,
        COUNT(DISTINCT v.VENTA_ID) AS VENTAS_DISTINTAS
      FROM VENTAS_ITEMS vi
      JOIN VENTAS v ON vi.VENTA_ID = v.VENTA_ID
      JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv}
        AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
      GROUP BY p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, c.NOMBRE
      ORDER BY TOTAL_VENDIDO DESC, UNIDADES_VENDIDAS DESC
    `);
    return result.recordset;
  },

  async getPurchasesBySupplier(filter: ReportFilter): Promise<PurchasesBySupplierRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND CAST(ISNULL(c.PTO_VTA, \'0\') AS INT) = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    let nc = '';
    if (!filter.incluirNc) {
      nc = ` AND (c.TIPO_COMPROBANTE IS NULL OR c.TIPO_COMPROBANTE NOT LIKE 'NC%')`;
    }
    let prov = '';
    if (filter.proveedorId) {
      prov = ' AND c.PROVEEDOR_ID = @provId';
      req.input('provId', sql.Int, filter.proveedorId);
    }

    const result = await req.query(`
      SELECT
        p.PROVEEDOR_ID,
        p.CODIGOPARTICULAR,
        ISNULL(p.NOMBRE, 'Sin Proveedor') AS PROVEEDOR,
        COUNT(*) AS CANTIDAD_COMPROBANTES,
        CAST(ISNULL(SUM(c.TOTAL), 0) AS DECIMAL(18, 2)) AS TOTAL,
        CAST(ISNULL(SUM(c.IVA_TOTAL), 0) AS DECIMAL(18, 2)) AS IVA_TOTAL,
        CAST(ISNULL(SUM(c.PERCEPCION_IVA), 0) + ISNULL(SUM(c.PERCEPCION_IIBB), 0) AS DECIMAL(18, 2)) AS PERCEPCIONES
      FROM COMPRAS c
      LEFT JOIN PROVEEDORES p ON c.PROVEEDOR_ID = p.PROVEEDOR_ID
      WHERE CAST(c.FECHA_COMPRA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv} ${nc} ${prov}
      GROUP BY p.PROVEEDOR_ID, p.CODIGOPARTICULAR, p.NOMBRE
      ORDER BY TOTAL DESC
    `);
    return result.recordset;
  },

  async getPurchasesByProduct(filter: ReportFilter): Promise<PurchasesByProductRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ` AND CAST(ISNULL(c.PTO_VTA, '0') AS INT) = @pvId`;
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    let nc = '';
    if (!filter.incluirNc) {
      nc = ` AND (c.TIPO_COMPROBANTE IS NULL OR c.TIPO_COMPROBANTE NOT LIKE 'NC%')`;
    }

    const result = await req.query(`
      SELECT
        p.PRODUCTO_ID,
        p.CODIGOPARTICULAR,
        p.NOMBRE AS PRODUCTO,
        ISNULL(SUM(ci.CANTIDAD), 0) AS CANTIDAD_COMPRADA,
        COUNT(DISTINCT c.COMPRA_ID) AS COMPRAS_DISTINTAS,
        CAST(ISNULL(SUM(ci.CANTIDAD * ci.PRECIO_COMPRA), 0) AS DECIMAL(18, 2)) AS TOTAL_COMPRADO,
        CAST(CASE WHEN ISNULL(SUM(ci.CANTIDAD), 0) > 0
          THEN SUM(ci.CANTIDAD * ci.PRECIO_COMPRA) / SUM(ci.CANTIDAD) ELSE 0 END AS DECIMAL(18, 2)) AS PRECIO_PROMEDIO
      FROM COMPRAS_ITEMS ci
      JOIN COMPRAS c ON ci.COMPRA_ID = c.COMPRA_ID
      JOIN PRODUCTOS p ON ci.PRODUCTO_ID = p.PRODUCTO_ID
      WHERE CAST(c.FECHA_COMPRA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv} ${nc}
      GROUP BY p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE
      ORDER BY TOTAL_COMPRADO DESC
    `);
    return result.recordset;
  },

  async getPurchasesGeneral(filter: ReportFilter): Promise<PurchasesGeneralRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ` AND CAST(ISNULL(c.PTO_VTA, '0') AS INT) = @pvId`;
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    let nc = '';
    if (!filter.incluirNc) {
      nc = ` AND (c.TIPO_COMPROBANTE IS NULL OR c.TIPO_COMPROBANTE NOT LIKE 'NC%')`;
    }

    const result = await req.query(`
      SELECT
        c.COMPRA_ID AS COMPROBANTE_ID,
        c.FECHA_COMPRA AS FECHA,
        c.TIPO_COMPROBANTE,
        ISNULL(p.NOMBRE, 'Sin Proveedor') AS PROVEEDOR,
        c.TOTAL,
        c.COBRADA,
        PRODUCTOS = (
          SELECT STRING_AGG('x' + CONVERT(VARCHAR(10), CONVERT(INT, ci2.CANTIDAD)) + ' ' + pr.NOMBRE, ' · ')
            WITHIN GROUP (ORDER BY pr.NOMBRE)
          FROM COMPRAS_ITEMS ci2
          JOIN PRODUCTOS pr ON pr.PRODUCTO_ID = ci2.PRODUCTO_ID
          WHERE ci2.COMPRA_ID = c.COMPRA_ID
        )
      FROM COMPRAS c
      LEFT JOIN PROVEEDORES p ON c.PROVEEDOR_ID = p.PROVEEDOR_ID
      WHERE CAST(c.FECHA_COMPRA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv} ${nc}
      ORDER BY c.FECHA_COMPRA DESC, c.COMPRA_ID DESC
    `);
    return result.recordset;
  },

  async getClientList(filter: { search?: string; activo?: boolean }): Promise<ClientListRow[]> {
    const pool = await getPool();
    const req = pool.request();
    let where = 'WHERE 1=1';
    if (filter.search?.trim()) {
      const s = `%${filter.search.trim()}%`;
      where += ` AND (c.NOMBRE LIKE @s OR c.CODIGOPARTICULAR LIKE @s OR c.NUMERO_DOC LIKE @s OR c.EMAIL LIKE @s)`;
      req.input('s', sql.NVarChar, s);
    }
    if (filter.activo !== undefined) {
      where += ' AND ISNULL(c.ACTIVO, 1) = @activo';
      req.input('activo', sql.Bit, filter.activo ? 1 : 0);
    }

    const result = await req.query(`
      SELECT
        c.CLIENTE_ID,
        c.CODIGOPARTICULAR,
        c.NOMBRE,
        c.EMAIL,
        c.TELEFONO,
        c.NUMERO_DOC,
        c.CONDICION_IVA,
        c.CIUDAD,
        c.ACTIVO,
        ISNULL((
          SELECT SUM(v.TOTAL)
          FROM VENTAS v
          WHERE v.CLIENTE_ID = c.CLIENTE_ID
            AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
        ), 0) AS TOTAL_VENTAS,
        (
          SELECT MAX(CAST(v.FECHA_VENTA AS DATE))
          FROM VENTAS v
          WHERE v.CLIENTE_ID = c.CLIENTE_ID
        ) AS ULTIMA_VENTA
      FROM CLIENTES c
      ${where}
      ORDER BY c.NOMBRE
    `);
    return result.recordset;
  },

  async getClientesNuevosVsRecurrentes(filter: ReportFilter): Promise<ClienteTipoRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }

    const result = await req.query(`
      WITH ventas_periodo AS (
        SELECT
          v.CLIENTE_ID,
          v.VENTA_ID,
          v.TOTAL,
          v.FECHA_VENTA
        FROM VENTAS v
        WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv}
          AND v.CLIENTE_ID IS NOT NULL
          AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
      ),
      primera_venta AS (
        SELECT CLIENTE_ID, MIN(CAST(FECHA_VENTA AS DATE)) AS PRIMERA FROM ventas_periodo GROUP BY CLIENTE_ID
      ),
      clasificacion AS (
        SELECT
          vp.CLIENTE_ID,
          vp.VENTA_ID,
          vp.TOTAL,
          CASE WHEN pv.PRIMERA >= @fechaDesde THEN 'Nuevo' ELSE 'Recurrente' END AS TIPO
        FROM ventas_periodo vp
        JOIN primera_venta pv ON pv.CLIENTE_ID = vp.CLIENTE_ID
      )
      SELECT
        TIPO,
        COUNT(DISTINCT CLIENTE_ID) AS CANTIDAD_CLIENTES,
        COUNT(*) AS CANTIDAD_VENTAS,
        CAST(ISNULL(SUM(TOTAL), 0) AS DECIMAL(18, 2)) AS TOTAL
      FROM clasificacion
      GROUP BY TIPO
      ORDER BY TIPO
    `);
    return result.recordset;
  },

  async getProductMix(filter: ReportFilter, dimension: 'categoria' | 'marca' = 'categoria'): Promise<ProductMixRow[]> {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta);
    let pv = '';
    if (filter.puntoVentaId) {
      pv = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, filter.puntoVentaId);
    }
    const join = dimension === 'categoria'
      ? `LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID`
      : `LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID`;
    const group = dimension === 'categoria' ? `c.NOMBRE` : `m.NOMBRE`;
    const alias = dimension === 'categoria' ? 'Sin Categoría' : 'Sin Marca';

    const result = await req.query(`
      SELECT
        p.PRODUCTO_ID,
        p.CODIGOPARTICULAR,
        p.NOMBRE,
        ISNULL(${group}, '${alias}') AS ${dimension === 'categoria' ? 'CATEGORIA' : 'MARCA'},
        ISNULL(SUM(vi.CANTIDAD), 0) AS UNIDADES,
        CAST(ISNULL(SUM(vi.CANTIDAD * vi.PRECIO_UNITARIO), 0) AS DECIMAL(18, 2)) AS TOTAL
      FROM VENTAS_ITEMS vi
      JOIN VENTAS v ON vi.VENTA_ID = v.VENTA_ID
      JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
      ${join}
      WHERE CAST(v.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta ${pv}
        AND (v.TIPO_COMPROBANTE IS NULL OR v.TIPO_COMPROBANTE NOT LIKE 'NC%')
      GROUP BY p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, ${group}
      ORDER BY TOTAL DESC
    `);
    return result.recordset;
  },
};