-- ═══════════════════════════════════════════════════
--  Tipo Servicio Comanda — Schema
--  Tables used for service type management in gastronomy orders.
--  The desktop app creates these tables; the web module reads/writes.
-- ═══════════════════════════════════════════════════

-- TIPO_SERVICIO_COMANDA: service types for kitchen/bar routing
-- CREATE TABLE TIPO_SERVICIO_COMANDA (
--   TIPO_SERVICIO_ID  INT IDENTITY(1,1) PRIMARY KEY,
--   NOMBRE            VARCHAR(100) NOT NULL,
--   PUNTO_VENTA_ID    INT NULL
-- );

-- PRODUCTO_PUNTO_VENTA_SERVICIO_COMANDA: links products to service types per punto de venta
-- CREATE TABLE PRODUCTO_PUNTO_VENTA_SERVICIO_COMANDA (
--   PRODUCTO_ID       INT NOT NULL,
--   PUNTO_VENTA_ID    INT NOT NULL,
--   TIPO_SERVICIO_ID  INT NOT NULL,
--   PRIMARY KEY (PRODUCTO_ID, PUNTO_VENTA_ID)
-- );

-- Ensure tables exist (safe to run multiple times)
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'TIPO_SERVICIO_COMANDA')
BEGIN
  CREATE TABLE TIPO_SERVICIO_COMANDA (
    TIPO_SERVICIO_ID  INT IDENTITY(1,1) PRIMARY KEY,
    NOMBRE            VARCHAR(100) NOT NULL,
    PUNTO_VENTA_ID    INT NULL
  );
END;

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'PRODUCTO_PUNTO_VENTA_SERVICIO_COMANDA')
BEGIN
  CREATE TABLE PRODUCTO_PUNTO_VENTA_SERVICIO_COMANDA (
    PRODUCTO_ID       INT NOT NULL,
    PUNTO_VENTA_ID    INT NOT NULL,
    TIPO_SERVICIO_ID  INT NOT NULL,
    PRIMARY KEY (PRODUCTO_ID, PUNTO_VENTA_ID)
  );
END;
