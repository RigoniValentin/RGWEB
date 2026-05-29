-- ════════════════════════════════════════════════════════════════════
--  Migración: Pedidos de Tienda Online (Tienda Orders)
--
--  Objetivo: recibir pedidos desde la tienda online y dejarlos en
--  un buzón (estado=pendiente) para que el operador los revise,
--  los convierta en Venta y opcionalmente los facture + envíe
--  comprobante por mail.
--
--  Tablas creadas:
--    TIENDA_ORDERS         — cabecera del pedido
--    TIENDA_ORDERS_ITEMS   — detalle de productos del pedido
--
--  Estados (ESTADO):
--    pendiente    → recién recibido, esperando revisión
--    procesado    → convertido en VENTAS (VENTA_ID asignado)
--    facturado    → además se emitió factura electrónica (CAE asignado)
--    cancelado    → descartado por el operador
--
--  Permisos:
--    tienda_orders.ver        — ver pedidos
--    tienda_orders.procesar   — convertir en venta
--    tienda_orders.facturar   — emitir factura (requiere FE habilitada)
--    tienda_orders.cancelar   — marcar como cancelado
--
--  Idempotente: puede ejecutarse múltiples veces sin error.
-- ════════════════════════════════════════════════════════════════════

-- ── Tabla: TIENDA_ORDERS ──────────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TIENDA_ORDERS]') AND type IN (N'U'))
BEGIN
    CREATE TABLE TIENDA_ORDERS (
        TIENDA_ORDER_ID     INT IDENTITY(1,1) PRIMARY KEY,
        EXTERNAL_ORDER_ID   NVARCHAR(120)  NOT NULL,        -- ID del pedido en la tienda
        TIENDA_ORIGEN       NVARCHAR(60)   NOT NULL,        -- slug de la tienda (multi-tenant)
        ESTADO              NVARCHAR(20)   NOT NULL DEFAULT 'pendiente',
        FECHA_PEDIDO        DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),

        -- Cliente (snapshot enviado por la tienda; puede no existir aún en CLIENTES)
        CLIENTE_NOMBRE      NVARCHAR(200)  NULL,
        CLIENTE_DOCUMENTO   NVARCHAR(50)   NULL,
        CLIENTE_TIPO_DOC    NVARCHAR(20)   NULL,
        CLIENTE_EMAIL       NVARCHAR(200)  NULL,
        CLIENTE_TELEFONO    NVARCHAR(50)   NULL,
        CLIENTE_DIRECCION   NVARCHAR(500)  NULL,
        CLIENTE_LOCALIDAD   NVARCHAR(120)  NULL,
        CLIENTE_PROVINCIA   NVARCHAR(120)  NULL,
        CLIENTE_CP          NVARCHAR(20)   NULL,

        -- Pago (resumen recibido; no autoritativo)
        PAGO_METODO         NVARCHAR(60)   NULL,             -- EFECTIVO|MERCADOPAGO|TRANSFERENCIA|...
        PAGO_ESTADO         NVARCHAR(30)   NULL,             -- pendiente|aprobado|rechazado
        PAGO_REFERENCIA     NVARCHAR(200)  NULL,             -- id externo (MP, etc.)

        -- Envío
        ENVIO_METODO        NVARCHAR(30)   NULL,             -- retiro|envio
        ENVIO_COSTO         DECIMAL(18,2)  NULL,

        -- Totales (informativos; el cálculo autoritativo lo hace VENTAS)
        SUBTOTAL            DECIMAL(18,2)  NULL,
        DESCUENTOS          DECIMAL(18,2)  NULL,
        TOTAL               DECIMAL(18,2)  NULL,

        OBSERVACIONES       NVARCHAR(1000) NULL,
        PAYLOAD_RAW         NVARCHAR(MAX)  NULL,             -- json original recibido (auditoría)

        -- Vínculos con el sistema
        VENTA_ID            INT            NULL,             -- FK lógico a VENTAS cuando se procesa
        CLIENTE_ID          INT            NULL,             -- FK lógico a CLIENTES si se resolvió
        FACTURADO           BIT            NOT NULL DEFAULT 0,
        CAE                 NVARCHAR(20)   NULL,
        COMPROBANTE_NUMERO  NVARCHAR(50)   NULL,
        EMAIL_ENVIADO_AT    DATETIME2(0)   NULL,

        -- Auditoría
        API_KEY_ID          INT            NULL,
        CREATED_AT          DATETIME2(0)   NOT NULL DEFAULT SYSDATETIME(),
        PROCESADO_AT        DATETIME2(0)   NULL,
        PROCESADO_POR       INT            NULL,
        FACTURADO_AT        DATETIME2(0)   NULL,
        FACTURADO_POR       INT            NULL,
        CANCELADO_AT        DATETIME2(0)   NULL,
        CANCELADO_POR       INT            NULL,
        CANCELACION_MOTIVO  NVARCHAR(500)  NULL,

        CONSTRAINT UQ_TIENDA_ORDERS_EXT UNIQUE (TIENDA_ORIGEN, EXTERNAL_ORDER_ID)
    );

    CREATE INDEX IX_TIENDA_ORDERS_ESTADO   ON TIENDA_ORDERS(ESTADO, CREATED_AT DESC);
    CREATE INDEX IX_TIENDA_ORDERS_TIENDA   ON TIENDA_ORDERS(TIENDA_ORIGEN);
    CREATE INDEX IX_TIENDA_ORDERS_CREATED  ON TIENDA_ORDERS(CREATED_AT DESC);
    CREATE INDEX IX_TIENDA_ORDERS_VENTA    ON TIENDA_ORDERS(VENTA_ID);
