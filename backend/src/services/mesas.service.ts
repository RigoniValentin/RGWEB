import { getPool, sql } from '../database/connection.js';
import type { Sector, Mesa, Pedido, PedidoItem, PedidoDetalle, PaginatedResult } from '../types/index.js';

/* ═══════════════════════════════════════════════════
   Mesas (Gastronomía) Service
   ═══════════════════════════════════════════════════ */

// ── Sectores ─────────────────────────────────────

async function getSectores(puntoVentaId?: number): Promise<Sector[]> {
  const pool = await getPool();
  let query = `SELECT SECTOR_ID, NOMBRE, ACTIVO, PUNTO_VENTA_ID
               FROM SECTORES WHERE ACTIVO = 1`;
  const request = pool.request();
  if (puntoVentaId) {
    query += ` AND PUNTO_VENTA_ID = @pvId`;
    request.input('pvId', sql.Int, puntoVentaId);
  }
  query += ` ORDER BY NOMBRE`;
  const result = await request.query(query);
  return result.recordset;
}

async function createSector(data: { NOMBRE: string; PUNTO_VENTA_ID: number }): Promise<Sector> {
  const pool = await getPool();
  const result = await pool.request()
    .input('nombre', sql.NVarChar(100), data.NOMBRE)
    .input('pvId', sql.Int, data.PUNTO_VENTA_ID)
    .query(`INSERT INTO SECTORES (NOMBRE, ACTIVO, PUNTO_VENTA_ID)
            OUTPUT INSERTED.*
            VALUES (@nombre, 1, @pvId)`);
  return result.recordset[0];
}

async function updateSector(sectorId: number, data: { NOMBRE?: string }): Promise<void> {
  const pool = await getPool();
  const req = pool.request().input('id', sql.Int, sectorId);
  const sets: string[] = [];
  if (data.NOMBRE !== undefined) { sets.push('NOMBRE = @nombre'); req.input('nombre', sql.NVarChar(100), data.NOMBRE); }
  if (sets.length === 0) return;
  await req.query(`UPDATE SECTORES SET ${sets.join(', ')} WHERE SECTOR_ID = @id`);
}

async function deleteSector(sectorId: number): Promise<void> {
  const pool = await getPool();
  // Check if sector has active tables
  const check = await pool.request()
    .input('id', sql.Int, sectorId)
    .query(`SELECT COUNT(*) as cnt FROM MESAS WHERE SECTOR_ID = @id AND ACTIVO = 1`);
  if (check.recordset[0].cnt > 0) {
    const err: any = new Error('No se puede eliminar un sector que tiene mesas activas');
    err.name = 'ValidationError'; err.status = 400; throw err;
  }
  await pool.request()
    .input('id', sql.Int, sectorId)
    .query(`UPDATE SECTORES SET ACTIVO = 0 WHERE SECTOR_ID = @id`);
}

// ── Mesas ────────────────────────────────────────

async function getMesas(sectorId: number, puntoVentaId?: number): Promise<Mesa[]> {
  const pool = await getPool();
  const req = pool.request().input('sectorId', sql.Int, sectorId);
  let query = `
    SELECT m.MESA_ID, m.NUMERO_MESA, m.SECTOR_ID, m.CAPACIDAD, m.ESTADO,
           m.ACTIVO, m.POSICION_X, m.POSICION_Y, m.PUNTO_VENTA_ID,
           s.NOMBRE AS SECTOR_NOMBRE,
           (SELECT COUNT(*) FROM PEDIDOS p WHERE p.MESA_ID = m.MESA_ID AND p.ESTADO IN ('ABIERTO','EN_PREPARACION')) AS PEDIDOS_ACTIVOS
    FROM MESAS m
    INNER JOIN SECTORES s ON m.SECTOR_ID = s.SECTOR_ID
    WHERE m.SECTOR_ID = @sectorId AND m.ACTIVO = 1`;
  if (puntoVentaId) {
    query += ` AND m.PUNTO_VENTA_ID = @pvId`;
    req.input('pvId', sql.Int, puntoVentaId);
  }
  query += ` ORDER BY m.NUMERO_MESA`;
  const result = await req.query(query);
  return result.recordset;
}

