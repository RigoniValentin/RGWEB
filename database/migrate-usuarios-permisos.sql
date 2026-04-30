-- ═══════════════════════════════════════════════════════════════════════════════
--  Río Gestión Web — Usuarios, Roles y Permisos (Seguridad Profesional)
--  DB: SesamoDB (SQL Server)
--
--  Objetivo: elevar el módulo de autenticación/autorización a estándares
--  profesionales (OWASP ASVS L2, NIST SP 800-63B) SIN romper las tablas
--  existentes usadas por la aplicación de escritorio (C#):
--     - USUARIOS (USUARIO_ID, NOMBRE, CLAVE)
--     - ACCIONES_ACCESO (ACCION_ID, DESCRIPCION, LLAVE)
--     - PERMISO_ACCIONES (USUARIO_ID, ACCION_ID, ACTIVO)
--     - USUARIOS_PUNTOS_VENTA (USUARIO_ID, PUNTO_VENTA_ID, ES_PREFERIDO)
--
--  Todas las modificaciones son aditivas (ADD COLUMN / CREATE TABLE IF NOT
--  EXISTS). Los datos actuales quedan intactos; el backend migra las claves
--  en texto plano a hash bcrypt la primera vez que el usuario inicia sesión
--  (ver auth.service.ts — rehash on login).
--
--  NOTA: ACCIONES_ACCESO y PERMISO_ACCIONES NO se modifican ni eliminan;
--  siguen siendo usadas por la app de escritorio C#. El sistema web usa
--  PERMISOS_WEB, ROLES_PERMISOS, USUARIOS_PERMISOS_OVERRIDE en su lugar.
--
--  Ejecutar una sola vez contra la base SesamoDB.
-- ═══════════════════════════════════════════════════════════════════════════════
SET NOCOUNT ON;
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. USUARIOS  — columnas de seguridad (ADD COLUMN, no destructivo)
-- ═════════════════════════════════════════════════════════════════════════════
--  La columna heredada CLAVE se mantiene por compatibilidad con la app de
--  escritorio; el backend web usará CLAVE_HASH. Cuando el usuario se
--  autentique por web la primera vez, se calcula el hash y se limpia CLAVE.
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='CLAVE_HASH')
  ALTER TABLE USUARIOS ADD CLAVE_HASH VARCHAR(255) NULL;        -- Argon2id / bcrypt ($argon2id$...)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='CLAVE_ALGO')
  ALTER TABLE USUARIOS ADD CLAVE_ALGO VARCHAR(20)  NULL;         -- 'argon2id','bcrypt'
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='CLAVE_ACTUALIZADA')
  ALTER TABLE USUARIOS ADD CLAVE_ACTUALIZADA DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='DEBE_CAMBIAR_CLAVE')
  ALTER TABLE USUARIOS ADD DEBE_CAMBIAR_CLAVE BIT NOT NULL DEFAULT 0 WITH VALUES;

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='EMAIL')
  ALTER TABLE USUARIOS ADD EMAIL NVARCHAR(255) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='EMAIL_VERIFICADO')
  ALTER TABLE USUARIOS ADD EMAIL_VERIFICADO BIT NOT NULL DEFAULT 0 WITH VALUES;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='TELEFONO')
  ALTER TABLE USUARIOS ADD TELEFONO NVARCHAR(30) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='NOMBRE_COMPLETO')
  ALTER TABLE USUARIOS ADD NOMBRE_COMPLETO NVARCHAR(150) NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='AVATAR_BASE64')
  ALTER TABLE USUARIOS ADD AVATAR_BASE64 NVARCHAR(MAX) NULL;

-- Estado / lockout
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='ACTIVO')
  ALTER TABLE USUARIOS ADD ACTIVO BIT NOT NULL DEFAULT 1 WITH VALUES;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='BLOQUEADO')
  ALTER TABLE USUARIOS ADD BLOQUEADO BIT NOT NULL DEFAULT 0 WITH VALUES;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='BLOQUEADO_HASTA')
  ALTER TABLE USUARIOS ADD BLOQUEADO_HASTA DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='INTENTOS_FALLIDOS')
  ALTER TABLE USUARIOS ADD INTENTOS_FALLIDOS INT NOT NULL DEFAULT 0 WITH VALUES;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='ULTIMO_LOGIN')
  ALTER TABLE USUARIOS ADD ULTIMO_LOGIN DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='ULTIMO_LOGIN_IP')
  ALTER TABLE USUARIOS ADD ULTIMO_LOGIN_IP VARCHAR(45) NULL;     -- IPv6 compatible
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='ULTIMO_LOGIN_FALLIDO')
  ALTER TABLE USUARIOS ADD ULTIMO_LOGIN_FALLIDO DATETIME2 NULL;

