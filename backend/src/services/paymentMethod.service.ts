import { getPool, sql } from '../database/connection.js';
import type { MetodoPago, PaginatedResult } from '../types/index.js';
import { EFECTIVO_DEFAULT_IMAGE } from './paymentMethodImages.js';

// ═══════════════════════════════════════════════════
//  Payment Method Service — Full CRUD
// ═══════════════════════════════════════════════════

export interface MetodoPagoFilter {
  page?: number;
  pageSize?: number;
  search?: string;
  categoria?: 'EFECTIVO' | 'DIGITAL';
  activa?: boolean;
  orderBy?: string;
  orderDir?: 'ASC' | 'DESC';
}

export interface MetodoPagoInput {
  NOMBRE: string;
  CATEGORIA: 'EFECTIVO' | 'DIGITAL';
  IMAGEN_BASE64?: string | null;
  ACTIVA?: boolean;
}

const VALID_CATEGORIAS = ['EFECTIVO', 'DIGITAL'] as const;

interface DefaultMethod {
  nombre: string;
  categoria: 'EFECTIVO' | 'DIGITAL';
  imagen?: string;
}

const DEFAULT_METHODS: DefaultMethod[] = [
  { nombre: 'Efectivo', categoria: 'EFECTIVO', imagen: EFECTIVO_DEFAULT_IMAGE },
  { nombre: 'MercadoPago', categoria: 'DIGITAL' },
  { nombre: 'Transferencia', categoria: 'DIGITAL' },
];

// ── Helpers ──────────────────────────────────────

function validateCategoria(cat: string | undefined): 'EFECTIVO' | 'DIGITAL' {
  const upper = (cat || '').trim().toUpperCase();
  if (!VALID_CATEGORIAS.includes(upper as any)) {
    throw Object.assign(new Error('La categoría debe ser EFECTIVO o DIGITAL'), { name: 'ValidationError' });
  }
  return upper as 'EFECTIVO' | 'DIGITAL';
}

function validateImage(img: string | null | undefined): string | null {
  if (!img) return null;
  const trimmed = img.trim();
  if (!trimmed.startsWith('data:image/')) {
    throw Object.assign(new Error('La imagen debe enviarse como data URL (data:image/...)'), { name: 'ValidationError' });
  }
  if (trimmed.length > 2_500_000) {
    throw Object.assign(new Error('La imagen supera el tamaño máximo (~2 MB)'), { name: 'ValidationError' });
  }
  return trimmed;
}

// ── Service ──────────────────────────────────────

