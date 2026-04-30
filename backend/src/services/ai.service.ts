import OpenAI from 'openai';
import { getPool } from '../database/connection.js';

// ═══════════════════════════════════════════════════════════════════════════
//  AI Assistant Service — puerto a TypeScript del bot WhatsApp (api-wsp).
//  Expone un chat con tool-calling sobre la DB SQL Server.
//  Sólo permite SELECT dinámicos — nunca modifica datos.
// ═══════════════════════════════════════════════════════════════════════════

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

// ── Esquema de la DB (cache en memoria) ───────────────────────────────────
let dbSchemaCache = '';
let schemaLoadedAt = 0;
const SCHEMA_TTL_MS = 30 * 60 * 1000; // 30 min

// Invalida el cache al arrancar (por si cambió el sistema prompt)
dbSchemaCache = '';
schemaLoadedAt = 0;

async function loadSchema(): Promise<string> {
  const now = Date.now();
  if (dbSchemaCache && now - schemaLoadedAt < SCHEMA_TTL_MS) {
    return dbSchemaCache;
  }

  const pool = await getPool();
  const cols = await pool.request().query(`
    SELECT 
      t.TABLE_SCHEMA, t.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE,
      c.IS_NULLABLE, c.CHARACTER_MAXIMUM_LENGTH,
      CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PK' ELSE '' END as IS_PK,
      CASE WHEN fk.COLUMN_NAME IS NOT NULL THEN fk.REF_TABLE ELSE '' END as FK_REF
    FROM INFORMATION_SCHEMA.TABLES t
    JOIN INFORMATION_SCHEMA.COLUMNS c
      ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
    LEFT JOIN (
      SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
    ) pk ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA AND pk.TABLE_NAME = c.TABLE_NAME AND pk.COLUMN_NAME = c.COLUMN_NAME
    LEFT JOIN (
      SELECT cu.TABLE_SCHEMA, cu.TABLE_NAME, cu.COLUMN_NAME,
        cu2.TABLE_SCHEMA + '.' + cu2.TABLE_NAME as REF_TABLE
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE cu ON rc.CONSTRAINT_NAME = cu.CONSTRAINT_NAME
      JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE cu2 ON rc.UNIQUE_CONSTRAINT_NAME = cu2.CONSTRAINT_NAME
    ) fk ON fk.TABLE_SCHEMA = c.TABLE_SCHEMA AND fk.TABLE_NAME = c.TABLE_NAME AND fk.COLUMN_NAME = c.COLUMN_NAME
    WHERE t.TABLE_TYPE = 'BASE TABLE'
    ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME, c.ORDINAL_POSITION
  `);

  const schema: Record<string, string[]> = {};
  for (const row of cols.recordset) {
    const tableName = `${row.TABLE_SCHEMA}.${row.TABLE_NAME}`;
    if (!schema[tableName]) schema[tableName] = [];
    let colDef = `${row.COLUMN_NAME} ${row.DATA_TYPE}`;
    if (row.CHARACTER_MAXIMUM_LENGTH && row.CHARACTER_MAXIMUM_LENGTH > 0) {
      colDef += `(${row.CHARACTER_MAXIMUM_LENGTH})`;
    }
    if (row.IS_PK) colDef += ' PK';
    if (row.FK_REF) colDef += ` FK→${row.FK_REF}`;
    if (row.IS_NULLABLE === 'NO' && !row.IS_PK) colDef += ' NOT NULL';
    schema[tableName].push(colDef);
  }

  let text = '';
  for (const [table, columns] of Object.entries(schema)) {
    text += `${table}: ${columns.join(', ')}\n`;
  }

  dbSchemaCache = text;
  schemaLoadedAt = now;
  return text;
}

// ── Ejecutar SQL dinámico (SELECT only, con guardas) ──────────────────────
async function ejecutarSQL(query: string): Promise<any> {
  const trimmed = query.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
    return { error: 'Sólo se permiten consultas SELECT' };
  }
  const forbidden = [
    'INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'ALTER ', 'CREATE ',
    'TRUNCATE', 'EXEC ', 'EXECUTE ', 'XP_', 'SP_', 'MERGE ', 'GRANT ', 'REVOKE ',
  ];
  for (const word of forbidden) {
    if (trimmed.includes(word)) {
      return { error: `Operación no permitida: ${word.trim()}` };
    }
  }

  try {
    const pool = await getPool();
    const result = await pool.request().query(query);
    const rows = (result.recordset || []).slice(0, 50);
    return {
      filas: rows.length,
      total: result.recordset?.length ?? 0,
      datos: rows,
    };
  } catch (err: any) {
    return { error: err?.message ?? String(err) };
  }
}