-- 2FA (TOTP RFC 6238)
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='MFA_ACTIVO')
  ALTER TABLE USUARIOS ADD MFA_ACTIVO BIT NOT NULL DEFAULT 0 WITH VALUES;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='MFA_SECRETO')
  ALTER TABLE USUARIOS ADD MFA_SECRETO VARBINARY(256) NULL;      -- encriptado AES-GCM con clave de app
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='MFA_RECUPERACION')
  ALTER TABLE USUARIOS ADD MFA_RECUPERACION NVARCHAR(MAX) NULL;  -- JSON de códigos de respaldo hasheados

-- Soft delete + auditoría
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='FECHA_ALTA')
  ALTER TABLE USUARIOS ADD FECHA_ALTA DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME() WITH VALUES;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='FECHA_BAJA')
  ALTER TABLE USUARIOS ADD FECHA_BAJA DATETIME2 NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='CREADO_POR')
  ALTER TABLE USUARIOS ADD CREADO_POR INT NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='MODIFICADO_POR')
  ALTER TABLE USUARIOS ADD MODIFICADO_POR INT NULL;
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='USUARIOS' AND COLUMN_NAME='FECHA_MODIFICACION')
  ALTER TABLE USUARIOS ADD FECHA_MODIFICACION DATETIME2 NULL;
GO

-- Índices / unicidad
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_USUARIOS_NOMBRE')
  CREATE UNIQUE INDEX UX_USUARIOS_NOMBRE ON USUARIOS(NOMBRE) WHERE FECHA_BAJA IS NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='UX_USUARIOS_EMAIL')
  CREATE UNIQUE INDEX UX_USUARIOS_EMAIL ON USUARIOS(EMAIL) WHERE EMAIL IS NOT NULL AND FECHA_BAJA IS NULL;
GO
PRINT '✅ USUARIOS: columnas de seguridad';
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. ROLES  — agrupación de permisos (RBAC)
-- ═════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ROLES')
BEGIN
  CREATE TABLE ROLES (
    ROL_ID            INT IDENTITY(1,1) PRIMARY KEY,
    NOMBRE            NVARCHAR(60)   NOT NULL,
    DESCRIPCION       NVARCHAR(255)  NULL,
    ES_SISTEMA        BIT            NOT NULL DEFAULT 0,   -- rol built-in, no se puede eliminar
    PRIORIDAD         INT            NOT NULL DEFAULT 100, -- menor = más alto (admin=0)
    ACTIVO            BIT            NOT NULL DEFAULT 1,
    FECHA_ALTA        DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    FECHA_MODIFICACION DATETIME2     NULL,
    CREADO_POR        INT            NULL,
    MODIFICADO_POR    INT            NULL,
    CONSTRAINT UQ_ROLES_NOMBRE UNIQUE (NOMBRE)
  );
  PRINT '✅ ROLES';
END
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. USUARIOS_ROLES  — N:M usuario↔rol, con vigencia opcional
-- ═════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='USUARIOS_ROLES')
BEGIN
  CREATE TABLE USUARIOS_ROLES (
    USUARIO_ID     INT           NOT NULL,
    ROL_ID         INT           NOT NULL,
    ASIGNADO_POR   INT           NULL,
    FECHA_ASIGNADO DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    VALIDO_DESDE   DATETIME2     NULL,
    VALIDO_HASTA   DATETIME2     NULL,
    ACTIVO         BIT           NOT NULL DEFAULT 1,
    CONSTRAINT PK_USUARIOS_ROLES PRIMARY KEY (USUARIO_ID, ROL_ID),
    CONSTRAINT FK_UR_USUARIO FOREIGN KEY (USUARIO_ID) REFERENCES USUARIOS(USUARIO_ID),
    CONSTRAINT FK_UR_ROL     FOREIGN KEY (ROL_ID)     REFERENCES ROLES(ROL_ID)
  );
  PRINT '✅ USUARIOS_ROLES';
END
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. PERMISOS_WEB  — Catálogo de permisos nativo del sistema web
--    Tabla propia, independiente de ACCIONES_ACCESO (usada por la app C#).
--    IDENTITY PK: no requiere cálculos de ID manuales.
-- ═════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='PERMISOS_WEB')
BEGIN
  CREATE TABLE PERMISOS_WEB (
    PERMISO_ID  INT IDENTITY(1,1) PRIMARY KEY,
    LLAVE       VARCHAR(100)   NOT NULL,
    DESCRIPCION NVARCHAR(255)  NOT NULL,
    MODULO      VARCHAR(50)    NOT NULL DEFAULT '',
    CATEGORIA   VARCHAR(30)    NOT NULL DEFAULT 'lectura',  -- lectura|escritura|admin|reporte
    RIESGO      VARCHAR(10)    NOT NULL DEFAULT 'BAJO',     -- BAJO|MEDIO|ALTO|CRITICO
    ORDEN       INT            NOT NULL DEFAULT 0,
    ACTIVO      BIT            NOT NULL DEFAULT 1,
    FECHA_ALTA  DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT UQ_PERMISOS_WEB_LLAVE UNIQUE (LLAVE)
  );
  CREATE INDEX IX_PERMISOS_WEB_MODULO ON PERMISOS_WEB(MODULO, ORDEN);
  PRINT '✅ PERMISOS_WEB';
