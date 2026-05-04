import { getPool, sql } from '../database/connection.js';

// ═══════════════════════════════════════════════════
//  Banco Service — ABM de entidades financieras
// ═══════════════════════════════════════════════════

export interface Banco {
  BANCO_ID: number;
  NOMBRE: string;
  CUIT: string | null;
  CODIGO_BCRA: string | null;
  ACTIVO: boolean;
}

export interface BancoInput {
  NOMBRE: string;
  CUIT?: string | null;
  CODIGO_BCRA?: string | null;
  ACTIVO?: boolean;
}

const SEED_BANCOS: Array<{ NOMBRE: string; CUIT: string; CODIGO_BCRA: string }> = [
  { NOMBRE: 'Banco de la Nación Argentina',          CUIT: '30-50001091-2', CODIGO_BCRA: '011' },
  { NOMBRE: 'Banco de Galicia y Buenos Aires',       CUIT: '30-50000173-5', CODIGO_BCRA: '007' },
  { NOMBRE: 'Banco Santander Argentina',             CUIT: '30-50000845-4', CODIGO_BCRA: '072' },
  { NOMBRE: 'Banco BBVA Argentina',                  CUIT: '30-50000319-3', CODIGO_BCRA: '017' },
  { NOMBRE: 'Banco Macro',                           CUIT: '30-50001008-4', CODIGO_BCRA: '285' },
  { NOMBRE: 'Banco de la Provincia de Buenos Aires', CUIT: '33-99924210-9', CODIGO_BCRA: '014' },
  { NOMBRE: 'Banco Credicoop Cooperativo',           CUIT: '30-57142135-2', CODIGO_BCRA: '191' },
  { NOMBRE: 'HSBC Bank Argentina',                   CUIT: '33-53718600-9', CODIGO_BCRA: '150' },
  { NOMBRE: 'Banco Patagonia',                       CUIT: '30-50000661-3', CODIGO_BCRA: '034' },
  { NOMBRE: 'Banco de la Ciudad de Buenos Aires',    CUIT: '30-99903208-3', CODIGO_BCRA: '029' },
  { NOMBRE: 'Banco de la Provincia de Córdoba',      CUIT: '30-99922856-5', CODIGO_BCRA: '020' },
  { NOMBRE: 'ICBC (Industrial & Commercial Bank)',   CUIT: '30-70944784-6', CODIGO_BCRA: '015' },
  { NOMBRE: 'Brubank (Banco Digital)',               CUIT: '30-71589971-6', CODIGO_BCRA: '049' },
];

let tableEnsured = false;

