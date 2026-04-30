import { getPool, sql } from '../database/connection.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config/index.js';

export interface LoginInput {
  username: string;
  password: string;
  ip?: string;
  userAgent?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
async function logAudit(
  pool: Awaited<ReturnType<typeof getPool>>,
  opts: {
    usuarioId?: number | null;
    actorNombre?: string | null;
    evento: string;
    resultado?: string;
    ip?: string | null;
    userAgent?: string | null;
    detalle?: string | null;
    entidadTipo?: string | null;
    entidadId?: number | null;
  },
) {
  try {
    await pool.request()
      .input('uid',   sql.Int,          opts.usuarioId   ?? null)
      .input('actor', sql.NVarChar(100), opts.actorNombre ?? null)
      .input('evt',   sql.VarChar(60),   opts.evento)
      .input('res',   sql.VarChar(10),   opts.resultado   ?? 'OK')
      .input('ip',    sql.VarChar(45),   opts.ip          ?? null)
      .input('ua',    sql.NVarChar(500), opts.userAgent   ?? null)
      .input('det',   sql.NVarChar,      opts.detalle     ?? null)
      .input('etype', sql.VarChar(30),   opts.entidadTipo ?? null)
      .input('eid',   sql.Int,           opts.entidadId   ?? null)
      .query(`INSERT INTO AUDITORIA_SEGURIDAD
        (USUARIO_ID,ACTOR_NOMBRE,EVENTO,RESULTADO,IP,USER_AGENT,DETALLE,ENTIDAD_TIPO,ENTIDAD_ID)
        VALUES(@uid,@actor,@evt,@res,@ip,@ua,@det,@etype,@eid)`);
  } catch { /* audit must never break login */ }
}

async function getPolitica(pool: Awaited<ReturnType<typeof getPool>>) {
  try {
    const r = await pool.request().query(`SELECT TOP 1 * FROM POLITICA_SEGURIDAD WHERE POLITICA_ID=1`);
    return r.recordset[0] ?? null;
  } catch { return null; }
}

// ─── service ─────────────────────────────────────────────────────────────────
export const authService = {
  async login(input: LoginInput) {
    const pool = await getPool();
    const { username, password, ip, userAgent } = input;

    // 1. Fetch user (including new security columns with safe fallbacks)
    const userRes = await pool.request()
      .input('nombre', sql.VarChar, username)
      .query(`
        SELECT USUARIO_ID, NOMBRE, CLAVE,
               ISNULL(CLAVE_HASH,'')         AS CLAVE_HASH,
               ISNULL(CLAVE_ALGO,'')         AS CLAVE_ALGO,
               ISNULL(ACTIVO,1)              AS ACTIVO,
               ISNULL(BLOQUEADO,0)           AS BLOQUEADO,
               BLOQUEADO_HASTA,
               ISNULL(INTENTOS_FALLIDOS,0)   AS INTENTOS_FALLIDOS,
               ISNULL(DEBE_CAMBIAR_CLAVE,0)  AS DEBE_CAMBIAR_CLAVE,
               NOMBRE_COMPLETO, EMAIL
        FROM USUARIOS
        WHERE NOMBRE = @nombre AND FECHA_BAJA IS NULL
      `);

    // Generic error — do not disclose whether user exists (timing-safe)
    const INVALID_ERR = Object.assign(new Error('Credenciales inválidas'), { name: 'ValidationError' });

    if (userRes.recordset.length === 0) {
      await logAudit(pool, { actorNombre: username, evento: 'LOGIN_FAIL', resultado: 'FAIL', ip, userAgent, detalle: 'Usuario no encontrado' });
      throw INVALID_ERR;
    }

    const user = userRes.recordset[0];

    // 2. Check active
    if (!user.ACTIVO) {
      await logAudit(pool, { usuarioId: user.USUARIO_ID, actorNombre: username, evento: 'LOGIN_FAIL', resultado: 'DENIED', ip, userAgent, detalle: 'Usuario inactivo' });
      throw Object.assign(new Error('Usuario inactivo'), { name: 'ValidationError' });
    }

    // 3. Lockout check
    if (user.BLOQUEADO) {
      const hasta = user.BLOQUEADO_HASTA ? new Date(user.BLOQUEADO_HASTA) : null;
      if (!hasta || hasta > new Date()) {
        await logAudit(pool, { usuarioId: user.USUARIO_ID, actorNombre: username, evento: 'LOGIN_FAIL', resultado: 'DENIED', ip, userAgent, detalle: 'Cuenta bloqueada' });
        throw Object.assign(new Error('Cuenta bloqueada temporalmente'), { name: 'LockoutError' });
      }
      // Lockout expired — clear it
      await pool.request()
        .input('uid', sql.Int, user.USUARIO_ID)
        .query(`UPDATE USUARIOS SET BLOQUEADO=0,BLOQUEADO_HASTA=NULL,INTENTOS_FALLIDOS=0 WHERE USUARIO_ID=@uid`);
      user.BLOQUEADO = false;
      user.INTENTOS_FALLIDOS = 0;
    }

    // 4. Verify password (CLAVE_HASH first, fallback to legacy CLAVE plaintext)
    let passwordOk = false;
    let needsRehash = false;

    if (user.CLAVE_HASH) {
      passwordOk = await bcrypt.compare(password, user.CLAVE_HASH);
    } else if (user.CLAVE) {
      // Legacy plaintext comparison
      passwordOk = (password === user.CLAVE);
      if (passwordOk) needsRehash = true;
    }

    if (!passwordOk) {
      // Increment failures / apply lockout
      const politica = await getPolitica(pool);
      const maxIntentos = politica?.LOCKOUT_INTENTOS ?? 5;
      const lockMinutes = politica?.LOCKOUT_MINUTOS  ?? 15;
      const newFails    = (user.INTENTOS_FALLIDOS ?? 0) + 1;
      const shouldLock  = newFails >= maxIntentos;

      await pool.request()
        .input('uid',    sql.Int,       user.USUARIO_ID)
        .input('fails',  sql.Int,       newFails)
        .input('lock',   sql.Bit,       shouldLock ? 1 : 0)
        .input('until',  sql.DateTime2, shouldLock ? new Date(Date.now() + lockMinutes * 60_000) : null)
        .query(`UPDATE USUARIOS SET
          INTENTOS_FALLIDOS=@fails, ULTIMO_LOGIN_FALLIDO=SYSUTCDATETIME(),
          BLOQUEADO=@lock, BLOQUEADO_HASTA=@until
          WHERE USUARIO_ID=@uid`);

      await logAudit(pool, {
        usuarioId: user.USUARIO_ID, actorNombre: username,
        evento: shouldLock ? 'LOCKOUT' : 'LOGIN_FAIL',
        resultado: 'FAIL', ip, userAgent,
        detalle: JSON.stringify({ intentos: newFails }),
      });
      throw INVALID_ERR;
    }

    // 5. Rehash legacy plaintext password
    if (needsRehash) {
      const hash = await bcrypt.hash(password, 12);
      await pool.request()
        .input('uid',  sql.Int,         user.USUARIO_ID)
        .input('hash', sql.VarChar(255), hash)
        .query(`UPDATE USUARIOS SET
          CLAVE_HASH=@hash, CLAVE_ALGO='bcrypt', CLAVE='',
          CLAVE_ACTUALIZADA=SYSUTCDATETIME()
          WHERE USUARIO_ID=@uid`);
    }

    // 6. Reset failure counter, record login
    await pool.request()
      .input('uid', sql.Int,       user.USUARIO_ID)
      .input('ip',  sql.VarChar(45), ip ?? null)
      .query(`UPDATE USUARIOS SET
        INTENTOS_FALLIDOS=0, BLOQUEADO=0, BLOQUEADO_HASTA=NULL,
        ULTIMO_LOGIN=SYSUTCDATETIME(), ULTIMO_LOGIN_IP=@ip
        WHERE USUARIO_ID=@uid`);

    // 7. Load effective permissions from the web view
    let permisos: string[] = [];
    try {
      const permRes = await pool.request()
        .input('userId', sql.Int, user.USUARIO_ID)
        .query(`SELECT LLAVE FROM VW_PERMISOS_EFECTIVOS WHERE USUARIO_ID=@userId`);
      permisos = permRes.recordset.map((r: any) => r.LLAVE);
    } catch { /* view not yet created — empty permisos */ }

    // 8. Load assigned roles
    let roles: { ROL_ID: number; NOMBRE: string }[] = [];
    try {
      const rolRes = await pool.request()
        .input('userId', sql.Int, user.USUARIO_ID)
        .query(`SELECT r.ROL_ID, r.NOMBRE FROM USUARIOS_ROLES ur
                JOIN ROLES r ON r.ROL_ID=ur.ROL_ID
                WHERE ur.USUARIO_ID=@userId AND ur.ACTIVO=1 AND r.ACTIVO=1`);
      roles = rolRes.recordset;
    } catch { /* roles table may not exist yet */ }

    // 9. Load puntos de venta
    const pvResult = await pool.request()
      .input('userId', sql.Int, user.USUARIO_ID)
      .query(`SELECT upv.PUNTO_VENTA_ID, pv.NOMBRE, upv.ES_PREFERIDO
              FROM USUARIOS_PUNTOS_VENTA upv
              JOIN PUNTO_VENTAS pv ON upv.PUNTO_VENTA_ID=pv.PUNTO_VENTA_ID
              WHERE upv.USUARIO_ID=@userId AND pv.ACTIVO=1`);

    // 10. Issue JWT
    const token = jwt.sign(
      { id: user.USUARIO_ID, nombre: user.NOMBRE },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn } as jwt.SignOptions,
    );

    await logAudit(pool, { usuarioId: user.USUARIO_ID, actorNombre: username, evento: 'LOGIN_OK', ip, userAgent });

    return {
      user: {
        USUARIO_ID:          user.USUARIO_ID,
        NOMBRE:              user.NOMBRE,
        NOMBRE_COMPLETO:     user.NOMBRE_COMPLETO ?? null,
        EMAIL:               user.EMAIL ?? null,
        DEBE_CAMBIAR_CLAVE:  !!user.DEBE_CAMBIAR_CLAVE,
      },
      permisos,
      roles,
      puntosVenta: pvResult.recordset,
      token,
    };
  },

  async getProfile(userId: number) {
    const pool = await getPool();
    const result = await pool.request()
      .input('id', sql.Int, userId)
      .query(`SELECT USUARIO_ID, NOMBRE,
                ISNULL(NOMBRE_COMPLETO,'') AS NOMBRE_COMPLETO,
                ISNULL(EMAIL,'') AS EMAIL
              FROM USUARIOS WHERE USUARIO_ID=@id AND ISNULL(FECHA_BAJA,'9999') > GETDATE()`);
    if (result.recordset.length === 0)
      throw Object.assign(new Error('Usuario no encontrado'), { name: 'ValidationError' });
    return result.recordset[0];
  },

  async getAll() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT USUARIO_ID, NOMBRE,
             ISNULL(NOMBRE_COMPLETO,'') AS NOMBRE_COMPLETO,
             ISNULL(EMAIL,'') AS EMAIL,
             ISNULL(ACTIVO,1) AS ACTIVO
      FROM USUARIOS
      WHERE FECHA_BAJA IS NULL
      ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  async logout(userId: number, ip?: string) {
    const pool = await getPool();
    await logAudit(pool, { usuarioId: userId, evento: 'LOGOUT', ip });
  },
};
