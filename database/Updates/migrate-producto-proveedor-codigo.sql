-- ═══════════════════════════════════════════════════════════════════════════════
--  Producto ↔ Proveedor: persistir el código que cada proveedor usa para el
--  mismo producto físico.
--
--  Cuando se carga un comprobante por imagen, la IA extrae el código de
--  proveedor de cada ítem. Hasta ahora ese dato quedaba sólo en el draft del
--  frontend y se descartaba al cerrar el modal, por lo que la próxima factura
--  del mismo proveedor no podía matchear el producto por código y debía
--  recalcularse por descripción (menos confiable).
--
--  A partir de este cambio el código se guarda en PRODUCTOS_PROVEEDORES:
--    - Una fila por par (PRODUCTO_ID, PROVEEDOR_ID) — la unicidad por
--      proveedor la garantiza el índice único IX_PRODUCTOS_PROVEEDORES_PROV
--      que ya existía (o se crea si no).
--    - CODIGO_PROVEEDOR se actualiza con cada compra confirmada desde el
--      flujo de imagen, así queda registrado el último código conocido que
--      ese proveedor le asigna al producto.
--    - El matcher (POST /purchases/parse-image) lo usa como atajo: cuando la
--      IA detecta un codigo_proveedor, primero busca por este índice y, si
--      hay match exacto contra el proveedor detectado por CUIT/razón social,
--      devuelve el producto vinculado sin pasar por la búsqueda por
--      descripción.
--
--  Aditiva. Ejecutar una sola vez contra SesamoDB.
-- ═══════════════════════════════════════════════════════════════════════════════
SET NOCOUNT ON;
GO

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'PRODUCTOS_PROVEEDORES' AND COLUMN_NAME = 'CODIGO_PROVEEDOR'
)
BEGIN
  ALTER TABLE PRODUCTOS_PROVEEDORES ADD CODIGO_PROVEEDOR NVARCHAR(100) NULL;
  PRINT '✅ PRODUCTOS_PROVEEDORES.CODIGO_PROVEEDOR agregado';
END
ELSE PRINT '— PRODUCTOS_PROVEEDORES.CODIGO_PROVEEDOR ya existe';
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID('PRODUCTOS_PROVEEDORES')
    AND name = 'IX_PRODUCTOS_PROVEEDORES_CODIGO'
)
BEGIN
  CREATE NONCLUSTERED INDEX IX_PRODUCTOS_PROVEEDORES_CODIGO
    ON PRODUCTOS_PROVEEDORES (PROVEEDOR_ID, CODIGO_PROVEEDOR)
    WHERE CODIGO_PROVEEDOR IS NOT NULL;
  PRINT '✅ IX_PRODUCTOS_PROVEEDORES_CODIGO creado';
END
ELSE PRINT '— IX_PRODUCTOS_PROVEEDORES_CODIGO ya existe';
GO

PRINT '🎉 migrate-producto-proveedor-codigo completada';
GO
