import OpenAI from 'openai';
import fs from 'fs';

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
- Devuelve ÚNICAMENTE el JSON. No incluyas bloques de código markdown (como \`\`\`json) ni texto explicativo antes o después de la estructura.`;

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

  return {
    codigo_proveedor: asStringOrNull(raw.codigo_proveedor),
    descripcion_proveedor: descripcion,
    cantidad: asNumberOrNull(raw.cantidad) ?? 1,
    unidad_medida: asStringOrNull(raw.unidad_medida),
    precio_unitario: asNumberOrNull(raw.precio_unitario) ?? 0,
    descuento_porcentaje: asNumberOrNull(raw.descuento_porcentaje) ?? 0,
    subtotal_linea: asNumberOrNull(raw.subtotal_linea) ?? 0,
    sugerencia_accion,
    motivo_sugerencia: asStringOrNull(raw.motivo_sugerencia) || 'Mercadería detectada en el comprobante',
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

  return {
    comprobante: sanitizeComprobante(root.comprobante),
    items,
    totales: sanitizeTotales(root.totales),
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

export async function parseReceiptFromImage(imagePath: string): Promise<ParseResult> {
  const buffer = await fs.promises.readFile(imagePath);
  const b64 = buffer.toString('base64');
  const ext = imagePath.toLowerCase().split('.').pop() || 'jpg';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
  };
  const mime = mimeMap[ext] || 'image/jpeg';

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
            image_url: { url: `data:${mime};base64,${b64}` },
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