async function ensureTable(pool: sql.ConnectionPool): Promise<void> {
  if (tableEnsured) return;
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[BANCOS]') AND type = N'U')
    BEGIN
      CREATE TABLE BANCOS (
        BANCO_ID       INT IDENTITY(1,1) PRIMARY KEY,
        NOMBRE         NVARCHAR(160) NOT NULL,
        CUIT           VARCHAR(13)   NULL,
        CODIGO_BCRA    CHAR(3)       NULL,
        ACTIVO         BIT           NOT NULL DEFAULT 1,
        FECHA_CREACION DATETIME      NOT NULL DEFAULT GETDATE(),
        CONSTRAINT UQ_BANCOS_NOMBRE UNIQUE (NOMBRE)
      );
      CREATE INDEX IX_BANCOS_CODIGO_BCRA ON BANCOS(CODIGO_BCRA);
      CREATE INDEX IX_BANCOS_ACTIVO      ON BANCOS(ACTIVO);
    END
  `);

  // Seed solo si la tabla está vacía
  const c = await pool.request().query<{ n: number }>('SELECT COUNT(*) AS n FROM BANCOS');
  if ((c.recordset[0]?.n || 0) === 0) {
    for (const b of SEED_BANCOS) {
      await pool.request()
        .input('n', sql.NVarChar, b.NOMBRE)
        .input('c', sql.VarChar, b.CUIT)
        .input('cb', sql.Char, b.CODIGO_BCRA)
        .query('INSERT INTO BANCOS (NOMBRE, CUIT, CODIGO_BCRA, ACTIVO) VALUES (@n, @c, @cb, 1)');
    }
  }

  tableEnsured = true;
}

function validate(input: BancoInput, partial = false): void {
  if (!partial || input.NOMBRE !== undefined) {
    if (!input.NOMBRE || !input.NOMBRE.trim()) {
      throw Object.assign(new Error('NOMBRE es requerido'), { name: 'ValidationError' });
    }
    if (input.NOMBRE.length > 160) {
      throw Object.assign(new Error('NOMBRE excede 160 caracteres'), { name: 'ValidationError' });
    }
  }
  if (input.CUIT) {
    const digits = input.CUIT.replace(/\D/g, '');
    if (digits.length !== 11) {
      throw Object.assign(new Error('CUIT debe tener 11 dígitos'), { name: 'ValidationError' });
    }
  }
  if (input.CODIGO_BCRA) {
    if (!/^\d{3}$/.test(input.CODIGO_BCRA)) {
      throw Object.assign(new Error('CODIGO_BCRA debe ser 3 dígitos'), { name: 'ValidationError' });
    }
  }
}

export const bancoService = {
  async getAll(opts: { search?: string; activo?: boolean } = {}): Promise<Banco[]> {
    const pool = await getPool();
    await ensureTable(pool);

    let where = 'WHERE 1=1';
    const req = pool.request();
    if (opts.activo !== undefined) {
      where += ' AND ACTIVO = @activo';
      req.input('activo', sql.Bit, opts.activo ? 1 : 0);
    }
    if (opts.search) {
      where += ' AND (NOMBRE LIKE @s OR CUIT LIKE @s OR CODIGO_BCRA LIKE @s)';
      req.input('s', sql.NVarChar, `%${opts.search}%`);
    }

    const r = await req.query<Banco>(`
      SELECT BANCO_ID, NOMBRE, CUIT, CODIGO_BCRA, ACTIVO
      FROM BANCOS ${where}
      ORDER BY NOMBRE ASC
    `);
    return r.recordset.map(b => ({ ...b, ACTIVO: !!b.ACTIVO }));
  },

  async getById(id: number): Promise<Banco> {
    const pool = await getPool();
    await ensureTable(pool);
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query<Banco>('SELECT BANCO_ID, NOMBRE, CUIT, CODIGO_BCRA, ACTIVO FROM BANCOS WHERE BANCO_ID = @id');
    if (r.recordset.length === 0) {
      throw Object.assign(new Error('Banco no encontrado'), { name: 'ValidationError' });
    }
    const row = r.recordset[0];
    return { ...row, ACTIVO: !!row.ACTIVO };
  },

  async create(input: BancoInput): Promise<{ BANCO_ID: number }> {
    validate(input);
    const pool = await getPool();
    await ensureTable(pool);

    // Duplicado por nombre
    const dup = await pool.request()
      .input('n', sql.NVarChar, input.NOMBRE.trim())
      .query<{ BANCO_ID: number }>('SELECT BANCO_ID FROM BANCOS WHERE LOWER(NOMBRE) = LOWER(@n)');
    if (dup.recordset.length > 0) {
      throw Object.assign(new Error('Ya existe un banco con ese nombre'), { name: 'ValidationError' });
    }

    const r = await pool.request()
      .input('n', sql.NVarChar, input.NOMBRE.trim())
      .input('c', sql.VarChar, input.CUIT || null)
      .input('cb', sql.Char, input.CODIGO_BCRA || null)
      .input('a', sql.Bit, input.ACTIVO === false ? 0 : 1)
      .query<{ BANCO_ID: number }>(`
        INSERT INTO BANCOS (NOMBRE, CUIT, CODIGO_BCRA, ACTIVO)
        OUTPUT INSERTED.BANCO_ID
        VALUES (@n, @c, @cb, @a)
      `);
    return { BANCO_ID: r.recordset[0].BANCO_ID };
  },

  async update(id: number, input: Partial<BancoInput>): Promise<void> {
    validate(input as BancoInput, true);
    const pool = await getPool();
    await ensureTable(pool);

    const sets: string[] = [];
    const req = pool.request().input('id', sql.Int, id);
    if (input.NOMBRE !== undefined) { sets.push('NOMBRE = @n'); req.input('n', sql.NVarChar, input.NOMBRE.trim()); }
    if (input.CUIT !== undefined) { sets.push('CUIT = @c'); req.input('c', sql.VarChar, input.CUIT); }
    if (input.CODIGO_BCRA !== undefined) { sets.push('CODIGO_BCRA = @cb'); req.input('cb', sql.Char, input.CODIGO_BCRA); }
    if (input.ACTIVO !== undefined) { sets.push('ACTIVO = @a'); req.input('a', sql.Bit, input.ACTIVO ? 1 : 0); }
    if (sets.length === 0) return;

    await req.query(`UPDATE BANCOS SET ${sets.join(', ')} WHERE BANCO_ID = @id`);
  },

  /** Soft-delete: marca el banco como inactivo. */
  async delete(id: number): Promise<void> {
    const pool = await getPool();
    await ensureTable(pool);
    await pool.request()
      .input('id', sql.Int, id)
      .query('UPDATE BANCOS SET ACTIVO = 0 WHERE BANCO_ID = @id');
  },
};
