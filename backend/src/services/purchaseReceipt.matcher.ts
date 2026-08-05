import { sql, getPool } from '../database/connection.js';
import type { ParsedReceipt, ParsedReceiptItem } from './purchaseReceipt.service.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Purchase Receipt Matcher
//
//  Recibe el JSON producido por purchaseReceiptService.parseReceiptFromImage
//  y lo cruza contra la base de datos para sugerir matches con PROVEEDORES
//  y PRODUCTOS. No escribe datos: sólo sugiere. La confirmación de creación
//  de productos / proveedores corre por cuenta del frontend con el flujo
//  normal del ERP.
// ═══════════════════════════════════════════════════════════════════════════

// ── Tipos públicos ───────────────────────────────────────────────────────
export interface ProveedorMatch {
  PROVEEDOR_ID: number;
  NOMBRE: string;
  CUIT: string | null;
  TELEFONO?: string | null;
  EMAIL?: string | null;
}

export interface ProductoCandidato {
  PRODUCTO_ID: number;
  CODIGOPARTICULAR: string | null;
  NOMBRE: string;
  STOCK_ACTUAL: number | null;
  PRECIO_COMPRA: number | null;
  PRECIO_VENTA: number | null;
  TASA_IVA_ID: number | null;
  UNIDAD_ABREVIACION: string | null;
  IVA_PORCENTAJE: number | null;
}

export type MatchStatus =
  | 'vinculado'        // match único, listo para volcar al carrito
  | 'candidatos_multiples' // 2+ candidatos, hay que elegir en el modal
  | 'crear_nuevo'      // decisión explícita del parser: no existe
  | 'omitir'           // línea no inventariable (percepciones, fletes, etc.)
  | 'sin_match';       // no se pudo matchear pero sugerencia=VINCULAR

export interface EnrichedItem extends ParsedReceiptItem {
  match_status: MatchStatus;
  match_score?: number;        // afinidad heurística 0..100
  linked_producto_id?: number; // si match_status === 'vinculado'
  linked_producto?: ProductoCandidato;
  candidatos: ProductoCandidato[];
}

export interface EnrichedReceipt {
  comprobante: ParsedReceipt['comprobante'];
  items: EnrichedItem[];
  totales: ParsedReceipt['totales'];
  proveedor_match: ProveedorMatch | null;
  proveedores_candidatos: ProveedorMatch[];
}

// ── Helpers ──────────────────────────────────────────────────────────────
function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '');
}

function escapeLike(value: string): string {
  // SQL Server: escapar % _ [ ] ^ con corchetes
  return value.replace(/[\\%_\\[\\]\\^]/g, '\\$&');
}

// ── Match de proveedor ───────────────────────────────────────────────────
async function matchProveedor(
  cuitRaw: string | null,
  razonSocial: string | null,
): Promise<{ match: ProveedorMatch | null; candidatos: ProveedorMatch[] }> {
  const pool = await getPool();
  const cuit = onlyDigits(cuitRaw);
  const razon = (razonSocial ?? '').trim();

  // 1) Match exacto por CUIT (sólo dígitos) — PROVEEDORES guarda el documento
  //    fiscal en TIPO_DOCUMENTO + NUMERO_DOC (no hay columna CUIT).
  if (cuit && cuit.length === 11) {
    const exact = await pool.request()
      .input('cuit', sql.NVarChar, cuit)
      .query<ProveedorMatch>(`
        SELECT TOP 1 PROVEEDOR_ID, NOMBRE, NUMERO_DOC AS CUIT
        FROM PROVEEDORES
        WHERE ACTIVO = 1
          AND REPLACE(REPLACE(REPLACE(REPLACE(ISNULL(NUMERO_DOC, ''), '-', ''), ' ', ''), '.', ''), '/', '') = @cuit
          AND (ISNULL(TIPO_DOCUMENTO, '') IN ('CUIT','CUIL','CF','') OR TIPO_DOCUMENTO IS NULL)
      `);
    if (exact.recordset.length > 0) {
      return { match: exact.recordset[0]!, candidatos: [exact.recordset[0]!] };
    }
  }

  // 2) Fallback por razón social (LIKE). Sólo si el nombre tiene >= 4 caracteres.
  if (razon.length >= 4) {
    const req = pool.request()
      .input('rs', sql.NVarChar, `%${escapeLike(razon)}%`)
      .input('rsExact', sql.NVarChar, razon)
      .input('rsPrefix', sql.NVarChar, `${razon}%`);
    const like = await req.query<ProveedorMatch>(`
      SELECT TOP 5 PROVEEDOR_ID, NOMBRE, NUMERO_DOC AS CUIT
      FROM PROVEEDORES
      WHERE ACTIVO = 1 AND NOMBRE LIKE @rs ESCAPE '\\'
      ORDER BY
        CASE WHEN NOMBRE = @rsExact THEN 0
             WHEN NOMBRE LIKE @rsPrefix THEN 1
             ELSE 2 END,
        LEN(NOMBRE)
    `);
    return {
      match: like.recordset[0] ?? null,
      candidatos: like.recordset,
    };
  }

  return { match: null, candidatos: [] };
}

