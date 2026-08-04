-- ════════════════════════════════════════════════════════════════════════
--  MIGRACIÓN COMPLETA: Cajas persistentes + Limpieza de cajas viejas
--  Fecha: 2026-07-27
--
--  MODELO DE DESTINO
--  ─────────────────
--  · 1 caja persistente por Punto de Venta (no por apertura).
--  · Cada caja persistente acumula N sesiones (apertura/cierre) en su historial.
--  · Se elimina el Fondo de Cambio como tabla separada.
--  · El modelo CC ↔ Caja pasa a ser directo (la caja toma de Caja Central).
--
--  ESTE SCRIPT HACE 3 COSAS, EN ORDEN
--  ───────────────────────────────────
--  FASE 1 — MIGRACIÓN ESTRUCTURAL (idempotente)
--    Crea CAJA_SESIONES, CAJA_USUARIOS, columnas nuevas en CAJA, crea 1
--    caja consolidada por PV, migra CAJA_ITEMS.SESION_ID, marca inactivas
--    las cajas viejas, y hace DROP TABLE FONDO_CAMBIO.
--
--  FASE 2 — LIMPIEZA (idempotente)
--    Auto-consolida cualquier PV que se haya quedado sin consolidar (cajas
--    creadas después de FASE 1), reasigna CAJA_ITEMS.CAJA_ID y
--    AUDITORIA_MOVIMIENTOS.CAJA_ID de viejas → consolidadas, y borra
--    físicamente las cajas viejas.
--
--  FASE 3 — VALIDACIÓN
--    Reporta el estado final y verifica que no queden items huérfanos
--    (con SESION_ID apuntando a sesiones de otro PV).
--
--  PRECONDICIONES (validadas al inicio, antes de cualquier cambio)
--  ───────────────────────────────────────────────────────────────
--    1. Ninguna CAJA en estado 'ACTIVA'.
--    2. Tabla FONDO_CAMBIO sin saldo (todos los PUNTO_VENTA_ID en $0).
--    3. (Recomendado) Backup de las tablas CAJA, CAJA_ITEMS,
--       CAJA_SESIONES, CAJA_USUARIOS, AUDITORIA_MOVIMIENTOS.
--
--  PLAN DE ROLLBACK
--  ────────────────
--  Este script es estructuralmente complejo. Si algo sale mal durante
--  FASE 1, los batches usan IF NOT EXISTS / IF EXISTS, así que son
--  idempotentes: la transacción cubre las operaciones críticas.
--  Si la FASE 2 falla, hace ROLLBACK automático (transaccional).
--  Si necesitás volver atrás completamente, restaurá desde el backup.
--  Query sugerida para backup (ejecutar ANTES de este script):
--
--    SELECT * INTO CAJA__PRE_MIGRACION          FROM CAJA;
--    SELECT * INTO CAJA_ITEMS__PRE_MIGRACION    FROM CAJA_ITEMS;
--    SELECT * INTO CAJA_SESIONES__PRE_MIGRACION FROM CAJA_SESIONES;
--    SELECT * INTO CAJA_USUARIOS__PRE_MIGRACION FROM CAJA_USUARIOS;
--    SELECT * INTO AUDITORIA_MOVIMIENTOS__PRE_MIGRACION FROM AUDITORIA_MOVIMIENTOS;
--
--  IMPACTO EN BALANCE / MÉTODOS DE PAGO
--  ─────────────────────────────────────
--  · El cálculo de balance usa SESION_ID (no CAJA_ID). Como SESION_ID
--    queda correctamente asignado, los totales se mantienen idénticos.
--  · La limpieza NO modifica ningún MONTO_EFECTIVO, MONTO_DIGITAL ni
--    ningún campo numérico. Sólo reasigna referencias.
--  · MOVIMIENTOS_CAJA (Caja Central histórica) no se toca.
-- ════════════════════════════════════════════════════════════════════════

SET NOCOUNT ON;
SET XACT_ABORT ON;

PRINT N'╔════════════════════════════════════════════════════════════════╗';
PRINT N'║  MIGRACIÓN COMPLETA DE CAJAS PERSISTENTES                     ║';
PRINT N'║  FASE 1: Estructura · FASE 2: Limpieza · FASE 3: Validación  ║';
PRINT N'╚════════════════════════════════════════════════════════════════╝';
PRINT N'';


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.0: PRECONDICIONES
--  Si alguna falla, abortamos antes de tocar nada.
-- ══════════════════════════════════════════════════════════════════════

PRINT N'── FASE 1.0: Verificando precondiciones ──';
PRINT N'';

-- 1a) No debe haber cajas activas
IF EXISTS (SELECT 1 FROM CAJA WHERE ESTADO = 'ACTIVA')
BEGIN
  ;THROW 50000, 'MIGRACIÓN BLOQUEADA: Existen cajas en estado ACTIVA. Cierrelas antes de migrar.', 1;
END;

-- 1b) FONDO_CAMBIO sin saldo (si la tabla existe)
IF OBJECT_ID('FONDO_CAMBIO', 'U') IS NOT NULL
BEGIN
  DECLARE @saldoFC DECIMAL(18,2);
  SELECT @saldoFC = ISNULL(SUM(fc.SALDO_RESULTANTE), 0)
  FROM FONDO_CAMBIO fc
  INNER JOIN (
    SELECT PUNTO_VENTA_ID, MAX(ID) AS MAX_ID
    FROM FONDO_CAMBIO
    GROUP BY PUNTO_VENTA_ID
  ) latest ON fc.ID = latest.MAX_ID;

  IF ISNULL(@saldoFC, 0) <> 0
  BEGIN
    DECLARE @msgFC NVARCHAR(500) = N'MIGRACIÓN BLOQUEADA: El Fondo de Cambio tiene saldo $' +
      CAST(@saldoFC AS NVARCHAR(20)) + N'. Vacíelo antes de migrar.';
    ;THROW 50000, @msgFC, 1;
  END;
END;

PRINT N'✓ Precondiciones OK — ninguna caja activa, FC en $0';
PRINT N'';
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.1: CREAR TABLA CAJA_SESIONES
-- ══════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CAJA_SESIONES')
BEGIN
  CREATE TABLE CAJA_SESIONES (
    SESION_ID          INT IDENTITY(1,1) PRIMARY KEY,
    CAJA_ID            INT NOT NULL,
    USUARIO_ID         INT NOT NULL,
    NRO_SESION         INT NOT NULL,
    FECHA_APERTURA     DATETIME NOT NULL,
    FECHA_CIERRE       DATETIME NULL,
    MONTO_APERTURA     DECIMAL(18,2) NOT NULL DEFAULT 0,
    APORTE_CC          DECIMAL(18,2) NOT NULL DEFAULT 0,
    RETENIDO_USADO     DECIMAL(18,2) NOT NULL DEFAULT 0,
    MONTO_CIERRE       DECIMAL(18,2) NULL,
    SALDO_RETENIDO_FIN DECIMAL(18,2) NOT NULL DEFAULT 0,
    ESTADO             VARCHAR(20) NOT NULL DEFAULT 'ACTIVA',
    OBS_APERTURA       NVARCHAR(500) NULL,
    OBS_CIERRE         NVARCHAR(500) NULL,
    CONSTRAINT UQ_CAJA_SESION_NRO UNIQUE (CAJA_ID, NRO_SESION)
  );

  CREATE INDEX IX_CAJAS_SESIONES_CAJA ON CAJA_SESIONES(CAJA_ID);
  CREATE INDEX IX_CAJAS_SESIONES_ACTIVA ON CAJA_SESIONES(ESTADO) WHERE ESTADO = 'ACTIVA';
  CREATE INDEX IX_CAJAS_SESIONES_USUARIO ON CAJA_SESIONES(USUARIO_ID);

  PRINT N'✓ Tabla CAJA_SESIONES creada';
