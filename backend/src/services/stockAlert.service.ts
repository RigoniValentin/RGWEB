import { getPool, sql } from '../database/connection.js';
import { config } from '../config/index.js';

function normalizePhone(telefono: string): string {
  let phone = telefono.replace(/\D/g, '');
  if (phone.length === 10) phone = `549${phone}`;
  else if (phone.length === 12 && phone.startsWith('54')) phone = `549${phone.slice(2)}`;
  return phone;
}

async function isEnabled(): Promise<boolean> {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        COALESCE(
          (SELECT TOP 1 cg.VALOR FROM CONFIG_GLOBAL cg WHERE cg.PARAMETRO_ID = p.PARAMETRO_ID),
          (SELECT TOP 1 cu.VALOR FROM CONFIG_USUARIO cu WHERE cu.PARAMETRO_ID = p.PARAMETRO_ID AND cu.VALOR = 'true'),
          p.VALOR_DEFECTO
        ) AS VALOR
      FROM CONFIG_PARAMETROS p
      WHERE p.CLAVE = 'alerta_stock_login_wsp' AND p.ACTIVO = 1
    `);
    return result.recordset[0]?.VALOR === 'true';
  } catch {
    return false;
  }
}

async function sendWhatsApp(mensaje: string): Promise<void> {
  const ipWsp = config.integrations.ipWsp;
  const telefono = config.app.telefonoCliente;
  if (!ipWsp || !telefono) return;
  try {
    await fetch(`${ipWsp}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: normalizePhone(telefono), mensaje }),
    });
  } catch { /* no-op */ }
}

function getEmpresa(): string {
  return config.app.nombreFantasia || 'Río Gestión';
}

function getNowLabel(): string {
  return new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
}

function formatNumber(value: number): string {
  return Number(value).toLocaleString('es-AR', { maximumFractionDigits: 4 });
}

export const stockAlertService = {
  async sendLoginStockAlert(pool: any): Promise<void> {
    try {
      if (!(await isEnabled())) return;

      const stockRes = await pool.request().query(`
        SELECT TOP 50
          p.NOMBRE,
          ISNULL(p.CANTIDAD, 0) AS CANTIDAD,
          p.STOCK_MINIMO
        FROM PRODUCTOS p
        WHERE p.ACTIVO = 1
          AND ISNULL(p.ES_SERVICIO, 0) = 0
          AND p.STOCK_MINIMO IS NOT NULL
          AND ISNULL(p.CANTIDAD, 0) <= p.STOCK_MINIMO
        ORDER BY (p.STOCK_MINIMO - ISNULL(p.CANTIDAD, 0)) DESC
      `);
      const items: { NOMBRE: string; CANTIDAD: number; STOCK_MINIMO: number }[] = stockRes.recordset;
      if (items.length === 0) return;

      let msg = `*-------- ${getEmpresa().toUpperCase()} --------*\n`;
      msg += `⚠️ \`\`\`Alerta de Stock Bajo.\`\`\`\n\n`;
      msg += `Productos con stock igual o por debajo del mínimo:\n\n`;
      for (const item of items) {
        msg += `- *${item.NOMBRE}*: _${formatNumber(item.CANTIDAD)}_ (mín: _${formatNumber(item.STOCK_MINIMO)}_)\n`;
      }
      msg += `\n_Generado al iniciar sesión: ${getNowLabel()}_\n`;
      msg += `_Enviado desde *Río Gestión* Software_.`;

      await sendWhatsApp(msg);
    } catch { /* never interrupt login flow */ }
  },

  async notifyIfEnteredLowStock(tx: any, productoId: number, cantidadAnterior: number, cantidadNueva: number, detalle?: string | null): Promise<void> {
    try {
      const delta = cantidadNueva - cantidadAnterior;
      if (delta >= 0) return;

      if (!(await isEnabled())) return;

      const result = await tx.request()
        .input('prodId', sql.Int, productoId)
        .query(`
          SELECT NOMBRE, ISNULL(CANTIDAD, 0) AS CANTIDAD_TOTAL, STOCK_MINIMO
          FROM PRODUCTOS
          WHERE PRODUCTO_ID = @prodId
            AND ACTIVO = 1
            AND ISNULL(ES_SERVICIO, 0) = 0
            AND STOCK_MINIMO IS NOT NULL
        `);
      const producto = result.recordset[0];
      if (!producto) return;

      const stockMinimo = Number(producto.STOCK_MINIMO);
      const totalActual = Number(producto.CANTIDAD_TOTAL);
      const totalPrevio = totalActual - delta;

      // Fire only when crossing the threshold from above to at/below minimum
      if (totalPrevio <= stockMinimo || totalActual > stockMinimo) return;

      let msg = `*-------- ${getEmpresa().toUpperCase()} --------*\n`;
      msg += `⚠️ \`\`\`Producto en Stock Bajo.\`\`\`\n\n`;
      msg += `*${producto.NOMBRE}* acaba de quedar por debajo del stock mínimo.\n\n`;
      msg += `- Stock anterior: _${formatNumber(totalPrevio)}_\n`;
      msg += `- Stock actual: _${formatNumber(totalActual)}_\n`;
      msg += `- Mínimo configurado: _${formatNumber(stockMinimo)}_\n`;
      if (detalle) msg += `- Movimiento: _${detalle}_\n`;
      msg += `\n_Generado: ${getNowLabel()}_\n`;
      msg += `_Enviado desde *Río Gestión* Software_.`;

      await sendWhatsApp(msg);
    } catch { /* stock alerts must never break stock updates */ }
  },
};
