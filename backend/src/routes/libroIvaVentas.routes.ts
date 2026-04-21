import { Router, Response } from 'express';
import { libroIvaVentasService } from '../services/libroIvaVentas.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ── GET /api/libro-iva-ventas/comprobantes ────────
router.get('/comprobantes', async (req: AuthRequest, res: Response) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaId, tipoComprobante, incluirNoCobradas } = req.query;
    if (!fechaDesde || !fechaHasta) {
      res.status(400).json({ error: 'Se requieren fechaDesde y fechaHasta' });
      return;
    }
    const data = await libroIvaVentasService.getComprobantes({
      fechaDesde: fechaDesde as string,
      fechaHasta: fechaHasta as string,
      puntoVentaId: puntoVentaId ? Number(puntoVentaId) : undefined,
      tipoComprobante: (tipoComprobante as string) || undefined,
      incluirNoCobradas: incluirNoCobradas === 'true',
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/libro-iva-ventas/totales ─────────────
router.get('/totales', async (req: AuthRequest, res: Response) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaId, tipoComprobante, incluirNoCobradas } = req.query;
    if (!fechaDesde || !fechaHasta) {
      res.status(400).json({ error: 'Se requieren fechaDesde y fechaHasta' });
      return;
    }
    const data = await libroIvaVentasService.getTotales({
      fechaDesde: fechaDesde as string,
      fechaHasta: fechaHasta as string,
      puntoVentaId: puntoVentaId ? Number(puntoVentaId) : undefined,
      tipoComprobante: (tipoComprobante as string) || undefined,
      incluirNoCobradas: incluirNoCobradas === 'true',
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/libro-iva-ventas/alicuotas ───────────
router.get('/alicuotas', async (req: AuthRequest, res: Response) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaId, tipoComprobante, incluirNoCobradas } = req.query;
    if (!fechaDesde || !fechaHasta) {
      res.status(400).json({ error: 'Se requieren fechaDesde y fechaHasta' });
      return;
    }
    const data = await libroIvaVentasService.getTotalesPorAlicuota({
      fechaDesde: fechaDesde as string,
      fechaHasta: fechaHasta as string,
      puntoVentaId: puntoVentaId ? Number(puntoVentaId) : undefined,
      tipoComprobante: (tipoComprobante as string) || undefined,
      incluirNoCobradas: incluirNoCobradas === 'true',
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/libro-iva-ventas/puntos-venta ────────
router.get('/puntos-venta', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await libroIvaVentasService.getPuntosDeVenta();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/libro-iva-ventas/export-citi ─────────
router.get('/export-citi', async (req: AuthRequest, res: Response) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaId, tipoComprobante, incluirNoCobradas } = req.query;
    if (!fechaDesde || !fechaHasta) {
      res.status(400).json({ error: 'Se requieren fechaDesde y fechaHasta' });
      return;
    }
    const data = await libroIvaVentasService.exportCitiVentas({
      fechaDesde: fechaDesde as string,
      fechaHasta: fechaHasta as string,
      puntoVentaId: puntoVentaId ? Number(puntoVentaId) : undefined,
      tipoComprobante: (tipoComprobante as string) || undefined,
      incluirNoCobradas: incluirNoCobradas === 'true',
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