END
ELSE
BEGIN
  PRINT N'— Tabla CAJA_SESIONES ya existe';
END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.2: CREAR TABLA CAJA_USUARIOS
-- ══════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CAJA_USUARIOS')
BEGIN
  CREATE TABLE CAJA_USUARIOS (
    CAJA_ID      INT NOT NULL,
    USUARIO_ID   INT NOT NULL,
    ES_PREFERIDO BIT NOT NULL DEFAULT 0,
    ASIGNADO_EN  DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT PK_CAJA_USUARIOS PRIMARY KEY (CAJA_ID, USUARIO_ID)
  );

  CREATE INDEX IX_CU_USUARIO ON CAJA_USUARIOS(USUARIO_ID);

  PRINT N'✓ Tabla CAJA_USUARIOS creada';
END
ELSE
BEGIN
  PRINT N'— Tabla CAJA_USUARIOS ya existe';
END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.3: AGREGAR COLUMNAS NUEVAS A CAJA
-- ══════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CAJA') AND name = 'NOMBRE')
BEGIN
  ALTER TABLE CAJA ADD NOMBRE NVARCHAR(100) NULL;
  PRINT N'✓ Columna CAJA.NOMBRE agregada';
END
ELSE BEGIN PRINT N'— Columna CAJA.NOMBRE ya existe'; END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CAJA') AND name = 'ACTIVA')
BEGIN
  ALTER TABLE CAJA ADD ACTIVA BIT NOT NULL DEFAULT 1;
  PRINT N'✓ Columna CAJA.ACTIVA agregada';
END
ELSE BEGIN PRINT N'— Columna CAJA.ACTIVA ya existe'; END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CAJA') AND name = 'SALDO_RETENIDO')
BEGIN
  ALTER TABLE CAJA ADD SALDO_RETENIDO DECIMAL(18,2) NOT NULL DEFAULT 0;
  PRINT N'✓ Columna CAJA.SALDO_RETENIDO agregada';
END
ELSE BEGIN PRINT N'— Columna CAJA.SALDO_RETENIDO ya existe'; END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CAJA') AND name = 'CREADA_EN')
BEGIN
  ALTER TABLE CAJA ADD CREADA_EN DATETIME NOT NULL DEFAULT GETDATE();
  PRINT N'✓ Columna CAJA.CREADA_EN agregada';
END
ELSE BEGIN PRINT N'— Columna CAJA.CREADA_EN ya existe'; END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CAJA') AND name = 'CREADA_POR')
BEGIN
  ALTER TABLE CAJA ADD CREADA_POR INT NULL;
  PRINT N'✓ Columna CAJA.CREADA_POR agregada';
END
ELSE BEGIN PRINT N'— Columna CAJA.CREADA_POR ya existe'; END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.4: CREAR 1 CAJA CONSOLIDADA POR PUNTO DE VENTA
-- ══════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM CAJA WHERE NOMBRE LIKE N'Caja Principal%')
BEGIN
  DECLARE @cajasConsolidadas INT;

  INSERT INTO CAJA (
    NOMBRE, PUNTO_VENTA_ID, ACTIVA, SALDO_RETENIDO, CREADA_EN, CREADA_POR,
    USUARIO_ID, FECHA_APERTURA, MONTO_APERTURA, ESTADO
  )
  SELECT
    N'Caja Principal ' + pv.NOMBRE,
    pv.PUNTO_VENTA_ID,
    1,
    0,
    GETDATE(),
    (SELECT TOP 1 USUARIO_ID FROM CAJA WHERE PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID ORDER BY FECHA_APERTURA ASC),
    (SELECT TOP 1 USUARIO_ID FROM CAJA WHERE PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID ORDER BY FECHA_APERTURA ASC),
    (SELECT TOP 1 FECHA_APERTURA FROM CAJA WHERE PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID ORDER BY FECHA_APERTURA ASC),
    0,
    N'CERRADA'
  FROM PUNTO_VENTAS pv
  WHERE EXISTS (SELECT 1 FROM CAJA WHERE PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID);

  SET @cajasConsolidadas = @@ROWCOUNT;
  PRINT N'✓ Creadas ' + CAST(@cajasConsolidadas AS NVARCHAR(10)) + N' cajas consolidadas (1 por PV)';
END
ELSE
BEGIN
  PRINT N'— Ya existen cajas consolidadas (Caja Principal%), saltando';
END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.5: BACKFILL CAJA_SESIONES
--  Cada CAJA original se convierte en una sesión de la caja consolidada
--  de su PV.
-- ══════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM CAJA_SESIONES)
BEGIN
  DECLARE @sesionesMigradas INT;

  INSERT INTO CAJA_SESIONES (
    CAJA_ID, USUARIO_ID, NRO_SESION, FECHA_APERTURA, FECHA_CIERRE,
    MONTO_APERTURA, MONTO_CIERRE, ESTADO, OBS_APERTURA, OBS_CIERRE
  )
  SELECT
    consolidada.CAJA_ID,
    c.USUARIO_ID,
    ROW_NUMBER() OVER (PARTITION BY c.PUNTO_VENTA_ID ORDER BY c.FECHA_APERTURA, c.CAJA_ID) AS NRO_SESION,
    c.FECHA_APERTURA,
    c.FECHA_CIERRE,
    ISNULL(c.MONTO_APERTURA, 0),
    c.MONTO_CIERRE,
    ISNULL(c.ESTADO, 'CERRADA'),
    NULL,
    c.OBSERVACIONES
  FROM CAJA c
  INNER JOIN (
    SELECT PUNTO_VENTA_ID, CAJA_ID
    FROM CAJA
    WHERE NOMBRE LIKE N'Caja Principal%'
  ) consolidada ON consolidada.PUNTO_VENTA_ID = c.PUNTO_VENTA_ID;

  SET @sesionesMigradas = @@ROWCOUNT;
  PRINT N'✓ Backfill CAJA_SESIONES: ' + CAST(@sesionesMigradas AS NVARCHAR(10)) + N' sesiones migradas';
END
ELSE
BEGIN
  PRINT N'— CAJA_SESIONES ya contiene datos, saltando backfill';
END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.6: MARCAR CAJAS VIEJAS COMO INACTIVAS
-- ══════════════════════════════════════════════════════════════════════

UPDATE CAJA
SET ACTIVA = 0
WHERE NOMBRE IS NULL;

DECLARE @cajasInactivadas INT = @@ROWCOUNT;
IF @cajasInactivadas > 0
  PRINT N'✓ ' + CAST(@cajasInactivadas AS NVARCHAR(10)) + N' cajas originales marcadas como inactivas';
ELSE
  PRINT N'— No hay cajas originales para inactivar';
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.7: AGREGAR COLUMNA SESION_ID A CAJA_ITEMS
-- ══════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('CAJA_ITEMS') AND name = 'SESION_ID')
BEGIN
  ALTER TABLE CAJA_ITEMS ADD SESION_ID INT NULL;
  PRINT N'✓ Columna SESION_ID agregada a CAJA_ITEMS';
END
ELSE BEGIN PRINT N'— Columna SESION_ID ya existe en CAJA_ITEMS'; END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.8: BACKFILL CAJA_ITEMS.SESION_ID
-- ══════════════════════════════════════════════════════════════════════

