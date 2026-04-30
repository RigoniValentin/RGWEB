import { consultarConstancia } from './src/services/arca/wsConstancia.js';
import { config } from './src/config/index.js';

const wsaaConfig = {
  cuit: config.arca.cuit,
  certPath: config.arca.certPath,
  privateKeyPath: config.arca.keyPath,
  environment: (config.arca.environment as 'testing' | 'production') || 'production',
};

console.log('Consultando ws_sr_constancia para CUIT 20205795511...');
console.log('Entorno:', wsaaConfig.environment);

consultarConstancia('20205795511', wsaaConfig)
  .then(r => {
    console.log('\n✅ RESULTADO:');
    console.log(JSON.stringify(r, null, 2));
  })
  .catch(e => {
    console.error('\n❌ ERROR:', e.message);
    if (e.codigoError) console.error('Codigo:', e.codigoError);
  });
