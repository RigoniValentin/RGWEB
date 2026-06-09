-- ════════════════════════════════════════════════════════════════════
--  Migración: Módulo de Pedidos de Tienda Online (Tienda Orders)
--
--  Objetivo
--    Implementar el contrato estándar "carrocería-chasis" entre cualquier
--    tienda online (Tricarios y futuros clientes) y RG WEB:
--      1. Tienda → POST /api/external/tienda-orders   (buzón)
--      2. Operador → procesar → crear VENTA           (motor)
--      3. Operador → facturar → emitir FE + e-mail    (motor)
--
--  Características
--    • SQL Server (T-SQL)
--    • 100% idempotente — puede correrse N veces sin error
--    • NVARCHAR para soportar nombres con caracteres latinos (ñ, áéíóú).
--    • DECIMAL(18,2) para todos los montos.
--    • UNIQUE compuesto (TIENDA_ORIGEN, EXTERNAL_ORDER_ID) → idempotencia.
--    • CHECK constraints en ESTADO y CONDICION_IVA del cliente.
--    • Datos fiscales AR completos (DocTipo + DocNro + CondicionIVA).
--    • Desglose de totales explícito (subtotal/descuentos/costo_envio/total).
--
--  Estados
--    PENDIENTE   recibido, aún no procesado
--    PROCESADO   venta creada (VENTA_ID asignado)
--    FACTURADO   con CAE/CAEA + comprobante AFIP-ARCA
--    CANCELADO   anulado por el operador (motivo obligatorio)
-- ════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
SET XACT_ABORT ON;
GO

