import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { consultarCuit } from '../services/arca/wsPadron.js';
import { consultarConstancia } from '../services/arca/wsConstancia.js';
import { config } from '../config/index.js';

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/afip/cuit/:cuit
 *
 * Consults ARCA Padrón (ws_sr_padron_a13) for the given 11-digit CUIT.
 * Returns: { razonSocial, condicionIva, noAlcanzado, domicilio, ciudad, provincia, estadoClave }
 *
 * noAlcanzado = true means the CUIT exists but has no IVA/Monotributo
 * registration (e.g. employee). The frontend should leave the IVA field
 * editable so the user can choose manually.
 */
router.get('/cuit/:cuit', async (req: Request, res: Response) => {
  const cuit = req.params.cuit as string;

  // Strip dashes — accept both "20-12345678-9" and "20123456789"
  const cleanCuit = cuit.replace(/-/g, '');

  if (!/^\d{11}$/.test(cleanCuit)) {
    return res.status(400).json({ error: 'CUIT inválido — debe tener 11 dígitos (con o sin guiones)' });
  }

  if (!config.arca.cuit || !config.arca.certPath || !config.arca.keyPath) {
    return res.status(503).json({ error: 'ARCA no está configurado en este sistema' });
  }

  try {
    const result = await consultarCuit(cleanCuit, {
      cuit: config.arca.cuit,
      certPath: config.arca.certPath,
      privateKeyPath: config.arca.keyPath,
      environment: (config.arca.environment as 'testing' | 'production') || 'testing',
    });
    res.json(result);
  } catch (err: any) {
    // codigoError present = CUIT not found or padrón-level error
    const status = err.codigoError ? 404 : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/afip/constancia/:cuit
 *
 * Consults ARCA Constancia de Inscripción (ws_sr_constancia / A4) for a CUIT.
 * Uses its own WSAA token (cached separately from the Padrón token).
 *
 * Returns: { cuit, razonSocial, condicionIva, domicilio, ciudad, provincia,
 *            codigoPostal, estadoClave }
 *
 * condicionIva mapping:
 *   idImpuesto 30 → 'Responsable Inscripto'
 *   idImpuesto 20 → 'Monotributista'
 *   idImpuesto 32 → 'Exento'
 *   (none)        → 'Consumidor Final / No Alcanzado'
 */
router.get('/constancia/:cuit', async (req: Request, res: Response) => {
  const cuit = req.params.cuit as string;
  const cleanCuit = cuit.replace(/-/g, '');

  if (!/^\d{11}$/.test(cleanCuit)) {
    return res
      .status(400)
      .json({ error: 'CUIT inválido — debe tener 11 dígitos (con o sin guiones)' });
  }

  if (!config.arca.cuit || !config.arca.certPath || !config.arca.keyPath) {
    return res.status(503).json({ error: 'ARCA no está configurado en este sistema' });
  }

  try {
    const result = await consultarConstancia(cleanCuit, {
      cuit: config.arca.cuit,
      certPath: config.arca.certPath,
      privateKeyPath: config.arca.keyPath,
      environment: (config.arca.environment as 'testing' | 'production') || 'testing',
    });
    res.json(result);
  } catch (err: any) {
    if (err.codigoError === 'NOT_FOUND') {
      return res.status(404).json({ error: err.message });
    }
    if (err.codigoError === 'AUTH_ERROR') {
      return res.status(500).json({ error: `Error de autenticación con ARCA: ${err.message}` });
    }
    if (err.codigoError === 'INVALID_CUIT') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

export default router;
