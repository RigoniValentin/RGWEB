import { getPool, sql } from '../database/connection.js';

export const dashboardService = {
  async getStats(puntoVentaId?: number) {
    const pool = await getPool();

    // ── Counts ─────────────────────────────────────
    const counts = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM CLIENTES WHERE ACTIVO = 1) AS totalClientes,
        (SELECT COUNT(*) FROM PRODUCTOS WHERE ACTIVO = 1) AS totalProductos,
        (SELECT COUNT(*) FROM PROVEEDORES WHERE ACTIVO = 1) AS totalProveedores
    `);

    // ── Sales today ────────────────────────────────
    const todayReq = pool.request();
    let pvFilter = '';
    if (puntoVentaId) {
      pvFilter = ' AND PUNTO_VENTA_ID = @pvId';
      todayReq.input('pvId', sql.Int, puntoVentaId);
    }

    const today = await todayReq.query(`
      SELECT 
        COUNT(*) AS ventasHoy,
        ISNULL(SUM(TOTAL), 0) AS montoHoy,
        ISNULL(SUM(GANANCIAS), 0) AS gananciaHoy,
        ISNULL(SUM(MONTO_EFECTIVO), 0) AS efectivoHoy,
        ISNULL(SUM(MONTO_DIGITAL), 0) AS digitalHoy
      FROM VENTAS
      WHERE CAST(FECHA_VENTA AS DATE) = CAST(GETDATE() AS DATE) ${pvFilter}
    `);

    // ── Sales this month ───────────────────────────
    const monthReq = pool.request();
    if (puntoVentaId) {
      monthReq.input('pvId', sql.Int, puntoVentaId);
    }

    const month = await monthReq.query(`
      SELECT 
        COUNT(*) AS ventasMes,
        ISNULL(SUM(TOTAL), 0) AS montoMes,
        ISNULL(SUM(GANANCIAS), 0) AS gananciaMes
      FROM VENTAS
      WHERE MONTH(FECHA_VENTA) = MONTH(GETDATE()) 
        AND YEAR(FECHA_VENTA) = YEAR(GETDATE()) ${pvFilter}
    `);

    // ── Low stock products ─────────────────────────
    const lowStock = await pool.request().query(`
      SELECT TOP 10 
        p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, p.CANTIDAD, p.STOCK_MINIMO
      FROM PRODUCTOS p
      WHERE p.ACTIVO = 1 
        AND p.STOCK_MINIMO IS NOT NULL 
        AND p.CANTIDAD <= p.STOCK_MINIMO
        AND p.DESCUENTA_STOCK = 1
      ORDER BY (p.CANTIDAD - p.STOCK_MINIMO) ASC
    `);

    // ── Recent sales ───────────────────────────────
    const recentReq = pool.request();
    if (puntoVentaId) {
      recentReq.input('pvId', sql.Int, puntoVentaId);
    }

    const recent = await recentReq.query(`
      SELECT TOP 10 
        v.VENTA_ID, v.FECHA_VENTA, v.TOTAL, v.TIPO_COMPROBANTE,
        c.NOMBRE AS CLIENTE_NOMBRE
      FROM VENTAS v
      LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
      WHERE 1=1 ${pvFilter}
      ORDER BY v.FECHA_VENTA DESC
    `);

    // ── Open cash registers ────────────────────────
    const openCajas = await pool.request().query(`
      SELECT c.CAJA_ID, c.FECHA_APERTURA, c.MONTO_APERTURA, c.ESTADO,
        u.NOMBRE AS USUARIO_NOMBRE, pv.NOMBRE AS PUNTO_VENTA_NOMBRE
      FROM CAJA c
      JOIN USUARIOS u ON c.USUARIO_ID = u.USUARIO_ID
      LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
      WHERE c.ESTADO = 'ABIERTA'
      ORDER BY c.FECHA_APERTURA DESC
    `);

    return {
      ...counts.recordset[0],
      ...today.recordset[0],
      ...month.recordset[0],
      productosStockBajo: lowStock.recordset,
      ventasRecientes: recent.recordset,
      cajasAbiertas: openCajas.recordset,
    };
  },

  async getVentasPorDia(dias = 30, puntoVentaId?: number) {
    const pool = await getPool();
    const req = pool.request().input('dias', sql.Int, dias);
    let pvFilter = '';
    if (puntoVentaId) {
      pvFilter = ' AND PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, puntoVentaId);
    }

    const result = await req.query(`
      SELECT 
        CAST(FECHA_VENTA AS DATE) AS fecha,
        COUNT(*) AS cantidad,
        ISNULL(SUM(TOTAL), 0) AS total,
        ISNULL(SUM(GANANCIAS), 0) AS ganancia
      FROM VENTAS
      WHERE FECHA_VENTA >= DATEADD(DAY, -@dias, GETDATE()) ${pvFilter}
      GROUP BY CAST(FECHA_VENTA AS DATE)
      ORDER BY fecha
    `);

    return result.recordset;
  },

  async getLogo(): Promise<Buffer | null> {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT LOGO FROM EMPRESA_CLIENTE
    `);
    const row = result.recordset[0];
    if (!row || !row.LOGO) return null;
    return row.LOGO;
  },
};