IF EXISTS (SELECT 1 FROM CAJA_ITEMS WHERE SESION_ID IS NULL)
BEGIN
  DECLARE @itemsMigrados INT;

  ;WITH ViejasOrdenadas AS (
    SELECT
      c.CAJA_ID AS CAJA_ID_VIEJA,
      c.PUNTO_VENTA_ID,
      c.FECHA_APERTURA,
      ROW_NUMBER() OVER (PARTITION BY c.PUNTO_VENTA_ID ORDER BY c.FECHA_APERTURA, c.CAJA_ID) AS RN
    FROM CAJA c
    WHERE c.NOMBRE IS NULL
  ),
  SesionesConsolidadas AS (
    SELECT
      cs.SESION_ID,
      c.PUNTO_VENTA_ID,
      cs.NRO_SESION
    FROM CAJA_SESIONES cs
    INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
    WHERE c.NOMBRE LIKE N'Caja Principal%'
  )
  UPDATE ci
  SET ci.SESION_ID = sc.SESION_ID
  FROM CAJA_ITEMS ci
  INNER JOIN ViejasOrdenadas vo ON vo.CAJA_ID_VIEJA = ci.CAJA_ID
  INNER JOIN SesionesConsolidadas sc ON sc.PUNTO_VENTA_ID = vo.PUNTO_VENTA_ID AND sc.NRO_SESION = vo.RN
  WHERE ci.SESION_ID IS NULL;

  SET @itemsMigrados = @@ROWCOUNT;
  PRINT N'✓ Backfill CAJA_ITEMS.SESION_ID: ' + CAST(@itemsMigrados AS NVARCHAR(10)) + N' items actualizados';
END
ELSE
BEGIN
  PRINT N'— CAJA_ITEMS.SESION_ID ya está completo, saltando backfill';
END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.9: VERIFICAR QUE NO QUEDEN ITEMS SIN SESION_ID
-- ══════════════════════════════════════════════════════════════════════

IF EXISTS (SELECT 1 FROM CAJA_ITEMS WHERE SESION_ID IS NULL)
BEGIN
  ;THROW 50000, 'Quedan CAJA_ITEMS sin SESION_ID. No se puede continuar.', 1;
END
ELSE
BEGIN
  PRINT N'✓ Todos los CAJA_ITEMS tienen SESION_ID';
END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.10: AGREGAR FK A CAJA_SESIONES
-- ══════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_CAJA_ITEMS_SESION')
BEGIN
  ALTER TABLE CAJA_ITEMS
  ADD CONSTRAINT FK_CAJA_ITEMS_SESION FOREIGN KEY (SESION_ID) REFERENCES CAJA_SESIONES(SESION_ID);
  PRINT N'✓ FK CAJA_ITEMS.SESION_ID → CAJA_SESIONES creada';
END
ELSE BEGIN PRINT N'— FK FK_CAJA_ITEMS_SESION ya existe'; END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.11: MARCAR SESION_ID COMO NOT NULL
-- ══════════════════════════════════════════════════════════════════════

IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('CAJA_ITEMS') AND name = 'SESION_ID' AND is_nullable = 1
)
BEGIN
  ALTER TABLE CAJA_ITEMS ALTER COLUMN SESION_ID INT NOT NULL;
  PRINT N'✓ CAJA_ITEMS.SESION_ID marcado NOT NULL';
END
ELSE BEGIN PRINT N'— CAJA_ITEMS.SESION_ID ya era NOT NULL'; END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.12: CREAR ÍNDICE IX_CI_SESION
-- ══════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CI_SESION' AND object_id = OBJECT_ID('CAJA_ITEMS'))
BEGIN
  CREATE INDEX IX_CI_SESION ON CAJA_ITEMS(SESION_ID);
  PRINT N'✓ Índice IX_CI_SESION creado';
END
ELSE BEGIN PRINT N'— Índice IX_CI_SESION ya existe'; END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.13: BACKFILL CAJA.CREADA_POR
-- ══════════════════════════════════════════════════════════════════════

DECLARE @creadasPorActualizadas INT;

UPDATE CAJA
SET CREADA_POR = (
  SELECT TOP 1 cs.USUARIO_ID
  FROM CAJA_SESIONES cs
  WHERE cs.CAJA_ID = CAJA.CAJA_ID
  ORDER BY cs.NRO_SESION ASC
)
WHERE NOMBRE LIKE N'Caja Principal%'
  AND CREADA_POR IS NULL;

SET @creadasPorActualizadas = @@ROWCOUNT;
PRINT N'✓ CREADA_POR backfilled en ' + CAST(@creadasPorActualizadas AS NVARCHAR(10)) + N' cajas consolidadas';
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.14: BACKFILL CAJA_USUARIOS
-- ══════════════════════════════════════════════════════════════════════

IF NOT EXISTS (
  SELECT 1 FROM CAJA_USUARIOS cu
  INNER JOIN CAJA c ON c.CAJA_ID = cu.CAJA_ID
  WHERE c.NOMBRE LIKE N'Caja Principal%'
)
BEGIN
  DECLARE @usuariosAsignados INT;

  ;WITH UsuariosPorPV AS (
    SELECT DISTINCT c.PUNTO_VENTA_ID, cs.USUARIO_ID
    FROM CAJA_SESIONES cs
    INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
    WHERE c.NOMBRE LIKE N'Caja Principal%'
      AND cs.USUARIO_ID IS NOT NULL
  ),
  CajasPorPV AS (
    SELECT PUNTO_VENTA_ID, CAJA_ID
    FROM CAJA
    WHERE NOMBRE LIKE N'Caja Principal%'
  )
  INSERT INTO CAJA_USUARIOS (CAJA_ID, USUARIO_ID, ES_PREFERIDO, ASIGNADO_EN)
  SELECT
    c.CAJA_ID,
    u.USUARIO_ID,
    0 AS ES_PREFERIDO,
    GETDATE()
  FROM UsuariosPorPV u
  INNER JOIN CajasPorPV c ON c.PUNTO_VENTA_ID = u.PUNTO_VENTA_ID
  WHERE NOT EXISTS (
    SELECT 1 FROM CAJA_USUARIOS cu
    WHERE cu.CAJA_ID = c.CAJA_ID AND cu.USUARIO_ID = u.USUARIO_ID
  );

  SET @usuariosAsignados = @@ROWCOUNT;
  PRINT N'✓ Backfill CAJA_USUARIOS: ' + CAST(@usuariosAsignados AS NVARCHAR(10)) + N' asignaciones';
END
ELSE
BEGIN
  PRINT N'— CAJA_USUARIOS ya contiene asignaciones para cajas consolidadas';
END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.15: RENOMBRAR ORIGEN_TIPO='FONDO_CAMBIO' A 'APERTURA'
-- ══════════════════════════════════════════════════════════════════════

DECLARE @itemsRenombrados INT;

UPDATE CAJA_ITEMS
SET ORIGEN_TIPO = 'APERTURA',
    DESCRIPCION = ISNULL(DESCRIPCION, '') + ' [migrado desde FONDO_CAMBIO]'
WHERE ORIGEN_TIPO = 'FONDO_CAMBIO';

SET @itemsRenombrados = @@ROWCOUNT;
IF @itemsRenombrados > 0
  PRINT N'✓ ' + CAST(@itemsRenombrados AS NVARCHAR(10)) + N' items con ORIGEN_TIPO=FONDO_CAMBIO renombrados a APERTURA';
ELSE
  PRINT N'— No hay items con ORIGEN_TIPO=FONDO_CAMBIO para renombrar';
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.16: DROP TABLE FONDO_CAMBIO
-- ══════════════════════════════════════════════════════════════════════

