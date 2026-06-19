-- ═══════════════════════════════════════════════════════════════════════════════
--  Río Gestión Web — Nuevos campos AFIP en CLIENTES y PROVEEDORES
--
--  Agrega los campos provenientes de la consulta al Padrón ARCA (A13) que
--  no estaban persistidos previamente.
--
--  CLIENTES:
--    CP               — Código postal del domicilio fiscal
--    RUBRO            — Descripción de actividad principal (AFIP)
--    FECHA_NACIMIENTO — Fecha de nacimiento (solo personas físicas)
--
--  PROVEEDORES:
--    RUBRO            — Descripción de actividad principal (AFIP)
--    CONDICION_IVA    — Condición frente al IVA (RI, Monotributista, etc.)
--
--  Todas las modificaciones son aditivas (ADD COLUMN si no existe).
--  Ejecutar una sola vez contra SesamoDB.
-- ═══════════════════════════════════════════════════════════════════════════════
SET NOCOUNT ON;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- CLIENTES
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CLIENTES' AND COLUMN_NAME='CIUDAD')
BEGIN
  ALTER TABLE CLIENTES ADD CIUDAD NVARCHAR(100) NULL;
  PRINT '✅ CLIENTES.CIUDAD agregado';
END
ELSE PRINT '— CLIENTES.CIUDAD ya existe';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CLIENTES' AND COLUMN_NAME='CP')
BEGIN
  ALTER TABLE CLIENTES ADD CP NVARCHAR(10) NULL;
  PRINT '✅ CLIENTES.CP agregado';
END
ELSE PRINT '— CLIENTES.CP ya existe';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CLIENTES' AND COLUMN_NAME='RUBRO')
BEGIN
  ALTER TABLE CLIENTES ADD RUBRO NVARCHAR(200) NULL;
  PRINT '✅ CLIENTES.RUBRO agregado';
END
ELSE PRINT '— CLIENTES.RUBRO ya existe';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='CLIENTES' AND COLUMN_NAME='FECHA_NACIMIENTO')
BEGIN
  ALTER TABLE CLIENTES ADD FECHA_NACIMIENTO DATE NULL;
  PRINT '✅ CLIENTES.FECHA_NACIMIENTO agregado';
END
ELSE PRINT '— CLIENTES.FECHA_NACIMIENTO ya existe';

GO

-- ─────────────────────────────────────────────────────────────────────────────
-- PROVEEDORES
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PROVEEDORES' AND COLUMN_NAME='RUBRO')
BEGIN
  ALTER TABLE PROVEEDORES ADD RUBRO NVARCHAR(200) NULL;
  PRINT '✅ PROVEEDORES.RUBRO agregado';
END
ELSE PRINT '— PROVEEDORES.RUBRO ya existe';

IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PROVEEDORES' AND COLUMN_NAME='CONDICION_IVA')
BEGIN
  ALTER TABLE PROVEEDORES ADD CONDICION_IVA NVARCHAR(60) NULL;
  PRINT '✅ PROVEEDORES.CONDICION_IVA agregado';
END
ELSE PRINT '— PROVEEDORES.CONDICION_IVA ya existe';

GO

PRINT '🎉 migrate-afip-campos completada';
GO
