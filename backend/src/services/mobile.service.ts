import fs from 'fs';
import path from 'path';
import { getPool, sql } from '../database/connection.js';
import { registrarHistorialStock } from './stockHistorial.helper.js';

// ═══════════════════════════════════════════════════
//  Mobile Service — API helpers para app mobile
//  (escaneo de códigos de barras y control de stock)
// ═══════════════════════════════════════════════════

const DEPOSITO_DEFAULT_ID = 1; // DEPOSITO CENTRAL

export interface MobileProductDTO {
  id: number;
  name: string;
  stock: number;
  price: number;
}

export interface PendingProductEntry {
  id: string;
  barcode: string;
  imagePath: string;
  createdAt: string;
  processed: boolean;
}

// ── Storage paths (JSON temporal para pendientes) ──
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
export const PENDING_UPLOADS_DIR = path.join(UPLOADS_DIR, 'pending');
const PENDING_JSON = path.join(PENDING_UPLOADS_DIR, 'pending.json');

function ensurePendingStorage(): void {
  if (!fs.existsSync(PENDING_UPLOADS_DIR)) {
    fs.mkdirSync(PENDING_UPLOADS_DIR, { recursive: true });
  }
  if (!fs.existsSync(PENDING_JSON)) {
    fs.writeFileSync(PENDING_JSON, '[]', 'utf8');
  }
}

function readPending(): PendingProductEntry[] {
  ensurePendingStorage();
  try {
    const raw = fs.readFileSync(PENDING_JSON, 'utf8');
    return JSON.parse(raw) as PendingProductEntry[];
  } catch {
    return [];
  }
}

function writePending(entries: PendingProductEntry[]): void {
  ensurePendingStorage();
  fs.writeFileSync(PENDING_JSON, JSON.stringify(entries, null, 2), 'utf8');
}

export const mobileService = {
  ensureStorage: ensurePendingStorage,

  // ── Buscar producto por código de barras ───────
  async findByBarcode(barcode: string): Promise<MobileProductDTO | null> {
    const pool = await getPool();
    const result = await pool.request()
      .input('barcode', sql.NVarChar, barcode)
      .query(`
        SELECT TOP 1
          p.PRODUCTO_ID AS id,
          p.NOMBRE      AS name,
          ISNULL((SELECT SUM(sd.CANTIDAD) FROM STOCK_DEPOSITOS sd WHERE sd.PRODUCTO_ID = p.PRODUCTO_ID), 0) AS stock,
          ISNULL(p.LISTA_1, 0) AS price
        FROM PRODUCTOS p
        INNER JOIN PRODUCTOS_COD_BARRAS cb ON cb.PRODUCTO_ID = p.PRODUCTO_ID
        WHERE cb.CODIGO_BARRAS = @barcode
      `);

    if (result.recordset.length === 0) return null;
    const row = result.recordset[0];
    return {
      id: row.id,
      name: row.name,
      stock: Number(row.stock) || 0,
      price: Number(row.price) || 0,
    };
  },

  // ── Sumar cantidad al stock de un producto ─────
  //  El valor recibido se SUMA al stock actual del depósito central.
  //  Si la relación no existe aún, se crea.
  async addStockByBarcode(barcode: string, quantity: number, usuarioId?: number) {
    if (!Number.isFinite(quantity)) {
      throw Object.assign(new Error('quantity debe ser un número válido'), { name: 'ValidationError' });
    }

    const pool = await getPool();
    const tx = pool.transaction();
    await tx.begin();

    try {
      // Resolver productoId desde código de barras
      const prodResult = await tx.request()
        .input('barcode', sql.NVarChar, barcode)
        .query(`
          SELECT TOP 1 p.PRODUCTO_ID AS id, p.NOMBRE AS name
          FROM PRODUCTOS p
          INNER JOIN PRODUCTOS_COD_BARRAS cb ON cb.PRODUCTO_ID = p.PRODUCTO_ID
          WHERE cb.CODIGO_BARRAS = @barcode
        `);

      if (prodResult.recordset.length === 0) {
        throw Object.assign(new Error('Producto no encontrado'), { name: 'NotFoundError' });
      }

      const productoId: number = prodResult.recordset[0].id;
      const depositoId = DEPOSITO_DEFAULT_ID;

      // Stock actual en el depósito
      const currentResult = await tx.request()
        .input('prodId', sql.Int, productoId)
        .input('depId', sql.Int, depositoId)
        .query(`SELECT CANTIDAD FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);

      const cantidadAnterior: number = currentResult.recordset.length > 0
        ? Number(currentResult.recordset[0].CANTIDAD)
        : 0;
      const cantidadNueva = cantidadAnterior + quantity;

      if (currentResult.recordset.length > 0) {
        await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 4), cantidadNueva)
          .query(`UPDATE STOCK_DEPOSITOS SET CANTIDAD = @cant WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
      } else {
        const maxId = await tx.request().query(`SELECT ISNULL(MAX(ITEM_ID), 0) + 1 AS nextId FROM STOCK_DEPOSITOS`);
        const nextItemId = maxId.recordset[0].nextId;
        await tx.request()
          .input('itemId', sql.Int, nextItemId)
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .input('cant', sql.Decimal(18, 4), cantidadNueva)
          .query(`INSERT INTO STOCK_DEPOSITOS (ITEM_ID, PRODUCTO_ID, DEPOSITO_ID, CANTIDAD) VALUES (@itemId, @prodId, @depId, @cant)`);

        const relExists = await tx.request()
          .input('prodId', sql.Int, productoId)
          .input('depId', sql.Int, depositoId)
          .query(`SELECT 1 FROM PRODUCTO_DEPOSITOS WHERE PRODUCTO_ID = @prodId AND DEPOSITO_ID = @depId`);
        if (relExists.recordset.length === 0) {
          await tx.request()
            .input('prodId', sql.Int, productoId)
            .input('depId', sql.Int, depositoId)
            .query(`INSERT INTO PRODUCTO_DEPOSITOS (PRODUCTO_ID, DEPOSITO_ID) VALUES (@prodId, @depId)`);
        }
      }

      // Recalcular stock total en PRODUCTOS.CANTIDAD
      await tx.request()
        .input('prodId', sql.Int, productoId)
        .query(`UPDATE PRODUCTOS SET CANTIDAD = (SELECT ISNULL(SUM(CANTIDAD),0) FROM STOCK_DEPOSITOS WHERE PRODUCTO_ID = @prodId) WHERE PRODUCTO_ID = @prodId`);

      // Historial
      await registrarHistorialStock(tx, {
        productoId,
        depositoId,
        cantidadAnterior,
        cantidadNueva,
        tipoOperacion: 'AJUSTE_MANUAL',
        referenciaDetalle: `Mobile: +${quantity} via barcode ${barcode}`,
        usuarioId: usuarioId ?? null,
        observaciones: 'Ingreso desde app mobile (escaneo)',
      });

      await tx.commit();
      return { productoId, stock: cantidadNueva };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  },

  // ── Registrar producto pendiente (no encontrado) ─
  registerPending(barcode: string, imagePath: string): PendingProductEntry {
    const entries = readPending();
    const entry: PendingProductEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      barcode,
      imagePath,
      createdAt: new Date().toISOString(),
      processed: false,
    };
    entries.push(entry);
    writePending(entries);
    return entry;
  },

  listPending(): PendingProductEntry[] {
    return readPending();
  },
};
