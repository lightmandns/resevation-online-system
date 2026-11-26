import { Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { reservasiService } from '../services/reservasiService.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/apiResponse.js';
import { getClientIp, ServiceError } from '../utils/errors.js';
import { AuditActor } from '../utils/auditHelper.js';

const getActor = (req: V1AuthRequest): AuditActor => ({
  userId: req.v1User?.user_id ?? null,
  userEmail: req.v1User?.email ?? 'system',
  ipAddress: getClientIp(req),
});

const handleError = (res: Response, tag: string, error: unknown, isCreate = false): void => {
  if (error instanceof ServiceError) {
    sendError(res, error.statusCode, error.message, [
      { code: error.code, ...(error.field ? { field: error.field } : {}) },
    ]);
    return;
  }

  console.error(`[${tag} Error]`, error);
  if (isCreate) {
    sendError(res, 500, 'Reservasi belum berhasil dibuat. Silakan coba kembali.', [
      { code: 'ERR-RES-03' },
    ]);
    return;
  }

  sendError(res, 503, 'Layanan sedang mengalami gangguan. Silakan coba kembali.', [
    { code: 'ERR-SYS-01' },
  ]);
};

export const getServiceOptions = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Reservasi']
  // #swagger.summary = 'E09: Pilihan layanan (Reguler/Khusus) dan kontak WhatsApp Admin'
  try {
    const data = await reservasiService.getServiceOptions();
    sendSuccess(res, data, 'Pilihan layanan reservasi berhasil diambil.');
  } catch (error) {
    handleError(res, 'E09 getServiceOptions', error);
  }
};

export const createRegularReservation = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Reservasi']
  // #swagger.summary = 'E11: Buat reservasi reguler secara atomik & tahan blok selama 10 menit'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateRegularReservationRequest" }
          }
        }
     } */
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }
    const data = await reservasiService.createRegular(
      req.v1User.user_id,
      req.body ?? {},
      getActor(req)
    );
    sendSuccess(res, data, 'Reservasi berhasil dibuat. Segera selesaikan pembayaran DP.', 201);
  } catch (error) {
    handleError(res, 'E11 createRegularReservation', error, true);
  }
};

export const listMyReservations = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Reservasi']
  // #swagger.summary = 'E12: Daftar reservasi milik Customer sendiri + tombol aksi tersedia'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }
    const { items, meta } = await reservasiService.listMyReservations(req.v1User.user_id, {
      status: req.query.status,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    sendPaginated(res, items, meta, 'Daftar reservasi Anda berhasil diambil.');
  } catch (error) {
    handleError(res, 'E12 listMyReservations', error);
  }
};

export const getMyReservationDetail = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Reservasi']
  // #swagger.summary = 'E13: Detail reservasi milik sendiri (blok, pembayaran, pesanan, riwayat)'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }
    const data = await reservasiService.getMyReservationDetail(String(req.params.id), {
      userId: req.v1User.user_id,
      role: req.v1User.role,
    });
    sendSuccess(res, data, 'Detail reservasi berhasil diambil.');
  } catch (error) {
    handleError(res, 'E13 getMyReservationDetail', error);
  }
};

export const getReservationReceipt = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Reservasi']
  // #swagger.summary = 'E14: Lihat E-Receipt reservasi (hanya status Terkonfirmasi atau Selesai)'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }
    const data = await reservasiService.getReceipt(String(req.params.id), {
      userId: req.v1User.user_id,
      role: req.v1User.role,
    });
    sendSuccess(res, data, 'E-Receipt berhasil diambil.');
  } catch (error) {
    handleError(res, 'E14 getReservationReceipt', error);
  }
};

export const listAdminActiveReservations = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Reservasi']
  // #swagger.summary = 'E26: Daftar reservasi berjalan diurutkan dari tanggal terdekat (Admin/Manajer)'
  try {
    const { items, meta } = await reservasiService.listAdminReservations('active', {
      tanggal: req.query.tanggal,
      nama_pelanggan: req.query.nama_pelanggan,
      status: req.query.status,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    const message =
      items.length === 0 ? 'Data tidak ditemukan' : 'Daftar reservasi berjalan berhasil diambil.';
    sendPaginated(res, items, meta, message);
  } catch (error) {
    handleError(res, 'E26 listAdminActiveReservations', error);
  }
};

export const listAdminReservationHistory = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Reservasi']
  // #swagger.summary = 'E27: Riwayat reservasi selesai/dibatalkan diurutkan terbaru ke terlama (Admin/Manajer)'
  try {
    const { items, meta } = await reservasiService.listAdminReservations('history', {
      tanggal: req.query.tanggal,
      nama_pelanggan: req.query.nama_pelanggan,
      status: req.query.status,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    const message =
      items.length === 0 ? 'Data tidak ditemukan' : 'Riwayat reservasi berhasil diambil.';
    sendPaginated(res, items, meta, message);
  } catch (error) {
    handleError(res, 'E27 listAdminReservationHistory', error);
  }
};

export const getAdminReservationDetail = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Reservasi']
  // #swagger.summary = 'E28: Detail lengkap reservasi + pesanan menu dapur + pembayaran (Admin/Manajer)'
  try {
    const data = await reservasiService.getAdminReservationDetail(String(req.params.id));
    sendSuccess(res, data, 'Detail reservasi berhasil diambil.');
  } catch (error) {
    handleError(res, 'E28 getAdminReservationDetail', error);
  }
};

export const createSpecialReservation = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Reservasi']
  // #swagger.summary = 'E29: Input reservasi layanan khusus oleh Admin (hasil diskusi WhatsApp)'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateSpecialReservationRequest" }
          }
        }
     } */
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }
    const data = await reservasiService.createSpecialReservation(
      req.v1User.user_id,
      req.body ?? {},
      getActor(req)
    );
    sendSuccess(res, data, 'Reservasi layanan khusus berhasil disimpan.', 201);
  } catch (error) {
    handleError(res, 'E29 createSpecialReservation', error, true);
  }
};
