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
    },
  },
  security: [{ bearerAuth: [] }],
};

const outputFile = './src/docs/swagger-output.json';
const routes = ['./src/server.ts'];

swaggerAutogen({ openapi: '3.0.0' })(outputFile, routes, doc);
