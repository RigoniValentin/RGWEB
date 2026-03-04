-- ═══════════════════════════════════════════════════════════════════════════════
--  Río Gestión Web — Notas de Crédito / Débito Compras
--  These tables ALREADY EXIST in the desktop app's SesamoDB.
--  This script only adds the extra columns needed by the web app.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- Existing desktop schema (for reference only — DO NOT RUN):
-- ─────────────────────────────────────────────────────────────────────────────
--  NC_COMPRAS:
--    NC_ID             INT              NOT NULL (PK, no identity)
--    COMPRA_ID         INT              NOT NULL
--    MONTO             DECIMAL(18,2)    NOT NULL
--    DESCUENTO         DECIMAL(18,2)    NULL
--    FECHA             DATETIME         NOT NULL
--    MOTIVO            NVARCHAR(100)    NOT NULL
--    MEDIO_PAGO        NVARCHAR(100)    NOT NULL
--    DESCRIPCION       NVARCHAR(250)    NULL
--    ANULADA           BIT              NOT NULL
--    NUMERO_FISCAL     NVARCHAR(100)    NULL
--    CAE               NVARCHAR(100)    NULL
--    PUNTO_VENTA       NVARCHAR(100)    NULL
--    TIPO_COMPROBANTE  NVARCHAR(50)     NULL
--    PROVEEDOR_ID      INT              NULL
--
--  NC_COMPRAS_ITEMS:
--    NC_ITEM_ID        INT IDENTITY     NOT NULL (PK)
--    NC_ID             INT              NOT NULL
--    COMPRA_ID         INT              NOT NULL
--    PRODUCTO_ID       INT              NOT NULL
--    CANTIDAD_DEVUELTA DECIMAL(18,2)    NOT NULL
--    PRECIO_COMPRA     DECIMAL(18,2)    NOT NULL
--    DEPOSITO_ID       INT              NULL
--
--  NC_COMPRAS_HISTORIAL:
--    HISTORIAL_ID              INT IDENTITY     NOT NULL (PK)
--    COMPRA_ID                 INT              NOT NULL
--    NC_ID                     INT              NOT NULL
--    FECHA                     DATETIME         NOT NULL
--    PRODUCTO_ID               INT              NOT NULL
--    CANTIDAD_ORIGINAL         DECIMAL(18,2)    NOT NULL
--    CANTIDAD_MODIFICADO       DECIMAL(18,2)    NOT NULL
--    PRECIO_ORIGINAL           DECIMAL(18,2)    NOT NULL
--    PRECIO_MODIFICADO         DECIMAL(18,2)    NOT NULL
--    TOTAL_PRODUCTO_ORIGINAL   DECIMAL(18,2)    NOT NULL
--    TOTAL_PRODUCTO_MODIFICADO DECIMAL(18,2)    NOT NULL
--    TOTAL_COMPRA_ORIGINAL     DECIMAL(18,2)    NOT NULL
--    TOTAL_COMPRA_MODIFICADO   DECIMAL(18,2)    NOT NULL
--    MOTIVO                    VARCHAR(50)      NOT NULL
--    DEPOSITO_ID               INT              NULL
--
--  ND_COMPRAS:
--    ND_ID             INT IDENTITY     NOT NULL (PK)
--    COMPRA_ID         INT              NOT NULL
--    MONTO             DECIMAL(18,2)    NOT NULL
--    FECHA             DATETIME         NOT NULL
--    MOTIVO            NVARCHAR(100)    NOT NULL
--    MEDIO_PAGO        NVARCHAR(100)    NOT NULL
--    DESCRIPCION       NVARCHAR(250)    NULL
--    ANULADA           BIT              NOT NULL
--    NUMERO_FISCAL     NVARCHAR(100)    NULL
--    CAE               NVARCHAR(100)    NULL
--    PUNTO_VENTA       NVARCHAR(100)    NULL
--    TIPO_COMPROBANTE  NVARCHAR(50)     NULL
--    PROVEEDOR_ID      INT              NULL

-- ─────────────────────────────────────────────────────────────────────────────
-- Web-only extensions: add columns the desktop app doesn't have
-- ─────────────────────────────────────────────────────────────────────────────

-- COMPRAS: add ANULADA flag (desktop uses hard-delete; web uses soft-delete for NC support)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'COMPRAS' AND COLUMN_NAME = 'ANULADA')
  ALTER TABLE COMPRAS ADD ANULADA BIT NOT NULL DEFAULT 0;
GO

-- NC_COMPRAS: add USUARIO_ID, PUNTO_VENTA_ID, DESTINO_PAGO
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_COMPRAS' AND COLUMN_NAME = 'USUARIO_ID')
  ALTER TABLE NC_COMPRAS ADD USUARIO_ID INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_COMPRAS' AND COLUMN_NAME = 'PUNTO_VENTA_ID')
  ALTER TABLE NC_COMPRAS ADD PUNTO_VENTA_ID INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'NC_COMPRAS' AND COLUMN_NAME = 'DESTINO_PAGO')
  ALTER TABLE NC_COMPRAS ADD DESTINO_PAGO VARCHAR(20) NULL DEFAULT 'CAJA_CENTRAL';
GO

-- ND_COMPRAS: add NC_ID reference, USUARIO_ID, PUNTO_VENTA_ID
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ND_COMPRAS' AND COLUMN_NAME = 'NC_ID')
  ALTER TABLE ND_COMPRAS ADD NC_ID INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ND_COMPRAS' AND COLUMN_NAME = 'USUARIO_ID')
  ALTER TABLE ND_COMPRAS ADD USUARIO_ID INT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ND_COMPRAS' AND COLUMN_NAME = 'PUNTO_VENTA_ID')
  ALTER TABLE ND_COMPRAS ADD PUNTO_VENTA_ID INT NULL;
GO

PRINT '✅ NC Compras web extensions applied';
GO
