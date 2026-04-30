import { getPool, sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  Stock Service — Stock management by deposit
// ═══════════════════════════════════════════════════

export interface StockFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  depositoId?: number;
  puntoVentaId?: number;
  soloConStock?: boolean;
  soloBajoMinimo?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface StockUpdateInput {
  PRODUCTO_ID: number;
  DEPOSITO_ID: number;
  CANTIDAD_NUEVA: number;
  OBSERVACIONES?: string;
}

export interface StockHistoryFilter {
  productoId: number;
  depositoId?: number;
  page?: number;
  pageSize?: number;
}

export const stockService = {
  // ── Ensure STOCK_HISTORIAL table exists ────────
  async ensureHistorialTable(): Promise<void> {
    const pool = await getPool();
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'STOCK_HISTORIAL')
      BEGIN
        CREATE TABLE STOCK_HISTORIAL (
          HISTORIAL_ID      INT IDENTITY(1,1) PRIMARY KEY,
          PRODUCTO_ID       INT NOT NULL,
          DEPOSITO_ID       INT NOT NULL,
          CANTIDAD_ANTERIOR DECIMAL(18,4) NOT NULL DEFAULT 0,
          CANTIDAD_NUEVA    DECIMAL(18,4) NOT NULL DEFAULT 0,
          DIFERENCIA        DECIMAL(18,4) NOT NULL DEFAULT 0,
          TIPO_OPERACION    VARCHAR(30) NOT NULL,
          REFERENCIA_ID     INT NULL,
          REFERENCIA_DETALLE VARCHAR(200) NULL,
          USUARIO_ID        INT NULL,
          FECHA             DATETIME NOT NULL DEFAULT GETDATE(),
          OBSERVACIONES     VARCHAR(500) NULL
        );
        CREATE INDEX IX_STOCK_HISTORIAL_PRODUCTO ON STOCK_HISTORIAL (PRODUCTO_ID, FECHA DESC);
        CREATE INDEX IX_STOCK_HISTORIAL_DEPOSITO ON STOCK_HISTORIAL (DEPOSITO_ID, FECHA DESC);
        CREATE INDEX IX_STOCK_HISTORIAL_FECHA ON STOCK_HISTORIAL (FECHA DESC);
      END
    `);
  },

  // ── List products with stock per deposit ───────
  async getAll(filter: StockFilter = {}) {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 25;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE p.ACTIVO = 1 AND p.ES_SERVICIO = 0';
    const params: { name: string; type: any; value: any }[] = [];

    if (filter.search) {
      const tokens = filter.search.trim().split(/\s+/).filter(t => t.length > 0);
      tokens.forEach((token, i) => {
        where += ` AND (p.NOMBRE LIKE @t${i} OR p.CODIGOPARTICULAR LIKE @t${i})`;
        params.push({ name: `t${i}`, type: sql.NVarChar, value: `%${token}%` });
      });
    }

    if (filter.depositoId) {
      where += ' AND sd.DEPOSITO_ID = @depositoId';
      params.push({ name: 'depositoId', type: sql.Int, value: filter.depositoId });
    }

    if (filter.puntoVentaId) {
      where += ` AND sd.DEPOSITO_ID IN (
        SELECT DEPOSITO_ID FROM PUNTOS_VENTA_DEPOSITOS WHERE PUNTO_VENTA_ID = @puntoVentaId
      )`;
      params.push({ name: 'puntoVentaId', type: sql.Int, value: filter.puntoVentaId });
    }

    if (filter.soloConStock) {
      where += ' AND sd.CANTIDAD > 0';
    }

    if (filter.soloBajoMinimo) {
      where += ' AND p.STOCK_MINIMO IS NOT NULL AND p.CANTIDAD <= p.STOCK_MINIMO';
    }

    const bind = (req: any) => {
      for (const p of params) req.input(p.name, p.type, p.value);
      return req;
    };

    // Count distinct products matching
    const countReq = bind(pool.request());
    const countResult = await countReq.query(`
      SELECT COUNT(DISTINCT p.PRODUCTO_ID) as total
      FROM PRODUCTOS p
      LEFT JOIN STOCK_DEPOSITOS sd ON p.PRODUCTO_ID = sd.PRODUCTO_ID
      ${where}
    `);
    const total = countResult.recordset[0].total;

    // Sorting
    const validCols: Record<string, string> = {
      NOMBRE: 'p.NOMBRE',
      CODIGOPARTICULAR: 'p.CODIGOPARTICULAR',
      CANTIDAD: 'p.CANTIDAD',
      STOCK_MINIMO: 'p.STOCK_MINIMO',
    };
    const orderCol = validCols[filter.orderBy || 'NOMBRE'] || 'p.NOMBRE';
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    // Get paginated products
    const dataReq = bind(pool.request());
    dataReq.input('offset', sql.Int, offset);
    dataReq.input('pageSize', sql.Int, pageSize);

    const dataResult = await dataReq.query(`
      SELECT DISTINCT
        p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, p.CANTIDAD,
        p.STOCK_MINIMO, p.UNIDAD_ID,
        c.NOMBRE AS CATEGORIA_NOMBRE,
        m.NOMBRE AS MARCA_NOMBRE,
        u.ABREVIACION AS UNIDAD_ABREVIACION
      FROM PRODUCTOS p
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
      LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
      LEFT JOIN STOCK_DEPOSITOS sd ON p.PRODUCTO_ID = sd.PRODUCTO_ID
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    // Get stock per deposit for these products
    const productIds = dataResult.recordset.map((p: any) => p.PRODUCTO_ID);
    let stockByProduct: Record<number, any[]> = {};

    if (productIds.length > 0) {
      const idList = productIds.join(',');
      const stockResult = await pool.request().query(`
        SELECT sd.ITEM_ID, sd.PRODUCTO_ID, sd.DEPOSITO_ID, sd.CANTIDAD,
               d.NOMBRE AS DEPOSITO_NOMBRE
        FROM STOCK_DEPOSITOS sd
        JOIN DEPOSITOS d ON sd.DEPOSITO_ID = d.DEPOSITO_ID
        WHERE sd.PRODUCTO_ID IN (${idList})
        ORDER BY d.NOMBRE
      `);

      for (const row of stockResult.recordset) {
        if (!stockByProduct[row.PRODUCTO_ID]) stockByProduct[row.PRODUCTO_ID] = [];
        stockByProduct[row.PRODUCTO_ID].push(row);
      }
    }

    const data = dataResult.recordset.map((p: any) => ({
      ...p,
      stockDepositos: stockByProduct[p.PRODUCTO_ID] || [],
    }));

    return { data, total, page, pageSize };
  },

  // ── Get stock detail for a single product ──────
  async getProductStock(productoId: number) {
    const pool = await getPool();

    const productResult = await pool.request()
      .input('id', sql.Int, productoId)
      .query(`
        SELECT p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, p.CANTIDAD,
               p.STOCK_MINIMO, u.ABREVIACION AS UNIDAD_ABREVIACION
        FROM PRODUCTOS p
        LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
        WHERE p.PRODUCTO_ID = @id
      `);

    if (productResult.recordset.length === 0) {
      throw Object.assign(new Error('Producto no encontrado'), { name: 'ValidationError' });
    }

    const stockResult = await pool.request()
      .input('id', sql.Int, productoId)
      .query(`
        SELECT sd.ITEM_ID, sd.PRODUCTO_ID, sd.DEPOSITO_ID, sd.CANTIDAD,
               d.NOMBRE AS DEPOSITO_NOMBRE
        FROM STOCK_DEPOSITOS sd
        JOIN DEPOSITOS d ON sd.DEPOSITO_ID = d.DEPOSITO_ID
        WHERE sd.PRODUCTO_ID = @id
        ORDER BY d.NOMBRE
      `);

    return {
      product: productResult.recordset[0],
      stockDepositos: stockResult.recordset,
    };
  },

  // ── Update stock for a product in a deposit ────
  async updateStock(input: StockUpdateInput, usuarioId?: number) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Get current stock
      const currentResult = await tx.request()
        .input('prodId', sql.Int, input.PRODUCTO_ID)
        .input('depId', sql.Int, input.DEPOSITO_ID)
        .query(`SELECT CANTIDAD FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);

      const cantidadAnterior = currentResult.recordset.length > 0
        ? currentResult.recordset[0].CANTIDAD
        : 0;

      if (currentResult.recordset.length > 0) {
        // Update existing
        await tx.request()
          .input('prodId', sql.Int, input.PRODUCTO_ID)
          .input('depId', sql.Int, input.DEPOSITO_ID)
          .input('cant', sql.Decimal(18, 4), input.CANTIDAD_NUEVA)
          .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = @cant WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      } else {
        // Insert new stock record
        const maxId = await tx.request().query(`SELECT ISNULL(MAX(ITEM_ID), 0) + 1 AS nextId FROM STOCK_DEPOSITOS`);
        const nextItemId = maxId.recordset[0].nextId;
        await tx.request()
          .input('itemId', sql.Int, nextItemId)
          .input('prodId', sql.Int, input.PRODUCTO_ID)
          .input('depId', sql.Int, input.DEPOSITO_ID)
          .input('cant', sql.Decimal(18, 4), input.CANTIDAD_NUEVA)
          .query(`INSERT INTO STOCK_DEPOSITOS (ITEM_ID, PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@itemId, @prodId, @depId, @cant)`);

        // Also ensure PRODUCTO_DEPOSITOS relationship exists
        const relExists = await tx.request()
          .input('prodId', sql.Int, input.PRODUCTO_ID)
          .input('depId', sql.Int, input.DEPOSITO_ID)
          .query(`SELECT 1 FROM PRODUCTO_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);

        if (relExists.recordset.length === 0) {
          await tx.request()
            .input('prodId', sql.Int, input.PRODUCTO_ID)
            .input('depId', sql.Int, input.DEPOSITO_ID)
            .query(`INSERT INTO PRODUCTO_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID) VALUES (@prodId, @depId)`);
        }
      }

      // Update total product stock
      await tx.request()
        .input('prodId', sql.Int, input.PRODUCTO_ID)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = (SELECT ISNULL(SUM(CANTIDAD),0) FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId) WHERE PRODUCTO_ID = @prodId`);

      // Log in STOCK_HISTORIAL
      const diferencia = input.CANTIDAD_NUEVA - cantidadAnterior;
      await tx.request()
        .input('prodId', sql.Int, input.PRODUCTO_ID)
        .input('depId', sql.Int, input.DEPOSITO_ID)
        .input('cantAnt', sql.Decimal(18, 4), cantidadAnterior)
        .input('cantNueva', sql.Decimal(18, 4), input.CANTIDAD_NUEVA)
        .input('dif', sql.Decimal(18, 4), diferencia)
        .input('tipo', sql.VarChar, 'AJUSTE_MANUAL')
        .input('detalle', sql.VarChar, 'Ajuste manual de stock')
        .input('userId', sql.Int, usuarioId || null)
        .input('obs', sql.VarChar, input.OBSERVACIONES || null)
        .query(`
          INSERT INTO STOCK_HISTORIAL
            (PRODUCTO_ID, DEPOSITO_ID, CANTIDAD_ANTERIOR, CANTIDAD_NUEVA, DIFERENCIA, TIPO_OPERACION, REFERENCIA_DETALLE, USUARIO_ID, OBSERVACIONES)
          VALUES
            (@prodId, @depId, @cantAnt, @cantNueva, @dif, @tipo, @detalle, @userId, @obs)
        `);

      await tx.commit();
      return { ok: true, cantidadAnterior, cantidadNueva: input.CANTIDAD_NUEVA, diferencia };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Get stock change history ───────────────────
  async getHistory(filter: StockHistoryFilter) {
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 20;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE sh.PRODUCTO_ID = @productoId';
    const req = pool.request();
    req.input('productoId', sql.Int, filter.productoId);

    if (filter.depositoId) {
      where += ' AND sh.DEPOSITO_ID = @depositoId';
      req.input('depositoId', sql.Int, filter.depositoId);
    }

    // Count
    const countReq = pool.request();
    countReq.input('productoId', sql.Int, filter.productoId);
    if (filter.depositoId) countReq.input('depositoId', sql.Int, filter.depositoId);
    const countResult = await countReq.query(`SELECT COUNT(*) as total FROM STOCK_HISTORIAL sh ${where}`);
    const total = countResult.recordset[0].total;

    req.input('offset', sql.Int, offset);
    req.input('pageSize', sql.Int, pageSize);

    const result = await req.query(`
      SELECT sh.HISTORIAL_ID, sh.PRODUCTO_ID, sh.DEPOSITO_ID,
             sh.CANTIDAD_ANTERIOR, sh.CANTIDAD_NUEVA, sh.DIFERENCIA,
             sh.TIPO_OPERACION, sh.REFERENCIA_ID, sh.REFERENCIA_DETALLE,
             sh.USUARIO_ID, sh.FECHA, sh.OBSERVACIONES,
             d.NOMBRE AS DEPOSITO_NOMBRE,
             u.NOMBRE AS USUARIO_NOMBRE
      FROM STOCK_HISTORIAL sh
      LEFT JOIN DEPOSITOS d ON sh.DEPOSITO_ID = d.DEPOSITO_ID
      LEFT JOIN USUARIOS u ON sh.USUARIO_ID = u.USUARIO_ID
      ${where}
      ORDER BY sh.FECHA DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: result.recordset, total, page, pageSize };
  },

  // ── Get deposits list for stock management ─────
  async getDepositos() {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT DEPOSITO_ID, NOMBRE FROM DEPOSITOS ORDER BY NOMBRE`);
    return result.recordset;
  },

  // ── Get deposits filtered by punto de venta ──────
  async getDepositosByPuntoVenta(puntoVentaId: number) {
    const pool = await getPool();
    try {
      const result = await pool.request()
        .input('id', sql.Int, puntoVentaId)
        .query(`
          SELECT d.DEPOSITO_ID, d.NOMBRE
          FROM DEPOSITOS d
          JOIN PUNTOS_VENTA_DEPOSITOS pvd ON pvd.DEPOSITO_ID = d.DEPOSITO_ID
          WHERE pvd.PUNTO_VENTA_ID = @id
          ORDER BY d.NOMBRE
        `);
      return result.recordset;
    } catch {
      return [];
    }
  },
};
