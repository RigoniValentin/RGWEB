// Quick test script for ARCA connectivity
const jwt = require('jsonwebtoken');

const secret = 'change_this_to_a_secure_random_string';
const token = jwt.sign({ id: 1, nombre: 'test' }, secret, { expiresIn: '1h' });

async function test() {
  const base = 'http://127.0.0.1:3001/api/sales';

  console.log('=== 1. ARCA Health Check (FEDummy) ===\n');
  try {
    const res = await fetch(`${base}/fe-health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }

  console.log('\n=== 2. ARCA Puntos de Venta ===\n');
  try {
    const res = await fetch(`${base}/fe-puntos-venta`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }

  console.log('\n=== 3. FE Config ===\n');
  try {
    const res = await fetch(`${base}/fe-config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
