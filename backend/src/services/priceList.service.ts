import { getPool, sql } from '../database/connection.js';
import type { ListaPrecio, PaginatedResult, Producto, PrecioLista, TipoMargen } from '../types/index.js';
import { normalizarTipoMargen, validateMargenPorTipo } from '../utils/pricing.js';

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
  /** 'M' = Markup sobre costo (default). 'U' = Utilidad sobre venta. */
  TIPO_MARGEN?: TipoMargen;
  ACTIVA?: boolean;
  /** Si true (default true), al crear se insertan precios en PRODUCTO_LISTA_PRECIOS
   *  para todos los productos con PRECIO_COMPRA > 0 aplicando el MARGEN configurado. */
  aplicarMargenInicial?: boolean;
  /** Si true, al actualizar también se recalculan los precios de los productos
   *  ya asociados a la lista usando la fórmula del TIPO_MARGEN de la lista,
   *  limpiando el MARGEN_INDIVIDUAL. */
  recalcularPorMargen?: boolean;
  /** Paso de redondeo a aplicar después del recálculo (ej. 50, 100, 500).
   *  Sólo aplica si viene acompañado de redondeoDireccion. */
  redondeoStep?: number | null;
  /** Dirección del redondeo: 'arriba' (CEILING) o 'cercano' (ROUND a múltiplo). */
  redondeoDireccion?: 'arriba' | 'cercano' | null;
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
  actualizarMargen?: boolean;
}

function validateListId(listaId: number) {
  if (!Number.isInteger(listaId) || listaId < 1) {
    throw Object.assign(new Error('Lista inválida.'), { name: 'ValidationError' });
  }
}

// PRODUCTO_MARGENES queda como legacy/deprecada. El margen individual ahora
// vive en PRODUCTO_LISTA_PRECIOS.MARGEN_INDIVIDUAL por (producto, lista).
function margenColumna(listaId: number): string | null {
  if (listaId >= 1 && listaId <= 5) return `MARGEN_LISTA_${listaId}`;
  return null;
}

const MARGEN_INDIVIDUAL_TOLERANCE = 0.5; // % de desviación para considerar override

/**
 * Recalcula MARGEN_INDIVIDUAL para un producto en una lista después de
 * un cambio manual de precio. Si el margen real difiere del margen default
 * de la lista (más allá de la tolerancia), se setea MARGEN_INDIVIDUAL como
 * override; si no, se limpia (NULL).
 *
 * Esto se llama sólo cuando el usuario edita un precio explícitamente (no
 * en bulk applyPercentage), para preservar el comportamiento de "override
 * consciente" mencionado en el spec.
 */
async function setMargenIndividualForProducto(
  tx: any,
  listaId: number,
  productoId: number,
  precio: number,
) {
  const req = tx.request()
    .input('listaId', sql.Int, listaId)
    .input('productoId', sql.Int, productoId)
    .input('precio', sql.Decimal(18, 4), precio);

  // Calcular margen real (en la moneda de la lista) y margen default de la lista.
  // Markup:  margen = (precio / costo - 1) * 100
  // Utilidad: margen = (1 - costo / precio) * 100
  const result = await req.query(`
    DECLARE @margenReal DECIMAL(9, 4);
    DECLARE @margenDefault DECIMAL(9, 4);
    DECLARE @precioCompra DECIMAL(18, 4);
    DECLARE @tipoMargen CHAR(1);

    SELECT @precioCompra = ISNULL(PRECIO_COMPRA, 0) FROM PRODUCTOS WHERE PRODUCTO_ID = @productoId;
    SELECT @margenDefault = ISNULL(MARGEN, 0),
           @tipoMargen = ISNULL(TIPO_MARGEN, 'M')
    FROM LISTA_PRECIOS WHERE LISTA_ID = @listaId;

    IF @precioCompra > 0 AND @precio > 0
    BEGIN
        IF @tipoMargen = 'U'
            SET @margenReal = ROUND((1 - (@precioCompra / @precio)) * 100, 4);
        ELSE
            SET @margenReal = ROUND(((@precio / @precioCompra) - 1) * 100, 4);
    END
    ELSE
        SET @margenReal = 0;

    UPDATE PRODUCTO_LISTA_PRECIOS
    SET MARGEN_INDIVIDUAL = CASE
        WHEN @precioCompra > 0 AND @precio > 0 AND ABS(@margenReal - @margenDefault) > ${MARGEN_INDIVIDUAL_TOLERANCE}
            THEN @margenReal
        ELSE NULL
    END
    WHERE LISTA_ID = @listaId AND PRODUCTO_ID = @productoId;
  `);
}

