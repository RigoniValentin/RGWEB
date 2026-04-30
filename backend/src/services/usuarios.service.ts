import { getPool, sql } from '../database/connection.js';
import bcrypt from 'bcryptjs';
import type {
  UsuarioConRoles, Rol, PermisoWeb,
  AuditoriaEvento, PoliticaSeguridad, SesionActiva,
} from '../types/index.js';

// ─── helpers ─────────────────────────────────────────────────────────────────
async function logAudit(
  pool: Awaited<ReturnType<typeof getPool>>,
  opts: {
    actorId: number;
    actorNombre: string;
    evento: string;
    resultado?: string;
    ip?: string | null;
    entidadTipo?: string | null;
    entidadId?: number | null;
    detalle?: string | null;
  },
) {
  try {
    await pool.request()
      .input('uid',   sql.Int,          opts.actorId)
      .input('actor', sql.NVarChar(100), opts.actorNombre)
      .input('evt',   sql.VarChar(60),   opts.evento)
      .input('res',   sql.VarChar(10),   opts.resultado   ?? 'OK')
      .input('ip',    sql.VarChar(45),   opts.ip          ?? null)
      .input('det',   sql.NVarChar,      opts.detalle     ?? null)
      .input('etype', sql.VarChar(30),   opts.entidadTipo ?? null)
      .input('eid',   sql.Int,           opts.entidadId   ?? null)
      .query(`INSERT INTO AUDITORIA_SEGURIDAD
        (USUARIO_ID,ACTOR_NOMBRE,EVENTO,RESULTADO,IP,DETALLE,ENTIDAD_TIPO,ENTIDAD_ID)
        VALUES(@uid,@actor,@evt,@res,@ip,@det,@etype,@eid)`);
  } catch { /* audit never breaks main flow */ }
}

function validationError(msg: string) {
  return Object.assign(new Error(msg), { name: 'ValidationError' });
}

