-- ============================================================================
-- Fix: Asignar ventas de hoy a la sesión/caja activa
-- ============================================================================
-- Ejecutar DESPUÉS de aplicar el fix en sales.service.ts (helper getCajaAbiertaTx
-- + INSERT en CAJA_ITEMS/MOVIMIENTOS_CAJA con SESION_ID y CAJA_ID).
--
-- Para cada venta de HOY, reconstruye los efectos en CAJA_ITEMS y
-- MOVIMIENTOS_CAJA como si el fix hubiera estado activo cuando se hizo:
--
--   1. Match histórico: sesión cuya FECHA_APERTURA <= VENTA.FECHA_VENTA <= FECHA_CIERRE
--   2. Fallback:        sesión activa actualmente del mismo usuario
--   3. UPDATE CAJA_ITEMS (ORIGEN_TIPO='VENTA') → set SESION_ID + CAJA_ID
--   4. INSERT CAJA_ITEMS faltantes (deriva MONTO_EFECTIVO y MONTO_DIGITAL desde
--      VENTAS_METODOS_PAGO por categoría)
--   5. UPDATE MOVIMIENTOS_CAJA (TIPO_ENTIDAD='VENTA') → set CAJA_ID
--      (cheques de venta)
--
-- El script es transaccional: revisar el output antes de COMMIT.
-- Si algo sale mal, ejecutar ROLLBACK manualmente.
-- ============================================================================

BEGIN TRAN;

DECLARE @hoy DATE = CAST(GETDATE() AS DATE);
DECLARE @cntSesiones INT, @cntCajas INT;
DECLARE @cntItemsUpdated INT, @cntItemsInserted INT, @cntMovsUpdated INT;

PRINT '=========================================================';
PRINT 'Fix ventas hoy: ' + CAST(@hoy AS VARCHAR(10));
PRINT '=========================================================';

-- ── 1) Tabla auxiliar: para cada venta de hoy, qué SESION_ID y CAJA_ID ──
DROP TABLE IF EXISTS #venta_sesion;
CREATE TABLE #venta_sesion (
  VENTA_ID   INT PRIMARY KEY,
  USUARIO_ID INT,
  SESION_ID  INT,
  CAJA_ID    INT
);

-- 1a) Match histórico: sesión abierta al momento de la venta
--     Si hay varias sesiones que cubren la venta (apertura + cierre reabierto),
--     elegimos la de FECHA_APERTURA más reciente (la que estaba "en uso").
INSERT INTO #venta_sesion (VENTA_ID, USUARIO_ID, SESION_ID, CAJA_ID)
SELECT VENTA_ID, USUARIO_ID, SESION_ID, CAJA_ID
FROM (
  SELECT v.VENTA_ID, v.USUARIO_ID, cs.SESION_ID, cs.CAJA_ID,
    ROW_NUMBER() OVER (
      PARTITION BY v.VENTA_ID
      ORDER BY cs.FECHA_APERTURA DESC, cs.SESION_ID DESC
    ) AS rn
  FROM VENTAS v
  INNER JOIN CAJA_SESIONES cs
    ON cs.USUARIO_ID = v.USUARIO_ID
    AND cs.FECHA_APERTURA <= v.FECHA_VENTA
    AND (cs.FECHA_CIERRE IS NULL OR cs.FECHA_CIERRE >= v.FECHA_VENTA)
  WHERE CAST(v.FECHA_VENTA AS DATE) = @hoy
) ranked
WHERE rn = 1;

-- 1b) Fallback: sesión activa actual del mismo usuario (para ventas sin match histórico)
--     Si por inconsistencia hubiera varias activas, elegimos la más reciente.
INSERT INTO #venta_sesion (VENTA_ID, USUARIO_ID, SESION_ID, CAJA_ID)
SELECT VENTA_ID, USUARIO_ID, SESION_ID, CAJA_ID
FROM (
  SELECT v.VENTA_ID, v.USUARIO_ID, cs.SESION_ID, cs.CAJA_ID,
    ROW_NUMBER() OVER (
      PARTITION BY v.VENTA_ID
      ORDER BY cs.SESION_ID DESC
    ) AS rn
  FROM VENTAS v
  INNER JOIN CAJA_SESIONES cs
    ON cs.USUARIO_ID = v.USUARIO_ID AND cs.ESTADO = 'ACTIVA'
  WHERE CAST(v.FECHA_VENTA AS DATE) = @hoy
    AND NOT EXISTS (SELECT 1 FROM #venta_sesion vs WHERE vs.VENTA_ID = v.VENTA_ID)
) ranked
WHERE rn = 1;

-- Reporte: ventas sin sesión asignable
PRINT '';
PRINT '── Ventas sin sesión asignable (no se procesaron) ──';
SELECT v.VENTA_ID, v.USUARIO_ID, v.FECHA_VENTA, v.TOTAL, v.ES_CTA_CORRIENTE
FROM VENTAS v
WHERE CAST(v.FECHA_VENTA AS DATE) = @hoy
  AND NOT EXISTS (SELECT 1 FROM #venta_sesion vs WHERE vs.VENTA_ID = v.VENTA_ID);

-- ── 2) UPDATE CAJA_ITEMS existentes (fix SESION_ID + CAJA_ID) ──
UPDATE ci SET
  ci.SESION_ID = vs.SESION_ID,
  ci.CAJA_ID   = vs.CAJA_ID
FROM CAJA_ITEMS ci
INNER JOIN #venta_sesion vs ON vs.VENTA_ID = ci.ORIGEN_ID
WHERE ci.ORIGEN_TIPO = 'VENTA'
  AND ci.SESION_ID IS NULL;
SET @cntItemsUpdated = @@ROWCOUNT;

-- ── 3) INSERT CAJA_ITEMS faltantes ──
--    Para ventas sin item (p.ej. si la sesión estaba cerrada cuando se creó
--    y el código viejo skipeó el insert). Deriva EFECTIVO/DIGITAL desde
--    VENTAS_METODOS_PAGO por categoría.
--    Solo crea el item si hay efectivo o digital > 0 (mismo criterio que el código).
INSERT INTO CAJA_ITEMS (
  SESION_ID, CAJA_ID, FECHA, ORIGEN_TIPO, ORIGEN_ID,
  MONTO_EFECTIVO, MONTO_DIGITAL, DESCRIPCION, USUARIO_ID
)
SELECT
  vs.SESION_ID, vs.CAJA_ID, v.FECHA_VENTA, 'VENTA', v.VENTA_ID,
  ISNULL((
    SELECT SUM(vmp.MONTO)
    FROM VENTAS_METODOS_PAGO vmp
    INNER JOIN METODOS_PAGO mp ON mp.METODO_PAGO_ID = vmp.METODO_PAGO_ID
    WHERE vmp.VENTA_ID = v.VENTA_ID AND mp.CATEGORIA = 'EFECTIVO'
  ), 0) AS MONTO_EFECTIVO,
  ISNULL((
    SELECT SUM(vmp.MONTO)
    FROM VENTAS_METODOS_PAGO vmp
    INNER JOIN METODOS_PAGO mp ON mp.METODO_PAGO_ID = vmp.METODO_PAGO_ID
    WHERE vmp.VENTA_ID = v.VENTA_ID AND mp.CATEGORIA = 'DIGITAL'
  ), 0) AS MONTO_DIGITAL,
  'Venta #' + CAST(v.VENTA_ID AS VARCHAR(20)),
  v.USUARIO_ID