export const paymentMethodService = {
  /** Create table + seed defaults on first use */
  async ensureTable(): Promise<void> {
    const pool = await getPool();

    await pool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'METODOS_PAGO')
      BEGIN
        CREATE TABLE METODOS_PAGO (
          METODO_PAGO_ID   INT           NOT NULL PRIMARY KEY,
          NOMBRE           NVARCHAR(120) NOT NULL,
          CATEGORIA        NVARCHAR(20)  NOT NULL,
          IMAGEN_BASE64    NVARCHAR(MAX) NULL,
          ACTIVA           BIT           NOT NULL DEFAULT 1,
          POR_DEFECTO      BIT           NOT NULL DEFAULT 0,
          CONSTRAINT CK_METODOS_PAGO_CATEGORIA CHECK (CATEGORIA IN ('EFECTIVO','DIGITAL'))
        )
      END
    `);

    // Add POR_DEFECTO column to existing tables
    await pool.request().query(`
      IF NOT EXISTS (
        SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'METODOS_PAGO' AND COLUMN_NAME = 'POR_DEFECTO'
      )
      BEGIN
        ALTER TABLE METODOS_PAGO ADD POR_DEFECTO BIT NOT NULL DEFAULT 0
      END
    `);

    // Seed default methods
    // Count how many defaults we need per category
    const defaultsByCategoria = new Map<string, DefaultMethod[]>();
    for (const d of DEFAULT_METHODS) {
      if (!defaultsByCategoria.has(d.categoria)) defaultsByCategoria.set(d.categoria, []);
      defaultsByCategoria.get(d.categoria)!.push(d);
    }

    for (const [categoria, defaults] of defaultsByCategoria) {
      // Check how many POR_DEFECTO already exist for this category
      const existing = await pool.request()
        .input('cat', sql.NVarChar(20), categoria)
        .query(`SELECT COUNT(*) AS cnt FROM METODOS_PAGO WHERE POR_DEFECTO = 1 AND CATEGORIA = @cat`);
      const existingCount = existing.recordset[0].cnt;

      if (existingCount >= defaults.length) {
        // Already have enough defaults for this category (user may have renamed them) — update images only where names still match
        for (const d of defaults) {
          if (d.imagen) {
            await pool.request()
              .input('nombre', sql.NVarChar(120), d.nombre)
              .input('categoria', sql.NVarChar(20), d.categoria)
              .input('imagen', sql.NVarChar(sql.MAX), d.imagen)
              .query(`
                UPDATE METODOS_PAGO SET IMAGEN_BASE64 = @imagen
                WHERE POR_DEFECTO = 1 AND CATEGORIA = @categoria AND UPPER(NOMBRE) = UPPER(@nombre) AND IMAGEN_BASE64 IS NULL
              `);
          }
        }
      } else {
        // Need to create missing defaults — only insert those whose name doesn't already exist
        for (const d of defaults) {
          await pool.request()
            .input('nombre', sql.NVarChar(120), d.nombre)
            .input('categoria', sql.NVarChar(20), d.categoria)
            .input('imagen', sql.NVarChar(sql.MAX), d.imagen || null)
            .query(`
              IF NOT EXISTS (SELECT 1 FROM METODOS_PAGO WHERE UPPER(NOMBRE) = UPPER(@nombre) AND CATEGORIA = @categoria)
              BEGIN
                DECLARE @nid INT = (SELECT ISNULL(MAX(METODO_PAGO_ID), 0) + 1 FROM METODOS_PAGO);
                INSERT INTO METODOS_PAGO (METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64, ACTIVA, POR_DEFECTO)
                VALUES (@nid, @nombre, @categoria, @imagen, 1, 1)
              END
              ELSE
              BEGIN
                UPDATE METODOS_PAGO SET ACTIVA = 1, POR_DEFECTO = 1,
                  IMAGEN_BASE64 = CASE WHEN @imagen IS NOT NULL THEN @imagen ELSE IMAGEN_BASE64 END
                WHERE UPPER(NOMBRE) = UPPER(@nombre) AND CATEGORIA = @categoria
              END
            `);
        }
      }
    }
  },

  // ── List ───────────────────────────────────────
  async getAll(filter: MetodoPagoFilter = {}): Promise<PaginatedResult<MetodoPago>> {
    await this.ensureTable();
    const pool = await getPool();
    const page = filter.page || 1;
    const pageSize = filter.pageSize || 50;
    const offset = (page - 1) * pageSize;

    let where = 'WHERE 1=1';
    const cReq = pool.request();
    const dReq = pool.request();

    if (filter.activa !== undefined) {
      where += ' AND ACTIVA = @activa';
      cReq.input('activa', sql.Bit, filter.activa ? 1 : 0);
      dReq.input('activa', sql.Bit, filter.activa ? 1 : 0);
    }
    if (filter.categoria) {
      where += ' AND CATEGORIA = @categoria';
      cReq.input('categoria', sql.NVarChar(20), filter.categoria);
      dReq.input('categoria', sql.NVarChar(20), filter.categoria);
    }
    if (filter.search) {
      where += ' AND NOMBRE LIKE @search';
      cReq.input('search', sql.NVarChar, `%${filter.search}%`);
      dReq.input('search', sql.NVarChar, `%${filter.search}%`);
    }

    const countRes = await cReq.query(`SELECT COUNT(*) as total FROM METODOS_PAGO ${where}`);
    const total = countRes.recordset[0].total;

    const validCols: Record<string, string> = { NOMBRE: 'NOMBRE', CATEGORIA: 'CATEGORIA' };
    const orderCol = validCols[filter.orderBy || 'NOMBRE'] || 'NOMBRE';
    const orderDir = filter.orderDir === 'DESC' ? 'DESC' : 'ASC';

    dReq.input('offset', sql.Int, offset);
    dReq.input('pageSize', sql.Int, pageSize);

    const dataRes = await dReq.query<MetodoPago>(`
      SELECT METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64, ACTIVA, POR_DEFECTO
      FROM METODOS_PAGO
      ${where}
      ORDER BY ${orderCol} ${orderDir}
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    return { data: dataRes.recordset, total, page, pageSize };
  },

  // ── Get by ID ──────────────────────────────────
  async getById(id: number): Promise<MetodoPago> {
    await this.ensureTable();
    const pool = await getPool();
    const r = await pool.request()
      .input('id', sql.Int, id)
      .query<MetodoPago>('SELECT METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64, ACTIVA, POR_DEFECTO FROM METODOS_PAGO WHERE METODO_PAGO_ID = @id');
    if (r.recordset.length === 0) {
      throw Object.assign(new Error('Método de pago no encontrado'), { name: 'ValidationError' });
    }
    return r.recordset[0];
  },

  // ── Create ─────────────────────────────────────
  async create(input: MetodoPagoInput) {
    await this.ensureTable();
    if (!input.NOMBRE?.trim()) {
      throw Object.assign(new Error('El nombre es obligatorio'), { name: 'ValidationError' });
    }
    const categoria = validateCategoria(input.CATEGORIA);
    const imagen = validateImage(input.IMAGEN_BASE64);

    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();
    try {
      const maxRes = await tx.request().query(
        'SELECT ISNULL(MAX(METODO_PAGO_ID), 0) + 1 AS nextId FROM METODOS_PAGO WITH (TABLOCKX, HOLDLOCK)'
      );
      const nextId = maxRes.recordset[0].nextId;

      await tx.request()
        .input('id', sql.Int, nextId)
        .input('nombre', sql.NVarChar(120), input.NOMBRE.trim())
        .input('categoria', sql.NVarChar(20), categoria)
        .input('imagen', sql.NVarChar(sql.MAX), imagen)
        .input('activa', sql.Bit, input.ACTIVA !== false ? 1 : 0)
        .query(`
          INSERT INTO METODOS_PAGO (METODO_PAGO_ID, NOMBRE, CATEGORIA, IMAGEN_BASE64, ACTIVA)
          VALUES (@id, @nombre, @categoria, @imagen, @activa)
        `);

      await tx.commit();
      return { METODO_PAGO_ID: nextId };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Update ─────────────────────────────────────
  async update(id: number, input: MetodoPagoInput): Promise<void> {
    await this.ensureTable();
    if (!input.NOMBRE?.trim()) {
      throw Object.assign(new Error('El nombre es obligatorio'), { name: 'ValidationError' });
    }
    const categoria = validateCategoria(input.CATEGORIA);
    const imagen = validateImage(input.IMAGEN_BASE64);

    const pool = await getPool();
    await pool.request()
      .input('id', sql.Int, id)
      .input('nombre', sql.NVarChar(120), input.NOMBRE.trim())
      .input('categoria', sql.NVarChar(20), categoria)
      .input('imagen', sql.NVarChar(sql.MAX), imagen)
      .input('activa', sql.Bit, input.ACTIVA !== false ? 1 : 0)
      .query(`
        UPDATE METODOS_PAGO
        SET NOMBRE = @nombre, CATEGORIA = @categoria,
            IMAGEN_BASE64 = @imagen, ACTIVA = @activa
        WHERE METODO_PAGO_ID = @id
      `);
  },

  // ── Delete ─────────────────────────────────────
  async delete(id: number) {
    await this.ensureTable();
    const pool = await getPool();

    // Prevent deletion of default methods
    const check = await pool.request()
      .input('id', sql.Int, id)
      .query('SELECT POR_DEFECTO FROM METODOS_PAGO WHERE METODO_PAGO_ID = @id');
    if (check.recordset.length > 0 && check.recordset[0].POR_DEFECTO) {
      throw Object.assign(
        new Error('No se puede eliminar un método de pago por defecto'),
        { name: 'ValidationError' }
      );
    }

    await pool.request()
      .input('id', sql.Int, id)
      .query('DELETE FROM METODOS_PAGO WHERE METODO_PAGO_ID = @id');
    return { mode: 'hard' as const };
  },
};
