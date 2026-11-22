import { promosiRepository, PromosiRow } from '../repositories/promosiRepository.js';
import { AuditActor } from '../utils/auditHelper.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

const formatPublicPromosi = (row: PromosiRow) => ({
  id: row.promosi_id,
  judul: row.judul,
  deskripsi: row.deskripsi,
  gambar_url: row.link_foto,
  tanggal_mulai: row.periode_mulai,
  tanggal_selesai: row.periode_selesai,
});

const formatAdminPromosi = (row: PromosiRow) => ({
  id: row.promosi_id,
  promosi_id: row.promosi_id,
  judul: row.judul,
  deskripsi: row.deskripsi,
  gambar_url: row.link_foto,
  tanggal_mulai: row.periode_mulai,
  tanggal_selesai: row.periode_selesai,
  aktif: Boolean(row.is_active),
  created_at: row.created_at,
});

const parseOptionalBoolean = (val: unknown, field: string): boolean | undefined => {
  if (val === undefined || val === '') return undefined;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  throw new ServiceError(422, 'ERR-VAL-02', 'Periksa kembali data Anda.', field);
};

export const promosiService = {
  /**
   * E08 — GET /api/v1/public/promotions
   */
  async listPublicActive() {
    const rows = await promosiRepository.listPublicActive();
    return rows.map(formatPublicPromosi);
  },

  /**
   * E38 — GET /api/v1/admin/promotions
   */
  async listAdmin(query: {
    aktif?: unknown;
    page?: unknown;
    per_page?: unknown;
  }): Promise<{ items: ReturnType<typeof formatAdminPromosi>[]; meta: PaginationMeta }> {
    const aktif = parseOptionalBoolean(query.aktif, 'aktif');
    const { page, perPage, offset } = parsePagination(query.page, query.per_page);

    const { rows, total } = await promosiRepository.listAdmin({
      aktif,
      offset,
      perPage,
    });

    return {
      items: rows.map(formatAdminPromosi),
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  },

  /**
   * E39 — POST /api/v1/admin/promotions
   */
  async create(body: Record<string, unknown>, actor: AuditActor) {
    const judul = String(body.judul ?? '').trim();
    if (!judul || judul.length > 150) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Judul promosi wajib diisi (maksimal 150 karakter).',
        'judul'
      );
    }

    const deskripsi = String(body.deskripsi ?? '').trim();
    if (!deskripsi || deskripsi.length > 1000) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Deskripsi promosi wajib diisi (maksimal 1000 karakter).',
        'deskripsi'
      );
    }

    const rawMulai = body.tanggal_mulai ?? body.periode_mulai;
    const periodeMulai = rawMulai ? new Date(String(rawMulai)) : new Date(NaN);
    if (Number.isNaN(periodeMulai.getTime())) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Tanggal mulai promosi tidak valid.',
        'tanggal_mulai'
      );
    }

    let periodeSelesai: Date | null = null;
    const rawSelesai = body.tanggal_selesai ?? body.periode_selesai;
    if (rawSelesai !== undefined && rawSelesai !== null && String(rawSelesai).trim() !== '') {
      periodeSelesai = new Date(String(rawSelesai));
      if (Number.isNaN(periodeSelesai.getTime())) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Tanggal selesai promosi tidak valid.',
          'tanggal_selesai'
        );
      }
      if (periodeSelesai < periodeMulai) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.',
          'tanggal_selesai'
        );
      }
    }

    const gambarUrl =
      body.gambar_url !== undefined && body.gambar_url !== null && String(body.gambar_url).trim() !== ''
        ? String(body.gambar_url).trim().slice(0, 255)
        : null;

    const aktif = parseOptionalBoolean(body.aktif ?? body.is_active, 'aktif') ?? true;

    const created = await promosiRepository.create(
      {
        judul,
        deskripsi,
        link_foto: gambarUrl,
        periode_mulai: periodeMulai,
        periode_selesai: periodeSelesai,
        is_active: aktif,
      },
      actor
    );

    return formatAdminPromosi(created);
  },

  /**
   * E40 — PATCH /api/v1/admin/promotions/:id
   */
  async update(promosiId: string, body: Record<string, unknown>, actor: AuditActor) {
    if (!isValidUuid(promosiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const existing = await promosiRepository.findById(promosiId);
    if (!existing) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    let judul = existing.judul;
    if (body.judul !== undefined) {
      judul = String(body.judul ?? '').trim();
      if (!judul || judul.length > 150) {
        throw new ServiceError(422, 'ERR-VAL-02', 'Judul promosi tidak valid.', 'judul');
      }
    }

    let deskripsi = existing.deskripsi;
    if (body.deskripsi !== undefined) {
      deskripsi = String(body.deskripsi ?? '').trim();
      if (!deskripsi || deskripsi.length > 1000) {
        throw new ServiceError(422, 'ERR-VAL-02', 'Deskripsi promosi tidak valid.', 'deskripsi');
      }
    }

    let periodeMulai = new Date(existing.periode_mulai);
    if (body.tanggal_mulai !== undefined || body.periode_mulai !== undefined) {
      periodeMulai = new Date(String(body.tanggal_mulai ?? body.periode_mulai));
      if (Number.isNaN(periodeMulai.getTime())) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Tanggal mulai promosi tidak valid.',
          'tanggal_mulai'
        );
      }
    }

    let periodeSelesai: Date | null = existing.periode_selesai
      ? new Date(existing.periode_selesai)
      : null;
    if (body.tanggal_selesai !== undefined || body.periode_selesai !== undefined) {
      const rawSelesai = body.tanggal_selesai ?? body.periode_selesai;
      if (rawSelesai === null || String(rawSelesai).trim() === '') {
        periodeSelesai = null;
      } else {
        periodeSelesai = new Date(String(rawSelesai));
        if (Number.isNaN(periodeSelesai.getTime())) {
          throw new ServiceError(
            422,
            'ERR-VAL-02',
            'Tanggal selesai promosi tidak valid.',
            'tanggal_selesai'
          );
        }
      }
    }

    if (periodeSelesai && periodeSelesai < periodeMulai) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.',
        'tanggal_selesai'
      );
    }

    let gambarUrl = existing.link_foto;
    if (body.gambar_url !== undefined) {
      gambarUrl =
        body.gambar_url === null || String(body.gambar_url).trim() === ''
          ? null
          : String(body.gambar_url).trim().slice(0, 255);
    }

    let aktif = Boolean(existing.is_active);
    if (body.aktif !== undefined || body.is_active !== undefined) {
      aktif = parseOptionalBoolean(body.aktif ?? body.is_active, 'aktif') ?? aktif;
    }

    const updated = await promosiRepository.update(
      promosiId,
      existing,
      {
        judul,
        deskripsi,
        link_foto: gambarUrl,
        periode_mulai: periodeMulai,
        periode_selesai: periodeSelesai,
        is_active: aktif,
      },
      actor
    );

    return formatAdminPromosi(updated);
  },

  /**
   * E41 — DELETE /api/v1/admin/promotions/:id
   */
  async remove(promosiId: string, actor: AuditActor) {
    if (!isValidUuid(promosiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const existing = await promosiRepository.findById(promosiId);
    if (!existing) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    await promosiRepository.remove(promosiId, existing, actor);
  },
};
