import sql from 'mssql';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { dbConfig } from '../config/db.js';

dotenv.config();

async function initDatabase(): Promise<void> {
  console.log('--- Inisialisasi Database SQL Server dimulai (TypeScript) ---');

  const masterConfig: sql.config = {
    ...dbConfig,
    database: 'master',
  };

  const targetDbName = dbConfig.database || 'UserManagementDB';

  try {
    console.log(`[1/3] Menghubungkan ke SQL Server master untuk memeriksa database "${targetDbName}"...`);
    const masterPool = await new sql.ConnectionPool(masterConfig).connect();
    
    const checkDbResult = await masterPool.request()
      .input('dbName', sql.NVarChar, targetDbName)
      .query(`
        IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = @dbName)
        BEGIN
            CREATE DATABASE [${targetDbName}];
            SELECT 'CREATED' as [action];
        END
        ELSE
        BEGIN
            SELECT 'EXISTS' as [action];
        END
      `);

    const action = checkDbResult.recordset[0]?.action;
    if (action === 'CREATED') {
      console.log(`[+] Database "${targetDbName}" berhasil dibuat!`);
    } else {
      console.log(`[i] Database "${targetDbName}" sudah ada.`);
    }

    await masterPool.close();
  } catch (err: any) {
    console.warn(`[!] Peringatan saat memeriksa database master: ${err.message}`);
    console.warn('    Akan mencoba melanjutkan langsung ke database target...');
  }

  try {
    console.log(`[2/3] Menghubungkan ke database "${targetDbName}" untuk memeriksa tabel "Users"...`);
    const targetPool = await new sql.ConnectionPool(dbConfig).connect();

    const createTableQuery = `
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
      BEGIN
        CREATE TABLE Users (
          id INT IDENTITY(1,1) PRIMARY KEY,
          name NVARCHAR(100) NOT NULL,
          email NVARCHAR(150) NOT NULL UNIQUE,
          password NVARCHAR(255) NOT NULL,
          role NVARCHAR(50) NOT NULL DEFAULT 'user',
          status NVARCHAR(20) NOT NULL DEFAULT 'active',
          created_at DATETIME2 NOT NULL DEFAULT GETDATE(),
          updated_at DATETIME2 NOT NULL DEFAULT GETDATE()
        );
        SELECT 'TABLE_CREATED' as result;
      END
      ELSE
      BEGIN
        SELECT 'TABLE_EXISTS' as result;
      END
    `;

    const tableResult = await targetPool.request().query(createTableQuery);
    if (tableResult.recordset[0]?.result === 'TABLE_CREATED') {
      console.log('[+] Tabel "Users" berhasil dibuat!');
    } else {
      console.log('[i] Tabel "Users" sudah ada.');
    }

    console.log('[3/3] Memeriksa akun Administrator awal...');
    const adminEmail = 'admin@example.com';
    const checkAdmin = await targetPool.request()
      .input('email', sql.NVarChar, adminEmail)
      .query('SELECT id, email FROM Users WHERE email = @email');

    if (checkAdmin.recordset.length === 0) {
      const defaultPassword = 'Admin123!';
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(defaultPassword, salt);

      await targetPool.request()
        .input('name', sql.NVarChar, 'Administrator')
        .input('email', sql.NVarChar, adminEmail)
        .input('password', sql.NVarChar, hashedPassword)
        .input('role', sql.NVarChar, 'admin')
        .input('status', sql.NVarChar, 'active')
        .query(`
          INSERT INTO Users (name, email, password, role, status)
          VALUES (@name, @email, @password, @role, @status)
        `);

      console.log('[+] Akun admin default berhasil dibuat:');
      console.log(`    - Email    : ${adminEmail}`);
      console.log(`    - Password : ${defaultPassword}`);
      console.log('    (Silakan ganti password ini setelah login pertama kali)');
    } else {
      console.log(`[i] Akun admin (${adminEmail}) sudah tersedia.`);
    }

    await targetPool.close();
    console.log('\n--- Setup Database Selesai dengan Sukses! ---');
  } catch (error: any) {
    console.error('\n[X] Terjadi kesalahan saat inisialisasi tabel:', error.message);
    process.exit(1);
  }
}

initDatabase();
