import { getPool, sql } from '../database/connection.js';
import { cajaCentralService } from './cajaCentral.service.js';

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
      SELECT cs.SESION_ID AS CAJA_ID, cs.FECHA_APERTURA, cs.MONTO_APERTURA, cs.ESTADO,
        u.NOMBRE AS USUARIO_NOMBRE, pv.NOMBRE AS PUNTO_VENTA_NOMBRE
      FROM CAJA_SESIONES cs
      INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
      JOIN USUARIOS u ON cs.USUARIO_ID = u.USUARIO_ID
      LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
      WHERE cs.ESTADO = 'ACTIVA'
      ORDER BY cs.FECHA_APERTURA DESC
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
    soloFiscal?: boolean;
  }) {
    const pool = await getPool();
    const { from, to, granularity, puntoVentaId, soloFiscal } = opts;

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
    const fiscalFilter = soloFiscal ? " AND v.NUMERO_FISCAL IS NOT NULL AND LTRIM(RTRIM(v.NUMERO_FISCAL)) <> ''" : '';
    const dateFilter = ` v.FECHA_VENTA >= @from AND v.FECHA_VENTA <= @to ${pvFilter} ${fiscalFilter} `;

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

    // ── Fiscal breakdown ────────────────────────────────────────
    let comprobantesPorTipo: any[] = [];
    let ultimaVentaFiscal: any = null;
    if (soloFiscal) {
      const fiscalTipoRes = await buildReq(from, to).query(`
        SELECT
          ISNULL(v.TIPO_COMPROBANTE, 'Sin tipo') AS TIPO_COMPROBANTE,
          COUNT(*) AS cantidad,
          ISNULL(SUM(v.TOTAL), 0) AS total
        FROM VENTAS v
        WHERE ${dateFilter}
        GROUP BY v.TIPO_COMPROBANTE
        ORDER BY total DESC
      `);
      comprobantesPorTipo = fiscalTipoRes.recordset;

      const lastFiscalRes = await buildReq(from, to).query(`
        SELECT TOP 1
          v.VENTA_ID,
          v.FECHA_VENTA,
          v.TOTAL,
          v.NUMERO_FISCAL,
          v.CAE,
          v.PUNTO_VENTA,
          v.TIPO_COMPROBANTE,
          c.NOMBRE AS CLIENTE_NOMBRE
        FROM VENTAS v
        LEFT JOIN CLIENTES c ON v.CLIENTE_ID = c.CLIENTE_ID
        WHERE ${dateFilter}
        ORDER BY v.FECHA_VENTA DESC, v.VENTA_ID DESC
      `);
      ultimaVentaFiscal = lastFiscalRes.recordset[0] || null;
    }

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
    const cajaCentral = await cajaCentralService.getTotales({
      fechaDesde: from,
      fechaHasta: to,
      puntoVentaIds: puntoVentaId ? [puntoVentaId] : undefined,
    });

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
      SELECT cs.SESION_ID AS CAJA_ID, cs.FECHA_APERTURA, cs.MONTO_APERTURA, cs.ESTADO,
        u.NOMBRE AS USUARIO_NOMBRE, pv.NOMBRE AS PUNTO_VENTA_NOMBRE
      FROM CAJA_SESIONES cs
      INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
      JOIN USUARIOS u ON cs.USUARIO_ID = u.USUARIO_ID
      LEFT JOIN PUNTO_VENTAS pv ON c.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
      WHERE cs.ESTADO = 'ACTIVA'
      ORDER BY cs.FECHA_APERTURA DESC
    `);

    return {
      range: { from, to, prevFrom: prevFromStr, prevTo: prevToStr, granularity, days },
      kpis,
      prev,
      series: seriesRes.recordset,
      comprobantesPorTipo,
      ultimaVentaFiscal,
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

  // ─────────────────────────────────────────────────────────────────
  // CAJEROS RENDIMIENTO — Per-cashier KPIs for bonus / recognition
  // ─────────────────────────────────────────────────────────────────
  async getCajerosRendimiento(opts: {
    from: string;          // YYYY-MM-DD (inclusive)
    to: string;            // YYYY-MM-DD (inclusive)
    puntoVentaId?: number;
    usuarioId?: number;    // optional — filter to a single cashier (for self-view)
    top?: number;          // max cajeros a devolver (default 50)
  }) {
    const pool = await getPool();
    const { from, to, puntoVentaId, usuarioId, top = 50 } = opts;

    // Compute previous equivalent period (same length, immediately before "from")
    const fromDate = new Date(from + 'T00:00:00');
    const toDate = new Date(to + 'T00:00:00');
    const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
    const prevTo = new Date(fromDate); prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - (days - 1));
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const prevFromStr = fmt(prevFrom);
    const prevToStr = fmt(prevTo);

    const buildReq = (fromStr: string, toStr: string, includeUsuario = true) => {
      const r = pool.request()
        .input('from', sql.DateTime, new Date(fromStr + 'T00:00:00'))
        .input('to', sql.DateTime, new Date(toStr + 'T23:59:59'));
      if (puntoVentaId) r.input('pvId', sql.Int, puntoVentaId);
      if (includeUsuario && usuarioId) r.input('uid', sql.Int, usuarioId);
      return r;
    };

    const pvFilter = puntoVentaId ? ' AND v.PUNTO_VENTA_ID = @pvId' : '';
    const uidFilter = usuarioId ? ' AND v.USUARIO_ID = @uid' : '';
    const dateFilter = (range: 'from' | 'to') =>
      ` v.FECHA_VENTA >= @from AND v.FECHA_VENTA <= @to ${pvFilter} ${uidFilter} `;

    // ── Current period KPIs grouped by USUARIO_ID ───────────────────
    const baseWhere = ` v.USUARIO_ID IS NOT NULL ${pvFilter} ${uidFilter}
                        AND v.FECHA_VENTA >= @from AND v.FECHA_VENTA <= @to `;

    const currRes = await buildReq(from, to).query(`
      SELECT TOP ${Math.min(top, 500)}
        u.USUARIO_ID,
        u.NOMBRE AS USUARIO_NOMBRE,
        COUNT(*) AS ventas,
        ISNULL(SUM(v.TOTAL), 0) AS total,
        ISNULL(SUM(v.GANANCIAS), 0) AS ganancia,
        ISNULL(AVG(NULLIF(v.TOTAL, 0)), 0) AS ticketPromedio,
        ISNULL(SUM(v.MONTO_EFECTIVO), 0) AS efectivo,
        ISNULL(SUM(v.MONTO_DIGITAL), 0) AS digital,
        COUNT(DISTINCT CAST(v.FECHA_VENTA AS DATE)) AS diasTrabajados,
        MAX(v.TOTAL) AS mejorVenta,
        MIN(v.FECHA_VENTA) AS primeraVenta,
        MAX(v.FECHA_VENTA) AS ultimaVenta
      FROM VENTAS v WITH (NOLOCK)
      INNER JOIN USUARIOS u WITH (NOLOCK) ON u.USUARIO_ID = v.USUARIO_ID
      WHERE ${baseWhere}
      GROUP BY u.USUARIO_ID, u.NOMBRE
      ORDER BY total DESC
    `);

    // ── Previous period totals per USUARIO_ID (for delta) ───────────
    const prevReq = pool.request()
      .input('from', sql.DateTime, new Date(prevFromStr + 'T00:00:00'))
      .input('to', sql.DateTime, new Date(prevToStr + 'T23:59:59'));
    if (puntoVentaId) prevReq.input('pvId', sql.Int, puntoVentaId);
    if (usuarioId) prevReq.input('uid', sql.Int, usuarioId);

    const prevRes = await prevReq.query(`
        SELECT
          u.USUARIO_ID,
          ISNULL(SUM(v.TOTAL), 0) AS total,
          COUNT(*) AS ventas
        FROM VENTAS v WITH (NOLOCK)
        INNER JOIN USUARIOS u WITH (NOLOCK) ON u.USUARIO_ID = v.USUARIO_ID
        WHERE v.USUARIO_ID IS NOT NULL
          AND v.FECHA_VENTA >= @from AND v.FECHA_VENTA <= @to
          ${puntoVentaId ? ' AND v.PUNTO_VENTA_ID = @pvId' : ''}
          ${usuarioId ? ' AND v.USUARIO_ID = @uid' : ''}
        GROUP BY u.USUARIO_ID
      `).catch(() => ({ recordset: [] as any[] }));

    const prevByUser = new Map<number, { total: number; ventas: number }>();
    for (const r of (prevRes.recordset || []) as any[]) {
      prevByUser.set(Number(r.USUARIO_ID), {
        total: Number(r.total) || 0,
        ventas: Number(r.ventas) || 0,
      });
    }

    const items = (currRes.recordset || []).map((r: any) => {
      const total = Number(r.total) || 0;
      const ganancia = Number(r.ganancia) || 0;
      const margenPct = total > 0 ? +(ganancia / total * 100).toFixed(2) : 0;
      const prev = prevByUser.get(Number(r.USUARIO_ID));
      const totalAnterior = prev?.total ?? 0;
      const deltaPct = totalAnterior > 0
        ? +(((total - totalAnterior) / totalAnterior) * 100).toFixed(1)
        : (total > 0 ? 100 : 0);
      return {
        USUARIO_ID: Number(r.USUARIO_ID),
        USUARIO_NOMBRE: String(r.USUARIO_NOMBRE || ''),
        ventas: Number(r.ventas) || 0,
        total,
        ganancia,
        margenPct,
        ticketPromedio: Number(r.ticketPromedio) || 0,
        efectivo: Number(r.efectivo) || 0,
        digital: Number(r.digital) || 0,
        diasTrabajados: Number(r.diasTrabajados) || 0,
        mejorVenta: Number(r.mejorVenta) || 0,
        primeraVenta: r.primeraVenta ? new Date(r.primeraVenta).toISOString() : null,
        ultimaVenta: r.ultimaVenta ? new Date(r.ultimaVenta).toISOString() : null,
        totalAnterior,
        deltaPct,
      };
    });

    // ── Top 5 productos por cajero (para drill-down expandible) ─────
    let topProductosByUser: Record<number, any[]> = {};
    try {
      const tpReq = buildReq(from, to);
      const tpRes = await tpReq.query(`
        WITH ranked AS (
          SELECT
            v.USUARIO_ID,
            vi.PRODUCTO_ID,
            p.NOMBRE,
            ISNULL(um.ABREVIACION, 'u') AS UNIDAD_ABREVIACION,
            SUM(vi.CANTIDAD) AS cantidad,
            SUM(vi.CANTIDAD * vi.PRECIO_UNITARIO) AS total,
            ROW_NUMBER() OVER (
              PARTITION BY v.USUARIO_ID
              ORDER BY SUM(vi.CANTIDAD * vi.PRECIO_UNITARIO) DESC
            ) AS rn
          FROM VENTAS_ITEMS vi WITH (NOLOCK)
          JOIN VENTAS v WITH (NOLOCK) ON vi.VENTA_ID = v.VENTA_ID
          JOIN PRODUCTOS p WITH (NOLOCK) ON vi.PRODUCTO_ID = p.PRODUCTO_ID
          LEFT JOIN UNIDADES_MEDIDA um WITH (NOLOCK) ON p.UNIDAD_ID = um.UNIDAD_ID
          WHERE v.USUARIO_ID IS NOT NULL
            AND v.FECHA_VENTA >= @from AND v.FECHA_VENTA <= @to
            ${puntoVentaId ? ' AND v.PUNTO_VENTA_ID = @pvId' : ''}
            ${usuarioId ? ' AND v.USUARIO_ID = @uid' : ''}
          GROUP BY v.USUARIO_ID, vi.PRODUCTO_ID, p.NOMBRE, um.ABREVIACION
        )
        SELECT USUARIO_ID, PRODUCTO_ID, NOMBRE, UNIDAD_ABREVIACION, cantidad, total
        FROM ranked
        WHERE rn <= 5
        ORDER BY USUARIO_ID, total DESC
      `);
      for (const row of (tpRes.recordset || []) as any[]) {
        const uid = Number(row.USUARIO_ID);
        if (!topProductosByUser[uid]) topProductosByUser[uid] = [];
        topProductosByUser[uid].push({
          PRODUCTO_ID: Number(row.PRODUCTO_ID),
          NOMBRE: String(row.NOMBRE || ''),
          UNIDAD_ABREVIACION: String(row.UNIDAD_ABREVIACION || 'u'),
          cantidad: Number(row.cantidad) || 0,
          total: Number(row.total) || 0,
        });
      }
    } catch { /* ignore */ }

    return {
      range: { from, to, prevFrom: prevFromStr, prevTo: prevToStr, days },
      items,
      topProductosByUser,
    };
  },
};
