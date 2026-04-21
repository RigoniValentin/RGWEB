import { getPool, sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  Libro IVA Ventas Service
//  Conforme a normativa AFIP Argentina — RG 3685/2014
// ═══════════════════════════════════════════════════

export interface LibroIvaFilter {
  fechaDesde: string;
  fechaHasta: string;
  puntoVentaId?: number;
  tipoComprobante?: string;
  incluirNoCobradas?: boolean;
}

export const libroIvaVentasService = {

  // ── Comprobantes ─────────────────────────────────
  async getComprobantes(filter: LibroIvaFilter) {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta)
      .input('puntoVentaId', sql.Int, filter.puntoVentaId ?? null)
      .input('tipoComprobante', sql.VarChar(10), filter.tipoComprobante ?? null)
      .input('incluirNoCobradas', sql.Bit, filter.incluirNoCobradas ? 1 : 0);

    const result = await req.query(`
      SELECT
        V.VENTA_ID,
        CAST(V.FECHA_VENTA AS DATE) AS FECHA,
        V.TIPO_COMPROBANTE,
        CASE V.TIPO_COMPROBANTE
          WHEN 'A'    THEN '001 - Factura A'
          WHEN 'B'    THEN '006 - Factura B'
          WHEN 'C'    THEN '011 - Factura C'
          WHEN 'NC A' THEN '003 - Nota de Crédito A'
          WHEN 'NC B' THEN '008 - Nota de Crédito B'
          WHEN 'NC C' THEN '013 - Nota de Crédito C'
          WHEN 'ND A' THEN '002 - Nota de Débito A'
          WHEN 'ND B' THEN '007 - Nota de Débito B'
          WHEN 'ND C' THEN '012 - Nota de Débito C'
          ELSE V.TIPO_COMPROBANTE
        END AS TIPO_COMPROBANTE_DESCRIPCION,
        CASE V.TIPO_COMPROBANTE
          WHEN 'A'    THEN 1
          WHEN 'B'    THEN 6
          WHEN 'C'    THEN 11
          WHEN 'NC A' THEN 3
          WHEN 'NC B' THEN 8
          WHEN 'NC C' THEN 13
          WHEN 'ND A' THEN 2
          WHEN 'ND B' THEN 7
          WHEN 'ND C' THEN 12
          ELSE 0
        END AS CODIGO_COMPROBANTE_AFIP,
        V.PUNTO_VENTA_ID,
        ISNULL(PV.NOMBRE, 'PV ' + CAST(V.PUNTO_VENTA_ID AS NVARCHAR)) AS PUNTO_VENTA_NOMBRE,
        V.NUMERO_FISCAL,
        V.CAE,
        V.CLIENTE_ID,
        ISNULL(C.NOMBRE, 'CONSUMIDOR FINAL') AS CLIENTE_NOMBRE,
        ISNULL(C.NUMERO_DOC, '00000000000') AS CLIENTE_CUIT,
        ISNULL(C.CONDICION_IVA, 'CONSUMIDOR FINAL') AS CLIENTE_CONDICION_IVA,
        CASE
          WHEN LEN(ISNULL(C.NUMERO_DOC, '')) = 11 THEN 80
          WHEN LEN(ISNULL(C.NUMERO_DOC, '')) = 8  THEN 96
          ELSE 99
        END AS TIPO_DOC_CLIENTE,
        CASE
          WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(ISNULL(V.NETO_NO_GRAVADO, 0))
          ELSE ISNULL(V.NETO_NO_GRAVADO, 0)
        END AS NETO_NO_GRAVADO,
        CASE
          WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(ISNULL(V.NETO_GRAVADO, 0))
          ELSE ISNULL(V.NETO_GRAVADO, 0)
        END AS NETO_GRAVADO,
        CASE
          WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(ISNULL(V.IVA_TOTAL, 0))
          ELSE ISNULL(V.IVA_TOTAL, 0)
        END AS IVA_TOTAL,
        CASE
          WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(ISNULL(V.IMPUESTO_INTERNO, 0))
          ELSE ISNULL(V.IMPUESTO_INTERNO, 0)
        END AS IMPUESTO_INTERNO,
        CASE
          WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(ISNULL(V.TOTAL, 0))
          ELSE ISNULL(V.TOTAL, 0)
        END AS TOTAL,
        V.COBRADA,
        CASE
          WHEN ISNULL(V.NETO_GRAVADO, 0) > 0 AND ISNULL(V.IVA_TOTAL, 0) > 0
          THEN ROUND((ISNULL(V.IVA_TOTAL, 0) / ISNULL(V.NETO_GRAVADO, 0)) * 100, 2)
          ELSE 0
        END AS ALICUOTA_IVA_ESTIMADA
      FROM VENTAS V
      LEFT JOIN CLIENTES C ON V.CLIENTE_ID = C.CLIENTE_ID
      LEFT JOIN PUNTO_VENTAS PV ON V.PUNTO_VENTA_ID = PV.PUNTO_VENTA_ID
      WHERE
        CAST(V.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta
        AND ISNULL(V.ERROR_FE, 'N') = 'N'
        AND V.NUMERO_FISCAL IS NOT NULL
        AND LEN(V.NUMERO_FISCAL) > 0
        AND (@puntoVentaId IS NULL OR V.PUNTO_VENTA_ID = @puntoVentaId)
        AND (@tipoComprobante IS NULL OR V.TIPO_COMPROBANTE = @tipoComprobante)
        AND (@incluirNoCobradas = 1 OR V.COBRADA = 1)
      ORDER BY
        V.FECHA_VENTA ASC,
        V.TIPO_COMPROBANTE,
        V.NUMERO_FISCAL
    `);

    return result.recordset;
  },

  // ── Totales generales ────────────────────────────
  async getTotales(filter: LibroIvaFilter) {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta)
      .input('puntoVentaId', sql.Int, filter.puntoVentaId ?? null)
      .input('tipoComprobante', sql.VarChar(10), filter.tipoComprobante ?? null)
      .input('incluirNoCobradas', sql.Bit, filter.incluirNoCobradas ? 1 : 0);

    const result = await req.query(`
      SELECT
        COUNT(*) AS CANTIDAD_COMPROBANTES,
        SUM(CASE WHEN V.TIPO_COMPROBANTE NOT LIKE 'NC%' AND V.TIPO_COMPROBANTE NOT LIKE 'ND%' THEN 1 ELSE 0 END) AS CANTIDAD_FACTURAS,
        SUM(CASE WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN 1 ELSE 0 END) AS CANTIDAD_NC,
        ISNULL(SUM(
          CASE WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(ISNULL(V.NETO_NO_GRAVADO, 0))
               ELSE ISNULL(V.NETO_NO_GRAVADO, 0) END
        ), 0) AS TOTAL_NETO_NO_GRAVADO,
        ISNULL(SUM(
          CASE WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(ISNULL(V.NETO_GRAVADO, 0))
               ELSE ISNULL(V.NETO_GRAVADO, 0) END
        ), 0) AS TOTAL_NETO_GRAVADO,
        ISNULL(SUM(
          CASE WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(ISNULL(V.IVA_TOTAL, 0))
               ELSE ISNULL(V.IVA_TOTAL, 0) END
        ), 0) AS TOTAL_IVA,
        ISNULL(SUM(
          CASE WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(ISNULL(V.IMPUESTO_INTERNO, 0))
               ELSE ISNULL(V.IMPUESTO_INTERNO, 0) END
        ), 0) AS TOTAL_IMPUESTO_INTERNO,
        ISNULL(SUM(
          CASE WHEN V.TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(ISNULL(V.TOTAL, 0))
               ELSE ISNULL(V.TOTAL, 0) END
        ), 0) AS TOTAL_GENERAL
      FROM VENTAS V
      WHERE
        CAST(V.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta
        AND ISNULL(V.ERROR_FE, 'N') = 'N'
        AND V.NUMERO_FISCAL IS NOT NULL
        AND LEN(V.NUMERO_FISCAL) > 0
        AND (@puntoVentaId IS NULL OR V.PUNTO_VENTA_ID = @puntoVentaId)
        AND (@tipoComprobante IS NULL OR V.TIPO_COMPROBANTE = @tipoComprobante)
        AND (@incluirNoCobradas = 1 OR V.COBRADA = 1)
    `);

    return result.recordset[0];
  },

  // ── Totales por alícuota ─────────────────────────
  async getTotalesPorAlicuota(filter: LibroIvaFilter) {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde', sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta', sql.VarChar(10), filter.fechaHasta)
      .input('puntoVentaId', sql.Int, filter.puntoVentaId ?? null)
      .input('tipoComprobante', sql.VarChar(10), filter.tipoComprobante ?? null)
      .input('incluirNoCobradas', sql.Bit, filter.incluirNoCobradas ? 1 : 0);

    const result = await req.query(`
      WITH VentasConAlicuota AS (
        SELECT
          V.VENTA_ID,
          V.TIPO_COMPROBANTE,
          ISNULL(V.NETO_GRAVADO, 0) AS NETO_GRAVADO,
          ISNULL(V.IVA_TOTAL, 0)    AS IVA_TOTAL,
          CASE
            WHEN ISNULL(V.NETO_GRAVADO, 0) = 0 THEN 0
            WHEN ROUND((ISNULL(V.IVA_TOTAL, 0) / NULLIF(V.NETO_GRAVADO, 0)) * 100, 0) BETWEEN 26 AND 28 THEN 27.00
            WHEN ROUND((ISNULL(V.IVA_TOTAL, 0) / NULLIF(V.NETO_GRAVADO, 0)) * 100, 0) BETWEEN 20 AND 22 THEN 21.00
            WHEN ROUND((ISNULL(V.IVA_TOTAL, 0) / NULLIF(V.NETO_GRAVADO, 0)) * 100, 0) BETWEEN 9 AND 12  THEN 10.50
            WHEN ROUND((ISNULL(V.IVA_TOTAL, 0) / NULLIF(V.NETO_GRAVADO, 0)) * 100, 0) BETWEEN 4 AND 6   THEN 5.00
            WHEN ROUND((ISNULL(V.IVA_TOTAL, 0) / NULLIF(V.NETO_GRAVADO, 0)) * 100, 0) BETWEEN 1 AND 3   THEN 2.50
            ELSE 0.00
          END AS ALICUOTA
        FROM VENTAS V
        WHERE
          CAST(V.FECHA_VENTA AS DATE) BETWEEN @fechaDesde AND @fechaHasta
          AND ISNULL(V.ERROR_FE, 'N') = 'N'
          AND V.NUMERO_FISCAL IS NOT NULL
          AND LEN(V.NUMERO_FISCAL) > 0
          AND (@puntoVentaId IS NULL OR V.PUNTO_VENTA_ID = @puntoVentaId)
          AND (@tipoComprobante IS NULL OR V.TIPO_COMPROBANTE = @tipoComprobante)
          AND (@incluirNoCobradas = 1 OR V.COBRADA = 1)
      )
      SELECT
        ALICUOTA,
        CASE ALICUOTA
          WHEN 0     THEN '0% - No Gravado/Exento'
          WHEN 2.50  THEN '2,5%'
          WHEN 5.00  THEN '5%'
          WHEN 10.50 THEN '10,5%'
          WHEN 21.00 THEN '21%'
          WHEN 27.00 THEN '27%'
          ELSE CAST(ALICUOTA AS NVARCHAR) + '%'
        END AS ALICUOTA_DESCRIPCION,
        COUNT(*) AS CANTIDAD_COMPROBANTES,
        SUM(
          CASE WHEN TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(NETO_GRAVADO)
               ELSE NETO_GRAVADO END
        ) AS BASE_IMPONIBLE,
        SUM(
          CASE WHEN TIPO_COMPROBANTE LIKE 'NC%' THEN -ABS(IVA_TOTAL)
               ELSE IVA_TOTAL END
        ) AS DEBITO_FISCAL
      FROM VentasConAlicuota
      GROUP BY ALICUOTA
      ORDER BY ALICUOTA DESC
    `);

    return result.recordset;
  },

  // ── Puntos de venta activos ──────────────────────
  async getPuntosDeVenta() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT PUNTO_VENTA_ID, NOMBRE
      FROM PUNTO_VENTAS
      WHERE ACTIVO = 1
      ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Exportar CITI Ventas (AFIP RG 3685/2014) ────
  async exportCitiVentas(filter: LibroIvaFilter) {
    const comprobantes = await this.getComprobantes(filter);

    let cbteLines = '';
    let alicLines = '';

    for (const row of comprobantes) {
      const fecha = new Date(row.FECHA).toISOString().slice(0, 10).replace(/-/g, '');
      const tipoComp = String(row.CODIGO_COMPROBANTE_AFIP).padStart(3, '0');
      const pv = String(row.PUNTO_VENTA_ID).padStart(5, '0');
      const numCbte = (row.NUMERO_FISCAL || '0').padStart(20, '0');
      const tipoDoc = String(row.TIPO_DOC_CLIENTE).padStart(2, '0');
      const numDoc = (row.CLIENTE_CUIT || '0').padStart(20, '0');
      const nombre = (row.CLIENTE_NOMBRE || '').padEnd(30).slice(0, 30);

      const total = fmtImporteAFIP(Math.abs(row.TOTAL));
      const netoNG = fmtImporteAFIP(Math.abs(row.NETO_NO_GRAVADO));
      const impInt = fmtImporteAFIP(Math.abs(row.IMPUESTO_INTERNO));
      const cero = fmtImporteAFIP(0);

      cbteLines +=
        fecha + tipoComp + pv + numCbte + numCbte +
        tipoDoc + numDoc + nombre +
        total + netoNG +
        cero + cero + cero + cero + cero +
        impInt +
        'PES' + '0001000000' +
        '1' + ' ' + cero + '00000000' + '\n';

      const netoG = fmtImporteAFIP(Math.abs(row.NETO_GRAVADO));
      const codAlic = codigoAlicuotaAFIP(row.ALICUOTA_IVA_ESTIMADA);
      const iva = fmtImporteAFIP(Math.abs(row.IVA_TOTAL));

      alicLines +=
        tipoComp + pv + numCbte +
        netoG + codAlic + iva + '\n';
    }

    return { comprobantes: cbteLines, alicuotas: alicLines };
  },
};

function fmtImporteAFIP(importe: number): string {
  const centavos = Math.round(importe * 100);
  return String(centavos).padStart(15, '0');
}

function codigoAlicuotaAFIP(alicuota: number): string {
  if (alicuota === 0)    return '0003';
  if (alicuota === 2.5)  return '0009';
  if (alicuota === 5)    return '0008';
  if (alicuota === 10.5) return '0004';
  if (alicuota === 21)   return '0005';
  if (alicuota === 27)   return '0006';
  return '0005'; // default 21%
}
