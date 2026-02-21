/**
 * Temporary script to extract database schema from SQL Server.
 * Run: npx tsx src/database/extract-schema.ts
 */
import sql from 'mssql';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function extractSchema() {
  const serverEnv = process.env.DB_SERVER || 'localhost';
  // Named instances (e.g. HOST\SQLEXPRESS) should not use a port
  const hasNamedInstance = serverEnv.includes('\\');

  const config: sql.config = {
    server: serverEnv,
    ...(hasNamedInstance ? {} : { port: parseInt(process.env.DB_PORT || '1433', 10) }),
    database: process.env.DB_DATABASE || '',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    options: {
      encrypt: false,
      trustServerCertificate: true,
      instanceName: hasNamedInstance ? serverEnv.split('\\')[1] : undefined,
      enableArithAbort: true,
    },
    requestTimeout: 15000,
    connectionTimeout: 15000,
  };

  // For named instances, override server to just the host
  if (hasNamedInstance) {
    config.server = serverEnv.split('\\')[0];
  }

  console.log(`\nConnecting to ${config.server}/${config.database}...\n`);

  const pool = await sql.connect(config);
  console.log('✅ Connected successfully!\n');

  // ── List all tables ────────────────────────────────
  console.log('═══════════════════════════════════════════');
  console.log('  TABLES');
  console.log('═══════════════════════════════════════════');

  const tables = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);

  for (const t of tables.recordset) {
    console.log(`  [${t.TABLE_SCHEMA}].[${t.TABLE_NAME}]`);
  }

  // ── For each table, show columns ───────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log('  TABLE DETAILS (Columns, Types, Keys)');
  console.log('═══════════════════════════════════════════');

  for (const t of tables.recordset) {
    const fullName = `[${t.TABLE_SCHEMA}].[${t.TABLE_NAME}]`;
    console.log(`\n─── ${fullName} ───`);

    // Row count
    const countResult = await pool.request().query(
      `SELECT COUNT(*) as cnt FROM ${fullName}`
    );
    console.log(`  Rows: ${countResult.recordset[0].cnt}`);

    // Columns
    const cols = await pool.request()
      .input('schema', sql.NVarChar, t.TABLE_SCHEMA)
      .input('table', sql.NVarChar, t.TABLE_NAME)
      .query(`
        SELECT 
          c.COLUMN_NAME,
          c.DATA_TYPE,
          c.CHARACTER_MAXIMUM_LENGTH,
          c.NUMERIC_PRECISION,
          c.NUMERIC_SCALE,
          c.IS_NULLABLE,
          c.COLUMN_DEFAULT,
          CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 'PK' ELSE '' END AS IS_PK,
          CASE WHEN fk.COLUMN_NAME IS NOT NULL THEN 
            'FK -> ' + fk.REF_TABLE 
          ELSE '' END AS FK_INFO
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
          SELECT ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
            ON tc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        ) pk ON pk.TABLE_SCHEMA = c.TABLE_SCHEMA 
            AND pk.TABLE_NAME = c.TABLE_NAME 
            AND pk.COLUMN_NAME = c.COLUMN_NAME
        LEFT JOIN (
          SELECT 
            ku.TABLE_SCHEMA, ku.TABLE_NAME, ku.COLUMN_NAME,
            ccu.TABLE_NAME AS REF_TABLE
          FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
          JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE ku
            ON rc.CONSTRAINT_NAME = ku.CONSTRAINT_NAME
          JOIN INFORMATION_SCHEMA.CONSTRAINT_COLUMN_USAGE ccu
            ON rc.UNIQUE_CONSTRAINT_NAME = ccu.CONSTRAINT_NAME
        ) fk ON fk.TABLE_SCHEMA = c.TABLE_SCHEMA 
            AND fk.TABLE_NAME = c.TABLE_NAME 
            AND fk.COLUMN_NAME = c.COLUMN_NAME
        WHERE c.TABLE_SCHEMA = @schema AND c.TABLE_NAME = @table
        ORDER BY c.ORDINAL_POSITION
      `);

    console.log('  Columns:');
    for (const col of cols.recordset) {
      let type = col.DATA_TYPE;
      if (col.CHARACTER_MAXIMUM_LENGTH) {
        type += col.CHARACTER_MAXIMUM_LENGTH === -1 ? '(MAX)' : `(${col.CHARACTER_MAXIMUM_LENGTH})`;
      } else if (col.NUMERIC_PRECISION && col.DATA_TYPE !== 'int' && col.DATA_TYPE !== 'bigint' && col.DATA_TYPE !== 'smallint' && col.DATA_TYPE !== 'tinyint') {
        type += `(${col.NUMERIC_PRECISION},${col.NUMERIC_SCALE})`;
      }
      const nullable = col.IS_NULLABLE === 'YES' ? 'NULL' : 'NOT NULL';
      const pk = col.IS_PK ? ' [PK]' : '';
      const fk = col.FK_INFO ? ` [${col.FK_INFO}]` : '';
      const def = col.COLUMN_DEFAULT ? ` DEFAULT ${col.COLUMN_DEFAULT}` : '';
      console.log(`    ${col.COLUMN_NAME.padEnd(30)} ${type.padEnd(20)} ${nullable.padEnd(8)}${pk}${fk}${def}`);
    }

    // Indexes
    const indexes = await pool.request()
      .input('table', sql.NVarChar, t.TABLE_NAME)
      .query(`
        SELECT 
          i.name AS INDEX_NAME,
          i.type_desc AS INDEX_TYPE,
          i.is_unique AS IS_UNIQUE,
          STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS COLUMNS
        FROM sys.indexes i
        JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.object_id = OBJECT_ID(@table)
          AND i.name IS NOT NULL
        GROUP BY i.name, i.type_desc, i.is_unique
      `);

    if (indexes.recordset.length > 0) {
      console.log('  Indexes:');
      for (const idx of indexes.recordset) {
        const unique = idx.IS_UNIQUE ? 'UNIQUE ' : '';
        console.log(`    ${idx.INDEX_NAME.padEnd(40)} ${unique}${idx.INDEX_TYPE} (${idx.COLUMNS})`);
      }
    }
  }

  // ── Views ──────────────────────────────────────────
  const views = await pool.request().query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.VIEWS
    ORDER BY TABLE_SCHEMA, TABLE_NAME
  `);

  if (views.recordset.length > 0) {
    console.log('\n═══════════════════════════════════════════');
    console.log('  VIEWS');
    console.log('═══════════════════════════════════════════');
    for (const v of views.recordset) {
      console.log(`  [${v.TABLE_SCHEMA}].[${v.TABLE_NAME}]`);
    }
  }

  // ── Stored Procedures ──────────────────────────────
  const procs = await pool.request().query(`
    SELECT ROUTINE_SCHEMA, ROUTINE_NAME
    FROM INFORMATION_SCHEMA.ROUTINES
    WHERE ROUTINE_TYPE = 'PROCEDURE'
      AND ROUTINE_SCHEMA != 'sys'
    ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
  `);

  if (procs.recordset.length > 0) {
    console.log('\n═══════════════════════════════════════════');
    console.log('  STORED PROCEDURES');
    console.log('═══════════════════════════════════════════');
    for (const p of procs.recordset) {
      console.log(`  [${p.ROUTINE_SCHEMA}].[${p.ROUTINE_NAME}]`);
    }
  }

  await pool.close();
  console.log('\n✅ Schema extraction complete.');
}

extractSchema().catch((err) => {
  console.error('❌ Connection failed:', err.message);
  process.exit(1);
});
