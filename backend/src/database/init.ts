import { getPool } from './connection.js';

/**
 * Initialize the database with required tables.
 * Run with: npm run db:init
 */
async function initDatabase(): Promise<void> {
  const pool = await getPool();

  console.log('🔧 Initializing database...');

  // ── Users table ──────────────────────────────────────
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
    CREATE TABLE Users (
      Id          INT IDENTITY(1,1) PRIMARY KEY,
      Username    NVARCHAR(100)  NOT NULL UNIQUE,
      Email       NVARCHAR(255)  NOT NULL UNIQUE,
      Password    NVARCHAR(255)  NOT NULL,
      FullName    NVARCHAR(200)  NOT NULL,
      Role        NVARCHAR(50)   NOT NULL DEFAULT 'user',
      IsActive    BIT            NOT NULL DEFAULT 1,
      CreatedAt   DATETIME2      NOT NULL DEFAULT GETDATE(),
      UpdatedAt   DATETIME2      NOT NULL DEFAULT GETDATE()
    );
  `);
  console.log('  ✅ Table Users ready');

  // ── Customers table ──────────────────────────────────
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Customers')
    CREATE TABLE Customers (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Code          NVARCHAR(20)   NOT NULL UNIQUE,
      Name          NVARCHAR(200)  NOT NULL,
      TaxId         NVARCHAR(20)   NULL,
      Email         NVARCHAR(255)  NULL,
      Phone         NVARCHAR(50)   NULL,
      Address       NVARCHAR(500)  NULL,
      City          NVARCHAR(100)  NULL,
      IsActive      BIT            NOT NULL DEFAULT 1,
      CreatedAt     DATETIME2      NOT NULL DEFAULT GETDATE(),
      UpdatedAt     DATETIME2      NOT NULL DEFAULT GETDATE()
    );
  `);
  console.log('  ✅ Table Customers ready');

  // ── Products table ───────────────────────────────────
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Products')
    CREATE TABLE Products (
      Id            INT IDENTITY(1,1) PRIMARY KEY,
      Code          NVARCHAR(20)   NOT NULL UNIQUE,
      Name          NVARCHAR(200)  NOT NULL,
      Description   NVARCHAR(500)  NULL,
      Price         DECIMAL(18,2)  NOT NULL DEFAULT 0,
      Cost          DECIMAL(18,2)  NOT NULL DEFAULT 0,
      Stock         DECIMAL(18,2)  NOT NULL DEFAULT 0,
      CategoryId    INT            NULL,
      IsActive      BIT            NOT NULL DEFAULT 1,
      CreatedAt     DATETIME2      NOT NULL DEFAULT GETDATE(),
      UpdatedAt     DATETIME2      NOT NULL DEFAULT GETDATE()
    );
  `);
  console.log('  ✅ Table Products ready');

  // ── Categories table ─────────────────────────────────
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Categories')
    CREATE TABLE Categories (
      Id          INT IDENTITY(1,1) PRIMARY KEY,
      Name        NVARCHAR(100)  NOT NULL UNIQUE,
      Description NVARCHAR(300)  NULL,
      IsActive    BIT            NOT NULL DEFAULT 1,
      CreatedAt   DATETIME2      NOT NULL DEFAULT GETDATE()
    );
  `);
  console.log('  ✅ Table Categories ready');

  console.log('🎉 Database initialized successfully!');
  process.exit(0);
}

initDatabase().catch((err) => {
  console.error('❌ Error initializing database:', err);
  process.exit(1);
});
