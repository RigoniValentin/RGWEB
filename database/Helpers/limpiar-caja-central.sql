-- =============================================================================
-- LIMPIEZA DE CAJA CENTRAL — Reset del ledger central conservando
-- ventas, compras, clientes, productos, sesiones de caja y cheques.
-- =============================================================================
--
-- Tablas que SE VACÍAN:
--   · MOVIMIENTOS_CAJA
--   · MOVIMIENTOS_CAJA_METODOS_PAGO
--
-- Tablas que NO SE TOCAN (se conservan tal cual):
--   · VENTAS, COMPRAS, NC_VENTAS, NC_COMPRAS, REMITOS
--   · CAJA_SESIONES, CAJA_ITEMS, CAJA
--   · VENTAS_METODOS_PAGO, COMPRAS_METODOS_PAGO, etc.
--   · CHEQUES, CHEQUES_HISTORIAL
--   · CLIENTES, PROVEEDORES, PRODUCTOS, STOCK, METODOS_PAGO
--   · Cualquier otra entidad
--
-- PRECONDICIONES OBLIGATORIAS:
--   1. No debe haber sesiones de caja con ESTADO = 'ACTIVA'.
--   2. Se recomienda backup previo de la base de datos.
--
-- Después de la limpieza:
--   · El balance de Caja Central quedará en $0.
--   · Los próximos cierres de caja generarán nuevos MOVIMIENTOS_CAJA
--     que re-poblan el ledger desde cero.
-- =============================================================================

BEGIN TRANSACTION;

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 1: Verificar precondición — sin cajas abiertas
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @cajasActivas INT = 0;

SELECT @cajasActivas = COUNT(*)
FROM   CAJA_SESIONES
WHERE  ESTADO = 'ACTIVA';

IF @cajasActivas > 0
BEGIN
    DECLARE @msg NVARCHAR(500) = 'Precondicion fallida: hay ' + CAST(@cajasActivas AS VARCHAR(10)) + ' sesion(es) de caja abierta(s). Cerrar todas las cajas antes de limpiar Caja Central.';
    RAISERROR(@msg, 16, 1);
    ROLLBACK TRANSACTION;
    RETURN;
END

PRINT '✓ Sin sesiones de caja activas';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 2: Conteo previo (para auditoría)
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @mcAntes       INT = 0;
DECLARE @mcmpAntes     INT = 0;
DECLARE @totalAntes    DECIMAL(18,2) = 0;

IF OBJECT_ID(N'[dbo].[MOVIMIENTOS_CAJA]', N'U') IS NOT NULL
BEGIN
    SELECT @mcAntes    = COUNT(*) FROM MOVIMIENTOS_CAJA;
    SELECT @totalAntes = ISNULL(SUM(TOTAL), 0) FROM MOVIMIENTOS_CAJA;
END

IF OBJECT_ID(N'[dbo].[MOVIMIENTOS_CAJA_METODOS_PAGO]', N'U') IS NOT NULL
    SELECT @mcmpAntes = COUNT(*) FROM MOVIMIENTOS_CAJA_METODOS_PAGO;

PRINT '';
PRINT '=== ESTADO ANTES ===';
PRINT '  MOVIMIENTOS_CAJA:                  ' + CAST(@mcAntes    AS VARCHAR(20)) + ' filas  (TOTAL histórico $' + CAST(@totalAntes AS VARCHAR(30)) + ')';
PRINT '  MOVIMIENTOS_CAJA_METODOS_PAGO:     ' + CAST(@mcmpAntes  AS VARCHAR(20)) + ' filas';

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 3: Borrado del desglose por método de pago (tabla hija)
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @rowsMetodos INT = 0;

IF OBJECT_ID(N'[dbo].[MOVIMIENTOS_CAJA_METODOS_PAGO]', N'U') IS NOT NULL
BEGIN
    DELETE FROM MOVIMIENTOS_CAJA_METODOS_PAGO;
    SET @rowsMetodos = @@ROWCOUNT;
END

PRINT '  → MOVIMIENTOS_CAJA_METODOS_PAGO eliminadas: ' + CAST(@rowsMetodos AS VARCHAR(20));

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 4: Borrado del ledger de Caja Central (tabla padre)
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @rowsMovs INT = 0;

IF OBJECT_ID(N'[dbo].[MOVIMIENTOS_CAJA]', N'U') IS NOT NULL
BEGIN
    DELETE FROM MOVIMIENTOS_CAJA;
    SET @rowsMovs = @@ROWCOUNT;
END

PRINT '  → MOVIMIENTOS_CAJA eliminadas:              ' + CAST(@rowsMovs    AS VARCHAR(20));

-- ─────────────────────────────────────────────────────────────────────────────
-- PASO 5: Conteo posterior (verificación)
-- ─────────────────────────────────────────────────────────────────────────────
DECLARE @mcDespues   INT = 0;
DECLARE @mcmpDespues INT = 0;

IF OBJECT_ID(N'[dbo].[MOVIMIENTOS_CAJA]', N'U') IS NOT NULL
    SELECT @mcDespues = COUNT(*) FROM MOVIMIENTOS_CAJA;

IF OBJECT_ID(N'[dbo].[MOVIMIENTOS_CAJA_METODOS_PAGO]', N'U') IS NOT NULL
    SELECT @mcmpDespues = COUNT(*) FROM MOVIMIENTOS_CAJA_METODOS_PAGO;

PRINT '';
PRINT '=== ESTADO DESPUES ===';
PRINT '  MOVIMIENTOS_CAJA:                  ' + CAST(@mcDespues   AS VARCHAR(20)) + ' filas  (esperado: 0)';
PRINT '  MOVIMIENTOS_CAJA_METODOS_PAGO:     ' + CAST(@mcmpDespues AS VARCHAR(20)) + ' filas  (esperado: 0)';

IF @mcDespues <> 0 OR @mcmpDespues <> 0
BEGIN
    RAISERROR('Validacion fallida: quedaron filas en las tablas de Caja Central.', 16, 1);
    ROLLBACK TRANSACTION;
    RETURN;
END

COMMIT TRANSACTION;

PRINT '';
PRINT '=== CAJA CENTRAL LIMPIADA ===';
PRINT '  Filas borradas en MOVIMIENTOS_CAJA:              ' + CAST(@rowsMovs    AS VARCHAR(20));
PRINT '  Filas borradas en MOVIMIENTOS_CAJA_METODOS_PAGO: ' + CAST(@rowsMetodos AS VARCHAR(20));
PRINT '  Balance de Caja Central: $0';
PRINT '  Ventas, compras, clientes, productos, sesiones de caja y cheques: SIN CAMBIOS.';