async function createMesa(data: { NUMERO_MESA: string; SECTOR_ID: number; CAPACIDAD: number; PUNTO_VENTA_ID: number }): Promise<Mesa> {
  const pool = await getPool();
  const result = await pool.request()
    .input('numero', sql.NVarChar(20), data.NUMERO_MESA)
    .input('sectorId', sql.Int, data.SECTOR_ID)
    .input('capacidad', sql.Int, data.CAPACIDAD)
    .input('pvId', sql.Int, data.PUNTO_VENTA_ID)
    .query(`INSERT INTO MESAS (NUMERO_MESA, SECTOR_ID, CAPACIDAD, ESTADO, ACTIVO, POSICION_X, POSICION_Y, PUNTO_VENTA_ID)
            OUTPUT INSERTED.*
            VALUES (@numero, @sectorId, @capacidad, 'LIBRE', 1, 0, 0, @pvId)`);
  return result.recordset[0];
}

async function updateMesa(mesaId: number, data: Partial<Pick<Mesa, 'NUMERO_MESA' | 'CAPACIDAD' | 'SECTOR_ID' | 'POSICION_X' | 'POSICION_Y'>>): Promise<void> {
  const pool = await getPool();
  const req = pool.request().input('id', sql.Int, mesaId);
  const sets: string[] = [];
  if (data.NUMERO_MESA !== undefined) { sets.push('NUMERO_MESA = @numero'); req.input('numero', sql.NVarChar(20), data.NUMERO_MESA); }
  if (data.CAPACIDAD !== undefined) { sets.push('CAPACIDAD = @capacidad'); req.input('capacidad', sql.Int, data.CAPACIDAD); }
  if (data.SECTOR_ID !== undefined) { sets.push('SECTOR_ID = @sectorId'); req.input('sectorId', sql.Int, data.SECTOR_ID); }
  if (data.POSICION_X !== undefined) { sets.push('POSICION_X = @posX'); req.input('posX', sql.Int, data.POSICION_X); }
  if (data.POSICION_Y !== undefined) { sets.push('POSICION_Y = @posY'); req.input('posY', sql.Int, data.POSICION_Y); }
  if (sets.length === 0) return;
  await req.query(`UPDATE MESAS SET ${sets.join(', ')} WHERE MESA_ID = @id`);
}

async function deleteMesa(mesaId: number): Promise<void> {
  const pool = await getPool();
  // Check for active orders
  const check = await pool.request()
    .input('id', sql.Int, mesaId)
    .query(`SELECT COUNT(*) as cnt FROM PEDIDOS WHERE MESA_ID = @id AND ESTADO IN ('ABIERTO','EN_PREPARACION')`);
  if (check.recordset[0].cnt > 0) {
    const err: any = new Error('No se puede eliminar una mesa con pedidos activos');
    err.name = 'ValidationError'; err.status = 400; throw err;
  }
  await pool.request()
    .input('id', sql.Int, mesaId)
    .query(`UPDATE MESAS SET ACTIVO = 0 WHERE MESA_ID = @id`);
}

async function cambiarEstadoMesa(mesaId: number, estado: 'LIBRE' | 'OCUPADA' | 'RESERVADA'): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, mesaId)
    .input('estado', sql.NVarChar(20), estado)
    .query(`UPDATE MESAS SET ESTADO = @estado WHERE MESA_ID = @id`);
}

// ── Pedidos ──────────────────────────────────────

async function getPedidosMesa(mesaId: number): Promise<Pedido[]> {
  const pool = await getPool();
  const result = await pool.request()
    .input('mesaId', sql.Int, mesaId)
    .query(`
      SELECT p.PEDIDO_ID, p.MESA_ID, p.ESTADO, p.FECHA_CREACION,
             p.FECHA_CIERRE, p.TOTAL, p.PUNTO_VENTA_ID, p.MOZO,
             m.NUMERO_MESA AS MESA_NUMERO
      FROM PEDIDOS p
      LEFT JOIN MESAS m ON p.MESA_ID = m.MESA_ID
      WHERE p.MESA_ID = @mesaId
      ORDER BY p.FECHA_CREACION DESC
    `);
  return result.recordset;
}

