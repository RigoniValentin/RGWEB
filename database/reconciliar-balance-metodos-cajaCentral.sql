-- =============================================================================
-- RECONCILIACIÓN: Igualar "Balance" y "Métodos" en Caja Central
-- =============================================================================
-- Precondiciones obligatorias:
--   ✓ Fondo de Cambio con saldo $0 (sin efectivo en fondo ni en retiro inicial)
--   ✓ No hay cajas abiertas (ESTADO != 'ACTIVA')
--   ✓ Ya fue desplegado el fix de backend (Balance excluye FC y Métodos incluye
--     el efectivo movido por FC en cajaCentral.service.ts)
--
-- Qué hace este script:
--   1. Verifica las precondiciones.
--   2. Elimina el registro de reconciliación anterior (versión vieja del script)
--      si existe.
--   3. Corrige registros CIERRE_CAJA viejos donde EFECTIVO fue grabado como
--      EFECTIVO_TOTAL (ventas + fondo de apertura) en lugar de EFECTIVO_REAL.
--      Fórmula: EFECTIVO_REAL = TOTAL - DIGITAL - CHEQUES - CTA_CTE
--      Solo modifica filas donde la suma de columnas difiere de TOTAL.
--   4. Verifica Balance = Métodos (Balance excluye FC; Métodos incluye el
--      efectivo movido por FC).
--   5. Si con Fondo de Cambio en $0 queda una diferencia histórica, inserta un
--      ajuste TRANSFERENCIA_FC con TOTAL = 0 para normalizar el legado.
-- =============================================================================

BEGIN TRANSACTION;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONFIGURACIÓN: ajustar según el punto de venta a reconciliar
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @PV_ID   INT = 1;  -- 1 = BANDA NORTE

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1: Verificar precondición — fondo de cambio en $0
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @fondoSaldo DECIMAL(18,2) = 0;

SELECT TOP 1 @fondoSaldo = ISNULL(fc.SALDO_RESULTANTE, 0)
FROM   FONDO_CAMBIO fc
WHERE  fc.PUNTO_VENTA_ID = @PV_ID
ORDER  BY fc.ID DESC;

IF ISNULL(@fondoSaldo, 0) <> 0
BEGIN
    DECLARE @msgFondo NVARCHAR(500) = 'Precondicion fallida: el Fondo de Cambio tiene saldo $' + CAST(@fondoSaldo AS VARCHAR(20)) + ' para el PV ' + CAST(@PV_ID AS VARCHAR(5)) + '. El fondo debe estar en $0 antes de ejecutar este script.';
    RAISERROR(@msgFondo, 16, 1);
    ROLLBACK TRANSACTION;
    RETURN;
END

PRINT '✓ Fondo de Cambio = $0';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: Verificar precondición — sin cajas abiertas
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @cajasActivas INT = 0;

SELECT @cajasActivas = COUNT(*)
FROM   CAJA
WHERE  PUNTO_VENTA_ID = @PV_ID
  AND  ESTADO = 'ACTIVA';

IF @cajasActivas > 0
BEGIN
    DECLARE @msgCajas NVARCHAR(500) = 'Precondicion fallida: hay ' + CAST(@cajasActivas AS VARCHAR(5)) + ' caja(s) activa(s) para el PV ' + CAST(@PV_ID AS VARCHAR(5)) + '. Cerrar todas las cajas antes de ejecutar.';
    RAISERROR(@msgCajas, 16, 1);
    ROLLBACK TRANSACTION;
    RETURN;
END

PRINT '✓ Sin cajas activas';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3: Limpiar registro de reconciliación anterior (versión vieja del script)
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @eliminados INT = 0;

DELETE FROM MOVIMIENTOS_CAJA
WHERE  TIPO_ENTIDAD   IN ('REINTEGRO_FONDO', 'TRANSFERENCIA_FC')
  AND  MOVIMIENTO     LIKE 'Reconciliaci%hist%rica%'
  AND  PUNTO_VENTA_ID = @PV_ID
  AND  FECHA          = '2000-01-01T00:00:00'
  AND  ES_MANUAL      = 1;

SET @eliminados = @@ROWCOUNT;
IF @eliminados > 0
    PRINT '  Eliminados ' + CAST(@eliminados AS VARCHAR(5)) + ' registro(s) de reconciliación anterior.';
