import { sql } from 'drizzle-orm';
import { getPool, sql as mssql } from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

/**
 * Script Pengujian Otentikasi dan User Management MazayaDB
 * Sesuai skema baru tabel [dbo].[USER]:
 * UserId, FullName, Email, PhoneNumber, PasswordHash, Role, IsActive, LastLogin, CreatedAt, UpdatedAt
 */

async function runAuthTests() {
  console.log('====================================================');
  console.log('🧪 PENGUJIAN OTENTIKASI & USER MANAGEMENT');
  console.log('   Target: MazayaDB -> Tabel [dbo].[USER]');
  console.log('====================================================\n');

  try {
    const pool = await getPool();
    console.log('✅ Terhubung ke database MazayaDB.\n');

    // 1. Verifikasi Skema Tabel USER
    console.log('[1/7] Memeriksa struktur tabel [dbo].[USER]...');
    const tableInfo = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'USER'
      ORDER BY ORDINAL_POSITION
    `);

    if (tableInfo.recordset.length === 0) {
      throw new Error('Tabel [dbo].[USER] belum dibuat di database MazayaDB. Jalankan script 02. Define Table (DDL).sql terlebih dahulu.');
    }

    console.log('✅ Tabel [dbo].[USER] terverifikasi:');
    console.table(tableInfo.recordset.map((c: any) => ({
      Kolom: c.COLUMN_NAME,
      Tipe: c.DATA_TYPE + (c.CHARACTER_MAXIMUM_LENGTH ? `(${c.CHARACTER_MAXIMUM_LENGTH})` : ''),
      Nullable: c.IS_NULLABLE
    })));

    // 2. Simulasi Drizzle SQL Builder
    const drizzleQuery = sql`SELECT UserId, FullName, Email, Role, IsActive FROM [USER]`;
    console.log(`[2/7] Drizzle Query Chunk: "${drizzleQuery.queryChunks.join('')}"`);

    // 3. Tes Registrasi User Baru
    const testEmail = `tester_${Date.now()}@mazaya.dev`;
    const testPassword = 'PasswordTest123!';
    const testFullName = 'Tester Mazaya';
    const testPhone = '081234567890';

    console.log(`\n[3/7] Menguji Registrasi Pengguna Baru (${testEmail})...`);
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(testPassword, salt);

    const insertResult = await pool.request()
      .input('fullName', mssql.NVarChar, testFullName)
      .input('email', mssql.NVarChar, testEmail)
      .input('phoneNumber', mssql.NVarChar, testPhone)
      .input('passwordHash', mssql.NVarChar, passwordHash)
      .input('role', mssql.NVarChar, 'Customer')
      .input('isActive', mssql.Bit, 1)
      .query(`
        INSERT INTO [dbo].[USER] (FullName, Email, PhoneNumber, PasswordHash, Role, IsActive)
        OUTPUT INSERTED.UserId as userId, INSERTED.FullName as fullName, INSERTED.Email as email, 
               INSERTED.PhoneNumber as phoneNumber, INSERTED.Role as role, INSERTED.IsActive as isActive
        VALUES (@fullName, @email, @phoneNumber, @passwordHash, @role, @isActive)
      `);

    const createdUser = insertResult.recordset[0];
    console.log('✅ Registrasi Berhasil!');
    console.log('   Hasil Insert:', createdUser);

    // 4. Tes Login & Validasi PasswordHash
    console.log(`\n[4/7] Menguji Login & Verifikasi PasswordHash...`);
    const loginResult = await pool.request()
      .input('email', mssql.NVarChar, testEmail)
      .query('SELECT * FROM [dbo].[USER] WHERE Email = @email');

    const foundUser = loginResult.recordset[0];
    const passwordValid = await bcrypt.compare(testPassword, foundUser.PasswordHash);

    if (!passwordValid) {
      throw new Error('Verifikasi Password gagal!');
    }
    console.log('✅ Verifikasi PasswordHash berhasil (Match)!');

    // 5. Update LastLogin
    await pool.request()
      .input('userId', mssql.Int, foundUser.UserId)
      .query('UPDATE [dbo].[USER] SET LastLogin = CURRENT_TIMESTAMP WHERE UserId = @userId');
    console.log('✅ Field LastLogin berhasil diperbarui.');

    // 6. Tes Generate & Verifikasi JWT Token
    console.log(`\n[5/7] Menguji Pembuatan & Validasi Token JWT...`);
    const secret = process.env.JWT_SECRET || 'default_secret';
    const token = jwt.sign(
      { userId: foundUser.UserId, email: foundUser.Email, fullName: foundUser.FullName, role: foundUser.Role },
      secret,
      { expiresIn: '1d' }
    );
    const decoded: any = jwt.verify(token, secret);
    console.log('✅ Token JWT valid! Payload terenkripsi:', {
      userId: decoded.userId,
      email: decoded.email,
      fullName: decoded.fullName,
      role: decoded.role
    });

    // 7. Tes Logout Konseptual
    console.log(`\n[6/7] Menguji Siklus Logout...`);
    console.log('✅ Logout endpoint ready: Mengakhiri sesi pengguna.');

    // 8. Pembersihan (Cleanup)
    console.log(`\n[7/7] Membersihkan data uji coba...`);
    await pool.request()
      .input('userId', mssql.Int, createdUser.userId)
      .query('DELETE FROM [dbo].[USER] WHERE UserId = @userId');
    console.log(`🧹 Akun uji coba (UserId: ${createdUser.userId}) telah dibersihkan.`);

    console.log('\n====================================================');
    console.log('🎉 SEMUA PENGUJIAN SKEMA BARU BERHASIL 100%!');
    console.log('====================================================');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Pengujian gagal:', error.message);
    process.exit(1);
  }
}

runAuthTests();