END
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. ROLES_PERMISOS  — permisos agrupados por rol (RBAC)
--    Referencia PERMISOS_WEB (web) en lugar de ACCIONES_ACCESO (legacy C#).
--    Si existe la versión anterior (FK_RP_ACCION → ACCIONES_ACCESO),
--    se descarta y se crea limpia con FK_RP_PERMISO → PERMISOS_WEB.
-- ═════════════════════════════════════════════════════════════════════════════
-- Eliminar versión legacy si tenía FK a ACCIONES_ACCESO
IF OBJECT_ID('ROLES_PERMISOS', 'U') IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM sys.foreign_keys
     WHERE name = 'FK_RP_ACCION'
       AND parent_object_id = OBJECT_ID('ROLES_PERMISOS')
   )
BEGIN
  DROP TABLE ROLES_PERMISOS;
END
GO

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ROLES_PERMISOS')
BEGIN
  CREATE TABLE ROLES_PERMISOS (
    ROL_ID      INT NOT NULL,
    PERMISO_ID  INT NOT NULL,
    CONSTRAINT PK_ROLES_PERMISOS PRIMARY KEY (ROL_ID, PERMISO_ID),
    CONSTRAINT FK_RP_ROL     FOREIGN KEY (ROL_ID)     REFERENCES ROLES(ROL_ID)      ON DELETE CASCADE,
    CONSTRAINT FK_RP_PERMISO FOREIGN KEY (PERMISO_ID) REFERENCES PERMISOS_WEB(PERMISO_ID) ON DELETE CASCADE
  );
  PRINT '✅ ROLES_PERMISOS';
END
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 5.5 USUARIOS_PERMISOS_OVERRIDE  — Overrides de permiso por usuario (web)
--     Reemplaza el uso de PERMISO_ACCIONES (legacy C#) en el sistema web.
--     ACTIVO=1: concede el permiso aunque el rol no lo tenga.
--     ACTIVO=0: deniega el permiso aunque el rol lo tenga.
-- ═════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='USUARIOS_PERMISOS_OVERRIDE')
BEGIN
  CREATE TABLE USUARIOS_PERMISOS_OVERRIDE (
    USUARIO_ID   INT       NOT NULL,
    PERMISO_ID   INT       NOT NULL,
    ACTIVO       BIT       NOT NULL,
    OTORGADO_POR INT       NULL,
    FECHA        DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_UPO PRIMARY KEY (USUARIO_ID, PERMISO_ID),
    CONSTRAINT FK_UPO_USUARIO FOREIGN KEY (USUARIO_ID) REFERENCES USUARIOS(USUARIO_ID) ON DELETE CASCADE,
    CONSTRAINT FK_UPO_PERMISO FOREIGN KEY (PERMISO_ID) REFERENCES PERMISOS_WEB(PERMISO_ID) ON DELETE CASCADE
  );
  PRINT '✅ USUARIOS_PERMISOS_OVERRIDE';
END
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. USUARIOS_CLAVES_HISTORIAL  — evita reutilización de últimas N claves
-- ═════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='USUARIOS_CLAVES_HISTORIAL')
BEGIN
  CREATE TABLE USUARIOS_CLAVES_HISTORIAL (
    HISTORIAL_ID   BIGINT IDENTITY(1,1) PRIMARY KEY,
    USUARIO_ID     INT          NOT NULL,
    CLAVE_HASH     VARCHAR(255) NOT NULL,
    CLAVE_ALGO     VARCHAR(20)  NOT NULL,
    FECHA          DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_UCH_USR FOREIGN KEY (USUARIO_ID) REFERENCES USUARIOS(USUARIO_ID) ON DELETE CASCADE
  );
  CREATE INDEX IX_UCH_USUARIO ON USUARIOS_CLAVES_HISTORIAL(USUARIO_ID, FECHA DESC);
  PRINT '✅ USUARIOS_CLAVES_HISTORIAL';