// ─── service ─────────────────────────────────────────────────────────────────
export const usuariosService = {

  // ── List ────────────────────────────────────────────────────────────────────
  async getAll(filters: { search?: string; activo?: boolean; rolId?: number; puntoVentaId?: number } = {}) {
    const pool = await getPool();

    let where = `WHERE u.FECHA_BAJA IS NULL`;
    const req = pool.request();

    if (filters.search) {
      req.input('search', sql.NVarChar(100), `%${filters.search}%`);
      where += ` AND (u.NOMBRE LIKE @search OR ISNULL(u.EMAIL,'') LIKE @search OR ISNULL(u.NOMBRE_COMPLETO,'') LIKE @search)`;
    }
    if (filters.activo !== undefined) {
      req.input('activo', sql.Bit, filters.activo ? 1 : 0);
      where += ` AND ISNULL(u.ACTIVO,1) = @activo`;
    }
    if (filters.rolId !== undefined) {
      req.input('rolId', sql.Int, filters.rolId);
      where += ` AND EXISTS (SELECT 1 FROM USUARIOS_ROLES ur WHERE ur.USUARIO_ID=u.USUARIO_ID AND ur.ROL_ID=@rolId AND ur.ACTIVO=1)`;
    }
    if (filters.puntoVentaId !== undefined) {
      req.input('pvId', sql.Int, filters.puntoVentaId);
      where += ` AND EXISTS (SELECT 1 FROM USUARIOS_PUNTOS_VENTA upv WHERE upv.USUARIO_ID=u.USUARIO_ID AND upv.PUNTO_VENTA_ID=@pvId)`;
    }

    const usersRes = await req.query<any>(`
      SELECT u.USUARIO_ID, u.NOMBRE,
             ISNULL(u.NOMBRE_COMPLETO,'')  AS NOMBRE_COMPLETO,
             ISNULL(u.EMAIL,'')            AS EMAIL,
             ISNULL(u.TELEFONO,'')         AS TELEFONO,
             ISNULL(u.ACTIVO,1)            AS ACTIVO,
             ISNULL(u.BLOQUEADO,0)         AS BLOQUEADO,
             u.BLOQUEADO_HASTA,
             ISNULL(u.INTENTOS_FALLIDOS,0) AS INTENTOS_FALLIDOS,
             ISNULL(u.DEBE_CAMBIAR_CLAVE,0) AS DEBE_CAMBIAR_CLAVE,
             ISNULL(u.MFA_ACTIVO,0)        AS MFA_ACTIVO,
             u.ULTIMO_LOGIN,
             u.FECHA_ALTA
      FROM USUARIOS u
      ${where}
      ORDER BY u.NOMBRE
    `);

    const users = usersRes.recordset;
    if (users.length === 0) return [];

    // Fetch roles for all users in one query
    const ids = users.map((u: any) => u.USUARIO_ID).join(',');
    let rolesMap: Record<number, { ROL_ID: number; NOMBRE: string }[]> = {};
    try {
      const rolesRes = await pool.request().query<any>(`
        SELECT ur.USUARIO_ID, r.ROL_ID, r.NOMBRE
        FROM USUARIOS_ROLES ur
        JOIN ROLES r ON r.ROL_ID=ur.ROL_ID
        WHERE ur.USUARIO_ID IN (${ids}) AND ur.ACTIVO=1 AND r.ACTIVO=1
      `);
      for (const row of rolesRes.recordset) {
        if (!rolesMap[row.USUARIO_ID]) rolesMap[row.USUARIO_ID] = [];
        rolesMap[row.USUARIO_ID].push({ ROL_ID: row.ROL_ID, NOMBRE: row.NOMBRE });
      }
    } catch { /* roles table may not exist */ }

    // Fetch puntos de venta for all users in one query
    let pvsMap: Record<number, { PUNTO_VENTA_ID: number; NOMBRE: string; ES_PREFERIDO: boolean }[]> = {};
    try {
      const pvRes = await pool.request().query<any>(`
        SELECT upv.USUARIO_ID, upv.PUNTO_VENTA_ID, pv.NOMBRE, upv.ES_PREFERIDO
        FROM USUARIOS_PUNTOS_VENTA upv
        JOIN PUNTO_VENTAS pv ON pv.PUNTO_VENTA_ID=upv.PUNTO_VENTA_ID
        WHERE upv.USUARIO_ID IN (${ids}) AND pv.ACTIVO=1
      `);
      for (const row of pvRes.recordset) {
        if (!pvsMap[row.USUARIO_ID]) pvsMap[row.USUARIO_ID] = [];
        pvsMap[row.USUARIO_ID].push({ PUNTO_VENTA_ID: row.PUNTO_VENTA_ID, NOMBRE: row.NOMBRE, ES_PREFERIDO: !!row.ES_PREFERIDO });
      }
    } catch { /* USUARIOS_PUNTOS_VENTA may not exist yet */ }

    return users.map((u: any) => ({
      ...u,
      roles: rolesMap[u.USUARIO_ID] ?? [],
      puntosVenta: pvsMap[u.USUARIO_ID] ?? [],
    })) as UsuarioConRoles[];
  },

  // ── Get by ID ────────────────────────────────────────────────────────────────
  async getById(id: number): Promise<UsuarioConRoles> {
    const pool = await getPool();
    const res = await pool.request()
      .input('id', sql.Int, id)
      .query<any>(`
        SELECT u.USUARIO_ID, u.NOMBRE,
               ISNULL(u.NOMBRE_COMPLETO,'')   AS NOMBRE_COMPLETO,
               ISNULL(u.EMAIL,'')             AS EMAIL,
               ISNULL(u.TELEFONO,'')          AS TELEFONO,
               ISNULL(u.ACTIVO,1)             AS ACTIVO,
               ISNULL(u.BLOQUEADO,0)          AS BLOQUEADO,
               u.BLOQUEADO_HASTA,
               ISNULL(u.INTENTOS_FALLIDOS,0)  AS INTENTOS_FALLIDOS,
               ISNULL(u.DEBE_CAMBIAR_CLAVE,0) AS DEBE_CAMBIAR_CLAVE,
               ISNULL(u.MFA_ACTIVO,0)         AS MFA_ACTIVO,
               u.ULTIMO_LOGIN, u.FECHA_ALTA
        FROM USUARIOS u
        WHERE u.USUARIO_ID=@id AND u.FECHA_BAJA IS NULL
      `);
    if (res.recordset.length === 0) throw validationError('Usuario no encontrado');

    const user = res.recordset[0];
    let roles: { ROL_ID: number; NOMBRE: string }[] = [];
    try {
      const rr = await pool.request().input('id', sql.Int, id).query<any>(`
        SELECT r.ROL_ID, r.NOMBRE FROM USUARIOS_ROLES ur
        JOIN ROLES r ON r.ROL_ID=ur.ROL_ID
        WHERE ur.USUARIO_ID=@id AND ur.ACTIVO=1 AND r.ACTIVO=1
      `);
      roles = rr.recordset;
    } catch { /* */ }

    let puntosVenta: { PUNTO_VENTA_ID: number; NOMBRE: string; ES_PREFERIDO: boolean }[] = [];
    try {
      const pvr = await pool.request().input('id', sql.Int, id).query<any>(`
        SELECT upv.PUNTO_VENTA_ID, pv.NOMBRE, upv.ES_PREFERIDO
        FROM USUARIOS_PUNTOS_VENTA upv
        JOIN PUNTO_VENTAS pv ON pv.PUNTO_VENTA_ID=upv.PUNTO_VENTA_ID
        WHERE upv.USUARIO_ID=@id AND pv.ACTIVO=1
      `);
      puntosVenta = pvr.recordset.map((r: any) => ({ ...r, ES_PREFERIDO: !!r.ES_PREFERIDO }));
    } catch { /* */ }

    return { ...user, roles, puntosVenta };
  },

  // ── Create ───────────────────────────────────────────────────────────────────
  async create(
    data: {
      nombre: string;
      password: string;
      nombreCompleto?: string;
      email?: string;
      telefono?: string;
      rolIds?: number[];
    },
    actorId: number,
    actorNombre: string,
    ip?: string,
  ) {
    const pool = await getPool();

    // Check unique NOMBRE
    const exists = await pool.request()
      .input('nombre', sql.NVarChar(100), data.nombre)
      .query(`SELECT 1 FROM USUARIOS WHERE NOMBRE=@nombre AND FECHA_BAJA IS NULL`);
    if (exists.recordset.length > 0) throw validationError('El nombre de usuario ya existe');

    if (data.email) {
      const emailEx = await pool.request()
        .input('email', sql.NVarChar(255), data.email)
        .query(`SELECT 1 FROM USUARIOS WHERE EMAIL=@email AND FECHA_BAJA IS NULL`);
      if (emailEx.recordset.length > 0) throw validationError('El email ya está en uso');
    }

    // Hash password
    const hash = await bcrypt.hash(data.password, 12);

    // Compute next USUARIO_ID (legacy non-identity PK)
    const maxRes = await pool.request().query(`SELECT ISNULL(MAX(USUARIO_ID),0)+1 AS NEXT_ID FROM USUARIOS`);
    const newId: number = maxRes.recordset[0].NEXT_ID;

    await pool.request()
      .input('id',      sql.Int,          newId)
      .input('nombre',  sql.NVarChar(100), data.nombre)
      .input('hash',    sql.VarChar(255),  hash)
      .input('nc',      sql.NVarChar(150), data.nombreCompleto ?? null)
      .input('email',   sql.NVarChar(255), data.email          ?? null)
      .input('tel',     sql.NVarChar(30),  data.telefono       ?? null)
      .input('creador', sql.Int,           actorId)
      .query(`INSERT INTO USUARIOS
        (USUARIO_ID, NOMBRE, CLAVE, CLAVE_HASH, CLAVE_ALGO,
         NOMBRE_COMPLETO, EMAIL, TELEFONO, ACTIVO, CREADO_POR)
        VALUES (@id, @nombre, '', @hash, 'bcrypt', @nc, @email, @tel, 1, @creador)`);

    // Assign roles
    if (data.rolIds?.length) {
      for (const rolId of data.rolIds) {
        try {
          await pool.request()
            .input('uid',   sql.Int, newId)
            .input('rolId', sql.Int, rolId)
            .input('asig',  sql.Int, actorId)
            .query(`INSERT INTO USUARIOS_ROLES (USUARIO_ID,ROL_ID,ASIGNADO_POR) VALUES(@uid,@rolId,@asig)`);
        } catch { /* skip if already exists or FK error */ }
      }
    }

    await logAudit(pool, { actorId, actorNombre, evento: 'USUARIO_CREADO', entidadTipo: 'USUARIO', entidadId: newId, ip });
    return { USUARIO_ID: newId };
  },

  // ── Update ───────────────────────────────────────────────────────────────────
  async update(
    id: number,
    data: {
      nombreCompleto?: string;
      email?: string;
      telefono?: string;
      debeCambiarClave?: boolean;
      activo?: boolean;
      newPassword?: string;
    },
    actorId: number,
    actorNombre: string,
    ip?: string,
  ) {
    const pool = await getPool();

    const parts: string[] = [];
    const req = pool.request().input('id', sql.Int, id);

    if (data.nombreCompleto !== undefined) { req.input('nc',    sql.NVarChar(150), data.nombreCompleto || null); parts.push('NOMBRE_COMPLETO=@nc'); }
    if (data.email          !== undefined) { req.input('email', sql.NVarChar(255), data.email          || null); parts.push('EMAIL=@email'); }
    if (data.telefono       !== undefined) { req.input('tel',   sql.NVarChar(30),  data.telefono       || null); parts.push('TELEFONO=@tel'); }
    if (data.debeCambiarClave !== undefined) { req.input('dcc', sql.Bit, data.debeCambiarClave ? 1 : 0); parts.push('DEBE_CAMBIAR_CLAVE=@dcc'); }
    if (data.activo !== undefined) { req.input('activo', sql.Bit, data.activo ? 1 : 0); parts.push('ACTIVO=@activo'); }

    if (data.newPassword) {
      const hash = await bcrypt.hash(data.newPassword, 12);
      req.input('hash', sql.VarChar(255), hash);
      parts.push('CLAVE_HASH=@hash, CLAVE_ALGO=\'bcrypt\', CLAVE=\'\', CLAVE_ACTUALIZADA=SYSUTCDATETIME()');
    }

    req.input('mod', sql.Int, actorId);
    parts.push('MODIFICADO_POR=@mod, FECHA_MODIFICACION=SYSUTCDATETIME()');

    if (parts.length > 0) {
      await req.query(`UPDATE USUARIOS SET ${parts.join(', ')} WHERE USUARIO_ID=@id`);
    }

    await logAudit(pool, { actorId, actorNombre, evento: 'USUARIO_EDITADO', entidadTipo: 'USUARIO', entidadId: id, ip });
    return { USUARIO_ID: id };
  },

  // ── Soft delete ──────────────────────────────────────────────────────────────
  async softDelete(id: number, actorId: number, actorNombre: string, ip?: string) {
    const pool = await getPool();
    await pool.request()
      .input('id',  sql.Int, id)
      .input('mod', sql.Int, actorId)
      .query(`UPDATE USUARIOS SET FECHA_BAJA=SYSUTCDATETIME(),ACTIVO=0,MODIFICADO_POR=@mod WHERE USUARIO_ID=@id`);
    await logAudit(pool, { actorId, actorNombre, evento: 'USUARIO_ELIMINADO', entidadTipo: 'USUARIO', entidadId: id, ip });
  },

  // ── Toggle lock ──────────────────────────────────────────────────────────────
  async toggleBloqueo(id: number, bloquear: boolean, actorId: number, actorNombre: string, ip?: string) {
    const pool = await getPool();
    await pool.request()
      .input('id',    sql.Int, id)
      .input('lock',  sql.Bit, bloquear ? 1 : 0)
      .input('fails', sql.Int, bloquear ? 99 : 0)
      .input('mod',   sql.Int, actorId)
      .query(`UPDATE USUARIOS SET BLOQUEADO=@lock, INTENTOS_FALLIDOS=@fails,
              BLOQUEADO_HASTA=NULL, MODIFICADO_POR=@mod WHERE USUARIO_ID=@id`);
    const evt = bloquear ? 'USUARIO_BLOQUEADO' : 'USUARIO_DESBLOQUEADO';
    await logAudit(pool, { actorId, actorNombre, evento: evt, entidadTipo: 'USUARIO', entidadId: id, ip });
  },

  // ── Roles assignment ─────────────────────────────────────────────────────────
  async setRoles(userId: number, rolIds: number[], actorId: number, actorNombre: string, ip?: string) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input('uid', sql.Int, userId)
        .query(`DELETE FROM USUARIOS_ROLES WHERE USUARIO_ID=@uid`);
      for (const rolId of rolIds) {
        await tx.request()
          .input('uid',  sql.Int, userId)
          .input('rid',  sql.Int, rolId)
          .input('asig', sql.Int, actorId)
          .query(`INSERT INTO USUARIOS_ROLES (USUARIO_ID,ROL_ID,ASIGNADO_POR) VALUES(@uid,@rid,@asig)`);
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
    await logAudit(pool, { actorId, actorNombre, evento: 'ROL_ASIGNADO', entidadTipo: 'USUARIO', entidadId: userId, ip,
      detalle: JSON.stringify({ rolIds }) });
  },

  // ── Puntos de venta assignment ────────────────────────────────────────────────
  async setPuntosVenta(
    userId: number,
    pvIds: number[],
    preferidoId: number | null,
    actorId: number,
    actorNombre: string,
    ip?: string,
  ) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input('uid', sql.Int, userId)
        .query(`DELETE FROM USUARIOS_PUNTOS_VENTA WHERE USUARIO_ID=@uid`);
      for (const pvId of pvIds) {
        await tx.request()
          .input('uid',  sql.Int, userId)
          .input('pvid', sql.Int, pvId)
          .input('pref', sql.Bit, preferidoId === pvId ? 1 : 0)
          .query(`INSERT INTO USUARIOS_PUNTOS_VENTA (USUARIO_ID,PUNTO_VENTA_ID,ES_PREFERIDO) VALUES(@uid,@pvid,@pref)`);
      }
      await tx.commit();
    } catch (e) {
      await tx.rollback();
      throw e;
    }
    await logAudit(pool, { actorId, actorNombre, evento: 'PV_ASIGNADO', entidadTipo: 'USUARIO', entidadId: userId, ip,
      detalle: JSON.stringify({ pvIds, preferidoId }) });
  },

  // ── Roles CRUD ───────────────────────────────────────────────────────────────
  async getRoles(): Promise<Rol[]> {
    const pool = await getPool();
    const r = await pool.request().query<any>(`
      SELECT ROL_ID,NOMBRE,DESCRIPCION,ES_SISTEMA,PRIORIDAD,ACTIVO,FECHA_ALTA
      FROM ROLES ORDER BY PRIORIDAD, NOMBRE
    `);
    return r.recordset;
  },

  async getRolById(id: number) {
    const pool = await getPool();
    const r = await pool.request().input('id', sql.Int, id).query<any>(`
      SELECT ROL_ID,NOMBRE,DESCRIPCION,ES_SISTEMA,PRIORIDAD,ACTIVO,FECHA_ALTA FROM ROLES WHERE ROL_ID=@id
    `);
    if (!r.recordset[0]) throw validationError('Rol no encontrado');
    const rol = r.recordset[0];

    const pr = await pool.request().input('id', sql.Int, id).query<any>(`
      SELECT p.PERMISO_ID,p.LLAVE,p.DESCRIPCION,p.MODULO,p.CATEGORIA,p.RIESGO,p.ORDEN
      FROM ROLES_PERMISOS rp JOIN PERMISOS_WEB p ON p.PERMISO_ID=rp.PERMISO_ID
      WHERE rp.ROL_ID=@id AND p.ACTIVO=1 ORDER BY p.MODULO,p.ORDEN
    `);
    return { ...rol, permisos: pr.recordset };
  },

  async setRolPermisos(rolId: number, permisoIds: number[], actorId: number, actorNombre: string) {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().input('rid', sql.Int, rolId).query(`DELETE FROM ROLES_PERMISOS WHERE ROL_ID=@rid`);
      for (const pid of permisoIds) {
        await tx.request().input('rid', sql.Int, rolId).input('pid', sql.Int, pid)
          .query(`INSERT INTO ROLES_PERMISOS (ROL_ID,PERMISO_ID) VALUES(@rid,@pid)`);
      }
      await tx.commit();
    } catch (e) { await tx.rollback(); throw e; }
    await logAudit(pool, { actorId, actorNombre, evento: 'PERMISO_CAMBIO', entidadTipo: 'ROL', entidadId: rolId });
  },

  // ── All web permissions ──────────────────────────────────────────────────────
  async getPermisos(): Promise<PermisoWeb[]> {
    const pool = await getPool();
    const r = await pool.request().query<any>(`
      SELECT PERMISO_ID,LLAVE,DESCRIPCION,MODULO,CATEGORIA,RIESGO,ORDEN
      FROM PERMISOS_WEB WHERE ACTIVO=1 ORDER BY MODULO,ORDEN,LLAVE
    `);
    return r.recordset;
  },

  // ── Effective permissions for one user ───────────────────────────────────────
  async getPermisosUsuario(userId: number) {
    const pool = await getPool();
    // All web permissions
    const allRes = await pool.request().query<any>(`
      SELECT PERMISO_ID,LLAVE,DESCRIPCION,MODULO,CATEGORIA,RIESGO,ORDEN
      FROM PERMISOS_WEB WHERE ACTIVO=1 ORDER BY MODULO,ORDEN
    `);

    let granted = new Set<number>();
    try {
      const vw = await pool.request().input('uid', sql.Int, userId)
        .query<any>(`SELECT PERMISO_ID FROM VW_PERMISOS_EFECTIVOS WHERE USUARIO_ID=@uid`);
      granted = new Set(vw.recordset.map((r: any) => r.PERMISO_ID));
    } catch { /* view may not exist yet */ }

    // Override map from USUARIOS_PERMISOS_OVERRIDE
    let overrides: Record<number, boolean> = {};
    try {
      const ov = await pool.request().input('uid', sql.Int, userId)
        .query<any>(`SELECT PERMISO_ID, ACTIVO FROM USUARIOS_PERMISOS_OVERRIDE WHERE USUARIO_ID=@uid`);
      for (const r of ov.recordset) overrides[r.PERMISO_ID] = !!r.ACTIVO;
    } catch { /* */ }

    return allRes.recordset.map((p: any) => ({
      ...p,
      GRANTED:  granted.has(p.PERMISO_ID),
      OVERRIDE: overrides[p.PERMISO_ID] ?? null,
    }));
  },

  // ── Set a single override for a user ─────────────────────────────────────────
  async setPermisoOverride(
    userId: number, permisoId: number, activo: boolean | null,
    actorId: number, actorNombre: string,
  ) {
    const pool = await getPool();
    if (activo === null) {
      // Remove override
      await pool.request().input('uid', sql.Int, userId).input('pid', sql.Int, permisoId)
        .query(`DELETE FROM USUARIOS_PERMISOS_OVERRIDE WHERE USUARIO_ID=@uid AND PERMISO_ID=@pid`);
    } else {
      // Upsert
      await pool.request()
        .input('uid',    sql.Int, userId)
        .input('pid',    sql.Int, permisoId)
        .input('activo', sql.Bit, activo ? 1 : 0)
        .input('por',    sql.Int, actorId)
        .query(`IF EXISTS (SELECT 1 FROM USUARIOS_PERMISOS_OVERRIDE WHERE USUARIO_ID=@uid AND PERMISO_ID=@pid)
                  UPDATE USUARIOS_PERMISOS_OVERRIDE SET ACTIVO=@activo,OTORGADO_POR=@por,FECHA=SYSUTCDATETIME() WHERE USUARIO_ID=@uid AND PERMISO_ID=@pid
                ELSE
                  INSERT INTO USUARIOS_PERMISOS_OVERRIDE (USUARIO_ID,PERMISO_ID,ACTIVO,OTORGADO_POR) VALUES(@uid,@pid,@activo,@por)`);
    }
    await logAudit(pool, { actorId, actorNombre, evento: 'PERMISO_CAMBIO', entidadTipo: 'PERMISO', entidadId: userId });
  },

  // ── Clear all overrides for a user ───────────────────────────────────────────
  async clearPermisoOverrides(userId: number, actorId: number, actorNombre: string) {
    const pool = await getPool();
    await pool.request().input('uid', sql.Int, userId)
      .query(`DELETE FROM USUARIOS_PERMISOS_OVERRIDE WHERE USUARIO_ID=@uid`);
    await logAudit(pool, { actorId, actorNombre, evento: 'PERMISO_CAMBIO', entidadTipo: 'USUARIO', entidadId: userId, detalle: 'Sobreescritura de permisos: se eliminaron todos los overrides individuales' });
  },

  // ── Clear overrides for all users assigned to a role ─────────────────────────
  async clearOverridesForRole(rolId: number, actorId: number, actorNombre: string) {
    const pool = await getPool();
    await pool.request().input('rolId', sql.Int, rolId)
      .query(`DELETE FROM USUARIOS_PERMISOS_OVERRIDE
              WHERE USUARIO_ID IN (
                SELECT USUARIO_ID FROM USUARIOS_ROLES WHERE ROL_ID=@rolId AND ACTIVO=1
              )`);
    await logAudit(pool, { actorId, actorNombre, evento: 'PERMISO_CAMBIO', entidadTipo: 'ROL', entidadId: rolId, detalle: 'Sobreescritura de permisos del rol: se eliminaron overrides individuales de todos los usuarios del rol' });
  },

  // ── Auditoria ────────────────────────────────────────────────────────────────
  async getAuditoria(filters: {
    usuarioId?: number; evento?: string; resultado?: string;
    fechaDesde?: string; fechaHasta?: string; page?: number; pageSize?: number;
  } = {}): Promise<{ data: AuditoriaEvento[]; total: number }> {
    const pool = await getPool();
    const { page = 1, pageSize = 50 } = filters;
    const offset = (page - 1) * pageSize;

    const req = pool.request();
    let where = 'WHERE 1=1';

    if (filters.usuarioId)  { req.input('uid',  sql.Int,         filters.usuarioId);  where += ' AND USUARIO_ID=@uid'; }
    if (filters.evento)     { req.input('evt',  sql.VarChar(60), filters.evento);     where += ' AND EVENTO=@evt'; }
    if (filters.resultado)  { req.input('res',  sql.VarChar(10), filters.resultado);  where += ' AND RESULTADO=@res'; }
    if (filters.fechaDesde) { req.input('fdesde', sql.DateTime2, new Date(filters.fechaDesde)); where += ' AND FECHA>=@fdesde'; }
    if (filters.fechaHasta) { req.input('fhasta', sql.DateTime2, new Date(filters.fechaHasta + 'T23:59:59')); where += ' AND FECHA<=@fhasta'; }

    req.input('offset', sql.Int, offset).input('ps', sql.Int, pageSize);

    const [dataRes, countRes] = await Promise.all([
      req.query<any>(`SELECT * FROM AUDITORIA_SEGURIDAD ${where} ORDER BY FECHA DESC OFFSET @offset ROWS FETCH NEXT @ps ROWS ONLY`),
      pool.request().query<any>(`SELECT COUNT(*) AS T FROM AUDITORIA_SEGURIDAD ${where.replace(/@\w+/g, (m) => {
        // re-bind params on count query would be complex; use sub-select approach instead
        return m; // params already bound on req, can't reuse on pool.request() — use count subquery below
      })}`),
    ]).catch(() => [{ recordset: [] }, { recordset: [{ T: 0 }] }]);

    // Simple count on same request
    const countReq = pool.request();
    if (filters.usuarioId)  countReq.input('uid',    sql.Int,         filters.usuarioId);
    if (filters.evento)     countReq.input('evt',    sql.VarChar(60), filters.evento);
    if (filters.resultado)  countReq.input('res',    sql.VarChar(10), filters.resultado);
    if (filters.fechaDesde) countReq.input('fdesde', sql.DateTime2,   new Date(filters.fechaDesde));
    if (filters.fechaHasta) countReq.input('fhasta', sql.DateTime2,   new Date(filters.fechaHasta + 'T23:59:59'));
    const cRes = await countReq.query<any>(`SELECT COUNT(*) AS T FROM AUDITORIA_SEGURIDAD ${where}`).catch(() => ({ recordset: [{ T: 0 }] }));

    return { data: dataRes.recordset as AuditoriaEvento[], total: cRes.recordset[0]?.T ?? 0 };
  },

  // ── Policy ───────────────────────────────────────────────────────────────────
  async getPolitica(): Promise<PoliticaSeguridad | null> {
    const pool = await getPool();
    try {
      const r = await pool.request().query<any>(`SELECT * FROM POLITICA_SEGURIDAD WHERE POLITICA_ID=1`);
      return r.recordset[0] ?? null;
    } catch { return null; }
  },

  async updatePolitica(data: Partial<PoliticaSeguridad>, actorId: number, actorNombre: string) {
    const pool = await getPool();
    const allowed: (keyof PoliticaSeguridad)[] = [
      'CLAVE_LONGITUD_MIN','CLAVE_REQUIERE_MAYUS','CLAVE_REQUIERE_MINUS',
      'CLAVE_REQUIERE_NUMERO','CLAVE_REQUIERE_SIMBOLO','CLAVE_EXPIRA_DIAS',
      'CLAVE_HISTORIAL','LOCKOUT_INTENTOS','LOCKOUT_MINUTOS',
      'SESION_DURACION_MINUTOS','REFRESH_DURACION_DIAS','SESION_INACTIVIDAD_MIN',
      'MFA_OBLIGATORIO_ADMIN','MFA_OBLIGATORIO_TODOS',
    ];
    const parts: string[] = [];
    const req = pool.request().input('mod', sql.Int, actorId);
    for (const key of allowed) {
      if (data[key] !== undefined) {
        req.input(key, (data[key] as any));
        parts.push(`${key}=@${key}`);
      }
    }
    if (parts.length > 0) {
      await req.query(`UPDATE POLITICA_SEGURIDAD SET ${parts.join(',')},FECHA_MODIFICACION=SYSUTCDATETIME(),MODIFICADO_POR=@mod WHERE POLITICA_ID=1`);
    }
    await logAudit(pool, { actorId, actorNombre, evento: 'POLITICA_EDITADA', entidadTipo: 'POLITICA' });
  },

  // ── Active sessions ──────────────────────────────────────────────────────────
  async getSesiones(userId?: number): Promise<SesionActiva[]> {
    const pool = await getPool();
    const req = pool.request();
    let where = `WHERE REVOCADA=0 AND FECHA_EXPIRACION > SYSUTCDATETIME()`;
    if (userId) { req.input('uid', sql.Int, userId); where += ` AND USUARIO_ID=@uid`; }
    try {
      const r = await req.query<any>(`
        SELECT SESION_ID,USUARIO_ID,USER_AGENT,IP,DISPOSITIVO,
               FECHA_CREACION,FECHA_EXPIRACION,FECHA_ULTIMO_USO,REVOCADA
        FROM USUARIOS_SESIONES ${where} ORDER BY FECHA_CREACION DESC
      `);
      return r.recordset;
    } catch { return []; }
  },

  async revocarSesion(sesionId: string, actorId: number, actorNombre: string, motivo?: string) {
    const pool = await getPool();
    try {
      await pool.request()
        .input('sid',    sql.UniqueIdentifier, sesionId)
        .input('motivo', sql.NVarChar(120),     motivo ?? 'Revocada por administrador')
        .query(`UPDATE USUARIOS_SESIONES SET REVOCADA=1,REVOCADA_FECHA=SYSUTCDATETIME(),REVOCADA_MOTIVO=@motivo WHERE SESION_ID=@sid`);
    } catch { /* table may not exist */ }
    await logAudit(pool, { actorId, actorNombre, evento: 'SESION_REVOCADA', entidadTipo: 'SESION',
      detalle: JSON.stringify({ sesionId }) });
  },
};
