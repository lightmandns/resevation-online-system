import { dashboardRepository } from '../repositories/dashboardRepository.js';
import { ServiceError } from '../utils/errors.js';

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

export const dashboardService = {
  /**
   * E49 — GET /api/v1/manager/dashboard
   */
  async getManagerDashboard(query: {
    tanggal_mulai?: unknown;
    tanggal_selesai?: unknown;
    status?: unknown;
  }) {
    let tanggalMulai: string | undefined;
    let tanggalSelesai: string | undefined;

    if (query.tanggal_mulai !== undefined && String(query.tanggal_mulai).trim() !== '') {
      tanggalMulai = parseValidDateString(query.tanggal_mulai, 'tanggal_mulai');
    }
    if (query.tanggal_selesai !== undefined && String(query.tanggal_selesai).trim() !== '') {
      tanggalSelesai = parseValidDateString(query.tanggal_selesai, 'tanggal_selesai');
    }
    if (tanggalMulai && tanggalSelesai && tanggalSelesai < tanggalMulai) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Rentang tanggal tidak valid.',
        'tanggal_selesai'
      );
    }

    const status =
      query.status !== undefined && String(query.status).trim() !== ''
        ? String(query.status).trim()
        : undefined;

    const raw = await dashboardRepository.getManagerSummary({
      tanggalMulai,
      tanggalSelesai,
      status,
    });

    const totalDpTerkonfirmasi = raw.paymentSummary
      .filter((p) => p.jenis_pembayaran === 'DP' && p.status === 'Terkonfirmasi')
      .reduce((sum, p) => sum + Number(p.total_nominal), 0);

    const totalPelunasanTerkonfirmasi = raw.paymentSummary
      .filter((p) => p.jenis_pembayaran === 'Pelunasan' && p.status === 'Terkonfirmasi')
      .reduce((sum, p) => sum + Number(p.total_nominal), 0);

    return {
      ringkasan_reservasi: raw.reservasiSummary.map((r) => ({
        status: r.status_reservasi,
        jumlah: r.jumlah,
      })),
      ringkasan_pembayaran: raw.paymentSummary.map((p) => ({
        jenis: p.jenis_pembayaran,
        status: p.status,
        jumlah: p.jumlah,
        total_nominal: Number(p.total_nominal),
      })),
      total_dp_terkonfirmasi: totalDpTerkonfirmasi,
      total_pelunasan_terkonfirmasi: totalPelunasanTerkonfirmasi,
      total_pendapatan_reservasi: totalDpTerkonfirmasi + totalPelunasanTerkonfirmasi,
      rating: {
        rata_rata: raw.rataRataRating,
        total_ulasan: raw.totalUlasan,
      },
      reservasi_terdekat: raw.upcomingReservations.map((r) => ({
        reservasi_id: r.reservasi_id,
        nama_customer: r.nama_customer,
        jadwal_reservasi: r.jadwal_reservasi,
        jenis_layanan: r.jenis_layanan,
        jenis_acara: r.jenis_acara,
        status: r.status_reservasi,
        blok: r.blok_list ? r.blok_list.split(', ') : [],
      })),
      perubahan_tercatat_7_hari: raw.perubahan7Hari,
    };
  },
};