END
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 7. USUARIOS_SESIONES  — refresh tokens / sesiones activas (revocables)
--     Guardamos el hash SHA-256 del refresh token (NUNCA el token en claro).
-- ═════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='USUARIOS_SESIONES')
BEGIN
  CREATE TABLE USUARIOS_SESIONES (
    SESION_ID         UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
    USUARIO_ID        INT              NOT NULL,
    REFRESH_TOKEN_HASH CHAR(64)        NOT NULL,    -- SHA-256 hex
    USER_AGENT        NVARCHAR(500)    NULL,
    IP                VARCHAR(45)      NULL,
    DISPOSITIVO       NVARCHAR(100)    NULL,
    FECHA_CREACION    DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    FECHA_EXPIRACION  DATETIME2        NOT NULL,
    FECHA_ULTIMO_USO  DATETIME2        NULL,
    REVOCADA          BIT              NOT NULL DEFAULT 0,
    REVOCADA_FECHA    DATETIME2        NULL,
    REVOCADA_MOTIVO   NVARCHAR(120)    NULL,
    CONSTRAINT FK_US_USUARIO FOREIGN KEY (USUARIO_ID) REFERENCES USUARIOS(USUARIO_ID) ON DELETE CASCADE
  );
  CREATE INDEX IX_US_USUARIO  ON USUARIOS_SESIONES(USUARIO_ID, REVOCADA);
  CREATE INDEX IX_US_TOKENHASH ON USUARIOS_SESIONES(REFRESH_TOKEN_HASH);
  PRINT '✅ USUARIOS_SESIONES';
END
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 8. USUARIOS_TOKENS  — tokens de un solo uso (reset password, verif. email,
--                        invitación, aprobación MFA)
--     Guardamos solo HASH del token.
-- ═════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='USUARIOS_TOKENS')
BEGIN
  CREATE TABLE USUARIOS_TOKENS (
    TOKEN_ID       BIGINT IDENTITY(1,1) PRIMARY KEY,
    USUARIO_ID     INT              NOT NULL,
    TIPO           VARCHAR(30)      NOT NULL,   -- RESET_PASSWORD | VERIF_EMAIL | INVITACION | MFA_RECOVERY
    TOKEN_HASH     CHAR(64)         NOT NULL,   -- SHA-256 hex
    FECHA_CREACION DATETIME2        NOT NULL DEFAULT SYSUTCDATETIME(),
    FECHA_EXPIRACION DATETIME2      NOT NULL,
    USADO          BIT              NOT NULL DEFAULT 0,
    USADO_FECHA    DATETIME2        NULL,
    IP_SOLICITUD   VARCHAR(45)      NULL,
    IP_USO         VARCHAR(45)      NULL,
    CONSTRAINT FK_UT_USUARIO FOREIGN KEY (USUARIO_ID) REFERENCES USUARIOS(USUARIO_ID) ON DELETE CASCADE
  );
  CREATE INDEX IX_UT_TOKENHASH ON USUARIOS_TOKENS(TOKEN_HASH, TIPO) WHERE USADO = 0;
  PRINT '✅ USUARIOS_TOKENS';
END
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 9. AUDITORIA_SEGURIDAD  — log append-only de eventos de seguridad
-- ═════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='AUDITORIA_SEGURIDAD')
BEGIN
  CREATE TABLE AUDITORIA_SEGURIDAD (
    AUDIT_ID      BIGINT IDENTITY(1,1) PRIMARY KEY,
    FECHA         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    USUARIO_ID    INT           NULL,             -- NULL cuando el actor es anónimo (login fallido de usuario inexistente)
    ACTOR_NOMBRE  NVARCHAR(100) NULL,             -- username intentado
    EVENTO        VARCHAR(60)   NOT NULL,         -- LOGIN_OK, LOGIN_FAIL, LOCKOUT, LOGOUT, PASSWORD_CHANGE,
                                                  -- PASSWORD_RESET_REQ, PASSWORD_RESET_OK, MFA_ENABLE, MFA_DISABLE,
                                                  -- MFA_FAIL, ROL_ASIGNADO, ROL_REVOCADO, PERMISO_CAMBIO,
                                                  -- USUARIO_CREADO, USUARIO_BLOQUEADO, USUARIO_DESBLOQUEADO,
                                                  -- USUARIO_ELIMINADO, SESION_REVOCADA
    RESULTADO     VARCHAR(10)   NOT NULL DEFAULT 'OK',  -- OK | FAIL | DENIED
    IP            VARCHAR(45)   NULL,
    USER_AGENT    NVARCHAR(500) NULL,
    DETALLE       NVARCHAR(MAX) NULL,             -- JSON con contexto
    ENTIDAD_TIPO  VARCHAR(30)   NULL,             -- USUARIO | ROL | PERMISO | SESION
    ENTIDAD_ID    INT           NULL
  );
  CREATE INDEX IX_AUDSEG_USUARIO ON AUDITORIA_SEGURIDAD(USUARIO_ID, FECHA DESC);
  CREATE INDEX IX_AUDSEG_EVENTO  ON AUDITORIA_SEGURIDAD(EVENTO, FECHA DESC);
  CREATE INDEX IX_AUDSEG_FECHA   ON AUDITORIA_SEGURIDAD(FECHA DESC);
  PRINT '✅ AUDITORIA_SEGURIDAD';
