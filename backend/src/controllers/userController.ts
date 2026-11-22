import { Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { userService } from '../services/userService.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/apiResponse.js';
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

export const getAllUsers = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['User Management (Manajer)']
  // #swagger.summary = 'Daftar seluruh akun pengguna (Khusus Manajer)'
  try {
    const { items, meta } = await userService.list({
      role: req.query.role,
      search: req.query.search,
      include_inactive: req.query.include_inactive,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    sendPaginated(res, items, meta, 'Daftar pengguna berhasil diambil.');
  } catch (error) {
    handleError(res, 'getAllUsers', error);
  }
};

export const getUserById = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['User Management (Manajer)']
  // #swagger.summary = 'Detail 1 akun pengguna (Khusus Manajer)'
  try {
    const data = await userService.getById(String(req.params.id));
    sendSuccess(res, data, 'Data pengguna berhasil diambil.');
  } catch (error) {
    handleError(res, 'getUserById', error);
  }
};

export const createUser = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['User Management (Manajer)']
  // #swagger.summary = 'Buat akun staff/pengguna baru (Khusus Manajer)'
  try {
    const data = await userService.create(req.body ?? {}, getActor(req));
    sendSuccess(res, data, 'Pengguna berhasil dibuat.', 201);
  } catch (error) {
    handleError(res, 'createUser', error);
  }
};

export const updateUser = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['User Management (Manajer)']
  // #swagger.summary = 'Perbarui data/role/status pengguna (Khusus Manajer)'
  try {
    const data = await userService.update(String(req.params.id), req.body ?? {}, getActor(req));
    sendSuccess(res, data, 'Data pengguna berhasil diperbarui.');
  } catch (error) {
    handleError(res, 'updateUser', error);
  }
};

export const deleteUser = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['User Management (Manajer)']
  // #swagger.summary = 'Nonaktifkan (soft delete) akun pengguna (Khusus Manajer)'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }
    await userService.remove(String(req.params.id), req.v1User.user_id, getActor(req));
    sendSuccess(res, null, 'Pengguna berhasil dinonaktifkan.');
  } catch (error) {
    handleError(res, 'deleteUser', error);
  }
};
