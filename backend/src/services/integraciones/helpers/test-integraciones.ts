import { integracionesService } from '../../integraciones.service.js';

function getArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('-')) return null;
  return value;
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function main(): Promise<void> {
  const productoId = parsePositiveInt(getArg('--producto-id') ?? getArg('-p'));
  const stockLimit = parsePositiveInt(getArg('--limit') ?? getArg('-l')) ?? 5;

  console.log('=== Integraciones helper test ===');
  console.log(`productoId: ${productoId ?? 'n/a'}`);
  console.log(`limit: ${stockLimit}`);

  await integracionesService.ensureTables();
  console.log('[OK] ensureTables()');

  const config = await integracionesService.getConfig();
  console.log('[OK] getConfig()');
  console.log(JSON.stringify(config, null, 2));

  const apiKeys = await integracionesService.listApiKeys();
  console.log(`[OK] listApiKeys(): ${apiKeys.length}`);

  const stockItems = await integracionesService.getStockParaTienda(
    productoId ? { productoIds: [productoId] } : {},
  );
  console.log(`[OK] getStockParaTienda(): ${stockItems.length}`);
  console.log(JSON.stringify(stockItems.slice(0, stockLimit), null, 2));

  if (productoId != null) {
    const ventaWeb = await integracionesService.isProductoVentaWeb(productoId);
    console.log(`[OK] isProductoVentaWeb(${productoId}): ${ventaWeb}`);
  }

  console.log('=== Fin del test ===');
}

main().catch((error: unknown) => {
  console.error('[ERROR] Integraciones helper test failed');
  if (error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});