async function getPedidoById(pedidoId: number): Promise<PedidoDetalle | null> {
  const pool = await getPool();
  const pResult = await pool.request()
    .input('pedidoId', sql.Int, pedidoId)
    .query(`
      SELECT p.PEDIDO_ID, p.MESA_ID, p.ESTADO, p.FECHA_CREACION,
             p.FECHA_CIERRE, p.TOTAL, p.PUNTO_VENTA_ID, p.MOZO,
             m.NUMERO_MESA AS MESA_NUMERO
      FROM PEDIDOS p
      LEFT JOIN MESAS m ON p.MESA_ID = m.MESA_ID
      WHERE p.PEDIDO_ID = @pedidoId
    `);
  if (pResult.recordset.length === 0) return null;
  const pedido = pResult.recordset[0];

  const iResult = await pool.request()
    .input('pedidoId', sql.Int, pedidoId)
    .query(`
      SELECT pi.PEDIDO_ITEM_ID, pi.PEDIDO_ID, pi.PRODUCTO_ID, pi.PROMOCION_ID,
             pi.CANTIDAD, pi.PRECIO_UNITARIO, pi.PUNTO_VENTA_ID,
             pi.TIPO_SERVICIO_ID, pi.LISTA_PRECIO_SELECCIONADA,
             CASE
               WHEN pi.PRODUCTO_ID IS NOT NULL THEN pr.NOMBRE
               WHEN pi.PROMOCION_ID IS NOT NULL THEN promo.DESCRIPCION
               ELSE 'Item desconocido'
             END AS PRODUCTO_NOMBRE,
             pr.CODIGOPARTICULAR AS PRODUCTO_CODIGO
      FROM PEDIDO_ITEMS pi
      LEFT JOIN PRODUCTOS pr ON pi.PRODUCTO_ID = pr.PRODUCTO_ID
      LEFT JOIN PROMOCIONES promo ON pi.PROMOCION_ID = promo.PROMOCION_ID
      WHERE pi.PEDIDO_ID = @pedidoId
      ORDER BY pi.PEDIDO_ITEM_ID
    `);

  return { ...pedido, items: iResult.recordset };
}

