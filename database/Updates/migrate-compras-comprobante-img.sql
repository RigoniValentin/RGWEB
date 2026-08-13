-- ═══════════════════════════════════════════════════════════════════════════════
--  Río Gestión Web — Path de imagen del comprobante de compra
--
--  Cuando la compra se origina en el flujo "Cargar comprobante por imagen"
--  (parser IA Vision), la imagen se persiste en /uploads/comprobantes/<YYYY-MM>/
--  y se guarda aquí la ruta relativa al rootDir del backend, para poder
--  recuperarla, re-procesarla o auditarla después.
--
--  Ruta ejemplo: 'uploads/comprobantes/2026-08/3_1723456789_ab12cd34.jpg'
--
--  Aditiva. Ejecutar una sola vez contra SesamoDB.
-- ═══════════════════════════════════════════════════════════════════════════════
SET NOCOUNT ON;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'COMPRAS' AND COLUMN_NAME = 'COMPROBANTE_IMG_PATH'
)
BEGIN
  ALTER TABLE COMPRAS ADD COMPROBANTE_IMG_PATH NVARCHAR(500) NULL;
  PRINT '✅ COMPRAS.COMPROBANTE_IMG_PATH agregado';
END
ELSE PRINT '— COMPRAS.COMPROBANTE_IMG_PATH ya existe';

GO

PRINT '🎉 migrate-compras-comprobante-img completada';
GO
