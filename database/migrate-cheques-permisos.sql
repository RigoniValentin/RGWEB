-- ─────────────────────────────────────────────────────────────
-- Agregar permisos del módulo Cheques
--   cheques.ver     → acceder a la página + consultar cheques
--   cheques.editar  → crear, modificar estado, salida masiva
-- ─────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PERMISOS_WEB]') AND type = N'U')
BEGIN
    PRINT '⚠ Tabla PERMISOS_WEB no encontrada. Ejecutar primero migrate-usuarios-permisos.sql';
    RETURN;
END

-- ── 1. Insertar las llaves si no existen ──────────────────────
IF NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = 'cheques.ver')
BEGIN
    INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
    VALUES ('cheques.ver', 'Ver listado y cartera de cheques', 'cheques', 'lectura', 'MEDIO', 10);
    PRINT '✅ Permiso cheques.ver agregado';
END
ELSE PRINT '— cheques.ver ya existía';

IF NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = 'cheques.editar')
BEGIN
    INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
    VALUES ('cheques.editar', 'Crear, editar y gestionar estados de cheques', 'cheques', 'escritura', 'ALTO', 20);
    PRINT '✅ Permiso cheques.editar agregado';
END
ELSE PRINT '— cheques.editar ya existía';

-- ── 2. Asignar a cada rol de sistema ─────────────────────────
DECLARE @permVer   INT = (SELECT PERMISO_ID FROM PERMISOS_WEB WHERE LLAVE = 'cheques.ver');
DECLARE @permEdit  INT = (SELECT PERMISO_ID FROM PERMISOS_WEB WHERE LLAVE = 'cheques.editar');

-- Roles que deben recibir ambos permisos
DECLARE @roles TABLE (ROL_ID INT);
INSERT INTO @roles
SELECT ROL_ID FROM ROLES WHERE NOMBRE IN ('SUPERADMIN', 'ADMIN', 'GERENTE');

-- cheques.ver
INSERT INTO ROLES_PERMISOS (ROL_ID, PERMISO_ID)
SELECT r.ROL_ID, @permVer
FROM @roles r
WHERE NOT EXISTS (
    SELECT 1 FROM ROLES_PERMISOS rp
    WHERE rp.ROL_ID = r.ROL_ID AND rp.PERMISO_ID = @permVer
);

-- cheques.editar  (solo SUPERADMIN y ADMIN por defecto; ajustar según política)
INSERT INTO ROLES_PERMISOS (ROL_ID, PERMISO_ID)
SELECT r.ROL_ID, @permEdit
FROM @roles r
INNER JOIN ROLES ro ON ro.ROL_ID = r.ROL_ID AND ro.NOMBRE IN ('SUPERADMIN', 'ADMIN')
WHERE NOT EXISTS (
    SELECT 1 FROM ROLES_PERMISOS rp
    WHERE rp.ROL_ID = r.ROL_ID AND rp.PERMISO_ID = @permEdit
);

PRINT '✅ Permisos asignados a roles SUPERADMIN / ADMIN / GERENTE (ver) y SUPERADMIN / ADMIN (editar)';
GO
