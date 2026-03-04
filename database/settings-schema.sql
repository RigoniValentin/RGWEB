-- ═══════════════════════════════════════════════════════════════════════════════
--  Río Gestión Web — System Settings / Configuration Schema
--  Run this script against the SesamoDB database
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CONFIG_PARAMETROS  — Master catalogue of configurable settings
--    Each row defines ONE parameter the system supports.
--    MODULO + CLAVE is unique so we can add parameters per module.
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CONFIG_PARAMETROS')
BEGIN
  CREATE TABLE CONFIG_PARAMETROS (
    PARAMETRO_ID    INT IDENTITY(1,1) PRIMARY KEY,
    MODULO          VARCHAR(50)   NOT NULL,                -- e.g. 'ventas', 'compras', 'caja', 'general'
    SUBMODULO       VARCHAR(50)   NULL,                    -- e.g. 'nueva_venta', 'listado', null
    CLAVE           VARCHAR(100)  NOT NULL,                -- e.g. 'imprimir_ticket', 'atajo_teclado_nueva_venta'
    DESCRIPCION     NVARCHAR(255) NOT NULL,                -- Human-readable label
    TIPO            VARCHAR(20)   NOT NULL DEFAULT 'text', -- 'boolean','text','number','select','shortcut'
    OPCIONES        NVARCHAR(MAX) NULL,                    -- JSON array for 'select' type, e.g. '["A4","Ticket","Carta"]'
    VALOR_DEFECTO   NVARCHAR(500) NULL,                    -- Default value (string representation)
    ORDEN           INT           NOT NULL DEFAULT 0,      -- Display order within module/submodule
    ACTIVO          BIT           NOT NULL DEFAULT 1,
    CONSTRAINT UQ_CONFIG_PARAM_MODULO_CLAVE UNIQUE (MODULO, CLAVE)
  );
  PRINT '✅ Created table CONFIG_PARAMETROS';
END
ELSE
  PRINT '⏭️  Table CONFIG_PARAMETROS already exists';
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. CONFIG_USUARIO  — Per-user overrides of the parameters
--    If a row exists here it overrides VALOR_DEFECTO from the master table.
--    If no row → the system uses the default.
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CONFIG_USUARIO')
BEGIN
  CREATE TABLE CONFIG_USUARIO (
    CONFIG_USUARIO_ID INT IDENTITY(1,1) PRIMARY KEY,
    USUARIO_ID        INT           NOT NULL,
    PARAMETRO_ID      INT           NOT NULL,
    VALOR             NVARCHAR(500) NOT NULL,
    FECHA_MODIFICADO  DATETIME      NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_CONFIG_USR_USUARIO   FOREIGN KEY (USUARIO_ID)   REFERENCES USUARIOS(USUARIO_ID),
    CONSTRAINT FK_CONFIG_USR_PARAMETRO FOREIGN KEY (PARAMETRO_ID) REFERENCES CONFIG_PARAMETROS(PARAMETRO_ID),
    CONSTRAINT UQ_CONFIG_USUARIO_PARAM UNIQUE (USUARIO_ID, PARAMETRO_ID)
  );
  PRINT '✅ Created table CONFIG_USUARIO';
END
ELSE
  PRINT '⏭️  Table CONFIG_USUARIO already exists';
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CONFIG_GLOBAL  — System-wide overrides (apply to ALL users unless they
--    have their own row in CONFIG_USUARIO).
--    Useful for admin-defined defaults different from the hard-coded one.
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CONFIG_GLOBAL')
BEGIN
  CREATE TABLE CONFIG_GLOBAL (
    CONFIG_GLOBAL_ID  INT IDENTITY(1,1) PRIMARY KEY,
    PARAMETRO_ID      INT           NOT NULL,
    VALOR             NVARCHAR(500) NOT NULL,
    FECHA_MODIFICADO  DATETIME      NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_CONFIG_GLOBAL_PARAM FOREIGN KEY (PARAMETRO_ID) REFERENCES CONFIG_PARAMETROS(PARAMETRO_ID),
    CONSTRAINT UQ_CONFIG_GLOBAL_PARAM UNIQUE (PARAMETRO_ID)
  );
  PRINT '✅ Created table CONFIG_GLOBAL';
END
ELSE
  PRINT '⏭️  Table CONFIG_GLOBAL already exists';
GO

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. SEED — Insert initial parameters
--    Priority resolution:  CONFIG_USUARIO > CONFIG_GLOBAL > VALOR_DEFECTO
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Ventas › Nueva Venta ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'imprimir_ticket')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('ventas', 'nueva_venta', 'imprimir_ticket', 'Imprimir ticket automáticamente al finalizar la venta', 'boolean', 'true', 10);

IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'atajo_nueva_venta')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('ventas', 'nueva_venta', 'atajo_nueva_venta', 'Atajo de teclado para abrir Nueva Venta', 'shortcut', 'F2', 20);

IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'atajo_cobrar')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('ventas', 'nueva_venta', 'atajo_cobrar', 'Atajo de teclado para Cobrar (en pantalla de cobro)', 'shortcut', 'F4', 30);

IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'atajo_ir_cobro')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('ventas', 'nueva_venta', 'atajo_ir_cobro', 'Atajo de teclado para confirmar venta e ir a cobro', 'shortcut', 'F2', 35);

IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'atajo_buscar_producto')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('ventas', 'nueva_venta', 'atajo_buscar_producto', 'Atajo de teclado para enfocar búsqueda de producto', 'shortcut', 'F3', 40);

IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'lista_precio_defecto')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, OPCIONES, VALOR_DEFECTO, ORDEN)
  VALUES ('ventas', 'nueva_venta', 'lista_precio_defecto', 'Lista de precio por defecto', 'select', '["1","2","3","4","5"]', '1', 50);

IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'reabrir_nueva_venta')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('ventas', 'nueva_venta', 'reabrir_nueva_venta', 'Al finalizar una venta, volver a mostrar el formulario de nueva venta', 'boolean', 'false', 60);

-- ── Ventas › General ─────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'mostrar_rentabilidad')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('ventas', 'general', 'mostrar_rentabilidad', 'Mostrar columna de rentabilidad en listado de ventas', 'boolean', 'false', 10);

-- ── Compras › Nueva Compra ───────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'atajo_nueva_compra')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('compras', 'nueva_compra', 'atajo_nueva_compra', 'Atajo de teclado para abrir Nueva Compra', 'shortcut', 'F5', 10);

IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'actualizar_costos_defecto')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('compras', 'nueva_compra', 'actualizar_costos_defecto', 'Actualizar costos automáticamente por defecto', 'boolean', 'true', 20);

IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'actualizar_precios_defecto')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('compras', 'nueva_compra', 'actualizar_precios_defecto', 'Actualizar precios de venta automáticamente por defecto', 'boolean', 'true', 30);

-- ── Caja ─────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'atajo_abrir_caja')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('caja', NULL, 'atajo_abrir_caja', 'Atajo de teclado para abrir caja', 'shortcut', 'F6', 10);

-- ── General ──────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'tema_oscuro')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('general', NULL, 'tema_oscuro', 'Usar tema oscuro', 'boolean', 'false', 10);

IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'sonido_notificaciones')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES ('general', NULL, 'sonido_notificaciones', 'Reproducir sonido en notificaciones', 'boolean', 'true', 20);

PRINT '✅ Seed parameters inserted';
GO
