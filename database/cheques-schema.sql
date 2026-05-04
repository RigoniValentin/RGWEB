-- ─────────────────────────────────────────────────────────────
-- CHEQUES — Gestión de cheques (cartera, egresos, depósitos)
-- ─────────────────────────────────────────────────────────────
-- Estas tablas también son creadas automáticamente desde el
-- backend (cheques.service.ts → ensureChequesTables) si no
-- existen. Este archivo queda como referencia / migración manual.
--
-- Ciclo de vida del cheque:
--   EN_CARTERA  (default al ingresar por una venta/cobranza)
--   EGRESADO    (entregado a un proveedor para pago/endoso)
--   DEPOSITADO  (depositado al banco para acreditación)
--   ANULADO     (descartado)
-- ─────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CHEQUES]') AND type = N'U')
BEGIN
    CREATE TABLE CHEQUES (
        CHEQUE_ID            INT IDENTITY(1,1) PRIMARY KEY,
        BANCO                NVARCHAR(120) NOT NULL,
        LIBRADOR             NVARCHAR(180) NOT NULL,
        NUMERO               NVARCHAR(40)  NOT NULL,
        IMPORTE              DECIMAL(18,2) NOT NULL,
        PORTADOR             NVARCHAR(180) NULL,
        FECHA_INGRESO        DATETIME      NOT NULL DEFAULT GETDATE(),
        FECHA_PRESENTACION   DATE          NULL,         -- Vencimiento
        FECHA_SALIDA         DATETIME      NULL,         -- Cuando deja la cartera
        ESTADO               NVARCHAR(20)  NOT NULL DEFAULT 'EN_CARTERA',
        ORIGEN_TIPO          NVARCHAR(20)  NULL,         -- VENTA | COBRANZA | MANUAL
        ORIGEN_ID            INT           NULL,
        DESTINO_TIPO         NVARCHAR(20)  NULL,         -- COMPRA | ORDEN_PAGO | DEPOSITO_BANCO | OTRO
        DESTINO_ID           INT           NULL,
        DESTINO_DESC         NVARCHAR(255) NULL,
        OBSERVACIONES        NVARCHAR(500) NULL,
        USUARIO_ID           INT           NULL,
        USUARIO_NOMBRE       NVARCHAR(100) NULL,
        FECHA_CREACION       DATETIME      NOT NULL DEFAULT GETDATE(),
        FECHA_ACTUALIZACION  DATETIME      NULL,
        CONSTRAINT CK_CHEQUES_ESTADO CHECK (ESTADO IN ('EN_CARTERA','EGRESADO','DEPOSITADO','ANULADO'))
    );

    CREATE INDEX IX_CHEQUES_ESTADO         ON CHEQUES(ESTADO);
    CREATE INDEX IX_CHEQUES_FECHA_INGRESO  ON CHEQUES(FECHA_INGRESO DESC);
    CREATE INDEX IX_CHEQUES_NUMERO         ON CHEQUES(NUMERO);
    CREATE INDEX IX_CHEQUES_ORIGEN         ON CHEQUES(ORIGEN_TIPO, ORIGEN_ID);
    CREATE INDEX IX_CHEQUES_DESTINO        ON CHEQUES(DESTINO_TIPO, DESTINO_ID);
END
GO

-- Bitácora de cambios de estado (auditoría liviana propia)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CHEQUES_HISTORIAL]') AND type = N'U')
BEGIN
    CREATE TABLE CHEQUES_HISTORIAL (
        ID              INT IDENTITY(1,1) PRIMARY KEY,
        CHEQUE_ID       INT           NOT NULL,
        ESTADO_ANTERIOR NVARCHAR(20)  NULL,
        ESTADO_NUEVO    NVARCHAR(20)  NOT NULL,
        DESCRIPCION     NVARCHAR(500) NULL,
        USUARIO_ID      INT           NULL,
        USUARIO_NOMBRE  NVARCHAR(100) NULL,
        FECHA           DATETIME      NOT NULL DEFAULT GETDATE()
    );

    CREATE INDEX IX_CHEQUES_HISTORIAL_CHEQUE ON CHEQUES_HISTORIAL(CHEQUE_ID, FECHA DESC);
END
GO

-- Permitir 'CHEQUES' como categoría válida en METODOS_PAGO
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_METODOS_PAGO_CATEGORIA')
BEGIN
    ALTER TABLE METODOS_PAGO DROP CONSTRAINT CK_METODOS_PAGO_CATEGORIA;
    ALTER TABLE METODOS_PAGO ADD CONSTRAINT CK_METODOS_PAGO_CATEGORIA
        CHECK (CATEGORIA IN ('EFECTIVO','DIGITAL','CHEQUES'));
END
GO

-- Sembrar método de pago "Cheque" (CATEGORIA=CHEQUES) si no existe
IF NOT EXISTS (SELECT 1 FROM METODOS_PAGO WHERE CATEGORIA = 'CHEQUES')
BEGIN
    DECLARE @nextId INT = ISNULL((SELECT MAX(METODO_PAGO_ID) FROM METODOS_PAGO), 0) + 1;
    INSERT INTO METODOS_PAGO (METODO_PAGO_ID, NOMBRE, CATEGORIA, ACTIVA, POR_DEFECTO)
    VALUES (@nextId, 'Cheque', 'CHEQUES', 1, 0);
END
GO
