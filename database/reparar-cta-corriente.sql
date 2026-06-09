/* =====================================================================
   REPARACIÓN DE CUENTAS CORRIENTES (clientes + proveedores)
   ---------------------------------------------------------------------
   Soluciona los efectos de los bugs corregidos en:
     - backend/src/services/sales.service.ts        (update)
     - backend/src/services/purchases.service.ts    (update / delete)
     - backend/src/services/ctaCorriente.service.ts (imputaciones)
     - backend/src/services/ctaCorrienteProv.service.ts (imputaciones)

   QUÉ HACE
   1. Migra filas huérfanas en VENTAS_CTA_CORRIENTE con
      TIPO_COMPROBANTE='VENTA' (creadas por el update bugueado) al
      TIPO_COMPROBANTE real de la venta (Fa.A/B/C) y borra duplicados.
   2. Recalcula el flag COBRADA en VENTAS y COMPRAS contemplando tanto
      IMPUTACIONES_PAGOS(_P) como las filas HABER de pago directo
      (TIPO_COMPROBANTE='PAGO').

   SEGURIDAD
   - Idempotente: se puede correr varias veces.
   - Wrap en TRAN; revisa los SELECT de control y luego COMMIT.
   - HACER BACKUP previo.
   ===================================================================== */

SET XACT_ABORT ON;
SET NOCOUNT ON;
BEGIN TRAN;

/* ---------------------------------------------------------------------
   1) Migrar filas 'VENTA' huérfanas al TIPO real (Fa.A/B/C)
   ---------------------------------------------------------------------
   El bug insertaba la fila VENTAS_CTA_CORRIENTE con TIPO='VENTA'
   (invisible para cobranzas) además de la fila original Fa.x.
   Estrategia:
     a) Si ya existe una fila Fa.x para esa venta → borrar la 'VENTA' duplicada.
     b) Si NO existe Fa.x (caso patológico: update ejecutado tras delete fallido,
        o sales sin Fa.x histórico) → convertir la 'VENTA' al TIPO real (de VENTAS).
   --------------------------------------------------------------------- */

-- Reporte previo
SELECT
  'VENTA orphan rows antes de reparar' AS info,
  COUNT(*) AS total
FROM VENTAS_CTA_CORRIENTE
WHERE TIPO_COMPROBANTE = 'VENTA';

;WITH ventaRows AS (
  SELECT
    vcc.COMPROBANTE_ID,
    vcc.TIPO_COMPROBANTE,
    v.TIPO_COMPROBANTE AS TIPO_REAL
  FROM VENTAS_CTA_CORRIENTE vcc
  INNER JOIN VENTAS v ON v.VENTA_ID = vcc.COMPROBANTE_ID
  WHERE vcc.TIPO_COMPROBANTE = 'VENTA'
)
-- a) Borrar 'VENTA' duplicadas (ya existe la Fa.x correspondiente)
DELETE vcc
FROM VENTAS_CTA_CORRIENTE vcc
INNER JOIN ventaRows vr
  ON vr.COMPROBANTE_ID = vcc.COMPROBANTE_ID
WHERE vcc.TIPO_COMPROBANTE = 'VENTA'
  AND EXISTS (
    SELECT 1 FROM VENTAS_CTA_CORRIENTE x
    WHERE x.COMPROBANTE_ID = vcc.COMPROBANTE_ID
      AND x.TIPO_COMPROBANTE = vr.TIPO_REAL
  );

-- b) Convertir 'VENTA' restantes al TIPO_COMPROBANTE real de la venta
UPDATE vcc
SET vcc.TIPO_COMPROBANTE = v.TIPO_COMPROBANTE,
    vcc.CONCEPTO = CONCAT('Venta ', v.TIPO_COMPROBANTE, ' - ', v.VENTA_ID)
FROM VENTAS_CTA_CORRIENTE vcc
INNER JOIN VENTAS v ON v.VENTA_ID = vcc.COMPROBANTE_ID
WHERE vcc.TIPO_COMPROBANTE = 'VENTA';

SELECT
  'VENTA orphan rows después de reparar' AS info,
  COUNT(*) AS total
FROM VENTAS_CTA_CORRIENTE
WHERE TIPO_COMPROBANTE = 'VENTA';

/* ---------------------------------------------------------------------
   2) Lo mismo para COMPRAS (en caso de filas 'COMPRA' huérfanas)
   --------------------------------------------------------------------- */
SELECT
  'COMPRA orphan rows antes de reparar' AS info,
  COUNT(*) AS total
FROM COMPRAS_CTA_CORRIENTE
WHERE TIPO_COMPROBANTE = 'COMPRA';

;WITH compraRows AS (
  SELECT
    ccc.COMPROBANTE_ID,
    ccc.TIPO_COMPROBANTE,
    c.TIPO_COMPROBANTE AS TIPO_REAL
  FROM COMPRAS_CTA_CORRIENTE ccc
  INNER JOIN COMPRAS c ON c.COMPRA_ID = ccc.COMPROBANTE_ID
  WHERE ccc.TIPO_COMPROBANTE = 'COMPRA'
)
DELETE ccc
FROM COMPRAS_CTA_CORRIENTE ccc
INNER JOIN compraRows cr
  ON cr.COMPROBANTE_ID = ccc.COMPROBANTE_ID
