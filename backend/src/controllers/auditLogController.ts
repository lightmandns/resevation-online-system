import { Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { auditLogService } from '../services/auditLogService.js';
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

export const listAuditLogs = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Audit Log (E46-E47, E54)']
  // #swagger.summary = 'E46: Daftar audit log perubahan data (Khusus Manajer, read-only)'
  try {
    const { items, meta } = await auditLogService.list(false, {
      resource_type: req.query.resource_type,
      action_type: req.query.action_type,
      user_id: req.query.user_id,
      tanggal_dari: req.query.tanggal_dari,
      tanggal_sampai: req.query.tanggal_sampai,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    const message =
      items.length === 0
        ? 'Belum ada perubahan tercatat'
        : 'Daftar audit log berhasil diambil.';
    sendPaginated(res, items, meta, message);
  } catch (error) {
    handleError(res, 'E46 listAuditLogs', error);
  }
};

export const getAuditLogDetail = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Audit Log (E46-E47, E54)']
  // #swagger.summary = 'E47: Detail 1 entri audit log termasuk old_values & new_values JSON (Khusus Manajer)'
  try {
    const data = await auditLogService.getDetail(String(req.params.id));
    sendSuccess(res, data, 'Detail audit log berhasil diambil.');
  } catch (error) {
    handleError(res, 'E47 getAuditLogDetail', error);
  }
};

export const listSecurityLogs = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Audit Log (E46-E47, E54)']
  // #swagger.summary = 'E54: Daftar log keamanan (login, logout, akses ditolak, verifikasi bayar) (Khusus Manajer)'
  try {
    const { items, meta } = await auditLogService.list(true, {
      action_type: req.query.action_type,
      user_id: req.query.user_id,
      tanggal_dari: req.query.tanggal_dari,
      tanggal_sampai: req.query.tanggal_sampai,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    const message =
      items.length === 0
        ? 'Belum ada log keamanan tercatat'
        : 'Daftar log keamanan berhasil diambil.';
    sendPaginated(res, items, meta, message);
  } catch (error) {
    handleError(res, 'E54 listSecurityLogs', error);
  }
};
