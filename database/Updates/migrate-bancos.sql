-- ─────────────────────────────────────────────────────────────
-- BANCOS — Catálogo de entidades financieras de Argentina
-- ─────────────────────────────────────────────────────────────
-- Tabla maestra para uso en el módulo de Cheques. Cada cheque
-- queda vinculado al BANCO_ID + se mantiene la columna BANCO
-- (texto) por compatibilidad con cheques históricos.
--
-- También crea la FK opcional CHEQUES.BANCO_ID -> BANCOS.
-- ─────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BANCOS]') AND type = N'U')
BEGIN
    CREATE TABLE BANCOS (
        BANCO_ID         INT IDENTITY(1,1) PRIMARY KEY,
        NOMBRE           NVARCHAR(160) NOT NULL,
        CUIT             VARCHAR(13)   NULL,           -- 30-XXXXXXXX-X
        CODIGO_BCRA      CHAR(3)       NULL,           -- 3 dígitos según BCRA
        ACTIVO           BIT           NOT NULL DEFAULT 1,
        FECHA_CREACION   DATETIME      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_BANCOS_NOMBRE UNIQUE (NOMBRE)
    );

    CREATE INDEX IX_BANCOS_CODIGO_BCRA ON BANCOS(CODIGO_BCRA);
    CREATE INDEX IX_BANCOS_ACTIVO      ON BANCOS(ACTIVO);
END
GO

-- ── Seed de bancos principales ───────────────────────────────
-- Insertamos solo los que falten (idempotente)
MERGE BANCOS AS T
USING (VALUES
    ('Banco de la Nación Argentina',              '30-50001091-2', '011'),
    ('Banco de Galicia y Buenos Aires',           '30-50000173-5', '007'),
    ('Banco Santander Argentina',                 '30-50000845-4', '072'),
    ('Banco BBVA Argentina',                      '30-50000319-3', '017'),
    ('Banco Macro',                               '30-50001008-4', '285'),
    ('Banco de la Provincia de Buenos Aires',     '33-99924210-9', '014'),
    ('Banco Credicoop Cooperativo',               '30-57142135-2', '191'),
    ('HSBC Bank Argentina',                       '33-53718600-9', '150'),
    ('Banco Patagonia',                           '30-50000661-3', '034'),
    ('Banco de la Ciudad de Buenos Aires',        '30-99903208-3', '029'),
    ('Banco de la Provincia de Córdoba',          '30-99922856-5', '020'),
    ('ICBC (Industrial & Commercial Bank)',       '30-70944784-6', '015'),
    ('Brubank (Banco Digital)',                   '30-71589971-6', '049')
) AS S (NOMBRE, CUIT, CODIGO_BCRA)
ON T.NOMBRE = S.NOMBRE
WHEN NOT MATCHED THEN
    INSERT (NOMBRE, CUIT, CODIGO_BCRA, ACTIVO)
    VALUES (S.NOMBRE, S.CUIT, S.CODIGO_BCRA, 1);

PRINT '✅ Catálogo de BANCOS sembrado / actualizado';
GO

-- ── Agregar FK BANCO_ID a CHEQUES ────────────────────────────
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CHEQUES]') AND type = N'U')
   AND NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CHEQUES]') AND name = 'BANCO_ID')
BEGIN
    ALTER TABLE CHEQUES ADD BANCO_ID INT NULL;
    PRINT '✅ Columna CHEQUES.BANCO_ID agregada';
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CHEQUES_BANCO')
   AND EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CHEQUES]') AND name = 'BANCO_ID')
BEGIN
    ALTER TABLE CHEQUES
        ADD CONSTRAINT FK_CHEQUES_BANCO FOREIGN KEY (BANCO_ID) REFERENCES BANCOS(BANCO_ID);
    PRINT '✅ FK CHEQUES.BANCO_ID -> BANCOS creada';
END
GO

-- ── Backfill: mapear cheques existentes por nombre de banco ──
UPDATE c
SET    c.BANCO_ID = b.BANCO_ID
FROM   CHEQUES c
INNER JOIN BANCOS b ON UPPER(LTRIM(RTRIM(c.BANCO))) = UPPER(LTRIM(RTRIM(b.NOMBRE)))
WHERE  c.BANCO_ID IS NULL;
GO
