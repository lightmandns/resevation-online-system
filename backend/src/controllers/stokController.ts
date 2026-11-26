import { Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { stokService } from '../services/stokService.js';
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

export const listIngredientReceipts = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Stok & Bahan Masuk']
  // #swagger.summary = 'E42: Riwayat bahan masuk dan sisa stok tercatat (Admin/Inventaris/Manajer)'
  try {
    const { items, meta } = await stokService.listReceipts({
      tanggal_dari: req.query.tanggal_dari,
      tanggal_sampai: req.query.tanggal_sampai,
      nama_bahan: req.query.nama_bahan,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    const message =
      items.length === 0 ? 'Belum ada data stok' : 'Riwayat bahan masuk berhasil diambil.';
    sendPaginated(res, items, meta, message);
  } catch (error) {
    handleError(res, 'E42 listIngredientReceipts', error);
  }
};

export const createIngredientReceipt = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Stok & Bahan Masuk']
  // #swagger.summary = 'E43: Catat bahan masuk baru / tambah stok + catat audit log'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreateIngredientReceiptRequest" }
          }
        }
     } */
  try {
    const data = await stokService.recordStockIn(req.body ?? {}, getActor(req));
    sendSuccess(res, data, 'Bahan masuk berhasil dicatat.', 201);
  } catch (error) {
    handleError(res, 'E43 createIngredientReceipt', error, true);
  }
};

export const listInventoryStocks = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Stok & Bahan Masuk']
  // #swagger.summary = 'E44: Daftar catatan stok gudang (Petugas Inventaris/Admin/Manajer)'
  try {
    const { items, meta } = await stokService.listStocks({
      nama_bahan: req.query.nama_bahan,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    const message =
      items.length === 0 ? 'Belum ada data stok' : 'Catatan stok gudang berhasil diambil.';
    sendPaginated(res, items, meta, message);
  } catch (error) {
    handleError(res, 'E44 listInventoryStocks', error);
  }
};

export const updateInventoryStock = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Stok & Bahan Masuk']
  // #swagger.summary = 'E45: Perbarui jumlah stok gudang (>= 0) + catat audit log'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/UpdateStockQuantityRequest" }
          }
        }
     } */
  try {
    const data = await stokService.updateStockQuantity(
      String(req.params.id),
      req.body ?? {},
      getActor(req)
    );
    sendSuccess(res, data, 'Jumlah stok berhasil diperbarui.');
  } catch (error) {
    handleError(res, 'E45 updateInventoryStock', error, true);
  }
};