async function crearPedido(data: { MESA_ID: number; PUNTO_VENTA_ID: number; MOZO: string }): Promise<Pedido> {
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const result = await tx.request()
      .input('mesaId', sql.Int, data.MESA_ID)
      .input('pvId', sql.Int, data.PUNTO_VENTA_ID)
      .input('mozo', sql.NVarChar(100), data.MOZO)
      .query(`INSERT INTO PEDIDOS (MESA_ID, ESTADO, FECHA_CREACION, TOTAL, PUNTO_VENTA_ID, MOZO)
              OUTPUT INSERTED.*
              VALUES (@mesaId, 'ABIERTO', GETDATE(), 0, @pvId, @mozo)`);
    // Set mesa as occupied
    await tx.request()
      .input('mesaId', sql.Int, data.MESA_ID)
      .query(`UPDATE MESAS SET ESTADO = 'OCUPADA' WHERE MESA_ID = @mesaId`);
    await tx.commit();
    return result.recordset[0];
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function agregarItemPedido(pedidoId: number, data: {
  PRODUCTO_ID?: number;
  PROMOCION_ID?: number;
  CANTIDAD: number;
  PRECIO_UNITARIO: number;
  PUNTO_VENTA_ID?: number;
  LISTA_PRECIO_SELECCIONADA?: number;
}): Promise<PedidoItem> {
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    // Check if item already exists for this product/promo in this order
    const existCheck = data.PRODUCTO_ID
      ? await tx.request()
          .input('pedidoId', sql.Int, pedidoId)
          .input('prodId', sql.Int, data.PRODUCTO_ID)
          .query(`SELECT PEDIDO_ITEM_ID, CANTIDAD FROM PEDIDO_ITEMS 
                  WHERE PEDIDO_ID = @pedidoId AND PRODUCTO_ID = @prodId`)
      : data.PROMOCION_ID
      ? await tx.request()
          .input('pedidoId', sql.Int, pedidoId)
          .input('promoId', sql.Int, data.PROMOCION_ID)
          .query(`SELECT PEDIDO_ITEM_ID, CANTIDAD FROM PEDIDO_ITEMS 
                  WHERE PEDIDO_ID = @pedidoId AND PROMOCION_ID = @promoId`)
      : { recordset: [] };

    let item: PedidoItem;
    if (existCheck.recordset.length > 0) {
      // Update existing quantity
      const existing = existCheck.recordset[0];
      const newQty = existing.CANTIDAD + data.CANTIDAD;
      const result = await tx.request()
        .input('itemId', sql.Int, existing.PEDIDO_ITEM_ID)
        .input('qty', sql.Decimal(18, 3), newQty)
        .query(`UPDATE PEDIDO_ITEMS SET CANTIDAD = @qty WHERE PEDIDO_ITEM_ID = @itemId;
                SELECT * FROM PEDIDO_ITEMS WHERE PEDIDO_ITEM_ID = @itemId`);
      item = result.recordset[0];
    } else {
      // Insert new item
      const result = await tx.request()
        .input('pedidoId', sql.Int, pedidoId)
        .input('prodId', sql.Int, data.PRODUCTO_ID ?? null)
        .input('promoId', sql.Int, data.PROMOCION_ID ?? null)
        .input('qty', sql.Decimal(18, 3), data.CANTIDAD)
        .input('precio', sql.Decimal(18, 2), data.PRECIO_UNITARIO)
        .input('pvId', sql.Int, data.PUNTO_VENTA_ID ?? null)
        .input('lista', sql.Int, data.LISTA_PRECIO_SELECCIONADA ?? 1)
        .query(`INSERT INTO PEDIDO_ITEMS (PEDIDO_ID, PRODUCTO_ID, PROMOCION_ID, CANTIDAD, PRECIO_UNITARIO, PUNTO_VENTA_ID, LISTA_PRECIO_SELECCIONADA)
                OUTPUT INSERTED.*
                VALUES (@pedidoId, @prodId, @promoId, @qty, @precio, @pvId, @lista)`);
      item = result.recordset[0];
    }

    // Update pedido total
    await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`UPDATE PEDIDOS SET TOTAL = (SELECT ISNULL(SUM(CANTIDAD * PRECIO_UNITARIO), 0) FROM PEDIDO_ITEMS WHERE PEDIDO_ID = @pedidoId) WHERE PEDIDO_ID = @pedidoId`);
    await tx.commit();
    return item;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function actualizarCantidadItem(itemId: number, cantidad: number): Promise<void> {
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const itemResult = await tx.request()
      .input('itemId', sql.Int, itemId)
      .query(`SELECT PEDIDO_ID FROM PEDIDO_ITEMS WHERE PEDIDO_ITEM_ID = @itemId`);
    if (itemResult.recordset.length === 0) { await tx.rollback(); return; }
    const pedidoId = itemResult.recordset[0].PEDIDO_ID;

    await tx.request()
      .input('itemId', sql.Int, itemId)
      .input('qty', sql.Decimal(18, 3), cantidad)
      .query(`UPDATE PEDIDO_ITEMS SET CANTIDAD = @qty WHERE PEDIDO_ITEM_ID = @itemId`);

    await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`UPDATE PEDIDOS SET TOTAL = (SELECT ISNULL(SUM(CANTIDAD * PRECIO_UNITARIO), 0) FROM PEDIDO_ITEMS WHERE PEDIDO_ID = @pedidoId) WHERE PEDIDO_ID = @pedidoId`);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function eliminarItemPedido(itemId: number): Promise<void> {
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const itemResult = await tx.request()
      .input('itemId', sql.Int, itemId)
      .query(`SELECT PEDIDO_ID FROM PEDIDO_ITEMS WHERE PEDIDO_ITEM_ID = @itemId`);
    if (itemResult.recordset.length === 0) { await tx.rollback(); return; }
    const pedidoId = itemResult.recordset[0].PEDIDO_ID;

    await tx.request()
      .input('itemId', sql.Int, itemId)
      .query(`DELETE FROM PEDIDO_ITEMS WHERE PEDIDO_ITEM_ID = @itemId`);

    await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`UPDATE PEDIDOS SET TOTAL = (SELECT ISNULL(SUM(CANTIDAD * PRECIO_UNITARIO), 0) FROM PEDIDO_ITEMS WHERE PEDIDO_ID = @pedidoId) WHERE PEDIDO_ID = @pedidoId`);
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function cerrarPedido(pedidoId: number): Promise<void> {
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`UPDATE PEDIDOS SET ESTADO = 'CERRADO', FECHA_CIERRE = GETDATE() WHERE PEDIDO_ID = @pedidoId`);

    // Check if mesa has any remaining active orders; if not, set to LIBRE
    const mesaResult = await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`SELECT MESA_ID FROM PEDIDOS WHERE PEDIDO_ID = @pedidoId`);
    if (mesaResult.recordset.length > 0 && mesaResult.recordset[0].MESA_ID) {
      const mesaId = mesaResult.recordset[0].MESA_ID;
      const activeOrders = await tx.request()
        .input('mesaId', sql.Int, mesaId)
        .input('pedidoId', sql.Int, pedidoId)
        .query(`SELECT COUNT(*) as cnt FROM PEDIDOS WHERE MESA_ID = @mesaId AND ESTADO IN ('ABIERTO','EN_PREPARACION') AND PEDIDO_ID <> @pedidoId`);
      if (activeOrders.recordset[0].cnt === 0) {
        await tx.request()
          .input('mesaId', sql.Int, mesaId)
          .query(`UPDATE MESAS SET ESTADO = 'LIBRE' WHERE MESA_ID = @mesaId`);
      }
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

async function reabrirPedido(pedidoId: number): Promise<void> {
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`UPDATE PEDIDOS SET ESTADO = 'ABIERTO', FECHA_CIERRE = NULL WHERE PEDIDO_ID = @pedidoId`);

    const mesaResult = await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`SELECT MESA_ID FROM PEDIDOS WHERE PEDIDO_ID = @pedidoId`);
    if (mesaResult.recordset.length > 0 && mesaResult.recordset[0].MESA_ID) {
      await tx.request()
        .input('mesaId', sql.Int, mesaResult.recordset[0].MESA_ID)
        .query(`UPDATE MESAS SET ESTADO = 'OCUPADA' WHERE MESA_ID = @mesaId`);
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

// ── Pasar pedido cerrado a venta ─────────────────
async function pasarPedidoAVenta(pedidoId: number, data: {
  CLIENTE_ID: number;
  PUNTO_VENTA_ID: number;
  USUARIO_ID: number;
  MONTO_EFECTIVO: number;
  MONTO_DIGITAL: number;
  VUELTO: number;
  TIPO_COMPROBANTE?: string;
}): Promise<number> {
  const pool = await getPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    // Get pedido with items
    const pedidoResult = await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`SELECT * FROM PEDIDOS WHERE PEDIDO_ID = @pedidoId`);
    if (pedidoResult.recordset.length === 0) {
      await tx.rollback();
      const err: any = new Error('Pedido no encontrado');
      err.name = 'ValidationError'; err.status = 404; throw err;
    }
    const pedido = pedidoResult.recordset[0];

    // Close the pedido first if it's still open (allows closing + sale in one step)
    if (pedido.ESTADO !== 'CERRADO') {
      await tx.request()
        .input('pedidoId2', sql.Int, pedidoId)
        .query(`UPDATE PEDIDOS SET ESTADO = 'CERRADO', FECHA_CIERRE = GETDATE() WHERE PEDIDO_ID = @pedidoId2`);
    }

    const itemsResult = await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`SELECT * FROM PEDIDO_ITEMS WHERE PEDIDO_ID = @pedidoId`);

    if (itemsResult.recordset.length === 0) {
      await tx.rollback();
      const err: any = new Error('El pedido no tiene items');
      err.name = 'ValidationError'; err.status = 400; throw err;
    }

    // Create VENTA
    const ventaResult = await tx.request()
      .input('clienteId', sql.Int, data.CLIENTE_ID)
      .input('total', sql.Decimal(18, 2), pedido.TOTAL)
      .input('pvId', sql.Int, data.PUNTO_VENTA_ID)
      .input('userId', sql.Int, data.USUARIO_ID)
      .input('efectivo', sql.Decimal(18, 2), data.MONTO_EFECTIVO)
      .input('digital', sql.Decimal(18, 2), data.MONTO_DIGITAL)
      .input('vuelto', sql.Decimal(18, 2), data.VUELTO)
      .input('tipoComp', sql.NVarChar(50), data.TIPO_COMPROBANTE ?? 'TICKET')
      .query(`INSERT INTO VENTAS (CLIENTE_ID, FECHA_VENTA, TOTAL, ES_CTA_CORRIENTE, MONTO_EFECTIVO, MONTO_DIGITAL, VUELTO, COBRADA, PUNTO_VENTA_ID, USUARIO_ID, TIPO_COMPROBANTE)
              OUTPUT INSERTED.VENTA_ID
              VALUES (@clienteId, GETDATE(), @total, 0, @efectivo, @digital, @vuelto, 1, @pvId, @userId, @tipoComp)`);
    const ventaId = ventaResult.recordset[0].VENTA_ID;

    // Insert VENTAS_ITEMS from PEDIDO_ITEMS
    for (const item of itemsResult.recordset) {
      await tx.request()
        .input('ventaId', sql.Int, ventaId)
        .input('prodId', sql.Int, item.PRODUCTO_ID)
        .input('precio', sql.Decimal(18, 2), item.PRECIO_UNITARIO)
        .input('qty', sql.Decimal(18, 3), item.CANTIDAD)
        .input('descuento', sql.Decimal(18, 2), 0)
        .input('promoId', sql.Int, item.PROMOCION_ID)
        .input('depositoId', sql.Int, null)
        .input('listaId', sql.Int, item.LISTA_PRECIO_SELECCIONADA)
        .query(`INSERT INTO VENTAS_ITEMS (VENTA_ID, PRODUCTO_ID, PRECIO_UNITARIO, CANTIDAD, PRECIO_UNITARIO_DTO, DESCUENTO, PROMOCION_ID, DEPOSITO_ID, LISTA_ID)
                VALUES (@ventaId, @prodId, @precio, @qty, @precio, @descuento, @promoId, @depositoId, @listaId)`);
    }

    // Link pedido to venta in junction table
    await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .input('ventaId', sql.Int, ventaId)
      .query(`INSERT INTO PEDIDOS_VENTAS (PEDIDO_ID, VENTA_ID) VALUES (@pedidoId, @ventaId)`);

    // Ensure pedido is marked as CERRADO
    await tx.request()
      .input('pedidoId', sql.Int, pedidoId)
      .query(`UPDATE PEDIDOS SET ESTADO = 'CERRADO', FECHA_CIERRE = GETDATE() WHERE PEDIDO_ID = @pedidoId AND ESTADO <> 'CERRADO'`);

    // Set mesa to LIBRE
    if (pedido.MESA_ID) {
      const activeOrders = await tx.request()
        .input('mesaId', sql.Int, pedido.MESA_ID)
        .input('pedidoId2', sql.Int, pedidoId)
        .query(`SELECT COUNT(*) as cnt FROM PEDIDOS WHERE MESA_ID = @mesaId AND ESTADO IN ('ABIERTO','EN_PREPARACION') AND PEDIDO_ID <> @pedidoId2`);
      if (activeOrders.recordset[0].cnt === 0) {
        await tx.request()
          .input('mesaId', sql.Int, pedido.MESA_ID)
          .query(`UPDATE MESAS SET ESTADO = 'LIBRE' WHERE MESA_ID = @mesaId`);
      }
    }

    await tx.commit();
    return ventaId;
  } catch (err) {
    try { await tx.rollback(); } catch {}
    throw err;
  }
}

