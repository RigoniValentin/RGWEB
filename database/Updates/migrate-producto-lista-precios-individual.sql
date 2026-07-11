-- ═══════════════════════════════════════════════════════════════════
--  Centralizar márgenes individuales en PRODUCTO_LISTA_PRECIOS
--
--  Antes: PRODUCTO_MARGENES.MARGEN_LISTA_1..5 (tabla separada)
--  Después: PRODUCTO_LISTA_PRECIOS.MARGEN_INDIVIDUAL (nueva columna)
--
--  Cambios:
--    1. Agregar columna MARGEN_INDIVIDUAL a PRODUCTO_LISTA_PRECIOS
--    2. Migrar márgenes individuales existentes (no cero) desde
--       PRODUCTO_MARGENES.MARGEN_LISTA_X
--    3. Para productos con margen individual pero sin fila en
--       PRODUCTO_LISTA_PRECIOS, crear la fila con el precio calculado
--    4. PRODUCTO_MARGENES queda como tabla legacy/deprecada
-- ═══════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

-- ──────────────────────────────────────────────────────────────────
-- 1. Agregar la columna
-- ──────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.PRODUCTO_LISTA_PRECIOS') AND name = 'MARGEN_INDIVIDUAL'
)
BEGIN
    ALTER TABLE dbo.PRODUCTO_LISTA_PRECIOS
        ADD MARGEN_INDIVIDUAL DECIMAL(9, 4) NULL;
    PRINT '✓ Columna MARGEN_INDIVIDUAL agregada a PRODUCTO_LISTA_PRECIOS.';
END
ELSE
    PRINT '⚠ Columna MARGEN_INDIVIDUAL ya existe — se omite el ALTER.';

-- ──────────────────────────────────────────────────────────────────
-- 2. Migrar márgenes existentes desde PRODUCTO_MARGENES (listas 1..5)
--    Sólo migramos valores <> 0 (0 = sin override, margen default de la lista)
-- ──────────────────────────────────────────────────────────────────
DECLARE @migrados INT = 0;

-- Lista 1
UPDATE plp
SET plp.MARGEN_INDIVIDUAL = pm.MARGEN_LISTA_1
FROM dbo.PRODUCTO_LISTA_PRECIOS plp
INNER JOIN dbo.PRODUCTO_MARGENES pm ON pm.PRODUCTO_ID = plp.PRODUCTO_ID
WHERE plp.LISTA_ID = 1
  AND ISNULL(pm.MARGEN_LISTA_1, 0) <> 0;
SET @migrados = @migrados + @@ROWCOUNT;

-- Lista 2
UPDATE plp
SET plp.MARGEN_INDIVIDUAL = pm.MARGEN_LISTA_2
FROM dbo.PRODUCTO_LISTA_PRECIOS plp
INNER JOIN dbo.PRODUCTO_MARGENES pm ON pm.PRODUCTO_ID = plp.PRODUCTO_ID
WHERE plp.LISTA_ID = 2
  AND ISNULL(pm.MARGEN_LISTA_2, 0) <> 0;
SET @migrados = @migrados + @@ROWCOUNT;

-- Lista 3
UPDATE plp
SET plp.MARGEN_INDIVIDUAL = pm.MARGEN_LISTA_3
FROM dbo.PRODUCTO_LISTA_PRECIOS plp
INNER JOIN dbo.PRODUCTO_MARGENES pm ON pm.PRODUCTO_ID = plp.PRODUCTO_ID
WHERE plp.LISTA_ID = 3
  AND ISNULL(pm.MARGEN_LISTA_3, 0) <> 0;
SET @migrados = @migrados + @@ROWCOUNT;

-- Lista 4
UPDATE plp
SET plp.MARGEN_INDIVIDUAL = pm.MARGEN_LISTA_4
FROM dbo.PRODUCTO_LISTA_PRECIOS plp
INNER JOIN dbo.PRODUCTO_MARGENES pm ON pm.PRODUCTO_ID = plp.PRODUCTO_ID
WHERE plp.LISTA_ID = 4
  AND ISNULL(pm.MARGEN_LISTA_4, 0) <> 0;
SET @migrados = @migrados + @@ROWCOUNT;

-- Lista 5
UPDATE plp
SET plp.MARGEN_INDIVIDUAL = pm.MARGEN_LISTA_5
FROM dbo.PRODUCTO_LISTA_PRECIOS plp
INNER JOIN dbo.PRODUCTO_MARGENES pm ON pm.PRODUCTO_ID = plp.PRODUCTO_ID
WHERE plp.LISTA_ID = 5
  AND ISNULL(pm.MARGEN_LISTA_5, 0) <> 0;
SET @migrados = @migrados + @@ROWCOUNT;

PRINT '✓ Márgenes individuales migrados a PRODUCTO_LISTA_PRECIOS.MARGEN_INDIVIDUAL (' + CAST(@migrados AS VARCHAR(10)) + ' filas actualizadas).';

-- ──────────────────────────────────────────────────────────────────
-- 3. Crear filas faltantes para productos con margen individual pero
--    sin fila en PRODUCTO_LISTA_PRECIOS (caso raro pero posible).
--    El precio se calcula a partir del costo y el margen.
-- ──────────────────────────────────────────────────────────────────
DECLARE @insertados INT = 0;

DECLARE @listaId INT = 1;
WHILE @listaId <= 5
BEGIN
    DECLARE @sql NVARCHAR(MAX) = N'
        INSERT INTO dbo.PRODUCTO_LISTA_PRECIOS (LISTA_ID, PRODUCTO_ID, PRECIO, MARGEN_INDIVIDUAL)
        SELECT @listaId, pm.PRODUCTO_ID,
               CAST(ROUND(ISNULL(p.PRECIO_COMPRA, 0) * (1 + pm.[MARGEN_LISTA_' + CAST(@listaId AS NVARCHAR(2)) + N'] / 100.0), 2) AS DECIMAL(18, 4)),
               pm.[MARGEN_LISTA_' + CAST(@listaId AS NVARCHAR(2)) + N']
        FROM dbo.PRODUCTO_MARGENES pm
        INNER JOIN dbo.PRODUCTOS p ON p.PRODUCTO_ID = pm.PRODUCTO_ID
        WHERE ISNULL(pm.[MARGEN_LISTA_' + CAST(@listaId AS NVARCHAR(2)) + N'], 0) <> 0
          AND ISNULL(p.PRECIO_COMPRA, 0) > 0
          AND NOT EXISTS (
              SELECT 1 FROM dbo.PRODUCTO_LISTA_PRECIOS plp
              WHERE plp.LISTA_ID = @listaId AND plp.PRODUCTO_ID = pm.PRODUCTO_ID
          )';
    EXEC sp_executesql @sql, N'@listaId INT', @listaId = @listaId;
    SET @insertados = @insertados + @@ROWCOUNT;

    SET @listaId = @listaId + 1;
END

PRINT '✓ Filas faltantes creadas en PRODUCTO_LISTA_PRECIOS (' + CAST(@insertados AS VARCHAR(10)) + ' inserts).';

PRINT '════════════════════════════════════════════════════════';
PRINT '  Migración finalizada.';
PRINT '  • Nueva columna: PRODUCTO_LISTA_PRECIOS.MARGEN_INDIVIDUAL';
PRINT '  • Márgenes migrados desde PRODUCTO_MARGENES (deprecada)';
PRINT '════════════════════════════════════════════════════════';