async function getListaActiva(listaId: number): Promise<ListaPrecio> {
  validateListId(listaId);
  const pool = await getPool();
  const result = await pool.request()
    .input('id', sql.Int, listaId)
    .query<ListaPrecio>(`
      SELECT LISTA_ID, CODIGOPARTICULAR, NOMBRE, DESCRIPCION, MARGEN,
             ISNULL(TIPO_MARGEN, 'M') AS TIPO_MARGEN, ACTIVA
      FROM LISTA_PRECIOS
      WHERE LISTA_ID = @id
    `);
  if (result.recordset.length === 0) {
    throw Object.assign(new Error('Lista de precio no encontrada'), { name: 'ValidationError' });
  }
  const row = result.recordset[0];
  row.TIPO_MARGEN = normalizarTipoMargen(row.TIPO_MARGEN);
  return row;
}

async function syncMarginsForList(listaId: number, productoIds: number[]) {
  // DEPRECATED: la sincronización auto-calculada de márgenes individuales
  // ya no se hace desde acá. El margen individual ahora vive en
  // PRODUCTO_LISTA_PRECIOS.MARGEN_INDIVIDUAL y sólo se setea cuando el
  // usuario edita explícitamente un precio (ver setMargenIndividualForProducto).
  // Esta función se mantiene por compatibilidad pero es no-op.
  void margenColumna;
  void listaId;
  void productoIds;
}

