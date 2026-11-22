import { Request, Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { menuService } from '../services/menuService.js';
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

export const getCustomerMenus = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Menu']
  // #swagger.summary = 'E21: Daftar menu pre-order + ketersediaan + rekomendasi alternatif (DP harus Terkonfirmasi)'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }
    const data = await menuService.listForCustomerOrder(
      {
        reservasi_id: req.query.reservasi_id,
        kategori: req.query.kategori,
        search: req.query.search,
      },
      { userId: req.v1User.user_id, role: req.v1User.role }
    );
    sendSuccess(res, data, 'Daftar menu pre-order berhasil diambil.');
  } catch (error) {
    handleError(res, 'E21 getCustomerMenus', error);
  }
};

export const getPublicMenus = async (req: Request, res: Response): Promise<void> => {
  // #swagger.tags = ['Menu']
  // #swagger.summary = 'E07: Ambil daftar menu publik (filter kategori, pencarian, pagination)'
  try {
    const { items, meta } = await menuService.listPublic({
      kategori: req.query.kategori,
      search: req.query.search,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    const message =
      items.length === 0 ? 'Informasi belum tersedia' : 'Daftar menu publik berhasil diambil.';
    sendPaginated(res, items, meta, message);
  } catch (error) {
    handleError(res, 'E07 getPublicMenus', error);
  }
};

export const listAdminMenus = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Menu']
  // #swagger.summary = 'E34: Daftar menu admin dengan filter & pagination'
  try {
    const { items, meta } = await menuService.listAdmin({
      kategori: req.query.kategori,
      tersedia: req.query.tersedia,
      search: req.query.search,
      include_inactive: req.query.include_inactive,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    sendPaginated(res, items, meta, 'Daftar menu berhasil diambil.');
  } catch (error) {
    handleError(res, 'E34 listAdminMenus', error);
  }
};

export const createMenu = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Menu']
  // #swagger.summary = 'E35: Tambah menu baru + catat audit log'
  try {
    const data = await menuService.create(req.body ?? {}, getActor(req));
    sendSuccess(res, data, 'Menu berhasil ditambahkan.', 201);
  } catch (error) {
    handleError(res, 'E35 createMenu', error, true);
  }
};

export const updateMenu = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Menu']
  // #swagger.summary = 'E36: Ubah data menu / harga / ketersediaan + catat audit log'
  try {
    const data = await menuService.update(String(req.params.id), req.body ?? {}, getActor(req));
    sendSuccess(res, data, 'Data menu berhasil diperbarui.');
  } catch (error) {
    handleError(res, 'E36 updateMenu', error, true);
  }
};

export const deleteMenu = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Menu']
  // #swagger.summary = 'E37: Nonaktifkan (soft delete) menu + catat audit log'
  try {
    await menuService.remove(String(req.params.id), getActor(req));
    sendSuccess(res, null, 'Menu berhasil dinonaktifkan.');
  } catch (error) {
    handleError(res, 'E37 deleteMenu', error, true);
  }
};
