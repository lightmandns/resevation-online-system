import { Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { dashboardService } from '../services/dashboardService.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';
import { ServiceError } from '../utils/errors.js';

export const getManagerDashboard = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Dashboard Manajer (E49)']
  // #swagger.summary = 'E49: Ringkasan reservasi, pembayaran DP & Pelunasan, rating, dan aktivitas operasional'
  try {
    const data = await dashboardService.getManagerDashboard({
      tanggal_mulai: req.query.tanggal_mulai,
      tanggal_selesai: req.query.tanggal_selesai,
      status: req.query.status,
    });
    sendSuccess(res, data, 'Ringkasan dashboard Manajer berhasil diambil.');
  } catch (error) {
    if (error instanceof ServiceError) {
      sendError(res, error.statusCode, error.message, [
        { code: error.code, ...(error.field ? { field: error.field } : {}) },
      ]);
      return;
    }
    console.error('[E49 getManagerDashboard Error]', error);
    sendError(res, 503, 'Layanan sedang mengalami gangguan. Silakan coba kembali.', [
      { code: 'ERR-SYS-01' },
    ]);
  }
};