// ── Tool definitions ──────────────────────────────────────────────────────
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'ejecutar_sql',
      description:
        'Ejecuta una consulta SQL SELECT en la base de datos SQL Server del sistema Río Gestión. Solo SELECT. Devuelve hasta 50 filas. Usá TOP para limitar. Respetá los nombres de tablas y columnas del esquema.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Consulta SQL SELECT a ejecutar' },
          descripcion: { type: 'string', description: 'Breve descripción de qué busca' },
        },
        required: ['query'],
      },
    },
  },
];

function getSystemPrompt(schema: string, userName: string, businessName: string): string {
  return `Sos RioBot, el asistente virtual inteligente de "${businessName}", un sistema de gestión comercial (ERP).
Estás hablando con el usuario *${userName}* a través de la aplicación móvil Río Gestión.
Tu rol es ayudarlo a consultar información del sistema en tiempo real.

Tenés acceso completo a la base de datos SQL Server a través de la herramienta ejecutar_sql.
Podés generar cualquier consulta SELECT que necesites usando el esquema que se detalla abajo.

ESQUEMA DE LA BASE DE DATOS:
${schema}

CONOCIMIENTO DE DOMINIO — RELACIONES CLAVE DEL SISTEMA:

1. CUENTAS CORRIENTES DE CLIENTES:
   - Un cliente tiene cuenta corriente cuando CLIENTES.CTA_CORRIENTE = 1 (flag boolean).
   - El registro de la cuenta está en CTA_CORRIENTE_C (columnas: CTA_CORRIENTE_ID PK, CLIENTE_ID FK→CLIENTES).
   - Los movimientos (cargos y pagos en cuotas) están en VENTAS_CTA_CORRIENTE (columnas: COMPROBANTE_ID PK, CTA_CORRIENTE_ID FK→CTA_CORRIENTE_C, FECHA, CONCEPTO, TIPO_COMPROBANTE, DEBE, HABER).
   - DEBE = deuda generada (venta a crédito). HABER = pago o crédito. SALDO = SUM(DEBE - HABER).
   - Los pagos/cobranzas están en PAGOS_CTA_CORRIENTE_C (columnas: PAGO_ID PK, CTA_CORRIENTE_ID, FECHA, TOTAL, CONCEPTO, EFECTIVO, DIGITAL, CHEQUES).
   - Query ejemplo para listar clientes con su saldo: SELECT C.NOMBRE, C.CODIGOPARTICULAR, ISNULL(SUM(V.DEBE - V.HABER), 0) AS SALDO FROM CLIENTES C LEFT JOIN CTA_CORRIENTE_C CTA ON C.CLIENTE_ID = CTA.CLIENTE_ID LEFT JOIN VENTAS_CTA_CORRIENTE V ON CTA.CTA_CORRIENTE_ID = V.CTA_CORRIENTE_ID WHERE C.CTA_CORRIENTE = 1 AND C.ACTIVO = 1 GROUP BY C.NOMBRE, C.CODIGOPARTICULAR ORDER BY SALDO DESC
   - Query ejemplo para movimientos de un cliente: SELECT V.FECHA, V.CONCEPTO, V.TIPO_COMPROBANTE, V.DEBE, V.HABER FROM CLIENTES C JOIN CTA_CORRIENTE_C CTA ON C.CLIENTE_ID = CTA.CLIENTE_ID JOIN VENTAS_CTA_CORRIENTE V ON CTA.CTA_CORRIENTE_ID = V.CTA_CORRIENTE_ID WHERE C.NOMBRE LIKE '%nombre%' ORDER BY V.FECHA DESC

2. VENTAS:
   - Ventas en VENTAS. Ítems en VENTAS_ITEMS. JOIN: VENTAS.VENTA_ID = VENTAS_ITEMS.VENTA_ID.
   - VENTAS tiene CLIENTE_ID FK→CLIENTES, FECHA, TOTAL, ESTADO ('COMPLETADA','ANULADA').
   - Para ventas del día: CAST(FECHA AS DATE) = CAST(GETDATE() AS DATE).

3. STOCK / PRODUCTOS:
   - Productos en ARTICULOS (ARTICULO_ID, CODIGO_BARRA, NOMBRE, PRECIO_VENTA, STOCK_ACTUAL).
   - Categorías en CATEGORIAS. JOIN: ARTICULOS.CATEGORIA_ID = CATEGORIAS.CATEGORIA_ID.

4. CAJA:
   - Cajas en CAJA (CAJA_ID, USUARIO_ID, FECHA_APERTURA, FECHA_CIERRE, ESTADO='ACTIVA'|'CERRADA').
   - Movimientos de caja en CAJA_ITEMS (CAJA_ID, FECHA, ORIGEN_TIPO, DESCRIPCION, MONTO_EFECTIVO, MONTO_DIGITAL).

REGLAS PARA CONSULTAS SQL:
- Solo podés ejecutar SELECT. Nunca INSERT, UPDATE, DELETE, DROP ni nada que modifique datos.
- Usá TOP para limitar resultados grandes (ej: TOP 20).
- Para fechas usá CAST(campo AS DATE) o CONVERT.
- Los nombres de tablas/columnas están en el esquema. Respetá los nombres exactos.
- Si necesitás cruzar tablas, usá JOINs basándote en las FK del esquema y el conocimiento de dominio de arriba.
- Si una consulta falla, analizá el error y reintentá con la corrección.
- NUNCA asumas que no existen datos sin ejecutar la query primero. Siempre consultá la base de datos.

REGLAS DE RESPUESTA:
- Respondé siempre en español argentino, de forma concisa y clara.
- Usá formato Markdown estándar: **negrita**, *itálica*, listas con guión (-).
- Mantené las respuestas cortas y directas al punto.
- Si hay muchos resultados, mostrá un resumen y ofrecé detallar.
- Nunca muestres contraseñas ni tokens.
- Si no encontrás datos, decilo amablemente y sugerí alternativas.
- Usá emojis moderadamente.
- No inventes datos. Si una consulta falla, explicá el error de forma simple.
- Cuando muestres montos, usalos con formato $ y separador de miles con punto.`;
}

