import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth.js';
import { usuariosService } from '../services/usuarios.service.js';

const router = Router();
router.use(authMiddleware);

const ip  = (r: AuthRequest) => (r.headers['x-forwarded-for'] as string)?.split(',')[0] || r.socket?.remoteAddress;
const who = (r: AuthRequest) => ({ actorId: r.user!.id, actorNombre: r.user!.nombre, ip: ip(r) });

// ── Users ─────────────────────────────────────────────────────────────────────

// GET /api/usuarios
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { search, activo, rolId, puntoVentaId } = req.query as Record<string, string>;
    const data = await usuariosService.getAll({
      search: search || undefined,
      activo: activo !== undefined ? activo === 'true' : undefined,
      rolId: rolId ? Number(rolId) : undefined,
      puntoVentaId: puntoVentaId ? Number(puntoVentaId) : undefined,
    });
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/usuarios/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const data = await usuariosService.getById(Number(req.params.id));
    res.json(data);
  } catch (e: any) {
    res.status(e.name === 'ValidationError' ? 404 : 500).json({ error: e.message });
  }
});

// POST /api/usuarios
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { nombre, password, nombreCompleto, email, telefono, rolIds } = req.body;
    if (!nombre || !password) { res.status(400).json({ error: 'nombre y password son requeridos' }); return; }
    const { actorId, actorNombre, ip: ipAddr } = who(req);
    const result = await usuariosService.create({ nombre, password, nombreCompleto, email, telefono, rolIds }, actorId, actorNombre, ipAddr);
    res.status(201).json(result);
  } catch (e: any) {
    res.status(e.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

// PUT /api/usuarios/:id
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { actorId, actorNombre, ip: ipAddr } = who(req);
    const result = await usuariosService.update(Number(req.params.id), req.body, actorId, actorNombre, ipAddr);
    res.json(result);
  } catch (e: any) {
    res.status(e.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

// DELETE /api/usuarios/:id
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { actorId, actorNombre, ip: ipAddr } = who(req);
    await usuariosService.softDelete(Number(req.params.id), actorId, actorNombre, ipAddr);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// POST /api/usuarios/:id/bloqueo  { bloquear: true|false }
router.post('/:id/bloqueo', async (req: AuthRequest, res: Response) => {
  try {
    const { bloquear } = req.body;
    const { actorId, actorNombre, ip: ipAddr } = who(req);
    await usuariosService.toggleBloqueo(Number(req.params.id), !!bloquear, actorId, actorNombre, ipAddr);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/usuarios/:id/puntos-venta  { pvIds: number[], preferidoId?: number|null }
router.put('/:id/puntos-venta', async (req: AuthRequest, res: Response) => {
  try {
    const { pvIds, preferidoId } = req.body;
    if (!Array.isArray(pvIds)) { res.status(400).json({ error: 'pvIds debe ser un array' }); return; }
    const { actorId, actorNombre, ip: ipAddr } = who(req);
    await usuariosService.setPuntosVenta(
      Number(req.params.id), pvIds, preferidoId ?? null,
      actorId, actorNombre, ipAddr,
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/usuarios/:id/roles  { rolIds: number[] }
router.put('/:id/roles', async (req: AuthRequest, res: Response) => {
  try {
    const { rolIds } = req.body;
    if (!Array.isArray(rolIds)) { res.status(400).json({ error: 'rolIds debe ser un array' }); return; }
    const { actorId, actorNombre, ip: ipAddr } = who(req);
    await usuariosService.setRoles(Number(req.params.id), rolIds, actorId, actorNombre, ipAddr);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/usuarios/:id/permisos
router.get('/:id/permisos', async (req: AuthRequest, res: Response) => {
  try {
    const data = await usuariosService.getPermisosUsuario(Number(req.params.id));
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/usuarios/:id/permisos/:permisoId  { activo: true|false|null }
router.put('/:id/permisos/:permisoId', async (req: AuthRequest, res: Response) => {
  try {
    const { activo } = req.body; // null = remove override
    const { actorId, actorNombre } = who(req);
    await usuariosService.setPermisoOverride(
      Number(req.params.id), Number(req.params.permisoId),
      activo === null ? null : !!activo,
      actorId, actorNombre,
    );
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/usuarios/:id/permisos  — removes ALL individual overrides for a user
router.delete('/:id/permisos', async (req: AuthRequest, res: Response) => {
  try {
    const { actorId, actorNombre } = who(req);
    await usuariosService.clearPermisoOverrides(Number(req.params.id), actorId, actorNombre);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/usuarios/:id/sesiones
router.get('/:id/sesiones', async (req: AuthRequest, res: Response) => {
  try {
    const data = await usuariosService.getSesiones(Number(req.params.id));
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Roles ─────────────────────────────────────────────────────────────────────

// GET /api/usuarios/roles/list
router.get('/roles/list', async (_req: AuthRequest, res: Response) => {
  try { res.json(await usuariosService.getRoles()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// GET /api/usuarios/roles/:id
router.get('/roles/:id', async (req: AuthRequest, res: Response) => {
  try { res.json(await usuariosService.getRolById(Number(req.params.id))); }
  catch (e: any) { res.status(e.name === 'ValidationError' ? 404 : 500).json({ error: e.message }); }
});

// PUT /api/usuarios/roles/:id/permisos  { permisoIds: number[] }
router.put('/roles/:id/permisos', async (req: AuthRequest, res: Response) => {
  try {
    const { permisoIds } = req.body;
    const { actorId, actorNombre } = who(req);
    await usuariosService.setRolPermisos(Number(req.params.id), permisoIds, actorId, actorNombre);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/usuarios/roles/:id/permisos-overrides  — clear individual overrides for all users of this role
router.delete('/roles/:id/permisos-overrides', async (req: AuthRequest, res: Response) => {
  try {
    const { actorId, actorNombre } = who(req);
    await usuariosService.clearOverridesForRole(Number(req.params.id), actorId, actorNombre);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Permisos (catálogo web) ─────────────────────────────────────────────────────────────────────────

// GET /api/usuarios/permisos/list
router.get('/permisos/list', async (_req, res) => {
  try { res.json(await usuariosService.getPermisos()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Auditoría ─────────────────────────────────────────────────────────────────

// GET /api/usuarios/auditoria?page=1&pageSize=50&evento=...
router.get('/auditoria/log', async (req: AuthRequest, res: Response) => {
  try {
    const { usuarioId, evento, resultado, fechaDesde, fechaHasta, page, pageSize } = req.query as Record<string, string>;
    const data = await usuariosService.getAuditoria({
      usuarioId:  usuarioId  ? Number(usuarioId)  : undefined,
      evento:     evento     || undefined,
      resultado:  resultado  || undefined,
      fechaDesde: fechaDesde || undefined,
      fechaHasta: fechaHasta || undefined,
      page:       page       ? Number(page)     : 1,
      pageSize:   pageSize   ? Number(pageSize) : 50,
    });
    res.json(data);
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Política de seguridad ─────────────────────────────────────────────────────

// GET /api/usuarios/politica/config
router.get('/politica/config', async (_req, res) => {
  try { res.json(await usuariosService.getPolitica()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// PUT /api/usuarios/politica/config
router.put('/politica/config', async (req: AuthRequest, res: Response) => {
  try {
    const { actorId, actorNombre } = who(req);
    await usuariosService.updatePolitica(req.body, actorId, actorNombre);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// ── Sesiones (global) ─────────────────────────────────────────────────────────

// GET /api/usuarios/sesiones/all
router.get('/sesiones/all', async (_req, res) => {
  try { res.json(await usuariosService.getSesiones()); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/usuarios/sesiones/:sesionId
router.delete('/sesiones/:sesionId', async (req: AuthRequest, res: Response) => {
  try {
    const { actorId, actorNombre } = who(req);
    await usuariosService.revocarSesion(String(req.params.sesionId), actorId, actorNombre);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default router;
