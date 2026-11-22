import { blokMejaRepository, BlokMejaRow } from '../repositories/blokMejaRepository.js';
import { AuditActor } from '../utils/auditHelper.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

const formatBlok = (row: BlokMejaRow) => ({
  blok_id: row.blok_id,
  kode: row.nama_blok,
  nama_blok: row.nama_blok,
  kapasitas: row.kapasitas,
  nominal_dp: Number(row.nominal_dp),
  fasilitas: row.deskripsi,
  foto_url: row.link_foto,
  status_ketersediaan: row.status_ketersediaan,
  is_active: Boolean(row.is_active),
  ...(row.terkunci !== undefined ? { terkunci: Boolean(row.terkunci) } : {}),
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const parseOptionalBoolean = (val: unknown, field: string): boolean | undefined => {
  if (val === undefined || val === '') return undefined;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  throw new ServiceError(422, 'ERR-VAL-02', 'Periksa kembali data Anda.', field);
};

const normalizeStatusBlok = (raw: unknown): 'Tersedia' | 'Terisi' | 'Waiting' => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'tersedia') return 'Tersedia';
  if (s === 'terisi') return 'Terisi';
  if (s === 'waiting') return 'Waiting';
  throw new ServiceError(
    422,
    'ERR-VAL-02',
    'Status ketersediaan blok harus Tersedia, Terisi, atau Waiting.',
    'status_ketersediaan'
  );
};

const parseTimeToMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map((n) => Number.parseInt(n, 10));
  return (Number.isNaN(h) ? 0 : h) * 60 + (Number.isNaN(m) ? 0 : m);
};

export const validateJadwalOperasional = (
  rawJadwal: unknown,
  jamBuka: string,
  jamTutup: string
): Date => {
  const str = String(rawJadwal ?? '').trim();
  if (!str) {
    throw new ServiceError(
      422,
      'ERR-RES-01',
      'Pilih tanggal dan jam reservasi yang valid.',
      'jadwal'
    );
  }

  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
    throw new ServiceError(
      422,
      'ERR-RES-01',
      'Pilih tanggal dan jam reservasi yang valid (harus di masa depan).',
      'jadwal'
    );
  }

  // Konversi ke WIB (+07:00) untuk cek jam operasional
  const wibDate = new Date(parsed.getTime() + 7 * 60 * 60 * 1000);
  const wibMinutes = wibDate.getUTCHours() * 60 + wibDate.getUTCMinutes();
  const bukaMinutes = parseTimeToMinutes(jamBuka);
  const tutupMinutes = parseTimeToMinutes(jamTutup);

  if (wibMinutes < bukaMinutes || wibMinutes >= tutupMinutes) {
    throw new ServiceError(
      422,
      'ERR-RES-01',
      `Pilih jadwal reservasi dalam jam operasional (${jamBuka} - ${jamTutup} WIB).`,
      'jadwal'
    );
  }

  return parsed;
};

