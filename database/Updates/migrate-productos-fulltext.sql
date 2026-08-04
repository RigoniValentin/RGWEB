-- ═══════════════════════════════════════════════════════════════════
--  Migración opcional: FULLTEXT INDEX para catálogos grandes
-- ═══════════════════════════════════════════════════════════════════
--  OBJETIVO
--    Cuando un cliente tiene > 50k productos, los LIKE '%token%' con
--    wildcard inicial dejan de ser prácticos aunque haya índices.
--    FULLTEXT permite búsquedas por contención muy rápidas usando
--    CONTAINS / FREETEXT sobre el contenido de PRODUCTOS / MARCAS /
--    CATEGORIAS.
--
--  IDEMPOTENTE
--    Si ya existen, no los recrea. Si no, los crea y popula.
--    Seguro de correr varias veces.
--
--  REQUISITOS
--    - SQL Server 2008 o superior (cualquier edición).
--    - El motor FULLTEXT viene instalado por defecto; si por alguna
--      razón el CREATE FULLTEXT INDEX falla con "Full-Text Search is
--      not enabled", ejecutar desde el instalador de SQL Server la
--      opción "Full-Text and Semantic Extractions for Search".
--
--  USO
--    El backend ya funciona bien con la estrategia de IN-list por
--    MARCA_ID / CATEGORIA_ID + IX_PRODUCTOS_ACTIVO_NOMBRE.
--    Esta migración es OPTATIVA: solo aplicarla si se observa
--    degradación con bases muy grandes. No cambia el comportamiento
--    actual del backend (no la usa todavía); deja el terreno
--    preparado para una migración futura del helper a FREETEXT.
-- ═══════════════════════════════════════════════════════════════════

-- ── Catálogo FULLTEXT (uno por base) ───────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE name = 'FT_PRODUCTOS')
BEGIN
    CREATE FULLTEXT CATALOG FT_PRODUCTOS AS DEFAULT;
    PRINT '✓ Catálogo FULLTEXT FT_PRODUCTOS creado';
END
ELSE
    PRINT '· Catálogo FULLTEXT FT_PRODUCTOS ya existía';
GO

-- ── Índice FULLTEXT sobre PRODUCTOS ────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.fulltext_indexes fti
    JOIN sys.tables t ON fti.object_id = t.object_id
    WHERE t.name = 'PRODUCTOS'
)
BEGIN
    CREATE FULLTEXT INDEX ON PRODUCTOS (NOMBRE, DESCRIPCION, CODIGOPARTICULAR)
        KEY INDEX PK__PRODUCTOS__???  -- placeholder, ver abajo
        ;
    PRINT '✓ FULLTEXT INDEX sobre PRODUCTOS creado';
END
ELSE
    PRINT '· FULLTEXT INDEX sobre PRODUCTOS ya existía';
GO

-- ⚠ SQL Server exige la PK o un índice único como KEY INDEX.
-- Si tu PK se llama distinto (común: PK_PRODUCTOS), ajustá arriba.
-- Esta migración es segura de aplicar más de una vez; si el nombre
-- del índice KEY no coincide, va a fallar con un mensaje claro y
-- no toca nada.

-- ── FULLTEXT sobre MARCAS y CATEGORIAS ──────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.fulltext_indexes fti
    JOIN sys.tables t ON fti.object_id = t.object_id
    WHERE t.name = 'MARCAS'
)
BEGIN
    CREATE FULLTEXT INDEX ON MARCAS (NOMBRE)
        KEY INDEX PK_MARCAS
        ;
    PRINT '✓ FULLTEXT INDEX sobre MARCAS creado';
END
ELSE
    PRINT '· FULLTEXT INDEX sobre MARCAS ya existía';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.fulltext_indexes fti
    JOIN sys.tables t ON fti.object_id = t.object_id
    WHERE t.name = 'CATEGORIAS'
)
BEGIN
    CREATE FULLTEXT INDEX ON CATEGORIAS (NOMBRE)
        KEY INDEX PK_CATEGORIAS
        ;
    PRINT '✓ FULLTEXT INDEX sobre CATEGORIAS creado';
END
ELSE
    PRINT '· FULLTEXT INDEX sobre CATEGORIAS ya existía';
GO

-- ── Poblar inicialmente (si la tabla ya tiene datos) ────────────────
-- FULLTEXT se mantiene automáticamente con CHANGE_TRACKING si está
-- activo. La primera vez hay que poblarlo manualmente:
IF OBJECT_ID('PRODUCTOS', 'U') IS NOT NULL
BEGIN
    ALTER FULLTEXT INDEX ON PRODUCTOS START FULL POPULATION;
    ALTER FULLTEXT INDEX ON MARCAS     START FULL POPULATION;
    ALTER FULLTEXT INDEX ON CATEGORIAS START FULL POPULATION;
    PRINT '✓ Población FULLTEXT iniciada (puede tardar en tablas grandes)';
END
GO

PRINT '';
PRINT '═══════════════════════════════════════════════════════════════';
PRINT '  FULLTEXT INDEX aplicado. El backend actual no lo usa aún;';
PRINT '  queda listo para catálogos > 50k productos.';
PRINT '═══════════════════════════════════════════════════════════════';