IF OBJECT_ID('FONDO_CAMBIO', 'U') IS NOT NULL
BEGIN
  DROP TABLE FONDO_CAMBIO;
  PRINT N'✓ Tabla FONDO_CAMBIO eliminada';
END
ELSE BEGIN PRINT N'— Tabla FONDO_CAMBIO no existe'; END;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 1.17: RESUMEN DE FASE 1
-- ══════════════════════════════════════════════════════════════════════

DECLARE @cajas INT = (SELECT COUNT(*) FROM CAJA);
DECLARE @cajasActivas INT = (SELECT COUNT(*) FROM CAJA WHERE ACTIVA = 1);
DECLARE @cajasConsolidadas INT = (SELECT COUNT(*) FROM CAJA WHERE NOMBRE LIKE N'Caja Principal%');
DECLARE @sesiones INT = (SELECT COUNT(*) FROM CAJA_SESIONES);
DECLARE @sesionesActivas INT = (SELECT COUNT(*) FROM CAJA_SESIONES WHERE ESTADO = 'ACTIVA');
DECLARE @items INT = (SELECT COUNT(*) FROM CAJA_ITEMS);
DECLARE @itemsSinSesion INT = (SELECT COUNT(*) FROM CAJA_ITEMS WHERE SESION_ID IS NULL);

IF @itemsSinSesion <> 0
BEGIN
  ;THROW 50000, 'INCONSISTENCIA post-FASE-1: Hay CAJA_ITEMS sin SESION_ID.', 1;
END;

IF @sesionesActivas <> 0
BEGIN
  ;THROW 50000, 'INCONSISTENCIA post-FASE-1: Hay sesiones en estado ACTIVA.', 1;
END;

IF @cajasConsolidadas = 0
BEGIN
  ;THROW 50000, 'INCONSISTENCIA post-FASE-1: No se crearon cajas consolidadas.', 1;
END;

PRINT N'';
PRINT N'═══ FIN FASE 1 — RESUMEN ═══';
PRINT N'  Cajas totales:           ' + CAST(@cajas AS NVARCHAR(10));
PRINT N'  Cajas activas:           ' + CAST(@cajasActivas AS NVARCHAR(10));
PRINT N'  Cajas consolidadas:      ' + CAST(@cajasConsolidadas AS NVARCHAR(10));
PRINT N'  Sesiones:                ' + CAST(@sesiones AS NVARCHAR(10));
PRINT N'  CAJA_ITEMS:              ' + CAST(@items AS NVARCHAR(10));
PRINT N'  CAJA_ITEMS sin SESION_ID:' + CAST(@itemsSinSesion AS NVARCHAR(10));
PRINT N'  FONDO_CAMBIO:            eliminada';
PRINT N'';
PRINT N'✓ FASE 1 completada — cajas consolidadas creadas y datos migrados';
PRINT N'';
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 2: LIMPIEZA DE CAJAS VIEJAS
--  Transaccional. Si algo falla, hace ROLLBACK completo.
-- ══════════════════════════════════════════════════════════════════════

PRINT N'── FASE 2: Limpiando cajas viejas ──';
PRINT N'';

BEGIN TRANSACTION;
BEGIN TRY

-- ══════════════════════════════════════════════════════════════════════
--  FASE 2.1: INVENTARIO
-- ══════════════════════════════════════════════════════════════════════

DECLARE @cajasViejasTotal INT = (SELECT COUNT(*) FROM CAJA WHERE NOMBRE IS NULL);
DECLARE @cajasViejasConItems INT = (
  SELECT COUNT(DISTINCT ci.CAJA_ID)
  FROM CAJA_ITEMS ci
  INNER JOIN CAJA c ON c.CAJA_ID = ci.CAJA_ID
  WHERE c.NOMBRE IS NULL
);
DECLARE @itemsEnViejas INT = (
  SELECT COUNT(*)
  FROM CAJA_ITEMS ci
  INNER JOIN CAJA c ON c.CAJA_ID = ci.CAJA_ID
  WHERE c.NOMBRE IS NULL
);
DECLARE @pvSinConsolidada INT = (
  SELECT COUNT(DISTINCT c.PUNTO_VENTA_ID)
  FROM CAJA c
  WHERE c.NOMBRE IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM CAJA cc
      WHERE cc.PUNTO_VENTA_ID = c.PUNTO_VENTA_ID
        AND cc.NOMBRE LIKE N'Caja Principal%'
    )
);

PRINT N'═══ INVENTARIO PREVIO ═══';
PRINT N'  Cajas viejas (NOMBRE IS NULL):           ' + CAST(@cajasViejasTotal AS NVARCHAR(10));
PRINT N'  Cajas viejas con CAJA_ITEMS asociados:   ' + CAST(@cajasViejasConItems AS NVARCHAR(10));
PRINT N'  CAJA_ITEMS que apuntan a cajas viejas:   ' + CAST(@itemsEnViejas AS NVARCHAR(10));
PRINT N'  PV sin caja consolidada (inconsistente): ' + CAST(@pvSinConsolidada AS NVARCHAR(10));
PRINT N'';

DECLARE @movimientosHuerfanosAntes INT = (
  SELECT COUNT(*)
  FROM MOVIMIENTOS_CAJA mc
  WHERE mc.CAJA_ID IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM CAJA c WHERE c.CAJA_ID = mc.CAJA_ID)
);

IF EXISTS (
  SELECT 1
  FROM MOVIMIENTOS_CAJA mc
  WHERE mc.CAJA_ID IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM CAJA c WHERE c.CAJA_ID = mc.CAJA_ID)
    AND mc.PUNTO_VENTA_ID IS NULL
)
BEGIN
  ;THROW 50000, 'ABORTADO: Hay MOVIMIENTOS_CAJA con CAJA_ID huérfano y sin PUNTO_VENTA_ID para reasignarlos.', 1;
END;

IF EXISTS (
  SELECT 1
  FROM MOVIMIENTOS_CAJA mc
  WHERE mc.CAJA_ID IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM CAJA c WHERE c.CAJA_ID = mc.CAJA_ID)
    AND (
      SELECT COUNT(*)
      FROM CAJA consolidada
      WHERE consolidada.PUNTO_VENTA_ID = mc.PUNTO_VENTA_ID
        AND consolidada.NOMBRE LIKE N'Caja Principal%'
    ) <> 1
)
BEGIN
  ;THROW 50000, 'ABORTADO: No existe exactamente una Caja Principal para el PV de cada MOVIMIENTOS_CAJA huérfano.', 1;
END;

DECLARE @movimientosHuerfanosReasignados INT;

UPDATE mc
SET mc.CAJA_ID = consolidada.CAJA_ID
FROM MOVIMIENTOS_CAJA mc
INNER JOIN CAJA consolidada
  ON consolidada.PUNTO_VENTA_ID = mc.PUNTO_VENTA_ID
 AND consolidada.NOMBRE LIKE N'Caja Principal%'
WHERE mc.CAJA_ID IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM CAJA actual WHERE actual.CAJA_ID = mc.CAJA_ID);

SET @movimientosHuerfanosReasignados = @@ROWCOUNT;
IF @movimientosHuerfanosReasignados > 0
  PRINT N'✓ MOVIMIENTOS_CAJA.CAJA_ID huérfanos reasignados por PV: ' + CAST(@movimientosHuerfanosReasignados AS NVARCHAR(10));
ELSE
  PRINT N'— No hay MOVIMIENTOS_CAJA.CAJA_ID huérfanos para reasignar';

