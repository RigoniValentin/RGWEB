import { getPool, sql } from './src/database/connection.js';

(async () => {
  try {
    const pool = await getPool();
    
    // Check ANULADA column
    const r1 = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'COMPRAS' AND COLUMN_NAME LIKE '%ANULAD%'
    `);
    console.log('ANULADA columns:', JSON.stringify(r1.recordset));

    // Sample compras
    const r2 = await pool.request().query(`
      SELECT TOP 5 COMPRA_ID, PROVEEDOR_ID, TOTAL, FECHA_COMPRA FROM COMPRAS ORDER BY COMPRA_ID DESC
    `);
    console.log('Sample compras:', JSON.stringify(r2.recordset));
    
    // Try the exact query the service uses (pick first provider from compras)
    if (r2.recordset.length > 0) {
      const provId = r2.recordset[0].PROVEEDOR_ID;
      console.log('Testing with PROVEEDOR_ID:', provId);
      
      const r3 = await pool.request()
        .input('provId', sql.Int, provId)
        .query(`
          SELECT c.COMPRA_ID, c.FECHA_COMPRA, c.TOTAL, c.PROVEEDOR_ID
          FROM COMPRAS c
          WHERE c.PROVEEDOR_ID = @provId
          ORDER BY c.FECHA_COMPRA DESC
        `);
      console.log('Compras for provider (no ANULADA filter):', r3.recordset.length, 'rows');
      
      // Now try with ANULADA filter
      try {
        const r4 = await pool.request()
          .input('provId', sql.Int, provId)
          .query(`
            SELECT c.COMPRA_ID, c.FECHA_COMPRA, c.TOTAL
            FROM COMPRAS c
            WHERE c.PROVEEDOR_ID = @provId AND c.ANULADA = 0
            ORDER BY c.FECHA_COMPRA DESC
          `);
        console.log('Compras for provider (with ANULADA=0):', r4.recordset.length, 'rows');
      } catch (err: any) {
        console.log('ERROR with ANULADA filter:', err.message);
      }
    }
    
    process.exit(0);
  } catch (err: any) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
