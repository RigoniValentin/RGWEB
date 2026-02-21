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

export default router;
