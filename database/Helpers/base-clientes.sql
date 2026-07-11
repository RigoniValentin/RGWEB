-- Base completa de clientes con métricas de ventas y datos de contacto.
-- SQL Server / SesamoDB

SELECT
    c.CLIENTE_ID,
    c.CODIGOPARTICULAR,
    c.NOMBRE,
    c.TIPO_DOCUMENTO,
    c.NUMERO_DOC,
    c.CONDICION_IVA,
    c.DOMICILIO,
    c.CIUDAD,
    c.PROVINCIA,
    c.TELEFONO,
    c.EMAIL,
    c.RUBRO,
    c.FECHA_NACIMIENTO,
    c.ACTIVO,
    ISNULL(c.CTA_CORRIENTE, 0)                                AS TIENE_CTA_CORRIENTE,
    (SELECT COUNT(*)             FROM VENTAS v WHERE v.CLIENTE_ID = c.CLIENTE_ID) AS CANTIDAD_VENTAS,
    (SELECT ISNULL(SUM(TOTAL),0) FROM VENTAS v WHERE v.CLIENTE_ID = c.CLIENTE_ID) AS TOTAL_COMPRADO
FROM CLIENTES c
ORDER BY c.NOMBRE;