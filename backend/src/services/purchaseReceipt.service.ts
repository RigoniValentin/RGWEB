import OpenAI from 'openai';
import fs from 'fs';
import sharp from 'sharp';
import { aplicarProrrateoBonificacion, r2 } from './purchaseReceipt.prorrateo.js';

// ═══════════════════════════════════════════════════════════════════════════
//  Purchase Receipt Parser Service
//
//  Recibe una imagen de comprobante (factura/remito/ticket) ya persistida
//  en disco y devuelve un JSON estructurado con encabezado + ítems + totales,
//  usando gpt-4o-mini en modo visión (soporta image_url data URL).
//
//  El JSON devuelto cumple el contrato esperado por la ruta
//  POST /api/purchases/parse-image.
// ═══════════════════════════════════════════════════════════════════════════

// ── Cliente OpenAI (singleton, lazy) ─────────────────────────────────────
let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY no está configurado en el entorno');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function getModel(): string {
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

// ── Prompt del sistema ───────────────────────────────────────────────────
// Mantener idéntico al contrato acordado con producto. No inventar campos.
const RECEIPT_PARSER_PROMPT = `Eres un asistente experto en procesamiento de comprobantes fiscales, remitos y facturas comerciales de Argentina, integrado en un sistema de gestión.

Tu objetivo es analizar la imagen del comprobante enviada, extraer los datos del encabezado y la tabla de ítems, y preparar cada artículo en un formato estructurado para que el sistema informático pueda procesar su vinculación.

Debes devolver EXCLUSIVAMENTE un objeto JSON válido con la siguiente estructura y reglas. NO inventes IDs internos ni asumas el stock del sistema.

---
ESTRUCTURA DE SALIDA (JSON):

{
  "comprobante": {
    "tipo_comprobante": "FACTURA A" | "FACTURA B" | "REMITO" | "TICKET" | "OTRO",
    "numero_comprobante": string o null,
    "fecha_emision": "YYYY-MM-DD" o null,
    "proveedor": {
      "razon_social": string o null,
      "cuit": string o null (formato XX-XXXXXXXX-X)
    },
    "cliente": {
      "razon_social": string o null,
      "cuit": string o null
    }
  },
  "items": [
    {
      "codigo_proveedor": string o null,
      "descripcion_proveedor": string,
      "cantidad": number,
      "unidad_medida": string o null,
      "precio_unitario": number,
      "descuento_porcentaje": number,
      "subtotal_linea": number,
      "sugerencia_accion": "VINCULAR" | "CREAR_NUEVO" | "OMITIR",
      "motivo_sugerencia": string
    }
  ],
  "totales": {
    "subtotal": number o null,
    "bonificacion_total": number o null,
    "iva_total": number o null,
    "percepciones": number o null,
    "total_final": number o null
  }
}

---
REGLAS CRÍTICAS PARA codigo_proveedor (PRIORIDAD MÁXIMA):

El "código de proveedor" es el vínculo principal con nuestro sistema de stock. Sin él, ningún producto podrá matchearse automáticamente en futuras compras. Por eso su lectura requiere el MÁXIMO ESFUERZO:

1. DÓNDE BUSCAR (revisar TODAS estas zonas en cada ítem antes de rendirte):
   - Columna izquierda de la descripción (típico en facturas tipo A/B).
   - Columna derecha, antes o después de la cantidad.
   - Encabezado de la fila (sobre o debajo de la descripción).
   - Sub-bloque "Código" / "Cod" / "Cód" / "Ref" / "SKU" / "Art" / "EAN" si existe.
   - Códigos de barras impresos al final de la línea (EAN-13, EAN-8, Code 128). Si el barcode representa un código interno del proveedor (no un EAN global), usarlo. Si es EAN global estándar, ignorarlo y seguir buscando el código del proveedor.
   - Línea siguiente o pie de la fila (muchos proveedores lo ponen abajo).
   - Si la tabla tiene columna explícita "Cód. Proveedor" / "Cód. Art.", ese valor es el definitivo.

2. CÓMO INTERPRETAR:
   - Pueden ser numéricos puros (12345), alfanuméricos (ART-1234-XL), con guiones/puntos (7760.55).
   - NO confundir con: número de línea, número de orden de compra, número de remito, página, o código de barras EAN global.
   - Si el mismo código aparece en varias líneas, es válido repetirlo.
   - Si hay un código "padre" + "variante" (ej. "TALLE-M"), usar el código completo concatenado, no solo el padre.
   - Si la imagen es de baja calidad y el código es ilegible, igual poner el mejor intento en vez de null, y mencionarlo en motivo_sugerencia.

3. CUANDO NO HAY CÓDIGO VISIBLE:
   - Solo entonces poner null, pero antes de hacerlo confirmar exhaustivamente que no existe en ninguna de las zonas listadas.
   - Indicar en motivo_sugerencia: "Sin código visible" o "Código ilegible".

---
REGLAS CRÍTICAS PARA cantidad (PRIORIDAD MÁXIMA):

La cantidad es el segundo dato más importante del comprobante. Errores acá descuadran el stock y los totales. Por eso su lectura requiere el MÁXIMO ESFUERZO y validación cruzada:

1. DÓNDE BUSCAR:
   - Columna rotulada "Cant." / "Cantidad" / "Ctd." / "Cdad." / "Unid." (la celda numérica de esa columna).
   - Si la factura muestra la cantidad como "1 x 12", el segundo número (12) es la cantidad real.
   - Si la factura tiene columna "Bultos" + "Unid/Bulto" + "Cantidad", la columna "Cantidad" es la definitiva.

2. FORMATO NUMÉRICO ARGENTINO (CRUCIAL — causa principal de errores):
   - El separador decimal es la COMA, no el punto.
   - El separador de miles es el PUNTO.
   - "1.500" sin decimales = MIL QUINIENTOS (1500), NO uno coma cinco.
   - "1,5" = UNO COMA CINCO (1.5).
   - "1.500,50" = MIL QUINIENTOS CON 50/100 (1500.50).
   - "1.500.500" = UN MILLÓN QUINIENTOS MIL (1500500).
   - En el JSON de salida, la cantidad SIEMPRE debe escribirse con punto como decimal (estándar JSON) y sin separadores de miles.
   - Si la factura dice "1500" como cantidad (sin separadores), asumir 1500 unidades, NO 1.5.

3. VALIDACIÓN CRUZADA OBLIGATORIA (hacer antes de cerrar el JSON):
   - Para CADA ítem, verificar que subtotal_linea ≈ cantidad × precio_unitario (con tolerancia ±2% por redondeos, IVA, o bonificación de línea).
   - Si no cuadra, REVISAR la cantidad: es muy común confundir 1 con 10, o 1 con 100 cuando la foto tiene poca resolución.
   - Si la cantidad de TODAS las filas es exactamente 1, sospechar: probablemente se está leyendo mal la columna (confundir cantidad con código, precio, o subtotal).
   - Si una cantidad parece absurda (ej. 99999, 0.01, 0), re-leer la celda y revisar columnas vecinas.

4. CASOS ESPECIALES:
   - Bonificación por entrega: "10 + 2 bonif" → cantidad = 10, no 12 (los 2 son bonificados aparte).
   - Devoluciones: si la línea tiene signo negativo en subtotal, la cantidad también es positiva pero el subtotal se mantiene negativo, o bien cantidad negativa según el formato del proveedor. Priorizar el formato visual.
   - Bultos: "1 caja x 12 un." → cantidad = 12 (la cantidad real de unidades que entra a stock).
   - Unidad de medida "KG" o "LT": la cantidad es el peso/volumen, no las unidades (ej. 1,500 kg = 1.5).
   - Si la fila es OMITIR (flete, IVA, etc.) la cantidad puede ser null o irrelevante; no fallar por esto.

---
REGLAS PARA EL MANEJO DE ÍTEMS (sugerencia_accion):

Analiza la naturaleza de cada línea detectada en el comprobante y asigna un valor en "sugerencia_accion":

1. "VINCULAR":
   - Utilízalo para cualquier producto físico o mercadería que ingrese al inventario, independientemente de si tiene un código de proveedor explícito o no. Es la opción por defecto para artículos comerciales.
   - Indica en "motivo_sugerencia" si se detectó un código o si se basó en la descripción.

2. "CREAR_NUEVO":
   - Utilízalo solo si la descripción indica explícitamente que es un producto o insumo de muestra, bonificación por lanzamiento, o un ítem que por contexto visual parece ser una novedad en el catálogo del proveedor.

3. "OMITIR":
   - Utilízalo estrictamente si la línea NO corresponde a mercadería de stock (ej: "Envío a domicilio", "Flete", "Recargo por pago con tarjeta", "Percepción IIBB", "Intereses por mora", "Devolución de envases").
   - Indica en "motivo_sugerencia": "Concepto no inventariable / Gasto / Impuesto".

---
REGLAS GENERALES DE FORMATO Y EXTRACCIÓN:
- Normaliza todos los montos numéricos: utiliza punto '.' para decimales y elimina separadores de miles y signos de moneda ($).
- Fechas siempre en formato ISO (YYYY-MM-DD).
- Si la imagen está rotada o inclinada, analízala reorientando el texto correctamente antes de parsear.
- Si un campo no es legible o no está presente, asigna null.
- Devuelve ÚNICAMENTE el JSON. No incluyas bloques de código markdown (como \`\`\`json) ni texto explicativo antes o después de la estructura.

Antes de generar el JSON final, hacé DOS pasadas mentales obligatorias sobre la imagen:
1. Pasada de CÓDIGOS: revisá CADA fila en busca del código de proveedor.
2. Pasada de CANTIDADES: para CADA ítem, validá que subtotal_linea ≈ cantidad × precio_unitario (±2%). Si no cuadra, re-leé la cantidad.

Ambas lecturas dedicadas son OBLIGATORIAS y son la parte más importante de la tarea.`;