-- ────────────────────────────────────────────────────────────────────
-- 1. TIENDA_ORDERS  (cabecera del pedido)
-- ────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[dbo].[TIENDA_ORDERS]')
      AND type = N'U'
)
BEGIN
    CREATE TABLE dbo.TIENDA_ORDERS (
        TIENDA_ORDER_ID     INT IDENTITY(1,1)            NOT NULL,
        TIENDA_ORIGEN       NVARCHAR(60)                 NOT NULL,  -- slug de la tienda (tricarios, cliente-x)
        EXTERNAL_ORDER_ID   NVARCHAR(120)                NOT NULL,  -- id del pedido en la tienda
        ESTADO              NVARCHAR(20)                 NOT NULL
            CONSTRAINT DF_TIENDA_ORDERS_ESTADO          DEFAULT 'PENDIENTE',
        FECHA_PEDIDO        DATETIME2(0)                 NOT NULL
            CONSTRAINT DF_TIENDA_ORDERS_FECHA_PEDIDO    DEFAULT SYSDATETIME(),

        -- ───── Datos del cliente (snapshot enviado por la tienda) ─────
        CLIENTE_NOMBRE          NVARCHAR(200)            NULL,
        CLIENTE_TIPO_DOC        NVARCHAR(10)             NULL,      -- DNI | CUIT | CUIL | CF | PASAPORTE | LE | LC
        CLIENTE_DOCUMENTO       NVARCHAR(20)             NULL,      -- sin separadores
        CLIENTE_CONDICION_IVA   NVARCHAR(40)             NULL,      -- ver CHECK abajo
        CLIENTE_EMAIL           NVARCHAR(200)            NULL,
        CLIENTE_TELEFONO        NVARCHAR(50)             NULL,
        CLIENTE_DIRECCION       NVARCHAR(500)            NULL,
        CLIENTE_LOCALIDAD       NVARCHAR(120)            NULL,
        CLIENTE_PROVINCIA       NVARCHAR(120)            NULL,
        CLIENTE_CP              NVARCHAR(20)             NULL,
        CLIENTE_PAIS            NVARCHAR(60)             NULL
            CONSTRAINT DF_TIENDA_ORDERS_PAIS            DEFAULT 'AR',

        -- ───── Pago ─────
        PAGO_METODO         NVARCHAR(60)                 NULL,      -- EFECTIVO | MERCADOPAGO | TRANSFERENCIA | TARJETA
        PAGO_ESTADO         NVARCHAR(30)                 NULL,      -- PENDIENTE | APROBADO | RECHAZADO | REEMBOLSADO
        PAGO_REFERENCIA     NVARCHAR(200)                NULL,      -- id externo (MP, Stripe, etc.)
        PAGO_FECHA_APROB    DATETIME2(0)                 NULL,

        -- ───── Envío ─────
        ENVIO_METODO        NVARCHAR(30)                 NULL,      -- RETIRO | ENVIO
        ENVIO_TRANSPORTE    NVARCHAR(80)                 NULL,      -- nombre del courier si aplica
        ENVIO_TRACKING      NVARCHAR(120)                NULL,

        -- ───── Desglose de totales (Argentina) ─────
        SUBTOTAL            DECIMAL(18,2)                NULL,
        DESCUENTOS          DECIMAL(18,2)                NULL,
        COSTO_ENVIO         DECIMAL(18,2)                NULL,
        IVA_TOTAL           DECIMAL(18,2)                NULL,      -- informativo (lo autoritativo lo calcula VENTAS)
        TOTAL               DECIMAL(18,2)                NULL,
        MONEDA              NVARCHAR(3)                  NOT NULL
            CONSTRAINT DF_TIENDA_ORDERS_MONEDA          DEFAULT 'ARS',

        OBSERVACIONES       NVARCHAR(1000)               NULL,
        PAYLOAD_RAW         NVARCHAR(MAX)                NULL,      -- json original recibido (auditoría)

        -- ───── Vínculos con el sistema ─────
        VENTA_ID            INT                          NULL,
        CLIENTE_ID          INT                          NULL,
        FACTURADO           BIT                          NOT NULL
            CONSTRAINT DF_TIENDA_ORDERS_FACTURADO       DEFAULT 0,
        CAE                 NVARCHAR(20)                 NULL,
        CAE_VENCIMIENTO     DATE                         NULL,
        COMPROBANTE_NUMERO  NVARCHAR(50)                 NULL,
        EMAIL_ENVIADO_AT    DATETIME2(0)                 NULL,
        EMAIL_INTENTOS      INT                          NOT NULL
            CONSTRAINT DF_TIENDA_ORDERS_EMAIL_INTENTOS  DEFAULT 0,

        -- ───── Auditoría ─────
        API_KEY_ID          INT                          NULL,
        CREATED_AT          DATETIME2(0)                 NOT NULL
            CONSTRAINT DF_TIENDA_ORDERS_CREATED_AT      DEFAULT SYSDATETIME(),
        PROCESADO_AT        DATETIME2(0)                 NULL,
        PROCESADO_POR       INT                          NULL,
        FACTURADO_AT        DATETIME2(0)                 NULL,
        FACTURADO_POR       INT                          NULL,
        CANCELADO_AT        DATETIME2(0)                 NULL,
        CANCELADO_POR       INT                          NULL,
        CANCELACION_MOTIVO  NVARCHAR(500)                NULL,

        CONSTRAINT PK_TIENDA_ORDERS PRIMARY KEY (TIENDA_ORDER_ID),

        CONSTRAINT UQ_TIENDA_ORDERS_EXT
            UNIQUE (TIENDA_ORIGEN, EXTERNAL_ORDER_ID),

        CONSTRAINT CK_TIENDA_ORDERS_ESTADO
            CHECK (ESTADO IN ('PENDIENTE', 'PROCESADO', 'FACTURADO', 'CANCELADO')),

        CONSTRAINT CK_TIENDA_ORDERS_COND_IVA
            CHECK (CLIENTE_CONDICION_IVA IS NULL OR CLIENTE_CONDICION_IVA IN (
                'RESPONSABLE INSCRIPTO',
                'MONOTRIBUTO',
                'CONSUMIDOR FINAL',
                'EXENTO',
                'NO RESPONSABLE'
            )),

        CONSTRAINT CK_TIENDA_ORDERS_TIPO_DOC
            CHECK (CLIENTE_TIPO_DOC IS NULL OR CLIENTE_TIPO_DOC IN (
                'DNI', 'CUIT', 'CUIL', 'CF', 'PASAPORTE', 'LE', 'LC'
            )),

        CONSTRAINT CK_TIENDA_ORDERS_ENVIO
            CHECK (ENVIO_METODO IS NULL OR ENVIO_METODO IN ('RETIRO', 'ENVIO')),

        CONSTRAINT CK_TIENDA_ORDERS_MONEDA
            CHECK (MONEDA IN ('ARS', 'USD'))
    );

    CREATE INDEX IX_TIENDA_ORDERS_ESTADO        ON dbo.TIENDA_ORDERS(ESTADO, CREATED_AT DESC);
    CREATE INDEX IX_TIENDA_ORDERS_TIENDA        ON dbo.TIENDA_ORDERS(TIENDA_ORIGEN);
    CREATE INDEX IX_TIENDA_ORDERS_CREATED       ON dbo.TIENDA_ORDERS(CREATED_AT DESC);
    CREATE INDEX IX_TIENDA_ORDERS_VENTA         ON dbo.TIENDA_ORDERS(VENTA_ID)         WHERE VENTA_ID IS NOT NULL;
    CREATE INDEX IX_TIENDA_ORDERS_EMAIL_CLIENTE ON dbo.TIENDA_ORDERS(CLIENTE_EMAIL)    WHERE CLIENTE_EMAIL IS NOT NULL;
    CREATE INDEX IX_TIENDA_ORDERS_PAGO_ESTADO   ON dbo.TIENDA_ORDERS(PAGO_ESTADO)      WHERE PAGO_ESTADO IS NOT NULL;
