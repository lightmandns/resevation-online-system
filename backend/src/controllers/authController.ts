import { Request, Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { authService } from '../services/authService.js';
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

export const register = async (req: Request, res: Response): Promise<void> => {
  // #swagger.tags = ['Auth (E01-E05)']
  // #swagger.summary = 'E01: Registrasi pelanggan baru (role otomatis Customer, bcrypt cost 12)'
  try {
    const data = await authService.register(req.body ?? {});
    sendSuccess(res, data, 'Registrasi berhasil', 201);
  } catch (error) {
    handleError(res, 'E01 register', error);
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  // #swagger.tags = ['Auth (E01-E05)']
  // #swagger.summary = 'E02: Login semua role (JWT 24 jam / 30 hari Ingat Saya, lockout 3x gagal)'
  try {
    const data = await authService.login(req.body ?? {}, getClientIp(req));
    sendSuccess(res, data, 'Login berhasil');
  } catch (error) {
    handleError(res, 'E02 login', error);
  }
};

export const logout = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Auth (E01-E05)']
  // #swagger.summary = 'E03: Logout (blacklist token JWT & catat audit log)'
  try {
    const token = (req.headers.authorization || '').slice(7).trim();
    if (!req.v1User || !token) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    await authService.logout(token, {
      userId: req.v1User.user_id,
      userEmail: req.v1User.email,
      ipAddress: getClientIp(req),
      exp: req.v1User.exp,
    });

    sendSuccess(res, {}, 'Berhasil keluar');
  } catch (error) {
    handleError(res, 'E03 logout', error);
  }
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  // #swagger.tags = ['Auth (E01-E05)']
  // #swagger.summary = 'E04: Minta tautan reset password (respons selalu netral)'
  try {
    await authService.forgotPassword(req.body ?? {});
    sendSuccess(res, null, 'Jika email terdaftar, tautan reset telah dikirim');
  } catch (error) {
    handleError(res, 'E04 forgotPassword', error);
  }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  // #swagger.tags = ['Auth (E01-E05)']
  // #swagger.summary = 'E05: Atur ulang password menggunakan token reset'
  try {
    await authService.resetPassword(req.body ?? {});
    sendSuccess(res, null, 'Password berhasil diperbarui');
  } catch (error) {
    handleError(res, 'E05 resetPassword', error);
  }
};

export const getProfile = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Auth (E01-E05)']
  // #swagger.summary = 'Ambil profil akun yang sedang login'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }
    const data = await authService.getProfile(req.v1User.user_id);
    sendSuccess(res, data, 'Profil berhasil diambil.');
  } catch (error) {
    handleError(res, 'getProfile', error);
  }
};

export const updateProfile = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Auth (E01-E05)']
  // #swagger.summary = 'Perbarui profil akun yang sedang login'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }
    const data = await authService.updateProfile(req.v1User.user_id, req.body ?? {});
    sendSuccess(res, data, 'Profil berhasil diperbarui.');
  } catch (error) {
    handleError(res, 'updateProfile', error);
  }
};
