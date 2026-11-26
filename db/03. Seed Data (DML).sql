-- ============================================================================
-- SEED DATA AWAL (DML) SISTEM RESERVASI RESTORAN MAZAYA
-- DBMS: Microsoft SQL Server 2022 (T-SQL)
-- Jalankan file ini SETELAH menjalankan "02. Define Table (DDL) New ver.sql"
-- Aman dijalankan berulang kali (Idempotent — menggunakan WHERE NOT EXISTS)
-- ============================================================================

USE MazayaDB;
GO

-- ============================================================================
-- 1. SEED AKUN AWAL (dbo.users)
-- Password semua akun demo di bawah ini: Mazaya123!
-- ============================================================================
DECLARE @DefaultPasswordHash NVARCHAR(255) = N'$2b$10$yLNwifchK3/pFHLQa8uTGuOiHIxpoauVDENj6IO5ZjUiGthEBwIvS';

INSERT INTO dbo.users (role_id, full_name, email, password_hash, phone_number, is_active)
SELECT
    r.role_id,
    v.full_name,
    v.email,
    @DefaultPasswordHash,
    v.phone_number,
    1
FROM (VALUES
    (N'Manajer',            N'Manajer Mazaya',     N'manajer@mazaya.com',    N'081200000001'),
    (N'Admin',              N'Admin Mazaya',       N'admin@mazaya.com',      N'081200000002'),
    (N'Petugas Inventaris', N'Petugas Inventaris', N'inventaris@mazaya.com', N'081200000003'),
    (N'Customer',           N'Pelanggan Demo',     N'customer@mazaya.com',   N'081200000004')
) AS v(role_name, full_name, email, phone_number)
INNER JOIN dbo.roles r ON r.role_name = v.role_name
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.users u WHERE u.email = v.email
);
GO

-- ============================================================================
-- 2. SEED BLOK MEJA (dbo.blokmeja)
-- ============================================================================
INSERT INTO dbo.blokmeja (nama_blok, kapasitas, nominal_dp, deskripsi, link_foto, status_ketersediaan, is_active)
SELECT v.nama_blok, v.kapasitas, v.nominal_dp, v.deskripsi, v.link_foto, N'Tersedia', 1
FROM (VALUES
    (N'Blok A - Indoor Reguler', 6,  100000.00, N'Area indoor ber-AC, cocok untuk keluarga kecil atau makan siang santai.', NULL),
    (N'Blok B - Indoor Tengah',  8,  150000.00, N'Area indoor luas dekat jendela dengan pencahayaan hangat.',              NULL),
    (N'Blok C - Semi Outdoor',   10, 175000.00, N'Area semi-outdoor dengan nuansa taman, nyaman untuk kumpul sore/malam.',  NULL),
    (N'Blok VIP 1 - Privat',     16, 300000.00, N'Ruang privat ber-AC lengkap dengan layar presentasi untuk rapat/acara.',  NULL),
    (N'Blok VIP 2 - Ballroom',   30, 500000.00, N'Ruang besar untuk acara keluarga, arisan, atau gathering perusahaan.',      NULL)
) AS v(nama_blok, kapasitas, nominal_dp, deskripsi, link_foto)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.blokmeja b WHERE b.nama_blok = v.nama_blok
);
GO

