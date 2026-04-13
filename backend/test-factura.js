// Test: emit factura for VENTA_ID = 9
const jwt = require('jsonwebtoken');

const secret = 'change_this_to_a_secure_random_string';
const token = jwt.sign({ id: 1, nombre: 'test' }, secret, { expiresIn: '1h' });

async function test() {
  const base = 'http://127.0.0.1:3001/api/sales';

  console.log('=== Emitir Factura - Venta ID 9 ===\n');
  try {
    const res = await fetch(`${base}/9/facturar`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
