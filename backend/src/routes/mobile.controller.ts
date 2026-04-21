import { Request, Response, NextFunction } from 'express';
import { mobileService } from '../services/mobile.service.js';

// ═══════════════════════════════════════════════════
//  Mobile Controller — endpoints consumidos por la
//  app mobile de control de stock (escaneo barcode).
// ═══════════════════════════════════════════════════

export const mobileController = {
  // GET /api/mobile/products/:barcode
  async getByBarcode(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const barcode = String(req.params.barcode || '').trim();
      if (!barcode) {
        res.status(400).json({ error: 'Código de barras requerido' });
        return;
      }

      const product = await mobileService.findByBarcode(barcode);
      if (!product) {
        res.status(404).json({ error: 'Producto no encontrado', barcode });
        return;
      }
      res.status(200).json(product);
    } catch (err) {
      next(err);
    }
  },

  // PATCH /api/mobile/products/:barcode/stock   body: { quantity: number }
  async patchStock(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const barcode = String(req.params.barcode || '').trim();
      if (!barcode) {
        res.status(400).json({ error: 'Código de barras requerido' });
        return;
      }

      const rawQty = (req.body ?? {}).quantity;
      const quantity = Number(rawQty);
      if (rawQty === undefined || rawQty === null || !Number.isFinite(quantity)) {
        res.status(400).json({ error: 'El campo "quantity" es requerido y debe ser numérico' });
        return;
      }

      const result = await mobileService.addStockByBarcode(barcode, quantity);
      res.status(200).json({
        barcode,
        productoId: result.productoId,
        stock: result.stock,
      });
    } catch (err: any) {
      if (err?.name === 'NotFoundError') {
        res.status(404).json({ error: err.message, barcode: req.params.barcode });
        return;
      }
      if (err?.name === 'ValidationError') {
        res.status(400).json({ error: err.message });
        return;
      }
      next(err);
    }
  },

  // POST /api/mobile/products/pending   FormData: barcode, image(file)
  async postPending(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const barcode = String((req.body ?? {}).barcode || '').trim();
      const file = (req as Request & { file?: Express.Multer.File }).file;

      if (!barcode) {
        res.status(400).json({ error: 'El campo "barcode" es requerido' });
        return;
      }
      if (!file) {
        res.status(400).json({ error: 'El archivo "image" es requerido' });
        return;
      }

      // Ruta relativa al proyecto para almacenar / servir luego
      const relativePath = `uploads/pending/${file.filename}`;
      const entry = mobileService.registerPending(barcode, relativePath);

      res.status(201).json({
        ok: true,
        pending: entry,
      });
    } catch (err) {
      next(err);
    }
  },
};