WHERE ccc.TIPO_COMPROBANTE = 'COMPRA'
  AND EXISTS (
    SELECT 1 FROM COMPRAS_CTA_CORRIENTE x
    WHERE x.COMPROBANTE_ID = ccc.COMPROBANTE_ID
      AND x.TIPO_COMPROBANTE = cr.TIPO_REAL
  );

UPDATE ccc
SET ccc.TIPO_COMPROBANTE = c.TIPO_COMPROBANTE,
    ccc.CONCEPTO = CONCAT('Compra ', c.TIPO_COMPROBANTE, ' - ', c.COMPRA_ID)
FROM COMPRAS_CTA_CORRIENTE ccc
INNER JOIN COMPRAS c ON c.COMPRA_ID = ccc.COMPROBANTE_ID
WHERE ccc.TIPO_COMPROBANTE = 'COMPRA';

SELECT
  'COMPRA orphan rows después de reparar' AS info,
  COUNT(*) AS total
FROM COMPRAS_CTA_CORRIENTE
WHERE TIPO_COMPROBANTE = 'COMPRA';

/* ---------------------------------------------------------------------
   3) Recalcular flag COBRADA en VENTAS de cta corriente
   ---------------------------------------------------------------------
   COBRADA=1 cuando DEBE de la fila Fa.x <= Σ(MONTO_IMPUTADO) + Σ(HABER 'PAGO')
   --------------------------------------------------------------------- */
UPDATE v
SET v.COBRADA = CASE 
    WHEN vcc.DEBE <= ISNULL(ip.TOTAL_IMP, 0) + ISNULL(pago.TOTAL_PAGO, 0) + 1 THEN 1
    ELSE 0
  END
FROM VENTAS v
INNER JOIN VENTAS_CTA_CORRIENTE vcc ON vcc.COMPROBANTE_ID = v.VENTA_ID
LEFT JOIN (
  SELECT VENTA_ID, TIPO_COMPROBANTE, SUM(MONTO_IMPUTADO) AS TOTAL_IMP
  FROM IMPUTACIONES_PAGOS
  GROUP BY VENTA_ID, TIPO_COMPROBANTE
) ip ON ip.VENTA_ID = vcc.COMPROBANTE_ID AND ip.TIPO_COMPROBANTE = vcc.TIPO_COMPROBANTE
LEFT JOIN (
  SELECT COMPROBANTE_ID, SUM(HABER) AS TOTAL_PAGO
  FROM VENTAS_CTA_CORRIENTE
  WHERE TIPO_COMPROBANTE = 'PAGO'
  GROUP BY COMPROBANTE_ID
) pago ON pago.COMPROBANTE_ID = vcc.COMPROBANTE_ID
WHERE v.ES_CTA_CORRIENTE = 1
  AND vcc.TIPO_COMPROBANTE IN ('Fa.A','Fa.B','Fa.C','Nd.A','Nd.B','Nd.C');

/* ---------------------------------------------------------------------
   4) Recalcular flag COBRADA en COMPRAS de cta corriente
   --------------------------------------------------------------------- */
UPDATE c
SET c.COBRADA = CASE 
    WHEN ccc.DEBE <= ISNULL(ip.TOTAL_IMP, 0) + ISNULL(pago.TOTAL_PAGO, 0) + 1 THEN 1
    ELSE 0
  END
FROM COMPRAS c
INNER JOIN COMPRAS_CTA_CORRIENTE ccc ON ccc.COMPROBANTE_ID = c.COMPRA_ID
LEFT JOIN (
  SELECT COMPRA_ID, TIPO_COMPROBANTE, SUM(MONTO_IMPUTADO) AS TOTAL_IMP
  FROM IMPUTACIONES_PAGOS_P
  GROUP BY COMPRA_ID, TIPO_COMPROBANTE
) ip ON ip.COMPRA_ID = ccc.COMPROBANTE_ID AND ip.TIPO_COMPROBANTE = ccc.TIPO_COMPROBANTE
LEFT JOIN (
  SELECT COMPROBANTE_ID, SUM(HABER) AS TOTAL_PAGO
  FROM COMPRAS_CTA_CORRIENTE
  WHERE TIPO_COMPROBANTE = 'PAGO'
  GROUP BY COMPROBANTE_ID
) pago ON pago.COMPROBANTE_ID = ccc.COMPROBANTE_ID
WHERE c.ES_CTA_CORRIENTE = 1
  AND ccc.TIPO_COMPROBANTE IN ('FA','FB','FC','Fa.A','Fa.B','Fa.C','Nd.A','Nd.B','Nd.C','X','R');

/* ---------------------------------------------------------------------
   5) Resumen final
   --------------------------------------------------------------------- */
SELECT 'VENTAS cta cte - pendientes (COBRADA=0)' AS info,
       COUNT(*) AS total
FROM VENTAS WHERE ES_CTA_CORRIENTE = 1 AND COBRADA = 0;

SELECT 'COMPRAS cta cte - pendientes (COBRADA=0)' AS info,
       COUNT(*) AS total
FROM COMPRAS WHERE ES_CTA_CORRIENTE = 1 AND COBRADA = 0;

-- Revisar los resultados arriba antes de confirmar:
-- COMMIT TRAN;
-- ROLLBACK TRAN;

PRINT 'Script ejecutado. Revisar resultados y luego ejecutar COMMIT TRAN; o ROLLBACK TRAN;';
