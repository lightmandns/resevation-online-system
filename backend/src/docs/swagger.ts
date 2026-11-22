import swaggerAutogen from 'swagger-autogen';

const doc = {
  info: {
    title: 'Mazaya User Management & Reservation API',
    version: '1.0.0',
    description: 'API Dokumentasi Interaktif & GUI Pengujian Autentikasi / User Management (Mirip Tugas 3 Praktikum RSI)'
  },
  servers: [{ url: 'http://localhost:5000' }],
  securityDefinitions: {
    bearerAuth: {
      type: 'apiKey',
      in: 'header',
      name: 'Authorization',
      description: 'Masukkan token JWT dengan format: Bearer <token>'
    }
  },
  security: [{ bearerAuth: [] }],
  definitions: {
    RegisterInput: {
      type: 'object',
      required: ['fullName', 'email', 'password'],
      properties: {
        fullName: { type: 'string', example: 'Pelanggan Mazaya' },
        email: { type: 'string', example: 'customer@mazaya.dev' },
        phoneNumber: { type: 'string', example: '085952403117' },
        password: { type: 'string', example: 'Password123!' },
      },
    },
    LoginInput: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', example: 'Developer@mazaya.dev' },
        password: { type: 'string', example: 'Mazaya2026!' },
      },
    },
    UserInput: {
      type: 'object',
      required: ['fullName', 'email', 'password', 'role'],
      properties: {
        fullName: { type: 'string', example: 'Staff Mazaya' },
        email: { type: 'string', example: 'staff@mazaya.dev' },
        phoneNumber: { type: 'string', example: '08123456789' },
        password: { type: 'string', example: 'Staff123!' },
        role: { type: 'string', example: 'Manajer' },
        isActive: { type: 'boolean', example: true },
      },
    },
  },
};

const outputFile = './src/docs/swagger-output.json';
// Gunakan server.ts agar swagger-autogen membaca mounting path Express (/api/auth dan /api/users)
const routes = ['./src/server.ts'];

swaggerAutogen({ openapi: '3.0.0' })(outputFile, routes, doc);