// ── Tipos del contrato de salida ─────────────────────────────────────────
export interface ParsedReceiptProveedor {
  razon_social: string | null;
  cuit: string | null;
}

export interface ParsedReceiptItem {
  codigo_proveedor: string | null;
  descripcion_proveedor: string;
  cantidad: number;
  unidad_medida: string | null;
  precio_unitario: number;
  descuento_porcentaje: number;
  subtotal_linea: number;
  sugerencia_accion: 'VINCULAR' | 'CREAR_NUEVO' | 'OMITIR';
  motivo_sugerencia: string;
  /** Precio unitario luego de aplicar la bonificación global prorrateada.
   *  Igual a `precio_unitario` cuando no hay bonificación. */
  precio_unitario_neto: number;
  /** Subtotal de la línea con la bonificación ya aplicada (= cantidad * neto). */
  subtotal_linea_neto: number;
  /** Porcentaje de bonificación aplicado a la factura (0 si no hay). */
  porcentaje_bonificacion_aplicado: number;
  /** Permite pasar esta interfaz a `aplicarProrrateoBonificacion` (que
   *  usa un tipo genérico con index signature). */
  [k: string]: unknown;
}

export interface ParsedReceiptTotales {
  subtotal: number | null;
  bonificacion_total: number | null;
  iva_total: number | null;
  percepciones: number | null;
  total_final: number | null;
}

