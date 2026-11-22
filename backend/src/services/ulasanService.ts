import { ulasanRepository } from '../repositories/ulasanRepository.js';
import { AuditActor } from '../utils/auditHelper.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const parseValidDateString = (raw: unknown, field: string): string => {
  const s = String(raw ?? '').trim();
  if (!DATE_ONLY_REGEX.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw new ServiceError(
      422,
      'ERR-VAL-02',
      'Format tanggal tidak valid (gunakan YYYY-MM-DD).',
      field
    );
  }
  return s;
};

export const ulasanService = {
  /**
   * E24 — GET /api/v1/reservations/:id/review-eligibility
   */
  async checkEligibility(
    reservasiId: string,
    requester: { userId: string; role: string }
  ): Promise<{ eligible: true }> {
    if (!isValidUuid(reservasiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const ctx = await ulasanRepository.getEligibilityContext(reservasiId);
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

    if (ctx.has_review > 0) {
      throw new ServiceError(
        403,
        'ERR-REV-01',
        'Ulasan belum dapat diberikan untuk reservasi ini (sudah_ada_ulasan).'
      );
    }

    const paymentOk =
      ctx.dp_confirmed > 0 &&
      (ctx.accepted_order_count === 0 || ctx.pelunasan_confirmed > 0);
    if (!paymentOk) {
      throw new ServiceError(
        403,
        'ERR-REV-01',
        'Ulasan belum dapat diberikan untuk reservasi ini (belum_terverifikasi).'
      );
    }

    if (new Date(ctx.jadwal_reservasi).getTime() > Date.now()) {
      throw new ServiceError(
        403,
        'ERR-REV-01',
        'Ulasan belum dapat diberikan untuk reservasi ini (jadwal_belum_lewat).'
      );
    }

    return { eligible: true };
  },

  /**
   * E25 — POST /api/v1/reservations/:id/reviews
   */
  async submitReview(
    reservasiId: string,
    body: Record<string, unknown>,
    requester: { userId: string; role: string },
    actor: AuditActor
  ) {
    if (!isValidUuid(reservasiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const ctx = await ulasanRepository.getEligibilityContext(reservasiId);
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

    if (ctx.has_review > 0) {
      throw new ServiceError(409, 'ERR-REV-01', 'Anda sudah memberikan ulasan.');
    }

    const paymentOk =
      ctx.dp_confirmed > 0 &&
      (ctx.accepted_order_count === 0 || ctx.pelunasan_confirmed > 0);
    if (!paymentOk || new Date(ctx.jadwal_reservasi).getTime() > Date.now()) {
      throw new ServiceError(
        403,
        'ERR-REV-01',
        'Ulasan belum dapat diberikan untuk reservasi ini.'
      );
    }

    const rating = Number(body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Pilih skor 1 sampai 5.',
        'rating'
      );
    }

    let komentar: string | null = null;
    if (body.komentar !== undefined && body.komentar !== null) {
      const trimmed = String(body.komentar).trim();
      if (trimmed.length > 1000) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Ulasan maksimal 1000 karakter.',
          'komentar'
        );
      }
      komentar = trimmed || null;
    }

    const created = await ulasanRepository.create(
      { reservasiId, rating, komentar },
      actor
    );

    return {
      ulasan_id: created.reservasi_id,
      reservasi_id: created.reservasi_id,
      rating: created.rating,
      komentar: created.komentar,
      created_at: created.created_at,
    };
  },

  /**
   * E50 — GET /api/v1/manager/reviews (Read-only Manajer)
   */
  async listForManager(query: {
    skor?: unknown;
    tanggal_dari?: unknown;
    tanggal_sampai?: unknown;
    page?: unknown;
    per_page?: unknown;
  }): Promise<{
    rata_rata: number;
    items: Array<{
      reservasi_id: string;
      nama_pelanggan: string;
      rating: number;
      komentar: string | null;
      jadwal_reservasi: Date;
      created_at: Date;
    }>;
    meta: PaginationMeta;
  }> {
    let skor: number | undefined;
    if (query.skor !== undefined && String(query.skor).trim() !== '') {
      const parsed = Number(query.skor);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
        throw new ServiceError(422, 'ERR-VAL-02', 'Filter skor harus 1 sampai 5.', 'skor');
      }
      skor = parsed;
    }

    let tanggalDari: string | undefined;
    let tanggalSampai: string | undefined;
    if (query.tanggal_dari !== undefined && String(query.tanggal_dari).trim() !== '') {
      tanggalDari = parseValidDateString(query.tanggal_dari, 'tanggal_dari');
    }
    if (query.tanggal_sampai !== undefined && String(query.tanggal_sampai).trim() !== '') {
      tanggalSampai = parseValidDateString(query.tanggal_sampai, 'tanggal_sampai');
    }
    if (tanggalDari && tanggalSampai && tanggalSampai < tanggalDari) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Rentang tanggal tidak valid.',
        'tanggal_sampai'
      );
    }

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total, rataRata } = await ulasanRepository.listForManager({
      skor,
      tanggalDari,
      tanggalSampai,
      offset,
      perPage,
    });

    return {
      rata_rata: rataRata,
      items: rows.map((row) => ({
        reservasi_id: row.reservasi_id,
        nama_pelanggan: row.nama_pelanggan,
        rating: row.rating,
        komentar: row.komentar,
        jadwal_reservasi: row.jadwal_reservasi,
        created_at: row.created_at,
      })),
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  },
};
