/**
 * migrate-hash-claves.ts
 * ──────────────────────
 * Migra todos los usuarios que tienen CLAVE en texto plano (sin CLAVE_HASH)
 * a bcrypt. También resetea INTENTOS_FALLIDOS si están en un estado sucio.
 *
 * Uso:  npx tsx migrate-hash-claves.ts
 * Desde: backend/
 *
 * SEGURO para correr múltiples veces (solo toca usuarios sin CLAVE_HASH).
 */
import { getPool, sql } from './src/database/connection.js';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════╗');
  console.log('║  Migración: CLAVE plano → bcrypt (CLAVE_HASH)     ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  const pool = await getPool();
  console.log('✅ Conexión establecida\n');

  // 1. Obtener usuarios con CLAVE en texto plano y sin CLAVE_HASH
  const result = await pool.request().query(`
    SELECT USUARIO_ID, NOMBRE, CLAVE
    FROM USUARIOS
    WHERE FECHA_BAJA IS NULL
      AND (CLAVE_HASH IS NULL OR CLAVE_HASH = '')
      AND CLAVE IS NOT NULL
      AND CLAVE <> ''
  `);

  const usuarios = result.recordset;

  if (usuarios.length === 0) {
    console.log('ℹ️  No hay usuarios con CLAVE en texto plano. Nada que migrar.\n');
  } else {
    console.log(`👥 Usuarios a migrar: ${usuarios.length}\n`);

    for (const u of usuarios) {
      process.stdout.write(`   → [${u.USUARIO_ID}] ${String(u.NOMBRE).padEnd(20)} `);
      try {
        const hash = await bcrypt.hash(u.CLAVE, 12);
        await pool.request()
          .input('id',   sql.Int,         u.USUARIO_ID)
          .input('hash', sql.VarChar(255), hash)
          .query(`
            UPDATE USUARIOS
            SET CLAVE_HASH        = @hash,
                CLAVE_ALGO        = 'bcrypt',
                CLAVE_ACTUALIZADA = SYSUTCDATETIME()
            WHERE USUARIO_ID = @id
          `);
        console.log(`✅ OK  (contraseña: "${u.CLAVE}")`);
      } catch (err: any) {
        console.log(`❌ ERROR: ${err.message}`);
      }
    }
  }

  // 2. Resetear INTENTOS_FALLIDOS para usuarios sucios (>0 pero no bloqueados)
  const resetResult = await pool.request().query(`
    UPDATE USUARIOS
    SET INTENTOS_FALLIDOS = 0
    WHERE INTENTOS_FALLIDOS > 0
      AND ISNULL(BLOQUEADO, 0) = 0
      AND FECHA_BAJA IS NULL
  `);
  console.log(`\n🔄 INTENTOS_FALLIDOS reseteados: ${resetResult.rowsAffected[0]} usuario(s)`);

  // 3. Resumen final
  const resumen = await pool.request().query(`
    SELECT
      USUARIO_ID,
      NOMBRE,
      CASE
        WHEN CLAVE_HASH LIKE '$2%' THEN 'bcrypt OK'
        WHEN CLAVE_HASH IS NULL OR CLAVE_HASH = '' THEN 'sin hash'
        ELSE 'otro'
      END AS HASH_ESTADO,
      ISNULL(ACTIVO,    1) AS ACTIVO,
      ISNULL(BLOQUEADO, 0) AS BLOQUEADO,
      ISNULL(INTENTOS_FALLIDOS, 0) AS INTENTOS
    FROM USUARIOS
    WHERE FECHA_BAJA IS NULL
    ORDER BY USUARIO_ID
  `);

  console.log('\n──── Estado final ──────────────────────────────────────────');
  console.log('ID   Nombre               Hash        Activo  Bloq  Intentos');
  console.log('─────────────────────────────────────────────────────────────');
  for (const r of resumen.recordset) {
    console.log(
      String(r.USUARIO_ID).padStart(3) + '  ' +
      String(r.NOMBRE).padEnd(20) + '  ' +
      String(r.HASH_ESTADO).padEnd(10) + '  ' +
      String(r.ACTIVO).padEnd(6) + '  ' +
      String(r.BLOQUEADO).padEnd(4) + '  ' +
      r.INTENTOS
    );
  }

  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});