END
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 10. POLITICA_SEGURIDAD  — parámetros configurables (1 sola fila)
-- ═════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='POLITICA_SEGURIDAD')
BEGIN
  CREATE TABLE POLITICA_SEGURIDAD (
    POLITICA_ID               INT          NOT NULL PRIMARY KEY DEFAULT 1,
    CLAVE_LONGITUD_MIN        INT          NOT NULL DEFAULT 10,
    CLAVE_REQUIERE_MAYUS      BIT          NOT NULL DEFAULT 1,
    CLAVE_REQUIERE_MINUS      BIT          NOT NULL DEFAULT 1,
    CLAVE_REQUIERE_NUMERO     BIT          NOT NULL DEFAULT 1,
    CLAVE_REQUIERE_SIMBOLO    BIT          NOT NULL DEFAULT 0,
    CLAVE_EXPIRA_DIAS         INT          NOT NULL DEFAULT 0,    -- 0 = no expira (NIST 800-63B recomienda no expirar)
    CLAVE_HISTORIAL           INT          NOT NULL DEFAULT 5,    -- N últimas claves a evitar
    LOCKOUT_INTENTOS          INT          NOT NULL DEFAULT 5,
    LOCKOUT_MINUTOS           INT          NOT NULL DEFAULT 15,
    SESION_DURACION_MINUTOS   INT          NOT NULL DEFAULT 60,   -- access token
    REFRESH_DURACION_DIAS     INT          NOT NULL DEFAULT 7,
    SESION_INACTIVIDAD_MIN    INT          NOT NULL DEFAULT 30,
    MFA_OBLIGATORIO_ADMIN     BIT          NOT NULL DEFAULT 1,
    MFA_OBLIGATORIO_TODOS     BIT          NOT NULL DEFAULT 0,
    FECHA_MODIFICACION        DATETIME2    NOT NULL DEFAULT SYSUTCDATETIME(),
    MODIFICADO_POR            INT          NULL,
    CONSTRAINT CK_POLITICA_SINGLETON CHECK (POLITICA_ID = 1)
  );
  INSERT INTO POLITICA_SEGURIDAD (POLITICA_ID) VALUES (1);
  PRINT '✅ POLITICA_SEGURIDAD';
END
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 11. SEED  — Roles del sistema y acciones base
-- ═════════════════════════════════════════════════════════════════════════════
IF NOT EXISTS (SELECT 1 FROM ROLES WHERE NOMBRE = 'SUPERADMIN')
  INSERT INTO ROLES (NOMBRE, DESCRIPCION, ES_SISTEMA, PRIORIDAD)
  VALUES ('SUPERADMIN', 'Acceso total al sistema (no se puede modificar ni eliminar)', 1, 0);

IF NOT EXISTS (SELECT 1 FROM ROLES WHERE NOMBRE = 'ADMIN')
  INSERT INTO ROLES (NOMBRE, DESCRIPCION, ES_SISTEMA, PRIORIDAD)
  VALUES ('ADMIN', 'Administrador de la empresa', 1, 10);

IF NOT EXISTS (SELECT 1 FROM ROLES WHERE NOMBRE = 'GERENTE')
  INSERT INTO ROLES (NOMBRE, DESCRIPCION, ES_SISTEMA, PRIORIDAD)
  VALUES ('GERENTE', 'Supervisión y reportes', 1, 20);

IF NOT EXISTS (SELECT 1 FROM ROLES WHERE NOMBRE = 'CAJERO')
  INSERT INTO ROLES (NOMBRE, DESCRIPCION, ES_SISTEMA, PRIORIDAD)
  VALUES ('CAJERO', 'Operador de caja y ventas', 1, 50);

IF NOT EXISTS (SELECT 1 FROM ROLES WHERE NOMBRE = 'VENDEDOR')
  INSERT INTO ROLES (NOMBRE, DESCRIPCION, ES_SISTEMA, PRIORIDAD)
  VALUES ('VENDEDOR', 'Solo ventas y consulta de productos', 1, 60);

IF NOT EXISTS (SELECT 1 FROM ROLES WHERE NOMBRE = 'SOLO_LECTURA')
  INSERT INTO ROLES (NOMBRE, DESCRIPCION, ES_SISTEMA, PRIORIDAD)
  VALUES ('SOLO_LECTURA', 'Consulta de información, sin escritura', 1, 90);
GO

-- Catálogo completo de permisos del sistema web.
-- PERMISOS_WEB usa IDENTITY — no se necesita calcular PERMISO_ID.