FROM VENTAS v
INNER JOIN #venta_sesion vs ON vs.VENTA_ID = v.VENTA_ID
WHERE CAST(v.FECHA_VENTA AS DATE) = @hoy
  AND v.ES_CTA_CORRIENTE = 0
  AND NOT EXISTS (
    SELECT 1 FROM CAJA_ITEMS ci
    WHERE ci.ORIGEN_TIPO = 'VENTA' AND ci.ORIGEN_ID = v.VENTA_ID
  )
  AND (
    EXISTS (
      SELECT 1 FROM VENTAS_METODOS_PAGO vmp
      INNER JOIN METODOS_PAGO mp ON mp.METODO_PAGO_ID = vmp.METODO_PAGO_ID
      WHERE vmp.VENTA_ID = v.VENTA_ID AND mp.CATEGORIA IN ('EFECTIVO','DIGITAL')
    )
  );
SET @cntItemsInserted = @@ROWCOUNT;

-- ── 4) UPDATE MOVIMIENTOS_CAJA (cheques de venta) ──
UPDATE mc SET
  mc.CAJA_ID = vs.CAJA_ID
FROM MOVIMIENTOS_CAJA mc
INNER JOIN #venta_sesion vs ON vs.VENTA_ID = mc.ID_ENTIDAD
WHERE mc.TIPO_ENTIDAD = 'VENTA'
  AND mc.CAJA_ID IS NULL;
SET @cntMovsUpdated = @@ROWCOUNT;

-- ── 5) Reporte final ──
SELECT @cntSesiones = COUNT(DISTINCT SESION_ID), @cntCajas = COUNT(DISTINCT CAJA_ID)
FROM #venta_sesion;

PRINT '';
PRINT '── Resumen ──';
PRINT 'Ventas de hoy procesadas:    ' + CAST(@@ROWCOUNT AS VARCHAR);
PRINT 'Sesiones afectadas:          ' + CAST(@cntSesiones AS VARCHAR);
PRINT 'Cajas afectadas:             ' + CAST(@cntCajas AS VARCHAR);
PRINT 'CAJA_ITEMS actualizadas:     ' + CAST(@cntItemsUpdated AS VARCHAR);
PRINT 'CAJA_ITEMS insertadas:       ' + CAST(@cntItemsInserted AS VARCHAR);
PRINT 'MOVIMIENTOS_CAJA actualiz.:  ' + CAST(@cntMovsUpdated AS VARCHAR);

-- Detalle para inspección
PRINT '';
PRINT '── Detalle por venta ──';
SELECT
  v.VENTA_ID,
  v.FECHA_VENTA,
  v.USUARIO_ID,
  vs.SESION_ID,
  vs.CAJA_ID,
  v.TOTAL,
  (SELECT COUNT(*) FROM CAJA_ITEMS ci WHERE ci.ORIGEN_TIPO='VENTA' AND ci.ORIGEN_ID=v.VENTA_ID) AS CAJA_ITEMS,
  (SELECT COUNT(*) FROM MOVIMIENTOS_CAJA mc WHERE mc.TIPO_ENTIDAD='VENTA' AND mc.ID_ENTIDAD=v.VENTA_ID) AS MOVS_CHEQUES
FROM VENTAS v
INNER JOIN #venta_sesion vs ON vs.VENTA_ID = v.VENTA_ID
WHERE CAST(v.FECHA_VENTA AS DATE) = @hoy
ORDER BY v.FECHA_VENTA;

DROP TABLE #venta_sesion;

-- COMMIT;  -- ⚠️ Descomentar después de revisar el output
-- Si algo está mal:
-- ROLLBACK;

PRINT '';
PRINT '=========================================================';
PRINT '⚠️  Transacción abierta. Revisar output y ejecutar';
PRINT '    COMMIT   →   para confirmar';
PRINT '    ROLLBACK →   para revertir';
PRINT '=========================================================';