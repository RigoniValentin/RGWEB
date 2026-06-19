-- ═══════════════════════════════════════════════════
--  Migration: Soporte para productos Exentos de IVA
-- ═══════════════════════════════════════════════════

-- 1. Agregar columna NETO_EXENTO a VENTAS
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('VENTAS') AND name = 'NETO_EXENTO'
)
BEGIN
  ALTER TABLE VENTAS ADD NETO_EXENTO DECIMAL(18,2) NULL DEFAULT 0;
  PRINT 'Columna NETO_EXENTO agregada a VENTAS';
END
GO

-- 2. Agregar tasa "Exento" en TASAS_IMPUESTOS (si no existe)
IF NOT EXISTS (
  SELECT 1 FROM TASAS_IMPUESTOS WHERE UPPER(NOMBRE) LIKE '%EXENTO%'
)
BEGIN
  INSERT INTO TASAS_IMPUESTOS (NOMBRE, PORCENTAJE, PREDETERMINADA, ACTIVA, TIPO)
  VALUES ('Exento', 0, 0, 1, 1);
  PRINT 'Tasa "Exento" agregada a TASAS_IMPUESTOS';
END
GO
