import { Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { notifikasiService } from '../services/notifikasiService.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/apiResponse.js';
import { ServiceError } from '../utils/errors.js';

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

export const listNotifications = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Notifikasi (E51)']
  // #swagger.summary = 'E51: Daftar notifikasi in-app milik pengguna yang sedang login'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const { items, meta } = await notifikasiService.listMyNotifications(req.v1User.user_id, {
      belum_dibaca: req.query.belum_dibaca,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    sendPaginated(res, items, meta, 'Daftar notifikasi berhasil diambil.');
  } catch (error) {
    handleError(res, 'E51 listNotifications', error);
  }
};

export const markNotificationRead = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Notifikasi (E51)']
  // #swagger.summary = 'Tandai 1 notifikasi sebagai sudah dibaca'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await notifikasiService.markAsRead(
      String(req.params.id),
      req.v1User.user_id
    );
    sendSuccess(res, data, 'Notifikasi ditandai sudah dibaca.');
  } catch (error) {
    handleError(res, 'markNotificationRead', error);
  }
};

export const markAllNotificationsRead = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Notifikasi (E51)']
  // #swagger.summary = 'Tandai seluruh notifikasi milik sendiri sebagai sudah dibaca'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await notifikasiService.markAllAsRead(req.v1User.user_id);
    sendSuccess(res, data, 'Semua notifikasi ditandai sudah dibaca.');
  } catch (error) {
    handleError(res, 'markAllNotificationsRead', error);
  }
};
