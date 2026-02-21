import { getPool, sql } from '../database/connection.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import type { AccionAcceso } from '../types/index.js';

export interface LoginInput {
  username: string;
  password: string;
}

export const authService = {
  async login(input: LoginInput) {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('nombre', sql.VarChar, input.username)
      .input('clave', sql.VarChar, input.password)
      .query(`
        SELECT USUARIO_ID, NOMBRE
        FROM USUARIOS
        WHERE NOMBRE = @nombre AND CLAVE = @clave
      `);

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Credenciales inválidas'), { name: 'ValidationError' });
    }

    const user = result.recordset[0];

    // Get user permissions
    const permResult = await pool
      .request()
      .input('userId', sql.Int, user.USUARIO_ID)
      .query<AccionAcceso>(`
        SELECT a.LLAVE, a.DESCRIPCION
        FROM PERMISO_ACCIONES pa
        JOIN ACCIONES_ACCESO a ON pa.ACCION_ID = a.ACCION_ID
        WHERE pa.USUARIO_ID = @userId AND pa.ACTIVO = 1
      `);

    const permisos = permResult.recordset.map((p: any) => p.LLAVE);

    // Get user's puntos de venta
    const pvResult = await pool
      .request()
      .input('userId', sql.Int, user.USUARIO_ID)
      .query(`
        SELECT upv.PUNTO_VENTA_ID, pv.NOMBRE, upv.ES_PREFERIDO
        FROM USUARIOS_PUNTOS_VENTA upv
        JOIN PUNTO_VENTAS pv ON upv.PUNTO_VENTA_ID = pv.PUNTO_VENTA_ID
        WHERE upv.USUARIO_ID = @userId AND pv.ACTIVO = 1
      `);

    const token = jwt.sign(
      { id: user.USUARIO_ID, nombre: user.NOMBRE },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn } as jwt.SignOptions
    );

    return {
      user: { USUARIO_ID: user.USUARIO_ID, NOMBRE: user.NOMBRE },
      permisos,
      puntosVenta: pvResult.recordset,
      token,
    };
  },

  async getProfile(userId: number) {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('id', sql.Int, userId)
      .query(`
        SELECT USUARIO_ID, NOMBRE FROM USUARIOS WHERE USUARIO_ID = @id
      `);

    if (result.recordset.length === 0) {
      throw Object.assign(new Error('Usuario no encontrado'), { name: 'ValidationError' });
    }

    return result.recordset[0];
  },

  async getAll() {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT USUARIO_ID, NOMBRE FROM USUARIOS ORDER BY NOMBRE
    `);
    return result.recordset;
  },
};
