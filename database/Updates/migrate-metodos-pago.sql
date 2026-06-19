-- =============================================================================
-- MIGRACIÓN: Poblar MOVIMIENTOS_CAJA_METODOS_PAGO para movimientos existentes
-- =============================================================================
-- Para clientes que venían usando la versión anterior sin métodos de pago.
-- Mapea:
--   EFECTIVO → Método de pago por defecto de categoría EFECTIVO
--   DIGITAL  → Método de pago "Transferencia" (categoría DIGITAL)
-- Procesa TODOS los movimientos que tengan montos en EFECTIVO/DIGITAL
-- y que NO tienen registros en la tabla nueva.
-- =============================================================================

BEGIN TRANSACTION;

-- Asegurar que la tabla destino existe
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'MOVIMIENTOS_CAJA_METODOS_PAGO')
BEGIN
    CREATE TABLE MOVIMIENTOS_CAJA_METODOS_PAGO (
        ID             INT IDENTITY(1,1) PRIMARY KEY,
        MOVIMIENTO_ID  INT            NOT NULL,
        METODO_PAGO_ID INT            NOT NULL,
        MONTO          DECIMAL(18,2)  NOT NULL
    );
END

-- Obtener el ID del método EFECTIVO por defecto
DECLARE @efectivoId INT;
SELECT TOP 1 @efectivoId = METODO_PAGO_ID
FROM METODOS_PAGO
WHERE CATEGORIA = 'EFECTIVO' AND ACTIVA = 1
ORDER BY POR_DEFECTO DESC, METODO_PAGO_ID ASC;

-- Obtener el ID del método TRANSFERENCIA (digital por defecto)
DECLARE @transferenciaId INT;
SELECT TOP 1 @transferenciaId = METODO_PAGO_ID
FROM METODOS_PAGO
WHERE CATEGORIA = 'DIGITAL' AND ACTIVA = 1 AND NOMBRE = 'Transferencia'
ORDER BY POR_DEFECTO DESC, METODO_PAGO_ID ASC;

-- Fallback: si no existe "Transferencia", usar cualquier digital por defecto
IF @transferenciaId IS NULL
BEGIN
    SELECT TOP 1 @transferenciaId = METODO_PAGO_ID
    FROM METODOS_PAGO
    WHERE CATEGORIA = 'DIGITAL' AND ACTIVA = 1
    ORDER BY POR_DEFECTO DESC, METODO_PAGO_ID ASC;
END

-- Verificar que se encontraron los métodos
IF @efectivoId IS NULL
BEGIN
    RAISERROR('No se encontró un método de pago EFECTIVO activo.', 16, 1);
    ROLLBACK TRANSACTION;
    RETURN;
END

IF @transferenciaId IS NULL
BEGIN
    RAISERROR('No se encontró un método de pago DIGITAL activo.', 16, 1);
    ROLLBACK TRANSACTION;
    RETURN;
END

PRINT 'Método Efectivo ID: ' + CAST(@efectivoId AS VARCHAR);
PRINT 'Método Transferencia ID: ' + CAST(@transferenciaId AS VARCHAR);

-- Insertar EFECTIVO para todos los movimientos que tienen monto en efectivo y no tienen ya ese método
INSERT INTO MOVIMIENTOS_CAJA_METODOS_PAGO (MOVIMIENTO_ID, METODO_PAGO_ID, MONTO)
SELECT mc.ID, @efectivoId, mc.EFECTIVO
FROM MOVIMIENTOS_CAJA mc
WHERE mc.EFECTIVO <> 0
  AND NOT EXISTS (
      SELECT 1 FROM MOVIMIENTOS_CAJA_METODOS_PAGO mcmp
      WHERE mcmp.MOVIMIENTO_ID = mc.ID AND mcmp.METODO_PAGO_ID = @efectivoId
  );

DECLARE @rowsEfectivo INT = @@ROWCOUNT;
PRINT 'Registros insertados (Efectivo): ' + CAST(@rowsEfectivo AS VARCHAR);

-- Insertar TRANSFERENCIA para todos los movimientos que tienen monto digital y no tienen ya ese método
INSERT INTO MOVIMIENTOS_CAJA_METODOS_PAGO (MOVIMIENTO_ID, METODO_PAGO_ID, MONTO)
SELECT mc.ID, @transferenciaId, mc.DIGITAL
FROM MOVIMIENTOS_CAJA mc
WHERE mc.DIGITAL <> 0
  AND NOT EXISTS (
      SELECT 1 FROM MOVIMIENTOS_CAJA_METODOS_PAGO mcmp
      WHERE mcmp.MOVIMIENTO_ID = mc.ID AND mcmp.METODO_PAGO_ID = @transferenciaId
  );

DECLARE @rowsDigital INT = @@ROWCOUNT;
PRINT 'Registros insertados (Digital/Transferencia): ' + CAST(@rowsDigital AS VARCHAR);

PRINT '';
PRINT 'Total registros migrados: ' + CAST(@rowsEfectivo + @rowsDigital AS VARCHAR);

COMMIT TRANSACTION;
PRINT 'Migración completada exitosamente.';