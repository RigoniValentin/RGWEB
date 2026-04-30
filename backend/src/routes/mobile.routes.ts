import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { mobileController } from './mobile.controller.js';
import { PENDING_UPLOADS_DIR, mobileService } from '../services/mobile.service.js';
import { authService } from '../services/auth.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { cajaService } from '../services/caja.service.js';
import { aiService, ChatMessage } from '../services/ai.service.js';
import { config } from '../config/index.js';

// ═══════════════════════════════════════════════════
//  Mobile Routes — sin authMiddleware JWT para que la
//  app mobile pueda consumirlos en la red local.
//  (Si más adelante se quiere proteger, aplicar aquí
//   un middleware de API-Key / token simple.)
// ═══════════════════════════════════════════════════

mobileService.ensureStorage();

// ── Multer: almacenamiento en uploads/pending ──────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    mobileService.ensureStorage();
    cb(null, PENDING_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const safeBarcode = String((req.body ?? {}).barcode || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    const stamp = Date.now();
    cb(null, `${safeBarcode}_${stamp}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\//i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Sólo se permiten archivos de imagen'));
  },
});

const router = Router();

// POST /api/mobile/login — login dedicado para la app mobile.
// Reutiliza authService.login (mismo esquema que /api/auth/login) pero
// devuelve sólo los campos que la app necesita.
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body ?? {};
    if (!username || !password) {
      res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
      return;
    }
    const result = await authService.login({ username, password });
    res.json({
      token: result.token,
      user: {
        id: result.user.USUARIO_ID,
        nombre: result.user.NOMBRE,
      },
      permisos: result.permisos,
    });
  } catch (err: any) {
    const status = err?.name === 'ValidationError' ? 401 : 500;
    res.status(status).json({ error: err?.message ?? 'Error de autenticación' });
  }
});

// GET /api/mobile/products/:barcode
router.get('/products/:barcode', mobileController.getByBarcode);

// PATCH /api/mobile/products/:barcode/stock
router.patch('/products/:barcode/stock', mobileController.patchStock);

// POST /api/mobile/products/pending   (multipart/form-data: barcode, image)
router.post('/products/pending', upload.single('image'), mobileController.postPending);

// GET /api/mobile/products/pending/list — utilitario para debug/admin
router.get('/products/pending/list', (_req, res) => {
  res.json(mobileService.listPending());
});

// Health check específico de la API mobile
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', scope: 'mobile', timestamp: new Date().toISOString() });
});

// ── GET /api/mobile/caja/mi-caja — detalle completo de la caja abierta ──
// Requiere JWT (el mismo token que el login mobile devuelve).
router.get('/caja/mi-caja', authMiddleware as any, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const caja = await cajaService.getCajaAbierta(req.user!.id);
    if (!caja) {
      res.json(null);
      return;
    }

    const detail = await cajaService.getById(caja.CAJA_ID);
    if (!detail) {
      res.json(null);
      return;
    }

    // Mapear al formato PrintCajaData que usa el PDF
    res.json({
      cajaId: detail.CAJA_ID,
      estado: detail.ESTADO,
      usuarioNombre: detail.USUARIO_NOMBRE ?? '',
      puntoVentaNombre: detail.PUNTO_VENTA_NOMBRE ?? '',
      fechaApertura: detail.FECHA_APERTURA,
      fechaCierre: detail.FECHA_CIERRE ?? null,
      montoApertura: detail.MONTO_APERTURA ?? 0,
      montoCierre: detail.MONTO_CIERRE ?? null,
      observaciones: detail.OBSERVACIONES ?? null,
      totales: detail.totales,
      items: (detail.items as any[]).map((i: any) => ({
        FECHA: i.FECHA,
        ORIGEN_TIPO: i.ORIGEN_TIPO,
        DESCRIPCION: i.DESCRIPCION ?? null,
        MONTO_EFECTIVO: i.MONTO_EFECTIVO ?? 0,
        MONTO_DIGITAL: i.MONTO_DIGITAL ?? 0,
      })),
    });
  } catch (err) { next(err); }
});

// ── POST /api/mobile/ai/chat — chat con asistente IA con acceso a la DB ──
router.post('/ai/chat', authMiddleware as any, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { messages } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Se requiere el campo "messages" con el historial' });
      return;
    }

    const history: ChatMessage[] = [];
    for (const m of messages) {
      if (!m || typeof m.content !== 'string') continue;
      if (m.role !== 'user' && m.role !== 'assistant') continue;
      history.push({ role: m.role, content: m.content });
    }
    if (history.length === 0) {
      res.status(400).json({ error: 'Historial de mensajes inválido' });
      return;
    }

    const userName = (req.user as any)?.nombre || (req.user as any)?.username || 'usuario';
    const businessName = (config as any)?.app?.nombreFantasia || 'Río Gestión';

    const result = await aiService.chat({ userName, businessName, history });
    res.json(result);
  } catch (err: any) {
    if (err?.message?.includes('OPENAI_API_KEY')) {
      res.status(503).json({ error: 'El asistente IA no está configurado. Contactá al administrador.' });
      return;
    }
    next(err);
  }
});

export default router;