END
GO

-- ────────────────────────────────────────────────────────────────────
-- 2. TIENDA_ORDERS_ITEMS  (detalle de productos)
-- ────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[dbo].[TIENDA_ORDERS_ITEMS]')
      AND type = N'U'
)
BEGIN
    CREATE TABLE dbo.TIENDA_ORDERS_ITEMS (
        ITEM_ID             INT IDENTITY(1,1)            NOT NULL,
        TIENDA_ORDER_ID     INT                          NOT NULL,
        LINEA               INT                          NOT NULL,  -- orden de la línea en el pedido
        PRODUCTO_ID         INT                          NULL,      -- FK lógico a PRODUCTOS si la tienda lo conoce
        SKU                 NVARCHAR(60)                 NULL,
        NOMBRE              NVARCHAR(300)                NULL,
        CANTIDAD            DECIMAL(18,3)                NOT NULL,
        PRECIO_UNITARIO     DECIMAL(18,2)                NOT NULL,
        DESCUENTO_PORC      DECIMAL(5,2)                 NOT NULL
            CONSTRAINT DF_TIENDA_ORDERS_ITEMS_DESC      DEFAULT 0,
        IVA_ALICUOTA        DECIMAL(5,2)                 NULL,      -- 0 | 10.5 | 21 (informativo)
        SUBTOTAL            DECIMAL(18,2)                NOT NULL,

        CONSTRAINT PK_TIENDA_ORDERS_ITEMS PRIMARY KEY (ITEM_ID),

        CONSTRAINT FK_TIENDA_ORDERS_ITEMS_ORDER
            FOREIGN KEY (TIENDA_ORDER_ID)
            REFERENCES dbo.TIENDA_ORDERS(TIENDA_ORDER_ID)
            ON DELETE CASCADE,

        CONSTRAINT CK_TIENDA_ORDERS_ITEMS_CANTIDAD  CHECK (CANTIDAD > 0),
        CONSTRAINT CK_TIENDA_ORDERS_ITEMS_PRECIO    CHECK (PRECIO_UNITARIO >= 0),
        CONSTRAINT CK_TIENDA_ORDERS_ITEMS_DESCUENTO CHECK (DESCUENTO_PORC BETWEEN 0 AND 100),
        CONSTRAINT CK_TIENDA_ORDERS_ITEMS_PROD_OR_SKU CHECK (PRODUCTO_ID IS NOT NULL OR SKU IS NOT NULL)
    );

    CREATE INDEX IX_TIENDA_ORDERS_ITEMS_ORDER ON dbo.TIENDA_ORDERS_ITEMS(TIENDA_ORDER_ID);
    CREATE INDEX IX_TIENDA_ORDERS_ITEMS_PROD  ON dbo.TIENDA_ORDERS_ITEMS(PRODUCTO_ID)
        WHERE PRODUCTO_ID IS NOT NULL;
