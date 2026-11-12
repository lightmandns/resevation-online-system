import sql from 'mssql';
import dotenv from 'dotenv';
import { dbConfig } from '../config/db.js';

dotenv.config();

async function testConnection(): Promise<void> {
  console.log('--- Menguji Koneksi SQL Server (TypeScript) ---');
  console.log(`Server   : ${dbConfig.server}`);
  console.log(`Port     : ${dbConfig.port}`);
  console.log(`Database : ${dbConfig.database}`);
  console.log(`User     : ${dbConfig.user}`);
  console.log(`Encrypt  : ${dbConfig.options?.encrypt}`);
  console.log(`TrustCert: ${dbConfig.options?.trustServerCertificate}`);

  try {
    const pool = await new sql.ConnectionPool(dbConfig).connect();
    const result = await pool.request().query('SELECT @@VERSION as version, DB_NAME() as current_db, GETDATE() as [server_time]');
    
    console.log('\n[SUCCESS] Berhasil terhubung ke SQL Server!');
    console.log('Database Aktif :', result.recordset[0].current_db);
    console.log('Waktu Server   :', result.recordset[0].server_time);
    console.log('Versi SQL      :', result.recordset[0].version.split('\n')[0]);
    
    await pool.close();
  } catch (err: any) {
    console.error('\n[ERROR] Gagal terhubung ke SQL Server!');
    console.error('Detail Error:', err.message);
    console.log('\nTips Penyelesaian:');
    console.log('1. Pastikan SQL Server Service sedang RUNNING di Services Windows (services.msc -> SQL Server (MSSQLSERVER) atau (SQLEXPRESS)).');
    console.log('2. Pastikan TCP/IP aktif di SQL Server Configuration Manager.');
    console.log('3. Pastikan SQL Server Authentication diaktifkan (Mixed Mode Authentication) jika menggunakan user "sa".');
    console.log('4. Cek file .env di folder backend dan sesuaikan DB_USER, DB_PASSWORD, dan DB_SERVER.');
  }
}

testConnection();
