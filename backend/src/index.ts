import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import path from 'path';
import fs from 'fs';
import { config } from './config/index.js';
import { frontendDir, isPkg } from './config/paths.js';
import { getPool, closePool } from './database/connection.js';
import { errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';
import { stockService } from './services/stock.service.js';
import { backupScheduler } from './services/backupScheduler.service.js';

// ── Console styling ──────────────────────────────────
const S = {
  r:    '\x1b[0m',
  b:    '\x1b[1m',
  dim:  '\x1b[2m',
  gold: '\x1b[38;2;234;189;35m',
  wh:   '\x1b[97m',
  gn:   '\x1b[38;2;82;196;26m',
  rd:   '\x1b[38;2;255;77;79m',
  gy:   '\x1b[90m',
  cy:   '\x1b[36m',
};
const VERSION = '1.0.0';

/** Pause console so the user can read errors before the window closes */
function waitForKey(msg = '  Presione Enter para cerrar...'): Promise<void> {
  return new Promise(resolve => {
    console.log(`${S.dim}${msg}${S.r}`);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', () => resolve());
    } else {
      // non-interactive fallback: wait 30s
      setTimeout(resolve, 30_000);
    }
  });
}

function serverBanner() {
  const ts = new Date().toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const G = S.gold + S.b;
  const R = S.r;
  const W = S.wh;
  const B = S.b;

  console.log('');
  console.log(`${G}  ┌─────────────────────────────────────────────────┐${R}`);
  console.log(`${G}  │                                                 │${R}`);
  console.log(`${G}  │          R Í O   G E S T I Ó N   W E B          │${R}`);
  console.log(`${G}  │                                                 │${R}`);
  console.log(`${G}  └─────────────────────────────────────────────────┘${R}`);
  console.log('');
  console.log(`${S.gy}  ───────────────────────────────────────────────────${R}`);
  console.log(`${W}   ${B}Estado${R}       ${S.gn}● Online${R}`);
  console.log(`${W}   ${B}Versión${R}      v${VERSION}`);
  console.log(`${W}   ${B}Puerto${R}       :${config.port}`);
  console.log(`${W}   ${B}Entorno${R}      ${config.nodeEnv}`);
  console.log(`${W}   ${B}Base datos${R}   ${config.db.server}/${config.db.database}`);
  console.log(`${W}   ${B}Cliente${R}      ${config.app.nombreCliente || '—'}`);
  console.log(`${W}   ${B}Inicio${R}       ${ts}`);
  console.log(`${S.gy}  ───────────────────────────────────────────────────${R}`);
  console.log('');
  console.log(`${S.dim}   Acceder  →  ${S.cy}http://localhost:${config.port}${R}`);
  console.log(`${S.dim}   Red LAN  →  ${S.cy}http://0.0.0.0:${config.port}${R} ${S.gy}(visible para dispositivos en la misma red)${R}`);
  console.log(`${S.dim}   Cerrar   →  Ctrl+C o cerrar esta ventana${R}`);
  console.log('');
  console.log(`${S.gy}   Esperando conexiones...${R}`);
  console.log('');
}

const app = express();

// ── Middleware ────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      'img-src': ["'self'", 'data:', 'blob:'],
    },
  },
}));
app.use(cors({
  // Origen abierto: necesario para que la app mobile (Expo / dispositivos en
  // red local) y el frontend web puedan consumir la API sin fricción.
  // Se devuelve el Origin solicitante cuando existe, para mantener
  // compatibilidad con credentials=true.
  origin: (origin, cb) => cb(null, origin || true),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Gzip every response above ~1KB. Massive bandwidth/perceived-latency win
// for JSON payloads (sales, products, dashboard) and the bundled JS.
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// ── API Routes ───────────────────────────────────────
app.use('/api', apiRoutes);

// ── Uploads estáticos (imágenes de productos pendientes mobile) ──
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// ── Health check ─────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Serve frontend in production / packaged mode ────
if (config.nodeEnv === 'production' || isPkg) {
  // Hashed assets (Vite emits them under /assets/) are immutable and
  // can be cached aggressively. The HTML entry must always be revalidated
  // so deploys take effect immediately.
  app.use('/assets', express.static(path.join(frontendDir, 'assets'), {
    immutable: true,
    maxAge: '1y',
    fallthrough: true,
  }));
  app.use(express.static(frontendDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
}

// ── Error handling ───────────────────────────────────
app.use(errorHandler);

// ── Start server ─────────────────────────────────────
async function start() {
  try {
    await getPool();
    await stockService.ensureHistorialTable();
    await backupScheduler.init();

    app.listen(config.port, '0.0.0.0', () => {
      if (isPkg) process.stdout.write('\x1bc');
      serverBanner();
    });
  } catch (err) {
    console.log('');
    console.log(`${S.rd}${S.b}  ✖ Error al iniciar el servidor${S.r}`);
    console.log(`${S.rd}  ${err}${S.r}`);
    console.log('');
    await waitForKey();
    process.exit(1);
  }
}

// ── Graceful shutdown ────────────────────────────────
process.on('SIGINT', async () => {
  console.log('');
  console.log(`${S.gold}  ■ Cerrando servidor...${S.r}`);
  await closePool();
  console.log(`${S.dim}  Servidor detenido.${S.r}`);
  console.log('');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log(`${S.gold}  ■ Cerrando servidor...${S.r}`);
  await closePool();
  process.exit(0);
});

// ── Catch unexpected crashes ─────────────────────────
process.on('uncaughtException', async (err) => {
  console.log('');
  console.log(`${S.rd}${S.b}  ✖ Error inesperado${S.r}`);
  console.log(`${S.rd}  ${err.message}${S.r}`);
  console.log('');
  await waitForKey();
  process.exit(1);
});

start();