// ── Buscar productos para agregar a pedido ───────
async function searchProductos(search: string, puntoVentaId?: number): Promise<any[]> {
  const pool = await getPool();
  const req = pool.request();
  let where = `p.ACTIVO = 1`;

  if (search) {
    const tokens = search.trim().split(/\s+/);
    const conditions: string[] = [];
    tokens.forEach((token, i) => {
      const paramName = `search${i}`;
      req.input(paramName, sql.NVarChar, `%${token}%`);
      conditions.push(`(p.NOMBRE LIKE @${paramName} OR p.CODIGOPARTICULAR LIKE @${paramName} OR p.DESCRIPCION LIKE @${paramName})`);
    });
    where += ` AND (${conditions.join(' AND ')})`;
  }

  const query = `
    SELECT TOP 30 p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE,
           p.LISTA_1, p.LISTA_2, p.LISTA_3, p.LISTA_4, p.LISTA_5,
           ISNULL(p.LISTA_DEFECTO, 1) AS LISTA_DEFECTO,
           p.PRECIO_COMPRA, p.ES_CONJUNTO, p.ES_SERVICIO, p.DESCUENTA_STOCK,
           ISNULL(u.ABREVIACION, 'u') AS UNIDAD_ABREVIACION,
           p.CANTIDAD AS STOCK
    FROM PRODUCTOS p
    LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
    WHERE ${where}
    ORDER BY p.NOMBRE
  `;
  const result = await req.query(query);

  return result.recordset.map((r: any) => {
    const listaDefecto = r.LISTA_DEFECTO || 1;
    const precio = r[`LISTA_${listaDefecto}`] || r.LISTA_1 || 0;
    return {
      PRODUCTO_ID: r.PRODUCTO_ID,
      CODIGOPARTICULAR: r.CODIGOPARTICULAR,
      NOMBRE: r.NOMBRE,
      PRECIO_VENTA: precio,
      LISTA_DEFECTO: listaDefecto,
      STOCK: r.STOCK,
      UNIDAD_ABREVIACION: r.UNIDAD_ABREVIACION,
    };
  });
}

