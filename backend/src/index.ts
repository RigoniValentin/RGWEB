import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config/index.js';
import { frontendDir, isPkg } from './config/paths.js';
import { getPool, closePool } from './database/connection.js';
import { errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

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
  console.log(`${S.dim}   Cerrar   →  Ctrl+C o cerrar esta ventana${R}`);
  console.log('');
  console.log(`${S.gy}   Esperando conexiones...${R}`);
  console.log('');
}

const app = express();

// ── Middleware ────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: config.nodeEnv === 'development'
    ? ['http://localhost:5173', 'http://localhost:3000']
    : false,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── API Routes ───────────────────────────────────────
app.use('/api', apiRoutes);

// ── Health check ─────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Serve frontend in production / packaged mode ────
import path from 'path';
if (config.nodeEnv === 'production' || isPkg) {
  app.use(express.static(frontendDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
  });
}

// ── Error handling ───────────────────────────────────
app.use(errorHandler);

// ── Start server ─────────────────────────────────────
async function start() {
  try {
    await getPool();

    app.listen(config.port, () => {
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
