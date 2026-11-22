import { pembayaranRepository, PembayaranRow } from '../repositories/pembayaranRepository.js';
import { midtransClient, SupportedVaBank } from '../utils/midtransClient.js';
import { savePaymentProofFile } from '../utils/multipartUpload.js';
import { AuditActor, recordSecurityAudit } from '../utils/auditHelper.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

const SUPPORTED_BANKS: SupportedVaBank[] = ['bca', 'bni', 'bri', 'permata'];

const normalizeJenis = (raw: unknown): 'DP' | 'Pelunasan' => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'dp') return 'DP';
  if (s === 'pelunasan') return 'Pelunasan';
  throw new ServiceError(
    422,
    'ERR-VAL-02',
    'Jenis pembayaran harus DP atau Pelunasan.',
    'jenis'
  );
};

const normalizeBank = (raw: unknown): SupportedVaBank => {
  const s = String(raw ?? '').trim().toLowerCase() as SupportedVaBank;
  if (SUPPORTED_BANKS.includes(s)) return s;
  throw new ServiceError(
    422,
    'ERR-VAL-02',
    'Pilih bank Virtual Account yang didukung (bca, bni, bri, permata).',
    'bank'
  );
};

const formatPayment = (row: PembayaranRow) => ({
  pembayaran_id: row.payment_id,
  reservasi_id: row.reservasi_id,
  jenis: row.jenis_pembayaran,
  metode: row.metode_pembayaran,
  bank: row.bank,
  nominal: Number(row.nominal),
  kode_va: row.kode_va,
  id_transaksi_gateway: row.referensi_transaksi,
  link_bukti_transfer: row.link_bukti_transfer,
  status_pembayaran: row.status,
  waktu_kadaluarsa: row.waktu_kadaluarsa,
  paid_at: row.paid_at,
  catatan_verifikasi: row.catatan_verifikasi,
});