END
GO

-- ────────────────────────────────────────────────────────────────────
-- 3. INTEGRACIONES_CONFIG — semillas para tienda orders (K/V existente)
-- ────────────────────────────────────────────────────────────────────
IF EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[dbo].[INTEGRACIONES_CONFIG]')
      AND type = N'U'
)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.INTEGRACIONES_CONFIG WHERE CLAVE = 'tienda_orders_auto_facturar')
        INSERT INTO dbo.INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('tienda_orders_auto_facturar', '0');

    IF NOT EXISTS (SELECT 1 FROM dbo.INTEGRACIONES_CONFIG WHERE CLAVE = 'tienda_orders_email_remitente')
        INSERT INTO dbo.INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('tienda_orders_email_remitente', NULL);

    -- API key compartida heredada por el middleware externo (modo "config simple").
    -- Cuando tiene valor, se usa para validar el header x-api-key. Si está vacía,
    -- el módulo cae al sistema completo de INTEGRACIONES_API_KEYS (bcrypt + scopes).
    IF NOT EXISTS (SELECT 1 FROM dbo.INTEGRACIONES_CONFIG WHERE CLAVE = 'tienda_orders_api_key')
        INSERT INTO dbo.INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('tienda_orders_api_key', NULL);
END
GO

-- ────────────────────────────────────────────────────────────────────
-- 4. Permisos (catálogo PERMISOS_WEB + asignación a SUPERADMIN)
-- ────────────────────────────────────────────────────────────────────
IF EXISTS (
    SELECT 1 FROM sys.objects
    WHERE object_id = OBJECT_ID(N'[dbo].[PERMISOS_WEB]')
      AND type = N'U'
)
BEGIN
    IF NOT EXISTS (SELECT 1 FROM dbo.PERMISOS_WEB WHERE LLAVE = 'tienda_orders.ver')
        INSERT INTO dbo.PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('tienda_orders.ver',        'Ver pedidos de la tienda online',      'ventas', 'lectura',   'BAJO',  60);

    IF NOT EXISTS (SELECT 1 FROM dbo.PERMISOS_WEB WHERE LLAVE = 'tienda_orders.procesar')
        INSERT INTO dbo.PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('tienda_orders.procesar',   'Convertir pedido de tienda en Venta',  'ventas', 'escritura', 'MEDIO', 61);

    IF NOT EXISTS (SELECT 1 FROM dbo.PERMISOS_WEB WHERE LLAVE = 'tienda_orders.facturar')
        INSERT INTO dbo.PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('tienda_orders.facturar',   'Emitir factura para pedido de tienda', 'ventas', 'escritura', 'ALTO',  62);

    IF NOT EXISTS (SELECT 1 FROM dbo.PERMISOS_WEB WHERE LLAVE = 'tienda_orders.cancelar')
        INSERT INTO dbo.PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('tienda_orders.cancelar',   'Cancelar pedido de tienda',            'ventas', 'escritura', 'MEDIO', 63);

    DECLARE @SUPER_ID INT = (SELECT TOP 1 ROL_ID FROM dbo.ROLES WHERE NOMBRE = 'SUPERADMIN');
    IF @SUPER_ID IS NOT NULL
    BEGIN
        INSERT INTO dbo.ROLES_PERMISOS (ROL_ID, PERMISO_ID)
        SELECT @SUPER_ID, p.PERMISO_ID
        FROM dbo.PERMISOS_WEB p
        WHERE p.LLAVE IN ('tienda_orders.ver','tienda_orders.procesar','tienda_orders.facturar','tienda_orders.cancelar')
          AND NOT EXISTS (
              SELECT 1 FROM dbo.ROLES_PERMISOS rp
              WHERE rp.ROL_ID = @SUPER_ID AND rp.PERMISO_ID = p.PERMISO_ID
          );
    END
END
GO

PRINT '✓ Migración TIENDA_ORDERS aplicada correctamente';
GO
