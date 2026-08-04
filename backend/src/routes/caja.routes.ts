import { Router, Response, NextFunction } from 'express';
import { cajaService } from '../services/caja.service.js';
import { salesService } from '../services/sales.service.js';
import { AuthRequest, authMiddleware, requirePermiso, loadUserPermisos } from '../middleware/auth.js';

const router = Router();
router.use(authMiddleware as any);

// ════════════════════════════════════════════════════════════════
//  ABM DE CAJAS PERSISTENTES
// ════════════════════════════════════════════════════════════════

// ── GET /api/caja/cajas — listar cajas persistentes ──
router.get('/cajas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvIds = req.query.puntoVentaIds
      ? String(req.query.puntoVentaIds).split(',').map(Number).filter(n => !isNaN(n))
      : undefined;
    const activa = req.query.activa !== undefined ? req.query.activa === 'true' : undefined;
    const usuarioId = req.query.usuarioId ? Number(req.query.usuarioId) : undefined;
    const result = await cajaService.listarCajas({ puntoVentaIds: pvIds, activa, usuarioId });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/caja/cajas/:id — detalle de caja persistente ──
router.get('/cajas/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const caja = await cajaService.getCajaById(Number(req.params.id));
    if (!caja) { res.status(404).json({ error: 'Caja no encontrada' }); return; }
    res.json(caja);
  } catch (err) { next(err); }
});

// ── POST /api/caja/cajas — crear caja persistente ──
router.post('/cajas', requirePermiso('caja.administrar'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.crearCaja(req.body, req.user!.id);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── PUT /api/caja/cajas/:id — editar caja ──
router.put('/cajas/:id', requirePermiso('caja.administrar'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.editarCaja(Number(req.params.id), req.body);
    res.json(result);
  } catch (err) { next(err); }
});

// ── POST /api/caja/cajas/:id/usuarios — asignar usuarios ──
router.post('/cajas/:id/usuarios', requirePermiso('caja.administrar'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const usuariosIds: number[] = req.body.usuariosIds || [];
    const result = await cajaService.asignarUsuarios(Number(req.params.id), usuariosIds);
    res.json(result);
  } catch (err) { next(err); }
});

// ── DELETE /api/caja/cajas/:id/usuarios/:usuarioId — quitar usuario ──
router.delete('/cajas/:id/usuarios/:usuarioId', requirePermiso('caja.administrar'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.quitarUsuario(Number(req.params.id), Number(req.params.usuarioId));
    res.json(result);
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
//  SESIONES
// ════════════════════════════════════════════════════════════════

// ── GET /api/caja/sesiones — listar sesiones (historial) ──
router.get('/sesiones', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, fechaDesde, fechaHasta, estado, cajaId, usuarioId, puntoVentaIds } = req.query;
    const pvIds = puntoVentaIds
      ? String(puntoVentaIds).split(',').map(Number).filter(n => !isNaN(n))
      : undefined;

    let usuarioIdFilter: number | undefined = usuarioId ? Number(usuarioId) : undefined;
    const perms = await loadUserPermisos(req);
    if (perms && !perms.includes('caja.central.ver')) {
      usuarioIdFilter = req.user!.id;
    }

    const result = await cajaService.getSesiones({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      fechaDesde: fechaDesde as string | undefined,
      fechaHasta: fechaHasta as string | undefined,
      estado: estado as string | undefined,
      cajaId: cajaId ? Number(cajaId) : undefined,
      usuarioId: usuarioIdFilter,
      puntoVentaIds: pvIds,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/caja/sesiones/:id — detalle de sesión ──
router.get('/sesiones/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sesion = await cajaService.getSesionById(Number(req.params.id));
    if (!sesion) { res.status(404).json({ error: 'Sesión no encontrada' }); return; }
    res.json(sesion);
  } catch (err) { next(err); }
});

// ── GET /api/caja/mis-cajas — cajas asignadas al usuario actual ──
router.get('/mis-cajas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const cajas = await cajaService.getMisCajas(req.user!.id);
    res.json(cajas);
  } catch (err) { next(err); }
});

// ── GET /api/caja/mi-sesion-activa — sesión activa del usuario actual ──
router.get('/mi-sesion-activa', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sesion = await cajaService.getMiSesionActiva(req.user!.id);
    res.json(sesion);
  } catch (err) { next(err); }
});

