import { Router } from 'express';
import authRoutes from './auth.routes.js';
import productRoutes from './product.routes.js';
import customerRoutes from './customer.routes.js';
import salesRoutes from './sales.routes.js';
import supplierRoutes from './supplier.routes.js';
import catalogRoutes from './catalog.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import cajaRoutes from './caja.routes.js';
import cajaCentralRoutes from './cajaCentral.routes.js';
import depositRoutes from './deposit.routes.js';
import categoryRoutes from './category.routes.js';
import brandRoutes from './brand.routes.js';
import ctaCorrienteRoutes from './ctaCorriente.routes.js';
import ctaCorrienteProvRoutes from './ctaCorrienteProv.routes.js';
import purchasesRoutes from './purchases.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/products', productRoutes);
router.use('/customers', customerRoutes);
router.use('/sales', salesRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/catalog', catalogRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/caja', cajaRoutes);
router.use('/caja-central', cajaCentralRoutes);
router.use('/deposits', depositRoutes);
router.use('/categories', categoryRoutes);
router.use('/brands', brandRoutes);
router.use('/cta-corriente', ctaCorrienteRoutes);
router.use('/cta-corriente-prov', ctaCorrienteProvRoutes);
router.use('/purchases', purchasesRoutes);

export default router;