WITH nuevos AS (
  SELECT LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN
  FROM (VALUES
    -- Usuarios y seguridad
    ('usuarios.ver',              'Ver usuarios',                    'usuarios',      'lectura',   'BAJO',    10),
    ('usuarios.crear',            'Crear usuario',                   'usuarios',      'escritura', 'ALTO',    20),
    ('usuarios.editar',           'Editar usuario',                  'usuarios',      'escritura', 'ALTO',    30),
    ('usuarios.eliminar',         'Eliminar usuario',                'usuarios',      'admin',     'CRITICO', 40),
    ('usuarios.roles.asignar',    'Asignar roles a usuario',         'usuarios',      'admin',     'CRITICO', 50),
    ('usuarios.permisos.editar',  'Editar permisos de usuario',      'usuarios',      'admin',     'CRITICO', 60),
    ('usuarios.sesiones.ver',     'Ver sesiones activas',            'usuarios',      'lectura',   'MEDIO',   70),
    ('usuarios.sesiones.revocar', 'Revocar sesiones',                'usuarios',      'admin',     'ALTO',    80),
    ('usuarios.auditoria.ver',    'Ver auditoría de seguridad',      'usuarios',      'reporte',   'MEDIO',   90),
    ('usuarios.politica.editar',  'Editar política de seguridad',    'usuarios',      'admin',     'CRITICO', 100),
    -- Dashboard
    ('dashboard.ver',             'Ver dashboard',                   'dashboard',     'lectura',   'BAJO',    10),
    -- Clientes
    ('clientes.ver',              'Ver clientes',                    'clientes',      'lectura',   'BAJO',    10),
    ('clientes.crear',            'Crear cliente',                   'clientes',      'escritura', 'MEDIO',   20),
    ('clientes.editar',           'Editar cliente',                  'clientes',      'escritura', 'MEDIO',   30),
    ('clientes.eliminar',         'Eliminar cliente',                'clientes',      'admin',     'ALTO',    40),
    -- Productos
    ('productos.ver',             'Ver productos',                   'productos',     'lectura',   'BAJO',    10),
    ('productos.crear',           'Crear producto',                  'productos',     'escritura', 'MEDIO',   20),
    ('productos.editar',          'Editar producto',                 'productos',     'escritura', 'MEDIO',   30),
    ('productos.eliminar',        'Eliminar producto',               'productos',     'admin',     'ALTO',    40),
    -- Ventas
    ('ventas.ver',                'Ver ventas',                      'ventas',        'lectura',   'BAJO',    10),
    ('ventas.crear',              'Crear venta',                     'ventas',        'escritura', 'MEDIO',   20),
    ('ventas.anular',             'Anular venta',                    'ventas',        'admin',     'ALTO',    30),
    ('ventas.nc.crear',           'Crear nota de crédito de venta',  'ventas',        'escritura', 'ALTO',    40),
    -- Compras
    ('compras.ver',               'Ver compras',                     'compras',       'lectura',   'BAJO',    10),
    ('compras.crear',             'Registrar compra',                'compras',       'escritura', 'MEDIO',   20),
    ('compras.nc.crear',          'Crear nota de crédito de compra', 'compras',       'escritura', 'ALTO',    30),
    -- Proveedores
    ('proveedores.ver',           'Ver proveedores',                 'proveedores',   'lectura',   'BAJO',    10),
    ('proveedores.crear',         'Crear proveedor',                 'proveedores',   'escritura', 'MEDIO',   20),
    ('proveedores.editar',        'Editar proveedor',                'proveedores',   'escritura', 'MEDIO',   30),
    -- Caja
    ('caja.ver',                  'Ver listado de cajas',                       'caja', 'lectura',   'MEDIO',  10),
    ('caja.abrir',                'Abrir caja',                                 'caja', 'escritura', 'ALTO',   15),
    ('caja.cerrar',               'Cerrar caja',                                'caja', 'escritura', 'ALTO',   20),
    ('caja.ingreso',              'Registrar ingreso de dinero en caja',        'caja', 'escritura', 'ALTO',   25),
    ('caja.egreso',               'Registrar egreso de dinero en caja',         'caja', 'escritura', 'ALTO',   30),
    ('caja.operar',               'Operar caja (alias legacy: abrir+cerrar+IE)','caja', 'escritura', 'ALTO',   35),
    ('caja.central.ver',          'Ver caja central',                           'caja', 'lectura',   'MEDIO',  40),
    ('caja.central.operar',       'Movimientos en caja central',                'caja', 'escritura', 'ALTO',   50),
    ('caja.depositos.ver',        'Ver depósitos',                              'caja', 'lectura',   'MEDIO',  60),
    ('caja.depositos.crear',      'Registrar depósito',                         'caja', 'escritura', 'ALTO',   70),
    -- Finanzas
    ('cobranzas.ver',             'Ver cobranzas',                   'finanzas',      'lectura',   'BAJO',    10),
    ('cobranzas.crear',           'Registrar cobranza',              'finanzas',      'escritura', 'MEDIO',   20),
    ('ordenes_pago.ver',          'Ver órdenes de pago',             'finanzas',      'lectura',   'BAJO',    30),
    ('ordenes_pago.crear',        'Crear orden de pago',             'finanzas',      'escritura', 'ALTO',    40),
    ('cta_corriente.ver',         'Ver cuenta corriente clientes',   'finanzas',      'lectura',   'BAJO',    50),
    ('cta_corriente_prov.ver',    'Ver cuenta corriente proveedores','finanzas',      'lectura',   'BAJO',    60),
    -- Inventario
    ('stock.ver',                 'Ver stock',                       'inventario',    'lectura',   'BAJO',    10),
    ('stock.ajustar',             'Ajustar stock',                   'inventario',    'escritura', 'ALTO',    20),
    ('remitos.ver',               'Ver remitos',                     'inventario',    'lectura',   'BAJO',    30),
    ('remitos.crear',             'Crear remito',                    'inventario',    'escritura', 'MEDIO',   40),
    -- Catálogo
    ('catalogo.ver',              'Ver catálogo y categorías',       'catalogo',      'lectura',   'BAJO',    10),
    ('catalogo.editar',           'Editar catálogo y categorías',    'catalogo',      'escritura', 'MEDIO',   20),
    -- Gastronomía
    ('gastronomy.mesas.ver',      'Ver gestión de mesas',            'gastronomia',   'lectura',   'BAJO',    10),
    ('gastronomy.mesas.operar',   'Operar mesas y comandas',         'gastronomia',   'escritura', 'MEDIO',   20),
    -- Reportes
    ('reportes.iva.ver',          'Ver libro IVA ventas',            'reportes',      'reporte',   'MEDIO',   10),
    ('reportes.iva.compras.ver',  'Ver libro IVA compras',           'reportes',      'reporte',   'MEDIO',   11),
    -- Configuración
    ('configuracion.ver',         'Ver configuración del sistema',   'configuracion', 'lectura',   'BAJO',    10),
    ('configuracion.editar',      'Editar configuración del sistema','configuracion', 'admin',     'ALTO',    20),
    -- Backups
    ('backups.administrar',       'Administrar copias de seguridad', 'configuracion', 'admin',     'ALTO',    30)
  ) AS v(LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
  WHERE NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = v.LLAVE)
)
INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
SELECT LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN FROM nuevos;
GO
PRINT '✅ PERMISOS_WEB: catálogo base insertado';
GO