// ── POST /api/caja/sesiones/abrir — abrir sesión ──
router.post('/sesiones/abrir', requirePermiso('caja.abrir'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.abrirSesion(req.user!.id, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── POST /api/caja/sesiones/:id/cerrar — cerrar sesión ──
router.post('/sesiones/:id/cerrar', requirePermiso('caja.cerrar'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.cerrarSesion(req.user!.id, Number(req.params.id), req.body);
    res.json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════
//  TRANSFERENCIA CC ↔ CAJA DIRECTA
// ════════════════════════════════════════════════════════════════

// ── POST /api/caja/transferir — transferencia directa CC ↔ Caja ──
// Permisos:
//   - Con sesión activa: `caja.abrir` es suficiente.
//   - Sin sesión activa (retiro de retenido): se exige además `caja.administrar`.
// La validación fina del permiso adicional se hace dentro del service.
router.post('/transferir', requirePermiso('caja.abrir'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.transferir(req.user!.id, req.body, req.user!._permisos ?? null);
    res.status(201).json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ════════════════════════════════════════════════════════════════
//  LISTADOS AUXILIARES (para selector de transferencias)
// ════════════════════════════════════════════════════════════════

// ── GET /api/caja/cajas-con-saldo — cajas activas con retenido y sesión ──
router.get('/cajas-con-saldo', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const cajas = await cajaService.getCajasConSaldo(pvId);
    res.json(cajas);
  } catch (err) { next(err); }
});

// ── GET /api/caja/sesiones-activas — sesiones activas de un PV ──
router.get('/sesiones-activas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const sesiones = await cajaService.getSesionesActivas(pvId);
    res.json(sesiones);
  } catch (err) { next(err); }
});

// ── GET /api/caja/efectivo-caja-central — CC efectivo (excluye internos) ──
router.get('/efectivo-caja-central', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const efectivo = await cajaService.getEfectivoCajaCentral(pvId);
    res.json({ efectivo });
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
//  INGRESO / EGRESO MANUAL (sobre sesión activa)
// ════════════════════════════════════════════════════════════════

// ── POST /api/caja/sesiones/:id/ingreso-egreso — add IE a sesión activa ──
router.post('/sesiones/:id/ingreso-egreso', async (req: AuthRequest, res: Response, next: NextFunction) => {
  const tipo: string = (req.body.TIPO || req.body.tipo || '').toUpperCase();
  const llave = tipo === 'EGRESO' ? 'caja.egreso' : 'caja.ingreso';
  return requirePermiso(llave)(req, res, async () => {
    try {
      const result = await cajaService.addIngresoEgreso(Number(req.params.id), req.body, req.user!.id);
      res.status(201).json(result);
    } catch (err: any) {
      if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
      next(err);
    }
  });
});

// ── DELETE /api/caja/sesiones/:sesionId/items/:itemId — eliminar IE manual ──
router.delete('/sesiones/:sesionId/items/:itemId', requirePermiso('caja.ingreso', 'caja.egreso'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await cajaService.deleteItem(Number(req.params.sesionId), Number(req.params.itemId));
    res.json(result);
  } catch (err: any) {
    if (err.name === 'ValidationError') { res.status(err.status || 400).json({ error: err.message }); return; }
    next(err);
  }
});

// ── GET /api/caja/desglose-item/:origenTipo/:origenId?categoria=... — desglose métodos de pago ──
router.get('/desglose-item/:origenTipo/:origenId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const categoria = req.query.categoria as 'EFECTIVO' | 'DIGITAL' | undefined;
    const data = await cajaService.getDesgloseItem(
      req.params.origenTipo as string,
      Number(req.params.origenId),
      categoria === 'EFECTIVO' || categoria === 'DIGITAL' ? categoria : undefined
    );
    res.json(data);
  } catch (err) { next(err); }
});

// ════════════════════════════════════════════════════════════════
//  ENDPOINTS LEGACY (compatibilidad: listado original, mantener por ahora)
// ════════════════════════════════════════════════════════════════

// ── GET /api/caja — listar sesiones (compatibilidad con UI legacy) ──
// Auto-scope: no-admin ve sólo sus propias sesiones
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, fechaDesde, fechaHasta, estado, puntoVentaIds } = req.query;
    const pvIds = puntoVentaIds
      ? String(puntoVentaIds).split(',').map(Number).filter(n => !isNaN(n))
      : undefined;

    let usuarioId: number | undefined;
    const perms = await loadUserPermisos(req);
    if (perms && !perms.includes('caja.central.ver')) {
      usuarioId = req.user!.id;
    }

    const result = await cajaService.getSesiones({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      fechaDesde: fechaDesde as string | undefined,
      fechaHasta: fechaHasta as string | undefined,
      estado: estado as string | undefined,
      puntoVentaIds: pvIds,
      usuarioId,
    });
    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/caja/mi-caja — alias de mi-sesion-activa (compatibilidad) ──
router.get('/mi-caja', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sesion = await cajaService.getMiSesionActiva(req.user!.id);
    res.json(sesion);
  } catch (err) { next(err); }
});

// ── GET /api/caja/cajas-abiertas — sesiones activas (compatibilidad) ──
router.get('/cajas-abiertas', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const pvId = req.query.puntoVentaId ? Number(req.query.puntoVentaId) : undefined;
    const sesiones = await cajaService.getSesionesActivas(pvId);
    res.json(sesiones);
  } catch (err) { next(err); }
});

// ── GET /api/caja/:id — detalle de sesión (compatibilidad) ──
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const sesion = await cajaService.getSesionById(Number(req.params.id));
    if (!sesion) { res.status(404).json({ error: 'Sesión no encontrada' }); return; }

    const perms = await loadUserPermisos(req);
    if (perms && !perms.includes('caja.central.ver') && sesion.USUARIO_ID !== req.user!.id) {
      res.status(403).json({ error: 'No tiene permiso para ver esta sesión' });
      return;
    }

    res.json(sesion);
  } catch (err) { next(err); }
});

// ── GET /api/caja/:id/desglose-metodos — desglose de sesión ──
router.get('/:id/desglose-metodos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = await salesService.getDesgloseMetodosCaja(Number(req.params.id));
    res.json(data);
  } catch (err) { next(err); }
});

export default router;
