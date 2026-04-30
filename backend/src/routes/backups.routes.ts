import { Router, Response } from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { authMiddleware, requirePermiso, AuthRequest } from '../middleware/auth.js';
import { backupService } from '../services/backup.service.js';
import { backupScheduler } from '../services/backupScheduler.service.js';
import { rootDir } from '../config/paths.js';
import { config as appConfig } from '../config/index.js';

const router = Router();

router.use(authMiddleware);

// ── Multer para upload de archivos .bak ─────────────────────────────────
const RESTORE_TMP_DIR = path.join(rootDir, 'backups', '_restore_uploads');
if (!fs.existsSync(RESTORE_TMP_DIR)) fs.mkdirSync(RESTORE_TMP_DIR, { recursive: true });

const restoreUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, RESTORE_TMP_DIR),
    filename: (_req, file, cb) => {
      const safe = (file.originalname || 'upload.bak').replace(/[^A-Za-z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB
  fileFilter: (_req, file, cb) => {
    if (!/\.bak$/i.test(file.originalname)) {
      cb(new Error('Solo se permiten archivos .bak'));
      return;
    }
    cb(null, true);
  },
});

// ── GET /api/backups — historial ────────────────────────────────────────
router.get('/', requirePermiso('backups.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const list = await backupService.getHistory(limit);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/backups/config ─────────────────────────────────────────────
router.get('/config', requirePermiso('backups.administrar'), async (_req: AuthRequest, res: Response) => {
  try {
    const cfg = await backupService.getConfig();
    res.json(cfg);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT /api/backups/config ─────────────────────────────────────────────
router.put('/config', requirePermiso('backups.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const cfg = await backupService.updateConfig(req.body || {});
    // Reprogramar cron
    await backupScheduler.reload();
    res.json(cfg);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /api/backups/run — backup manual ───────────────────────────────
router.post('/run', requirePermiso('backups.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const rec = await backupService.runBackup({
      tipo: 'MANUAL',
      usuarioId: req.user!.id,
      usuarioNombre: req.user!.nombre,
    });
    res.json(rec);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/backups/:id/download — descargar .bak ──────────────────────
router.get('/:id/download', requirePermiso('backups.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const rec = await backupService.getById(id);
    if (!rec) { res.status(404).json({ error: 'Backup no encontrado' }); return; }
    if (rec.ESTADO !== 'OK') { res.status(400).json({ error: 'Backup no completado' }); return; }

    const resolved = path.resolve(rec.ARCHIVO_RUTA);
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ error: 'Archivo de backup no existe en disco' });
      return;
    }
    res.download(resolved, rec.ARCHIVO_NOMBRE);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/backups/:id/integrity — verificar archivo + hash ───────────
router.get('/:id/integrity', requirePermiso('backups.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const result = await backupService.checkIntegrity(id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/backups/:id ─────────────────────────────────────────────
router.delete('/:id', requirePermiso('backups.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    await backupService.deleteBackup(Number(req.params.id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/backups/retention — aplicar política manualmente ──────────
router.post('/retention', requirePermiso('backups.administrar'), async (_req: AuthRequest, res: Response) => {
  try {
    const result = await backupService.applyRetention();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  RESTORE
// ═══════════════════════════════════════════════════════════════════════

// ── GET /api/backups/restores — historial de restauraciones ─────────────
router.get('/restores', requirePermiso('backups.administrar'), async (_req: AuthRequest, res: Response) => {
  try {
    const list = await backupService.getRestoreHistory(50);
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/backups/:id/restore — restaurar desde el historial ────────
// El cliente debe enviar { confirm: <DB_NAME> } como protección extra.
router.post('/:id/restore', requirePermiso('backups.administrar'), async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const confirm = String(req.body?.confirm || '').trim();
    if (confirm !== appConfig.db.database) {
      res.status(400).json({
        error: `Confirmación inválida. Para restaurar debe enviar el nombre exacto de la base de datos: ${appConfig.db.database}`,
      });
      return;
    }

    const rec = await backupService.restoreFromHistorial({
      backupId: id,
      usuarioId: req.user!.id,
      usuarioNombre: req.user!.nombre,
    });
    res.json(rec);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/backups/restore-upload — subir .bak y restaurar ───────────
// multipart/form-data: file=<.bak>, confirm=<DB_NAME>
router.post(
  '/restore-upload',
  requirePermiso('backups.administrar'),
  restoreUpload.single('file'),
  async (req: AuthRequest, res: Response) => {
    const uploaded = req.file;
    try {
      if (!uploaded) {
        res.status(400).json({ error: 'No se recibió el archivo' });
        return;
      }

      // Verificar que multer realmente escribió el archivo
      if (!fs.existsSync(uploaded.path)) {
        console.error('[restore-upload] multer reportó archivo pero no existe en disco:', uploaded.path);
        res.status(500).json({ error: 'El archivo subido no se pudo guardar en disco' });
        return;
      }
      const stats = fs.statSync(uploaded.path);
      console.log(`[restore-upload] archivo recibido: ${uploaded.path} (${stats.size} bytes, original: ${uploaded.originalname})`);

      const confirm = String(req.body?.confirm || '').trim();
      if (confirm !== appConfig.db.database) {
        try { fs.unlinkSync(uploaded.path); } catch { /* ignore */ }
        res.status(400).json({
          error: `Confirmación inválida. Para restaurar debe enviar el nombre exacto de la base de datos: ${appConfig.db.database}`,
        });
        return;
      }

      const rec = await backupService.restoreFromFile({
        filePath: uploaded.path,
        fileName: uploaded.originalname,
        origen: 'UPLOAD',
        backupId: null,
        usuarioId: req.user!.id,
        usuarioNombre: req.user!.nombre,
      });

      try { fs.unlinkSync(uploaded.path); } catch { /* ignore */ }

      res.json(rec);
    } catch (err: any) {
      console.error('[restore-upload] error:', err);
      if (uploaded?.path) {
        try { fs.unlinkSync(uploaded.path); } catch { /* ignore */ }
      }
      res.status(500).json({ error: err.message });
    }
  }
);

// ── GET /api/backups/inspect-upload — devuelve metadata de un .bak subido ──
// (No restaura, sólo lee el header). El archivo se borra después.
router.post(
  '/inspect-upload',
  requirePermiso('backups.administrar'),
  restoreUpload.single('file'),
  async (req: AuthRequest, res: Response) => {
    const uploaded = req.file;
    try {
      if (!uploaded) {
        res.status(400).json({ error: 'No se recibió el archivo' });
        return;
      }
      const meta = await backupService.inspectBackupFile(uploaded.path);
      res.json(meta);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    } finally {
      if (uploaded?.path) {
        try { fs.unlinkSync(uploaded.path); } catch { /* ignore */ }
      }
    }
  }
);

export default router;
