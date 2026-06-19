-- ═══════════════════════════════════════════════════
--  Migration: Add VENTA_ID to REMITOS for sale association
-- ═══════════════════════════════════════════════════

-- Add VENTA_ID column to link a remito to the sale that invoiced it
IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'REMITOS' AND COLUMN_NAME = 'VENTA_ID'
)
BEGIN
  ALTER TABLE REMITOS ADD VENTA_ID INT NULL;
  CREATE INDEX IX_REMITOS_VENTA ON REMITOS (VENTA_ID);
END
GO
