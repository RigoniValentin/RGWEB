-- ═══════════════════════════════════════════════════
--  Migración: Agregar campo ES_SERVICIO a PRODUCTOS
--  Un producto de tipo servicio no requiere stock.
-- ═══════════════════════════════════════════════════

-- Agregar columna ES_SERVICIO (0 = producto normal, 1 = servicio)
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'PRODUCTOS' AND COLUMN_NAME = 'ES_SERVICIO'
)
BEGIN
  ALTER TABLE PRODUCTOS ADD ES_SERVICIO BIT NOT NULL DEFAULT 0;
  PRINT 'Columna ES_SERVICIO agregada a PRODUCTOS';
END
ELSE
BEGIN
  PRINT 'Columna ES_SERVICIO ya existe en PRODUCTOS';
END
GO
