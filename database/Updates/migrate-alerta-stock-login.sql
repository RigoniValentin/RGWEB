-- ═══════════════════════════════════════════════════════════════════════════════
--  Río Gestión Web — Alerta de Stock por WhatsApp al Login
--  Agrega el parámetro global que habilita/deshabilita el envío automático
--  de alerta de stock bajo vía WhatsApp al momento de iniciar sesión.
--
--  Run this script against the SesamoDB database
-- ═══════════════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM CONFIG_PARAMETROS WHERE CLAVE = 'alerta_stock_login_wsp')
  INSERT INTO CONFIG_PARAMETROS (MODULO, SUBMODULO, CLAVE, DESCRIPCION, TIPO, VALOR_DEFECTO, ORDEN)
  VALUES (
    'general',
    'notificaciones',
    'alerta_stock_login_wsp',
    'Enviar alerta de stock bajo por WhatsApp al iniciar sesión',
    'boolean',
    'false',
    30
  );

PRINT '✅ Parámetro alerta_stock_login_wsp agregado';
GO
