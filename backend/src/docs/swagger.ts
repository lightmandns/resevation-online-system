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
    },
  },
  security: [{ bearerAuth: [] }],
};

const outputFile = './src/docs/swagger-output.json';
const routes = ['./src/server.ts'];

swaggerAutogen({ openapi: '3.0.0' })(outputFile, routes, doc);
