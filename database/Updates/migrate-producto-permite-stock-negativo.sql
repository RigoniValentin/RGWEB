-- ═══════════════════════════════════════════════════
--  Permite stock negativo por producto
--  Cuando PERMITE_STOCK_NEGATIVO = 0 (default), no se
--  puede decrementar el stock por debajo de 0 en ninguna
--  operación (ventas, remitos SALIDA, NC, ajustes, etc.).
--  Servicios (ES_SERVICIO=1) y kits (ES_CONJUNTO=1) ignoran
--  esta validación.
-- ═══════════════════════════════════════════════════

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'PRODUCTOS' AND COLUMN_NAME = 'PERMITE_STOCK_NEGATIVO'
)
BEGIN
  ALTER TABLE PRODUCTOS
    ADD PERMITE_STOCK_NEGATIVO BIT NOT NULL
        CONSTRAINT DF_PRODUCTOS_PERMITE_STOCK_NEGATIVO DEFAULT 0;
END
GO
