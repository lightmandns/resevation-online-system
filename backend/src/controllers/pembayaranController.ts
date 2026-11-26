import { Request, Response } from 'express';
import { V1AuthRequest } from '../middleware/v1AuthMiddleware.js';
import { pembayaranService } from '../services/pembayaranService.js';
import { sendSuccess, sendPaginated, sendError } from '../utils/apiResponse.js';
import { getClientIp, ServiceError } from '../utils/errors.js';
import { AuditActor } from '../utils/auditHelper.js';
import { parsePaymentProofMultipart } from '../utils/multipartUpload.js';

const getActor = (req: V1AuthRequest): AuditActor => ({
  userId: req.v1User?.user_id ?? null,
  userEmail: req.v1User?.email ?? 'system',
  ipAddress: getClientIp(req),
});

const handleError = (
  res: Response,
  tag: string,
  error: unknown,
  fallbackCode = 'ERR-SYS-01',
  fallbackMessage = 'Layanan sedang mengalami gangguan. Silakan coba kembali.',
  fallbackStatus = 503
): void => {
  if (error instanceof ServiceError) {
    sendError(res, error.statusCode, error.message, [
      { code: error.code, ...(error.field ? { field: error.field } : {}) },
    ]);
    return;
  }

  console.error(`[${tag} Error]`, error);
  sendError(res, fallbackStatus, fallbackMessage, [{ code: fallbackCode }]);
};

export const createPayment = async (req: V1AuthRequest, res: Response): Promise<void> => {
  // #swagger.tags = ['Pembayaran (E15-E20)']
  // #swagger.summary = 'E15: Mulai pembayaran DP atau Pelunasan via Midtrans Virtual Account (10 menit)'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/CreatePaymentRequest" }
          }
        }
     } */
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await pembayaranService.createPayment(
      String(req.params.id),
      req.body ?? {},
      { userId: req.v1User.user_id, role: req.v1User.role },
      getActor(req)
    );
    sendSuccess(res, data, 'Kode Virtual Account berhasil dibuat.', 201);
  } catch (error) {
    handleError(res, 'E15 createPayment', error);
  }
};

export const getReservationPayments = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Pembayaran (E15-E20)']
  // #swagger.summary = 'E16: Cek status pembayaran DP dan Pelunasan pada reservasi'
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await pembayaranService.getReservationPayments(
      String(req.params.id),
      req.query.jenis,
      { userId: req.v1User.user_id, role: req.v1User.role }
    );
    sendSuccess(res, data, 'Status pembayaran berhasil diambil.');
  } catch (error) {
    handleError(res, 'E16 getReservationPayments', error);
  }
};

export const handleMidtransCallback = async (
  req: Request,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Pembayaran (E15-E20)']
  // #swagger.summary = 'E17: Webhook / HTTP Notification dari Midtrans (verifikasi signature_key SHA-512)'
  // #swagger.security = []
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/MidtransCallbackRequest" }
          }
        }
     } */
  try {
    const data = await pembayaranService.handleMidtransCallback(
      req.body ?? {},
      getClientIp(req)
    );
    sendSuccess(res, data, 'Callback pembayaran diproses.');
  } catch (error) {
    handleError(
      res,
      'E17 handleMidtransCallback',
      error,
      'ERR-PAY-04',
      'Status pembayaran belum dapat diperbarui. Silakan periksa kembali beberapa saat lagi.',
      500
    );
  }
};

export const uploadTransferProof = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Pembayaran (E15-E20)']
  // #swagger.summary = 'E18: Unggah bukti transfer manual (jalur cadangan, JPG/PNG maks 10 MB)'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["jenis", "berkas_bukti"],
              properties: {
                jenis: {
                  type: "string",
                  enum: ["DP", "Pelunasan"],
                  example: "DP"
                },
                berkas_bukti: {
                  type: "string",
                  format: "binary"
                }
              }
            }
          }
        }
     } */
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const parsed = await parsePaymentProofMultipart(req);
    const data = await pembayaranService.uploadTransferProof(
      String(req.params.id),
      parsed.fields.jenis,
      parsed.file,
      { userId: req.v1User.user_id, role: req.v1User.role },
      getActor(req)
    );
    sendSuccess(res, data, 'Bukti transfer berhasil diunggah. Menunggu verifikasi Admin.');
  } catch (error) {
    handleError(
      res,
      'E18 uploadTransferProof',
      error,
      'ERR-SYS-01',
      'Berkas gagal diunggah, silakan coba lagi.',
      500
    );
  }
};

export const listAdminPayments = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Pembayaran (E15-E20)']
  // #swagger.summary = 'E19: Daftar pembayaran menunggu verifikasi manual (Admin/Manajer)'
  try {
    const { items, meta } = await pembayaranService.listAdminPayments({
      status: req.query.status,
      page: req.query.page,
      per_page: req.query.per_page,
    });
    sendPaginated(res, items, meta, 'Daftar pembayaran berhasil diambil.');
  } catch (error) {
    handleError(res, 'E19 listAdminPayments', error);
  }
};

export const verifyManualPayment = async (
  req: V1AuthRequest,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Pembayaran (E15-E20)']
  // #swagger.summary = 'E20: Setujui atau tolak bukti transfer manual (Admin/Manajer)'
  /* #swagger.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/VerifyManualPaymentRequest" }
          }
        }
     } */
  try {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const data = await pembayaranService.verifyManualPayment(
      String(req.params.id),
      req.body ?? {},
      req.v1User.user_id,
      getActor(req)
    );
    sendSuccess(res, data, 'Verifikasi pembayaran berhasil disimpan.');
  } catch (error) {
    handleError(res, 'E20 verifyManualPayment', error);
  }
};
