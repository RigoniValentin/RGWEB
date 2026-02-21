import { getPool, sql } from '../database/connection.js';
import type { Categoria, Marca, UnidadMedida, ListaPrecio, Deposito, PuntoVenta } from '../types/index.js';

export const catalogService = {
  // ── Categorías ───────────────────────────────────
  async getCategorias(soloActivas = true): Promise<Categoria[]> {
    const pool = await getPool();
    const where = soloActivas ? 'WHERE ACTIVA = 1' : '';
    const result = await pool.request().query<Categoria>(`
      SELECT * FROM CATEGORIAS ${where} ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Marcas ───────────────────────────────────────
  async getMarcas(soloActivas = true): Promise<Marca[]> {
    const pool = await getPool();
    const where = soloActivas ? 'WHERE ACTIVA = 1' : '';
    const result = await pool.request().query<Marca>(`
      SELECT * FROM MARCAS ${where} ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Unidades de medida ───────────────────────────
  async getUnidades(): Promise<UnidadMedida[]> {
    const pool = await getPool();
    const result = await pool.request().query<UnidadMedida>(`
      SELECT * FROM UNIDADES_MEDIDA ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Listas de precios ────────────────────────────
  async getListasPrecios(soloActivas = true): Promise<ListaPrecio[]> {
    const pool = await getPool();
    const where = soloActivas ? 'WHERE ACTIVA = 1' : '';
    const result = await pool.request().query<ListaPrecio>(`
      SELECT * FROM LISTA_PRECIOS ${where} ORDER BY LISTA_ID
    `);
    return result.recordset;
  },

  // ── Depósitos ────────────────────────────────────
  async getDepositos(): Promise<Deposito[]> {
    const pool = await getPool();
    const result = await pool.request().query<Deposito>(`
      SELECT * FROM DEPOSITOS ORDER BY NOMBRE
    `);
    return result.recordset;
  },

  // ── Puntos de venta ──────────────────────────────
  async getPuntosVenta(soloActivos = true): Promise<PuntoVenta[]> {
    const pool = await getPool();
    const where = soloActivos ? 'WHERE ACTIVO = 1' : '';
    const result = await pool.request().query<PuntoVenta>(`
      SELECT * FROM PUNTO_VENTAS ${where} ORDER BY NOMBRE
    `);
    return result.recordset;
  },
};
