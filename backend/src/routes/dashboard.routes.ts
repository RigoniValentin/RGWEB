import { Router, Request, Response } from 'express';
import { dashboardService } from '../services/dashboard.service.js';
import { authMiddleware, loadUserPermisos, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/dashboard/stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const puntoVentaId = req.query.puntoVentaId ? parseInt(req.query.puntoVentaId as string) : undefined;
    const stats = await dashboardService.getStats(puntoVentaId);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/ventas-por-dia
router.get('/ventas-por-dia', async (req: Request, res: Response) => {
  try {
    const dias = parseInt(req.query.dias as string) || 30;
    const puntoVentaId = req.query.puntoVentaId ? parseInt(req.query.puntoVentaId as string) : undefined;
    const data = await dashboardService.getVentasPorDia(dias, puntoVentaId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/desglose-hoy
router.get('/desglose-hoy', async (req: Request, res: Response) => {
  try {
    const puntoVentaId = req.query.puntoVentaId ? parseInt(req.query.puntoVentaId as string) : undefined;
    const data = await dashboardService.getDesgloseHoy(puntoVentaId);
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/logo
router.get('/logo', async (_req: Request, res: Response) => {
  try {
    const logo = await dashboardService.getLogo();
    if (!logo) {
      res.status(404).json({ error: 'Logo not found' });
      return;
    }
    res.set('Content-Type', logo.contentType);
    res.set('Cache-Control', 'no-store');
    res.send(logo.data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/analytics — unified data for redesigned dashboard
router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = (req.query.from as string) || today;
    const to = (req.query.to as string) || today;
    const granularityRaw = (req.query.granularity as string) || 'day';
    const granularity = (['hour', 'day', 'week', 'month'].includes(granularityRaw)
      ? granularityRaw
      : 'day') as 'hour' | 'day' | 'week' | 'month';
    const puntoVentaId = req.query.puntoVentaId
      ? parseInt(req.query.puntoVentaId as string)
      : undefined;
    const soloFiscal = req.query.soloFiscal === 'true';
    const data = await dashboardService.getAnalytics({ from, to, granularity, puntoVentaId, soloFiscal });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/cajeros-rendimiento — per-cashier KPIs for bonus / recognition
// - Usuarios con permiso `dashboard.rendimiento` pueden pasar cualquier `usuarioId`
//   (o ninguno = vista global) y elegir `puntoVentaId`.
// - Usuarios SIN ese permiso (ej. cajeros) sólo pueden ver sus propios datos:
//   el backend fuerza `usuarioId = req.user.id` ignorando cualquier valor enviado.
router.get('/cajeros-rendimiento', async (req: AuthRequest, res: Response) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const from = (req.query.from as string) || today;
    const to = (req.query.to as string) || today;

    const permisos = await loadUserPermisos(req);
    const hasGlobalAccess = !!permisos && permisos.includes('dashboard.rendimiento');

    let puntoVentaId: number | undefined;
    let usuarioId: number | undefined;
    let top: number | undefined;

    if (hasGlobalAccess) {
      puntoVentaId = req.query.puntoVentaId
        ? parseInt(req.query.puntoVentaId as string)
        : undefined;
      usuarioId = req.query.usuarioId
        ? parseInt(req.query.usuarioId as string)
        : undefined;
      top = req.query.top
        ? Math.max(1, Math.min(500, parseInt(req.query.top as string)))
        : undefined;
    } else {
      // Forzar self-only: ignorar cualquier usuarioId / puntoVentaId recibido
      usuarioId = req.user!.id;
    }

    const data = await dashboardService.getCajerosRendimiento({
      from, to, puntoVentaId, usuarioId, top,
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
