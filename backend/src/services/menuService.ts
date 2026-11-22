import { menuRepository, MenuRow } from '../repositories/menuRepository.js';
import { AuditActor } from '../utils/auditHelper.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

const formatPublicMenu = (row: MenuRow) => ({
  id: row.menu_id,
  nama: row.nama_menu,
  kategori: row.kategori_menu,
  harga: Number(row.harga),
  tersedia: Boolean(row.is_available),
  minimal_porsi: row.minimal_porsi,
  deskripsi: row.deskripsi,
  foto_url: row.link_foto_menu,
});

const formatAdminMenu = (row: MenuRow) => ({
  id: row.menu_id,
  menu_id: row.menu_id,
  nama: row.nama_menu,
  kategori: row.kategori_menu,
  harga: Number(row.harga),
  tersedia: Boolean(row.is_available),
  minimal_porsi: row.minimal_porsi,
  deskripsi: row.deskripsi,
  foto_url: row.link_foto_menu,
  is_active: Boolean(row.is_active),
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

const normalizeKategori = (raw: unknown): 'Reguler' | 'Khusus' => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'reguler') return 'Reguler';
  if (s === 'khusus') return 'Khusus';
  throw new ServiceError(
    422,
    'ERR-VAL-02',
    'Kategori menu harus Reguler atau Khusus.',
    'kategori'
  );
};

