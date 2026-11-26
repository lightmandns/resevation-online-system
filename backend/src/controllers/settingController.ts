import { Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { settingService } from '../services/settingService.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';
import { getClientIp, ServiceError } from '../utils/errors.js';

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

export const getSettings = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Settings (E52-E53)']
  // #swagger.summary = 'E52: Baca konfigurasi sistem (Khusus Manajer)'
  try {
    const data = await settingService.getSettings();
    sendSuccess(res, data, 'Pengaturan sistem berhasil diambil.');
  } catch (error) {
    handleError(res, 'E52 getSettings', error);
  }
};

export const updateSettings = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Settings (E52-E53)']
  // #swagger.summary = 'E53: Perbarui konfigurasi sistem + catat SETTING_UPDATED di audit log (Khusus Manajer)'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/UpdateSettingsRequest" }
          }
        }
     } */
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await settingService.updateSettings(req.body ?? {}, req.v1User.user_id, {
      userId: req.v1User.user_id,
      userEmail: req.v1User.email,
      ipAddress: getClientIp(req),
    });
    sendSuccess(res, data, 'Pengaturan sistem berhasil diperbarui.');
  } catch (error) {
    handleError(res, 'E53 updateSettings', error);
  }
};