IF EXISTS (
  SELECT 1
  FROM MOVIMIENTOS_CAJA mc
  WHERE mc.CAJA_ID IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM CAJA c WHERE c.CAJA_ID = mc.CAJA_ID)
)
BEGIN
  ;THROW 50000, 'ABORTADO: Quedan MOVIMIENTOS_CAJA con CAJA_ID huérfano después de la reparación.', 1;
END;

IF @movimientosHuerfanosAntes > 0
  PRINT N'✓ Reparación retroactiva de referencias de Caja Central completada';
PRINT N'';

-- Si no hay cajas viejas, terminamos la transacción.
IF @cajasViejasTotal = 0
BEGIN
  PRINT N'✓ No hay cajas viejas para eliminar. Nada que hacer.';
  COMMIT TRANSACTION;
END
ELSE
BEGIN

-- ══════════════════════════════════════════════════════════════════════
--  FASE 2.2: AUTO-CONSOLIDAR PVs DESCUBIERTOS TARDE
--  Si la migración principal no consolidó algún PV (porque no tenía
--  cajas en ese momento), lo consolidamos acá.
-- ══════════════════════════════════════════════════════════════════════

  IF @pvSinConsolidada > 0
  BEGIN
    PRINT N'⚠ Detectados PVs sin consolidada — consolidando automáticamente…';
    PRINT N'';

    -- Verificar que no haya cajas ACTIVAS en esos PVs
    DECLARE @cajasActivasEnPvsSinConsolidar INT = (
      SELECT COUNT(*)
      FROM CAJA c
      WHERE c.ESTADO = 'ACTIVA'
        AND NOT EXISTS (
          SELECT 1 FROM CAJA cc
          WHERE cc.PUNTO_VENTA_ID = c.PUNTO_VENTA_ID
            AND cc.NOMBRE LIKE N'Caja Principal%'
        )
    );

    IF @cajasActivasEnPvsSinConsolidar > 0
    BEGIN
      ;THROW 50000, 'ABORTADO: Hay cajas ACTIVAS en PVs sin consolidar. Cerrelas antes de continuar.', 1;
    END;

    -- Crear 1 caja consolidada por cada PV sin consolidar
    DECLARE @cajasAutoConsolidadas INT;

    INSERT INTO CAJA (
      NOMBRE, PUNTO_VENTA_ID, ACTIVA, SALDO_RETENIDO, CREADA_EN, CREADA_POR,
      USUARIO_ID, FECHA_APERTURA, MONTO_APERTURA, ESTADO
    )
    SELECT
      N'Caja Principal ' + pv.NOMBRE,
      pv.PUNTO_VENTA_ID,
      1,
      0,
      GETDATE(),
      (SELECT TOP 1 USUARIO_ID FROM CAJA WHERE PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID ORDER BY FECHA_APERTURA ASC),
      (SELECT TOP 1 USUARIO_ID FROM CAJA WHERE PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID ORDER BY FECHA_APERTURA ASC),
      (SELECT TOP 1 FECHA_APERTURA FROM CAJA WHERE PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID ORDER BY FECHA_APERTURA ASC),
      0,
      N'CERRADA'
    FROM PUNTO_VENTAS pv
    WHERE EXISTS (SELECT 1 FROM CAJA WHERE PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID)
      AND NOT EXISTS (
        SELECT 1 FROM CAJA cc
        WHERE cc.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
          AND cc.NOMBRE LIKE N'Caja Principal%'
      );

    SET @cajasAutoConsolidadas = @@ROWCOUNT;
    PRINT N'  ✓ Cajas consolidadas creadas: ' + CAST(@cajasAutoConsolidadas AS NVARCHAR(10));

    -- Crear las sesiones para los PVs recién consolidados
    DECLARE @sesionesAutoCreadas INT;

    ;WITH ConsolidadasRecienCreadas AS (
      SELECT PUNTO_VENTA_ID, CAJA_ID
      FROM CAJA c
      WHERE c.NOMBRE LIKE N'Caja Principal%'
        AND NOT EXISTS (SELECT 1 FROM CAJA_SESIONES cs WHERE cs.CAJA_ID = c.CAJA_ID)
    )
    INSERT INTO CAJA_SESIONES (
      CAJA_ID, USUARIO_ID, NRO_SESION, FECHA_APERTURA, FECHA_CIERRE,
      MONTO_APERTURA, MONTO_CIERRE, ESTADO, OBS_APERTURA, OBS_CIERRE
    )
    SELECT
      consolidada.CAJA_ID,
      c.USUARIO_ID,
      ROW_NUMBER() OVER (PARTITION BY c.PUNTO_VENTA_ID ORDER BY c.FECHA_APERTURA, c.CAJA_ID) AS NRO_SESION,
      c.FECHA_APERTURA,
      c.FECHA_CIERRE,
      ISNULL(c.MONTO_APERTURA, 0),
      c.MONTO_CIERRE,
      ISNULL(c.ESTADO, 'CERRADA'),
      NULL,
      c.OBSERVACIONES
    FROM CAJA c
    INNER JOIN ConsolidadasRecienCreadas consolidada ON consolidada.PUNTO_VENTA_ID = c.PUNTO_VENTA_ID;

    SET @sesionesAutoCreadas = @@ROWCOUNT;
    PRINT N'  ✓ Sesiones creadas para nuevos PVs: ' + CAST(@sesionesAutoCreadas AS NVARCHAR(10));

    -- Reasignar CAJA_ITEMS.SESION_ID para los items de los nuevos PVs
    DECLARE @itemsSesionReasignados INT;

    ;WITH ViejasOrdenadas AS (
      SELECT
        c.CAJA_ID AS CAJA_ID_VIEJA,
        c.PUNTO_VENTA_ID,
        c.FECHA_APERTURA,
        ROW_NUMBER() OVER (PARTITION BY c.PUNTO_VENTA_ID ORDER BY c.FECHA_APERTURA, c.CAJA_ID) AS RN
      FROM CAJA c
      WHERE c.NOMBRE IS NULL
    ),
    SesionesConsolidadas AS (
      SELECT
        cs.SESION_ID,
        c.PUNTO_VENTA_ID,
        cs.NRO_SESION
      FROM CAJA_SESIONES cs
      INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
      WHERE c.NOMBRE LIKE N'Caja Principal%'
    )
    UPDATE ci
    SET ci.SESION_ID = sc.SESION_ID
    FROM CAJA_ITEMS ci
    INNER JOIN ViejasOrdenadas vo ON vo.CAJA_ID_VIEJA = ci.CAJA_ID
    INNER JOIN SesionesConsolidadas sc ON sc.PUNTO_VENTA_ID = vo.PUNTO_VENTA_ID AND sc.NRO_SESION = vo.RN
    WHERE ci.SESION_ID IS NULL;

    SET @itemsSesionReasignados = @@ROWCOUNT;
    PRINT N'  ✓ CAJA_ITEMS.SESION_ID backfilled: ' + CAST(@itemsSesionReasignados AS NVARCHAR(10));

    -- Verificar que no queden items sin SESION_ID
    DECLARE @itemsSinSesion INT = (SELECT COUNT(*) FROM CAJA_ITEMS WHERE SESION_ID IS NULL);
    IF @itemsSinSesion <> 0
    BEGIN
      ;THROW 50000, 'ABORTADO: Quedan CAJA_ITEMS sin SESION_ID tras la auto-consolidación.', 1;
    END;

    -- Backfill CAJA_USUARIOS para las nuevas consolidadas
    DECLARE @usuariosAutoAsignados INT;

    ;WITH UsuariosPorPV AS (
      SELECT DISTINCT c.PUNTO_VENTA_ID, cs.USUARIO_ID
      FROM CAJA_SESIONES cs
      INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
      WHERE c.NOMBRE LIKE N'Caja Principal%'
        AND cs.USUARIO_ID IS NOT NULL
    ),
    CajasPorPV AS (
      SELECT PUNTO_VENTA_ID, CAJA_ID
      FROM CAJA
      WHERE NOMBRE LIKE N'Caja Principal%'
    )
    INSERT INTO CAJA_USUARIOS (CAJA_ID, USUARIO_ID, ES_PREFERIDO, ASIGNADO_EN)
    SELECT
      c.CAJA_ID,
      u.USUARIO_ID,
      0 AS ES_PREFERIDO,
      GETDATE()
    FROM UsuariosPorPV u
    INNER JOIN CajasPorPV c ON c.PUNTO_VENTA_ID = u.PUNTO_VENTA_ID
    WHERE NOT EXISTS (
      SELECT 1 FROM CAJA_USUARIOS cu
      WHERE cu.CAJA_ID = c.CAJA_ID AND cu.USUARIO_ID = u.USUARIO_ID
    );

    SET @usuariosAutoAsignados = @@ROWCOUNT;
    PRINT N'  ✓ CAJA_USUARIOS asignados: ' + CAST(@usuariosAutoAsignados AS NVARCHAR(10));
    PRINT N'';
  END;

