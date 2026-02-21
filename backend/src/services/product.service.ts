import { getPool, sql } from '../database/connection.js';
import type { Producto, PaginatedResult } from '../types/index.js';

// ═══════════════════════════════════════════════════
//  Product Service — Full CRUD + Bulk Operations
// ═══════════════════════════════════════════════════

export interface ProductFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  categoriaId?: number;
  marcaId?: number;
  activo?: boolean;
  stockBajo?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface ProductInput {
  CODIGOPARTICULAR: string;
  NOMBRE: string;
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
  DESCUENTA_STOCK?: boolean;
  ACTIVO?: boolean;
  LISTA_1?: number;
  LISTA_2?: number;
  LISTA_3?: number;
  LISTA_4?: number;
  LISTA_5?: number;
  LISTA_DEFECTO?: number | null;
  FECHA_VENCIMIENTO?: string | null;
  MARGEN_INDIVIDUAL?: boolean | null;
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

export const productService = {
  // ── List with pagination & filters ─────────────
  async getAll(filter: ProductFilter = {}): Promise<PaginatedResult<Producto>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.activo !== undefined) {
      where += ' AND p.ACTIVO = @activo';
      params.push({ name: 'activo', type: sql.Bit, value: filter.activo ? 1 : 0 });
    }
    if (filter.search) {
      where += ` AND (p.NOMBRE LIKE @search OR p.CODIGOPARTICULAR LIKE @search 
                  OR p.DESCRIPCION LIKE @search OR cb.CODIGO_BARRAS LIKE @search)`;
      params.push({ name: 'search', type: sql.NVarChar, value: `%${filter.search}%` });
    }
    if (filter.categoriaId) {
      where += ' AND p.CATEGORIA_ID = @categoriaId';
      params.push({ name: 'categoriaId', type: sql.Int, value: filter.categoriaId });
    }
    if (filter.marcaId) {
      where += ' AND p.MARCA_ID = @marcaId';
      params.push({ name: 'marcaId', type: sql.Int, value: filter.marcaId });
    }
    if (filter.stockBajo) {
      where += ' AND p.STOCK_MINIMO IS NOT NULL AND p.CANTIDAD <= p.STOCK_MINIMO';
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    const countReq = bind(pool.request());
    const countResult = await countReq.query(`
      SELECT COUNT(DISTINCT p.PRODUCTO_ID) as total
      FROM PRODUCTOS p
      LEFT JOIN PRODUCTOS_COD_BARRAS cb ON p.PRODUCTO_ID = cb.PRODUCTO_ID
      ${where}
    `);
    const total = countResult.recordset[0].total;

    const validCols: Record<string, string> = {
      nombre: 'p.NOMBRE', codigo: 'p.CODIGOPARTICULAR', categoria: 'c.NOMBRE',
      marca: 'm.NOMBRE', precio: 'p.PRECIO_COMPRA', lista1: 'p.LISTA_1', stock: 'p.CANTIDAD',
    };
    const orderCol = validCols[(filter.orderBy || 'nombre').toLowerCase()] || 'p.NOMBRE';
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    const dataReq = bind(pool.request());
    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query(`
      SELECT DISTINCT
        p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, p.DESCRIPCION,
        p.CANTIDAD, p.CATEGORIA_ID, p.PRECIO_COMPRA, p.MARCA_ID,
        p.STOCK_MINIMO, p.UNIDAD_ID, p.ACTIVO,
        p.LISTA_1, p.LISTA_2, p.LISTA_3, p.LISTA_4, p.LISTA_5,
        p.LISTA_DEFECTO, p.COSTO_USD, p.TASA_IVA_ID,
        p.ES_CONJUNTO, p.DESCUENTA_STOCK, p.PRECIO_COMPRA_BASE, p.IMP_INT,
        p.FECHA_VENCIMIENTO, p.MARGEN_INDIVIDUAL,
        c.NOMBRE AS CATEGORIA_NOMBRE,
        m.NOMBRE AS MARCA_NOMBRE,
        u.NOMBRE AS UNIDAD_NOMBRE,
        u.ABREVIACION AS UNIDAD_ABREVIACION
      FROM PRODUCTOS p
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
      LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
      LEFT JOIN PRODUCTOS_COD_BARRAS cb ON p.PRODUCTO_ID = cb.PRODUCTO_ID
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
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

    return {
      ...result.recordset[0],
      codigosBarras: cbResult.recordset.map((r: any) => r.CODIGO_BARRAS),
      proveedores: provResult.recordset,
      stockDepositos: stockResult.recordset,
    };
  },

  // ── Get stock by product ───────────────────────
  async getStockByProduct(productoId: number) {
    const pool = await getPool();
    const result = await pool.request().input('id', sql.Int, productoId)
      .query(`SELECT sd.*, d.NOMBRE AS DEPOSITO_NOMBRE FROM STOCK_DEPOSITOS sd
              JOIN DEPOSITOS d ON sd.DEPOSITO_ID = d.DEPOSITO_ID WHERE sd.PRODUCTO_ID = @id`);
    return result.recordset;
  },

  // ── Create product ─────────────────────────────
  async create(input: ProductInput) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      const result = await tx.request()
        .input('codigo', sql.NVarChar, input.CODIGOPARTICULAR)
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
        .input('descuentaStock', sql.Bit, input.DESCUENTA_STOCK !== false ? 1 : 0)
        .input('activo', sql.Bit, input.ACTIVO !== false ? 1 : 0)
        .input('lista1', sql.Decimal(18, 4), input.LISTA_1 || 0)
        .input('lista2', sql.Decimal(18, 4), input.LISTA_2 || 0)
        .input('lista3', sql.Decimal(18, 4), input.LISTA_3 || 0)
        .input('lista4', sql.Decimal(18, 4), input.LISTA_4 || 0)
        .input('lista5', sql.Decimal(18, 4), input.LISTA_5 || 0)
        .input('listaDefecto', sql.Int, input.LISTA_DEFECTO || null)
        .input('fechaVenc', sql.Date, input.FECHA_VENCIMIENTO || null)
        .input('margenInd', sql.Bit, input.MARGEN_INDIVIDUAL ? 1 : 0)
        .query(`
          INSERT INTO PRODUCTOS (
            CODIGOPARTICULAR, NOMBRE, DESCRIPCION, CATEGORIA_ID, MARCA_ID, UNIDAD_ID,
            PRECIO_COMPRA, COSTO_USD, PRECIO_COMPRA_BASE, STOCK_MINIMO, TASA_IVA_ID, IMP_INT,
            ES_CONJUNTO, DESCUENTA_STOCK, ACTIVO, CANTIDAD,
            LISTA_1, LISTA_2, LISTA_3, LISTA_4, LISTA_5, LISTA_DEFECTO,
            FECHA_VENCIMIENTO, MARGEN_INDIVIDUAL
          ) VALUES (
            @codigo, @nombre, @descripcion, @categoriaId, @marcaId, @unidadId,
            @precioCompra, @costoUsd, @precioCompraBase, @stockMinimo, @tasaIvaId, @impInt,
            @esConjunto, @descuentaStock, @activo, 0,
            @lista1, @lista2, @lista3, @lista4, @lista5, @listaDefecto,
            @fechaVenc, @margenInd
          );
          SELECT SCOPE_IDENTITY() AS PRODUCTO_ID;
        `);

      const productoId = result.recordset[0].PRODUCTO_ID;

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
          // Insert into PRODUCTO_DEPOSITOS (relationship table)
          await tx.request()
            .input('prodId', sql.Int, productoId).input('depId', sql.Int, dep.DEPOSITO_ID)
            .query(`INSERT INTO PRODUCTO_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID) VALUES (@prodId, @depId)`);
          // Insert into STOCK_DEPOSITOS (stock tracking table)
          const maxId = await tx.request().query(`SELECT ISNULL(MAX(ITEM_ID), 0) + 1 AS nextId FROM STOCK_DEPOSITOS`);
          const nextItemId = maxId.recordset[0].nextId;
          await tx.request()
            .input('itemId', sql.Int, nextItemId)
            .input('prodId2', sql.Int, productoId).input('depId2', sql.Int, dep.DEPOSITO_ID)
            .input('cant', sql.Decimal(18, 4), dep.CANTIDAD)
            .query(`INSERT INTO STOCK_DEPOSITOS (ITEM_ID, PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@itemId, @prodId2, @depId2, @cant)`);
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

      await tx.commit();
      return { PRODUCTO_ID: productoId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update product ─────────────────────────────
  async update(id: number, input: ProductInput) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request()
        .input('id', sql.Int, id)
        .input('codigo', sql.NVarChar, input.CODIGOPARTICULAR)
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
        .input('descuentaStock', sql.Bit, input.DESCUENTA_STOCK !== false ? 1 : 0)
        .input('activo', sql.Bit, input.ACTIVO !== false ? 1 : 0)
        .input('lista1', sql.Decimal(18, 4), input.LISTA_1 || 0)
        .input('lista2', sql.Decimal(18, 4), input.LISTA_2 || 0)
        .input('lista3', sql.Decimal(18, 4), input.LISTA_3 || 0)
        .input('lista4', sql.Decimal(18, 4), input.LISTA_4 || 0)
        .input('lista5', sql.Decimal(18, 4), input.LISTA_5 || 0)
        .input('listaDefecto', sql.Int, input.LISTA_DEFECTO || null)
        .input('fechaVenc', sql.Date, input.FECHA_VENCIMIENTO || null)
        .input('margenInd', sql.Bit, input.MARGEN_INDIVIDUAL ? 1 : 0)
        .query(`
          UPDATE PRODUCTOS SET
            CODIGOPARTICULAR=@codigo, NOMBRE=@nombre, DESCRIPCION=@descripcion,
            CATEGORIA_ID=@categoriaId, MARCA_ID=@marcaId, UNIDAD_ID=@unidadId,
            PRECIO_COMPRA=@precioCompra, COSTO_USD=@costoUsd, PRECIO_COMPRA_BASE=@precioCompraBase,
            STOCK_MINIMO=@stockMinimo, TASA_IVA_ID=@tasaIvaId, IMP_INT=@impInt,
            ES_CONJUNTO=@esConjunto, DESCUENTA_STOCK=@descuentaStock, ACTIVO=@activo,
            LISTA_1=@lista1, LISTA_2=@lista2, LISTA_3=@lista3, LISTA_4=@lista4, LISTA_5=@lista5,
            LISTA_DEFECTO=@listaDefecto, FECHA_VENCIMIENTO=@fechaVenc, MARGEN_INDIVIDUAL=@margenInd
          WHERE PRODUCTO_ID = @id
        `);

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
        // Clear both relationship and stock tables
        await tx.request().input('id', sql.Int, id).query(`DELETE FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @id`);
        await tx.request().input('id2', sql.Int, id).query(`DELETE FROM PRODUCTO_DEPOSITOS WHERE PRODUCTO_ID = @id2`);
        for (const dep of (input.depositos || [])) {
          // Insert into PRODUCTO_DEPOSITOS (relationship table)
          await tx.request()
            .input('prodId', sql.Int, id).input('depId', sql.Int, dep.DEPOSITO_ID)
            .query(`INSERT INTO PRODUCTO_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID) VALUES (@prodId, @depId)`);
          // Insert into STOCK_DEPOSITOS (stock tracking table)
          const maxId = await tx.request().query(`SELECT ISNULL(MAX(ITEM_ID), 0) + 1 AS nextId FROM STOCK_DEPOSITOS`);
          const nextItemId = maxId.recordset[0].nextId;
          await tx.request()
            .input('itemId', sql.Int, nextItemId)
            .input('prodId2', sql.Int, id).input('depId2', sql.Int, dep.DEPOSITO_ID)
            .input('cant', sql.Decimal(18, 4), dep.CANTIDAD)
            .query(`INSERT INTO STOCK_DEPOSITOS (ITEM_ID, PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@itemId, @prodId2, @depId2, @cant)`);
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

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Delete (soft if used, hard otherwise) ──────
  async delete(id: number) {
    const pool = await getPool();
    const check = await pool.request().input('id', sql.Int, id).query(`
      SELECT (SELECT COUNT(*) FROM VENTAS_ITEMS WHERE PRODUCTO_ID = @id) AS enVentas,
             (SELECT COUNT(*) FROM COMPRAS_ITEMS WHERE PRODUCTO_ID = @id) AS enCompras
    `);
    const { enVentas, enCompras } = check.recordset[0];

    if (enVentas > 0 || enCompras > 0) {
      await pool.request().input('id', sql.Int, id).query(`UPDATE PRODUCTOS SET ACTIVO = 0 WHERE PRODUCTO_ID = @id`);
      return { mode: 'soft' as const };
    }

    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS_COD_BARRAS WHERE PRODUCTO_ID = @id`);
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @id`);
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS_PROVEEDORES WHERE PRODUCTO_ID = @id`);
      await tx.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS WHERE PRODUCTO_ID = @id`);
      await tx.commit();
      return { mode: 'hard' as const };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Inline cell edit ───────────────────────────
  async inlineEdit(input: InlineEditInput) {
    const pool = await getPool();
    const allowed: Record<string, any> = {
      CODIGOPARTICULAR: sql.NVarChar, NOMBRE: sql.NVarChar,
      PRECIO_COMPRA: sql.Decimal(18, 4),
      LISTA_1: sql.Decimal(18, 4), LISTA_2: sql.Decimal(18, 4), LISTA_3: sql.Decimal(18, 4),
      LISTA_4: sql.Decimal(18, 4), LISTA_5: sql.Decimal(18, 4),
    };
    const colType = allowed[input.campo];
    if (!colType) throw Object.assign(new Error(`Campo no editable: ${input.campo}`), { name: 'ValidationError' });
    await pool.request().input('id', sql.Int, input.PRODUCTO_ID).input('val', colType, input.valor)
      .query(`UPDATE PRODUCTOS SET ${input.campo} = @val WHERE PRODUCTO_ID = @id`);
  },

  // ── Bulk assign ────────────────────────────────
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

    throw Object.assign(new Error(`Campo no válido: ${campo}`), { name: 'ValidationError' });
  },

  // ── Bulk delete ────────────────────────────────
  async bulkDelete(productoIds: number[]) {
    const pool = await getPool();
    let deleted = 0, deactivated = 0;

    for (const id of productoIds) {
      const check = await pool.request().input('id', sql.Int, id).query(`
        SELECT (SELECT COUNT(*) FROM VENTAS_ITEMS WHERE PRODUCTO_ID = @id) AS v,
               (SELECT COUNT(*) FROM COMPRAS_ITEMS WHERE PRODUCTO_ID = @id) AS c
      `);
      if (check.recordset[0].v > 0 || check.recordset[0].c > 0) {
        await pool.request().input('id', sql.Int, id).query(`UPDATE PRODUCTOS SET ACTIVO = 0 WHERE PRODUCTO_ID = @id`);
        deactivated++;
      } else {
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS_COD_BARRAS WHERE PRODUCTO_ID = @id`);
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @id`);
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS_PROVEEDORES WHERE PRODUCTO_ID = @id`);
        await pool.request().input('id', sql.Int, id).query(`DELETE FROM PRODUCTOS WHERE PRODUCTO_ID = @id`);
        deleted++;
      }
    }
    return { deleted, deactivated };
  },

  // ── Bulk generate prices from cost ─────────────
  async bulkGeneratePrices(input: BulkPriceInput) {
    const pool = await getPool();
    const { productoIds, listaId, margen, fuente, redondeo } = input;
    if (listaId < 1 || listaId > 5) throw new Error('Lista inválida (1-5)');
    const costoCol = fuente === 'USD' ? 'COSTO_USD' : 'PRECIO_COMPRA';
    const listaCol = `LISTA_${listaId}`;
    let affected = 0;

    for (const prodId of productoIds) {
      const prod = await pool.request().input('id', sql.Int, prodId)
        .query(`SELECT ${costoCol} AS costo FROM PRODUCTOS WHERE PRODUCTO_ID = @id`);
      if (prod.recordset.length === 0) continue;
      const costo = prod.recordset[0].costo || 0;
      if (costo <= 0) continue;
      let precio = costo * (1 + margen / 100);
      switch (redondeo) {
        case 'entero': precio = Math.ceil(precio); break;
        case '50': precio = Math.ceil(precio / 50) * 50; break;
        case '100': precio = Math.ceil(precio / 100) * 100; break;
      }
      await pool.request().input('id', sql.Int, prodId).input('precio', sql.Decimal(18, 4), precio)
        .query(`UPDATE PRODUCTOS SET ${listaCol} = @precio WHERE PRODUCTO_ID = @id`);
      affected++;
    }
    return { affected };
  },

  // ── Copy product ───────────────────────────────
  async copy(sourceId: number) {
    const pool = await getPool();
    const src = await pool.request().input('id', sql.Int, sourceId)
      .query(`SELECT * FROM PRODUCTOS WHERE PRODUCTO_ID = @id`);
    if (src.recordset.length === 0) throw new Error('Producto origen no encontrado');
    const s = src.recordset[0];

    const result = await pool.request()
      .input('codigo', sql.NVarChar, s.CODIGOPARTICULAR + ' (copia)')
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
      .input('descuentaStock', sql.Bit, s.DESCUENTA_STOCK ? 1 : 0)
      .input('lista1', sql.Decimal(18, 4), s.LISTA_1 || 0)
      .input('lista2', sql.Decimal(18, 4), s.LISTA_2 || 0)
      .input('lista3', sql.Decimal(18, 4), s.LISTA_3 || 0)
      .input('lista4', sql.Decimal(18, 4), s.LISTA_4 || 0)
      .input('lista5', sql.Decimal(18, 4), s.LISTA_5 || 0)
      .input('listaDefecto', sql.Int, s.LISTA_DEFECTO)
      .input('fechaVenc', sql.Date, s.FECHA_VENCIMIENTO)
      .input('margenInd', sql.Bit, s.MARGEN_INDIVIDUAL ? 1 : 0)
      .query(`
        INSERT INTO PRODUCTOS (
          CODIGOPARTICULAR, NOMBRE, DESCRIPCION, CATEGORIA_ID, MARCA_ID, UNIDAD_ID,
          PRECIO_COMPRA, COSTO_USD, PRECIO_COMPRA_BASE, STOCK_MINIMO, TASA_IVA_ID, IMP_INT,
          ES_CONJUNTO, DESCUENTA_STOCK, ACTIVO, CANTIDAD,
          LISTA_1, LISTA_2, LISTA_3, LISTA_4, LISTA_5, LISTA_DEFECTO,
          FECHA_VENCIMIENTO, MARGEN_INDIVIDUAL
        ) VALUES (
          @codigo, @nombre, @descripcion, @categoriaId, @marcaId, @unidadId,
          @precioCompra, @costoUsd, @precioCompraBase, @stockMinimo, @tasaIvaId, @impInt,
          @esConjunto, @descuentaStock, 1, 0,
          @lista1, @lista2, @lista3, @lista4, @lista5, @listaDefecto,
          @fechaVenc, @margenInd
        );
        SELECT SCOPE_IDENTITY() AS PRODUCTO_ID;
      `);
    return { PRODUCTO_ID: result.recordset[0].PRODUCTO_ID };
  },

  // ── Get tax rates ──────────────────────────────
  async getTasasImpuestos() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT TASA_ID, NOMBRE, PORCENTAJE, PREDETERMINADA, ACTIVA
      FROM TASAS_IMPUESTOS WHERE ACTIVA = 1 ORDER BY TASA_ID
    `);
    return result.recordset;
  },
};