// ── Tipos públicos ────────────────────────────────────────────────────────
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  userName: string;
  businessName: string;
  history: ChatMessage[]; // incluye el nuevo mensaje del usuario al final
}

export interface ChatResult {
  reply: string;
  toolCalls: number;
}

// ── Chat principal con tool-calling loop ──────────────────────────────────
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const schema = await loadSchema();
  const openai = getOpenAI();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: getSystemPrompt(schema, opts.userName, opts.businessName) },
    ...opts.history.map((m) => ({ role: m.role, content: m.content })),
  ];

  let toolCallsUsed = 0;
  let response = await openai.chat.completions.create({
    model: getModel(),
    messages,
    tools,
    tool_choice: 'auto',
    temperature: 0.7,
    max_tokens: 1000,
  });

  let message = response.choices[0].message;
  const MAX_ITERATIONS = 5;
  let iterations = 0;

  while (message.tool_calls && message.tool_calls.length > 0 && iterations < MAX_ITERATIONS) {
    iterations++;
    messages.push(message as any);

    for (const toolCall of message.tool_calls) {
      toolCallsUsed++;
      const tc = toolCall as any;
      const fnName = tc.function?.name;
      const fnArgsRaw = tc.function?.arguments ?? '{}';
      let result: any;
      try {
        const fnArgs = JSON.parse(fnArgsRaw);
        if (fnName === 'ejecutar_sql') {
          result = await ejecutarSQL(fnArgs.query);
        } else {
          result = { error: `Herramienta '${fnName}' no encontrada` };
        }
      } catch (err: any) {
        result = { error: err?.message ?? String(err) };
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    response = await openai.chat.completions.create({
      model: getModel(),
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1000,
    });
    message = response.choices[0].message;
  }

  return {
    reply: message.content || 'No pude generar una respuesta. Intentá de nuevo.',
    toolCalls: toolCallsUsed,
  };
}

export const aiService = { chat, loadSchema };