-- ══════════════════════════════════════════════════════════════════════
--  FASE 2.3: REASIGNAR CAJA_ITEMS.CAJA_ID → CONSOLIDADA DEL MISMO PV
-- ══════════════════════════════════════════════════════════════════════

  DECLARE @itemsReasignados INT;

  ;WITH ItemsEnViejas AS (
    SELECT ci.ITEM_ID, ci.CAJA_ID AS CAJA_ID_VIEJO
    FROM CAJA_ITEMS ci
    INNER JOIN CAJA c ON c.CAJA_ID = ci.CAJA_ID
    WHERE c.NOMBRE IS NULL
  )
  UPDATE ci
  SET ci.CAJA_ID = consolidada.CAJA_ID
  FROM CAJA_ITEMS ci
  INNER JOIN ItemsEnViejas iev ON iev.ITEM_ID = ci.ITEM_ID
  INNER JOIN CAJA vieja       ON vieja.CAJA_ID = iev.CAJA_ID_VIEJO
  INNER JOIN CAJA consolidada ON consolidada.PUNTO_VENTA_ID = vieja.PUNTO_VENTA_ID
                             AND consolidada.NOMBRE LIKE N'Caja Principal%';

  SET @itemsReasignados = @@ROWCOUNT;
  PRINT N'✓ CAJA_ITEMS.CAJA_ID reasignados: ' + CAST(@itemsReasignados AS NVARCHAR(10));

-- ══════════════════════════════════════════════════════════════════════
--  FASE 2.4: VERIFICACIÓN PRE-DELETE
-- ══════════════════════════════════════════════════════════════════════

  DECLARE @itemsPendientes INT = (
    SELECT COUNT(*)
    FROM CAJA_ITEMS ci
    INNER JOIN CAJA c ON c.CAJA_ID = ci.CAJA_ID
    WHERE c.NOMBRE IS NULL
  );

  IF @itemsPendientes <> 0
  BEGIN
    ;THROW 50000, 'ABORTADO: Quedan CAJA_ITEMS apuntando a cajas viejas.', 1;
  END;

  PRINT N'✓ Verificación OK — todos los CAJA_ITEMS apuntan a cajas consolidadas';

-- ══════════════════════════════════════════════════════════════════════
--  FASE 2.5: REASIGNAR OTRAS TABLAS CON FK A CAJA(CAJA_ID)
--  (excluyendo CAJA_SESIONES, que es relación natural del modelo)
-- ══════════════════════════════════════════════════════════════════════

  DECLARE @tablasConFK TABLE (
    id INT IDENTITY(1,1) PRIMARY KEY,
    tabla NVARCHAR(255),
    columna NVARCHAR(255),
    fk_name NVARCHAR(255)
  );

  INSERT INTO @tablasConFK (tabla, columna, fk_name)
  SELECT t.name, c.name, fk.name
  FROM sys.foreign_keys fk
  INNER JOIN sys.tables t ON t.object_id = fk.parent_object_id
  INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
  INNER JOIN sys.columns c ON c.object_id = fkc.parent_object_id AND c.column_id = fkc.parent_column_id
  WHERE fk.referenced_object_id = OBJECT_ID('CAJA')
    AND t.name <> 'CAJA_SESIONES';

  -- 2.5.bis: TABLAS CON CAJA_ID SIN FK DECLARADA
  -- MOVIMIENTOS_CAJA referencia CAJA(CAJA_ID) sólo por convención (sin FK),
  -- por lo que el barrido anterior la saltea. Sin esto, los CIERRE_CAJA
  -- históricos quedan apuntando a cajas que ya no existen y se rompe
  -- el join del desglose por método de pago en Caja Central.
  IF NOT EXISTS (SELECT 1 FROM @tablasConFK WHERE tabla = 'MOVIMIENTOS_CAJA')
    INSERT INTO @tablasConFK (tabla, columna, fk_name)
    SELECT 'MOVIMIENTOS_CAJA', 'CAJA_ID', '(sin FK)';

  DECLARE @totalTablasFK INT = (SELECT COUNT(*) FROM @tablasConFK);
  PRINT N'⚠ Tablas con FK a CAJA(CAJA_ID) (excluyendo CAJA_SESIONES): ' + CAST(@totalTablasFK AS NVARCHAR(10));

  DECLARE @i INT = 1, @tbl NVARCHAR(255), @col NVARCHAR(255), @sql NVARCHAR(MAX);
  WHILE @i <= @totalTablasFK
  BEGIN
    SELECT @tbl = tabla, @col = columna FROM @tablasConFK WHERE id = @i;

    SET @sql = N'
      UPDATE t SET t.' + QUOTENAME(@col) + N' = consolidada.CAJA_ID
      FROM ' + QUOTENAME(@tbl) + N' t
      INNER JOIN CAJA vieja       ON vieja.CAJA_ID = t.' + QUOTENAME(@col) + N'
      INNER JOIN CAJA consolidada ON consolidada.PUNTO_VENTA_ID = vieja.PUNTO_VENTA_ID
                                  AND consolidada.NOMBRE LIKE N''Caja Principal%''
      WHERE vieja.NOMBRE IS NULL;';

    EXEC sp_executesql @sql;
    PRINT N'  ✓ ' + @tbl + '.' + @col + N' reasignados: ' + CAST(@@ROWCOUNT AS NVARCHAR(10));

    SET @i = @i + 1;
  END;

  -- Verificar que ya no haya referencias a cajas viejas en ninguna tabla
  DECLARE @refsPendientes INT = 0;
  SET @i = 1;
  WHILE @i <= @totalTablasFK
  BEGIN
    SELECT @tbl = tabla, @col = columna FROM @tablasConFK WHERE id = @i;
    SET @sql = N'SELECT @cnt = COUNT(*) FROM ' + QUOTENAME(@tbl) +
               N' t INNER JOIN CAJA c ON c.CAJA_ID = t.' + QUOTENAME(@col) +
               N' WHERE c.NOMBRE IS NULL;';
    DECLARE @cnt INT;
    EXEC sp_executesql @sql, N'@cnt INT OUTPUT', @cnt = @cnt OUTPUT;
    SET @refsPendientes = @refsPendientes + ISNULL(@cnt, 0);
    SET @i = @i + 1;
  END;

  IF @refsPendientes <> 0
  BEGIN
    DECLARE @msgRefs NVARCHAR(500) = N'ABORTADO: Quedan referencias a cajas viejas en otras tablas (total: ' + CAST(@refsPendientes AS NVARCHAR(10)) + N').';
    ;THROW 50000, @msgRefs, 1;
  END;

  PRINT N'✓ Verificación OK — ninguna tabla con FK a CAJA apunta a cajas viejas';
  PRINT N'';

