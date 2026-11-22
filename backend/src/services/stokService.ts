import { stokRepository, StokRow } from '../repositories/stokRepository.js';
import { AuditActor } from '../utils/auditHelper.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const formatStok = (row: StokRow) => ({
  bahan_id: row.bahan_id,
  nama_bahan: row.nama_bahan,
  jumlah_stok: Number(row.jumlah_stok),
  satuan: row.satuan,
  harga_satuan: Number(row.harga_satuan),
  tanggal_masuk:
    row.tanggal_masuk instanceof Date
      ? row.tanggal_masuk.toISOString().slice(0, 10)
      : String(row.tanggal_masuk).slice(0, 10),
  updated_at: row.updated_at,
});

const getTodayWibDateString = (): string => {
  const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return nowWib.toISOString().slice(0, 10);
};

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

export const stokService = {
  /**
   * E42 — GET /api/v1/ingredient-receipts
   */
  async listReceipts(query: {
    tanggal_dari?: unknown;
    tanggal_sampai?: unknown;
    nama_bahan?: unknown;
    page?: unknown;
    per_page?: unknown;
  }): Promise<{ items: ReturnType<typeof formatStok>[]; meta: PaginationMeta }> {
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

    const namaBahan =
      query.nama_bahan !== undefined && String(query.nama_bahan).trim() !== ''
        ? String(query.nama_bahan).trim()
        : undefined;

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total } = await stokRepository.list({
      namaBahan,
      tanggalDari,
      tanggalSampai,
      offset,
      perPage,
    });

    return {
      items: rows.map(formatStok),
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  },

  /**
   * E43 — POST /api/v1/ingredient-receipts
   */
  async recordStockIn(body: Record<string, unknown>, actor: AuditActor) {
    const namaBahan = String(body.nama_bahan ?? '').trim();
    if (!namaBahan || namaBahan.length > 100) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Nama bahan wajib diisi (maksimal 100 karakter).',
        'nama_bahan'
      );
    }

    const satuan = String(body.satuan ?? 'pcs').trim();
    if (!satuan || satuan.length > 20) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Satuan wajib diisi (maksimal 20 karakter).',
        'satuan'
      );
    }

    const jumlah = Number(body.jumlah);
    if (Number.isNaN(jumlah) || jumlah <= 0) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Jumlah dan harga harus berupa angka lebih dari nol.',
        'jumlah'
      );
    }

    const harga = Number(body.harga ?? body.harga_satuan);
    if (Number.isNaN(harga) || harga < 0) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Harga tidak boleh negatif.',
        'harga'
      );
    }

    const rawTanggal = body.tanggal_pencatatan ?? body.tanggal_masuk;
    const tanggalMasuk = parseValidDateString(rawTanggal, 'tanggal_pencatatan');
    const todayWib = getTodayWibDateString();
    if (tanggalMasuk > todayWib) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Tanggal pencatatan tidak boleh di masa depan.',
        'tanggal_pencatatan'
      );
    }

    const existing = await stokRepository.findByName(namaBahan);
    const saved = await stokRepository.recordStockIn(
      {
        nama_bahan: namaBahan,
        satuan,
        jumlah,
        harga_satuan: harga,
        tanggal_masuk: tanggalMasuk,
      },
      existing,
      actor
    );

    return formatStok(saved);
  },

  /**
   * E44 — GET /api/v1/inventory/stocks
   */
  async listStocks(query: {
    nama_bahan?: unknown;
    page?: unknown;
    per_page?: unknown;
  }): Promise<{ items: ReturnType<typeof formatStok>[]; meta: PaginationMeta }> {
    const namaBahan =
      query.nama_bahan !== undefined && String(query.nama_bahan).trim() !== ''
        ? String(query.nama_bahan).trim()
        : undefined;

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total } = await stokRepository.list({
      namaBahan,
      offset,
      perPage,
    });

    return {
      items: rows.map(formatStok),
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  },

  /**
   * E45 — PATCH /api/v1/inventory/stocks/:id
   */
  async updateStockQuantity(bahanId: string, body: Record<string, unknown>, actor: AuditActor) {
    if (!isValidUuid(bahanId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const existing = await stokRepository.findById(bahanId);
    if (!existing) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const rawJumlah = body.jumlah_stok_baru ?? body.jumlah_stok;
    const jumlahBaru = Number(rawJumlah);
    if (rawJumlah === undefined || rawJumlah === '' || Number.isNaN(jumlahBaru) || jumlahBaru < 0) {
      throw new ServiceError(
        422,
        'ERR-STOCK-01',
        'Jumlah stok tidak boleh negatif.',
        'jumlah_stok_baru'
      );
    }

    const jumlahLama = Number(existing.jumlah_stok);
    const updated = await stokRepository.updateQuantity(bahanId, existing, jumlahBaru, actor);

    return {
      bahan_id: updated.bahan_id,
      nama_bahan: updated.nama_bahan,
      satuan: updated.satuan,
      jumlah_lama: jumlahLama,
      jumlah_baru: Number(updated.jumlah_stok),
      updated_at: updated.updated_at,
    };
  },
};
