import { Router, Response } from 'express';
import { libroIvaComprasService } from '../services/libroIvaCompras.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// ── GET /api/libro-iva-compras/comprobantes ───────
router.get('/comprobantes', async (req: AuthRequest, res: Response) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaId, tipoComprobante, incluirNoCobradas } = req.query;
    if (!fechaDesde || !fechaHasta) {
      res.status(400).json({ error: 'Se requieren fechaDesde y fechaHasta' });
      return;
    }
    const data = await libroIvaComprasService.getComprobantes({
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

// ── GET /api/libro-iva-compras/totales ────────────
router.get('/totales', async (req: AuthRequest, res: Response) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaId, tipoComprobante, incluirNoCobradas } = req.query;
    if (!fechaDesde || !fechaHasta) {
      res.status(400).json({ error: 'Se requieren fechaDesde y fechaHasta' });
      return;
    }
    const data = await libroIvaComprasService.getTotales({
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

// ── GET /api/libro-iva-compras/alicuotas ──────────
router.get('/alicuotas', async (req: AuthRequest, res: Response) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaId, tipoComprobante, incluirNoCobradas } = req.query;
    if (!fechaDesde || !fechaHasta) {
      res.status(400).json({ error: 'Se requieren fechaDesde y fechaHasta' });
      return;
    }
    const data = await libroIvaComprasService.getTotalesPorAlicuota({
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

// ── GET /api/libro-iva-compras/puntos-venta ───────
router.get('/puntos-venta', async (_req: AuthRequest, res: Response) => {
  try {
    const data = await libroIvaComprasService.getPuntosDeVenta();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/libro-iva-compras/export-citi ────────
router.get('/export-citi', async (req: AuthRequest, res: Response) => {
  try {
    const { fechaDesde, fechaHasta, puntoVentaId, tipoComprobante, incluirNoCobradas } = req.query;
    if (!fechaDesde || !fechaHasta) {
      res.status(400).json({ error: 'Se requieren fechaDesde y fechaHasta' });
      return;
    }
    const data = await libroIvaComprasService.exportCitiCompras({
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
