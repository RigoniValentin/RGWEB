-- =============================================================================
-- REVERSIÓN: Eliminar ajuste TRANSFERENCIA_FC de reconciliación histórica
-- =============================================================================
-- Qué hace este script:
--   1. Busca y elimina el registro TRANSFERENCIA_FC insertado por el script
--      de reconciliación (reconciliar-balance-metodos-cajaCentral.sql).
--   2. Muestra el estado resultante de Balance vs Métodos.
--
-- IMPORTANTE sobre el UPDATE de CIERRE_CAJA (Paso 4 del script original):
--   Ese UPDATE corrigió EFECTIVO = TOTAL - DIGITAL - CHEQUES - CTA_CTE en
--   registros viejos. ESE cambio NO se revierte aquí porque:
--     a) Los valores originales no se pueden recuperar sin un backup previo.
--     b) El valor nuevo ES el correcto (el original estaba mal, incluía el
--        fondo de apertura inflando el efectivo).
--   Si necesitás revertir también esos CIERRE_CAJA, restaurá desde backup.
-- =============================================================================

BEGIN TRANSACTION;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONFIGURACIÓN
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @PV_ID INT = 1;  -- Ajustar según el punto de venta

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1: Verificar que el ajuste existe
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @ajusteId   INT;
DECLARE @ajusteEfectivo DECIMAL(18,2);

SELECT TOP 1
    @ajusteId       = ID,
    @ajusteEfectivo = EFECTIVO
FROM MOVIMIENTOS_CAJA
WHERE  TIPO_ENTIDAD   IN ('REINTEGRO_FONDO', 'TRANSFERENCIA_FC')
  AND  MOVIMIENTO     LIKE 'Reconciliaci%hist%rica%'
  AND  PUNTO_VENTA_ID = @PV_ID
  AND  FECHA          = '2000-01-01T00:00:00'
  AND  ES_MANUAL      = 1;

IF @ajusteId IS NULL
BEGIN
    PRINT '  No se encontró ningún ajuste de reconciliación para PV ' + CAST(@PV_ID AS VARCHAR(5)) + '.';
    PRINT '  No hay nada que revertir.';
    ROLLBACK TRANSACTION;
    RETURN;
END

PRINT '  Ajuste encontrado — ID: ' + CAST(@ajusteId AS VARCHAR(10)) + '  EFECTIVO: $' + CAST(@ajusteEfectivo AS VARCHAR(30));

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: Eliminar el ajuste
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM MOVIMIENTOS_CAJA
WHERE  ID = @ajusteId;

PRINT '✓ Ajuste eliminado (ID ' + CAST(@ajusteId AS VARCHAR(10)) + ').';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3: Verificar estado resultante (Balance vs Métodos)
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @FC_TYPES NVARCHAR(200) = '(''TRANSFERENCIA_FC'', ''REINTEGRO_FONDO'', ''DEPOSITO_FONDO'')';

DECLARE @balance  DECIMAL(18,2);
DECLARE @digital  DECIMAL(18,2);
DECLARE @cheques  DECIMAL(18,2);
DECLARE @efectivo DECIMAL(18,2);

SELECT
    @balance = ISNULL(SUM(TOTAL),   0),
    @digital = ISNULL(SUM(DIGITAL), 0),
    @cheques = ISNULL(SUM(CHEQUES), 0)
FROM MOVIMIENTOS_CAJA
WHERE (
          PUNTO_VENTA_ID = @PV_ID
      OR (TIPO_ENTIDAD = 'CHEQUE' AND PUNTO_VENTA_ID IS NULL)
      OR (TIPO_ENTIDAD IN ('COMPRA', 'ORDEN_PAGO', 'COBRANZA')
          AND PUNTO_VENTA_ID IS NULL AND ISNULL(CHEQUES, 0) <> 0)
      )
  AND TIPO_ENTIDAD NOT IN ('TRANSFERENCIA_FC', 'REINTEGRO_FONDO', 'DEPOSITO_FONDO');

SELECT @efectivo = ISNULL(SUM(EFECTIVO), 0)
FROM MOVIMIENTOS_CAJA
WHERE (
          PUNTO_VENTA_ID = @PV_ID
      OR (TIPO_ENTIDAD = 'CHEQUE' AND PUNTO_VENTA_ID IS NULL)
      OR (TIPO_ENTIDAD IN ('COMPRA', 'ORDEN_PAGO', 'COBRANZA')
          AND PUNTO_VENTA_ID IS NULL AND ISNULL(CHEQUES, 0) <> 0)
      );

DECLARE @metodos    DECIMAL(18,2) = @efectivo + @digital + @cheques;
DECLARE @diferencia DECIMAL(18,2) = @balance - @metodos;

PRINT '';
PRINT '=== ESTADO DESPUÉS DE LA REVERSIÓN ===';
PRINT '  Balance:    $' + CAST(@balance    AS VARCHAR(30));
PRINT '  Métodos:    $' + CAST(@metodos    AS VARCHAR(30));
PRINT '  Diferencia: $' + CAST(@diferencia AS VARCHAR(30));
PRINT CASE
    WHEN @diferencia = 0
    THEN '✓ Balance = Métodos. La corrección de CIERRE_CAJA fue suficiente.'
    ELSE '⚠ Diferencia residual de $' + CAST(@diferencia AS VARCHAR(30)) + '. '
       + 'Esto indica que el ajuste era necesario para cerrar el balance histórico. '
       + 'Podés volver a ejecutar reconciliar-balance-metodos-cajaCentral.sql para restaurarlo.'
END;

COMMIT TRANSACTION;
