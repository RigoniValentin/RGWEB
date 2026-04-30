-- ─────────────────────────────────────────────────────────────
-- Agregar permiso `backups.administrar` para sistemas ya migrados
-- ─────────────────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[PERMISOS_WEB]') AND type = N'U')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM PERMISOS_WEB WHERE LLAVE = 'backups.administrar')
    BEGIN
        INSERT INTO PERMISOS_WEB (LLAVE, DESCRIPCION, MODULO, CATEGORIA, RIESGO, ORDEN)
        VALUES ('backups.administrar', 'Administrar copias de seguridad', 'configuracion', 'admin', 'ALTO', 30);
        PRINT '✅ Permiso backups.administrar agregado';
    END

    -- Asignar al SUPERADMIN si existe
    DECLARE @SUPER INT = (SELECT ROL_ID FROM ROLES WHERE NOMBRE = 'SUPERADMIN');
    DECLARE @PERM INT = (SELECT PERMISO_ID FROM PERMISOS_WEB WHERE LLAVE = 'backups.administrar');
    IF @SUPER IS NOT NULL AND @PERM IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM ROLES_PERMISOS WHERE ROL_ID = @SUPER AND PERMISO_ID = @PERM)
    BEGIN
        INSERT INTO ROLES_PERMISOS (ROL_ID, PERMISO_ID) VALUES (@SUPER, @PERM);
        PRINT '✅ Permiso asignado a SUPERADMIN';
    END
END
GO
