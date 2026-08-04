import { Router, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import { mobileController } from './mobile.controller.js';
import { PENDING_UPLOADS_DIR, mobileService } from '../services/mobile.service.js';
import { authService } from '../services/auth.service.js';
import { mobileAuthMiddleware, MobileAuthRequest } from '../middleware/mobileAuth.js';
import { cajaService } from '../services/caja.service.js';
import { aiService, ChatMessage } from '../services/ai.service.js';
import { remitosService } from '../services/remitos.service.js';
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

// ── GET /api/mobile/caja/mi-caja — detalle completo de la sesión activa ──
// Acepta JWT o API key de device mobile registrado.
router.get('/caja/mi-caja', mobileAuthMiddleware as any, async (req: MobileAuthRequest, res: Response, next: NextFunction) => {
  try {
    const sesion = await cajaService.getMiSesionActiva(req.user!.id);
    if (!sesion) {
      res.json(null);
      return;
    }

    const detail = await cajaService.getSesionById(sesion.SESION_ID);
    if (!detail) {
      res.json(null);
      return;
    }

    // Mapear al formato PrintCajaData que usa el PDF
    res.json({
      cajaId: detail.SESION_ID,
      estado: detail.ESTADO,
      usuarioNombre: detail.USUARIO_NOMBRE ?? '',
      puntoVentaNombre: detail.PUNTO_VENTA_NOMBRE ?? '',
      fechaApertura: detail.FECHA_APERTURA,
      fechaCierre: detail.FECHA_CIERRE ?? null,
      montoApertura: detail.MONTO_APERTURA ?? 0,
      montoCierre: detail.MONTO_CIERRE ?? null,
      observaciones: detail.OBS_CIERRE ?? null,
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
router.post('/ai/chat', mobileAuthMiddleware as any, async (req: MobileAuthRequest, res: Response, next: NextFunction) => {
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

// ═══════════════════════════════════════════════════════════════
//  Remitos desde Mobile — Recepción de mercadería en depósito
//  Todos requieren JWT (login del operador mobile) y delegan a
//  remitosService para reusar toda la lógica de stock/auditoría.
// ═══════════════════════════════════════════════════════════════

// GET /api/mobile/remitos/proveedores — proveedores activos para picker
router.get('/remitos/proveedores', mobileAuthMiddleware as any, async (_req: MobileAuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await remitosService.getProveedores();
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/mobile/remitos/depositos — depósitos para picker
router.get('/remitos/depositos', mobileAuthMiddleware as any, async (_req: MobileAuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await remitosService.getDepositos();
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/mobile/remitos/search-products?search=...&limit=20 — búsqueda de productos
router.get('/remitos/search-products', mobileAuthMiddleware as any, async (req: MobileAuthRequest, res: Response, next: NextFunction) => {
  try {
    const search = (req.query.search as string) || '';
    const limit = parseInt(req.query.limit as string) || 20;
    if (!search.trim()) {
      res.json([]);
      return;
    }
    const data = await remitosService.searchProducts(search, limit);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/mobile/remitos — crear remito de entrada (TIPO forzado, PENDIENTE sin stock)
router.post('/remitos', mobileAuthMiddleware as any, async (req: MobileAuthRequest, res: Response, next: NextFunction) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    // Forzar TIPO='ENTRADA', ESTADO='PENDIENTE' y ORIGEN='MOBILE'.
    // El stock NO se aplica hasta que se confirme desde RG WEB.
    const input = {
      ...req.body,
      TIPO: 'ENTRADA' as const,
      ESTADO: 'PENDIENTE' as const,
      ORIGEN: 'MOBILE' as const,
    };
    const result = await remitosService.create(input, usuarioId);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err?.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err?.message ?? 'Error al crear el remito' });
  }
});

// GET /api/mobile/remitos/:id — detalle del remito recién creado (para generar PDF)
router.get('/remitos/:id', mobileAuthMiddleware as any, async (req: MobileAuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id as string);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: 'ID de remito inválido' });
      return;
    }
    const data = await remitosService.getById(id);
    res.json(data);
  } catch (err: any) {
    const status = err?.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err?.message ?? 'Error al obtener el remito' });
  }
});

// GET /api/mobile/remitos/empresa/data — datos fiscales para encabezado del PDF
router.get('/remitos/empresa/data', mobileAuthMiddleware as any, async (_req: MobileAuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await remitosService.getEmpresaData();
    res.json(data);
  } catch (err) { next(err); }
});

export default router;
