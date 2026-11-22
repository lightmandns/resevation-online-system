import crypto from 'crypto';
import { ServiceError } from './errors.js';

export type SupportedVaBank = 'bca' | 'bni' | 'bri' | 'permata';

export interface MidtransChargeParams {
  orderId: string;
  grossAmount: number;
  bank: SupportedVaBank;
  expiryMinutes: number;
  customer?: {
    first_name?: string;
    email?: string;
    phone?: string;
  };
}

export interface MidtransChargeResult {
  transactionId: string;
  vaNumber: string;
  expiryTime?: string;
  rawStatus: string;
}

const getMidtransBaseUrl = (): string => {
  return process.env.MIDTRANS_IS_PRODUCTION === 'true'
    ? 'https://api.midtrans.com'
    : 'https://api.sandbox.midtrans.com';
};

export const midtransClient = {
  /**
   * Memanggil Midtrans Core API /v2/charge untuk menerbitkan Virtual Account (Sandbox/Production).
   */
  async chargeBankTransferVa(params: MidtransChargeParams): Promise<MidtransChargeResult> {
    const serverKey = (process.env.MIDTRANS_SERVER_KEY || '').trim();
    if (!serverKey) {
      throw new ServiceError(
        503,
        'ERR-PAY-01',
        'Layanan pembayaran sedang mengalami gangguan (Midtrans Server Key belum dikonfigurasi).'
      );
    }

    const baseUrl = getMidtransBaseUrl();
    const authHeader = `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`;

    const payload: Record<string, unknown> = {
      payment_type: params.bank === 'permata' ? 'permata' : 'bank_transfer',
      transaction_details: {
        order_id: params.orderId,
        gross_amount: Math.round(params.grossAmount),
      },
      custom_expiry: {
        expiry_duration: params.expiryMinutes,
        unit: 'minute',
      },
    };

    if (params.bank !== 'permata') {
      payload.bank_transfer = { bank: params.bank };
    }

    if (params.customer) {
      payload.customer_details = params.customer;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${baseUrl}/v2/charge`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const body = (await response.json()) as Record<string, unknown>;
      const statusCode = String(body.status_code ?? response.status);

      if (!response.ok || (statusCode !== '201' && statusCode !== '200')) {
        console.error('[Midtrans Charge Failed]', statusCode, body);
        throw new ServiceError(
          503,
          'ERR-PAY-01',
          'Layanan pembayaran sedang mengalami gangguan. Silakan coba kembali.'
        );
      }

      let vaNumber = '';
      if (params.bank === 'permata' && typeof body.permata_va_number === 'string') {
        vaNumber = body.permata_va_number;
      } else if (Array.isArray(body.va_numbers) && body.va_numbers.length > 0) {
        const first = body.va_numbers[0] as Record<string, unknown>;
        vaNumber = String(first.va_number ?? '');
      }

      const transactionId = String(body.transaction_id ?? '');
      if (!vaNumber || !transactionId) {
        console.error('[Midtrans Unexpected Response]', body);
        throw new ServiceError(
          503,
          'ERR-PAY-01',
          'Layanan pembayaran sedang mengalami gangguan. Silakan coba kembali.'
        );
      }

      return {
        transactionId,
        vaNumber,
        expiryTime: typeof body.expiry_time === 'string' ? body.expiry_time : undefined,
        rawStatus: String(body.transaction_status ?? 'pending'),
      };
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      console.error('[Midtrans Network Error]', error);
      throw new ServiceError(
        503,
        'ERR-PAY-01',
        'Layanan pembayaran sedang mengalami gangguan. Silakan coba kembali.'
      );
    } finally {
      clearTimeout(timeout);
    }
  },

  /**
   * Verifikasi keaslian HTTP Notification Midtrans:
   * signature_key = SHA-512(order_id + status_code + gross_amount + MIDTRANS_SERVER_KEY)
   */
  verifySignatureKey(params: {
    orderId: string;
    statusCode: string;
    grossAmount: string;
    signatureKey: string;
  }): boolean {
    const serverKey = (process.env.MIDTRANS_SERVER_KEY || '').trim();
    if (!serverKey || !params.signatureKey) {
      return false;
    }

    const raw = `${params.orderId}${params.statusCode}${params.grossAmount}${serverKey}`;
    const expectedHex = crypto.createHash('sha512').update(raw).digest('hex');

    const expectedBuf = Buffer.from(expectedHex, 'utf8');
    const actualBuf = Buffer.from(params.signatureKey.trim().toLowerCase(), 'utf8');
    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  },
};
