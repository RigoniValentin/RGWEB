-- Ventas agrupadas por sucursal (Punto de Venta).
-- Filtra por BANDA NORTE y CENTRO. Ajustar @PV_NOMBRES si los nombres difieren.
-- SQL Server / SesamoDB

DECLARE @PV_NOMBRES NVARCHAR(MAX) = N'BANDA NORTE,CENTRO';

SELECT
    pv.PUNTO_VENTA_ID,
    pv.NOMBRE                                  AS SUCURSAL,
    COUNT(*)                                   AS CANTIDAD_VENTAS,
    ISNULL(SUM(v.TOTAL), 0)                    AS TOTAL_VENDIDO,
    ISNULL(SUM(v.GANANCIAS), 0)                AS GANANCIA,
    ISNULL(AVG(NULLIF(v.TOTAL, 0)), 0)         AS TICKET_PROMEDIO
FROM VENTAS v
JOIN PUNTO_VENTAS pv ON v.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
WHERE pv.NOMBRE IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@PV_NOMBRES, ','))
GROUP BY pv.PUNTO_VENTA_ID, pv.NOMBRE
ORDER BY TOTAL_VENDIDO DESC;