// ── Búsqueda avanzada de productos para pedido ──
async function searchProductosAdvanced(params: {
  search?: string;
  marca?: string;
  categoria?: string;
  codigo?: string;
  soloActivos?: boolean;
  soloConStock?: boolean;
  listaId?: number;
  limit?: number;
}) {
  const pool = await getPool();
  const limit = params.limit || 50;
  const listaId = params.listaId || 0;

  const precioExpr = listaId > 0
    ? `p.LISTA_${Math.max(1, Math.min(5, listaId))}`
    : `CASE ISNULL(p.LISTA_DEFECTO, 1)
         WHEN 1 THEN p.LISTA_1
         WHEN 2 THEN p.LISTA_2
         WHEN 3 THEN p.LISTA_3
         WHEN 4 THEN p.LISTA_4
         WHEN 5 THEN p.LISTA_5
         ELSE p.LISTA_1
       END`;

  const conditions: string[] = [];
  const req = pool.request();

  if (params.soloActivos !== false) {
    conditions.push('p.ACTIVO = 1');
  }

  if (params.soloConStock) {
    conditions.push('ISNULL(p.CANTIDAD, 0) > 0');
  }

  if (params.search) {
    const tokens = params.search.trim().split(/\s+/).filter(t => t.length > 0);
    tokens.forEach((token, i) => {
      conditions.push(
        `(p.NOMBRE LIKE @t${i} OR p.CODIGOPARTICULAR LIKE @t${i}
          OR p.DESCRIPCION LIKE @t${i} OR cb.CODIGO_BARRAS LIKE @t${i}
          OR c.NOMBRE LIKE @t${i} OR m.NOMBRE LIKE @t${i})`
      );
      req.input(`t${i}`, sql.NVarChar, `%${token}%`);
    });
  }

  if (params.marca) {
    conditions.push('m.NOMBRE LIKE @marca');
    req.input('marca', sql.NVarChar, `%${params.marca.trim()}%`);
  }

  if (params.categoria) {
    conditions.push('c.NOMBRE LIKE @categoria');
    req.input('categoria', sql.NVarChar, `%${params.categoria.trim()}%`);
  }

  if (params.codigo) {
    const codigo = params.codigo.trim();
    if (/^\d{6,}$/.test(codigo)) {
      conditions.push('cb.CODIGO_BARRAS = @codExact');
      req.input('codExact', sql.NVarChar, codigo);
    } else {
      conditions.push('(p.CODIGOPARTICULAR LIKE @cod OR cb.CODIGO_BARRAS LIKE @cod)');
      req.input('cod', sql.NVarChar, `%${codigo}%`);
    }
  }

  const whereClause = conditions.length > 0
    ? 'WHERE ' + conditions.join(' AND ')
    : '';

  req.input('limit', sql.Int, limit);

  const result = await req.query(`
      SELECT DISTINCT TOP (@limit)
        p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE,
        ISNULL(m.NOMBRE, '') AS MARCA,
        ISNULL(c.NOMBRE, '') AS CATEGORIA,
        ${precioExpr} AS PRECIO_VENTA,
        ISNULL(p.LISTA_DEFECTO, 1) AS LISTA_DEFECTO,
        p.PRECIO_COMPRA, p.CANTIDAD AS STOCK,
        p.ES_CONJUNTO, p.ES_SERVICIO, p.DESCUENTA_STOCK,
        ISNULL(p.IMP_INT, 0) AS IMP_INT,
        p.TASA_IVA_ID, p.UNIDAD_ID,
        ISNULL(u.NOMBRE, '') AS UNIDAD_NOMBRE,
        ISNULL(u.ABREVIACION, 'u') AS UNIDAD_ABREVIACION,
        ISNULL(ti.PORCENTAJE, 0) AS IVA_PORCENTAJE
      FROM PRODUCTOS p
      LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
      LEFT JOIN TASAS_IMPUESTOS ti ON p.TASA_IVA_ID = ti.TASA_ID
      LEFT JOIN PRODUCTOS_COD_BARRAS cb ON p.PRODUCTO_ID = cb.PRODUCTO_ID
      LEFT JOIN CATEGORIAS c ON p.CATEGORIA_ID = c.CATEGORIA_ID
      LEFT JOIN MARCAS m ON p.MARCA_ID = m.MARCA_ID
      ${whereClause}
      ORDER BY p.NOMBRE
    `);

  return result.recordset;
}

// ── Pedidos activos de la mesa ───────────────────
async function getPedidoActivoMesa(mesaId: number): Promise<PedidoDetalle | null> {
  const pool = await getPool();
  const result = await pool.request()
    .input('mesaId', sql.Int, mesaId)
    .query(`SELECT TOP 1 PEDIDO_ID FROM PEDIDOS WHERE MESA_ID = @mesaId AND ESTADO IN ('ABIERTO','EN_PREPARACION') ORDER BY FECHA_CREACION DESC`);
  if (result.recordset.length === 0) return null;
  return getPedidoById(result.recordset[0].PEDIDO_ID);
}

export const mesasService = {
  getSectores,
  createSector,
  updateSector,
  deleteSector,
  getMesas,
  createMesa,
  updateMesa,
  deleteMesa,
  cambiarEstadoMesa,
  getPedidosMesa,
  getPedidoById,
  getPedidoActivoMesa,
  crearPedido,
  agregarItemPedido,
  actualizarCantidadItem,
  eliminarItemPedido,
  cerrarPedido,
  reabrirPedido,
  pasarPedidoAVenta,
  searchProductos,
  searchProductosAdvanced,
};