export const priceListService = {
  async getAll(filter: PriceListFilter = {}): Promise<PaginatedResult<ListaPrecio & PriceListStats>> {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
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
    };
    const orderCol = validCols[filter.orderBy || 'LISTA_ID'] || 'LISTA_ID';
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);
    const dataResult = await dataReq.query<ListaPrecio>(`
      SELECT LISTA_ID, CODIGOPARTICULAR, NOMBRE, DESCRIPCION, MARGEN,
             ISNULL(TIPO_MARGEN, 'M') AS TIPO_MARGEN, ACTIVA
      FROM LISTA_PRECIOS
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    const data = [] as (ListaPrecio & PriceListStats)[];
    for (const row of dataResult.recordset) {
      const stats = await this.getStats(row.LISTA_ID);
      data.push({ ...row, ...stats, TIPO_MARGEN: normalizarTipoMargen(row.TIPO_MARGEN) });
    }

    return { data, total, page, pageSize };
  },

  async getById(id: number): Promise<ListaPrecio & PriceListStats> {
    const lista = await getListaActiva(id);
    const stats = await this.getStats(id);
    return { ...lista, ...stats };
  },

  async update(id: number, input: PriceListInput): Promise<{ affected?: number }> {
    validateListId(id);
    if (!input.NOMBRE?.trim()) {
      throw Object.assign(new Error('El nombre es obligatorio'), { name: 'ValidationError' });
    }

    const tipoMargen: TipoMargen = input.TIPO_MARGEN ?? 'M';
    const margenNuevo = input.MARGEN ?? 0;
    try {
      validateMargenPorTipo(margenNuevo, tipoMargen);
    } catch (err: any) {
      throw Object.assign(new Error(err.message), { name: 'ValidationError' });
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
      .input('margen', sql.Decimal(18, 4), margenNuevo)
      .input('tipoMargen', sql.Char(1), tipoMargen)
      .input('activa', sql.Bit, input.ACTIVA !== false ? 1 : 0)
      .query(`
        UPDATE LISTA_PRECIOS SET
          CODIGOPARTICULAR = @codigo,
          NOMBRE = @nombre,
          DESCRIPCION = @descripcion,
          MARGEN = @margen,
          TIPO_MARGEN = @tipoMargen,
          ACTIVA = @activa
        WHERE LISTA_ID = @id
      `);

    // Si se solicitó recalcular precios con el nuevo margen, actualizar todos
    // los productos asociados a esta lista. La fórmula depende del TIPO_MARGEN
    // de la lista ('M' → Markup, 'U' → Utilidad). Se limpia MARGEN_INDIVIDUAL
    // ya que el margen real volverá a coincidir con el margen default.
    if (input.recalcularPorMargen) {
      // CASE que refleja normalizarTipoMargen + precioFromMargen en SQL.
      // Markup: PRECIO_COMPRA * (1 + margen/100)
      // Utilidad: PRECIO_COMPRA / (1 - margen/100)  (sólo si margen < 100)
      const precioExpr = `
        CASE
          WHEN lp.TIPO_MARGEN = 'U' AND @margen < 100
            THEN ISNULL(p.PRECIO_COMPRA, 0) / NULLIF(1 - @margen / 100.0, 0)
          ELSE
            ISNULL(p.PRECIO_COMPRA, 0) * (1 + @margen / 100.0)
        END
      `;
      const recalcResult = await pool.request()
        .input('listaId', sql.Int, id)
        .input('margen', sql.Decimal(9, 4), margenNuevo)
        .query(`
          UPDATE plp
          SET plp.PRECIO = CAST(ROUND(${precioExpr}, 2) AS DECIMAL(18, 4)),
              plp.MARGEN_INDIVIDUAL = NULL,
              plp.FECHA_ACTUALIZACION = GETDATE()
          FROM PRODUCTO_LISTA_PRECIOS plp
          INNER JOIN PRODUCTOS p ON p.PRODUCTO_ID = plp.PRODUCTO_ID
          INNER JOIN LISTA_PRECIOS lp ON lp.LISTA_ID = plp.LISTA_ID
          WHERE plp.LISTA_ID = @listaId
            AND ISNULL(p.PRECIO_COMPRA, 0) > 0
            AND ISNULL(plp.PRECIO, 0) > 0
        `);

      // Redondeo opcional post-recálculo. Sólo se aplica si vienen ambos params.
      // No toca MARGEN_INDIVIDUAL: es una operación bulk.
      if (input.redondeoStep && input.redondeoDireccion) {
        const step = Number(input.redondeoStep);
        const dir = input.redondeoDireccion;
        if (Number.isFinite(step) && step > 0) {
          const roundExpr = dir === 'arriba'
            ? `CEILING(plp.PRECIO / ${step}.0) * ${step}`
            : `ROUND(plp.PRECIO / ${step}.0, 0) * ${step}`;
          await pool.request()
            .input('listaId', sql.Int, id)
            .query(`
              UPDATE plp
              SET plp.PRECIO = CAST(${roundExpr} AS DECIMAL(18, 4)),
                  plp.FECHA_ACTUALIZACION = GETDATE()
              FROM PRODUCTO_LISTA_PRECIOS plp
              INNER JOIN PRODUCTOS p ON p.PRODUCTO_ID = plp.PRODUCTO_ID
              WHERE plp.LISTA_ID = @listaId
                AND ISNULL(plp.PRECIO, 0) > 0
            `);
        }
      }

      return { affected: recalcResult.rowsAffected.reduce((a, b) => a + (b || 0), 0) };
    }

    return {};
  },

  async create(input: PriceListInput): Promise<{ LISTA_ID: number; productosConPrecio: number }> {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      if (!input.NOMBRE?.trim()) {
        throw Object.assign(new Error('El nombre es obligatorio'), { name: 'ValidationError' });
      }

      const tipoMargen: TipoMargen = input.TIPO_MARGEN ?? 'M';
      const margenInicial = input.MARGEN ?? 0;
      try {
        validateMargenPorTipo(margenInicial, tipoMargen);
      } catch (err: any) {
        throw Object.assign(new Error(err.message), { name: 'ValidationError' });
      }

      const trimmedCode = input.CODIGOPARTICULAR?.trim() || null;

      if (trimmedCode) {
        const dup = await tx.request()
          .input('code', sql.NVarChar, trimmedCode)
          .query(`SELECT 1 FROM LISTA_PRECIOS WHERE CODIGOPARTICULAR = @code`);
        if (dup.recordset.length > 0) {
          throw Object.assign(new Error('El código ya existe'), { name: 'ValidationError' });
        }
      }

      // Detectar si LISTA_ID es columna IDENTITY (depende de cómo la desktop app creó la tabla)
      const idCol = await tx.request().query(`
        SELECT is_identity AS isIdentity
        FROM sys.columns
        WHERE object_id = OBJECT_ID('LISTA_PRECIOS') AND name = 'LISTA_ID'
      `);
      const isIdentity = idCol.recordset[0]?.isIdentity === 1;

      let nextId: number;

      if (isIdentity) {
        // Columna IDENTITY: insertar sin especificar LISTA_ID y leer SCOPE_IDENTITY
        const insertResult = await tx.request()
          .input('codigo', sql.NVarChar, trimmedCode)
          .input('nombre', sql.NVarChar, input.NOMBRE.trim())
          .input('descripcion', sql.NVarChar, input.DESCRIPCION?.trim() || null)
          .input('margen', sql.Decimal(18, 4), margenInicial)
          .input('tipoMargen', sql.Char(1), tipoMargen)
          .input('activa', sql.Bit, input.ACTIVA !== false ? 1 : 0)
          .query(`
            INSERT INTO LISTA_PRECIOS (CODIGOPARTICULAR, NOMBRE, DESCRIPCION, MARGEN, TIPO_MARGEN, ACTIVA)
            VALUES (@codigo, @nombre, @descripcion, @margen, @tipoMargen, @activa);
            SELECT SCOPE_IDENTITY() AS LISTA_ID;
          `);
        nextId = Number(insertResult.recordset[0]?.LISTA_ID);
        // Si el usuario no pasó código, autogenerarlo a partir del ID
        if (!trimmedCode) {
          await tx.request()
            .input('id', sql.Int, nextId)
            .input('codigo', sql.NVarChar, String(nextId))
            .query(`UPDATE LISTA_PRECIOS SET CODIGOPARTICULAR = @codigo WHERE LISTA_ID = @id`);
        }
      } else {
        // LISTA_ID plano: calcular MAX+1 e INSERT explícito (con TABLOCKX para evitar races)
        const maxResult = await tx.request().query(
          `SELECT ISNULL(MAX(LISTA_ID), 0) + 1 AS nextId FROM LISTA_PRECIOS WITH (TABLOCKX, HOLDLOCK)`
        );
        nextId = Number(maxResult.recordset[0].nextId);
        const code = trimmedCode || String(nextId);

        await tx.request()
          .input('id', sql.Int, nextId)
          .input('codigo', sql.NVarChar, code)
          .input('nombre', sql.NVarChar, input.NOMBRE.trim())
          .input('descripcion', sql.NVarChar, input.DESCRIPCION?.trim() || null)
          .input('margen', sql.Decimal(18, 4), margenInicial)
          .input('tipoMargen', sql.Char(1), tipoMargen)
          .input('activa', sql.Bit, input.ACTIVA !== false ? 1 : 0)
          .query(`
            INSERT INTO LISTA_PRECIOS (LISTA_ID, CODIGOPARTICULAR, NOMBRE, DESCRIPCION, MARGEN, TIPO_MARGEN, ACTIVA)
            VALUES (@id, @codigo, @nombre, @descripcion, @margen, @tipoMargen, @activa)
          `);
      }

      // Inicializar precios para todos los productos con PRECIO_COMPRA > 0
      // aplicando el margen configurado. La fórmula respeta TIPO_MARGEN.
      // Default: sí (a menos que se pida lo contrario).
      let productosConPrecio = 0;
      const aplicarMargen = input.aplicarMargenInicial !== false;
      if (aplicarMargen) {
        const precioExpr = `
          CASE
            WHEN @tipoMargen = 'U' AND @margen < 100
              THEN ISNULL(p.PRECIO_COMPRA, 0) / NULLIF(1 - @margen / 100.0, 0)
            ELSE
              ISNULL(p.PRECIO_COMPRA, 0) * (1 + @margen / 100.0)
          END
        `;
        const preciosResult = await tx.request()
          .input('listaId', sql.Int, nextId)
          .input('margen', sql.Decimal(9, 4), margenInicial)
          .input('tipoMargen', sql.Char(1), tipoMargen)
          .query(`
            INSERT INTO PRODUCTO_LISTA_PRECIOS (LISTA_ID, PRODUCTO_ID, PRECIO)
            SELECT @listaId,
                   p.PRODUCTO_ID,
                   CAST(ROUND(${precioExpr}, 2) AS DECIMAL(18, 4))
            FROM PRODUCTOS p
            WHERE ISNULL(p.PRECIO_COMPRA, 0) > 0
          `);
        productosConPrecio = preciosResult.rowsAffected.reduce((a, b) => a + (b || 0), 0);
      }

      await tx.commit();
      return { LISTA_ID: nextId, productosConPrecio };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  async delete(id: number): Promise<{ mode: 'soft' | 'hard' }> {
    validateListId(id);
    const pool = await getPool();

    // ¿Tiene precios en PRODUCTO_LISTA_PRECIOS?
    const preciosCheck = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT COUNT(*) AS n FROM PRODUCTO_LISTA_PRECIOS WHERE LISTA_ID = @id`);
    const conPrecios = preciosCheck.recordset[0].n;

    // ¿Hay productos con LISTA_DEFECTO apuntando a esta lista?
    const defCheck = await pool.request()
      .input('id', sql.Int, id)
      .query(`SELECT COUNT(*) AS n FROM PRODUCTOS WHERE LISTA_DEFECTO = @id`);
    const conProductosDefecto = defCheck.recordset[0].n;

    if (conPrecios > 0 || conProductosDefecto > 0) {
      await pool.request().input('id', sql.Int, id)
        .query(`UPDATE LISTA_PRECIOS SET ACTIVA = 0 WHERE LISTA_ID = @id`);
      return { mode: 'soft' };
    }

    await pool.request().input('id', sql.Int, id)
      .query(`DELETE FROM LISTA_PRECIOS WHERE LISTA_ID = @id`);

    return { mode: 'hard' };
  },

  async getNextCode(): Promise<string> {
    const pool = await getPool();
    const result = await pool.request()
      .query(`SELECT ISNULL(MAX(LISTA_ID), 0) + 1 AS nextId FROM LISTA_PRECIOS`);
    return String(result.recordset[0].nextId);
  },

  async getStats(listaId: number): Promise<PriceListStats> {
    validateListId(listaId);
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM PRODUCTOS) AS totalProductos,
        (SELECT COUNT(*) FROM PRODUCTOS WHERE ACTIVO = 1) AS productosActivos,
        (SELECT COUNT(*) FROM PRODUCTO_LISTA_PRECIOS WHERE LISTA_ID = ${listaId}) AS productosConPrecio,
        ISNULL((
          SELECT AVG(CAST(PRECIO AS FLOAT))
          FROM PRODUCTO_LISTA_PRECIOS
          WHERE LISTA_ID = ${listaId}
        ), 0) AS precioPromedio,
        ISNULL((
          SELECT MIN(PRECIO) FROM PRODUCTO_LISTA_PRECIOS WHERE LISTA_ID = ${listaId}
        ), 0) AS precioMinimo,
        ISNULL((
          SELECT MAX(PRECIO) FROM PRODUCTO_LISTA_PRECIOS WHERE LISTA_ID = ${listaId}
        ), 0) AS precioMaximo
    `);
    return result.recordset[0];
  },

  async getProducts(listaId: number, filter: PriceListProductFilter = {}): Promise<PaginatedResult<PriceListProduct>> {
    validateListId(listaId);
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 25;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const countReq = pool.request().input('listaId', sql.Int, listaId);
    const dataReq = pool.request().input('listaId', sql.Int, listaId);

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

    const margenSelect = 'plp.MARGEN_INDIVIDUAL';

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
      PRECIO_LISTA: 'ISNULL(plp.PRECIO, 0)',
      MARGEN_LISTA: margenSelect,
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
        p.LISTA_DEFECTO, p.COSTO_USD, p.TASA_IVA_ID,
        p.ES_CONJUNTO, p.ES_SERVICIO, p.DESCUENTA_STOCK, ISNULL(p.PERMITE_STOCK_NEGATIVO, 0) AS PERMITE_STOCK_NEGATIVO, p.PRECIO_COMPRA_BASE, p.IMP_INT,
        p.FECHA_VENCIMIENTO, p.MARGEN_INDIVIDUAL,
        c.NOMBRE AS CATEGORIA_NOMBRE,
        m.NOMBRE AS MARCA_NOMBRE,
        u.NOMBRE AS UNIDAD_NOMBRE,
        u.ABREVIACION AS UNIDAD_ABREVIACION,
        ISNULL(plp.PRECIO, 0) AS PRECIO_LISTA,
        ${margenSelect} AS MARGEN_LISTA
      FROM PRODUCTOS p
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
      LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
      LEFT JOIN PRODUCTO_LISTA_PRECIOS plp ON plp.PRODUCTO_ID = p.PRODUCTO_ID AND plp.LISTA_ID = @listaId
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataResult.recordset, total, page, pageSize };
  },

  async updateProductPrice(listaId: number, productoId: number, precio: number) {
    validateListId(listaId);
    if (!Number.isFinite(precio) || precio < 0) {
      throw Object.assign(new Error('El precio debe ser mayor o igual a cero.'), { name: 'ValidationError' });
    }

    const pool = await getPool();
    const productoExists = await pool.request()
      .input('productoId', sql.Int, productoId)
      .query('SELECT 1 FROM PRODUCTOS WHERE PRODUCTO_ID = @productoId');
    if (productoExists.recordset.length === 0) {
      throw Object.assign(new Error('Producto no encontrado'), { name: 'ValidationError' });
    }

    if (precio === 0) {
      await pool.request()
        .input('productoId', sql.Int, productoId)
        .input('listaId', sql.Int, listaId)
        .query('DELETE FROM PRODUCTO_LISTA_PRECIOS WHERE PRODUCTO_ID = @productoId AND LISTA_ID = @listaId');
    } else {
      await pool.request()
        .input('productoId', sql.Int, productoId)
        .input('listaId', sql.Int, listaId)
        .input('precio', sql.Decimal(18, 4), precio)
        .query(`
          MERGE PRODUCTO_LISTA_PRECIOS AS target
          USING (SELECT @productoId AS PRODUCTO_ID, @listaId AS LISTA_ID, @precio AS PRECIO) AS src
          ON target.PRODUCTO_ID = src.PRODUCTO_ID AND target.LISTA_ID = src.LISTA_ID
          WHEN MATCHED THEN
            UPDATE SET PRECIO = src.PRECIO, FECHA_ACTUALIZACION = GETDATE()
          WHEN NOT MATCHED THEN
            INSERT (PRODUCTO_ID, LISTA_ID, PRECIO)
            VALUES (src.PRODUCTO_ID, src.LISTA_ID, src.PRECIO);
        `);

      // Si el precio fue seteado explícitamente y difiere del margen default
      // de la lista, marcamos MARGEN_INDIVIDUAL como override.
      await setMargenIndividualForProducto(pool.request(), listaId, productoId, precio);
    }
  },

  async roundPrices(listaId: number, step: number, direccion: 'arriba' | 'cercano'): Promise<{ affected: number }> {
    validateListId(listaId);
    if (!Number.isFinite(step) || step <= 0) {
      throw Object.assign(new Error('Paso de redondeo inválido.'), { name: 'ValidationError' });
    }
    if (direccion !== 'arriba' && direccion !== 'cercano') {
      throw Object.assign(new Error('Dirección de redondeo inválida.'), { name: 'ValidationError' });
    }

    const pool = await getPool();
    const roundExpr = direccion === 'arriba'
      ? `CEILING(plp.PRECIO / ${step}.0) * ${step}`
      : `ROUND(plp.PRECIO / ${step}.0, 0) * ${step}`;

    const result = await pool.request()
      .input('listaId', sql.Int, listaId)
      .query(`
        UPDATE plp
        SET plp.PRECIO = CAST(${roundExpr} AS DECIMAL(18, 4)),
            plp.FECHA_ACTUALIZACION = GETDATE()
        FROM PRODUCTO_LISTA_PRECIOS plp
        WHERE plp.LISTA_ID = @listaId
          AND ISNULL(plp.PRECIO, 0) > 0
      `);

    return { affected: result.rowsAffected.reduce((a, b) => a + (b || 0), 0) };
  },

  async applyPercentage(listaId: number, input: ApplyPercentageInput) {
    const pool = await getPool();
    validateListId(listaId);
    const porcentaje = Number(input.porcentaje);
    if (!Number.isFinite(porcentaje) || porcentaje === 0 || porcentaje < -99.99 || porcentaje > 1000) {
      throw Object.assign(new Error('Ingresá un porcentaje válido entre -99,99 y 1000.'), { name: 'ValidationError' });
    }

    const before = await this.getStats(listaId);

    let expression = `ISNULL(plp.PRECIO, 0) * (1 + @porcentaje / 100.0)`;
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

    const joinClause = input.incluirInactivos
      ? 'INNER JOIN PRODUCTOS p ON p.PRODUCTO_ID = plp.PRODUCTO_ID'
      : 'INNER JOIN PRODUCTOS p ON p.PRODUCTO_ID = plp.PRODUCTO_ID AND p.ACTIVO = 1';

    const affectedReq = pool.request()
      .input('listaId', sql.Int, listaId)
      .input('porcentaje', sql.Decimal(9, 4), porcentaje)
      .query(`
        UPDATE plp
        SET plp.PRECIO = CAST(${expression} AS DECIMAL(18, 4)),
            plp.FECHA_ACTUALIZACION = GETDATE()
        FROM PRODUCTO_LISTA_PRECIOS plp
        ${joinClause}
        WHERE plp.LISTA_ID = @listaId
          AND ISNULL(plp.PRECIO, 0) > 0
      `);
    const result = await affectedReq;
    const affectedCount = result.rowsAffected[0] || 0;

    // Bulk applyPercentage NO toca MARGEN_INDIVIDUAL: los overrides explícitos
    // del usuario se preservan. Sólo se recalcula el margen default de la lista
    // si el usuario lo pidió.

    let margenAnterior: number | null = null;
    let margenNuevo: number | null = null;
    if (input.actualizarMargen) {
      const margenResult = await pool.request()
        .input('id', sql.Int, listaId)
        .query<{ MARGEN: number; TIPO_MARGEN: string }>(`SELECT MARGEN, TIPO_MARGEN FROM LISTA_PRECIOS WHERE LISTA_ID = @id`);
      margenAnterior = margenResult.recordset[0]?.MARGEN ?? 0;
      const tipoMargen = normalizarTipoMargen(margenResult.recordset[0]?.TIPO_MARGEN);
      // Ajuste por % compuesto sobre el margen default. La fórmula es la misma
      // para Markup y Utilidad (no es lineal en Utilidad pero se mantiene la
      // semántica histórica de "ajuste por %"; el usuario lo confirma en UI).
      margenNuevo = Math.round(margenAnterior * (1 + porcentaje / 100) * 10000) / 10000;
      try {
        validateMargenPorTipo(margenNuevo, tipoMargen);
      } catch (err: any) {
        throw Object.assign(new Error(err.message), { name: 'ValidationError' });
      }
      await pool.request()
        .input('id', sql.Int, listaId)
        .input('margen', sql.Decimal(18, 4), margenNuevo)
        .query(`UPDATE LISTA_PRECIOS SET MARGEN = @margen WHERE LISTA_ID = @id`);
    }

    const after = await this.getStats(listaId);

    return {
      affected: affectedCount,
      before,
      after,
      margenAnterior,
      margenNuevo,
      margenActualizado: !!input.actualizarMargen,
    };
  },
};
