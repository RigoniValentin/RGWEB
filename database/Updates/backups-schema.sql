-- ─────────────────────────────────────────────────────────────
-- BACKUPS — Historial, Configuración y Restauraciones
-- ─────────────────────────────────────────────────────────────
-- Estas tablas son creadas automáticamente desde el backend
-- (backup.service.ts → ensureTables) si aún no existen.
-- Este archivo queda como referencia / migración manual.
-- ─────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BACKUPS_HISTORIAL]') AND type = N'U')
BEGIN
    CREATE TABLE BACKUPS_HISTORIAL (
        BACKUP_ID         INT IDENTITY(1,1) PRIMARY KEY,
        FECHA_INICIO      DATETIME      NOT NULL,
        FECHA_FIN         DATETIME      NULL,
        DURACION_MS       INT           NULL,
        ARCHIVO_NOMBRE    NVARCHAR(260) NOT NULL,
        ARCHIVO_RUTA      NVARCHAR(500) NOT NULL,
        TAMANO_BYTES      BIGINT        NULL,
        HASH_SHA256       NVARCHAR(64)  NULL,
        ESTADO            NVARCHAR(20)  NOT NULL,  -- EN_PROGRESO | OK | ERROR
        VERIFICADO        BIT           NOT NULL DEFAULT 0,
        TIPO              NVARCHAR(20)  NOT NULL DEFAULT 'MANUAL', -- MANUAL | PROGRAMADO
        ERROR_MENSAJE     NVARCHAR(MAX) NULL,
        USUARIO_ID        INT           NULL,
        USUARIO_NOMBRE    NVARCHAR(100) NULL,
        DB_NOMBRE         NVARCHAR(128) NOT NULL
    );

    CREATE INDEX IX_BACKUPS_HISTORIAL_FECHA ON BACKUPS_HISTORIAL(FECHA_INICIO DESC);
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BACKUPS_CONFIG]') AND type = N'U')
BEGIN
    CREATE TABLE BACKUPS_CONFIG (
        ID                  INT PRIMARY KEY DEFAULT 1,
        ACTIVO              BIT           NOT NULL DEFAULT 1,
        HORARIO_CRON        NVARCHAR(50)  NOT NULL DEFAULT '0 3 * * *', -- 03:00 todos los días
        DESTINO_PATH        NVARCHAR(500) NULL,                          -- NULL = usa <rootDir>/backups
        RETENCION_DIAS      INT           NOT NULL DEFAULT 30,
        RETENCION_MIN_KEEP  INT           NOT NULL DEFAULT 7,            -- siempre conserva los N más recientes
        VERIFICAR_BACKUP    BIT           NOT NULL DEFAULT 1,
        COPY_ONLY           BIT           NOT NULL DEFAULT 1,            -- no rompe cadena diferencial
        COMPRESION          BIT           NOT NULL DEFAULT 1,
        ULTIMA_EJECUCION    DATETIME      NULL,
        ULTIMO_ESTADO       NVARCHAR(20)  NULL,
        CONSTRAINT CK_BACKUPS_CONFIG_ID CHECK (ID = 1)
    );

    INSERT INTO BACKUPS_CONFIG (ID) VALUES (1);
END
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[RESTAURACIONES_HISTORIAL]') AND type = N'U')
BEGIN
    CREATE TABLE RESTAURACIONES_HISTORIAL (
        RESTORE_ID        INT IDENTITY(1,1) PRIMARY KEY,
        FECHA_INICIO      DATETIME      NOT NULL,
        FECHA_FIN         DATETIME      NULL,
        DURACION_MS       INT           NULL,
        ARCHIVO_RUTA      NVARCHAR(500) NOT NULL,
        ARCHIVO_NOMBRE    NVARCHAR(260) NOT NULL,
        ORIGEN            NVARCHAR(20)  NOT NULL,  -- HISTORIAL | UPLOAD
        BACKUP_ID         INT           NULL,
        ESTADO            NVARCHAR(20)  NOT NULL,  -- EN_PROGRESO | OK | ERROR
        ERROR_MENSAJE     NVARCHAR(MAX) NULL,
        USUARIO_ID        INT           NULL,
        USUARIO_NOMBRE    NVARCHAR(100) NULL,
        DB_NOMBRE         NVARCHAR(128) NOT NULL
    );

    CREATE INDEX IX_RESTAURACIONES_HISTORIAL_FECHA
        ON RESTAURACIONES_HISTORIAL(FECHA_INICIO DESC);
END
GO
