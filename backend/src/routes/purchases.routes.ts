import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { purchasesService } from '../services/purchases.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { purchaseReceiptService } from '../services/purchaseReceipt.service.js';
import { purchaseReceiptMatcher } from '../services/purchaseReceipt.matcher.js';
import { rootDir } from '../config/paths.js';

const router = Router();
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════════════════
//  AI Receipt Parsing — upload a /uploads/comprobantes/<YYYY-MM>/
// ═══════════════════════════════════════════════════════════════════════════
const RECEIPT_DIR = path.join(rootDir, 'uploads', 'comprobantes');

function ensureReceiptMonthDir(): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dir = path.join(RECEIPT_DIR, ym);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureReceiptMonthDir()),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '').toLowerCase() || '.jpg').replace(/[^.]/g, '');
      const safeExt = /^\.(jpe?g|png|webp|heic)$/i.test(ext) ? ext : '.jpg';
      const stamp = Date.now();
      const hash = crypto.randomBytes(4).toString('hex');
      const usuarioId = (req as AuthRequest).user?.id || 'anon';
      cb(null, `${usuarioId}_${stamp}_${hash}${safeExt}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic)$/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Sólo se permiten imágenes (jpeg, png, webp, heic).'));
  },
});

// GET /api/purchases
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await purchasesService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      search: req.query.search as string | undefined,
      fechaDesde: req.query.fechaDesde as string | undefined,
      fechaHasta: req.query.fechaHasta as string | undefined,
      proveedorId: req.query.proveedorId ? parseInt(req.query.proveedorId as string) : undefined,
      cobrada: req.query.cobrada !== undefined ? req.query.cobrada === 'true' : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/proveedores  (before :id to avoid conflict)
router.get('/proveedores', async (_req: Request, res: Response) => {
  try {
    const data = await purchasesService.getProveedores();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/depositos
router.get('/depositos', async (_req: Request, res: Response) => {
  try {
    const data = await purchasesService.getDepositos();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/active-payment-methods
router.get('/active-payment-methods', async (_req: Request, res: Response) => {
  try {
    const data = await purchasesService.getActivePaymentMethods();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/price-check/:compraId
router.get('/price-check/:compraId', async (req: Request, res: Response) => {
  try {
    const compraId = parseInt(req.params.compraId as string);
    const data = await purchasesService.getPriceCheckData(compraId);
    res.json(data);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/purchases/price-check
router.post('/price-check', async (req: Request, res: Response) => {
  try {
    const result = await purchasesService.savePriceCheck(req.body.updates || []);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/saldo-cta-cte/:proveedorId
router.get('/saldo-cta-cte/:proveedorId', async (req: Request, res: Response) => {
  try {
    const proveedorId = parseInt(req.params.proveedorId as string);
    const data = await purchasesService.getSaldoCtaCteP(proveedorId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/search-products
router.get('/search-products', async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;
    if (!search || search.length < 1) {
      res.json([]);
      return;
    }
    const limit = parseInt(req.query.limit as string) || 20;
    const data = await purchasesService.searchProducts(search, limit);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/purchases/search-products-advanced
router.get('/search-products-advanced', async (req: Request, res: Response) => {
  try {
    const data = await purchasesService.searchProductsAdvanced({
      search: req.query.search as string,
      marca: req.query.marca as string,
      categoria: req.query.categoria as string,
      codigo: req.query.codigo as string,
      soloActivos: req.query.soloActivos !== 'false',
      soloConStock: req.query.soloConStock === 'true',
      limit: parseInt(req.query.limit as string) || 50,
      busquedaMultiEntidad: req.query.busquedaMultiEntidad === 'true',
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/purchases/parse-image ─────────────────────────────────────
// Recibe multipart con campo "image", persiste en /uploads/comprobantes/
// y devuelve el JSON estructurado del comprobante + matches sugeridos con
// proveedores/productos existentes. La imagen queda viva hasta que el
// usuario confirme la compra (o hasta el DELETE explícito).
router.post('/parse-image', receiptUpload.single('image'), async (req: AuthRequest, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No se recibió ninguna imagen (campo "image").' });
    return;
  }
  const usuarioId = req.user?.id;
  // Proveedor pre-seleccionado por el usuario desde el modal padre. Si
  // viene, el matcher prioriza PRODUCTOS_PROVEEDORES.CODIGO_PROVEEDOR contra
  // ese proveedor aunque la IA no haya podido detectarlo por CUIT/razón
  // social. La detección por IA sigue corriendo en paralelo para devolver
  // `proveedor_match` (informativo).
  const proveedorIdHint = req.body?.proveedorId
    ? parseInt(String(req.body.proveedorId), 10)
    : null;
  const filePath = req.file.path;
  const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const publicUrl = `/uploads/${relativePath.split('/').slice(-2).join('/')}`;

  try {
    const { parsed, usage } = await purchaseReceiptService.parseReceiptFromImage(filePath);
    const enriched = await purchaseReceiptMatcher.enrichParsedReceipt(parsed, Number.isFinite(proveedorIdHint) ? proveedorIdHint : null);
    const tipoInterno = purchaseReceiptService.mapTipoComprobante(parsed.comprobante.tipo_comprobante);

    res.json({
      ok: true,
      saved_path: relativePath,
      public_url: publicUrl,
      tipo_comprobante_interno: tipoInterno,
      comprobante: enriched.comprobante,
      items: enriched.items,
      totales: enriched.totales,
      proveedor_match: enriched.proveedor_match,
      proveedores_candidatos: enriched.proveedores_candidatos,
      usage,
    });
  } catch (err: any) {
    // Limpieza ante fallo para no acumular basura.
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    const status = /OPENAI_API_KEY|parseable|Cannot read/.test(err?.message || '') ? 400 : 500;
    console.error(`[parse-image] ERROR usuario=${usuarioId} msg=${err?.message}`);
    res.status(status).json({ error: err?.message ?? 'Error al procesar el comprobante' });
  }
});

// ── DELETE /api/purchases/parse-image/:folder/:filename ────────────────
// Borra una imagen previamente guardada por /parse-image. Se llama cuando
// el usuario cancela el modal de revisión o no se llegó a confirmar la compra.
// Valida que la ruta quede dentro de RECEIPT_DIR para evitar path traversal.
router.delete('/parse-image/:folder/:filename', async (req: AuthRequest, res: Response) => {
  try {
    const folder = String(req.params.folder || '');
    const filename = String(req.params.filename || '');
    if (!/^\d{4}-\d{2}$/.test(folder) || !/^[A-Za-z0-9_-]+\.(jpe?g|png|webp|heic)$/i.test(filename)) {
      res.status(400).json({ error: 'Parámetros inválidos' });
      return;
    }
    const target = path.resolve(RECEIPT_DIR, folder, filename);
    const base = path.resolve(RECEIPT_DIR);
    if (!target.startsWith(base + path.sep)) {
      res.status(400).json({ error: 'Ruta inválida' });
      return;
    }
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// GET /api/purchases/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const purchase = await purchasesService.getById(parseInt(req.params.id as string));
    res.json(purchase);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/purchases
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    const body = req.body;
    const result = await purchasesService.create(body, usuarioId);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// PUT /api/purchases/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    const result = await purchasesService.update(parseInt(req.params.id as string), req.body, usuarioId);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/purchases/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      res.status(401).json({ error: 'Usuario no autenticado' });
      return;
    }
    const result = await purchasesService.delete(parseInt(req.params.id as string), usuarioId);
    res.json(result);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;
