import { Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { pesananService } from '../services/pesananService.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/apiResponse.js';
import { getClientIp, ServiceError } from '../utils/errors.js';
import { AuditActor } from '../utils/auditHelper.js';

const getActor = (req: V1AuthRequest): AuditActor => ({
  userId: req.v1User?.user_id ?? null,
  userEmail: req.v1User?.email ?? 'system',
  ipAddress: getClientIp(req),
});

const handleError = (
  res: Response,
  tag: string,
  error: unknown,
  isCreateOrder = false
): void => {
  if (error instanceof ServiceError) {
    sendError(res, error.statusCode, error.message, [
      { code: error.code, ...(error.field ? { field: error.field } : {}) },
    ]);
    return;
  }

  console.error(`[${tag} Error]`, error);
  if (isCreateOrder) {
    sendError(res, 500, 'Pesanan menu belum berhasil disimpan, silakan coba lagi.', [
      { code: 'ERR-MENU-02' },
    ]);
    return;
  }

  sendError(res, 503, 'Layanan sedang mengalami gangguan. Silakan coba kembali.', [
    { code: 'ERR-SYS-01' },
  ]);
};

export const createReservationOrders = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Pesanan Menu (E22-E23, E55-E56)']
  // #swagger.summary = 'E22: Kirim pesanan menu pre-order katalog & menu request (maks H-1)'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await pesananService.createOrders(
      String(req.params.id),
      req.body ?? {},
      { userId: req.v1User.user_id, role: req.v1User.role },
      getActor(req)
    );
    sendSuccess(res, data, 'Pesanan menu berhasil disimpan.', 201);
  } catch (error) {
    handleError(res, 'E22 createReservationOrders', error, true);
  }
};

export const getReservationOrders = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Pesanan Menu (E22-E23, E55-E56)']
  // #swagger.summary = 'E23: Lihat daftar pesanan pre-order dan estimasi total pada reservasi'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await pesananService.listMyOrders(String(req.params.id), {
      userId: req.v1User.user_id,
      role: req.v1User.role,
    });
    const message =
      data.pesanan.length === 0
        ? 'Belum ada pesanan menu'
        : 'Daftar pesanan menu berhasil diambil.';
    sendSuccess(res, data, message);
  } catch (error) {
    handleError(res, 'E23 getReservationOrders', error);
  }
};

export const listAdminMenuRequests = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Pesanan Menu (E22-E23, E55-E56)']
  // #swagger.summary = 'E55: Daftar menu request yang diajukan Customer (Admin/Manajer)'
  try {
    const { items, meta } = await pesananService.listAdminMenuRequests({
      status: req.query.status,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    sendPaginated(res, items, meta, 'Daftar menu request berhasil diambil.');
  } catch (error) {
    handleError(res, 'E55 listAdminMenuRequests', error);
  }
};

export const decideMenuRequest = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Pesanan Menu (E22-E23, E55-E56)']
  // #swagger.summary = 'E56: Admin terima (set harga satuan) atau tolak menu request'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await pesananService.decideMenuRequest(
      String(req.params.id),
      req.body ?? {},
      req.v1User.user_id,
      getActor(req)
    );
    sendSuccess(res, data, 'Keputusan menu request berhasil disimpan.');
  } catch (error) {
    handleError(res, 'E56 decideMenuRequest', error);
  }
};