// ── Match de item ────────────────────────────────────────────────────────
// PRECIO_VENTA se deriva de PRODUCTO_LISTA_PRECIOS filtrando por LISTA_DEFECTO,
// ya que PRODUCTOS no tiene la columna directo (es el patrón canónico del sistema).
const PRECIO_VENTA_SQL = `
  ISNULL(
    (SELECT TOP 1 plp.PRECIO
     FROM PRODUCTO_LISTA_PRECIOS plp
     WHERE plp.PRODUCTO_ID = p.PRODUCTO_ID
       AND plp.LISTA_ID = ISNULL(p.LISTA_DEFECTO, 1)),
    0
  ) AS PRECIO_VENTA
`;

async function findByCodigo(codigo: string, proveedorId: number | null): Promise<ProductoCandidato[]> {
  const pool = await getPool();
  // IMPORTANTE: siempre se busca por CODIGO_PROVEEDOR en PRODUCTOS_PROVEEDORES,
  // independientemente de si el matcher detectó el proveedor o no. Si el
  // usuario pre-seleccionó un proveedor y la IA no pudo matchearlo por
  // CUIT/razón social, el codigo_proveedor guardado contra ESE proveedor
  // también tiene que aparecer.
  //
  // Cuando `proveedorId` viene, prioriza matches del mismo proveedor (rank 2).
  // Si viene null, matchea contra cualquier proveedor (rank 1) — igualmente
  // útil porque en la UI el usuario puede re-vincular manualmente.
  //
  // Fallbacks finales:
  //   - p.CODIGOPARTICULAR del producto
  //   - PRODUCTOS_COD_BARRAS.CODIGO_BARRAS
  const req = pool.request().input('codigo', sql.NVarChar, codigo);

  let proveedorCondition = '';
  let proveedorConditionAlt = '';
  if (proveedorId !== null) {
    req.input('proveedorId', sql.Int, proveedorId);
    proveedorCondition = 'AND pp_cod.PROVEEDOR_ID = @proveedorId';
    proveedorConditionAlt = 'AND pp_alt.PROVEEDOR_ID = @proveedorId';
  }

  const r = await req.query<ProductoCandidato>(`
    SELECT TOP 10
      p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE,
      p.CANTIDAD AS STOCK_ACTUAL,
      CASE WHEN ISNULL(p.PRECIO_COMPRA_BASE, 0) > 0 THEN p.PRECIO_COMPRA_BASE ELSE p.PRECIO_COMPRA END AS PRECIO_COMPRA,
      ${PRECIO_VENTA_SQL},
      p.TASA_IVA_ID,
      u.ABREVIACION AS UNIDAD_ABREVIACION,
      ISNULL(ti.PORCENTAJE, 0) AS IVA_PORCENTAJE,
      (CASE
        WHEN pp_cod.PRODUCTO_ID IS NOT NULL THEN 3                      -- match exacto por CODIGO_PROVEEDOR
        WHEN pp_alt.PRODUCTO_ID IS NOT NULL THEN 2                       -- match por CODIGOPARTICULAR bajo el mismo proveedor
        WHEN p.CODIGOPARTICULAR = @codigo THEN 1                          -- match por CODIGOPARTICULAR del producto
        ELSE 0
      END) AS _MATCH_RANK
    FROM PRODUCTOS p
    LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
    LEFT JOIN TASAS_IMPUESTOS ti ON p.TASA_IVA_ID = ti.TASA_ID
    LEFT JOIN PRODUCTOS_PROVEEDORES pp_cod
      ON pp_cod.PRODUCTO_ID = p.PRODUCTO_ID
     AND pp_cod.CODIGO_PROVEEDOR = @codigo
     ${proveedorCondition}
    LEFT JOIN PRODUCTOS_PROVEEDORES pp_alt
      ON pp_alt.PRODUCTO_ID = p.PRODUCTO_ID
     AND pp_alt.PROVEEDOR_ID <> ISNULL(pp_cod.PROVEEDOR_ID, 0)
     ${proveedorConditionAlt}
    WHERE p.ACTIVO = 1
      AND (
        pp_cod.PRODUCTO_ID IS NOT NULL
        OR pp_alt.PRODUCTO_ID IS NOT NULL
        OR p.CODIGOPARTICULAR = @codigo
        OR EXISTS (
          SELECT 1 FROM PRODUCTOS_COD_BARRAS cb
          WHERE cb.PRODUCTO_ID = p.PRODUCTO_ID AND cb.CODIGO_BARRAS = @codigo
        )
      )
    ORDER BY _MATCH_RANK DESC, p.NOMBRE
  `);
  return r.recordset;
}

