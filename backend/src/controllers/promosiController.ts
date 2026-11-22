import { Request, Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { promosiService } from '../services/promosiService.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/apiResponse.js';
import { getClientIp, ServiceError } from '../utils/errors.js';
import { AuditActor } from '../utils/auditHelper.js';

const getActor = (req: V1AuthRequest): AuditActor => ({
  userId: req.v1User?.user_id ?? null,
  userEmail: req.v1User?.email ?? 'system',
  ipAddress: getClientIp(req),
});

const handleError = (res: Response, tag: string, error: unknown, isWrite = false): void => {
  if (error instanceof ServiceError) {
    sendError(res, error.statusCode, error.message, [
      { code: error.code, ...(error.field ? { field: error.field } : {}) },
    ]);
    return;
  }

  console.error(`[${tag} Error]`, error);
  if (isWrite) {
    sendError(res, 500, 'Perubahan gagal disimpan, silakan coba lagi.', [
      { code: 'ERR-AUD-01' },
    ]);
    return;
  }

  sendError(res, 503, 'Layanan sedang mengalami gangguan. Silakan coba kembali.', [
    { code: 'ERR-SYS-01' },
  ]);
};

export const getPublicPromotions = async (req: Request, res: Response): Promise<void> => {
  // #swagger.tags = ['Promosi']
  // #swagger.summary = 'E08: Ambil daftar promosi & event aktif dalam periode tayang'
  try {
    const promotions = await promosiService.listPublicActive();
    const message =
      promotions.length === 0
        ? 'Informasi belum tersedia'
        : 'Daftar promosi aktif berhasil diambil.';
    sendSuccess(res, promotions, message);
  } catch (error) {
    handleError(res, 'E08 getPublicPromotions', error);
  }
};

export const listAdminPromotions = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Promosi']
  // #swagger.summary = 'E38: Daftar promosi & event (Admin/Manajer)'
  try {
    const { items, meta } = await promosiService.listAdmin({
      aktif: req.query.aktif,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    sendPaginated(res, items, meta, 'Daftar promosi berhasil diambil.');
  } catch (error) {
    handleError(res, 'E38 listAdminPromotions', error);
  }
};

export const createPromotion = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Promosi']
  // #swagger.summary = 'E39: Tambah promosi/event baru + catat audit log'
  try {
    const data = await promosiService.create(req.body ?? {}, getActor(req));
    sendSuccess(res, data, 'Promosi berhasil ditambahkan.', 201);
  } catch (error) {
    handleError(res, 'E39 createPromotion', error, true);
  }
};

export const updatePromotion = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Promosi']
  // #swagger.summary = 'E40: Ubah / nonaktifkan promosi/event + catat audit log'
  try {
    const data = await promosiService.update(String(req.params.id), req.body ?? {}, getActor(req));
    sendSuccess(res, data, 'Promosi berhasil diperbarui.');
  } catch (error) {
    handleError(res, 'E40 updatePromotion', error, true);
  }
};

export const deletePromotion = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Promosi']
  // #swagger.summary = 'E41: Hapus promosi/event + catat audit log'
  try {
    await promosiService.remove(String(req.params.id), getActor(req));
    sendSuccess(res, null, 'Promosi berhasil dihapus.');
  } catch (error) {
    handleError(res, 'E41 deletePromotion', error, true);
  }
};