-- ============================================================================
-- 3. SEED KATALOG MENU (dbo.menus)
-- ============================================================================
INSERT INTO dbo.menus (nama_menu, kategori_menu, harga, is_available, minimal_porsi, deskripsi, link_foto_menu, is_active)
SELECT v.nama_menu, v.kategori_menu, v.harga, 1, v.minimal_porsi, v.deskripsi, NULL, 1
FROM (VALUES
    (N'Nasi Kebuli Kambing Mazaya', N'Reguler', 75000.00,  1, N'Nasi kebuli rempah khas Timur Tengah dengan daging kambing empuk dan acar.'),
    (N'Nasi Briyani Ayam Bakar',    N'Reguler', 55000.00,  1, N'Nasi briyani basmati wangi disajikan dengan ayam bakar bumbu spesial.'),
    (N'Nasi Mandhi Ayam Panggang',  N'Reguler', 58000.00,  1, N'Nasi mandhi autentik dengan ayam panggang lembut dan sambal tomat.'),
    (N'Sate Maranggi Sapi',         N'Reguler', 65000.00,  1, N'Sate daging sapi has dalam bumbu manis gurih dengan sambal kecap tomat.'),
    (N'Gulai Kambing Spesial',      N'Reguler', 70000.00,  1, N'Gulai kambing kuah santan rempah kaya rasa, bebas bau prengus.'),
    (N'Teh Tarik Rempah',           N'Reguler', 18000.00,  1, N'Teh tarik creamy dengan aroma kapulaga dan kayu manis.'),
    (N'Es Kurma Susu',              N'Reguler', 25000.00,  1, N'Minuman segar campuran kurma pilihan dan susu segar.'),
    (N'Nampan Kebuli Keluarga',     N'Khusus',  320000.00, 1, N'Sajian nampan besar untuk 4-5 orang lengkap dengan lauk kambing dan ayam.'),
    (N'Paket Prasmanan Nusantara',  N'Khusus',  95000.00,  20, N'Paket prasmanan lengkap untuk acara khusus, minimal pemesanan 20 porsi.')
) AS v(nama_menu, kategori_menu, harga, minimal_porsi, deskripsi)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.menus m WHERE m.nama_menu = v.nama_menu
);
GO

-- ============================================================================
-- 4. SEED PROMOSI AKTIF (dbo.promosi)
-- ============================================================================
INSERT INTO dbo.promosi (judul, deskripsi, link_foto, periode_mulai, periode_selesai, is_active)
SELECT v.judul, v.deskripsi, NULL, SYSDATETIMEOFFSET(), DATEADD(DAY, 60, SYSDATETIMEOFFSET()), 1
FROM (VALUES
    (N'Diskon 15% Reservasi Keluarga', N'Nikmati potongan 15% untuk pemesanan menu reguler minimal 6 tamu di hari kerja (Senin - Kamis).'),
    (N'Gratis Takjil & Teh Rempah',    N'Setiap reservasi Blok VIP mendapatkan gratis sajian pembuka dan teko Teh Tarik Rempah.'),
    (N'Paket Hemat Gathering Kantor',  N'Harga spesial untuk pemesanan Paket Prasmanan Nusantara minimal 25 porsi.')
) AS v(judul, deskripsi)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.promosi p WHERE p.judul = v.judul
);
GO

-- ============================================================================
-- 5. SEED STOK BAHAN BAKU (dbo.stok)
-- ============================================================================
INSERT INTO dbo.stok (nama_bahan, jumlah_stok, satuan, harga_satuan, tanggal_masuk)
SELECT v.nama_bahan, v.jumlah_stok, v.satuan, v.harga_satuan, CAST(GETDATE() AS DATE)
FROM (VALUES
    (N'Beras Basmati Premium', 50.000, N'kg',    42000.00),
    (N'Daging Kambing Muda',   25.000, N'kg',    145000.00),
    (N'Daging Sapi Has Dalam', 20.000, N'kg',    155000.00),
    (N'Ayam Kampung Utuh',     40.000, N'ekor',  65000.00),
    (N'Minyak Samin',          15.000, N'liter', 78000.00),
    (N'Bumbu Rempah Kebuli',   10.000, N'kg',    120000.00),
    (N'Kurma Sukari',          12.000, N'kg',    95000.00)
) AS v(nama_bahan, jumlah_stok, satuan, harga_satuan)
WHERE NOT EXISTS (
    SELECT 1 FROM dbo.stok s WHERE s.nama_bahan = v.nama_bahan
);
GO

PRINT N'Seed data awal MazayaDB berhasil dijalankan.';
GO