ELSE
    PRINT '  No había registros de reconciliación anterior.';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 4: Corregir CIERRE_CAJA con EFECTIVO inconsistente
--
--   Registros viejos (pre-mecanismo REINTEGRO_FONDO) guardaron EFECTIVO como
--   EFECTIVO_TOTAL (ventas + fondo de apertura) en lugar de EFECTIVO_REAL.
--   El TOTAL siempre fue correcto: TOTAL = EFECTIVO_REAL + DIGITAL.
--   Fórmula de corrección: EFECTIVO = TOTAL - DIGITAL - CHEQUES - CTA_CTE
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @cierresFix INT;

UPDATE MOVIMIENTOS_CAJA
SET    EFECTIVO = ISNULL(TOTAL,   0)
                 - ISNULL(DIGITAL,  0)
                 - ISNULL(CHEQUES,  0)
                 - ISNULL(CTA_CTE,  0)
WHERE  TIPO_ENTIDAD   = 'CIERRE_CAJA'
  AND  PUNTO_VENTA_ID = @PV_ID
  AND  (  ISNULL(EFECTIVO, 0)
        + ISNULL(DIGITAL,  0)
        + ISNULL(CHEQUES,  0)
        + ISNULL(CTA_CTE,  0)
       ) <> ISNULL(TOTAL, 0);

SET @cierresFix = @@ROWCOUNT;
PRINT '  CIERRE_CAJA corregidos: ' + CAST(@cierresFix AS VARCHAR(10));

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 5: Verificar / normalizar resultado con la nueva lógica del backend
--         Balance excluye FC; Métodos incluye el efectivo movido por FC.
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @balance DECIMAL(18,2);
DECLARE @digital DECIMAL(18,2);
DECLARE @cheques DECIMAL(18,2);
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

IF @diferencia <> 0
BEGIN
    DECLARE @usuario_id INT;
    SELECT TOP 1 @usuario_id = USUARIO_ID FROM CAJA WHERE PUNTO_VENTA_ID = @PV_ID ORDER BY CAJA_ID DESC;
    IF @usuario_id IS NULL SET @usuario_id = 1;

    INSERT INTO MOVIMIENTOS_CAJA
        (ID_ENTIDAD, CAJA_ID, TIPO_ENTIDAD, MOVIMIENTO, USUARIO_ID,
         EFECTIVO, DIGITAL, CHEQUES, CTA_CTE, TOTAL, PUNTO_VENTA_ID, ES_MANUAL, FECHA)
    VALUES
        (0, NULL, 'TRANSFERENCIA_FC',
         'Reconciliación histórica FC: normalización de efectivo interno con saldo FC confirmado en $0',
         @usuario_id,
         @diferencia, 0, 0, 0,
         0,
         @PV_ID, 1,
         '2000-01-01T00:00:00');

    PRINT '  Insertado ajuste TRANSFERENCIA_FC histórico: $' + CAST(@diferencia AS VARCHAR(30));

    SELECT @efectivo = ISNULL(SUM(EFECTIVO), 0)
    FROM MOVIMIENTOS_CAJA
    WHERE (
              PUNTO_VENTA_ID = @PV_ID
          OR (TIPO_ENTIDAD = 'CHEQUE' AND PUNTO_VENTA_ID IS NULL)
          OR (TIPO_ENTIDAD IN ('COMPRA', 'ORDEN_PAGO', 'COBRANZA')
              AND PUNTO_VENTA_ID IS NULL AND ISNULL(CHEQUES, 0) <> 0)
          );

    SET @metodos = @efectivo + @digital + @cheques;
    SET @diferencia = @balance - @metodos;
END

PRINT '';
PRINT '=== RESULTADO FINAL (histórico) ===';
PRINT '  Balance:    $' + CAST(@balance    AS VARCHAR(30));
PRINT '  Métodos:    $' + CAST(@metodos    AS VARCHAR(30));
PRINT '  Diferencia: $' + CAST(@diferencia AS VARCHAR(30));
PRINT CASE
    WHEN @diferencia = 0
    THEN '✓ Reconciliación exitosa. Balance = Métodos.'
    ELSE '  Diferencia residual: $' + CAST(@diferencia AS VARCHAR(30))
END;

COMMIT TRANSACTION;
