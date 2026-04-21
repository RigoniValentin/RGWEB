import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { mobileController } from './mobile.controller.js';
import { PENDING_UPLOADS_DIR, mobileService } from '../services/mobile.service.js';
import { authService } from '../services/auth.service.js';

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

export default router;