export interface ParsedReceipt {
  comprobante: {
    tipo_comprobante: 'FACTURA A' | 'FACTURA B' | 'REMITO' | 'TICKET' | 'OTRO';
    numero_comprobante: string | null;
    fecha_emision: string | null;
    proveedor: ParsedReceiptProveedor;
    cliente: ParsedReceiptProveedor;
  };
  items: ParsedReceiptItem[];
  totales: ParsedReceiptTotales;
}

// ── Heurísticas defensivas ──────────────────────────────────────────────
const TIPOS_VALIDOS = new Set(['FACTURA A', 'FACTURA B', 'REMITO', 'TICKET', 'OTRO']);
const ACCIONES_VALIDAS = new Set(['VINCULAR', 'CREAR_NUEVO', 'OMITIR']);

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/\./g, '').replace(',', '.').trim();
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asIsoDateOrNull(value: unknown): string | null {
  const s = asStringOrNull(value);
  if (!s) return null;
  // Acepta DD/MM/YYYY o YYYY-MM-DD; normaliza a ISO.
  const m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m1) return `${m1[3]}-${m1[2]}-${m1[1]}`;
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m2) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function normalizeCuit(value: unknown): string | null {
  const digits = asStringOrNull(value)?.replace(/\D+/g, '');
  if (!digits) return null;
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

function sanitizeItem(raw: any): ParsedReceiptItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const descripcion = asStringOrNull(raw.descripcion_proveedor);
  if (!descripcion) return null;

  const accionRaw = asStringOrNull(raw.sugerencia_accion)?.toUpperCase() || 'VINCULAR';
  const sugerencia_accion = (ACCIONES_VALIDAS.has(accionRaw) ? accionRaw : 'VINCULAR') as ParsedReceiptItem['sugerencia_accion'];

  const cantidad = asNumberOrNull(raw.cantidad) ?? 1;
  const precio_unitario = asNumberOrNull(raw.precio_unitario) ?? 0;
  const subtotal_linea = asNumberOrNull(raw.subtotal_linea) ?? 0;

  return {
    codigo_proveedor: asStringOrNull(raw.codigo_proveedor),
    descripcion_proveedor: descripcion,
    cantidad,
    unidad_medida: asStringOrNull(raw.unidad_medida),
    precio_unitario,
    descuento_porcentaje: asNumberOrNull(raw.descuento_porcentaje) ?? 0,
    subtotal_linea,
    sugerencia_accion,
    motivo_sugerencia: asStringOrNull(raw.motivo_sugerencia) || 'Mercadería detectada en el comprobante',
    // Las claves prorrateadas se completan luego en sanitizeParsedReceipt
    // cuando tenemos los totales disponibles.
    precio_unitario_neto: r2(precio_unitario),
    subtotal_linea_neto: r2(subtotal_linea),
    porcentaje_bonificacion_aplicado: 0,
  };
}