END
GO

-- ── Tabla: TIENDA_ORDERS_ITEMS ────────────────────────────────────
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TIENDA_ORDERS_ITEMS]') AND type IN (N'U'))
BEGIN
    CREATE TABLE TIENDA_ORDERS_ITEMS (
        ITEM_ID             INT IDENTITY(1,1) PRIMARY KEY,
        TIENDA_ORDER_ID     INT            NOT NULL,
        PRODUCTO_ID         INT            NULL,             -- ID de PRODUCTOS si la tienda lo conoce
        SKU                 NVARCHAR(60)   NULL,             -- fallback si no hay PRODUCTO_ID
        NOMBRE              NVARCHAR(300)  NULL,             -- descriptivo (snapshot)
        CANTIDAD            DECIMAL(18,3)  NOT NULL,
        PRECIO_UNITARIO     DECIMAL(18,2)  NOT NULL,
        DESCUENTO           DECIMAL(5,2)   NOT NULL DEFAULT 0,
        SUBTOTAL            DECIMAL(18,2)  NULL,

        CONSTRAINT FK_TOI_ORDER FOREIGN KEY (TIENDA_ORDER_ID)
            REFERENCES TIENDA_ORDERS(TIENDA_ORDER_ID) ON DELETE CASCADE
    );

    CREATE INDEX IX_TIENDA_ORDERS_ITEMS_ORDER ON TIENDA_ORDERS_ITEMS(TIENDA_ORDER_ID);
END
GO

-- ── Config K/V para tienda orders ─────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INTEGRACIONES_CONFIG WHERE CLAVE = 'tienda_orders_auto_facturar')
    INSERT INTO INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('tienda_orders_auto_facturar', '0');
IF NOT EXISTS (SELECT 1 FROM INTEGRACIONES_CONFIG WHERE CLAVE = 'tienda_orders_email_remitente')
    INSERT INTO INTEGRACIONES_CONFIG (CLAVE, VALOR) VALUES ('tienda_orders_email_remitente', NULL);
GO

-- ── Permisos ──────────────────────────────────────────────────────
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PERMISOS_WEB]') AND type IN (N'U'))
BEGIN
    IF NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = 'tienda_orders.ver')
        INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('tienda_orders.ver', 'Ver pedidos de la tienda online', 'ventas', 'lectura', 'BAJO', 60);

    IF NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = 'tienda_orders.procesar')
        INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('tienda_orders.procesar', 'Convertir pedido de tienda en Venta', 'ventas', 'escritura', 'MEDIO', 61);

    IF NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = 'tienda_orders.facturar')
        INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('tienda_orders.facturar', 'Emitir factura para pedido de tienda', 'ventas', 'escritura', 'ALTO', 62);

    IF NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = 'tienda_orders.cancelar')
        INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('tienda_orders.cancelar', 'Cancelar pedido de tienda', 'ventas', 'escritura', 'MEDIO', 63);

    DECLARE @SUPER_ID INT = (SELECT ROL_ID FROM ROLES WHERE NOMBRE = 'SUPERADMIN');
    IF @SUPER_ID IS NOT NULL
    BEGIN
        INSERT INTO ROLES_PERMISOS (ROL_ID, PERMISO_ID)
        SELECT @SUPER_ID, PERMISO_ID FROM PERMISOS_WEB
        WHERE LLAVE IN ('tienda_orders.ver','tienda_orders.procesar','tienda_orders.facturar','tienda_orders.cancelar')
          AND NOT EXISTS (SELECT 1 FROM ROLES_PERMISOS WHERE ROL_ID = @SUPER_ID AND PERMISO_ID = PERMISOS_WEB.PERMISO_ID);
    END
END
GO

PRINT '✓ Migración Tienda Orders aplicada correctamente';
