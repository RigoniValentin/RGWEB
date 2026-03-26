import { Router, Request, Response } from 'express';
import { dashboardService } from '../services/dashboard.service.js';
import { authMiddleware } from '../middleware/auth.js';

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
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(logo.data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