export const blokMejaService = {
  /**
   * E10 — GET /api/v1/blocks/availability
   */
  async getAvailability(rawJadwal: unknown) {
    const settings = await blokMejaRepository.getScheduleSettings();
    const jadwalMulai = validateJadwalOperasional(
      rawJadwal,
      settings.jam_buka,
      settings.jam_tutup
    );
    const jadwalSelesai = new Date(
      jadwalMulai.getTime() + settings.durasi_slot_jam * 60 * 60 * 1000
    );

    const rows = await blokMejaRepository.listAvailability(jadwalMulai, jadwalSelesai);

    return rows.map((row) => ({
      blok_id: row.blok_id,
      kode: row.nama_blok,
      kapasitas: row.kapasitas,
      nominal_dp: Number(row.nominal_dp),
      fasilitas: row.deskripsi,
      foto_url: row.link_foto,
      status: row.availability_status,
    }));
  },
  /**
   * E30 — GET /api/v1/admin/blocks
   */
  async listAdmin(query: {
    include_inactive?: unknown;
    page?: unknown;
    per_page?: unknown;
  }): Promise<{ items: ReturnType<typeof formatBlok>[]; meta: PaginationMeta }> {
    const includeInactive =
      parseOptionalBoolean(query.include_inactive, 'include_inactive') ?? false;
    const { page, perPage, offset } = parsePagination(query.page, query.per_page);

    const { rows, total } = await blokMejaRepository.listAdmin({
      includeInactive,
      offset,
      perPage,
    });

    return {
      items: rows.map(formatBlok),
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  },

  /**
   * E31 — POST /api/v1/admin/blocks
   */
  async create(body: Record<string, unknown>, actor: AuditActor) {
    const rawName = String(body.kode_blok ?? body.nama_blok ?? '').trim();
    if (!rawName || rawName.length > 100) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Kode/nama blok wajib diisi (maksimal 100 karakter).',
        'kode_blok'
      );
    }

    const kapasitas = Number(body.kapasitas);
    if (!Number.isInteger(kapasitas) || kapasitas <= 0) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Kapasitas harus berupa bilangan bulat lebih dari 0.',
        'kapasitas'
      );
    }

    const nominalDp = Number(body.nominal_dp ?? 0);
    if (Number.isNaN(nominalDp) || nominalDp < 0) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Nominal DP tidak boleh negatif.',
        'nominal_dp'
      );
    }

    const fasilitas =
      body.fasilitas !== undefined && body.fasilitas !== null
        ? String(body.fasilitas).trim()
        : body.deskripsi !== undefined && body.deskripsi !== null
          ? String(body.deskripsi).trim()
          : null;

    if (fasilitas && fasilitas.length > 255) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Teks fasilitas terlalu panjang (maksimal 255 karakter).',
        'fasilitas'
      );
    }

    const fotoUrl =
      body.foto_url !== undefined && body.foto_url !== null && String(body.foto_url).trim() !== ''
        ? String(body.foto_url).trim().slice(0, 255)
        : null;

    const existing = await blokMejaRepository.findByName(rawName);
    if (existing) {
      throw new ServiceError(409, 'ERR-VAL-02', 'ID blok sudah digunakan.', 'kode_blok');
    }

    const created = await blokMejaRepository.create(
      {
        nama_blok: rawName,
        kapasitas,
        nominal_dp: nominalDp,
        deskripsi: fasilitas,
        link_foto: fotoUrl,
      },
      actor
    );

    return formatBlok(created);
  },

  /**
   * E32 — PATCH /api/v1/admin/blocks/:id
   */
  async update(blokId: string, body: Record<string, unknown>, actor: AuditActor) {
    if (!isValidUuid(blokId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const existing = await blokMejaRepository.findById(blokId);
    if (!existing || !existing.is_active) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const locked = await blokMejaRepository.hasActiveReservation(blokId);
    if (locked) {
      throw new ServiceError(409, 'ERR-RES-04', 'Blok masih memiliki reservasi aktif.');
    }

    let namaBlok = existing.nama_blok;
    if (body.kode_blok !== undefined || body.nama_blok !== undefined) {
      namaBlok = String(body.kode_blok ?? body.nama_blok ?? '').trim();
      if (!namaBlok || namaBlok.length > 100) {
        throw new ServiceError(422, 'ERR-VAL-02', 'Kode/nama blok tidak valid.', 'kode_blok');
      }
      const duplicate = await blokMejaRepository.findByName(namaBlok, blokId);
      if (duplicate) {
        throw new ServiceError(409, 'ERR-VAL-02', 'ID blok sudah digunakan.', 'kode_blok');
      }
    }

    let kapasitas = existing.kapasitas;
    if (body.kapasitas !== undefined) {
      kapasitas = Number(body.kapasitas);
      if (!Number.isInteger(kapasitas) || kapasitas <= 0) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Kapasitas harus berupa bilangan bulat lebih dari 0.',
          'kapasitas'
        );
      }
    }

    let nominalDp = Number(existing.nominal_dp);
    if (body.nominal_dp !== undefined) {
      nominalDp = Number(body.nominal_dp);
      if (Number.isNaN(nominalDp) || nominalDp < 0) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Nominal DP tidak boleh negatif.',
          'nominal_dp'
        );
      }
    }

    let deskripsi = existing.deskripsi;
    if (body.fasilitas !== undefined || body.deskripsi !== undefined) {
      const val = body.fasilitas !== undefined ? body.fasilitas : body.deskripsi;
      deskripsi = val === null ? null : String(val).trim();
      if (deskripsi && deskripsi.length > 255) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Teks fasilitas terlalu panjang (maksimal 255 karakter).',
          'fasilitas'
        );
      }
    }

    let linkFoto = existing.link_foto;
    if (body.foto_url !== undefined) {
      linkFoto =
        body.foto_url === null || String(body.foto_url).trim() === ''
          ? null
          : String(body.foto_url).trim().slice(0, 255);
    }

    let statusKetersediaan = existing.status_ketersediaan;
    if (body.status_ketersediaan !== undefined) {
      statusKetersediaan = normalizeStatusBlok(body.status_ketersediaan);
    }

    const updated = await blokMejaRepository.update(
      blokId,
      existing,
      {
        nama_blok: namaBlok,
        kapasitas,
        nominal_dp: nominalDp,
        deskripsi,
        link_foto: linkFoto,
        status_ketersediaan: statusKetersediaan,
      },
      actor
    );

    return formatBlok(updated);
  },

  /**
   * E33 — DELETE /api/v1/admin/blocks/:id
   */
  async remove(blokId: string, actor: AuditActor) {
    if (!isValidUuid(blokId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const existing = await blokMejaRepository.findById(blokId);
    if (!existing || !existing.is_active) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const locked = await blokMejaRepository.hasActiveReservation(blokId);
    if (locked) {
      throw new ServiceError(409, 'ERR-RES-04', 'Blok masih memiliki reservasi aktif.');
    }

    await blokMejaRepository.softDelete(blokId, existing, actor);
  },
};
