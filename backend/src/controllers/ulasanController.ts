import { Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { ulasanService } from '../services/ulasanService.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';
import { getClientIp, ServiceError } from '../utils/errors.js';
import { AuditActor } from '../utils/auditHelper.js';

const getActor = (req: V1AuthRequest): AuditActor => ({
  userId: req.v1User?.user_id ?? null,
  userEmail: req.v1User?.email ?? 'system',
  ipAddress: getClientIp(req),
});

const handleError = (res: Response, tag: string, error: unknown): void => {
  if (error instanceof ServiceError) {
    sendError(res, error.statusCode, error.message, [
      { code: error.code, ...(error.field ? { field: error.field } : {}) },
    ]);
    return;
  }

  console.error(`[${tag} Error]`, error);
  sendError(res, 503, 'Layanan sedang mengalami gangguan. Silakan coba kembali.', [
    { code: 'ERR-SYS-01' },
  ]);
};

export const checkReviewEligibility = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Ulasan & Rating (E24-E25, E50)']
  // #swagger.summary = 'E24: Cek apakah reservasi sudah memenuhi syarat memberikan rating & ulasan'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await ulasanService.checkEligibility(String(req.params.id), {
      userId: req.v1User.user_id,
      role: req.v1User.role,
    });
    sendSuccess(res, data, 'Reservasi memenuhi syarat untuk memberikan ulasan.');
  } catch (error) {
    handleError(res, 'E24 checkReviewEligibility', error);
  }
};

export const submitReview = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Ulasan & Rating (E24-E25, E50)']
  // #swagger.summary = 'E25: Kirim rating (1-5) dan komentar ulasan untuk reservasi yang selesai'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await ulasanService.submitReview(
      String(req.params.id),
      req.body ?? {},
      { userId: req.v1User.user_id, role: req.v1User.role },
      getActor(req)
    );
    sendSuccess(res, data, 'Terima kasih atas ulasan Anda.', 201);
  } catch (error) {
    handleError(res, 'E25 submitReview', error);
  }
};

export const listManagerReviews = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Ulasan & Rating (E24-E25, E50)']
  // #swagger.summary = 'E50: Daftar rating & ulasan pelanggan beserta skor rata-rata (Khusus Manajer)'
  try {
    const result = await ulasanService.listForManager({
      skor: req.query.skor,
      tanggal_dari: req.query.tanggal_dari,
      tanggal_sampai: req.query.tanggal_sampai,
      page: req.query.page,
      per_page: req.query.per_page,
    });

    const message =
      result.items.length === 0
        ? 'Belum ada ulasan'
        : 'Daftar rating dan ulasan berhasil diambil.';

    res.status(200).json({
      status: 'success',
      data: {
        rata_rata: result.rata_rata,
        items: result.items,
      },
      meta: result.meta,
      message,
      errors: null,
    });
  } catch (error) {
    handleError(res, 'E50 listManagerReviews', error);
  }
};
