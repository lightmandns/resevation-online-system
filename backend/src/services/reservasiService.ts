import { reservasiRepository } from '../repositories/reservasiRepository.js';
import { validateJadwalOperasional } from './blokMejaService.js';
import { AuditActor } from '../utils/auditHelper.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

export const reservasiService = {
  /**
   * E09 — GET /api/v1/reservations/service-options
   */
  async getServiceOptions() {
    const settings = await reservasiRepository.getReservationSettings();
    const nomor = settings.whatsapp_admin || null;
    const tautan = nomor ? `https://wa.me/${nomor}` : null;

    return {
      jenis_layanan: ['Reguler', 'Khusus'],
      whatsapp_admin: {
        nomor,
        tautan,
      },
    };
  },

  /**
   * E11 — POST /api/v1/reservations
   */
  async createRegular(
    userId: string,
    body: Record<string, unknown>,
    actor: AuditActor
  ) {
    const jenisLayanan = String(body.jenis_layanan ?? 'reguler').trim().toLowerCase();
    if (jenisLayanan === 'khusus') {
      throw new ServiceError(
        422,
        'ERR-RES-05',
        'Layanan khusus dipesan melalui WhatsApp Admin.',
        'jenis_layanan'
      );
    }
    if (jenisLayanan !== 'reguler') {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Jenis layanan harus reguler.',
        'jenis_layanan'
      );
    }

    const rawBlokIds = body.blok_ids;
    if (!Array.isArray(rawBlokIds) || rawBlokIds.length === 0) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Pilih minimal satu blok meja.',
        'blok_ids'
      );
    }

    const uniqueBlokIds = Array.from(new Set(rawBlokIds.map((id) => String(id).trim())));
    for (const id of uniqueBlokIds) {
      if (!isValidUuid(id)) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Format ID blok tidak valid.',
          'blok_ids'
        );
      }
    }

    const jumlahTamu = Number(body.jumlah_tamu);
    if (!Number.isInteger(jumlahTamu) || jumlahTamu <= 0) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Jumlah tamu harus berupa bilangan bulat lebih dari 0.',
        'jumlah_tamu'
      );
    }

    const settings = await reservasiRepository.getReservationSettings();
    const jadwalReservasi = validateJadwalOperasional(
      body.jadwal_reservasi,
      settings.jam_buka,
      settings.jam_tutup
    );
    const jadwalSelesai = new Date(
      jadwalReservasi.getTime() + settings.durasi_slot_jam * 60 * 60 * 1000
    );

    const holdStart = new Date();
    const batasPenahanan = new Date(
      holdStart.getTime() + settings.batas_waktu_dp_menit * 60 * 1000
    );

    const { reservasi, blocks, nominalDp } =
      await reservasiRepository.createRegularReservation(
        {
          userId,
          jadwalReservasi,
          jadwalSelesai,
          jumlahTamu,
          blokIds: uniqueBlokIds,
          batasPenahanan,
        },
        actor
      );

    return {
      reservasi_id: reservasi.reservasi_id,
      status: reservasi.status_reservasi,
      jenis_layanan: reservasi.jenis_layanan,
      jenis_acara: reservasi.jenis_acara,
      jadwal_reservasi: reservasi.jadwal_reservasi,
      jadwal_selesai: reservasi.jadwal_selesai,
      jumlah_tamu: reservasi.jumlah_tamu,
      hold_start: reservasi.created_at,
      hold_expires_at: reservasi.batas_penahanan,
      blok: blocks.map((b) => ({
        blok_id: b.blok_id,
        kode: b.nama_blok,
        kapasitas: b.kapasitas,
        nominal_dp: Number(b.nominal_dp),
      })),
      invoice: {
        nominal_dp: nominalDp,
        ketentuan: 'Transaksi tidak dapat direfund',
      },
    };
  },

  /**
   * E12 — GET /api/v1/reservations
   */
  async listMyReservations(
    userId: string,
    query: { status?: unknown; page?: unknown; per_page?: unknown }
  ): Promise<{ items: unknown[]; meta: PaginationMeta }> {
    const status =
      query.status !== undefined && String(query.status).trim() !== ''
        ? String(query.status).trim()
        : undefined;

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const settings = await reservasiRepository.getReservationSettings();

    const { rows, total } = await reservasiRepository.listByUser({
      userId,
      status,
      offset,
      perPage,
    });

    const nowMs = Date.now();
    const menuDeadlineMs = settings.batas_submit_menu_hari * 24 * 60 * 60 * 1000;

    const items = rows.map((row) => {
      const jadwalMs = new Date(row.jadwal_reservasi).getTime();
      const holdMs = row.batas_penahanan ? new Date(row.batas_penahanan).getTime() : 0;

      const lanjutBayar =
        row.status_reservasi === 'MenungguPembayaran' && holdMs > nowMs;
      const pesanMenu =
        row.status_reservasi === 'Terkonfirmasi' &&
        nowMs <= jadwalMs - menuDeadlineMs;
      const lihatReceipt =
        row.status_reservasi === 'Terkonfirmasi' || row.status_reservasi === 'Selesai';
      const beriUlasan =
        row.status_reservasi === 'Selesai' &&
        jadwalMs < nowMs &&
        !Boolean(row.has_review);

      return {
        reservasi_id: row.reservasi_id,
        jadwal_reservasi: row.jadwal_reservasi,
        jadwal_selesai: row.jadwal_selesai,
        jenis_layanan: row.jenis_layanan,
        jenis_acara: row.jenis_acara,
        jumlah_tamu: row.jumlah_tamu,
        blok: row.blok_list ? row.blok_list.split(', ') : [],
        status: row.status_reservasi,
        status_pembayaran: {
          dp: row.status_dp || 'BelumDibayar',
          pelunasan: row.status_pelunasan || null,
        },
        aksi_tersedia: {
          lanjut_bayar: lanjutBayar,
          pesan_menu: pesanMenu,
          lihat_receipt: lihatReceipt,
          beri_ulasan: beriUlasan,
        },
      };
    });

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
   * E13 — GET /api/v1/reservations/:id
   */
  async getMyReservationDetail(
    reservasiId: string,
    requester: { userId: string; role: string }
  ) {
    if (!isValidUuid(reservasiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const detail = await reservasiRepository.findDetailById(reservasiId);
    if (!detail) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    // Manajer melewati pemeriksaan kepemilikan (TSD 3.1)
    if (
      requester.role.toLowerCase() !== 'manajer' &&
      detail.reservasi.user_id.toLowerCase() !== requester.userId.toLowerCase()
    ) {
      throw new ServiceError(
        403,
        'ERR-AUTH-03',
        'Anda tidak memiliki izin untuk mengakses fitur ini'
      );
    }

    return {
      reservasi: {
        reservasi_id: detail.reservasi.reservasi_id,
        nama_pemesan: detail.reservasi.nama_pemesan,
        no_whatsapp: detail.reservasi.no_whatsapp,
        jadwal_reservasi: detail.reservasi.jadwal_reservasi,
        jadwal_selesai: detail.reservasi.jadwal_selesai,
        jenis_layanan: detail.reservasi.jenis_layanan,
        jenis_acara: detail.reservasi.jenis_acara,
        jumlah_tamu: detail.reservasi.jumlah_tamu,
        status: detail.reservasi.status_reservasi,
        batas_penahanan: detail.reservasi.batas_penahanan,
        created_at: detail.reservasi.created_at,
      },
      blok: detail.blocks.map((b) => ({
        blok_id: b.blok_id,
        kode: b.nama_blok,
        kapasitas: b.kapasitas,
        nominal_dp: Number(b.nominal_dp),
        status_penahanan: b.status_penahanan,
      })),
      pembayaran: detail.payments.map((p) => ({
        pembayaran_id: p.payment_id,
        jenis: p.jenis_pembayaran,
        metode: p.metode_pembayaran,
        bank: p.bank,
        nominal: Number(p.nominal),
        kode_va: p.kode_va,
        status: p.status,
        waktu_kadaluarsa: p.waktu_kadaluarsa,
        paid_at: p.paid_at,
      })),
      pesanan: detail.orders.map((o) => ({
        order_detail_id: o.order_detail_id,
        menu_id: o.menu_id,
        nama_menu: o.nama_menu,
        jumlah_porsi: o.jumlah_porsi,
        harga_satuan: o.harga_satuan !== null ? Number(o.harga_satuan) : null,
        subtotal: o.subtotal !== null ? Number(o.subtotal) : null,
        status_item: o.status_item,
        catatan_request: o.catatan_request,
        catatan_admin: o.catatan_admin,
      })),
      status_history: detail.history,
      ulasan: detail.review,
    };
  },

  /**
   * E14 — GET /api/v1/reservations/:id/receipt
   */
  async getReceipt(
    reservasiId: string,
    requester: { userId: string; role: string }
  ) {
    const detail = await this.getMyReservationDetail(reservasiId, requester);
    const status = detail.reservasi.status;

    if (status !== 'Terkonfirmasi' && status !== 'Selesai') {
      throw new ServiceError(409, 'ERR-RES-06', 'Bukti reservasi belum tersedia.');
    }

    const dpPayment = detail.pembayaran.find((p) => p.jenis === 'DP') ?? null;
    const pelunasanPayment = detail.pembayaran.find((p) => p.jenis === 'Pelunasan') ?? null;

    return {
      id_reservasi: detail.reservasi.reservasi_id,
      nama_pemesan: detail.reservasi.nama_pemesan,
      no_whatsapp: detail.reservasi.no_whatsapp,
      jadwal_reservasi: detail.reservasi.jadwal_reservasi,
      jadwal_selesai: detail.reservasi.jadwal_selesai,
      jenis_layanan: detail.reservasi.jenis_layanan,
      jenis_acara: detail.reservasi.jenis_acara,
      jumlah_tamu: detail.reservasi.jumlah_tamu,
      status_reservasi: status,
      blok: detail.blok,
      pesanan_menu: detail.pesanan,
      pesan_menu_info:
        detail.pesanan.length === 0 ? 'Belum ada pesanan menu' : null,
      status_pembayaran: {
        dp: dpPayment ? dpPayment.status : 'BelumDibayar',
        nominal_dp: dpPayment ? dpPayment.nominal : 0,
        pelunasan: pelunasanPayment ? pelunasanPayment.status : null,
        nominal_pelunasan: pelunasanPayment ? pelunasanPayment.nominal : 0,
      },
    };
  },

  /**
   * E26 & E27 — Daftar reservasi berjalan (terdekat) & riwayat selesai (terbaru) untuk Admin/Manajer
   */
  async listAdminReservations(
    mode: 'active' | 'history',
    query: {
      tanggal?: unknown;
      nama_pelanggan?: unknown;
      status?: unknown;
      page?: unknown;
      per_page?: unknown;
    }
  ): Promise<{ items: unknown[]; meta: PaginationMeta }> {
    let tanggal: string | undefined;
    if (query.tanggal !== undefined && String(query.tanggal).trim() !== '') {
      const s = String(query.tanggal).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Format filter tanggal tidak valid (YYYY-MM-DD).',
          'tanggal'
        );
      }
      tanggal = s;
    }

    const namaPelanggan =
      query.nama_pelanggan !== undefined && String(query.nama_pelanggan).trim() !== ''
        ? String(query.nama_pelanggan).trim()
        : undefined;

    const status =
      query.status !== undefined && String(query.status).trim() !== ''
        ? String(query.status).trim()
        : undefined;

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total } = await reservasiRepository.listAdmin({
      mode,
      tanggal,
      namaPelanggan,
      status,
      offset,
      perPage,
    });

    const items = rows.map((row) => ({
      reservasi_id: row.reservasi_id,
      nama_customer: row.nama_customer,
      no_whatsapp: row.no_whatsapp,
      jadwal_reservasi: row.jadwal_reservasi,
      jadwal_selesai: row.jadwal_selesai,
      jenis_layanan: row.jenis_layanan,
      jenis_acara: row.jenis_acara,
      jumlah_tamu: row.jumlah_tamu,
      blok: row.blok_list ? row.blok_list.split(', ') : [],
      status: row.status_reservasi,
      nominal_dp: Number(row.nominal_dp),
      status_pembayaran: {
        dp: row.status_dp || 'BelumDibayar',
        pelunasan: row.status_pelunasan || null,
      },
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
   * E28 — Detail reservasi untuk Admin/Manajer
   */
  async getAdminReservationDetail(reservasiId: string) {
    if (!isValidUuid(reservasiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const detail = await reservasiRepository.findDetailById(reservasiId);
    if (!detail) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    return {
      reservasi: {
        reservasi_id: detail.reservasi.reservasi_id,
        jadwal_reservasi: detail.reservasi.jadwal_reservasi,
        jadwal_selesai: detail.reservasi.jadwal_selesai,
        jenis_layanan: detail.reservasi.jenis_layanan,
        jenis_acara: detail.reservasi.jenis_acara,
        jumlah_tamu: detail.reservasi.jumlah_tamu,
        status: detail.reservasi.status_reservasi,
        batas_penahanan: detail.reservasi.batas_penahanan,
        created_at: detail.reservasi.created_at,
      },
      pelanggan: {
        user_id: detail.reservasi.user_id,
        nama: detail.reservasi.nama_pemesan,
        no_whatsapp: detail.reservasi.no_whatsapp,
        email: detail.reservasi.email_pemesan,
      },
      blok: detail.blocks.map((b) => ({
        blok_id: b.blok_id,
        kode: b.nama_blok,
        kapasitas: b.kapasitas,
        nominal_dp: Number(b.nominal_dp),
        status_penahanan: b.status_penahanan,
      })),
      pembayaran: detail.payments.map((p) => ({
        pembayaran_id: p.payment_id,
        jenis: p.jenis_pembayaran,
        metode: p.metode_pembayaran,
        bank: p.bank,
        nominal: Number(p.nominal),
        kode_va: p.kode_va,
        status: p.status,
        waktu_kadaluarsa: p.waktu_kadaluarsa,
        paid_at: p.paid_at,
      })),
      pesanan_menu: detail.orders.map((o) => ({
        order_detail_id: o.order_detail_id,
        menu_id: o.menu_id,
        nama_menu: o.nama_menu,
        jumlah_porsi: o.jumlah_porsi,
        harga_satuan: o.harga_satuan !== null ? Number(o.harga_satuan) : null,
        subtotal: o.subtotal !== null ? Number(o.subtotal) : null,
        status_item: o.status_item,
        catatan_request: o.catatan_request,
        catatan_admin: o.catatan_admin,
      })),
      status_history: detail.history,
      ulasan: detail.review,
    };
  },

  /**
   * E29 — Input reservasi layanan khusus oleh Admin
   */
  async createSpecialReservation(
    adminId: string,
    body: Record<string, unknown>,
    actor: AuditActor
  ) {
    const namaPemesan = String(body.nama_pemesan ?? '').trim();
    if (namaPemesan.length < 2 || namaPemesan.length > 100) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Nama pemesan wajib diisi (2-100 karakter).',
        'nama_pemesan'
      );
    }

    const rawWa = String(body.nomor_whatsapp ?? body.no_whatsapp ?? '')
      .replace(/[\s\-()]/g, '')
      .trim();
    let wa = rawWa.startsWith('+') ? rawWa.slice(1) : rawWa;
    if (wa.startsWith('0')) wa = `62${wa.slice(1)}`;
    if (!/^62\d{8,13}$/.test(wa)) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Masukkan nomor WhatsApp yang valid (10-15 digit, diawali 62).',
        'nomor_whatsapp'
      );
    }

    const jenisAcara = String(body.jenis_acara ?? '').trim();
    if (!jenisAcara || jenisAcara.length > 100 || jenisAcara.toLowerCase() === 'basic') {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Jenis acara wajib diisi dan tidak boleh bernilai "Basic".',
        'jenis_acara'
      );
    }

    const rawBlokIds = body.blok_ids;
    if (!Array.isArray(rawBlokIds) || rawBlokIds.length === 0) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Pilih minimal satu blok meja.',
        'blok_ids'
      );
    }
    const uniqueBlokIds = Array.from(new Set(rawBlokIds.map((id) => String(id).trim())));
    for (const id of uniqueBlokIds) {
      if (!isValidUuid(id)) {
        throw new ServiceError(422, 'ERR-VAL-02', 'Format ID blok tidak valid.', 'blok_ids');
      }
    }

    const jumlahTamu = Number(body.jumlah_tamu);
    if (!Number.isInteger(jumlahTamu) || jumlahTamu <= 0) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Jumlah tamu harus berupa bilangan bulat lebih dari 0.',
        'jumlah_tamu'
      );
    }

    const rawStatusPay = String(body.status_pembayaran ?? 'belum').trim().toLowerCase();
    if (rawStatusPay !== 'belum' && rawStatusPay !== 'dp' && rawStatusPay !== 'lunas') {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Status pembayaran harus belum, dp, atau lunas.',
        'status_pembayaran'
      );
    }

    const settings = await reservasiRepository.getReservationSettings();
    const jadwalReservasi = validateJadwalOperasional(
      body.jadwal_reservasi,
      settings.jam_buka,
      settings.jam_tutup
    );
    const jadwalSelesai = new Date(
      jadwalReservasi.getTime() + settings.durasi_slot_jam * 60 * 60 * 1000
    );
    const batasPenahanan = new Date(
      Date.now() + settings.batas_waktu_dp_menit * 60 * 1000
    );

    const rawMenus = Array.isArray(body.pesanan_menu) ? body.pesanan_menu : [];
    const pesananMenu: Array<{
      menu_id?: string;
      nama_menu?: string;
      jumlah_porsi: number;
      harga_satuan?: number;
      keterangan?: string;
    }> = [];

    for (const m of rawMenus) {
      const obj = (m ?? {}) as Record<string, unknown>;
      const jumlahPorsi = Number(obj.jumlah_porsi);
      if (!Number.isInteger(jumlahPorsi) || jumlahPorsi <= 0) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Jumlah porsi pesanan menu harus bilangan bulat lebih dari 0.',
          'pesanan_menu'
        );
      }

      const menuId = obj.menu_id ? String(obj.menu_id).trim() : undefined;
      if (menuId && !isValidUuid(menuId)) {
        throw new ServiceError(422, 'ERR-VAL-02', 'ID menu tidak valid.', 'pesanan_menu');
      }
      const namaMenu = obj.nama_menu ? String(obj.nama_menu).trim() : undefined;
      if (!menuId && !namaMenu) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Setiap item pesanan menu wajib memiliki menu_id atau nama_menu.',
          'pesanan_menu'
        );
      }

      pesananMenu.push({
        menu_id: menuId,
        nama_menu: namaMenu,
        jumlah_porsi: jumlahPorsi,
        harga_satuan:
          obj.harga_satuan !== undefined ? Number(obj.harga_satuan) : undefined,
        keterangan: obj.keterangan ? String(obj.keterangan).trim() : undefined,
      });
    }

    const emailPemesan =
      body.email_pemesan && String(body.email_pemesan).trim() !== ''
        ? String(body.email_pemesan).trim()
        : undefined;

    const { reservasi, blocks } = await reservasiRepository.createSpecialReservation(
      {
        adminId,
        namaPemesan,
        nomorWhatsapp: wa,
        emailPemesan,
        jenisAcara,
        jadwalReservasi,
        jadwalSelesai,
        jumlahTamu,
        blokIds: uniqueBlokIds,
        batasPenahanan,
        statusPembayaran: rawStatusPay,
        pesananMenu,
      },
      actor
    );

    return {
      reservasi_id: reservasi.reservasi_id,
      jenis_layanan: reservasi.jenis_layanan,
      jenis_acara: reservasi.jenis_acara,
      jadwal_reservasi: reservasi.jadwal_reservasi,
      jadwal_selesai: reservasi.jadwal_selesai,
      jumlah_tamu: reservasi.jumlah_tamu,
      status: reservasi.status_reservasi,
      blok: blocks.map((b) => ({
        blok_id: b.blok_id,
        kode: b.nama_blok,
        kapasitas: b.kapasitas,
      })),
    };
  },
};
