import { getPool, sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  Libro IVA Compras Service
//  Conforme a normativa AFIP Argentina — RG 3685/2014
// ═══════════════════════════════════════════════════

export interface LibroIvaComprasFilter {
  fechaDesde: string;
  fechaHasta: string;
  puntoVentaId?: number;
  tipoComprobante?: string;
  incluirNoCobradas?: boolean;
}

// ── Base CTE reutilizable ────────────────────────
// Une COMPRAS + NC_COMPRAS + ND_COMPRAS con los mismos campos proyectados
const BASE_CTE = `
  WITH ComprasUnion AS (
    -- Facturas de compra
    SELECT
      C.COMPRA_ID,
      CAST(C.FECHA_COMPRA AS DATE)                                        AS FECHA,
      C.TIPO_COMPROBANTE,
      CASE C.TIPO_COMPROBANTE
        WHEN 'A'    THEN '001 - Factura A'
        WHEN 'B'    THEN '006 - Factura B'
        WHEN 'C'    THEN '011 - Factura C'
        WHEN 'NC A' THEN '003 - Nota de Crédito A'
        WHEN 'NC B' THEN '008 - Nota de Crédito B'
        WHEN 'NC C' THEN '013 - Nota de Crédito C'
        WHEN 'ND A' THEN '002 - Nota de Débito A'
        WHEN 'ND B' THEN '007 - Nota de Débito B'
        WHEN 'ND C' THEN '012 - Nota de Débito C'
        ELSE C.TIPO_COMPROBANTE
      END                                                                 AS TIPO_COMPROBANTE_DESCRIPCION,
      CASE C.TIPO_COMPROBANTE
        WHEN 'A'    THEN 1  WHEN 'B'    THEN 6  WHEN 'C'    THEN 11
        WHEN 'NC A' THEN 3  WHEN 'NC B' THEN 8  WHEN 'NC C' THEN 13
        WHEN 'ND A' THEN 2  WHEN 'ND B' THEN 7  WHEN 'ND C' THEN 12
        ELSE 0
      END                                                                 AS CODIGO_COMPROBANTE_AFIP,
      CAST(ISNULL(C.PTO_VTA, '0') AS INT)                                AS PUNTO_VENTA_ID,
      C.NRO_COMPROBANTE                                                   AS NUMERO_FISCAL,
      CAST(NULL AS NVARCHAR(20))                                          AS CAE,
      C.PROVEEDOR_ID,
      ISNULL(C.PERCEPCION_IVA,  0)                                       AS PERCEPCION_IVA,
      ISNULL(C.PERCEPCION_IIBB, 0)                                       AS PERCEPCION_IIBB,
      0                                                                   AS NETO_NO_GRAVADO,
      C.TOTAL - ISNULL(C.IVA_TOTAL,0) - ISNULL(C.IMPUESTO_INTERNO,0)
                - ISNULL(C.PERCEPCION_IVA,0) - ISNULL(C.PERCEPCION_IIBB,0)
                                                                          AS NETO_GRAVADO,
      ISNULL(C.IVA_TOTAL, 0)                                             AS IVA_TOTAL,
      ISNULL(C.IMPUESTO_INTERNO, 0)                                      AS IMPUESTO_INTERNO,
      C.TOTAL,
      C.COBRADA
    FROM COMPRAS C
    WHERE CAST(C.FECHA_COMPRA AS DATE) BETWEEN @fechaDesde AND @fechaHasta
      AND (@puntoVentaId IS NULL OR CAST(ISNULL(C.PTO_VTA,'0') AS INT) = @puntoVentaId)
      AND (@tipoComprobante IS NULL OR C.TIPO_COMPROBANTE = @tipoComprobante)
      AND (@incluirNoCobradas = 1 OR C.COBRADA = 1)

    UNION ALL

    -- Notas de crédito de compras
    SELECT
      NC.NC_ID,
      CAST(NC.FECHA AS DATE),
      NC.TIPO_COMPROBANTE,
      CASE NC.TIPO_COMPROBANTE
        WHEN 'NC A' THEN '003 - Nota de Crédito A'
        WHEN 'NC B' THEN '008 - Nota de Crédito B'
        WHEN 'NC C' THEN '013 - Nota de Crédito C'
        ELSE NC.TIPO_COMPROBANTE
      END,
      CASE NC.TIPO_COMPROBANTE
        WHEN 'NC A' THEN 3  WHEN 'NC B' THEN 8  WHEN 'NC C' THEN 13
        ELSE 0
      END,
      CAST(ISNULL(NC.PUNTO_VENTA,'0') AS INT),
      NC.NUMERO_FISCAL,
      NC.CAE,
      NC.PROVEEDOR_ID,
      0, 0,
      0,
      -ABS(ISNULL(NC.MONTO, 0)),
      0, 0,
      -ABS(ISNULL(NC.MONTO, 0)),
      1
    FROM NC_COMPRAS NC
    WHERE CAST(NC.FECHA AS DATE) BETWEEN @fechaDesde AND @fechaHasta
      AND NC.ANULADA = 0
      AND NC.NUMERO_FISCAL IS NOT NULL
      AND LEN(NC.NUMERO_FISCAL) > 0
      AND (@puntoVentaId IS NULL OR CAST(ISNULL(NC.PUNTO_VENTA,'0') AS INT) = @puntoVentaId)
      AND (@tipoComprobante IS NULL OR NC.TIPO_COMPROBANTE = @tipoComprobante)

    UNION ALL

    -- Notas de débito de compras
    SELECT
      ND.ND_ID,
      CAST(ND.FECHA AS DATE),
      ND.TIPO_COMPROBANTE,
      CASE ND.TIPO_COMPROBANTE
        WHEN 'ND A' THEN '002 - Nota de Débito A'
        WHEN 'ND B' THEN '007 - Nota de Débito B'
        WHEN 'ND C' THEN '012 - Nota de Débito C'
        ELSE ND.TIPO_COMPROBANTE
      END,
      CASE ND.TIPO_COMPROBANTE
        WHEN 'ND A' THEN 2  WHEN 'ND B' THEN 7  WHEN 'ND C' THEN 12
        ELSE 0
      END,
      CAST(ISNULL(ND.PUNTO_VENTA,'0') AS INT),
      ND.NUMERO_FISCAL,
      ND.CAE,
      ND.PROVEEDOR_ID,
      0, 0,
      0,
      ISNULL(ND.MONTO, 0),
      0, 0,
      ISNULL(ND.MONTO, 0),
      1
    FROM ND_COMPRAS ND
    WHERE CAST(ND.FECHA AS DATE) BETWEEN @fechaDesde AND @fechaHasta
      AND ND.ANULADA = 0
      AND ND.NUMERO_FISCAL IS NOT NULL
      AND LEN(ND.NUMERO_FISCAL) > 0
      AND (@puntoVentaId IS NULL OR CAST(ISNULL(ND.PUNTO_VENTA,'0') AS INT) = @puntoVentaId)
      AND (@tipoComprobante IS NULL OR ND.TIPO_COMPROBANTE = @tipoComprobante)
  )
`;

export const libroIvaComprasService = {

  // ── Comprobantes ─────────────────────────────────
  async getComprobantes(filter: LibroIvaComprasFilter) {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde',        sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta',        sql.VarChar(10), filter.fechaHasta)
      .input('puntoVentaId',      sql.Int,         filter.puntoVentaId ?? null)
      .input('tipoComprobante',   sql.VarChar(10), filter.tipoComprobante ?? null)
      .input('incluirNoCobradas', sql.Bit,         filter.incluirNoCobradas ? 1 : 0);

    const result = await req.query(`
      ${BASE_CTE}
      SELECT
        CU.COMPRA_ID,
        CU.FECHA,
        CU.TIPO_COMPROBANTE,
        CU.TIPO_COMPROBANTE_DESCRIPCION,
        CU.CODIGO_COMPROBANTE_AFIP,
        CU.PUNTO_VENTA_ID,
        CU.NUMERO_FISCAL,
        CU.CAE,
        CU.PROVEEDOR_ID,
        ISNULL(P.NOMBRE, 'SIN PROVEEDOR')    AS PROVEEDOR_NOMBRE,
        ISNULL(P.NUMERO_DOC, '00000000000')  AS PROVEEDOR_CUIT,
        ISNULL(P.CONDICION_IVA, 'RESPONSABLE INSCRIPTO') AS PROVEEDOR_CONDICION_IVA,
        CASE
          WHEN LEN(ISNULL(P.NUMERO_DOC,'')) = 11 THEN 80
          WHEN LEN(ISNULL(P.NUMERO_DOC,'')) = 8  THEN 96
          ELSE 99
        END                                  AS TIPO_DOC_PROVEEDOR,
        CU.NETO_NO_GRAVADO,
        CU.NETO_GRAVADO,
        CU.IVA_TOTAL,
        CU.IMPUESTO_INTERNO,
        CU.PERCEPCION_IVA,
        CU.PERCEPCION_IIBB,
        CU.TOTAL,
        CU.COBRADA,
        CASE
          WHEN CU.NETO_GRAVADO > 0 AND CU.IVA_TOTAL > 0
          THEN ROUND((CU.IVA_TOTAL / CU.NETO_GRAVADO) * 100, 2)
          ELSE 0
        END                                  AS ALICUOTA_IVA_ESTIMADA
      FROM ComprasUnion CU
      LEFT JOIN PROVEEDORES P ON CU.PROVEEDOR_ID = P.PROVEEDOR_ID
      ORDER BY CU.FECHA ASC, CU.TIPO_COMPROBANTE, CU.NUMERO_FISCAL
    `);

    return result.recordset;
  },

  // ── Totales generales ────────────────────────────
  async getTotales(filter: LibroIvaComprasFilter) {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde',        sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta',        sql.VarChar(10), filter.fechaHasta)
      .input('puntoVentaId',      sql.Int,         filter.puntoVentaId ?? null)
      .input('tipoComprobante',   sql.VarChar(10), filter.tipoComprobante ?? null)
      .input('incluirNoCobradas', sql.Bit,         filter.incluirNoCobradas ? 1 : 0);

    const result = await req.query(`
      ${BASE_CTE}
      SELECT
        COUNT(*)  AS CANTIDAD_COMPROBANTES,
        SUM(CASE WHEN CU.TIPO_COMPROBANTE NOT LIKE 'NC%' AND CU.TIPO_COMPROBANTE NOT LIKE 'ND%' THEN 1 ELSE 0 END) AS CANTIDAD_FACTURAS,
        SUM(CASE WHEN CU.TIPO_COMPROBANTE LIKE 'NC%' THEN 1 ELSE 0 END) AS CANTIDAD_NC,
        ISNULL(SUM(CU.NETO_NO_GRAVADO),  0) AS TOTAL_NETO_NO_GRAVADO,
        ISNULL(SUM(CU.NETO_GRAVADO),     0) AS TOTAL_NETO_GRAVADO,
        ISNULL(SUM(CU.IVA_TOTAL),        0) AS TOTAL_IVA,
        ISNULL(SUM(CU.IMPUESTO_INTERNO), 0) AS TOTAL_IMPUESTO_INTERNO,
        ISNULL(SUM(CU.PERCEPCION_IVA),   0) AS TOTAL_PERCEPCION_IVA,
        ISNULL(SUM(CU.PERCEPCION_IIBB),  0) AS TOTAL_PERCEPCION_IIBB,
        ISNULL(SUM(CU.TOTAL),            0) AS TOTAL_GENERAL
      FROM ComprasUnion CU
    `);

    return result.recordset[0];
  },

  // ── Totales por alícuota ─────────────────────────
  async getTotalesPorAlicuota(filter: LibroIvaComprasFilter) {
    const pool = await getPool();
    const req = pool.request()
      .input('fechaDesde',        sql.VarChar(10), filter.fechaDesde)
      .input('fechaHasta',        sql.VarChar(10), filter.fechaHasta)
      .input('puntoVentaId',      sql.Int,         filter.puntoVentaId ?? null)
      .input('tipoComprobante',   sql.VarChar(10), filter.tipoComprobante ?? null)
      .input('incluirNoCobradas', sql.Bit,         filter.incluirNoCobradas ? 1 : 0);

    const result = await req.query(`
      ${BASE_CTE},
      ComprasConAlicuota AS (
        SELECT
          CU.TIPO_COMPROBANTE,
          CU.NETO_GRAVADO,
          CU.IVA_TOTAL,
          CASE
            WHEN CU.NETO_GRAVADO = 0 THEN 0
            WHEN ROUND((CU.IVA_TOTAL / NULLIF(CU.NETO_GRAVADO, 0)) * 100, 0) BETWEEN 26 AND 28 THEN 27.00
            WHEN ROUND((CU.IVA_TOTAL / NULLIF(CU.NETO_GRAVADO, 0)) * 100, 0) BETWEEN 20 AND 22 THEN 21.00
            WHEN ROUND((CU.IVA_TOTAL / NULLIF(CU.NETO_GRAVADO, 0)) * 100, 0) BETWEEN 9  AND 12 THEN 10.50
            WHEN ROUND((CU.IVA_TOTAL / NULLIF(CU.NETO_GRAVADO, 0)) * 100, 0) BETWEEN 4  AND 6  THEN 5.00
            WHEN ROUND((CU.IVA_TOTAL / NULLIF(CU.NETO_GRAVADO, 0)) * 100, 0) BETWEEN 1  AND 3  THEN 2.50
            ELSE 0.00
          END AS ALICUOTA
        FROM ComprasUnion CU
        WHERE CU.TIPO_COMPROBANTE NOT LIKE 'NC%'
          AND CU.TIPO_COMPROBANTE NOT LIKE 'ND%'
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
        SUM(NETO_GRAVADO) AS BASE_IMPONIBLE,
        SUM(IVA_TOTAL)    AS CREDITO_FISCAL
      FROM ComprasConAlicuota
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

  // ── Exportar CITI Compras (AFIP RG 3685/2014) ───
  async exportCitiCompras(filter: LibroIvaComprasFilter) {
    const comprobantes = await this.getComprobantes(filter);

    let cbteLines = '';
    let alicLines = '';

    for (const row of comprobantes) {
      const fecha = new Date(row.FECHA).toISOString().slice(0, 10).replace(/-/g, '');
      const tipoComp  = String(row.CODIGO_COMPROBANTE_AFIP).padStart(3, '0');
      const pv        = String(row.PUNTO_VENTA_ID).padStart(5, '0');
      const numCbte   = (row.NUMERO_FISCAL || '0').padStart(20, '0');
      const tipoDoc   = String(row.TIPO_DOC_PROVEEDOR).padStart(2, '0');
      const numDoc    = (row.PROVEEDOR_CUIT || '0').padStart(20, '0');
      const nombre    = (row.PROVEEDOR_NOMBRE || '').padEnd(30).slice(0, 30);

      const total   = fmtImporteAFIP(Math.abs(row.TOTAL));
      const netoNG  = fmtImporteAFIP(Math.abs(row.NETO_NO_GRAVADO));
      const impInt  = fmtImporteAFIP(Math.abs(row.IMPUESTO_INTERNO));
      const percIVA = fmtImporteAFIP(Math.abs(row.PERCEPCION_IVA || 0));
      const percIIBB = fmtImporteAFIP(Math.abs(row.PERCEPCION_IIBB || 0));
      const cero    = fmtImporteAFIP(0);

      cbteLines +=
        fecha + tipoComp + pv + numCbte + numCbte +
        tipoDoc + numDoc + nombre +
        total + netoNG +
        cero + cero +         // percepción NC + exentos
        percIVA +             // percepciones nacionales (IVA)
        percIIBB +            // percepciones IIBB
        cero +                // percepciones municipales
        impInt +
        'PES' + '0001000000' +
        '1' + ' ' + cero + '00000000\n';

      const netoG    = fmtImporteAFIP(Math.abs(row.NETO_GRAVADO));
      const codAlic  = codigoAlicuotaAFIP(row.ALICUOTA_IVA_ESTIMADA);
      const iva      = fmtImporteAFIP(Math.abs(row.IVA_TOTAL));

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
  return '0005';
}
