import { getPool, sql } from '../database/connection.js';
import type { Producto, PaginatedResult } from '../types/index.js';
import { normalizarTipoMargen, validateMargenPorTipo } from '../utils/pricing.js';
import { registrarHistorialStock } from './stockHistorial.helper.js';
import { assertStockNoNegativo } from './stockValidator.helper.js';
import { webhookDispatcher } from './webhook.dispatcher.js';

// ═══════════════════════════════════════════════════
//  Product Service — Full CRUD + Bulk Operations
//  Refactor: precios viven en PRODUCTO_LISTA_PRECIOS,
//  no en columnas LISTA_X de PRODUCTOS.
// ═══════════════════════════════════════════════════

export interface ProductFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  categoriaId?: number;
  marcaId?: number;
  unidadIds?: number[];
  activo?: boolean;
  stockBajo?: boolean;
  listaDefecto?: number;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface ProductPrecioInput {
  LISTA_ID: number;
  PRECIO: number;
}

export interface ProductInput {
  CODIGOPARTICULAR?: string;
  NOMBRE?: string;
  DESCRIPCION?: string | null;
  CATEGORIA_ID?: number | null;
  MARCA_ID?: number | null;
  UNIDAD_ID?: number | null;
  PRECIO_COMPRA?: number | null;
  COSTO_USD?: number | null;
  PRECIO_COMPRA_BASE?: number;
  STOCK_MINIMO?: number | null;
  TASA_IVA_ID?: number | null;
  IMP_INT?: number;
  ES_CONJUNTO?: boolean | null;
  ES_SERVICIO?: boolean;
  DESCUENTA_STOCK?: boolean;
  PERMITE_STOCK_NEGATIVO?: boolean;
  ACTIVO?: boolean;
  LISTA_DEFECTO?: number | null;
  FECHA_VENCIMIENTO?: string | null;
  MARGEN_INDIVIDUAL?: boolean | null;
  VENTA_WEB?: boolean;
  /** Mapa { LISTA_ID → PRECIO } para asignar precios por lista. */
  precios?: Record<number, number>;
  codigosBarras?: string[];
  depositos?: { DEPOSITO_ID: number; CANTIDAD: number }[];
  proveedores?: number[];
}

export interface InlineEditInput {
  PRODUCTO_ID: number;
  campo: string;
  valor: any;
}

export interface BulkAssignInput {
  productoIds: number[];
  campo: string;
  valor: any;
}

export interface BulkPriceInput {
  productoIds: number[];
  listaId: number;
  margen: number;
  fuente: 'ARS' | 'USD';
  redondeo?: 'ninguno' | '50' | '100' | 'entero';
}

async function upsertPrecios(
  tx: any,
  productoId: number,
  precios: Record<number, number> | undefined,
) {
  if (!precios) return;
  for (const [listaIdStr, precio] of Object.entries(precios)) {
    const listaId = Number(listaIdStr);
    if (!Number.isInteger(listaId) || listaId < 1) continue;
    const precioNum = Number(precio) || 0;
    if (precioNum <= 0) {
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('listaId', sql.Int, listaId)
        .query('DELETE FROM PRODUCTO_LISTA_PRECIOS WHERE PRODUCTO_ID = @prodId AND LISTA_ID = @listaId');
    } else {
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('listaId', sql.Int, listaId)
        .input('precio', sql.Decimal(18, 4), precioNum)
        .query(`
          MERGE PRODUCTO_LISTA_PRECIOS AS target
          USING (SELECT @prodId AS PRODUCTO_ID, @listaId AS LISTA_ID, @precio AS PRECIO) AS src
          ON target.PRODUCTO_ID = src.PRODUCTO_ID AND target.LISTA_ID = src.LISTA_ID
          WHEN MATCHED THEN
            UPDATE SET PRECIO = src.PRECIO, FECHA_ACTUALIZACION = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (PRODUCTO_ID, LISTA_ID, PRECIO)
            VALUES (src.PRODUCTO_ID, src.LISTA_ID, src.PRECIO);
        `);
    }
  }
}

// Setea/limpia MARGEN_INDIVIDUAL en PRODUCTO_LISTA_PRECIOS para un (producto, lista).
// Si el margen real (precio/costo - 1) difiere del margen default de la lista
// más allá de la tolerancia, marca el override. Si no, lo limpia (NULL).
// Acepta cualquier listaId (no hay restricción a 1..5).
const MARGEN_INDIVIDUAL_TOLERANCE = 0.5;

async function setMargenIndividual(
  req: any,
  productoId: number,
  listaId: number,
  precio: number,
  precioCompra: number,
) {
  // Precio 0 o costo 0 → sin override (no podemos calcular margen)
  if (precio <= 0 || precioCompra <= 0) {
    await req
      .input('productoId', sql.Int, productoId)
      .input('listaId', sql.Int, listaId)
      .query(`
        UPDATE PRODUCTO_LISTA_PRECIOS
        SET MARGEN_INDIVIDUAL = NULL
        WHERE LISTA_ID = @listaId AND PRODUCTO_ID = @productoId
      `);
    return;
  }

  await req
    .input('productoId', sql.Int, productoId)
    .input('listaId', sql.Int, listaId)
    .input('precio', sql.Decimal(18, 4), precio)
    .input('precioCompra', sql.Decimal(18, 4), precioCompra)
    .query(`
      DECLARE @margenReal DECIMAL(9, 4);
      DECLARE @margenDefault DECIMAL(9, 4);
      DECLARE @tipoMargen CHAR(1);

      SELECT @margenDefault = ISNULL(MARGEN, 0),
             @tipoMargen = ISNULL(TIPO_MARGEN, 'M')
      FROM LISTA_PRECIOS
      WHERE LISTA_ID = @listaId;

      IF @tipoMargen = 'U'
          SET @margenReal = ROUND((1 - (@precioCompra / @precio)) * 100, 4);
      ELSE
          SET @margenReal = ROUND(((@precio / @precioCompra) - 1) * 100, 4);

      UPDATE PRODUCTO_LISTA_PRECIOS
      SET MARGEN_INDIVIDUAL = CASE
        WHEN ABS(@margenReal - @margenDefault) > ${MARGEN_INDIVIDUAL_TOLERANCE}
          THEN @margenReal
        ELSE NULL
      END
      WHERE LISTA_ID = @listaId AND PRODUCTO_ID = @productoId;
    `);
}

