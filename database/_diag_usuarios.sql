-- ═══════════════════════════════════════════════════════════════════════════
--  DIAGNÓSTICO: Estado de usuarios en SanCayetanoDB
--  Ejecutar en SSMS contra la base SanCayetanoDB
-- ═══════════════════════════════════════════════════════════════════════════
SELECT
  USUARIO_ID,
  NOMBRE,
  -- Formato de la clave heredada (app de escritorio)
  CASE
    WHEN CLAVE IS NULL     THEN 'NULL'
    WHEN CLAVE = ''        THEN 'VACÍA'
    WHEN LEN(CLAVE) = 32   THEN 'MD5 (32 chars)'
    WHEN LEN(CLAVE) = 40   THEN 'SHA1 (40 chars)'
    WHEN LEN(CLAVE) = 64   THEN 'SHA256 (64 chars)'
    ELSE 'TEXTO PLANO u otro (len=' + CAST(LEN(CLAVE) AS VARCHAR) + ')'
  END AS CLAVE_FORMATO,
  LEFT(CLAVE, 8)  AS CLAVE_PREVIEW,        -- solo primeros 8 chars para no exponer

  -- Estado de la clave hash web (bcrypt)
  CASE
    WHEN CLAVE_HASH IS NULL THEN 'NULL (columna no existe o sin hash)'
    WHEN CLAVE_HASH = ''    THEN 'VACÍA'
    WHEN CLAVE_HASH LIKE '$2a$%'
      OR CLAVE_HASH LIKE '$2b$%' THEN 'bcrypt OK'
    ELSE 'DESCONOCIDO: ' + LEFT(CLAVE_HASH, 10)
  END AS CLAVE_HASH_ESTADO,

  -- Estado de seguridad
  ISNULL(ACTIVO,    -1) AS ACTIVO,      -- -1 = columna no existe todavía
  ISNULL(BLOQUEADO, -1) AS BLOQUEADO,   -- -1 = columna no existe todavía
  ISNULL(INTENTOS_FALLIDOS, -1) AS INTENTOS_FALLIDOS,

  -- Soft delete
  CASE
    WHEN FECHA_BAJA IS NULL THEN 'activo (no dado de baja)'
    ELSE 'DADO DE BAJA: ' + CAST(FECHA_BAJA AS VARCHAR(30))
  END AS FECHA_BAJA_INFO

FROM USUARIOS
ORDER BY USUARIO_ID;
