import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { config } from './config/index.js';
import { getPool, closePool } from './database/connection.js';
import { errorHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

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

// ── Serve frontend in production ─────────────────────
if (config.nodeEnv === 'production') {
  const frontendPath = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// ── Error handling ───────────────────────────────────
app.use(errorHandler);

// ── Start server ─────────────────────────────────────
async function start() {
  try {
    // Test DB connection
    await getPool();

    app.listen(config.port, () => {
      console.log(`\n🚀 RG ERP Server running at http://localhost:${config.port}`);
      console.log(`   Environment: ${config.nodeEnv}`);
      console.log(`   Database: ${config.db.server}/${config.db.database}\n`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

// ── Graceful shutdown ────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closePool();
  process.exit(0);
});

start();
