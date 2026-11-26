import { Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { blokMejaService } from '../services/blokMejaService.js';
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

export const getBlocksAvailability = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Blok Meja']
  // #swagger.summary = 'E10: Denah blok meja beserta status ketersediaan (kosong/terisi/ditahan) pada jadwal terpilih'
  try {
    const data = await blokMejaService.getAvailability(req.query.jadwal);
    sendSuccess(res, data, 'Ketersediaan blok meja berhasil diambil.');
  } catch (error) {
    handleError(res, 'E10 getBlocksAvailability', error);
  }
};

export const listAdminBlocks = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Blok Meja']
  // #swagger.summary = 'E30: Daftar blok meja beserta status terkunci (Admin/Manajer)'
  try {
    const { items, meta } = await blokMejaService.listAdmin({
      include_inactive: req.query.include_inactive,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    sendPaginated(res, items, meta, 'Daftar blok meja berhasil diambil.');
  } catch (error) {
    handleError(res, 'E30 listAdminBlocks', error);
  }
};

export const createBlock = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Blok Meja']
  // #swagger.summary = 'E31: Tambah blok meja baru + catat audit log'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateBlockRequest" }
          }
        }
     } */
  try {
    const data = await blokMejaService.create(req.body ?? {}, getActor(req));
    sendSuccess(res, data, 'Blok meja berhasil ditambahkan.', 201);
  } catch (error) {
    handleError(res, 'E31 createBlock', error, true);
  }
};

export const updateBlock = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Blok Meja']
  // #swagger.summary = 'E32: Ubah data blok meja / nominal DP / ketersediaan + catat audit log'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/UpdateBlockRequest" }
          }
        }
     } */
  try {
    const data = await blokMejaService.update(
      String(req.params.id),
      req.body ?? {},
      getActor(req)
    );
    sendSuccess(res, data, 'Data blok meja berhasil diperbarui.');
  } catch (error) {
    handleError(res, 'E32 updateBlock', error, true);
  }
};

export const deleteBlock = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Blok Meja']
  // #swagger.summary = 'E33: Hapus (soft delete) blok meja + catat audit log'
  try {
    await blokMejaService.remove(String(req.params.id), getActor(req));
    sendSuccess(res, null, 'Blok berhasil dihapus.');
  } catch (error) {
    handleError(res, 'E33 deleteBlock', error, true);
  }
};