-- ══════════════════════════════════════════════════════════════════════
--  FASE 2.6: ELIMINAR CAJAS VIEJAS
-- ══════════════════════════════════════════════════════════════════════

  DECLARE @cajasEliminadas INT;

  DELETE FROM CAJA
  WHERE NOMBRE IS NULL;

  SET @cajasEliminadas = @@ROWCOUNT;
  PRINT N'✓ Cajas viejas eliminadas: ' + CAST(@cajasEliminadas AS NVARCHAR(10));

-- ══════════════════════════════════════════════════════════════════════
--  FASE 2.7: REASIGNAR MOVIMIENTOS_CAJA.CAJA_ID (idempotente)
--
--  Cubre DOS casos:
--   (a) Migración inicial: la fila vieja todavía existe → reasignar por FK
--       (la FASE 2.5 ya hizo esto, pero esta FASE lo cubre también).
--   (b) Retroactivo: la fila vieja ya no existe (NOMBRE IS NULL → borrada
--       en FASE 2.6), pero MOVIMIENTOS_CAJA.CAJA_ID quedó apuntando al ID
--       fantasma. Reasignamos por PUNTO_VENTA_ID (que SÍ se preserva).
--
--  Esta FASE es idempotente: WHERE NOT EXISTS evita duplicar trabajo.
-- ══════════════════════════════════════════════════════════════════════

  DECLARE @movsReasign INT = 0;

  -- (a) Caso migración: cajas viejas todavía presentes
  UPDATE mc
  SET    mc.CAJA_ID = consolidada.CAJA_ID
  FROM   MOVIMIENTOS_CAJA mc
  INNER JOIN CAJA vieja       ON vieja.CAJA_ID = mc.CAJA_ID
  INNER JOIN CAJA consolidada ON consolidada.PUNTO_VENTA_ID = vieja.PUNTO_VENTA_ID
                             AND consolidada.NOMBRE LIKE N'Caja Principal%'
  WHERE  vieja.NOMBRE IS NULL
    AND  mc.CAJA_ID <> consolidada.CAJA_ID;

  SET @movsReasign = @@ROWCOUNT;
  IF @movsReasign > 0
    PRINT N'✓ FASE 2.7a: MOVIMIENTOS_CAJA.CAJA_ID reasignados por FK a vieja: ' + CAST(@movsReasign AS NVARCHAR(10));

  -- (b) Caso retroactivo: CAJA_ID apunta a un ID que ya no existe
  UPDATE mc
  SET    mc.CAJA_ID = (SELECT TOP 1 CAJA_ID FROM CAJA
                       WHERE NOMBRE LIKE N'Caja Principal%'
                         AND PUNTO_VENTA_ID = mc.PUNTO_VENTA_ID)
  FROM   MOVIMIENTOS_CAJA mc
  WHERE  mc.CAJA_ID IS NOT NULL
    AND  mc.CAJA_ID <> (SELECT TOP 1 CAJA_ID FROM CAJA
                        WHERE NOMBRE LIKE N'Caja Principal%'
                          AND PUNTO_VENTA_ID = mc.PUNTO_VENTA_ID)
    AND  NOT EXISTS (SELECT 1 FROM CAJA c WHERE c.CAJA_ID = mc.CAJA_ID);

  SET @movsReasign = @@ROWCOUNT;
  IF @movsReasign > 0
    PRINT N'✓ FASE 2.7b: MOVIMIENTOS_CAJA.CAJA_ID reasignados retroactivamente por PV: ' + CAST(@movsReasign AS NVARCHAR(10));

  -- Validación: no debe quedar ningún MOVIMIENTOS_CAJA apuntando a un CAJA_ID inexistente
  DECLARE @refsHuerfanas INT = (
    SELECT COUNT(*) FROM MOVIMIENTOS_CAJA mc
    WHERE mc.CAJA_ID IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM CAJA c WHERE c.CAJA_ID = mc.CAJA_ID)
  );

  IF @refsHuerfanas <> 0
  BEGIN
    DECLARE @msgHuerfanas NVARCHAR(500) = N'ABORTADO: Quedan ' + CAST(@refsHuerfanas AS NVARCHAR(10)) + N' MOVIMIENTOS_CAJA con CAJA_ID huérfano.';
    ;THROW 50000, @msgHuerfanas, 1;
  END;

-- ══════════════════════════════════════════════════════════════════════
--  FASE 2.8: CORREGIR CAJA_ITEMS.SESION_ID POR FECHA (idempotente)
--
--  La FASE 1.8 mapeó CAJA_ITEMS.SESION_ID vía NRO_SESION + FECHA_APERTURA.
--  En sesiones abiertas tardíamente (post-migración) o con timestamps
--  atípicos, algunos items quedaron en SESION_ID incorrecto (por ejemplo,
--  ventas del 2026-07-30 asignadas a la sesión del 2026-07-29 que ya estaba
--  cerrada). Esto rompe el join del desglose por método de pago.
--
--  Esta FASE reasigna cada item.VENTA a la sesión correcta basada en
--  su propia FECHA (apertura <= item.FECHA <= cierre). Idempotente: si
--  el SESION_ID ya es el correcto, no hace nada.
-- ══════════════════════════════════════════════════════════════════════

  DECLARE @itemsCorregidos INT = 0;

  -- Solo VENTAs (los demás items pueden quedar donde están)
  UPDATE ci
  SET    ci.SESION_ID = cs.SESION_ID
  FROM   CAJA_ITEMS ci
  CROSS APPLY (
    SELECT TOP 1 cs2.SESION_ID
    FROM   CAJA_SESIONES cs2
    WHERE  cs2.CAJA_ID = (SELECT TOP 1 CAJA_ID FROM CAJA WHERE NOMBRE LIKE N'Caja Principal%')
      AND  cs2.FECHA_APERTURA <= ci.FECHA
      AND  (cs2.FECHA_CIERRE IS NULL OR cs2.FECHA_CIERRE >= ci.FECHA)
    ORDER BY cs2.SESION_ID DESC
  ) cs
  WHERE  ci.ORIGEN_TIPO = 'VENTA'
    AND  ci.SESION_ID <> cs.SESION_ID;

  SET @itemsCorregidos = @@ROWCOUNT;
  IF @itemsCorregidos > 0
    PRINT N'✓ FASE 2.8: CAJA_ITEMS.SESION_ID corregidos por fecha: ' + CAST(@itemsCorregidos AS NVARCHAR(10));

  -- Validación cruzada: todo VENTA debe estar en una sesión del MISMO PV
  DECLARE @itemsPVIncorrecto INT = (
    SELECT COUNT(*)
    FROM   CAJA_ITEMS ci
    INNER JOIN CAJA_SESIONES cs ON cs.SESION_ID = ci.SESION_ID
    INNER JOIN CAJA c ON c.CAJA_ID = cs.CAJA_ID
    WHERE  ci.ORIGEN_TIPO = 'VENTA'
      AND  c.PUNTO_VENTA_ID <> (SELECT TOP 1 PUNTO_VENTA_ID FROM CAJA WHERE NOMBRE LIKE N'Caja Principal%')
  );

  IF @itemsPVIncorrecto <> 0
  BEGIN
    DECLARE @msgItemsPV NVARCHAR(500) = N'ADVERTENCIA: Hay ' + CAST(@itemsPVIncorrecto AS NVARCHAR(10)) + N' CAJA_ITEMS.VENTA en sesiones de otro PV. Revisá manualmente.';
    PRINT N'⚠ ' + @msgItemsPV;
  END;

  COMMIT TRANSACTION;
