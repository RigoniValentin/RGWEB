-- ═══════════════════════════════════════════════════════════════════
--  Índices para acelerar la búsqueda de productos
--  (ProductSearchModal, ABM Productos y otros lookups)
-- ═══════════════════════════════════════════════════════════════════
-- Ejecutar UNA SOLA VEZ por base de datos. Idempotente.
--
-- Notas:
--   • LIKE '%token%' (con wildcard inicial) no puede usar índice B-tree:
--     siempre hace scan. Aun así estos índices ayudan porque:
--       - Son más finos que el clustered (menos páginas que leer).
--       - Aceleran el ORDER BY p.NOMBRE.
--       - Permiten seeks por igualdad (CODIGOPARTICULAR / CODIGO_BARRAS).
--   • Para búsqueda por contenido realmente rápida sobre catálogos
--     muy grandes (> 50k productos) considere FULLTEXT INDEX.
-- ═══════════════════════════════════════════════════════════════════

-- ── PRODUCTOS.NOMBRE ────────────────────────────────────────────────
-- Acelera ORDER BY p.NOMBRE y reduce páginas escaneadas en LIKE.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_PRODUCTOS_NOMBRE' AND object_id = OBJECT_ID('PRODUCTOS')
)
BEGIN
    CREATE INDEX IX_PRODUCTOS_NOMBRE
        ON PRODUCTOS(NOMBRE)
        INCLUDE (CODIGOPARTICULAR, ACTIVO, CATEGORIA_ID, MARCA_ID, UNIDAD_ID);
    PRINT '✓ IX_PRODUCTOS_NOMBRE creado';
END
ELSE
    PRINT '· IX_PRODUCTOS_NOMBRE ya existía';

-- ── PRODUCTOS.CODIGOPARTICULAR ──────────────────────────────────────
-- Lookup exacto cuando el usuario escribe un código.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_PRODUCTOS_CODIGOPARTICULAR' AND object_id = OBJECT_ID('PRODUCTOS')
)
BEGIN
    CREATE INDEX IX_PRODUCTOS_CODIGOPARTICULAR
        ON PRODUCTOS(CODIGOPARTICULAR)
        WHERE CODIGOPARTICULAR IS NOT NULL;
    PRINT '✓ IX_PRODUCTOS_CODIGOPARTICULAR creado';
END
ELSE
    PRINT '· IX_PRODUCTOS_CODIGOPARTICULAR ya existía';

-- ── PRODUCTOS.ACTIVO + NOMBRE (filtro común) ────────────────────────
-- La gran mayoría de búsquedas filtran por ACTIVO = 1.
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_PRODUCTOS_ACTIVO_NOMBRE' AND object_id = OBJECT_ID('PRODUCTOS')
)
BEGIN
    CREATE INDEX IX_PRODUCTOS_ACTIVO_NOMBRE
        ON PRODUCTOS(ACTIVO, NOMBRE);
    PRINT '✓ IX_PRODUCTOS_ACTIVO_NOMBRE creado';
END
ELSE
    PRINT '· IX_PRODUCTOS_ACTIVO_NOMBRE ya existía';

-- ── PRODUCTOS_COD_BARRAS.CODIGO_BARRAS ──────────────────────────────
-- Esencial para escaneo de códigos de barras (incluye balanza).
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_PRODUCTOS_COD_BARRAS_CODIGO' AND object_id = OBJECT_ID('PRODUCTOS_COD_BARRAS')
)
BEGIN
    CREATE INDEX IX_PRODUCTOS_COD_BARRAS_CODIGO
        ON PRODUCTOS_COD_BARRAS(CODIGO_BARRAS)
        INCLUDE (PRODUCTO_ID);
    PRINT '✓ IX_PRODUCTOS_COD_BARRAS_CODIGO creado';
END
ELSE
    PRINT '· IX_PRODUCTOS_COD_BARRAS_CODIGO ya existía';

PRINT '';
PRINT '═══════════════════════════════════════════════════════════════';
PRINT '  Índices de búsqueda de productos aplicados correctamente.';
PRINT '═══════════════════════════════════════════════════════════════';
