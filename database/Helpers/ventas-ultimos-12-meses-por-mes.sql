-- Ventas de los últimos 12 meses, agrupadas por mes calendario.
-- Incluye el mes actual aunque esté incompleto.
-- SQL Server / SesamoDB

DECLARE @FECHA_DESDE DATETIME = DATEADD(MONTH, -11, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1));
DECLARE @FECHA_HASTA DATETIME = DATEADD(DAY, 1, EOMONTH(GETDATE()));

SELECT
    YEAR(v.FECHA_VENTA)                              AS ANIO,
    MONTH(v.FECHA_VENTA)                             AS MES,
    FORMAT(v.FECHA_VENTA, 'yyyy-MM')                 AS PERIODO,
    DATENAME(MONTH, v.FECHA_VENTA)                   AS NOMBRE_MES,
    COUNT(*)                                         AS CANTIDAD_VENTAS,
    ISNULL(SUM(v.TOTAL), 0)                          AS TOTAL_VENDIDO,
    ISNULL(SUM(v.GANANCIAS), 0)                      AS GANANCIA,
    ISNULL(AVG(NULLIF(v.TOTAL, 0)), 0)               AS TICKET_PROMEDIO
FROM VENTAS v
WHERE v.FECHA_VENTA >= @FECHA_DESDE
  AND v.FECHA_VENTA <  @FECHA_HASTA
GROUP BY YEAR(v.FECHA_VENTA),
         MONTH(v.FECHA_VENTA),
         FORMAT(v.FECHA_VENTA, 'yyyy-MM'),
         DATENAME(MONTH, v.FECHA_VENTA)
ORDER BY ANIO, MES;