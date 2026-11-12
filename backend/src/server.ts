import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import swaggerDocument from './docs/swagger-output.json' with { type: 'json' };
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import { getPool } from './config/db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

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
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// 404 Route Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Rute '${req.originalUrl}' tidak ditemukan.`
  });
});

// Global Error Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Internal Server Error]', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Terjadi kesalahan internal pada server.',
  });
});

// Start Express Server
app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`  🚀 Backend Express (TypeScript) di: http://localhost:${PORT}`);
  console.log(`  📖 GUI Pengujian Swagger UI: http://localhost:${PORT}/docs`);
  console.log(`  📡 Health Check: http://localhost:${PORT}/api/health`);
  console.log(`=======================================================`);

  try {
    await getPool();
  } catch (err) {
    console.warn('[Pemberitahuan] SQL Server belum terhubung saat startup.');
    console.warn('Periksa file backend/.env dan jalankan "npm run db:init" jika database belum dibuat.');
  }
});
