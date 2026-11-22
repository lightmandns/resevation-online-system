import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import swaggerDocument from './docs/swagger-output.json' with { type: 'json' };
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import restaurantRoutes from './routes/restaurantRoutes.js';
import menuRoutes from './routes/menuRoutes.js';
import promosiRoutes from './routes/promosiRoutes.js';
import blokMejaRoutes from './routes/blokMejaRoutes.js';
import stokRoutes from './routes/stokRoutes.js';
import reservasiRoutes from './routes/reservasiRoutes.js';
import pembayaranRoutes from './routes/pembayaranRoutes.js';
import pesananRoutes from './routes/pesananRoutes.js';
import ulasanRoutes from './routes/ulasanRoutes.js';
import auditLogRoutes from './routes/auditLogRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import notifikasiRoutes from './routes/notifikasiRoutes.js';
import settingRoutes from './routes/settingRoutes.js';
import { startReservationJobs } from './jobs/reservationJobs.js';
import { getPool } from './config/db.js';
import { sendError, wibJsonReplacer } from './utils/apiResponse.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Format seluruh objek Date pada JSON response ke ISO 8601 WIB (+07:00) sesuai TSD 3.1
app.set('json replacer', wibJsonReplacer);

const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    return callback(new Error('CORS policy: Origin ini tidak diizinkan.'));
  },
  credentials: true,
}));

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dokumentasi Interaktif & GUI Pengujian API (Swagger UI mirip Tugas3PrakRsi)
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Health Check & Database Status
app.get('/api/health', async (req: Request, res: Response) => {
  let dbStatus = 'disconnected';
  let dbError: string | null = null;

  try {
    const pool = await getPool();
    if (pool && pool.connected) {
      dbStatus = 'connected';
    }
  } catch (err: any) {
    dbError = err.message;
  }

  res.json({
    status: 'online',
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      error: dbError,
    },
    version: '1.0.0 (TypeScript)',
  });
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1', restaurantRoutes);
app.use('/api/v1', menuRoutes);
app.use('/api/v1', promosiRoutes);
app.use('/api/v1', blokMejaRoutes);
app.use('/api/v1', stokRoutes);
app.use('/api/v1', reservasiRoutes);
app.use('/api/v1', pembayaranRoutes);
app.use('/api/v1', pesananRoutes);
app.use('/api/v1', ulasanRoutes);
app.use('/api/v1', auditLogRoutes);
app.use('/api/v1', dashboardRoutes);
app.use('/api/v1', notifikasiRoutes);
app.use('/api/v1', settingRoutes);

// 404 Route Handler (Envelope standar TSD AC-03)
app.use((req: Request, res: Response) => {
  sendError(res, 404, `Rute '${req.originalUrl}' tidak ditemukan.`, [
    { code: 'ERR-DATA-01' },
  ]);
});

// Global Error Handler (Envelope standar TSD AC-03, tanpa detail teknis)
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && 'body' in err) {
    sendError(res, 422, 'Format JSON pada body permintaan tidak valid.', [
      { code: 'ERR-VAL-02' },
    ]);
    return;
  }

  console.error('[Internal Server Error]', err);
  sendError(res, 500, 'Layanan sedang mengalami gangguan. Silakan coba kembali.', [
    { code: 'ERR-SYS-01' },
  ]);
});

// Start Express Server
app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`Backend Express (TypeScript) di: http://localhost:${PORT}`);
  console.log(`GUI Pengujian Swagger UI: http://localhost:${PORT}/docs`);
  console.log(`Health Check: http://localhost:${PORT}/api/health`);
  console.log(`=======================================================`);

  try {
    await getPool();
    startReservationJobs();
  } catch (err) {
    console.warn('[Pemberitahuan] SQL Server belum terhubung saat startup.');
    console.warn('Periksa file backend/.env dan jalankan "npm run db:init" jika database belum dibuat.');
  }
});
