-- ─────────────────────────────────────────────────────────────
-- Permiso: Rendimiento de cajeros
--   dashboard.rendimiento
--     → acceder al modal de Rendimiento de Cajeros en el dashboard
--     → ver KPIs por cajero (ventas, ticket promedio, ganancia, etc.)
--     → los cajeros también ven "Mi rendimiento" con sus propios datos
-- ─────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PERMISOS_WEB]') AND type = N'U')
BEGIN
    PRINT '⚠ Tabla PERMISOS_WEB no encontrada. Ejecutar primero migrate-usuarios-permisos.sql';
    RETURN;
END

-- ── 1. Insertar la llave si no existe ─────────────────────────
IF NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = 'dashboard.rendimiento')
BEGIN
    INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
    VALUES (
        'dashboard.rendimiento',
        'Ver KPIs de rendimiento por cajero (ventas, ticket promedio, ganancia, etc.) y reconocimiento de bonos',
        'dashboard',
        'lectura',
        'BAJO',
        50
    );
    PRINT '✅ Permiso dashboard.rendimiento agregado';
END
ELSE PRINT '— dashboard.rendimiento ya existía';

-- ── 2. Asignar a roles de sistema ─────────────────────────────
DECLARE @perm INT = (SELECT PERMISO_ID FROM PERMISOS_WEB WHERE LLAVE = 'dashboard.rendimiento');

DECLARE @roles TABLE (ROL_ID INT);
INSERT INTO @roles
SELECT ROL_ID FROM ROLES WHERE NOMBRE IN ('SUPERADMIN', 'ADMIN', 'GERENTE');

INSERT INTO ROLES_PERMISOS (ROL_ID, PERMISO_ID)
SELECT r.ROL_ID, @perm
FROM @roles r
WHERE NOT EXISTS (
    SELECT 1 FROM ROLES_PERMISOS rp
    WHERE rp.ROL_ID = r.ROL_ID AND rp.PERMISO_ID = @perm
);

PRINT '✅ Permiso dashboard.rendimiento asignado a roles SUPERADMIN / ADMIN / GERENTE';
PRINT '   Los cajeros (rol CAJERO) NO necesitan este permiso: la ruta del backend';
PRINT '   detecta automáticamente los usuarios sin permiso y les fuerza `usuarioId = self`,';
PRINT '   por lo que sólo pueden ver sus propios KPIs.';
GO
