import crypto from 'crypto';
import { URL } from 'url';
import http from 'http';
import https from 'https';
import { integracionesService } from './integraciones.service.js';

// ═══════════════════════════════════════════════════
//  Webhook Dispatcher
//
//  Cola en memoria + worker periódico. Las llamadas
//  HTTP salientes se hacen fuera del flujo principal
//  para garantizar que un VPS caído NO bloquee el
//  sistema de gestión local.
//
//  - notifyStockChange(productoId): enqueue debounced
//  - Cada FLUSH_INTERVAL_MS, el worker:
//      1. Toma los IDs pendientes
//      2. Filtra los que tienen VENTA_WEB = 1
//      3. Lee el snapshot actual de stock
//      4. POST al webhook con retries exponenciales
//      5. Registra el resultado en INTEGRACIONES_SYNC_LOGS
// ═══════════════════════════════════════════════════

const FLUSH_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;

interface PendingChange {
  productoIds: Set<number>;
}

const pending: PendingChange = { productoIds: new Set() };
let workerStarted = false;
let workerTimer: NodeJS.Timeout | null = null;

/**
 * Encola un cambio de stock. La verificación de VENTA_WEB
 * se hace asincrónicamente en el flush para no acoplar el
 * hilo principal.
 */
function notifyStockChange(productoId: number): void {
  if (!Number.isInteger(productoId) || productoId <= 0) return;
  pending.productoIds.add(productoId);
}

function buildSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

interface HttpResult {
  status: number;
  body: string;
}

/**
 * POST minimalista con timeout. Usamos http/https nativo
 * para no agregar dependencias.
 */
function httpPost(targetUrl: string, headers: Record<string, string>, body: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(targetUrl);
    } catch {
      reject(new Error(`URL inválida: ${targetUrl}`));
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'RioGestion-Webhook/1.0',
          ...headers,
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8').slice(0, 4000),
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => reject(err));
    req.write(body);
    req.end();
  });
}

/**
 * Envía un evento al webhook con retries exponenciales.
 * Nunca lanza — los errores se registran en el log.
 */
async function dispatchEvent(
  eventType: string,
  payload: unknown,
  opts: { url: string; secret: string | null; maxRetries: number },
): Promise<void> {
  const bodyStr = JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), data: payload });
  const headers: Record<string, string> = {};
  if (opts.secret) {
    headers['X-RG-Signature'] = buildSignature(opts.secret, bodyStr);
  }

  let attempt = 0;
  let lastError: string | null = null;
  let lastStatus: number | null = null;
  let lastResponse: string | null = null;

  while (attempt <= opts.maxRetries) {
    const started = Date.now();
    try {
      const res = await httpPost(opts.url, headers, bodyStr);
      const duration = Date.now() - started;
      lastStatus = res.status;
      lastResponse = res.body;
      if (res.status >= 200 && res.status < 300) {
        await integracionesService.log({
          eventType,
          direction: 'OUTBOUND',
          status: 'SUCCESS',
          httpStatus: res.status,
          targetUrl: opts.url,
          requestBody: bodyStr,
          responseBody: res.body,
          durationMs: duration,
        });
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = (err as Error).message;
    }
    attempt++;
    if (attempt <= opts.maxRetries) {
      // Backoff exponencial: 500ms, 1s, 2s, 4s...
      const backoff = 500 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  await integracionesService.log({
    eventType,
    direction: 'OUTBOUND',
    status: 'ERROR',
    httpStatus: lastStatus,
    targetUrl: opts.url,
    requestBody: bodyStr,
    responseBody: lastResponse,
    errorMessage: lastError,
  });
}

/**
 * Worker principal: ejecuta cada FLUSH_INTERVAL_MS.
 * Captura todos los errores para no matar el proceso.
 */
async function flush(): Promise<void> {
  if (pending.productoIds.size === 0) return;

  // Snapshot y reset
  const ids = Array.from(pending.productoIds);
  pending.productoIds.clear();

  try {
    const config = await integracionesService.getConfig();
    if (!config.webhook_enabled || !config.webhook_url) {
      return; // webhook deshabilitado o sin URL → simplemente ignoramos
    }

    // Filtra solo los productos marcados como VENTA_WEB y arma snapshot
    const items = await integracionesService.getStockParaTienda({ productoIds: ids });
    if (items.length === 0) return;

    await dispatchEvent(
      'stock.updated',
      { items },
      {
        url: config.webhook_url,
        secret: config.webhook_secret,
        maxRetries: config.webhook_max_retries || DEFAULT_MAX_RETRIES,
      },
    );
  } catch (err) {
    console.error('[webhookDispatcher] flush error:', (err as Error).message);
  }
}

/** Inicia el worker. Idempotente. */
function start(): void {
  if (workerStarted) return;
  workerStarted = true;
  workerTimer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  // Evita que el worker mantenga vivo el proceso al cerrar
  workerTimer.unref?.();
}

function stop(): void {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  workerStarted = false;
}

/**
 * Test manual: envía un ping al webhook configurado.
 * Devuelve true en caso de 2xx, false en cualquier otro caso.
 */
async function testWebhook(): Promise<{ ok: boolean; message: string }> {
  try {
    const config = await integracionesService.getConfig();
    if (!config.webhook_url) {
      return { ok: false, message: 'No hay URL de webhook configurada' };
    }
    const body = JSON.stringify({
      event: 'webhook.test',
      timestamp: new Date().toISOString(),
      data: { message: 'Río Gestión – test ping' },
    });
    const headers: Record<string, string> = {};
    if (config.webhook_secret) headers['X-RG-Signature'] = buildSignature(config.webhook_secret, body);

    const started = Date.now();
    const res = await httpPost(config.webhook_url, headers, body);
    const duration = Date.now() - started;
    const ok = res.status >= 200 && res.status < 300;

    await integracionesService.log({
      eventType: 'webhook.test',
      direction: 'OUTBOUND',
      status: ok ? 'SUCCESS' : 'ERROR',
      httpStatus: res.status,
      targetUrl: config.webhook_url,
      requestBody: body,
      responseBody: res.body,
      errorMessage: ok ? null : `HTTP ${res.status}`,
      durationMs: duration,
    });
    return { ok, message: ok ? 'Webhook respondió correctamente' : `HTTP ${res.status}` };
  } catch (err) {
    const msg = (err as Error).message;
    await integracionesService.log({
      eventType: 'webhook.test',
      direction: 'OUTBOUND',
      status: 'ERROR',
      errorMessage: msg,
    });
    return { ok: false, message: msg };
  }
}

export const webhookDispatcher = {
  notifyStockChange,
  start,
  stop,
  testWebhook,
  /** Para testing — flush inmediato */
  _flushNow: flush,
};