-- SUPERADMIN recibe todos los permisos web activos
DECLARE @SUPER INT = (SELECT ROL_ID FROM ROLES WHERE NOMBRE = 'SUPERADMIN');
INSERT INTO ROLES_PERMISOS (ROL_ID, PERMISO_ID)
SELECT @SUPER, p.PERMISO_ID
FROM PERMISOS_WEB p
WHERE p.ACTIVO = 1
  AND NOT EXISTS (SELECT 1 FROM ROLES_PERMISOS rp WHERE rp.ROL_ID = @SUPER AND rp.PERMISO_ID = p.PERMISO_ID);
GO

-- ADMIN recibe todos los permisos excepto edición de política de seguridad y
-- gestión de otros admins (no puede crear/editar/eliminar usuarios ni cambiar
-- roles/permisos de terceros — eso queda reservado al SUPERADMIN).
DECLARE @ADMIN INT = (SELECT ROL_ID FROM ROLES WHERE NOMBRE = 'ADMIN');
INSERT INTO ROLES_PERMISOS (ROL_ID, PERMISO_ID)
SELECT @ADMIN, p.PERMISO_ID
FROM PERMISOS_WEB p
WHERE p.ACTIVO = 1
  AND p.LLAVE NOT IN (
    'usuarios.crear',
    'usuarios.editar',
    'usuarios.eliminar',
    'usuarios.roles.asignar',
    'usuarios.permisos.editar',
    'usuarios.politica.editar'
  )
  AND NOT EXISTS (SELECT 1 FROM ROLES_PERMISOS rp WHERE rp.ROL_ID = @ADMIN AND rp.PERMISO_ID = p.PERMISO_ID);
GO
PRINT '✅ ROLES_PERMISOS: permisos de ADMIN asignados';
GO

-- CAJERO: permisos base (dashboard, ventas, caja granular, clientes/productos en lectura)
--   Por defecto recibe TODOS los permisos de caja excepto caja.central.operar y caja.depositos.crear
--   (esos son operaciones de tesorería, requieren override explícito si se los quiere dar).
DECLARE @CAJERO INT = (SELECT ROL_ID FROM ROLES WHERE NOMBRE = 'CAJERO');
INSERT INTO ROLES_PERMISOS (ROL_ID, PERMISO_ID)
SELECT @CAJERO, p.PERMISO_ID
FROM PERMISOS_WEB p
WHERE p.ACTIVO = 1
  AND p.LLAVE IN (
    'dashboard.ver',
    'ventas.ver',
    'ventas.crear',
    'ventas.nc.crear',
    'caja.ver',
    'caja.abrir',
    'caja.cerrar',
    'caja.ingreso',
    'caja.egreso',
    'clientes.ver',
    'productos.ver'
  )
  AND NOT EXISTS (SELECT 1 FROM ROLES_PERMISOS rp WHERE rp.ROL_ID = @CAJERO AND rp.PERMISO_ID = p.PERMISO_ID);
