-- ════════════════════════════════════════════════════════════════════
--  Migración: Módulo de Integración Externa
--  - Tabla INTEGRACIONES_API_KEYS:     llaves para tienda online / app móvil
--  - Tabla INTEGRACIONES_CONFIG:       config K/V (webhook url, secret, etc.)
--  - Tabla INTEGRACIONES_SYNC_LOGS:    bitácora de sincronizaciones
--  - Columna PRODUCTOS.VENTA_WEB:      flag de exposición a tienda online
--  - Permisos:                          integraciones.ver / integraciones.administrar
--
--  Idempotente: puede ejecutarse múltiples veces sin error.
-- ════════════════════════════════════════════════════════════════════

-- ── Tabla: INTEGRACIONES_API_KEYS ─────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[INTEGRACIONES_API_KEYS]') AND type IN (N'U'))
BEGIN
    CREATE TABLE INTEGRACIONES_API_KEYS (
        API_KEY_ID     INT IDENTITY(1,1) PRIMARY KEY,
        NOMBRE         NVARCHAR(120)  NOT NULL,
        KEY_PREFIX     NVARCHAR(16)   NOT NULL,           -- primeros 8 chars visibles (para identificar)
        KEY_HASH       NVARCHAR(255)  NOT NULL,           -- bcrypt hash de la api key completa
        SCOPES         NVARCHAR(500)  NULL,               -- CSV de scopes (sync_stock, orders, etc.)
        ACTIVA         BIT            NOT NULL DEFAULT 1,
        CREATED_AT     DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),
        LAST_USED_AT   DATETIME2(0)   NULL,
        REVOKED_AT     DATETIME2(0)   NULL,
        CREATED_BY     INT            NULL,
        NOTAS          NVARCHAR(500)  NULL
    );
    CREATE INDEX IX_INTEGRACIONES_API_KEYS_ACTIVA ON INTEGRACIONES_API_KEYS(ACTIVA);
    CREATE INDEX IX_INTEGRACIONES_API_KEYS_PREFIX ON INTEGRACIONES_API_KEYS(KEY_PREFIX);
END
GO

-- ── Tabla: INTEGRACIONES_CONFIG ───────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[INTEGRACIONES_CONFIG]') AND type IN (N'U'))
BEGIN
    CREATE TABLE INTEGRACIONES_CONFIG (
        CLAVE          NVARCHAR(60)   NOT NULL PRIMARY KEY,
        VALOR          NVARCHAR(MAX)  NULL,
        UPDATED_AT     DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),
        UPDATED_BY     INT            NULL
    );
END
GO

-- Filas semilla (idempotentes)
IF NOT EXISTS (SELECT 1 FROM INTEGRACIONES_CONFIG WHERE CLAVE = 'webhook_url')
    INSERT INTO INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('webhook_url', NULL);
IF NOT EXISTS (SELECT 1 FROM INTEGRACIONES_CONFIG WHERE CLAVE = 'webhook_secret')
    INSERT INTO INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('webhook_secret', NULL);
IF NOT EXISTS (SELECT 1 FROM INTEGRACIONES_CONFIG WHERE CLAVE = 'webhook_enabled')
    INSERT INTO INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('webhook_enabled', '0');
IF NOT EXISTS (SELECT 1 FROM INTEGRACIONES_CONFIG WHERE CLAVE = 'webhook_max_retries')
    INSERT INTO INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('webhook_max_retries', '3');
IF NOT EXISTS (SELECT 1 FROM INTEGRACIONES_CONFIG WHERE CLAVE = 'orders_default_cliente_id')
    INSERT INTO INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('orders_default_cliente_id', NULL);
IF NOT EXISTS (SELECT 1 FROM INTEGRACIONES_CONFIG WHERE CLAVE = 'orders_default_punto_venta_id')
    INSERT INTO INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('orders_default_punto_venta_id', NULL);
GO

-- ── Tabla: INTEGRACIONES_SYNC_LOGS ────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[INTEGRACIONES_SYNC_LOGS]') AND type IN (N'U'))
BEGIN
    CREATE TABLE INTEGRACIONES_SYNC_LOGS (
        LOG_ID         INT IDENTITY(1,1) PRIMARY KEY,
        EVENT_TYPE     NVARCHAR(60)   NOT NULL,            -- stock.updated | order.received | sync.stock | ...
        DIRECTION      NVARCHAR(10)   NOT NULL,            -- 'OUTBOUND' (webhook saliente) | 'INBOUND' (petición recibida)
        STATUS         NVARCHAR(10)   NOT NULL,            -- 'SUCCESS' | 'ERROR' | 'PENDING'
        HTTP_STATUS    INT            NULL,
        TARGET_URL     NVARCHAR(500)  NULL,
        REQUEST_BODY   NVARCHAR(MAX)  NULL,
        RESPONSE_BODY  NVARCHAR(MAX)  NULL,
        ERROR_MESSAGE  NVARCHAR(MAX)  NULL,
        DURATION_MS    INT            NULL,
        API_KEY_ID     INT            NULL,
        CREATED_AT     DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME()
    );
    CREATE INDEX IX_INTEGRACIONES_SYNC_LOGS_CREATED ON INTEGRACIONES_SYNC_LOGS(CREATED_AT DESC);
    CREATE INDEX IX_INTEGRACIONES_SYNC_LOGS_STATUS ON INTEGRACIONES_SYNC_LOGS(STATUS);
END
GO

-- ── Columna: PRODUCTOS.VENTA_WEB ──────────────────────────────────
IF COL_LENGTH('dbo.PRODUCTOS', 'VENTA_WEB') IS NULL
BEGIN
    ALTER TABLE PRODUCTOS ADD VENTA_WEB BIT NOT NULL CONSTRAINT DF_PRODUCTOS_VENTA_WEB DEFAULT 0;
END
GO

-- ── Permisos (Integración con PERMISOS_WEB si existe) ───────────
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PERMISOS_WEB]') AND type IN (N'U'))
BEGIN
    -- Insertar en catálogo maestro
    IF NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = 'integraciones.ver')
        INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('integraciones.ver', 'Ver módulo Integraciones Externas', 'configuracion', 'lectura', 'BAJO', 40);

    IF NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = 'integraciones.administrar')
        INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('integraciones.administrar', 'Administrar Integraciones (API keys, webhook)', 'configuracion', 'admin', 'ALTO', 50);

    -- Auto-asignar a SUPERADMIN si existe
    DECLARE @SUPER_ID INT = (SELECT ROL_ID FROM ROLES WHERE NOMBRE = 'SUPERADMIN');
    IF @SUPER_ID IS NOT NULL
    BEGIN
        INSERT INTO ROLES_PERMISOS (ROL_ID, PERMISO_ID)
        SELECT @SUPER_ID, PERMISO_ID FROM PERMISOS_WEB WHERE LLAVE IN ('integraciones.ver', 'integraciones.administrar')
        AND NOT EXISTS (SELECT 1 FROM ROLES_PERMISOS WHERE ROL_ID = @SUPER_ID AND PERMISO_ID = PERMISOS_WEB.PERMISO_ID);
    END
END
GO

PRINT '✓ Migración Integraciones aplicada correctamente';