function sanitizeComprobante(raw: any): ParsedReceipt['comprobante'] {
  const tipo = asStringOrNull(raw?.tipo_comprobante)?.toUpperCase() || 'OTRO';
  const tipoFinal = TIPOS_VALIDOS.has(tipo) ? (tipo as ParsedReceipt['comprobante']['tipo_comprobante']) : 'OTRO';

  return {
    tipo_comprobante: tipoFinal,
    numero_comprobante: asStringOrNull(raw?.numero_comprobante),
    fecha_emision: asIsoDateOrNull(raw?.fecha_emision),
    proveedor: {
      razon_social: asStringOrNull(raw?.proveedor?.razon_social),
      cuit: normalizeCuit(raw?.proveedor?.cuit),
    },
    cliente: {
      razon_social: asStringOrNull(raw?.cliente?.razon_social),
      cuit: normalizeCuit(raw?.cliente?.cuit),
    },
  };
}

function sanitizeTotales(raw: any): ParsedReceiptTotales {
  return {
    subtotal: asNumberOrNull(raw?.subtotal),
    bonificacion_total: asNumberOrNull(raw?.bonificacion_total),
    iva_total: asNumberOrNull(raw?.iva_total),
    percepciones: asNumberOrNull(raw?.percepciones),
    total_final: asNumberOrNull(raw?.total_final),
  };
}

export function sanitizeParsedReceipt(raw: unknown): ParsedReceipt {
  const root = (raw && typeof raw === 'object' ? raw : {}) as any;
  const itemsIn = Array.isArray(root.items) ? root.items : [];
  const items: ParsedReceiptItem[] = [];
  for (const it of itemsIn) {
    const sanitized = sanitizeItem(it);
    if (sanitized) items.push(sanitized);
  }

  const totales = sanitizeTotales(root.totales);

  // Prorratear bonificación global sobre los ítems (ver purchaseReceipt.prorrateo.ts
  // para el detalle matemático). Esto preserva la precisión de costos
  // cuando el proveedor aplica un descuento al pie de la factura.
  const itemsProrrateados = aplicarProrrateoBonificacion(items, totales);

  return {
    comprobante: sanitizeComprobante(root.comprobante),
    items: itemsProrrateados,
    totales,
  };
}