async function findByDescription(description: string, proveedorId: number | null = null): Promise<ProductoCandidato[]> {
  const pool = await getPool();
  const trimmed = description.trim();
  if (trimmed.length < 3) return [];
  const tokens = trimmed.split(/\s+/).filter(t => t.length >= 3);
  if (tokens.length === 0) return [];

  const req = pool.request();

  // Si hay proveedor vinculado, priorizamos productos ya asociados a él vía
  // PRODUCTOS_PROVEEDORES. Esto es lo que hace que la próxima factura del
  // mismo proveedor traiga el producto correcto aunque la IA no haya
  // extraído el codigo_proveedor del comprobante.
  const filtroProveedor = proveedorId !== null
    ? `AND EXISTS (
        SELECT 1 FROM PRODUCTOS_PROVEEDORES pp
        WHERE pp.PRODUCTO_ID = p.PRODUCTO_ID AND pp.PROVEEDOR_ID = @proveedorId
      )`
    : '';
  if (proveedorId !== null) {
    req.input('proveedorId', sql.Int, proveedorId);
  }

  const conds: string[] = [];
  tokens.slice(0, 4).forEach((tok, i) => {
    req.input(`t${i}`, sql.NVarChar, `%${escapeLike(tok)}%`);
    conds.push(`(p.NOMBRE LIKE @t${i} ESCAPE '\\' OR p.DESCRIPCION LIKE @t${i} ESCAPE '\\' OR p.CODIGOPARTICULAR LIKE @t${i} ESCAPE '\\')`);
  });
  const r = await req.query<ProductoCandidato>(`
    SELECT TOP 8
      p.PRODUCTO_ID, p.CODIGOPARTICULAR, p.NOMBRE,
      p.CANTIDAD AS STOCK_ACTUAL,
      CASE WHEN ISNULL(p.PRECIO_COMPRA_BASE, 0) > 0 THEN p.PRECIO_COMPRA_BASE ELSE p.PRECIO_COMPRA END AS PRECIO_COMPRA,
      ${PRECIO_VENTA_SQL},
      p.TASA_IVA_ID,
      u.ABREVIACION AS UNIDAD_ABREVIACION,
      ISNULL(ti.PORCENTAJE, 0) AS IVA_PORCENTAJE
    FROM PRODUCTOS p
    LEFT JOIN UNIDADES_MEDIDA u ON p.UNIDAD_ID = u.UNIDAD_ID
    LEFT JOIN TASAS_IMPUESTOS ti ON p.TASA_IVA_ID = ti.TASA_ID
    WHERE p.ACTIVO = 1 AND (${conds.join(' AND ')}) ${filtroProveedor}
    ORDER BY p.NOMBRE
  `);
  return r.recordset;
}

