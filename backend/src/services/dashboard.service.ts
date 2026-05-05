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

  async getDesgloseHoy(puntoVentaId?: number) {
    const pool = await getPool();
    const req = pool.request();
    let pvFilter = '';
    if (puntoVentaId) {
      pvFilter = ' AND v.PUNTO_VENTA_ID = @pvId';
      req.input('pvId', sql.Int, puntoVentaId);
    }

    const result = await req.query(`
      SELECT
        mp.METODO_PAGO_ID,
        mp.NOMBRE,
        mp.CATEGORIA,
        mp.IMAGEN_BASE64,
        ISNULL(SUM(vmp.MONTO), 0) AS TOTAL
      FROM VENTAS_METODOS_PAGO vmp
      JOIN VENTAS v ON vmp.VENTA_ID = v.VENTA_ID
      JOIN METODOS_PAGO mp ON vmp.METODO_PAGO_ID = mp.METODO_PAGO_ID
      WHERE CAST(v.FECHA_VENTA AS DATE) = CAST(GETDATE() AS DATE) ${pvFilter}
      GROUP BY mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64
      ORDER BY mp.NOMBRE
    `);

    return result.recordset;
  },

  async getLogo(): Promise<{ data: Buffer; contentType: string } | null> {
    // Use the settings service logo table (CONFIG_LOGO_EMPRESA)
    const { settingsService } = await import('./settings.service.js');
    return settingsService.getLogo();
  },

  // ─────────────────────────────────────────────────────────────────
  // ANALYTICS — Unified endpoint for the redesigned dashboard
  // ─────────────────────────────────────────────────────────────────
  async getAnalytics(opts: {
    from: string;          // YYYY-MM-DD (inclusive)
    to: string;            // YYYY-MM-DD (inclusive)
    granularity: 'hour' | 'day' | 'week' | 'month';
    puntoVentaId?: number;
  }) {
    const pool = await getPool();
    const { from, to, granularity, puntoVentaId } = opts;

    // Compute previous equivalent period (same length, immediately before "from")
    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T00:00:00');
    const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
    const prevTo = new Date(fromDate); prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1));
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const prevFromStr = fmt(prevFrom);
    const prevToStr = fmt(prevTo);

    const buildReq = (fromStr: string, toStr: string) => {
      const r = pool.request()
        .input('from', sql.DateTime, new Date(fromStr + 'T00:00:00'))
        .input('to', sql.DateTime, new Date(toStr + 'T23:59:59'));
      if (puntoVentaId) r.input('pvId', sql.Int, puntoVentaId);
      return r;
    };
    const pvFilter = puntoVentaId ? ' AND v.PUNTO_VENTA_ID = @pvId' : '';
    const dateFilter = ` v.FECHA_VENTA >= @from AND v.FECHA_VENTA <= @to ${pvFilter} `;

    // ── KPIs (current + previous period) ──────────────────────────
    const kpiSql = (where: string) => `
      SELECT
        COUNT(*) AS ventas,
        ISNULL(SUM(v.TOTAL), 0) AS total,
        ISNULL(SUM(v.GANANCIAS), 0) AS ganancia,
        ISNULL(AVG(NULLIF(v.TOTAL, 0)), 0) AS ticketPromedio
      FROM VENTAS v
      WHERE ${where}
    `;

    const [kpiCurr, kpiPrev] = await Promise.all([
      buildReq(from, to).query(kpiSql(dateFilter)),
      buildReq(prevFromStr, prevToStr).query(kpiSql(dateFilter)),
    ]);

    const calcMargen = (k: any) => {
      const t = Number(k.total) || 0;
      const g = Number(k.ganancia) || 0;
      return t > 0 ? +(g / t * 100).toFixed(2) : 0;
    };
    const kpis = { ...kpiCurr.recordset[0], margenPct: calcMargen(kpiCurr.recordset[0]) };
    const prev = { ...kpiPrev.recordset[0], margenPct: calcMargen(kpiPrev.recordset[0]) };

    // ── Time series ───────────────────────────────────────────────
    let bucketExpr: string;
    switch (granularity) {
      case 'hour':
        bucketExpr = `DATEADD(HOUR, DATEDIFF(HOUR, 0, v.FECHA_VENTA), 0)`;
        break;
      case 'week':
        bucketExpr = `DATEADD(DAY, 1 - DATEPART(WEEKDAY, v.FECHA_VENTA), CAST(v.FECHA_VENTA AS DATE))`;
        break;
      case 'month':
        bucketExpr = `DATEFROMPARTS(YEAR(v.FECHA_VENTA), MONTH(v.FECHA_VENTA), 1)`;
        break;
      case 'day':
      default:
        bucketExpr = `CAST(v.FECHA_VENTA AS DATE)`;
    }

    const seriesRes = await buildReq(from, to).query(`
      SELECT
        ${bucketExpr} AS bucket,
        COUNT(*) AS ventas,
        ISNULL(SUM(v.TOTAL), 0) AS total,
        ISNULL(SUM(v.GANANCIAS), 0) AS ganancia
      FROM VENTAS v
      WHERE ${dateFilter}
      GROUP BY ${bucketExpr}
      ORDER BY bucket
    `);

    // ── Métodos de Pago breakdown ─────────────────────────────────
    let metodosPago: any[] = [];
    try {
      const mpRes = await buildReq(from, to).query(`
        SELECT
          mp.METODO_PAGO_ID,
          mp.NOMBRE,
          mp.CATEGORIA,
          mp.IMAGEN_BASE64,
          ISNULL(SUM(vmp.MONTO), 0) AS TOTAL
        FROM VENTAS_METODOS_PAGO vmp
        JOIN VENTAS v ON vmp.VENTA_ID = v.VENTA_ID
        JOIN METODOS_PAGO mp ON vmp.METODO_PAGO_ID = mp.METODO_PAGO_ID
        WHERE ${dateFilter}
        GROUP BY mp.METODO_PAGO_ID, mp.NOMBRE, mp.CATEGORIA, mp.IMAGEN_BASE64
        ORDER BY TOTAL DESC
      `);
      metodosPago = mpRes.recordset;
    } catch { /* table may not exist yet */ }

    // ── Top Productos ─────────────────────────────────────────────
    let topProductos: any[] = [];
    try {
      const tpRes = await buildReq(from, to).query(`
        SELECT TOP 10
          p.PRODUCTO_ID,
          p.CODIGOPARTICULAR,
          p.NOMBRE,
          ISNULL(SUM(vi.CANTIDAD), 0) AS cantidad,
          ISNULL(SUM(vi.CANTIDAD * vi.PRECIO_UNITARIO), 0) AS total
        FROM VENTAS_ITEMS vi
        JOIN VENTAS v ON vi.VENTA_ID = v.VENTA_ID
        JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
        WHERE ${dateFilter}
        GROUP BY p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE
        ORDER BY cantidad DESC
      `);
      topProductos = tpRes.recordset;
    } catch { /* ignore */ }

    // ── Top Clientes ──────────────────────────────────────────────
    let topClientes: any[] = [];
    try {
      const tcRes = await buildReq(from, to).query(`
        SELECT TOP 10
          c.CLIENTE_ID,
          c.NOMBRE,
          COUNT(*) AS ventas,
          ISNULL(SUM(v.TOTAL), 0) AS total
        FROM VENTAS v
        LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
        WHERE ${dateFilter}
        GROUP BY c.CLIENTE_ID, c.NOMBRE
        ORDER BY total DESC
      `);
      topClientes = tcRes.recordset;
    } catch { /* ignore */ }

    // ── Top Categorías ────────────────────────────────────────────
    let topCategorias: any[] = [];
    try {
      const catRes = await buildReq(from, to).query(`
        SELECT TOP 8
          ISNULL(cat.NOMBRE, 'Sin categoría') AS NOMBRE,
          ISNULL(SUM(vi.CANTIDAD * vi.PRECIO_UNITARIO), 0) AS total
        FROM VENTAS_ITEMS vi
        JOIN VENTAS v ON vi.VENTA_ID = v.VENTA_ID
        JOIN PRODUCTOS p ON vi.PRODUCTO_ID = p.PRODUCTO_ID
        LEFT JOIN CATEGORIAS cat ON p.CATEGORIA_ID = cat.CATEGORIA_ID
        WHERE ${dateFilter}
        GROUP BY cat.NOMBRE
        ORDER BY total DESC
      `);
      topCategorias = catRes.recordset;
    } catch { /* ignore */ }

    // ── Heatmap (day-of-week × hour) ──────────────────────────────
    const heatRes = await buildReq(from, to).query(`
      SELECT
        DATEPART(WEEKDAY, v.FECHA_VENTA) AS dow,
        DATEPART(HOUR, v.FECHA_VENTA) AS hour,
        COUNT(*) AS ventas,
        ISNULL(SUM(v.TOTAL), 0) AS total
      FROM VENTAS v
      WHERE ${dateFilter}
      GROUP BY DATEPART(WEEKDAY, v.FECHA_VENTA), DATEPART(HOUR, v.FECHA_VENTA)
    `);

    // ── Caja Central summary ──────────────────────────────────────
    let cajaCentral: any = {
      totalIngresos: 0, totalEgresos: 0, balance: 0,
      efectivo: 0, digital: 0, cheques: 0,
      chequesEnCartera: 0, chequesEnCarteraCantidad: 0,
    };
    try {
      const { cajaCentralService } = await import('./cajaCentral.service.js');
      cajaCentral = await cajaCentralService.getTotales({
        fechaDesde: from,
        fechaHasta: to,
        puntoVentaIds: puntoVentaId ? [puntoVentaId] : undefined,
      });
    } catch { /* ignore */ }

    // ── Stock bajo (snapshot, sin filtro de fecha) ────────────────
    const lowStock = await pool.request().query(`
      SELECT TOP 8
        p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE, p.CANTIDAD, p.STOCK_MINIMO
      FROM PRODUCTOS p
      WHERE p.ACTIVO = 1
        AND p.STOCK_MINIMO IS NOT NULL
        AND p.CANTIDAD <= p.STOCK_MINIMO
        AND p.DESCUENTA_STOCK = 1
      ORDER BY (p.CANTIDAD - p.STOCK_MINIMO) ASC
    `);

    // ── Cajas abiertas ────────────────────────────────────────────
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
      range: { from, to, prevFrom: prevFromStr, prevTo: prevToStr, granularity, days },
      kpis,
      prev,
      series: seriesRes.recordset,
      metodosPago,
      topProductos,
      topClientes,
      topCategorias,
      heatmap: heatRes.recordset,
      cajaCentral,
      productosStockBajo: lowStock.recordset,
      cajasAbiertas: openCajas.recordset,
    };
  },
};
