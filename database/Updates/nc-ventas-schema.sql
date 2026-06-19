-- ═══════════════════════════════════════════════════════════════════════════════
--  Río Gestión Web — Notas de Crédito / Débito Ventas
--  Creates the tables needed for sales credit/debit notes.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- NC_VENTAS — Credit note header
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NC_VENTAS')
BEGIN
  CREATE TABLE NC_VENTAS (
    NC_ID             INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    VENTA_ID          INT              NOT NULL,
    CLIENTE_ID        INT              NULL,
    MONTO             DECIMAL(18,2)    NOT NULL,
    DESCUENTO         DECIMAL(18,2)    NULL,
    FECHA             DATETIME         NOT NULL,
    MOTIVO            NVARCHAR(100)    NOT NULL,
    MEDIO_PAGO        NVARCHAR(100)    NOT NULL,
    DESCRIPCION       NVARCHAR(250)    NULL,
    ANULADA           BIT              NOT NULL DEFAULT 0,
    NUMERO_FISCAL     NVARCHAR(100)    NULL,
    CAE               NVARCHAR(100)    NULL,
    CAE_VTO           NVARCHAR(20)     NULL,
    PUNTO_VENTA       NVARCHAR(100)    NULL,
    TIPO_COMPROBANTE  NVARCHAR(50)     NULL,
    NRO_COMPROBANTE   NVARCHAR(100)    NULL,
    USUARIO_ID        INT              NULL,
    PUNTO_VENTA_ID    INT              NULL,
    DESTINO_PAGO      VARCHAR(20)      NULL DEFAULT 'CAJA_CENTRAL',
    EMITIDA_FISCAL    BIT              NOT NULL DEFAULT 0,
  );
END
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- NC_VENTAS_ITEMS — Items returned / subject to credit
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NC_VENTAS_ITEMS')
BEGIN
  CREATE TABLE NC_VENTAS_ITEMS (
    NC_ITEM_ID        INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    NC_ID             INT              NOT NULL,
    VENTA_ID          INT              NOT NULL,
    PRODUCTO_ID       INT              NOT NULL,
    CANTIDAD_DEVUELTA DECIMAL(18,2)    NOT NULL,
    PRECIO_UNITARIO   DECIMAL(18,2)    NOT NULL,
    DEPOSITO_ID       INT              NULL,
  );
END
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- NC_VENTAS_HISTORIAL — Audit trail per item
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'NC_VENTAS_HISTORIAL')
BEGIN
  CREATE TABLE NC_VENTAS_HISTORIAL (
    HISTORIAL_ID              INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    VENTA_ID                  INT              NOT NULL,
    NC_ID                     INT              NOT NULL,
    FECHA                     DATETIME         NOT NULL,
    PRODUCTO_ID               INT              NOT NULL,
    CANTIDAD_ORIGINAL         DECIMAL(18,2)    NOT NULL,
    CANTIDAD_MODIFICADO       DECIMAL(18,2)    NOT NULL,
    PRECIO_ORIGINAL           DECIMAL(18,2)    NOT NULL,
    PRECIO_MODIFICADO         DECIMAL(18,2)    NOT NULL,
    TOTAL_PRODUCTO_ORIGINAL   DECIMAL(18,2)    NOT NULL,
    TOTAL_PRODUCTO_MODIFICADO DECIMAL(18,2)    NOT NULL,
    TOTAL_VENTA_ORIGINAL      DECIMAL(18,2)    NOT NULL,
    TOTAL_VENTA_MODIFICADO    DECIMAL(18,2)    NOT NULL,
    MOTIVO                    VARCHAR(50)      NOT NULL,
    DEPOSITO_ID               INT              NULL,
  );
END
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- ND_VENTAS — Debit note (reversal of a voided NC)
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'ND_VENTAS')
BEGIN
  CREATE TABLE ND_VENTAS (
    ND_ID             INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
    VENTA_ID          INT              NOT NULL,
    NC_ID             INT              NULL,
    CLIENTE_ID        INT              NULL,
    MONTO             DECIMAL(18,2)    NOT NULL,
    FECHA             DATETIME         NOT NULL,
    MOTIVO            NVARCHAR(100)    NOT NULL,
    MEDIO_PAGO        NVARCHAR(100)    NOT NULL,
    DESCRIPCION       NVARCHAR(250)    NULL,
    ANULADA           BIT              NOT NULL DEFAULT 0,
    NUMERO_FISCAL     NVARCHAR(100)    NULL,
    CAE               NVARCHAR(100)    NULL,
    PUNTO_VENTA       NVARCHAR(100)    NULL,
    TIPO_COMPROBANTE  NVARCHAR(50)     NULL,
    USUARIO_ID        INT              NULL,
    PUNTO_VENTA_ID    INT              NULL,
  );
END
GO

PRINT '✅ NC Ventas schema applied';
GO
