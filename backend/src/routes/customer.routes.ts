import { Router, Request, Response } from 'express';
import { customerService } from '../services/customer.service.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware);

// GET /api/customers
router.get('/', async (req: Request, res: Response) => {
  try {
    const result = await customerService.getAll({
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
      search: req.query.search as string | undefined,
      activo: req.query.activo !== undefined ? req.query.activo === 'true' : undefined,
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/customers/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const customer = await customerService.getById(parseInt(req.params.id as string));
    res.json(customer);
  } catch (err: any) {
    const status = err.name === 'ValidationError' ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/customers/:id/cta-corriente
router.get('/:id/cta-corriente', async (req: Request, res: Response) => {
  try {
    const saldo = await customerService.getCtaCorrienteSaldo(parseInt(req.params.id as string));
    res.json(saldo);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