export const pembayaranService = {
  /**
   * E15 — POST /api/v1/reservations/:id/payments
   */
  async createPayment(
    reservasiId: string,
    body: Record<string, unknown>,
    requester: { userId: string; role: string },
    actor: AuditActor
  ) {
    if (!isValidUuid(reservasiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    if (body.setuju_ketentuan !== true) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Anda wajib menyetujui ketentuan bahwa transaksi tidak dapat di-refund.',
        'setuju_ketentuan'
      );
    }

    const jenis = normalizeJenis(body.jenis);
    const bank = normalizeBank(body.bank);

    const ctx = await pembayaranRepository.getReservationContext(reservasiId);
    if (!ctx) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    if (
      requester.role.toLowerCase() !== 'manajer' &&
      ctx.user_id.toLowerCase() !== requester.userId.toLowerCase()
    ) {
      throw new ServiceError(
        403,
        'ERR-AUTH-03',
        'Anda tidak memiliki izin untuk mengakses fitur ini'
      );
    }

    const existingActive = await pembayaranRepository.findActivePayment(reservasiId, jenis);
    if (existingActive) {
      throw new ServiceError(
        409,
        'ERR-PAY-03',
        `Pembayaran ${jenis} sudah dibuat dengan status ${existingActive.status}.`
      );
    }

    const settings = await pembayaranRepository.getPaymentSettings();
    const nowMs = Date.now();
    let nominal = 0;
    let waktuKadaluarsa: Date;
    let expiryMinutes = settings.batas_waktu_dp_menit;

    if (jenis === 'DP') {
      if (ctx.status_reservasi !== 'MenungguPembayaran') {
        throw new ServiceError(
          409,
          'ERR-PAY-03',
          'Status reservasi tidak sesuai untuk pembayaran DP.'
        );
      }
      const holdMs = ctx.batas_penahanan ? new Date(ctx.batas_penahanan).getTime() : 0;
      if (holdMs <= nowMs) {
        throw new ServiceError(
          409,
          'ERR-PAY-03',
          'Waktu pembayaran telah habis. Reservasi tidak dapat dilanjutkan.'
        );
      }
      nominal = Number(ctx.total_dp_blok);
      waktuKadaluarsa = new Date(holdMs);
      expiryMinutes = Math.max(1, Math.ceil((holdMs - nowMs) / 60000));
    } else {
      // Pelunasan Menu
      if (ctx.status_reservasi !== 'Terkonfirmasi') {
        throw new ServiceError(
          409,
          'ERR-PAY-03',
          'Pelunasan hanya dapat dibuat setelah pembayaran DP terkonfirmasi.'
        );
      }
      const jadwalMs = new Date(ctx.jadwal_reservasi).getTime();
      const deadlineMs = jadwalMs - settings.batas_submit_menu_hari * 24 * 60 * 60 * 1000;
      if (nowMs > deadlineMs) {
        throw new ServiceError(
          422,
          'ERR-MENU-07',
          'Batas waktu pemesanan dan pelunasan menu (H-1) telah terlewati.'
        );
      }
      if (ctx.pending_request_count > 0) {
        throw new ServiceError(
          409,
          'ERR-MENU-05',
          'Pelunasan belum dapat dibayar, menunggu keputusan Admin atas menu request.'
        );
      }
      if (ctx.accepted_order_count === 0 || Number(ctx.total_pelunasan_menu) <= 0) {
        throw new ServiceError(
          409,
          'ERR-MENU-05',
          'Belum ada pesanan menu yang diterima untuk dilunasi.'
        );
      }
      nominal = Number(ctx.total_pelunasan_menu);
      expiryMinutes = settings.batas_waktu_pelunasan_menit;
      waktuKadaluarsa = new Date(nowMs + expiryMinutes * 60 * 1000);
    }

    // 1. Insert baris pembayaran pending agar mendapat payment_id (UUID) sebagai order_id Midtrans
    const pendingRow = await pembayaranRepository.createPendingVaPayment({
      reservasiId,
      jenis,
      bank,
      nominal,
      waktuKadaluarsa,
    });

    // 2. Panggil Midtrans Core API (Sandbox / Production)
    try {
      const chargeResult = await midtransClient.chargeBankTransferVa({
        orderId: pendingRow.payment_id,
        grossAmount: nominal,
        bank,
        expiryMinutes,
        customer: {
          first_name: ctx.nama_pemesan,
          email: ctx.email_pemesan,
          phone: ctx.no_whatsapp,
        },
      });

      const updated = await pembayaranRepository.attachGatewayVaDetails(
        pendingRow.payment_id,
        chargeResult.vaNumber,
        chargeResult.transactionId,
        actor
      );

      return formatPayment(updated);
    } catch (error) {
      await pembayaranRepository.abortFailedChargeRow(pendingRow.payment_id);
      throw error;
    }
  },

  /**
   * E16 — GET /api/v1/reservations/:id/payments
   */
  async getReservationPayments(
    reservasiId: string,
    rawJenis: unknown,
    requester: { userId: string; role: string }
  ) {
    if (!isValidUuid(reservasiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const ctx = await pembayaranRepository.getReservationContext(reservasiId);
    if (!ctx) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    if (
      requester.role.toLowerCase() !== 'manajer' &&
      ctx.user_id.toLowerCase() !== requester.userId.toLowerCase()
    ) {
      throw new ServiceError(
        403,
        'ERR-AUTH-03',
        'Anda tidak memiliki izin untuk mengakses fitur ini'
      );
    }

    let jenis: 'DP' | 'Pelunasan' | undefined;
    if (rawJenis !== undefined && String(rawJenis).trim() !== '') {
      jenis = normalizeJenis(rawJenis);
    }

    const rows = await pembayaranRepository.listByReservation(reservasiId, jenis);
    if (rows.length === 0) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Belum ada data pembayaran untuk reservasi ini.');
    }

    return rows.map(formatPayment);
  },

  /**
   * E17 — POST /api/v1/payments/gateway/callback (Midtrans HTTP Notification)
   */
  async handleMidtransCallback(
    body: Record<string, unknown>,
    ipAddress: string
  ): Promise<{ hasil: 'diproses' | 'duplikat' | 'diabaikan' }> {
    const orderId = String(body.order_id ?? '').trim();
    const transactionId = String(body.transaction_id ?? '').trim();
    const transactionStatus = String(body.transaction_status ?? '').trim().toLowerCase();
    const statusCode = String(body.status_code ?? '').trim();
    const grossAmount = String(body.gross_amount ?? '').trim();
    const signatureKey = String(body.signature_key ?? '').trim();

    // 1. Verifikasi signature_key SHA-512 Midtrans
    const isValidSig = midtransClient.verifySignatureKey({
      orderId,
      statusCode,
      grossAmount,
      signatureKey,
    });

    if (!isValidSig) {
      void recordSecurityAudit({
        actor: { userEmail: 'midtrans-webhook', ipAddress },
        actionType: 'ACCESS_DENIED',
        resourceType: 'pembayaran',
        newValues: { reason: 'INVALID_MIDTRANS_SIGNATURE', order_id: orderId },
      });
      throw new ServiceError(401, 'ERR-PAY-05', 'Signature callback tidak valid.');
    }

    if (transactionStatus === 'pending') {
      return { hasil: 'diabaikan' };
    }

    if (!isValidUuid(orderId)) {
      return { hasil: 'diabaikan' };
    }

    const existing = await pembayaranRepository.findById(orderId);
    if (!existing) {
      return { hasil: 'diabaikan' };
    }

    if (existing.status !== 'Menunggu') {
      return { hasil: 'duplikat' };
    }

    const gatewayActor: AuditActor = {
      userId: null,
      userEmail: 'system',
      ipAddress,
    };

    // 2. Cek kesesuaian nominal
    const parsedGross = Number.parseFloat(grossAmount);
    if (!Number.isNaN(parsedGross) && Math.abs(parsedGross - Number(existing.nominal)) > 0.01) {
      await pembayaranRepository.processGatewayCallback({
        paymentId: orderId,
        referensiTransaksi: transactionId,
        outcome: 'AMOUNT_MISMATCH',
        catatan: `Nominal callback Midtrans (${grossAmount}) tidak sesuai tagihan (${existing.nominal}). Perlu cek manual Admin.`,
        actor: gatewayActor,
      });
      return { hasil: 'diproses' };
    }

    // 3. Pemetaan status Midtrans
    let outcome: 'PAID' | 'FAILED' | 'EXPIRED' | null = null;
    if (transactionStatus === 'settlement' || transactionStatus === 'capture') {
      outcome = 'PAID';
    } else if (
      transactionStatus === 'deny' ||
      transactionStatus === 'cancel' ||
      transactionStatus === 'failure'
    ) {
      outcome = 'FAILED';
    } else if (transactionStatus === 'expire') {
      outcome = 'EXPIRED';
    }

    if (!outcome) {
      return { hasil: 'diabaikan' };
    }

    const hasil = await pembayaranRepository.processGatewayCallback({
      paymentId: orderId,
      referensiTransaksi: transactionId,
      outcome,
      actor: gatewayActor,
    });

    return { hasil };
  },

  /**
   * E18 — POST /api/v1/reservations/:id/payments/proof (Unggah bukti transfer cadangan)
   */
  async uploadTransferProof(
    reservasiId: string,
    rawJenis: unknown,
    file: { buffer: Buffer; extension: '.jpg' | '.png' } | undefined,
    requester: { userId: string; role: string },
    actor: AuditActor
  ) {
    if (!isValidUuid(reservasiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    if (!file) {
      throw new ServiceError(
        422,
        'ERR-FILE-01',
        'Berkas harus berformat JPG atau PNG dengan ukuran maksimal 10 MB.',
        'berkas_bukti'
      );
    }

    const jenis = normalizeJenis(rawJenis || 'DP');
    const ctx = await pembayaranRepository.getReservationContext(reservasiId);
    if (!ctx) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    if (
      requester.role.toLowerCase() !== 'manajer' &&
      ctx.user_id.toLowerCase() !== requester.userId.toLowerCase()
    ) {
      throw new ServiceError(
        403,
        'ERR-AUTH-03',
        'Anda tidak memiliki izin untuk mengakses fitur ini'
      );
    }

    const active = await pembayaranRepository.findActivePayment(reservasiId, jenis);
    if (active && active.status !== 'Menunggu') {
      throw new ServiceError(
        409,
        'ERR-PAY-03',
        `Pembayaran ${jenis} sudah berstatus ${active.status}.`
      );
    }

    const nowMs = Date.now();
    if (active && new Date(active.waktu_kadaluarsa).getTime() <= nowMs) {
      throw new ServiceError(
        409,
        'ERR-PAY-03',
        'Waktu pembayaran telah habis. Reservasi tidak dapat dilanjutkan.'
      );
    }

    const settings = await pembayaranRepository.getPaymentSettings();
    let nominal = 0;
    let waktuKadaluarsa: Date;

    if (jenis === 'DP') {
      if (ctx.status_reservasi !== 'MenungguPembayaran') {
        throw new ServiceError(
          409,
          'ERR-PAY-03',
          'Status reservasi tidak sesuai untuk unggah bukti DP.'
        );
      }
      const holdMs = ctx.batas_penahanan ? new Date(ctx.batas_penahanan).getTime() : 0;
      if (holdMs <= nowMs) {
        throw new ServiceError(
          409,
          'ERR-PAY-03',
          'Waktu pembayaran telah habis. Reservasi tidak dapat dilanjutkan.'
        );
      }
      nominal = Number(ctx.total_dp_blok);
      waktuKadaluarsa = new Date(holdMs);
    } else {
      if (ctx.status_reservasi !== 'Terkonfirmasi') {
        throw new ServiceError(
          409,
          'ERR-PAY-03',
          'Pelunasan hanya dapat dilakukan setelah DP terkonfirmasi.'
        );
      }
      if (ctx.pending_request_count > 0 || ctx.accepted_order_count === 0) {
        throw new ServiceError(
          409,
          'ERR-MENU-05',
          'Pelunasan belum dapat dibayar, periksa status pesanan menu Anda.'
        );
      }
      nominal = Number(ctx.total_pelunasan_menu);
      waktuKadaluarsa = new Date(
        nowMs + settings.batas_waktu_pelunasan_menit * 60 * 1000
      );
    }

    const savedPath = await savePaymentProofFile(file.buffer, file.extension);

    const updated = await pembayaranRepository.submitTransferProof({
      reservasiId,
      jenis,
      nominal,
      waktuKadaluarsa,
      buktiPath: savedPath,
      existingPending: active,
      oldReservasiStatus: ctx.status_reservasi,
      userId: requester.userId,
      actor,
    });

    return {
      pembayaran_id: updated.payment_id,
      jenis: updated.jenis_pembayaran,
      status_pembayaran: updated.status,
      link_bukti_transfer: updated.link_bukti_transfer,
    };
  },

  /**
   * E19 — GET /api/v1/admin/payments
   */
  async listAdminPayments(query: {
    status?: unknown;
    page?: unknown;
    per_page?: unknown;
  }): Promise<{ items: unknown[]; meta: PaginationMeta }> {
    const rawStatus = String(query.status ?? 'MenungguVerifikasi').trim();
    const status =
      rawStatus.toLowerCase() === 'menunggu_verifikasi'
        ? 'MenungguVerifikasi'
        : rawStatus === 'all'
          ? undefined
          : rawStatus;

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total } = await pembayaranRepository.listAdminPayments({
      status,
      offset,
      perPage,
    });

    const items = rows.map((row) => ({
      pembayaran_id: row.payment_id,
      reservasi_id: row.reservasi_id,
      nama_pelanggan: row.nama_pelanggan,
      no_whatsapp: row.no_whatsapp,
      jadwal_reservasi: row.jadwal_reservasi,
      jenis_pembayaran: row.jenis_pembayaran,
      metode_pembayaran: row.metode_pembayaran,
      nominal: Number(row.nominal),
      bukti_url: row.link_bukti_transfer,
      status_pembayaran: row.status,
      status_reservasi: row.status_reservasi,
      waktu_unggah: row.updated_at,
    }));

    return {
      items,
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  },

  /**
   * E20 — POST /api/v1/admin/payments/:id/verification
   */
  async verifyManualPayment(
    paymentId: string,
    body: Record<string, unknown>,
    adminId: string,
    actor: AuditActor
  ) {
    if (!isValidUuid(paymentId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const rawKeputusan = String(body.keputusan ?? '').trim().toLowerCase();
    let keputusan: 'setuju' | 'tolak';
    if (rawKeputusan === 'setuju' || rawKeputusan === 'terima') {
      keputusan = 'setuju';
    } else if (rawKeputusan === 'tolak') {
      keputusan = 'tolak';
    } else {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Keputusan harus setuju atau tolak.',
        'keputusan'
      );
    }

    const catatan =
      body.catatan !== undefined && body.catatan !== null
        ? String(body.catatan).trim()
        : '';

    if (keputusan === 'tolak' && !catatan) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Catatan wajib diisi saat menolak pembayaran.',
        'catatan'
      );
    }
    if (catatan.length > 500) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Catatan maksimal 500 karakter.',
        'catatan'
      );
    }

    return pembayaranRepository.verifyManualPayment({
      paymentId,
      adminId,
      keputusan,
      catatan: catatan || null,
      actor,
    });
  },
};
