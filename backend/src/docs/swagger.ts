import swaggerAutogen from 'swagger-autogen';

const doc = {
  info: {
    title: 'Mazaya Reservation & Branding API (v1)',
    version: '1.2.0',
    description:
      'Dokumentasi Interaktif & Pengujian REST API Sistem Reservasi & Branding Restoran Mazaya (E01-E56)',
  },
  servers: [{ url: 'http://localhost:5000' }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Tempelkan token JWT hasil dari POST /api/v1/auth/login (tanpa kata Bearer)',
      },
    },
    schemas: {
      RegisterRequest: {
        nama: 'Budi Santoso',
        email: 'customer@mazaya.test',
        no_whatsapp: '081234567890',
        password: 'Password123',
        konfirmasi_password: 'Password123',
      },
      LoginRequest: {
        email: 'customer@mazaya.test',
        password: 'Password123',
        remember_me: false,
      },
      ForgotPasswordRequest: {
        email: 'customer@mazaya.test',
      },
      ResetPasswordRequest: {
        token: '<token_reset_dari_console>',
        password: 'NewPassword123',
        konfirmasi_password: 'NewPassword123',
      },
      UpdateProfileRequest: {
        nama: 'Budi Wijaya',
        no_whatsapp: '6281234567891',
        current_password: 'Password123',
        password: 'NewPassword123',
      },
      CreateRegularReservationRequest: {
        jenis_layanan: 'Reguler',
        jadwal_reservasi: '2026-12-20T18:00:00+07:00',
        jumlah_tamu: 4,
        blok_ids: ['00000000-0000-0000-0000-000000000000'],
      },
      CreateSpecialReservationRequest: {
        nama_pemesan: 'Siti Aminah',
        nomor_whatsapp: '6281234567890',
        email_pemesan: 'siti@example.test',
        jenis_acara: 'Ulang Tahun',
        jadwal_reservasi: '2026-12-20T18:00:00+07:00',
        jumlah_tamu: 20,
        blok_ids: ['00000000-0000-0000-0000-000000000000'],
        status_pembayaran: 'dp',
        pesanan_menu: [
          {
            menu_id: '00000000-0000-0000-0000-000000000000',
            nama_menu: 'Paket Prasmanan Spesial',
            jumlah_porsi: 20,
            harga_satuan: 75000,
            keterangan: 'Tanpa kacang',
          },
        ],
      },
      CreatePaymentRequest: {
        jenis: 'DP',
        bank: 'bca',
        setuju_ketentuan: true,
      },
      MidtransCallbackRequest: {
        order_id: '00000000-0000-0000-0000-000000000000',
        transaction_id: 'midtrans-trx-001',
        transaction_status: 'settlement',
        status_code: '200',
        gross_amount: '50000.00',
        signature_key: '<sha512_signature_key>',
      },
      VerifyManualPaymentRequest: {
        keputusan: 'setuju',
        catatan: 'DP terverifikasi',
      },
      CreateBlockRequest: {
        kode_blok: 'BLOK-VIP-01',
        kapasitas: 8,
        nominal_dp: 100000,
        fasilitas: 'AC, Sofa, Smart TV, Stop Kontak',
        foto_url: 'https://example.com/images/blok-vip-01.jpg',
      },
      UpdateBlockRequest: {
        kode_blok: 'BLOK-VIP-01',
        kapasitas: 10,
        nominal_dp: 150000,
        fasilitas: 'AC, Sofa, Smart TV, Stop Kontak, Karaoke',
        foto_url: 'https://example.com/images/blok-vip-01.jpg',
        status_ketersediaan: 'Tersedia',
      },
      CreateReservationOrdersRequest: {
        items: [
          {
            menu_id: '00000000-0000-0000-0000-000000000000',
            jumlah_porsi: 4,
          },
        ],
        request_items: [
          {
            nama_menu: 'Nasi Tumpeng Spesial',
            deskripsi: 'Tambahan sambal terasi dan lalapan segar',
            jumlah_porsi: 20,
          },
        ],
      },
      CreateMenuRequest: {
        nama: 'Nasi Goreng Mazaya',
        kategori: 'Reguler',
        harga: 35000,
        tersedia: true,
        minimal_porsi: 1,
        deskripsi: 'Nasi goreng rempah khas Mazaya dengan ayam suwir dan telur mata sapi',
        foto_url: 'https://example.com/images/nasi-goreng.jpg',
      },
      UpdateMenuRequest: {
        nama: 'Nasi Goreng Mazaya Spesial',
        kategori: 'Reguler',
        harga: 38000,
        tersedia: true,
        minimal_porsi: 1,
        deskripsi: 'Nasi goreng rempah khas Mazaya porsi spesial',
        foto_url: 'https://example.com/images/nasi-goreng.jpg',
      },
      CreatePromotionRequest: {
        judul: 'Promo Akhir Tahun 20%',
        deskripsi: 'Diskon 20% untuk semua paket reservasi keluarga di bulan Desember.',
        tanggal_mulai: '2026-12-01',
        tanggal_selesai: '2026-12-31',
        gambar_url: 'https://example.com/images/promo-desember.jpg',
        aktif: true,
      },
      UpdatePromotionRequest: {
        judul: 'Promo Akhir Tahun 25%',
        deskripsi: 'Diskon 25% untuk reservasi keluarga di bulan Desember.',
        tanggal_mulai: '2026-12-01',
        tanggal_selesai: '2026-12-31',
        gambar_url: 'https://example.com/images/promo-desember.jpg',
        aktif: true,
      },
      CreateIngredientReceiptRequest: {
        nama_bahan: 'Beras Pandan Wangi',
        satuan: 'kg',
        jumlah: 25,
        harga: 16000,
        tanggal_pencatatan: '2026-11-26',
      },
      CreateUserRequest: {
        nama: 'Rina Staff',
        email: 'rina.staff@mazaya.test',
        no_whatsapp: '6281234567892',
        password: 'Password123',
        role: 'Admin',
        is_active: true,
      },
      UpdateUserRequest: {
        nama: 'Rina Staff Updated',
        no_whatsapp: '6281234567893',
        role: 'Admin',
        is_active: true,
      },
      UpdateStockQuantityRequest: {
        jumlah_stok_baru: 40,
      },
      DecideMenuRequest: {
        keputusan: 'TERIMA',
        harga_satuan: 45000,
        catatan: 'Menu request disetujui dengan harga Rp 45.000/porsi',
      },
      SubmitReviewRequest: {
        rating: 5,
        komentar: 'Makanan lezat, pelayanan ramah, tempat sangat nyaman!',
      },
      UpdateSettingsRequest: {
        min_porsi_request: 20,
        batas_waktu_dp_menit: 10,
        batas_waktu_pelunasan_menit: 10,
        durasi_slot_jam: 3,
        batas_submit_menu_hari: 1,
        jam_buka: '10:00',
        jam_tutup: '22:00',
        whatsapp_admin: '6281234567890',
      },
    },
  },
  security: [{ bearerAuth: [] }],
};

const outputFile = './src/docs/swagger-output.json';
const routes = ['./src/server.ts'];

swaggerAutogen({ openapi: '3.0.0' })(outputFile, routes, doc);
