import { getPool, sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  Settings Service — System Configuration CRUD
//  Priority: CONFIG_USUARIO > CONFIG_GLOBAL > VALOR_DEFECTO
// ═══════════════════════════════════════════════════

export interface ConfigParametro {
  PARAMETRO_ID: number;
  MODULO: string;
  SUBMODULO: string | null;
  CLAVE: string;
  DESCRIPCION: string;
  TIPO: string;
  OPCIONES: string | null;
  VALOR_DEFECTO: string | null;
  ORDEN: number;
  ACTIVO: boolean;
}

export interface ConfigResuelto extends ConfigParametro {
  VALOR: string | null;           // Resolved value (user > global > default)
  ORIGEN: 'usuario' | 'global' | 'defecto'; // Where the value came from
}

export interface SaveSettingInput {
  PARAMETRO_ID: number;
  VALOR: string;
}

export const settingsService = {
  // ── Get all parameter definitions ────────────────
  async getParametros(): Promise<ConfigParametro[]> {
    const pool = await getPool();
    const result = await pool.request().query<ConfigParametro>(`
      SELECT PARAMETRO_ID, MODULO, SUBMODULO, CLAVE, DESCRIPCION, 
             TIPO, OPCIONES, VALOR_DEFECTO, ORDEN, ACTIVO
      FROM CONFIG_PARAMETROS
      WHERE ACTIVO = 1
      ORDER BY MODULO, SUBMODULO, ORDEN
    `);
    return result.recordset;
  },

  // ── Get resolved settings for a user ─────────────
  //    Returns all params with their effective value
  async getForUser(userId: number): Promise<ConfigResuelto[]> {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('userId', sql.Int, userId)
      .query<ConfigResuelto>(`
        SELECT 
          p.PARAMETRO_ID, p.MODULO, p.SUBMODULO, p.CLAVE, p.DESCRIPCION,
          p.TIPO, p.OPCIONES, p.VALOR_DEFECTO, p.ORDEN, p.ACTIVO,
          COALESCE(cu.VALOR, cg.VALOR, p.VALOR_DEFECTO) AS VALOR,
          CASE
            WHEN cu.VALOR IS NOT NULL THEN 'usuario'
            WHEN cg.VALOR IS NOT NULL THEN 'global'
            ELSE 'defecto'
          END AS ORIGEN
        FROM CONFIG_PARAMETROS p
        LEFT JOIN CONFIG_USUARIO cu 
          ON cu.PARAMETRO_ID = p.PARAMETRO_ID AND cu.USUARIO_ID = @userId
        LEFT JOIN CONFIG_GLOBAL cg
          ON cg.PARAMETRO_ID = p.PARAMETRO_ID
        WHERE p.ACTIVO = 1
        ORDER BY p.MODULO, p.SUBMODULO, p.ORDEN
      `);
    return result.recordset;
  },

  // ── Save user-level settings (batch) ─────────────
  async saveForUser(userId: number, settings: SaveSettingInput[]): Promise<void> {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      for (const s of settings) {
        await tx.request()
          .input('userId', sql.Int, userId)
          .input('paramId', sql.Int, s.PARAMETRO_ID)
          .input('valor', sql.NVarChar(500), s.VALOR)
          .query(`
            MERGE CONFIG_USUARIO AS target
            USING (SELECT @userId AS USUARIO_ID, @paramId AS PARAMETRO_ID) AS source
            ON target.USUARIO_ID = source.USUARIO_ID AND target.PARAMETRO_ID = source.PARAMETRO_ID
            WHEN MATCHED THEN
              UPDATE SET VALOR = @valor, FECHA_MODIFICADO = GETDATE()
            WHEN NOT MATCHED THEN
              INSERT (USUARIO_ID, PARAMETRO_ID, VALOR)
              VALUES (@userId, @paramId, @valor);
          `);
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Save global-level settings (admin) ───────────
  async saveGlobal(settings: SaveSettingInput[]): Promise<void> {
    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      for (const s of settings) {
        await tx.request()
          .input('paramId', sql.Int, s.PARAMETRO_ID)
          .input('valor', sql.NVarChar(500), s.VALOR)
          .query(`
            MERGE CONFIG_GLOBAL AS target
            USING (SELECT @paramId AS PARAMETRO_ID) AS source
            ON target.PARAMETRO_ID = source.PARAMETRO_ID
            WHEN MATCHED THEN
              UPDATE SET VALOR = @valor, FECHA_MODIFICADO = GETDATE()
            WHEN NOT MATCHED THEN
              INSERT (PARAMETRO_ID, VALOR)
              VALUES (@paramId, @valor);
          `);
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Reset a user setting back to default ─────────
  async resetForUser(userId: number, parametroId: number): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('paramId', sql.Int, parametroId)
      .query(`
        DELETE FROM CONFIG_USUARIO
        WHERE USUARIO_ID = @userId AND PARAMETRO_ID = @paramId
      `);
  },

  // ── Reset ALL user settings ──────────────────────
  async resetAllForUser(userId: number): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input('userId', sql.Int, userId)
      .query(`DELETE FROM CONFIG_USUARIO WHERE USUARIO_ID = @userId`);
  },

  // ── Reset user settings for a specific module ────
  async resetModuleForUser(userId: number, modulo: string): Promise<void> {
    const pool = await getPool();
    await pool.request()
      .input('userId', sql.Int, userId)
      .input('modulo', sql.VarChar(50), modulo)
      .query(`
        DELETE cu
        FROM CONFIG_USUARIO cu
        INNER JOIN CONFIG_PARAMETROS p ON p.PARAMETRO_ID = cu.PARAMETRO_ID
        WHERE cu.USUARIO_ID = @userId AND p.MODULO = @modulo
      `);
  },

  // ── Get a single resolved value (for use in NewSaleModal, etc.) ──
  async getValue(userId: number, clave: string): Promise<string | null> {
    const pool = await getPool();
    const result = await pool.request()
      .input('userId', sql.Int, userId)
      .input('clave', sql.VarChar(100), clave)
      .query(`
        SELECT COALESCE(cu.VALOR, cg.VALOR, p.VALOR_DEFECTO) AS VALOR
        FROM CONFIG_PARAMETROS p
        LEFT JOIN CONFIG_USUARIO cu 
          ON cu.PARAMETRO_ID = p.PARAMETRO_ID AND cu.USUARIO_ID = @userId
        LEFT JOIN CONFIG_GLOBAL cg
          ON cg.PARAMETRO_ID = p.PARAMETRO_ID
        WHERE p.CLAVE = @clave AND p.ACTIVO = 1
      `);
    return result.recordset[0]?.VALOR ?? null;
  },

  // ── Logo de empresa ────────────────────────────
  async ensureLogoTable(): Promise<void> {
    const pool = await getPool();
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CONFIG_LOGO_EMPRESA')
      BEGIN
        CREATE TABLE CONFIG_LOGO_EMPRESA (
          ID INT IDENTITY(1,1) PRIMARY KEY,
          LOGO VARBINARY(MAX) NOT NULL,
          CONTENT_TYPE VARCHAR(50) NOT NULL DEFAULT 'image/png',
          FECHA_MODIFICADO DATETIME DEFAULT GETDATE()
        )
      END
    `);
  },

  async getLogo(): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      await this.ensureLogoTable();
      const pool = await getPool();
      const result = await pool.request().query(`
        SELECT TOP 1 LOGO, CONTENT_TYPE FROM CONFIG_LOGO_EMPRESA ORDER BY ID DESC
      `);
      const row = result.recordset[0];
      if (!row || !row.LOGO) return null;
      return { data: row.LOGO, contentType: row.CONTENT_TYPE || 'image/png' };
    } catch {
      return null;
    }
  },

  async saveLogo(buffer: Buffer, contentType: string): Promise<void> {
    await this.ensureLogoTable();
    const pool = await getPool();
    // Replace any existing logo (keep only one)
    const tx = pool.transaction();
    await tx.begin();
    try {
      await tx.request().query(`DELETE FROM CONFIG_LOGO_EMPRESA`);
      await tx.request()
        .input('logo', sql.VarBinary(sql.MAX), buffer)
        .input('contentType', sql.VarChar(50), contentType)
        .query(`INSERT INTO CONFIG_LOGO_EMPRESA (LOGO, CONTENT_TYPE) VALUES (@logo, @contentType)`);
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  async deleteLogo(): Promise<void> {
    try {
      await this.ensureLogoTable();
      const pool = await getPool();
      await pool.request().query(`DELETE FROM CONFIG_LOGO_EMPRESA`);
    } catch { /* table may not exist yet, ignore */ }
  },
};
