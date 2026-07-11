-- ═══════════════════════════════════════════════════════════════════
--  Refactor Listas de Precio — Separación de PRODUCTOS
--
--  Antes: PRODUCTOS.LISTA_1..5 (columnas hardcoded, max 5 listas)
--  Después: PRODUCTO_LISTA_PRECIOS (tabla puente, N listas)
--
--  Cambios:
--    1. Crear PRODUCTO_LISTA_PRECIOS (LISTA_ID, PRODUCTO_ID, PRECIO)
--    2. Migrar precios desde PRODUCTOS.LISTA_1..5
--    3. DROP columnas LISTA_1..5 de PRODUCTOS
--    4. Mantener LISTA_DEFECTO en PRODUCTOS (FK lógico a LISTA_PRECIOS)
--
--  Idempotente: si la nueva tabla ya existe, aborta sin cambios.
-- ═══════════════════════════════════════════════════════════════════

SET NOCOUNT ON;

IF OBJECT_ID('dbo.PRODUCTO_LISTA_PRECIOS', 'U') IS NOT NULL
BEGIN
    PRINT '⚠ PRODUCTO_LISTA_PRECIOS ya existe — script omitido.';
    RETURN;
END

-- ──────────────────────────────────────────────────────────────────
-- 1. Crear la nueva tabla puente
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE dbo.PRODUCTO_LISTA_PRECIOS (
    LISTA_ID             INT             NOT NULL,
    PRODUCTO_ID          INT             NOT NULL,
    PRECIO               DECIMAL(18, 4)  NOT NULL,
    FECHA_ACTUALIZACION  DATETIME        NOT NULL    CONSTRAINT DF_PRODUCTO_LISTA_PRECIOS_FECHA DEFAULT GETDATE(),
    CONSTRAINT PK_PRODUCTO_LISTA_PRECIOS PRIMARY KEY CLUSTERED (LISTA_ID, PRODUCTO_ID),
    CONSTRAINT FK_PRODUCTO_LISTA_PRECIOS_LISTA    FOREIGN KEY (LISTA_ID)    REFERENCES dbo.LISTA_PRECIOS(LISTA_ID),
    CONSTRAINT FK_PRODUCTO_LISTA_PRECIOS_PRODUCTO FOREIGN KEY (PRODUCTO_ID) REFERENCES dbo.PRODUCTOS(PRODUCTO_ID)
);

CREATE NONCLUSTERED INDEX IX_PRODUCTO_LISTA_PRECIOS_PRODUCTO
    ON dbo.PRODUCTO_LISTA_PRECIOS (PRODUCTO_ID) INCLUDE (PRECIO, LISTA_ID);

PRINT '✓ PRODUCTO_LISTA_PRECIOS creada.';

-- ──────────────────────────────────────────────────────────────────
-- 2. Migrar precios no nulos/no cero desde PRODUCTOS.LISTA_1..5
-- ──────────────────────────────────────────────────────────────────
-- Solo insertamos filas con PRECIO > 0 (los precios "vacíos" quedan
-- simplemente sin fila; los SELECT deben usar LEFT JOIN).

INSERT INTO dbo.PRODUCTO_LISTA_PRECIOS (LISTA_ID, PRODUCTO_ID, PRECIO)
SELECT 1, p.PRODUCTO_ID, p.LISTA_1
FROM   dbo.PRODUCTOS p
WHERE  ISNULL(p.LISTA_1, 0) > 0;

INSERT INTO dbo.PRODUCTO_LISTA_PRECIOS (LISTA_ID, PRODUCTO_ID, PRECIO)
SELECT 2, p.PRODUCTO_ID, p.LISTA_2
FROM   dbo.PRODUCTOS p
WHERE  ISNULL(p.LISTA_2, 0) > 0;

INSERT INTO dbo.PRODUCTO_LISTA_PRECIOS (LISTA_ID, PRODUCTO_ID, PRECIO)
SELECT 3, p.PRODUCTO_ID, p.LISTA_3
FROM   dbo.PRODUCTOS p
WHERE  ISNULL(p.LISTA_3, 0) > 0;

INSERT INTO dbo.PRODUCTO_LISTA_PRECIOS (LISTA_ID, PRODUCTO_ID, PRECIO)
SELECT 4, p.PRODUCTO_ID, p.LISTA_4
FROM   dbo.PRODUCTOS p
WHERE  ISNULL(p.LISTA_4, 0) > 0;

INSERT INTO dbo.PRODUCTO_LISTA_PRECIOS (LISTA_ID, PRODUCTO_ID, PRECIO)
SELECT 5, p.PRODUCTO_ID, p.LISTA_5
FROM   dbo.PRODUCTOS p
WHERE  ISNULL(p.LISTA_5, 0) > 0;

DECLARE @migrados INT = @@ROWCOUNT;
PRINT '✓ Precios migrados a PRODUCTO_LISTA_PRECIOS (filas insertadas en este batch: ' + CAST(@migrados AS VARCHAR(10)) + ').';

-- ──────────────────────────────────────────────────────────────────
-- 3. DROP de las columnas legacy en PRODUCTOS
-- ──────────────────────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PRODUCTOS') AND name = 'LISTA_1')
    ALTER TABLE dbo.PRODUCTOS DROP COLUMN LISTA_1;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PRODUCTOS') AND name = 'LISTA_2')
    ALTER TABLE dbo.PRODUCTOS DROP COLUMN LISTA_2;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PRODUCTOS') AND name = 'LISTA_3')
    ALTER TABLE dbo.PRODUCTOS DROP COLUMN LISTA_3;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PRODUCTOS') AND name = 'LISTA_4')
    ALTER TABLE dbo.PRODUCTOS DROP COLUMN LISTA_4;

IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.PRODUCTOS') AND name = 'LISTA_5')
    ALTER TABLE dbo.PRODUCTOS DROP COLUMN LISTA_5;

PRINT '✓ Columnas LISTA_1..5 eliminadas de PRODUCTOS.';

-- ──────────────────────────────────────────────────────────────────
-- 4. FK opcional sobre LISTA_DEFECTO → LISTA_PRECIOS.LISTA_ID
--    (No la forzamos para no romper instalaciones con IDs huérfanos
--     residuales; el backend valida en runtime.)
-- ──────────────────────────────────────────────────────────────────

PRINT '════════════════════════════════════════════════════════';
PRINT '  Migración finalizada. Resumen:';
PRINT '  • Nueva tabla: dbo.PRODUCTO_LISTA_PRECIOS';
PRINT '  • Columnas eliminadas: PRODUCTOS.LISTA_1..5';
PRINT '  • LISTA_DEFECTO se mantiene en PRODUCTOS';
PRINT '════════════════════════════════════════════════════════';