async function enrichItem(item: ParsedReceiptItem, proveedorId: number | null): Promise<EnrichedItem> {
  if (item.sugerencia_accion === 'OMITIR') {
    return {
      ...item,
      match_status: 'omitir',
      candidatos: [],
    };
  }

  const codigo = item.codigo_proveedor?.trim();
  let candidatos: ProductoCandidato[] = [];
  if (codigo) {
    candidatos = await findByCodigo(codigo, proveedorId);
  }
  if (candidatos.length === 0 && item.descripcion_proveedor) {
    // Primero buscamos dentro de los productos que el sistema ya tiene
    // asociados a este proveedor (vía PRODUCTOS_PROVEEDORES). Si esa lista
    // queda vacía, caemos al catálogo global como fallback.
    candidatos = await findByDescription(item.descripcion_proveedor, proveedorId);
    if (candidatos.length === 0 && proveedorId !== null) {
      candidatos = await findByDescription(item.descripcion_proveedor, null);
    }
  }

  if (item.sugerencia_accion === 'CREAR_NUEVO') {
    return {
      ...item,
      match_status: 'crear_nuevo',
      candidatos,
    };
  }

  if (candidatos.length === 1) {
    return {
      ...item,
      match_status: 'vinculado',
      linked_producto_id: candidatos[0]!.PRODUCTO_ID,
      linked_producto: candidatos[0]!,
      match_score: 100,
      candidatos,
    };
  }

  if (candidatos.length > 1) {
    return {
      ...item,
      match_status: 'candidatos_multiples',
      match_score: 70,
      candidatos,
    };
  }

  return {
    ...item,
    match_status: 'sin_match',
    candidatos: [],
  };
}

// ── API pública ──────────────────────────────────────────────────────────
/**
 * Enriquece el JSON de la IA con matches contra PRODUCTOS / PROVEEDORES.
 *
 * @param parsed                  JSON crudo ya sanitizado.
 * @param proveedorIdHint         Proveedor pre-seleccionado por el usuario
 *                                en el modal padre. Si viene, gana sobre el
 *                                match por IA: el matcher prioriza
 *                                PRODUCTOS_PROVEEDORES.CODIGO_PROVEEDOR
 *                                contra ESTE proveedor aunque la IA no haya
 *                                podido detectarlo por CUIT/razón social.
 *                                La detección por IA sigue corriendo para
 *                                informar al usuario.
 */
export async function enrichParsedReceipt(
  parsed: ParsedReceipt,
  proveedorIdHint?: number | null,
): Promise<EnrichedReceipt> {
  const { match: proveedorMatch, candidatos: proveedoresCandidatos } = await matchProveedor(
    parsed.comprobante.proveedor.cuit,
    parsed.comprobante.proveedor.razon_social,
  );

  // Proveedor efectivo para matchear ítems: el del usuario pisa al de la IA.
  // Esto es lo que hace que PRODUCTOS_PROVEEDORES.CODIGO_PROVEEDOR se busque
  // contra el proveedor correcto aunque la IA haya detectado otro (o ninguno).
  const proveedorEfectivo = proveedorIdHint ?? proveedorMatch?.PROVEEDOR_ID ?? null;

  const enrichedItems: EnrichedItem[] = [];
  for (const item of parsed.items) {
    enrichedItems.push(await enrichItem(item, proveedorEfectivo));
  }

  return {
    comprobante: parsed.comprobante,
    items: enrichedItems,
    totales: parsed.totales,
    proveedor_match: proveedorMatch,
    proveedores_candidatos: proveedoresCandidatos,
  };
}

export const purchaseReceiptMatcher = { enrichParsedReceipt };
