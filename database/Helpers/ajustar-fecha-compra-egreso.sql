-- Ajusta la fecha de una compra y de sus registros asociados.
-- SQL Server / SesamoDB

DECLARE @COMPRA_ID INT = 0; -- Cambiar por la compra a corregir
DECLARE @NUEVA_FECHA DATETIME = DATEFROMPARTS(2026, 6, 9);

BEGIN TRY
    BEGIN TRAN;

    IF NOT EXISTS (
        SELECT 1
        FROM COMPRAS
        WHERE COMPRA_ID = @COMPRA_ID
    )
    BEGIN
        THROW 50000, 'La compra indicada no existe.', 1;
    END;

    UPDATE COMPRAS
    SET FECHA_COMPRA = @NUEVA_FECHA
    WHERE COMPRA_ID = @COMPRA_ID;

    -- Si la compra fue a cuenta corriente, mantener la fecha del asiento asociado.
    UPDATE ccp
    SET FECHA = @NUEVA_FECHA
    FROM COMPRAS_CTA_CORRIENTE ccp
    WHERE ccp.COMPROBANTE_ID = @COMPRA_ID;

    -- Si la compra generó un egreso en caja abierta, corregir esa fecha también.
    UPDATE ci
    SET FECHA = @NUEVA_FECHA
    FROM CAJA_ITEMS ci
    WHERE ci.ORIGEN_TIPO = 'COMPRA'
      AND ci.ORIGEN_ID = @COMPRA_ID;

    -- Egreso / pago a proveedor registrado en Caja Central.
    UPDATE mc
    SET FECHA = @NUEVA_FECHA
    FROM MOVIMIENTOS_CAJA mc
    WHERE mc.TIPO_ENTIDAD = 'COMPRA'
      AND mc.ID_ENTIDAD = @COMPRA_ID;

    SELECT
        c.COMPRA_ID,
        c.FECHA_COMPRA,
        c.TOTAL,
        (SELECT COUNT(*) FROM COMPRAS_CTA_CORRIENTE WHERE COMPROBANTE_ID = c.COMPRA_ID) AS ASIENTOS_CTA_CORRIENTE,
        (SELECT COUNT(*) FROM CAJA_ITEMS WHERE ORIGEN_TIPO = 'COMPRA' AND ORIGEN_ID = c.COMPRA_ID) AS CAJA_ITEMS_ASOCIADOS,
        (SELECT COUNT(*) FROM MOVIMIENTOS_CAJA WHERE TIPO_ENTIDAD = 'COMPRA' AND ID_ENTIDAD = c.COMPRA_ID) AS MOVIMIENTOS_CAJA_ASOCIADOS
    FROM COMPRAS c
    WHERE c.COMPRA_ID = @COMPRA_ID;

    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK;

    THROW;
END CATCH;