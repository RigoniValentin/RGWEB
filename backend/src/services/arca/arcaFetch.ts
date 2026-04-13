/**
 * HTTPS fetch wrapper for ARCA endpoints.
 * Uses a custom agent to handle ARCA's weak DHE parameters
 * that Node.js 18+ rejects by default.
 */
import https from 'https';
import crypto from 'crypto';

const arcaAgent = new https.Agent({
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
  ciphers: 'DEFAULT:@SECLEVEL=0',
  minVersion: 'TLSv1' as any,
});

interface ArcaFetchResult {
  status: number;
  ok: boolean;
  text: string;
}

export async function arcaFetch(url: string, options: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<ArcaFetchResult> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = https.request({
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'POST',
      agent: arcaAgent,
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        const status = res.statusCode || 500;
        resolve({ status, ok: status >= 200 && status < 300, text });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}