export const productService = {
  // ── List with pagination & filters ─────────────
  async getAll(filter: ProductFilter = {}): Promise<PaginatedResult<Producto>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];
    let joinCodBarras = false;

    if (filter.activo !== undefined) {
      where += ' AND p.ACTIVO = @activo';
      params.push({ name: 'activo', type: sql.Bit, value: filter.activo ? 1 : 0 });
    }
    if (filter.search) {
      const searchTrim = filter.search.trim();
      if (/^\d+$/.test(searchTrim)) {
        joinCodBarras = true;
        where += ' AND (p.PRODUCTO_ID = @searchProductId OR p.CODIGOPARTICULAR = @searchCode OR cb.CODIGO_BARRAS = @searchCode)';
        params.push({ name: 'searchProductId', type: sql.Int, value: Number(searchTrim) });
        params.push({ name: 'searchCode', type: sql.NVarChar, value: searchTrim });
      } else {
        const tokens = searchTrim.split(/\s+/).filter(t => t.length > 0);
        tokens.forEach((token, i) => {
          where += ` AND (p.NOMBRE LIKE @t${i} OR p.CODIGOPARTICULAR LIKE @t${i})`;
          params.push({ name: `t${i}`, type: sql.NVarChar, value: `%${token}%` });
        });
      }
    }
    if (filter.categoriaId) {
      where += ' AND p.CATEGORIA_ID = @categoriaId';
      params.push({ name: 'categoriaId', type: sql.Int, value: filter.categoriaId });
    }
    if (filter.marcaId) {
      where += ' AND p.MARCA_ID = @marcaId';
      params.push({ name: 'marcaId', type: sql.Int, value: filter.marcaId });
    }
    if (filter.unidadIds && filter.unidadIds.length > 0) {
      const unidadParamNames = filter.unidadIds.map((unidadId, i) => {
        const name = `unidadId${i}`;
        params.push({ name, type: sql.Int, value: unidadId });
        return `@${name}`;
      });
      where += ` AND p.UNIDAD_ID IN (${unidadParamNames.join(', ')})`;
    }
    if (filter.stockBajo) {
      where += ' AND p.STOCK_MINIMO IS NOT NULL AND (SELECT ISNULL(SUM(sd2.CANTIDAD),0) FROM STOCK_DEPOSITOS sd2 WHERE sd2.PRODUCTO_ID = p.PRODUCTO_ID) <= p.STOCK_MINIMO';
    }
    if (filter.listaDefecto) {
      where += ' AND p.LISTA_DEFECTO = @listaDefecto';
      params.push({ name: 'listaDefecto', type: sql.Int, value: filter.listaDefecto });
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    const validCols: Record<string, string> = {
      id: 'p.PRODUCTO_ID',
      nombre: 'p.NOMBRE', codigo: 'p.CODIGOPARTICULAR', categoria: 'c.NOMBRE',
      marca: 'm.NOMBRE', precio: 'p.PRECIO_COMPRA', stock: '(SELECT ISNULL(SUM(sd2.CANTIDAD),0) FROM STOCK_DEPOSITOS sd2 WHERE sd2.PRODUCTO_ID = p.PRODUCTO_ID)',
    };
    const orderByKey = (filter.orderBy || 'nombre').toLowerCase();
    const orderCol = validCols[orderByKey] || 'p.NOMBRE';
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    const joinCategoria = orderByKey === 'categoria';
    const joinMarca = orderByKey === 'marca';
    const codBarrasJoin = joinCodBarras ? 'LEFT JOIN PRODUCTOS_COD_BARRAS cb ON p.PRODUCTO_ID = cb.PRODUCTO_ID' : '';
    const categoriaJoin = joinCategoria ? 'LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID' : '';
    const marcaJoin = joinMarca ? 'LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID' : '';
    const distinct = joinCodBarras ? 'DISTINCT' : '';
    const countExpr = joinCodBarras ? 'COUNT(DISTINCT p.PRODUCTO_ID)' : 'COUNT(*)';

    const [countResult, dataResult] = await Promise.all([
      bind(pool.request()).query(`
        SELECT ${countExpr} as total
        FROM PRODUCTOS p
        ${codBarrasJoin}
        ${where}
        OPTION (RECOMPILE)
      `),
      (() => {
        const dataReq = bind(pool.request());
        dataReq.input('offset', sql.Int, offset);
        dataReq.input('pageSize', sql.Int, pageSize);
        return dataReq.query(`
          SELECT ${distinct}
            p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, p.DESCRIPCION,
            (SELECT ISNULL(SUM(sd2.CANTIDAD),0) FROM STOCK_DEPOSITOS sd2 WHERE sd2.PRODUCTO_ID = p.PRODUCTO_ID) AS CANTIDAD,
            p.CATEGORIA_ID, p.PRECIO_COMPRA, p.MARCA_ID,
            p.STOCK_MINIMO, p.UNIDAD_ID, p.ACTIVO,
            p.LISTA_DEFECTO, p.COSTO_USD, p.TASA_IVA_ID,
            p.ES_CONJUNTO, p.ES_SERVICIO, p.DESCUENTA_STOCK, ISNULL(p.PERMITE_STOCK_NEGATIVO, 0) AS PERMITE_STOCK_NEGATIVO, p.PRECIO_COMPRA_BASE, p.IMP_INT,
            p.FECHA_VENCIMIENTO, p.MARGEN_INDIVIDUAL,
            ISNULL(p.VENTA_WEB, 0) AS VENTA_WEB,
            (SELECT TOP 1 NOMBRE FROM CATEGORIAS WHERE CATEGORIA_ID = p.CATEGORIA_ID) AS CATEGORIA_NOMBRE,
            (SELECT TOP 1 NOMBRE FROM MARCAS WHERE MARCA_ID = p.MARCA_ID) AS MARCA_NOMBRE,
            u.NOMBRE AS UNIDAD_NOMBRE,
            u.ABREVIACION AS UNIDAD_ABREVIACION,
            (
              SELECT plp.LISTA_ID AS LISTA_ID, plp.PRECIO AS PRECIO
              FROM PRODUCTO_LISTA_PRECIOS plp
              WHERE plp.PRODUCTO_ID = p.PRODUCTO_ID
              ORDER BY plp.LISTA_ID
              FOR JSON PATH
            ) AS PRECIOS_JSON
          FROM PRODUCTOS p
          LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
          ${categoriaJoin}
          ${marcaJoin}
          ${codBarrasJoin}
          ${where}
          ORDER BY ${orderCol} ${orderDir}
          OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
          OPTION (RECOMPILE)
        `);
      })(),
    ]);

    const total = countResult.recordset[0].total;

    // Mapear PRECIOS_JSON → PRECIOS
    const data = (dataResult.recordset as any[]).map(row => {
      let precios: { LISTA_ID: number; PRECIO: number }[] = [];
      if (row.PRECIOS_JSON) {
        try { precios = JSON.parse(row.PRECIOS_JSON); } catch { precios = []; }
      }
      const { PRECIOS_JSON, ...rest } = row;
      return { ...rest, PRECIOS: precios };
    });

    return { data, total, page, pageSize };
  },

  // ── Get by ID (full detail) ────────────────────
  async getById(id: number) {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, id)
      .query<Producto>(`
        SELECT p.*,
          c.NOMBRE AS CATEGORIA_NOMBRE, m.NOMBRE AS MARCA_NOMBRE,
          u.NOMBRE AS UNIDAD_NOMBRE, u.ABREVIACION AS UNIDAD_ABREVIACION,
          ti.NOMBRE AS TASA_IVA_NOMBRE, ti.PORCENTAJE AS TASA_IVA_PORCENTAJE
        FROM PRODUCTOS p
        LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
        LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
        LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
        LEFT JOIN TASAS_IMPUESTOS ti ON p.TASA_IVA_ID = ti.TASA_ID
        WHERE p.PRODUCTO_ID = @id
      `);

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Producto no encontrado'), { name: 'ValidationError' });
    }

    const cbResult = await pool.request().input('id', sql.Int, id)
      .query(`SELECT ID, CODIGO_BARRAS FROM PRODUCTOS_COD_BARRAS WHERE PRODUCTO_ID = @id`);

    const stockResult = await pool.request().input('id', sql.Int, id)
      .query(`SELECT sd.*, d.NOMBRE AS DEPOSITO_NOMBRE FROM STOCK_DEPOSITOS sd
              JOIN DEPOSITOS d ON sd.DEPOSITO_ID = d.DEPOSITO_ID WHERE sd.PRODUCTO_ID = @id`);

    const provResult = await pool.request().input('id', sql.Int, id)
      .query(`SELECT pp.PRODUCTOS_PROVEEDORES_ID, pp.PROVEEDOR_ID, pr.NOMBRE AS PROVEEDOR_NOMBRE
              FROM PRODUCTOS_PROVEEDORES pp JOIN PROVEEDORES pr ON pp.PROVEEDOR_ID = pr.PROVEEDOR_ID
              WHERE pp.PRODUCTO_ID = @id`);

    // Precios por lista con su margen individual override (si difiere del default).
    const preciosResult = await pool.request().input('id', sql.Int, id)
      .query(`SELECT LISTA_ID, PRECIO, MARGEN_INDIVIDUAL
              FROM PRODUCTO_LISTA_PRECIOS
              WHERE PRODUCTO_ID = @id
              ORDER BY LISTA_ID`);

    return {
      ...result.recordset[0],
      codigosBarras: cbResult.recordset.map((r: any) => r.CODIGO_BARRAS),
      proveedores: provResult.recordset,
      stockDepositos: stockResult.recordset,
      precios: preciosResult.recordset as { LISTA_ID: number; PRECIO: number; MARGEN_INDIVIDUAL: number | null }[],
    };
  },

  async getStockByProduct(productoId: number, puntoVentaId?: number) {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, productoId)
      .input('pvId', sql.Int, puntoVentaId ?? null)
      .query(`
        SELECT sd.*, d.NOMBRE AS DEPOSITO_NOMBRE
        FROM STOCK_DEPOSITOS sd
        JOIN DEPOSITOS d ON sd.DEPOSITO_ID = d.DEPOSITO_ID
        WHERE sd.PRODUCTO_ID = @id
          AND (@pvId IS NULL OR EXISTS (
            SELECT 1 FROM PUNTOS_VENTA_DEPOSITOS pvd
            WHERE pvd.DEPOSITO_ID = d.DEPOSITO_ID AND pvd.PUNTO_VENTA_ID = @pvId
          ))
      `);
    return result.recordset;
  },

  async create(input: ProductInput, usuarioId?: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      if (input.CODIGOPARTICULAR?.trim()) {
        const dup = await tx.request()
          .input('code', sql.NVarChar, input.CODIGOPARTICULAR.trim())
          .query(`SELECT 1 FROM PRODUCTOS WHERE CODIGOPARTICULAR = @code`);
        if (dup.recordset.length > 0) {
          throw Object.assign(new Error('El código ya existe'), { name: 'ValidationError' });
        }
      }

      const result = await tx.request()
        .input('codigo', sql.NVarChar, input.CODIGOPARTICULAR?.trim() || 'TEMP')
        .input('nombre', sql.NVarChar, input.NOMBRE)
        .input('descripcion', sql.VarChar, input.DESCRIPCION || null)
        .input('categoriaId', sql.Int, input.CATEGORIA_ID || null)
        .input('marcaId', sql.Int, input.MARCA_ID || null)
        .input('unidadId', sql.Int, input.UNIDAD_ID || null)
        .input('precioCompra', sql.Decimal(18, 4), input.PRECIO_COMPRA || 0)
        .input('costoUsd', sql.Decimal(18, 4), input.COSTO_USD || 0)
        .input('precioCompraBase', sql.Decimal(18, 4), input.PRECIO_COMPRA_BASE || 0)
        .input('stockMinimo', sql.Decimal(18, 4), input.STOCK_MINIMO || 0)
        .input('tasaIvaId', sql.Int, input.TASA_IVA_ID || null)
        .input('impInt', sql.Decimal(18, 4), input.IMP_INT || 0)
        .input('esConjunto', sql.Bit, input.ES_CONJUNTO ? 1 : 0)
        .input('esServicio', sql.Bit, input.ES_SERVICIO ? 1 : 0)
        .input('descuentaStock', sql.Bit, input.ES_SERVICIO ? 0 : (input.DESCUENTA_STOCK !== false ? 1 : 0))
        .input('permiteStockNeg', sql.Bit, input.ES_SERVICIO ? 0 : (input.PERMITE_STOCK_NEGATIVO === true ? 1 : 0))
        .input('activo', sql.Bit, input.ACTIVO !== false ? 1 : 0)
        .input('listaDefecto', sql.Int, input.LISTA_DEFECTO || null)
        .input('fechaVenc', sql.Date, input.FECHA_VENCIMIENTO || null)
        .input('margenInd', sql.Bit, input.MARGEN_INDIVIDUAL ? 1 : 0)
        .input('ventaWeb', sql.Bit, input.VENTA_WEB ? 1 : 0)
        .query(`
          INSERT INTO PRODUCTOS (
            CODIGOPARTICULAR, NOMBRE, DESCRIPCION, CATEGORIA_ID, MARCA_ID, UNIDAD_ID,
            PRECIO_COMPRA, COSTO_USD, PRECIO_COMPRA_BASE, STOCK_MINIMO, TASA_IVA_ID, IMP_INT,
            ES_CONJUNTO, ES_SERVICIO, DESCUENTA_STOCK, PERMITE_STOCK_NEGATIVO, ACTIVO, CANTIDAD,
            LISTA_DEFECTO,
            FECHA_VENCIMIENTO, MARGEN_INDIVIDUAL, VENTA_WEB
          ) VALUES (
            @codigo, @nombre, @descripcion, @categoriaId, @marcaId, @unidadId,
            @precioCompra, @costoUsd, @precioCompraBase, @stockMinimo, @tasaIvaId, @impInt,
            @esConjunto, @esServicio, @descuentaStock, @permiteStockNeg, @activo, 0,
            @listaDefecto,
            @fechaVenc, @margenInd, @ventaWeb
          );
          SELECT SCOPE_IDENTITY() AS PRODUCTO_ID;
        `);

      const productoId = result.recordset[0].PRODUCTO_ID;

      if (!input.CODIGOPARTICULAR?.trim()) {
        await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('codPart', sql.NVarChar, String(productoId))
          .query(`UPDATE PRODUCTOS SET CODIGOPARTICULAR = @codPart WHERE PRODUCTO_ID = @prodId`);
      }

      // Insertar precios por lista
      await upsertPrecios(tx, productoId, input.precios);

      if (input.codigosBarras?.length) {
        for (const cb of input.codigosBarras) {
          if (cb.trim()) {
            await tx.request()
              .input('prodId', sql.Int, productoId).input('cb', sql.NVarChar, cb.trim())
              .query(`INSERT INTO PRODUCTOS_COD_BARRAS (PRODUCTO_ID, CODIGO_BARRAS) VALUES (@prodId, @cb)`);
          }
        }
      }

      if (input.depositos?.length) {
        for (const dep of input.depositos) {
          await tx.request()
            .input('prodId', sql.Int, productoId).input('depId', sql.Int, dep.DEPOSITO_ID)
            .query(`INSERT INTO PRODUCTO_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID) VALUES (@prodId, @depId)`);
          const maxId = await tx.request().query(`SELECT ISNULL(MAX(ITEM_ID), 0) + 1 AS nextId FROM STOCK_DEPOSITOS`);
          const nextItemId = maxId.recordset[0].nextId;
          await tx.request()
            .input('itemId', sql.Int, nextItemId)
            .input('prodId2', sql.Int, productoId).input('depId2', sql.Int, dep.DEPOSITO_ID)
            .input('cant', sql.Decimal(18, 4), dep.CANTIDAD)
            .query(`INSERT INTO STOCK_DEPOSITOS (ITEM_ID, PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@itemId, @prodId2, @depId2, @cant)`);
          await registrarHistorialStock(tx, {
            productoId, depositoId: dep.DEPOSITO_ID,
            cantidadAnterior: 0, cantidadNueva: dep.CANTIDAD,
            tipoOperacion: 'PRODUCTO_EDIT', referenciaId: productoId,
            referenciaDetalle: `Alta Producto #${productoId}`, usuarioId,
          });
        }
        await tx.request().input('prodId', sql.Int, productoId)
          .query(`UPDATE PRODUCTOS SET CANTIDAD = (SELECT ISNULL(SUM(CANTIDAD),0) FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId) WHERE PRODUCTO_ID = @prodId`);
      }

      if (input.proveedores?.length) {
        for (const provId of input.proveedores) {
          await tx.request()
            .input('prodId', sql.Int, productoId).input('provId', sql.Int, provId)
            .query(`INSERT INTO PRODUCTOS_PROVEEDORES (PRODUCTO_ID, PROVEEDOR_ID) VALUES (@prodId, @provId)`);
        }
      }

      // NOTA: PRODUCTO_MARGENES quedó deprecada. Los márgenes individuales
      // viven en PRODUCTO_LISTA_PRECIOS.MARGEN_INDIVIDUAL y se setean al
      // asignar un precio explícito. El bulk insert de precios de arriba
      // (precios) no marca overrides — son precios calculados del margen default.

      await tx.commit();
      return { PRODUCTO_ID: productoId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  async update(id: number, input: ProductInput, usuarioId?: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      const fieldMap: { column: string; param: string; type: any; value: any; key: keyof ProductInput }[] = [
        { column: 'CODIGOPARTICULAR', param: 'codigo', type: sql.NVarChar, value: input.CODIGOPARTICULAR, key: 'CODIGOPARTICULAR' },
        { column: 'NOMBRE', param: 'nombre', type: sql.NVarChar, value: input.NOMBRE, key: 'NOMBRE' },
        { column: 'DESCRIPCION', param: 'descripcion', type: sql.VarChar, value: input.DESCRIPCION || null, key: 'DESCRIPCION' },
        { column: 'CATEGORIA_ID', param: 'categoriaId', type: sql.Int, value: input.CATEGORIA_ID || null, key: 'CATEGORIA_ID' },
        { column: 'MARCA_ID', param: 'marcaId', type: sql.Int, value: input.MARCA_ID || null, key: 'MARCA_ID' },
        { column: 'UNIDAD_ID', param: 'unidadId', type: sql.Int, value: input.UNIDAD_ID || null, key: 'UNIDAD_ID' },
        { column: 'PRECIO_COMPRA', param: 'precioCompra', type: sql.Decimal(18, 4), value: input.PRECIO_COMPRA || 0, key: 'PRECIO_COMPRA' },
        { column: 'COSTO_USD', param: 'costoUsd', type: sql.Decimal(18, 4), value: input.COSTO_USD || 0, key: 'COSTO_USD' },
        { column: 'PRECIO_COMPRA_BASE', param: 'precioCompraBase', type: sql.Decimal(18, 4), value: input.PRECIO_COMPRA_BASE || 0, key: 'PRECIO_COMPRA_BASE' },
        { column: 'STOCK_MINIMO', param: 'stockMinimo', type: sql.Decimal(18, 4), value: input.STOCK_MINIMO || 0, key: 'STOCK_MINIMO' },
        { column: 'TASA_IVA_ID', param: 'tasaIvaId', type: sql.Int, value: input.TASA_IVA_ID || null, key: 'TASA_IVA_ID' },
        { column: 'IMP_INT', param: 'impInt', type: sql.Decimal(18, 4), value: input.IMP_INT || 0, key: 'IMP_INT' },
        { column: 'ES_CONJUNTO', param: 'esConjunto', type: sql.Bit, value: input.ES_CONJUNTO ? 1 : 0, key: 'ES_CONJUNTO' },
        { column: 'ES_SERVICIO', param: 'esServicio', type: sql.Bit, value: input.ES_SERVICIO ? 1 : 0, key: 'ES_SERVICIO' },
        { column: 'DESCUENTA_STOCK', param: 'descuentaStock', type: sql.Bit, value: input.ES_SERVICIO ? 0 : (input.DESCUENTA_STOCK !== false ? 1 : 0), key: 'DESCUENTA_STOCK' },
        { column: 'PERMITE_STOCK_NEGATIVO', param: 'permiteStockNeg', type: sql.Bit, value: input.ES_SERVICIO ? 0 : (input.PERMITE_STOCK_NEGATIVO === true ? 1 : 0), key: 'PERMITE_STOCK_NEGATIVO' },
        { column: 'ACTIVO', param: 'activo', type: sql.Bit, value: input.ACTIVO !== false ? 1 : 0, key: 'ACTIVO' },
        { column: 'LISTA_DEFECTO', param: 'listaDefecto', type: sql.Int, value: input.LISTA_DEFECTO || null, key: 'LISTA_DEFECTO' },
        { column: 'FECHA_VENCIMIENTO', param: 'fechaVenc', type: sql.Date, value: input.FECHA_VENCIMIENTO || null, key: 'FECHA_VENCIMIENTO' },
        { column: 'MARGEN_INDIVIDUAL', param: 'margenInd', type: sql.Bit, value: input.MARGEN_INDIVIDUAL ? 1 : 0, key: 'MARGEN_INDIVIDUAL' },
        { column: 'VENTA_WEB', param: 'ventaWeb', type: sql.Bit, value: input.VENTA_WEB ? 1 : 0, key: 'VENTA_WEB' },
      ];

      const toUpdate = fieldMap.filter(f => f.key in input);

      if (toUpdate.length > 0) {
        const req = tx.request().input('id', sql.Int, id);
        for (const f of toUpdate) req.input(f.param, f.type, f.value);
        const setClauses = toUpdate.map(f => `${f.column}=@${f.param}`).join(', ');
        await req.query(`UPDATE PRODUCTOS SET ${setClauses} WHERE PRODUCTO_ID = @id`);
      }

      // Actualizar precios por lista
      if (input.precios !== undefined) {
        await upsertPrecios(tx, id, input.precios);

        // Sincronizar MARGEN_INDIVIDUAL por cada (lista, producto) tras editar precio.
        // Si el margen real difiere del default de la lista se marca como override.
        const pcResult = await tx.request().input('id', sql.Int, id)
          .query('SELECT ISNULL(PRECIO_COMPRA, 0) AS PC FROM PRODUCTOS WHERE PRODUCTO_ID = @id');
        const pc = pcResult.recordset[0]?.PC || 0;
        for (const [listaIdStr, precio] of Object.entries(input.precios)) {
          const listaId = Number(listaIdStr);
          const precioNum = Number(precio) || 0;
          await setMargenIndividual(tx.request(), id, listaId, precioNum, pc);
        }
      }

      if (input.codigosBarras !== undefined) {
        await tx.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS_COD_BARRAS WHERE PRODUCTO_ID = @id`);
        for (const cb of (input.codigosBarras || [])) {
          if (cb.trim()) {
            await tx.request().input('prodId', sql.Int, id).input('cb', sql.NVarChar, cb.trim())
              .query(`INSERT INTO PRODUCTOS_COD_BARRAS (PRODUCTO_ID, CODIGO_BARRAS) VALUES (@prodId, @cb)`);
          }
        }
      }

      if (input.depositos !== undefined) {
        const oldStockRows = await tx.request().input('id', sql.Int, id)
          .query(`SELECT DEPOSITO_ID, CANTIDAD FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @id`);
        const oldStockMap = new Map<number, number>();
        for (const row of oldStockRows.recordset) {
          oldStockMap.set(row.DEPOSITO_ID, parseFloat(row.CANTIDAD));
        }

        // Validar que ningún depósito quede con stock negativo si el producto no lo permite
        for (const dep of (input.depositos || [])) {
          await assertStockNoNegativo(tx, id, dep.DEPOSITO_ID, dep.CANTIDAD, {
            operacion: 'AJUSTE_MANUAL',
            referenciaDetalle: `Edición de stock por depósito (depósito ${dep.DEPOSITO_ID})`,
          });
        }

        await tx.request().input('id', sql.Int, id).query(`DELETE FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @id`);
        await tx.request().input('id2', sql.Int, id).query(`DELETE FROM PRODUCTO_DEPOSITOS WHERE PRODUCTO_ID = @id2`);
        for (const dep of (input.depositos || [])) {
          await tx.request()
            .input('prodId', sql.Int, id).input('depId', sql.Int, dep.DEPOSITO_ID)
            .query(`INSERT INTO PRODUCTO_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID) VALUES (@prodId, @depId)`);
          const maxId = await tx.request().query(`SELECT ISNULL(MAX(ITEM_ID), 0) + 1 AS nextId FROM STOCK_DEPOSITOS`);
          const nextItemId = maxId.recordset[0].nextId;
          await tx.request()
            .input('itemId', sql.Int, nextItemId)
            .input('prodId2', sql.Int, id).input('depId2', sql.Int, dep.DEPOSITO_ID)
            .input('cant', sql.Decimal(18, 4), dep.CANTIDAD)
            .query(`INSERT INTO STOCK_DEPOSITOS (ITEM_ID, PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@itemId, @prodId2, @depId2, @cant)`);

          const prevQty = oldStockMap.get(dep.DEPOSITO_ID) || 0;
          if (dep.CANTIDAD !== prevQty) {
            await registrarHistorialStock(tx, {
              productoId: id, depositoId: dep.DEPOSITO_ID,
              cantidadAnterior: prevQty, cantidadNueva: dep.CANTIDAD,
              tipoOperacion: 'PRODUCTO_EDIT', referenciaId: id,
              referenciaDetalle: `Edición Producto #${id}`, usuarioId,
            });
          }
        }
        await tx.request().input('id', sql.Int, id)
          .query(`UPDATE PRODUCTOS SET CANTIDAD = (SELECT ISNULL(SUM(CANTIDAD),0) FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @id) WHERE PRODUCTO_ID = @id`);
      }

      if (input.proveedores !== undefined) {
        await tx.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS_PROVEEDORES WHERE PRODUCTO_ID = @id`);
        for (const provId of (input.proveedores || [])) {
          await tx.request().input('prodId', sql.Int, id).input('provId', sql.Int, provId)
            .query(`INSERT INTO PRODUCTOS_PROVEEDORES (PRODUCTO_ID, PROVEEDOR_ID) VALUES (@prodId, @provId)`);
        }
      }

      // NOTA: PRODUCTO_MARGENES está deprecada. El margen individual se maneja
      // vía PRODUCTO_LISTA_PRECIOS.MARGEN_INDIVIDUAL al editar precios.

      await tx.commit();

      // NOMBRE no dispara sync: el nombre es editable en la tienda y RG no lo pisa.
      const webRelevantChanged =
        ('precios'    in input) ||
        ('VENTA_WEB'  in input) ||
        ('ACTIVO'     in input);
      if (webRelevantChanged) {
        try {
          webhookDispatcher.notifyStockChange(id);
        } catch {
          // fire-and-forget
        }
      }
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  async delete(id: number) {
    const pool = await getPool();
    const check = await pool.request().input('id', sql.Int, id).query(`
      SELECT (SELECT COUNT(*) FROM VENTAS_ITEMS WHERE PRODUCTO_ID = @id) AS enVentas,
             (SELECT COUNT(*) FROM COMPRAS_ITEMS WHERE PRODUCTO_ID = @id) AS enCompras,
             (SELECT COUNT(*) FROM NC_COMPRAS_ITEMS WHERE PRODUCTO_ID = @id) AS enNC
    `);
    const { enVentas, enCompras, enNC } = check.recordset[0];

    if (enVentas > 0 || enCompras > 0 || enNC > 0) {
      await pool.request().input('id', sql.Int, id).query(`UPDATE PRODUCTOS SET ACTIVO = 0 WHERE PRODUCTO_ID = @id`);
      return { mode: 'soft' as const };
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS_COD_BARRAS WHERE PRODUCTO_ID = @id`);
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @id`);
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTO_DEPOSITOS WHERE PRODUCTO_ID = @id`);
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS_PROVEEDORES WHERE PRODUCTO_ID = @id`);
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTO_LISTA_PRECIOS WHERE PRODUCTO_ID = @id`);
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS WHERE PRODUCTO_ID = @id`);
      await tx.commit();
      return { mode: 'hard' as const };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // Inline cell edit para columnas simples. Edits de precio se manejan
  // con la convención de campo: `precio_LISTA_<ID>`.
  async inlineEdit(input: InlineEditInput) {
    const pool = await getPool();
    const allowedSimple: Record<string, any> = {
      CODIGOPARTICULAR: sql.NVarChar, NOMBRE: sql.NVarChar,
      PRECIO_COMPRA: sql.Decimal(18, 4),
      PERMITE_STOCK_NEGATIVO: sql.Bit,
    };
    const simpleColType = allowedSimple[input.campo];
    if (simpleColType) {
      let val = input.valor;
      if (input.campo === 'PERMITE_STOCK_NEGATIVO') {
        val = val === true || val === 'true' || val === 1 || val === '1' ? 1 : 0;
      }
      await pool.request()
        .input('id', sql.Int, input.PRODUCTO_ID)
        .input('val', simpleColType, val)
        .query(`UPDATE PRODUCTOS SET ${input.campo} = @val WHERE PRODUCTO_ID = @id`);

      // Ningún campo simple editable inline se propaga a la tienda:
      // el NOMBRE lo gestiona la tienda por su cuenta.
      return;
    }

    // precio_LISTA_<ID>: actualiza precio en PRODUCTO_LISTA_PRECIOS
    // y recalcula MARGEN_INDIVIDUAL según desviación vs margen default.
    const listaMatch = /^precio_LISTA_(\d+)$/.exec(input.campo);
    if (listaMatch) {
      const listaId = Number(listaMatch[1]);
      const newPrice = Number(input.valor) || 0;
      const req = pool.request()
        .input('id', sql.Int, input.PRODUCTO_ID)
        .input('listaId', sql.Int, listaId)
        .input('precio', sql.Decimal(18, 4), newPrice);
      if (newPrice <= 0) {
        await req.query('DELETE FROM PRODUCTO_LISTA_PRECIOS WHERE PRODUCTO_ID = @id AND LISTA_ID = @listaId');
      } else {
        await req.query(`
          MERGE PRODUCTO_LISTA_PRECIOS AS target
          USING (SELECT @id AS PRODUCTO_ID, @listaId AS LISTA_ID, @precio AS PRECIO) AS src
          ON target.PRODUCTO_ID = src.PRODUCTO_ID AND target.LISTA_ID = src.LISTA_ID
          WHEN MATCHED THEN
            UPDATE SET PRECIO = src.PRECIO, FECHA_ACTUALIZACION = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (PRODUCTO_ID, LISTA_ID, PRECIO) VALUES (src.PRODUCTO_ID, src.LISTA_ID, src.PRECIO);
        `);
      }

      // Sincronizar MARGEN_INDIVIDUAL (override si difiere del margen default de la lista)
      const info = await pool.request().input('id', sql.Int, input.PRODUCTO_ID)
        .query(`SELECT ISNULL(PRECIO_COMPRA, 0) AS PC FROM PRODUCTOS WHERE PRODUCTO_ID = @id`);
      const pc = info.recordset[0]?.PC || 0;
      await setMargenIndividual(pool.request(), input.PRODUCTO_ID, listaId, newPrice, pc);
      return;
    }

    throw Object.assign(new Error(`Campo no editable: ${input.campo}`), { name: 'ValidationError' });
  },

  async bulkAssign(input: BulkAssignInput) {
    const pool = await getPool();
    const { productoIds, campo, valor } = input;
    if (!productoIds.length) throw new Error('No se seleccionaron productos');

    const idList = productoIds.map((_, i) => `@id${i}`).join(',');

    if (campo === 'CATEGORIA_ID' || campo === 'MARCA_ID') {
      const req = pool.request().input('val', sql.Int, valor);
      productoIds.forEach((pid, i) => req.input(`id${i}`, sql.Int, pid));
      const result = await req.query(`UPDATE PRODUCTOS SET ${campo} = @val WHERE PRODUCTO_ID IN (${idList})`);
      return { affected: result.rowsAffected[0] };
    }

    if (campo === 'PROVEEDOR_ID') {
      let affected = 0;
      for (const prodId of productoIds) {
        const existing = await pool.request()
          .input('prodId', sql.Int, prodId).input('provId', sql.Int, valor)
          .query(`SELECT 1 FROM PRODUCTOS_PROVEEDORES WHERE PRODUCTO_ID = @prodId AND PROVEEDOR_ID = @provId`);
        if (existing.recordset.length === 0) {
          await pool.request().input('prodId', sql.Int, prodId).input('provId', sql.Int, valor)
            .query(`INSERT INTO PRODUCTOS_PROVEEDORES (PRODUCTO_ID, PROVEEDOR_ID) VALUES (@prodId, @provId)`);
          affected++;
        }
      }
      return { affected };
    }

    if (campo === 'PERMITE_STOCK_NEGATIVO') {
      const boolVal = valor ? 1 : 0;
      const req = pool.request().input('val', sql.Bit, boolVal);
      productoIds.forEach((pid, i) => req.input(`id${i}`, sql.Int, pid));
      const result = await req.query(`UPDATE PRODUCTOS SET PERMITE_STOCK_NEGATIVO = @val WHERE PRODUCTO_ID IN (${idList})`);
      return { affected: result.rowsAffected[0] };
    }

    throw Object.assign(new Error(`Campo no válido: ${campo}`), { name: 'ValidationError' });
  },

  async bulkDelete(productoIds: number[]) {
    const pool = await getPool();
    let deleted = 0, deactivated = 0;

    for (const id of productoIds) {
      const check = await pool.request().input('id', sql.Int, id).query(`
        SELECT (SELECT COUNT(*) FROM VENTAS_ITEMS WHERE PRODUCTO_ID = @id) AS v,
               (SELECT COUNT(*) FROM COMPRAS_ITEMS WHERE PRODUCTO_ID = @id) AS c,
               (SELECT COUNT(*) FROM NC_COMPRAS_ITEMS WHERE PRODUCTO_ID = @id) AS nc
      `);
      if (check.recordset[0].v > 0 || check.recordset[0].c > 0 || check.recordset[0].nc > 0) {
        await pool.request().input('id', sql.Int, id).query(`UPDATE PRODUCTOS SET ACTIVO = 0 WHERE PRODUCTO_ID = @id`);
        deactivated++;
      } else {
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS_COD_BARRAS WHERE PRODUCTO_ID = @id`);
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @id`);
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTO_DEPOSITOS WHERE PRODUCTO_ID = @id`);
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS_PROVEEDORES WHERE PRODUCTO_ID = @id`);
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTO_LISTA_PRECIOS WHERE PRODUCTO_ID = @id`);
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS WHERE PRODUCTO_ID = @id`);
        deleted++;
      }
    }
    return { deleted, deactivated };
  },

  // Genera precios en PRODUCTO_LISTA_PRECIOS a partir del costo y el margen
  // respetando el TIPO_MARGEN ('M' Markup / 'U' Utilidad) de la lista destino.
  async bulkGeneratePrices(input: BulkPriceInput) {
    const pool = await getPool();
    const { productoIds, listaId, margen, fuente, redondeo } = input;
    if (listaId < 1) throw new Error('Lista inválida');

    // Leer TIPO_MARGEN de la lista destino para elegir la fórmula.
    const listaRes = await pool.request()
      .input('lid', sql.Int, listaId)
      .query<{ TIPO_MARGEN: string }>(`SELECT TIPO_MARGEN FROM LISTA_PRECIOS WHERE LISTA_ID = @lid`);
    if (listaRes.recordset.length === 0) {
      throw Object.assign(new Error('Lista no encontrada'), { name: 'ValidationError' });
    }
    const tipoMargen = normalizarTipoMargen(listaRes.recordset[0].TIPO_MARGEN);
    try {
      validateMargenPorTipo(margen, tipoMargen);
    } catch (err: any) {
      throw Object.assign(new Error(err.message), { name: 'ValidationError' });
    }

    const costoCol = fuente === 'USD' ? 'COSTO_USD' : 'PRECIO_COMPRA';
    let affected = 0;

    for (const prodId of productoIds) {
      const prod = await pool.request().input('id', sql.Int, prodId)
        .query(`SELECT ${costoCol} AS costo FROM PRODUCTOS WHERE PRODUCTO_ID = @id`);
      if (prod.recordset.length === 0) continue;
      const costo = prod.recordset[0].costo || 0;
      if (costo <= 0) continue;
      let precio: number;
      if (tipoMargen === 'U') {
        precio = costo / (1 - margen / 100);
      } else {
        precio = costo * (1 + margen / 100);
      }
      switch (redondeo) {
        case 'entero': precio = Math.ceil(precio); break;
        case '50': precio = Math.ceil(precio / 50) * 50; break;
        case '100': precio = Math.ceil(precio / 100) * 100; break;
      }
      await pool.request()
        .input('id', sql.Int, prodId)
        .input('listaId', sql.Int, listaId)
        .input('precio', sql.Decimal(18, 4), precio)
        .query(`
          MERGE PRODUCTO_LISTA_PRECIOS AS target
          USING (SELECT @id AS PRODUCTO_ID, @listaId AS LISTA_ID, @precio AS PRECIO) AS src
          ON target.PRODUCTO_ID = src.PRODUCTO_ID AND target.LISTA_ID = src.LISTA_ID
          WHEN MATCHED THEN
            UPDATE SET PRECIO = src.PRECIO, FECHA_ACTUALIZACION = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (PRODUCTO_ID, LISTA_ID, PRECIO) VALUES (src.PRODUCTO_ID, src.LISTA_ID, src.PRECIO);
        `);
      affected++;
    }
    return { affected };
  },

  async copy(sourceId: number) {
    const pool = await getPool();
    const src = await pool.request().input('id', sql.Int, sourceId)
      .query(`SELECT * FROM PRODUCTOS WHERE PRODUCTO_ID = @id`);
    if (src.recordset.length === 0) throw new Error('Producto origen no encontrado');
    const s = src.recordset[0];

    const MAX_LEN = 50;
    const BASE_SUFFIX = ' (copia)';
    const baseCode = (s.CODIGOPARTICULAR as string).substring(0, MAX_LEN - BASE_SUFFIX.length);
    let newCodigo = baseCode + BASE_SUFFIX;
    let counter = 2;
    while (true) {
      const dup = await pool.request()
        .input('code', sql.NVarChar, newCodigo)
        .query(`SELECT 1 FROM PRODUCTOS WHERE CODIGOPARTICULAR = @code`);
      if (dup.recordset.length === 0) break;
      const suffix = ` (copia ${counter++})`;
      newCodigo = (s.CODIGOPARTICULAR as string).substring(0, MAX_LEN - suffix.length) + suffix;
    }

    const result = await pool.request()
      .input('codigo', sql.NVarChar, newCodigo)
      .input('nombre', sql.NVarChar, s.NOMBRE + ' (copia)')
      .input('descripcion', sql.VarChar, s.DESCRIPCION)
      .input('categoriaId', sql.Int, s.CATEGORIA_ID)
      .input('marcaId', sql.Int, s.MARCA_ID)
      .input('unidadId', sql.Int, s.UNIDAD_ID)
      .input('precioCompra', sql.Decimal(18, 4), s.PRECIO_COMPRA || 0)
      .input('costoUsd', sql.Decimal(18, 4), s.COSTO_USD || 0)
      .input('precioCompraBase', sql.Decimal(18, 4), s.PRECIO_COMPRA_BASE || 0)
      .input('stockMinimo', sql.Decimal(18, 4), s.STOCK_MINIMO || 0)
      .input('tasaIvaId', sql.Int, s.TASA_IVA_ID)
      .input('impInt', sql.Decimal(18, 4), s.IMP_INT || 0)
      .input('esConjunto', sql.Bit, s.ES_CONJUNTO ? 1 : 0)
      .input('esServicio', sql.Bit, s.ES_SERVICIO ? 1 : 0)
      .input('descuentaStock', sql.Bit, s.DESCUENTA_STOCK ? 1 : 0)
      .input('permiteStockNeg', sql.Bit, s.ES_SERVICIO ? 0 : (s.PERMITE_STOCK_NEGATIVO ? 1 : 0))
      .input('listaDefecto', sql.Int, s.LISTA_DEFECTO)
      .input('fechaVenc', sql.Date, s.FECHA_VENCIMIENTO)
      .input('margenInd', sql.Bit, s.MARGEN_INDIVIDUAL ? 1 : 0)
      .query(`
        INSERT INTO PRODUCTOS (
          CODIGOPARTICULAR, NOMBRE, DESCRIPCION, CATEGORIA_ID, MARCA_ID, UNIDAD_ID,
          PRECIO_COMPRA, COSTO_USD, PRECIO_COMPRA_BASE, STOCK_MINIMO, TASA_IVA_ID, IMP_INT,
          ES_CONJUNTO, ES_SERVICIO, DESCUENTA_STOCK, PERMITE_STOCK_NEGATIVO, ACTIVO, CANTIDAD,
          LISTA_DEFECTO,
          FECHA_VENCIMIENTO, MARGEN_INDIVIDUAL
        ) VALUES (
          @codigo, @nombre, @descripcion, @categoriaId, @marcaId, @unidadId,
          @precioCompra, @costoUsd, @precioCompraBase, @stockMinimo, @tasaIvaId, @impInt,
          @esConjunto, @esServicio, @descuentaStock, @permiteStockNeg, 1, 0,
          @listaDefecto,
          @fechaVenc, @margenInd
        );
        SELECT SCOPE_IDENTITY() AS PRODUCTO_ID;
      `);
    const newId = result.recordset[0].PRODUCTO_ID;

    // Copiar precios desde PRODUCTO_LISTA_PRECIOS
    await pool.request()
      .input('newId', sql.Int, newId)
      .input('srcId', sql.Int, sourceId)
      .query(`
        INSERT INTO PRODUCTO_LISTA_PRECIOS (LISTA_ID, PRODUCTO_ID, PRECIO)
        SELECT LISTA_ID, @newId, PRECIO
        FROM PRODUCTO_LISTA_PRECIOS
        WHERE PRODUCTO_ID = @srcId
      `);

    // NOTA: PRODUCTO_MARGENES está deprecada. El margen individual ahora
    // vive en PRODUCTO_LISTA_PRECIOS.MARGEN_INDIVIDUAL, que ya fue copiado
    // arriba (la copia SELECT * incluye todas las columnas).

    return { PRODUCTO_ID: newId };
  },

  async getTasasImpuestos() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TASA_ID, NOMBRE, PORCENTAJE, PREDETERMINADA, ACTIVA
      FROM TASAS_IMPUESTOS
      WHERE ACTIVA = 1 AND TIPO = 1
      ORDER BY TASA_ID
    `);
    return result.recordset;
  },

  // Para impresión de etiquetas: devuelve producto + todos sus precios por lista
  async getForLabels(filter: { search?: string; categoriaId?: number; marcaId?: number } = {}) {
    const pool = await getPool();

    let where = 'WHERE p.ACTIVO = 1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.search) {
      const tokens = filter.search.trim().split(/\s+/).filter(t => t.length > 0);
      tokens.forEach((token, i) => {
        where += ` AND (p.NOMBRE LIKE @t${i} OR p.CODIGOPARTICULAR LIKE @t${i}
                    OR cb.CODIGO_BARRAS LIKE @t${i}
                    OR c.NOMBRE LIKE @t${i} OR m.NOMBRE LIKE @t${i})`;
        params.push({ name: `t${i}`, type: sql.NVarChar, value: `%${token}%` });
      });
    }
    if (filter.categoriaId) {
      where += ' AND p.CATEGORIA_ID = @categoriaId';
      params.push({ name: 'categoriaId', type: sql.Int, value: filter.categoriaId });
    }
    if (filter.marcaId) {
      where += ' AND p.MARCA_ID = @marcaId';
      params.push({ name: 'marcaId', type: sql.Int, value: filter.marcaId });
    }

    const req = pool.request();
    for (const p of params) req.input(p.name, p.type, p.value);

    const result = await req.query(`
      SELECT DISTINCT
        p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE,
        p.LISTA_DEFECTO,
        c.NOMBRE AS CATEGORIA_NOMBRE,
        (SELECT TOP 1 CODIGO_BARRAS FROM PRODUCTOS_COD_BARRAS WHERE PRODUCTO_ID = p.PRODUCTO_ID) AS CODIGO_BARRAS,
        (
          SELECT plp.LISTA_ID AS LISTA_ID, plp.PRECIO AS PRECIO
          FROM PRODUCTO_LISTA_PRECIOS plp
          WHERE plp.PRODUCTO_ID = p.PRODUCTO_ID
          ORDER BY plp.LISTA_ID
          FOR JSON PATH
        ) AS PRECIOS_JSON
      FROM PRODUCTOS p
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
      LEFT JOIN PRODUCTOS_COD_BARRAS cb ON p.PRODUCTO_ID = cb.PRODUCTO_ID
      ${where}
      ORDER BY p.NOMBRE
    `);

    return (result.recordset as any[]).map(row => {
      let precios: { LISTA_ID: number; PRECIO: number }[] = [];
      if (row.PRECIOS_JSON) {
        try { precios = JSON.parse(row.PRECIOS_JSON); } catch { precios = []; }
      }
      const { PRECIOS_JSON, ...rest } = row;
      return { ...rest, PRECIOS: precios };
    });
  },
};