// ── Inferencia de tipo de comprobante → código interno del ERP ───────────
// Mapea el string devuelto por la IA al código corto usado en
// COMPRAS.TIPO_COMPROBANTE (FA/FB/FC/FM/RM/TK/etc.).
export function mapTipoComprobante(aiTipo: ParsedReceipt['comprobante']['tipo_comprobante']): string {
  switch (aiTipo) {
    case 'FACTURA A': return 'FA';
    case 'FACTURA B': return 'FB';
    case 'REMITO': return 'RM';
    case 'TICKET': return 'TK';
    default: return 'FB';
  }
}

// ── Núcleo: parsear imagen con OpenAI Vision ─────────────────────────────
export interface ParseResult {
  parsed: ParsedReceipt;
  raw: string; // JSON crudo por si se quiere loggear / debuggear
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// ── Pre-procesado de imagen para reducir tokens de visión sin perder precisión ──
// OpenAI cobra por "tiles" de 512×512 en modo detail:high. Una foto de celular
// de 4000×3000 genera ~20 tiles (~1700 tokens solo de imagen). Con este pipeline:
//   1. Auto-rotar (EXIF) — fotos de celular suelen venir rotadas.
//   2. Limitar lado mayor a 2000px — suficiente para leer códigos y cantidades
//      en tipografía de facturas (≥6pt) sin pagar tiles de más.
//   3. Normalizar contraste — fotos con sombra/soporte se leen mucho mejor.
//   4. Convertir a JPEG q=90 — payload ~5x menor que PNG/HEIC sin perder OCR.
// Resultado típico: 2000×1500 → 6 tiles (~510 tokens) en vez de 20 (~1700).
// Para mantener la imagen original persistida (la que ve el usuario) NO se
// sobreescribe el archivo: el procesamiento es solo en memoria.
async function preprocessImageForVision(imagePath: string): Promise<{ buffer: Buffer; mime: string }> {
  const ext = imagePath.toLowerCase().split('.').pop() || 'jpg';
  const supported = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'tif', 'tiff'];
  // Formatos que sharp no puede leer (ej. PDF) se mandan tal cual.
  if (!supported.includes(ext)) {
    const buffer = await fs.promises.readFile(imagePath);
    return { buffer, mime: ext === 'pdf' ? 'application/pdf' : 'image/jpeg' };
  }
  const buffer = await sharp(imagePath, { failOn: 'none' })
    .rotate()                                       // respeta orientación EXIF
    .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
    .normalize()                                    // estira contraste
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return { buffer, mime: 'image/jpeg' };
}

export async function parseReceiptFromImage(imagePath: string): Promise<ParseResult> {
  const { buffer, mime } = await preprocessImageForVision(imagePath);
  const b64 = buffer.toString('base64');

  const openai = getOpenAI();

  const response = await openai.chat.completions.create({
    model: getModel(),
    temperature: 0.1,
    messages: [
      { role: 'system', content: RECEIPT_PARSER_PROMPT },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Analizá la imagen adjunta y devolvé el JSON del comprobante siguiendo la estructura indicada en el system prompt. No incluyas explicaciones ni bloques markdown.',
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mime};base64,${b64}`,
              detail: 'high',
            },
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 2000,
  });

  const raw = response.choices?.[0]?.message?.content || '{}';
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('La IA no devolvió un JSON parseable. Reintentá con mejor iluminación.');
  }

  return {
    parsed: sanitizeParsedReceipt(json),
    raw,
    usage: response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        }
      : undefined,
  };
}

// Re-exportar el prompt por si lo我们需要 exponer para debugging/tests.
export const _RECEIPT_PARSER_PROMPT_DEBUG = RECEIPT_PARSER_PROMPT;

export const purchaseReceiptService = {
  parseReceiptFromImage,
  sanitizeParsedReceipt,
  mapTipoComprobante,
};
