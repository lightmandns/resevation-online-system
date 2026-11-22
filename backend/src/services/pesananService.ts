import { pesananRepository, OrderDetailRow } from '../repositories/pesananRepository.js';
import { AuditActor } from '../utils/auditHelper.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

const formatOrderItem = (row: OrderDetailRow) => ({
  id: row.order_detail_id,
  order_detail_id: row.order_detail_id,
  menu_id: row.menu_id,
  menu: row.nama_menu,
  nama_menu_request: row.nama_menu_request,
  catatan_request: row.catatan_request,
  jumlah_porsi: row.jumlah_porsi,
  harga_satuan: row.harga_satuan !== null ? Number(row.harga_satuan) : null,
  subtotal: row.subtotal !== null ? Number(row.subtotal) : null,
  status_item: row.status_item,
  catatan_admin: row.catatan_admin,
  keterangan_harga:
    row.menu_id === null && row.harga_satuan === null
      ? 'harga menunggu konfirmasi Admin'
      : null,
});

export const pesananService = {
  /**
   * E22 — POST /api/v1/reservations/:id/orders
   */
  async createOrders(
    reservasiId: string,
    body: Record<string, unknown>,
    requester: { userId: string; role: string },
    actor: AuditActor
  ) {
    if (!isValidUuid(reservasiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const ctx = await pesananRepository.findReservationContext(reservasiId);
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

    if (ctx.status_reservasi !== 'Terkonfirmasi') {
      throw new ServiceError(
        403,
        'ERR-MENU-03',
        'Selesaikan pembayaran DP terlebih dahulu.'
      );
    }

    const settings = await pesananRepository.getOrderSettings();
    const jadwalMs = new Date(ctx.jadwal_reservasi).getTime();
    const deadlineMs = jadwalMs - settings.batas_submit_menu_hari * 24 * 60 * 60 * 1000;
    if (Date.now() > deadlineMs) {
      throw new ServiceError(
        422,
        'ERR-MENU-07',
        'Batas pemesanan menu (H-1 sebelum jadwal reservasi) telah lewat.'
      );
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const rawRequests = Array.isArray(body.request_items) ? body.request_items : [];

    if (rawItems.length === 0 && rawRequests.length === 0) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Pilih minimal satu menu makanan.',
        'items'
      );
    }

    const catalogItems: Array<{ menu_id: string; jumlah_porsi: number }> = [];
    const seenMenuIds = new Set<string>();
    for (const raw of rawItems) {
      const obj = (raw ?? {}) as Record<string, unknown>;
      const menuId = String(obj.menu_id ?? '').trim();
      const jumlahPorsi = Number(obj.jumlah_porsi);

      if (!isValidUuid(menuId)) {
        throw new ServiceError(422, 'ERR-VAL-02', 'ID menu tidak valid.', 'items');
      }
      if (seenMenuIds.has(menuId.toLowerCase())) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Menu yang sama tidak boleh dikirim dua kali dalam satu permintaan.',
          'items'
        );
      }
      seenMenuIds.add(menuId.toLowerCase());

      if (!Number.isInteger(jumlahPorsi) || jumlahPorsi < 1) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Jumlah porsi harus bilangan bulat minimal 1.',
          'items'
        );
      }

      catalogItems.push({ menu_id: menuId, jumlah_porsi: jumlahPorsi });
    }

    const requestItems: Array<{
      nama_menu: string;
      deskripsi: string;
      jumlah_porsi: number;
    }> = [];

    for (const raw of rawRequests) {
      const obj = (raw ?? {}) as Record<string, unknown>;
      const namaMenu = String(obj.nama_menu ?? obj.nama_menu_request ?? '').trim();
      const deskripsi = String(obj.deskripsi ?? obj.catatan_request ?? '').trim();
      const jumlahPorsi = Number(obj.jumlah_porsi);

      if (!namaMenu || namaMenu.length > 100) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Nama menu request wajib diisi (maksimal 100 karakter).',
          'request_items'
        );
      }
      if (!deskripsi || deskripsi.length > 500) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Deskripsi menu request wajib diisi (maksimal 500 karakter).',
          'request_items'
        );
      }
      if (!Number.isInteger(jumlahPorsi) || jumlahPorsi < settings.min_porsi_request) {
        throw new ServiceError(
          422,
          'ERR-MENU-01',
          `Jumlah porsi menu request minimal ${settings.min_porsi_request} porsi.`,
          'request_items'
        );
      }

      requestItems.push({ nama_menu: namaMenu, deskripsi, jumlah_porsi: jumlahPorsi });
    }

    const savedRows = await pesananRepository.createOrders(
      {
        reservasiId,
        namaPemesan: ctx.nama_pemesan,
        catalogItems,
        requestItems,
      },
      actor
    );

    const formatted = savedRows.map(formatOrderItem);
    const estimasiTotal = formatted
      .filter((i) => i.status_item === 'Diterima' && i.subtotal !== null)
      .reduce((sum, i) => sum + (i.subtotal ?? 0), 0);

    const menungguKeputusanAdmin = formatted.some((i) => i.status_item === 'Diajukan');

    return {
      detail_pesanan: formatted,
      estimasi_total: estimasiTotal,
      menunggu_keputusan_admin: menungguKeputusanAdmin,
    };
  },

  /**
   * E23 — GET /api/v1/reservations/:id/orders
   */
  async listMyOrders(
    reservasiId: string,
    requester: { userId: string; role: string }
  ) {
    if (!isValidUuid(reservasiId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const ctx = await pesananRepository.findReservationContext(reservasiId);
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

    const rows = await pesananRepository.listByReservation(reservasiId);
    const pesanan = rows.map(formatOrderItem);
    const estimasiTotal = pesanan
      .filter((i) => i.status_item === 'Diterima' && i.subtotal !== null)
      .reduce((sum, i) => sum + (i.subtotal ?? 0), 0);

    return {
      pesanan,
      estimasi_total: estimasiTotal,
    };
  },

  /**
   * E55 — GET /api/v1/admin/menu-requests
   */
  async listAdminMenuRequests(query: {
    status?: unknown;
    page?: unknown;
    per_page?: unknown;
  }): Promise<{ items: unknown[]; meta: PaginationMeta }> {
    const rawStatus = String(query.status ?? 'Diajukan').trim();
    const status = rawStatus.toLowerCase() === 'all' ? undefined : rawStatus;

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total } = await pesananRepository.listAdminMenuRequests({
      status,
      offset,
      perPage,
    });

    const items = rows.map((row) => ({
      order_detail_id: row.order_detail_id,
      reservasi_id: row.reservasi_id,
      nama_pemesan: row.nama_pemesan,
      no_whatsapp: row.no_whatsapp,
      jadwal_reservasi: row.jadwal_reservasi,
      nama_menu_request: row.nama_menu_request,
      deskripsi: row.catatan_request,
      jumlah_porsi: row.jumlah_porsi,
      status_item: row.status_item,
      harga_satuan: row.harga_satuan !== null ? Number(row.harga_satuan) : null,
      subtotal: row.subtotal !== null ? Number(row.subtotal) : null,
      catatan_admin: row.catatan_admin,
      diajukan_pada: row.created_at,
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
   * E56 — PATCH /api/v1/admin/menu-requests/:id/decision
   */
  async decideMenuRequest(
    orderDetailId: string,
    body: Record<string, unknown>,
    adminId: string,
    actor: AuditActor
  ) {
    if (!isValidUuid(orderDetailId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const rawKeputusan = String(body.keputusan ?? '').trim().toUpperCase();
    if (rawKeputusan !== 'TERIMA' && rawKeputusan !== 'TOLAK') {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Keputusan harus TERIMA atau TOLAK.',
        'keputusan'
      );
    }

    let hargaSatuan: number | null = null;
    let catatan: string | null = null;

    if (rawKeputusan === 'TERIMA') {
      const parsedHarga = Number(body.harga_satuan);
      if (body.harga_satuan === undefined || Number.isNaN(parsedHarga) || parsedHarga <= 0) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Harga satuan wajib diisi dengan nilai lebih dari 0.',
          'harga_satuan'
        );
      }
      hargaSatuan = parsedHarga;
      if (body.catatan !== undefined && body.catatan !== null) {
        catatan = String(body.catatan).trim().slice(0, 500) || null;
      }
    } else {
      const rawCatatan = String(body.catatan ?? '').trim();
      if (!rawCatatan) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Alasan penolakan wajib diisi.',
          'catatan'
        );
      }
      if (rawCatatan.length > 500) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Alasan penolakan maksimal 500 karakter.',
          'catatan'
        );
      }
      catatan = rawCatatan;
    }

    const updated = await pesananRepository.decideMenuRequest({
      orderDetailId,
      adminId,
      keputusan: rawKeputusan,
      hargaSatuan,
      catatan,
      actor,
    });

    return {
      order_detail_id: updated.order_detail_id,
      status_item: updated.status_item,
      harga_satuan: updated.harga_satuan !== null ? Number(updated.harga_satuan) : null,
      subtotal: updated.subtotal !== null ? Number(updated.subtotal) : null,
      catatan_admin: updated.catatan_admin,
    };
  },
};
