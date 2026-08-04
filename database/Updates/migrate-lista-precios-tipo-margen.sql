-- ═══════════════════════════════════════════════════════════════════
--  Río Gestión Web — Métodos de cálculo de margen en LISTA_PRECIOS
--
--  Hasta ahora todas las listas aplicaban markup sobre costo:
--    Precio = Costo × (1 + Margen/100)
--
--  Se agrega TIPO_MARGEN para soportar también margen sobre venta
--  (utilidad):
--    Precio = Costo / (1 - Margen/100)
--
--    'M' (Markup)        → comportamiento histórico (default retrocompatible)
--    'U' (Utilidad)      → cálculo contable "margen sobre venta final"
--
--  Notas:
--    - Idempotente: puede ejecutarse múltiples veces sin error.
--    - Usa GO entre bloques para forzar la recompilación del CHECK
--      constraint una vez creada la columna.
--    - Las listas existentes quedan como 'M' por default.
-- ═══════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
GO

-- ──────────────────────────────────────────────────────────────────
-- 1. Agregar la columna TIPO_MARGEN con default 'M' (Markup)
-- ──────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.LISTA_PRECIOS') AND name = 'TIPO_MARGEN'
)
BEGIN
    ALTER TABLE dbo.LISTA_PRECIOS
        ADD TIPO_MARGEN CHAR(1) NOT NULL
            CONSTRAINT DF_LISTA_PRECIOS_TIPO_MARGEN DEFAULT ('M');
    PRINT '✓ Columna TIPO_MARGEN agregada a LISTA_PRECIOS (default ''M'').';
END
ELSE
    PRINT '⚠ Columna TIPO_MARGEN ya existe — se omite el ALTER.';
GO

-- ──────────────────────────────────────────────────────────────────
-- 2. Asegurar DEFAULT ligado a la columna (por si se creó sin él)
-- ──────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.default_constraints
  WHERE parent_object_id = OBJECT_ID('dbo.LISTA_PRECIOS')
    AND parent_column_id = (
      SELECT column_id FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.LISTA_PRECIOS') AND name = 'TIPO_MARGEN'
    )
)
BEGIN
    ALTER TABLE dbo.LISTA_PRECIOS
        ADD CONSTRAINT DF_LISTA_PRECIOS_TIPO_MARGEN DEFAULT ('M') FOR TIPO_MARGEN;
    PRINT '✓ DEFAULT (''M'') ligado a TIPO_MARGEN.';
END
ELSE
    PRINT '⚠ DEFAULT ya existente para TIPO_MARGEN — se omite.';
GO

-- ──────────────────────────────────────────────────────────────────
-- 3. CHECK constraint de valores válidos (M / U)
--    Este bloque va en su propio batch (separado por GO arriba) para
--    que SQL Server recompile y reconozca la columna TIPO_MARGEN.
-- ──────────────────────────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.check_constraints
  WHERE name = 'CK_LISTA_PRECIOS_TIPO_MARGEN'
)
BEGIN
    ALTER TABLE dbo.LISTA_PRECIOS
        ADD CONSTRAINT CK_LISTA_PRECIOS_TIPO_MARGEN
        CHECK (TIPO_MARGEN IN ('M', 'U'));
    PRINT '✓ CHECK constraint CK_LISTA_PRECIOS_TIPO_MARGEN creado.';
END
ELSE
    PRINT '⚠ CHECK constraint CK_LISTA_PRECIOS_TIPO_MARGEN ya existe — se omite.';
GO

PRINT '════════════════════════════════════════════════════════';
PRINT '  Migración finalizada.';
PRINT '  • Nueva columna: LISTA_PRECIOS.TIPO_MARGEN (CHAR(1))';
PRINT '  • Valores válidos: ''M'' = Markup, ''U'' = Utilidad';
PRINT '  • Default retrocompatible: ''M''';
PRINT '════════════════════════════════════════════════════════';
GO