GO
PRINT '✅ ROLES_PERMISOS: permisos de CAJERO asignados';
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN DE USUARIOS EXISTENTES → rol ADMIN
--   Todos los usuarios preexistentes en la tabla USUARIOS que aún no tengan
--   ningún rol asignado en USUARIOS_ROLES reciben automáticamente el rol ADMIN.
--   Esto garantiza que los clientes actuales no pierdan acceso tras la migración.
-- ═════════════════════════════════════════════════════════════════════════════
DECLARE @ADMIN_ID INT = (SELECT ROL_ID FROM ROLES WHERE NOMBRE = 'ADMIN');
INSERT INTO USUARIOS_ROLES (USUARIO_ID, ROL_ID, ASIGNADO_POR, ACTIVO)
SELECT u.USUARIO_ID, @ADMIN_ID, NULL, 1
FROM USUARIOS u
WHERE NOT EXISTS (
  SELECT 1 FROM USUARIOS_ROLES ur WHERE ur.USUARIO_ID = u.USUARIO_ID
);
PRINT '✅ Usuarios existentes migrados al rol ADMIN: ' + CAST(@@ROWCOUNT AS VARCHAR);
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- 12. VISTA  — Permisos efectivos por usuario (sistema web)
--     Une ROLES_PERMISOS (permisos por rol) + USUARIOS_PERMISOS_OVERRIDE.
--     Regla: USUARIOS_PERMISOS_OVERRIDE.ACTIVO=0 ⇒ negación explícita.
-- ═════════════════════════════════════════════════════════════════════════════
IF OBJECT_ID('VW_PERMISOS_EFECTIVOS', 'V') IS NOT NULL DROP VIEW VW_PERMISOS_EFECTIVOS;
GO
CREATE VIEW VW_PERMISOS_EFECTIVOS AS
WITH por_rol AS (
  SELECT ur.USUARIO_ID, rp.PERMISO_ID
  FROM   USUARIOS_ROLES ur
  JOIN   ROLES_PERMISOS rp ON rp.ROL_ID = ur.ROL_ID
  JOIN   ROLES r            ON r.ROL_ID  = ur.ROL_ID
  WHERE  ur.ACTIVO = 1 AND r.ACTIVO = 1
    AND (ur.VALIDO_DESDE IS NULL OR ur.VALIDO_DESDE <= SYSUTCDATETIME())
    AND (ur.VALIDO_HASTA IS NULL OR ur.VALIDO_HASTA >  SYSUTCDATETIME())
),
negados AS (
  SELECT USUARIO_ID, PERMISO_ID FROM USUARIOS_PERMISOS_OVERRIDE WHERE ACTIVO = 0
),
union_all AS (
  SELECT USUARIO_ID, PERMISO_ID FROM por_rol
  UNION
  SELECT USUARIO_ID, PERMISO_ID FROM USUARIOS_PERMISOS_OVERRIDE WHERE ACTIVO = 1
)
SELECT u.USUARIO_ID, u.PERMISO_ID,
       p.LLAVE, p.DESCRIPCION, p.MODULO, p.CATEGORIA, p.RIESGO
FROM   union_all u
JOIN   PERMISOS_WEB p ON p.PERMISO_ID = u.PERMISO_ID
WHERE  NOT EXISTS (
         SELECT 1 FROM negados n
         WHERE n.USUARIO_ID = u.USUARIO_ID AND n.PERMISO_ID = u.PERMISO_ID
       )
  AND  p.ACTIVO = 1;
GO
PRINT '✅ VW_PERMISOS_EFECTIVOS';
GO

-- ═════════════════════════════════════════════════════════════════════════════
-- FIN.  Checklist de adopción en el backend:
--   1) auth.service.ts: migrar validación a CLAVE_HASH (Argon2id) con fallback
--      a CLAVE en texto plano la primera vez y re-hash + limpiar CLAVE.
--   2) Emitir access token (JWT, 60 min) + refresh token (random 32 bytes,
--      guardar SHA-256 en USUARIOS_SESIONES).
--   3) Middleware de permisos: consultar VW_PERMISOS_EFECTIVOS.
--   4) Registrar eventos en AUDITORIA_SEGURIDAD (login OK/FAIL, lockout, etc.).
--   5) Implementar lockout progresivo según POLITICA_SEGURIDAD.
--   6) TOTP: librería `otplib`, almacenar MFA_SECRETO cifrado con AES-256-GCM
--      (clave derivada del JWT_SECRET o de appdata.ini).
-- ═════════════════════════════════════════════════════════════════════════════
PRINT '🎉 Migración usuarios-permisos completada';
GO