export const menuService = {
  /**
   * E21 — GET /api/v1/menus (Customer pre-order catalog + rekomendasi alternatif)
   */
  async listForCustomerOrder(
    query: { reservasi_id?: unknown; kategori?: unknown; search?: unknown },
    requester: { userId: string; role: string }
  ) {
    if (query.reservasi_id !== undefined && String(query.reservasi_id).trim() !== '') {
      const reservasiId = String(query.reservasi_id).trim();
      if (!isValidUuid(reservasiId)) {
        throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
      }
      const resInfo = await menuRepository.findReservationStatusForUser(reservasiId);
      if (!resInfo) {
        throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
      }
      if (
        requester.role.toLowerCase() !== 'manajer' &&
        resInfo.user_id.toLowerCase() !== requester.userId.toLowerCase()
      ) {
        throw new ServiceError(
          403,
          'ERR-AUTH-03',
          'Anda tidak memiliki izin untuk mengakses fitur ini'
        );
      }
      if (resInfo.status_reservasi !== 'Terkonfirmasi') {
        throw new ServiceError(
          403,
          'ERR-MENU-03',
          'Selesaikan pembayaran DP terlebih dahulu.'
        );
      }
    }

    let kategori: string | undefined;
    if (query.kategori !== undefined && String(query.kategori).trim() !== '') {
      kategori = normalizeKategori(query.kategori);
    }

    const search =
      query.search !== undefined && String(query.search).trim() !== ''
        ? String(query.search).trim()
        : undefined;

    const rows = await menuRepository.listAllActiveCatalog({ kategori, search });
    const availablePool = rows.filter((m) => Boolean(m.is_available));

    return rows.map((row) => {
      const isAvail = Boolean(row.is_available);
      let alternatif: Array<{ id: string; nama: string; harga: number }> = [];
      if (!isAvail) {
        const sameCat = availablePool.filter(
          (m) => m.menu_id !== row.menu_id && m.kategori_menu === row.kategori_menu
        );
        const fallback = availablePool.filter(
          (m) => m.menu_id !== row.menu_id && m.kategori_menu !== row.kategori_menu
        );
        alternatif = [...sameCat, ...fallback].slice(0, 3).map((a) => ({
          id: a.menu_id,
          nama: a.nama_menu,
          harga: Number(a.harga),
        }));
      }

      return {
        ...formatPublicMenu(row),
        alternatif,
      };
    });
  },

  /**
   * E07 — GET /api/v1/public/menus
   */
  async listPublic(query: {
    kategori?: unknown;
    search?: unknown;
    page?: unknown;
    per_page?: unknown;
  }): Promise<{ items: ReturnType<typeof formatPublicMenu>[]; meta: PaginationMeta }> {
    let kategori: string | undefined;
    if (query.kategori !== undefined && String(query.kategori).trim() !== '') {
      kategori = normalizeKategori(query.kategori);
    }

    const search =
      query.search !== undefined && String(query.search).trim() !== ''
        ? String(query.search).trim()
        : undefined;

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total } = await menuRepository.listPublic({
      kategori,
      search,
      offset,
      perPage,
    });

    return {
      items: rows.map(formatPublicMenu),
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  },

  /**
   * E34 — GET /api/v1/admin/menus
   */
  async listAdmin(query: {
    kategori?: unknown;
    tersedia?: unknown;
    search?: unknown;
    include_inactive?: unknown;
    page?: unknown;
    per_page?: unknown;
  }): Promise<{ items: ReturnType<typeof formatAdminMenu>[]; meta: PaginationMeta }> {
    let kategori: string | undefined;
    if (query.kategori !== undefined && String(query.kategori).trim() !== '') {
      kategori = normalizeKategori(query.kategori);
    }

    const tersedia = parseOptionalBoolean(query.tersedia, 'tersedia');
    const includeInactive =
      parseOptionalBoolean(query.include_inactive, 'include_inactive') ?? false;
    const search =
      query.search !== undefined && String(query.search).trim() !== ''
        ? String(query.search).trim()
        : undefined;

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total } = await menuRepository.listAdmin({
      kategori,
      tersedia,
      search,
      includeInactive,
      offset,
      perPage,
    });

    return {
      items: rows.map(formatAdminMenu),
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  },

  /**
   * E35 — POST /api/v1/admin/menus
   */
  async create(body: Record<string, unknown>, actor: AuditActor) {
    const nama = String(body.nama ?? body.nama_menu ?? '').trim();
    if (!nama || nama.length > 100) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Nama menu wajib diisi (maksimal 100 karakter).',
        'nama'
      );
    }

    const kategori = normalizeKategori(body.kategori ?? body.kategori_menu);

    const harga = Number(body.harga);
    if (Number.isNaN(harga) || harga <= 0) {
      throw new ServiceError(422, 'ERR-VAL-02', 'Harga harus lebih dari 0.', 'harga');
    }

    const tersedia = parseOptionalBoolean(body.tersedia ?? body.is_available, 'tersedia') ?? true;

    const minimalPorsi =
      body.minimal_porsi !== undefined ? Number(body.minimal_porsi) : 1;
    if (!Number.isInteger(minimalPorsi) || minimalPorsi < 1) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Minimal porsi harus bilangan bulat minimal 1.',
        'minimal_porsi'
      );
    }

    const deskripsi =
      body.deskripsi !== undefined && body.deskripsi !== null
        ? String(body.deskripsi).trim()
        : null;

    const fotoUrl =
      body.foto_url !== undefined && body.foto_url !== null && String(body.foto_url).trim() !== ''
        ? String(body.foto_url).trim().slice(0, 255)
        : null;

    const existing = await menuRepository.findByName(nama);
    if (existing) {
      throw new ServiceError(409, 'ERR-VAL-02', 'Nama menu sudah digunakan.', 'nama');
    }

    const created = await menuRepository.create(
      {
        nama_menu: nama,
        kategori_menu: kategori,
        harga,
        is_available: tersedia,
        minimal_porsi: minimalPorsi,
        deskripsi,
        link_foto_menu: fotoUrl,
      },
      actor
    );

    return formatAdminMenu(created);
  },

  /**
   * E36 — PATCH /api/v1/admin/menus/:id
   */
  async update(menuId: string, body: Record<string, unknown>, actor: AuditActor) {
    if (!isValidUuid(menuId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const existing = await menuRepository.findById(menuId);
    if (!existing || !existing.is_active) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    let nama = existing.nama_menu;
    if (body.nama !== undefined || body.nama_menu !== undefined) {
      nama = String(body.nama ?? body.nama_menu ?? '').trim();
      if (!nama || nama.length > 100) {
        throw new ServiceError(422, 'ERR-VAL-02', 'Nama menu tidak valid.', 'nama');
      }
      const duplicate = await menuRepository.findByName(nama, menuId);
      if (duplicate) {
        throw new ServiceError(409, 'ERR-VAL-02', 'Nama menu sudah digunakan.', 'nama');
      }
    }

    let kategori = existing.kategori_menu;
    if (body.kategori !== undefined || body.kategori_menu !== undefined) {
      kategori = normalizeKategori(body.kategori ?? body.kategori_menu);
    }

    let harga = Number(existing.harga);
    if (body.harga !== undefined) {
      harga = Number(body.harga);
      if (Number.isNaN(harga) || harga <= 0) {
        throw new ServiceError(422, 'ERR-VAL-02', 'Harga harus lebih dari 0.', 'harga');
      }
    }

    let tersedia = Boolean(existing.is_available);
    if (body.tersedia !== undefined || body.is_available !== undefined) {
      tersedia =
        parseOptionalBoolean(body.tersedia ?? body.is_available, 'tersedia') ?? tersedia;
    }

    let minimalPorsi = existing.minimal_porsi;
    if (body.minimal_porsi !== undefined) {
      minimalPorsi = Number(body.minimal_porsi);
      if (!Number.isInteger(minimalPorsi) || minimalPorsi < 1) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Minimal porsi harus bilangan bulat minimal 1.',
          'minimal_porsi'
        );
      }
    }

    let deskripsi = existing.deskripsi;
    if (body.deskripsi !== undefined) {
      deskripsi = body.deskripsi === null ? null : String(body.deskripsi).trim();
    }

    let fotoUrl = existing.link_foto_menu;
    if (body.foto_url !== undefined) {
      fotoUrl =
        body.foto_url === null || String(body.foto_url).trim() === ''
          ? null
          : String(body.foto_url).trim().slice(0, 255);
    }

    const updated = await menuRepository.update(
      menuId,
      existing,
      {
        nama_menu: nama,
        kategori_menu: kategori,
        harga,
        is_available: tersedia,
        minimal_porsi: minimalPorsi,
        deskripsi,
        link_foto_menu: fotoUrl,
      },
      actor
    );

    return formatAdminMenu(updated);
  },

  /**
   * E37 — DELETE /api/v1/admin/menus/:id
   */
  async remove(menuId: string, actor: AuditActor) {
    if (!isValidUuid(menuId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const existing = await menuRepository.findById(menuId);
    if (!existing || !existing.is_active) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const inUse = await menuRepository.hasActiveReservation(menuId);
    if (inUse) {
      throw new ServiceError(
        409,
        'ERR-VAL-02',
        'Menu masih digunakan pada reservasi aktif.'
      );
    }

    await menuRepository.softDelete(menuId, existing, actor);
  },
};