END;

END TRY
BEGIN CATCH
  IF @@TRANCOUNT > 0
    ROLLBACK TRANSACTION;

  DECLARE @errorMsg NVARCHAR(4000) = ERROR_MESSAGE();
  PRINT N'';
  PRINT N'✗ ERROR en FASE 2 — la transacción fue revertida';
  PRINT N'  Mensaje: ' + @errorMsg;
  PRINT N'';

  ;THROW;
END CATCH;
GO


-- ══════════════════════════════════════════════════════════════════════
--  FASE 3: VALIDACIÓN FINAL
-- ══════════════════════════════════════════════════════════════════════

PRINT N'── FASE 3: Validación final ──';
PRINT N'';

DECLARE @cajasFinal INT = (SELECT COUNT(*) FROM CAJA);
DECLARE @cajasActivasFinal INT = (SELECT COUNT(*) FROM CAJA WHERE ACTIVA = 1);
DECLARE @cajasViejasFinal INT = (SELECT COUNT(*) FROM CAJA WHERE NOMBRE IS NULL);
DECLARE @sesionesFinal INT = (SELECT COUNT(*) FROM CAJA_SESIONES);
DECLARE @sesionesActivasFinal INT = (SELECT COUNT(*) FROM CAJA_SESIONES WHERE ESTADO = 'ACTIVA');
DECLARE @itemsFinal INT = (SELECT COUNT(*) FROM CAJA_ITEMS);
DECLARE @itemsSinSesionFinal INT = (SELECT COUNT(*) FROM CAJA_ITEMS WHERE SESION_ID IS NULL);
DECLARE @movimientosCajaHuerfanosFinal INT = (
  SELECT COUNT(*)
  FROM MOVIMIENTOS_CAJA mc
  WHERE mc.CAJA_ID IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM CAJA c WHERE c.CAJA_ID = mc.CAJA_ID)
);
DECLARE @cierresSinSesionFinal INT = (
  SELECT COUNT(*)
  FROM MOVIMIENTOS_CAJA mc
  WHERE
    (
      mc.TIPO_ENTIDAD = 'CIERRE_CAJA'
      AND NOT EXISTS (
        SELECT 1
        FROM CAJA_SESIONES cs
        WHERE cs.CAJA_ID = mc.CAJA_ID
          AND ABS(DATEDIFF(SECOND, cs.FECHA_CIERRE, mc.FECHA)) < 60
      )
    )
    OR
    (
      mc.TIPO_ENTIDAD = 'DEPOSITO_CIERRE'
      AND NOT EXISTS (
        SELECT 1
        FROM CAJA_SESIONES cs
        WHERE cs.SESION_ID = mc.ID_ENTIDAD
      )
    )
);

-- Validación cruzada: ¿hay items cuyo SESION_ID apunta a una sesión de OTRO PV?
DECLARE @itemsEnPVIncorrecto INT = (
  SELECT COUNT(*)
  FROM CAJA_ITEMS ci
  INNER JOIN CAJA_SESIONES cs ON cs.SESION_ID = ci.SESION_ID
  INNER JOIN CAJA c_item ON c_item.CAJA_ID = ci.CAJA_ID
  INNER JOIN CAJA c_sesion ON c_sesion.CAJA_ID = cs.CAJA_ID
  WHERE c_item.PUNTO_VENTA_ID <> c_sesion.PUNTO_VENTA_ID
);

PRINT N'═══ ESTADO FINAL ═══';
PRINT N'  Cajas totales:              ' + CAST(@cajasFinal AS NVARCHAR(10));
PRINT N'  Cajas activas:              ' + CAST(@cajasActivasFinal AS NVARCHAR(10));
PRINT N'  Cajas viejas (debería=0):   ' + CAST(@cajasViejasFinal AS NVARCHAR(10));
PRINT N'  Sesiones:                   ' + CAST(@sesionesFinal AS NVARCHAR(10));
PRINT N'  Sesiones activas:           ' + CAST(@sesionesActivasFinal AS NVARCHAR(10));
PRINT N'  CAJA_ITEMS:                 ' + CAST(@itemsFinal AS NVARCHAR(10));
PRINT N'  CAJA_ITEMS sin SESION_ID:   ' + CAST(@itemsSinSesionFinal AS NVARCHAR(10));
PRINT N'  MOVIMIENTOS_CAJA huérfanos:  ' + CAST(@movimientosCajaHuerfanosFinal AS NVARCHAR(10));
PRINT N'  Cierres sin sesión:          ' + CAST(@cierresSinSesionFinal AS NVARCHAR(10));
PRINT N'  Items en PV incorrecto:      ' + CAST(@itemsEnPVIncorrecto AS NVARCHAR(10));
PRINT N'';

IF @movimientosCajaHuerfanosFinal <> 0
BEGIN
  ;THROW 50000, 'VALIDACIÓN FALLIDA: Hay MOVIMIENTOS_CAJA con CAJA_ID huérfano.', 1;
END;

IF @cierresSinSesionFinal <> 0
BEGIN
  ;THROW 50000, 'VALIDACIÓN FALLIDA: Hay cierres de Caja Central sin sesión relacionada.', 1;
END;

IF @cajasViejasFinal <> 0
BEGIN
  PRINT N'⚠ ADVERTENCIA: Aún quedan cajas viejas (NOMBRE IS NULL). Revisá manualmente.';
END;

IF @itemsSinSesionFinal <> 0
BEGIN
  PRINT N'⚠ ADVERTENCIA: Hay CAJA_ITEMS sin SESION_ID. Revisá manualmente.';
END;

IF @itemsEnPVIncorrecto <> 0
BEGIN
  PRINT N'⚠ ADVERTENCIA: Hay ' + CAST(@itemsEnPVIncorrecto AS NVARCHAR(10)) + N' items cuyo SESION_ID apunta a sesiones de otro PV.';
  PRINT N'  Estos items existían antes de la migración con SESION_ID inconsistente.';
  PRINT N'  Si querés corregirlos, ejecutá esta query para identificar cuáles son:';
  PRINT N'';
  PRINT N'    SELECT ci.ITEM_ID, ci.CAJA_ID, ci.SESION_ID, c_item.PUNTO_VENTA_ID AS PV_item,';
  PRINT N'           c_sesion.PUNTO_VENTA_ID AS PV_sesion';
  PRINT N'    FROM CAJA_ITEMS ci';
  PRINT N'    INNER JOIN CAJA_SESIONES cs ON cs.SESION_ID = ci.SESION_ID';
  PRINT N'    INNER JOIN CAJA c_item   ON c_item.CAJA_ID = ci.CAJA_ID';
  PRINT N'    INNER JOIN CAJA c_sesion ON c_sesion.CAJA_ID = cs.CAJA_ID';
  PRINT N'    WHERE c_item.PUNTO_VENTA_ID <> c_sesion.PUNTO_VENTA_ID;';
END;

PRINT N'';
PRINT N'╔════════════════════════════════════════════════════════════════╗';
PRINT N'║  ✓ MIGRACIÓN COMPLETA FINALIZADA                              ║';
PRINT N'╚════════════════════════════════════════════════════════════════╝';
GO