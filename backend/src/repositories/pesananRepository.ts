import { getPool, sql } from '../config/db.js';
import { AuditActor, insertAuditLogInTx } from '../utils/auditHelper.js';
import { ServiceError } from '../utils/errors.js';

export interface OrderDetailRow {
  order_detail_id: string;
  reservasi_id: string;
  menu_id: string | null;
  decided_by: string | null;
  nama_menu: string;
  nama_menu_request: string | null;
  catatan_request: string | null;
  jumlah_porsi: number;
  harga_satuan: number | null;
  subtotal: number | null;
  status_item: string;
  catatan_admin: string | null;
  created_at: Date;
}

export interface AdminMenuRequestRow extends OrderDetailRow {
  nama_pemesan: string;
  no_whatsapp: string;
  jadwal_reservasi: Date;
  status_reservasi: string;
}

export interface OrderReservationContext {
  reservasi_id: string;
  user_id: string;
  jadwal_reservasi: Date;
  status_reservasi: string;
  nama_pemesan: string;
}

export const pesananRepository = {
  async getOrderSettings(): Promise<{
    min_porsi_request: number;
    batas_submit_menu_hari: number;
  }> {
    const pool = await getPool();
    const result = await pool.request().query<{ setting_key: string; setting_value: string }>(`
      SELECT setting_key, setting_value
      FROM dbo.system_settings
      WHERE setting_key IN (N'min_porsi_request', N'batas_submit_menu_hari')
    `);
    const map: Record<string, string> = {};
    for (const r of result.recordset) map[r.setting_key] = r.setting_value;

    const minPorsi = Number.parseInt(map.min_porsi_request || '20', 10);
    const batasHari = Number.parseInt(map.batas_submit_menu_hari || '1', 10);

    return {
      min_porsi_request: Number.isNaN(minPorsi) || minPorsi < 1 ? 20 : minPorsi,
      batas_submit_menu_hari: Number.isNaN(batasHari) || batasHari < 0 ? 1 : batasHari,
    };
  },

  async findReservationContext(reservasiId: string): Promise<OrderReservationContext | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
    const result = await req.query<OrderReservationContext>(`
      SELECT
        r.reservasi_id,
        r.user_id,
        r.jadwal_reservasi,
        r.status_reservasi,
        u.full_name AS nama_pemesan
      FROM dbo.reservasi r
      INNER JOIN dbo.users u ON u.user_id = r.user_id
      WHERE r.reservasi_id = @reservasi_id
    `);
    return result.recordset[0] ?? null;
  },

  /**
   * E22 — Simpan pesanan menu katalog & menu request dalam satu transaksi atomik.
   */
  async createOrders(
    params: {
      reservasiId: string;
      namaPemesan: string;
      catalogItems: Array<{ menu_id: string; jumlah_porsi: number }>;
      requestItems: Array<{ nama_menu: string; deskripsi: string; jumlah_porsi: number }>;
    },
    actor: AuditActor
  ): Promise<OrderDetailRow[]> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const insertedIds: string[] = [];

      // 1. Proses menu katalog
      for (const item of params.catalogItems) {
        const menuReq = new sql.Request(tx);
        menuReq.input('menu_id', sql.UniqueIdentifier, item.menu_id);
        const menuRes = await menuReq.query<{
          menu_id: string;
          nama_menu: string;
          kategori_menu: string;
          harga: number;
          is_available: boolean;
          minimal_porsi: number;
          is_active: boolean;
        }>(`
          SELECT menu_id, nama_menu, kategori_menu, harga, is_available, minimal_porsi, is_active
          FROM dbo.menus
          WHERE menu_id = @menu_id AND is_active = 1
        `);

        const menu = menuRes.recordset[0];
        if (!menu) {
          throw new ServiceError(
            404,
            'ERR-DATA-01',
            `Menu (${item.menu_id}) tidak ditemukan atau tidak aktif.`
          );
        }

        if (!menu.is_available) {
          throw new ServiceError(
            409,
            'ERR-MENU-04',
            `Menu '${menu.nama_menu}' sedang tidak tersedia, silakan pilih menu alternatif.`
          );
        }

        if (item.jumlah_porsi < menu.minimal_porsi) {
          throw new ServiceError(
            422,
            'ERR-MENU-01',
            `Pesanan '${menu.nama_menu}' minimal ${menu.minimal_porsi} porsi.`,
            'items'
          );
        }

        // Cek duplikat menu pada reservasi yang sama
        const dupReq = new sql.Request(tx);
        dupReq.input('reservasi_id', sql.UniqueIdentifier, params.reservasiId);
        dupReq.input('menu_id', sql.UniqueIdentifier, item.menu_id);
        const dupRes = await dupReq.query<{ cnt: number }>(`
          SELECT COUNT(*) AS cnt
          FROM dbo.detail_pesanan
          WHERE reservasi_id = @reservasi_id AND menu_id = @menu_id
        `);
        if ((dupRes.recordset[0]?.cnt ?? 0) > 0) {
          throw new ServiceError(
            409,
            'ERR-VAL-02',
            `Menu '${menu.nama_menu}' sudah ada pada pesanan reservasi ini.`
          );
        }

        const hargaSatuan = Number(menu.harga);
        const subtotal = hargaSatuan * item.jumlah_porsi;

        const insReq = new sql.Request(tx);
        insReq.input('reservasi_id', sql.UniqueIdentifier, params.reservasiId);
        insReq.input('menu_id', sql.UniqueIdentifier, item.menu_id);
        insReq.input('jumlah_porsi', sql.Int, item.jumlah_porsi);
        insReq.input('harga_satuan', sql.Decimal(12, 2), hargaSatuan);
        insReq.input('subtotal', sql.Decimal(12, 2), subtotal);

        const insRes = await insReq.query<{ order_detail_id: string }>(`
          INSERT INTO dbo.detail_pesanan (
            reservasi_id, menu_id, jumlah_porsi, harga_satuan, subtotal, status_item
          )
          OUTPUT INSERTED.order_detail_id
          VALUES (
            @reservasi_id, @menu_id, @jumlah_porsi, @harga_satuan, @subtotal, N'Diterima'
          )
        `);
        const newId = insRes.recordset[0].order_detail_id;
        insertedIds.push(newId);

        await insertAuditLogInTx(tx, {
          actor,
          actionType: 'INSERT',
          resourceType: 'detail_pesanan',
          resourceId: newId,
          oldValues: null,
          newValues: {
            order_detail_id: newId,
            reservasi_id: params.reservasiId,
            menu_id: item.menu_id,
            jumlah_porsi: item.jumlah_porsi,
            harga_satuan: hargaSatuan,
            subtotal,
            status_item: 'Diterima',
          },
        });
      }

      // 2. Proses menu request
      for (const reqItem of params.requestItems) {
        const insReq = new sql.Request(tx);
        insReq.input('reservasi_id', sql.UniqueIdentifier, params.reservasiId);
        insReq.input('nama_menu_request', sql.NVarChar(100), reqItem.nama_menu);
        insReq.input('catatan_request', sql.NVarChar(500), reqItem.deskripsi);
        insReq.input('jumlah_porsi', sql.Int, reqItem.jumlah_porsi);

        const insRes = await insReq.query<{ order_detail_id: string }>(`
          INSERT INTO dbo.detail_pesanan (
            reservasi_id, menu_id, nama_menu_request, catatan_request,
            jumlah_porsi, harga_satuan, subtotal, status_item
          )
          OUTPUT INSERTED.order_detail_id
          VALUES (
            @reservasi_id, NULL, @nama_menu_request, @catatan_request,
            @jumlah_porsi, NULL, NULL, N'Diajukan'
          )
        `);
        const newId = insRes.recordset[0].order_detail_id;
        insertedIds.push(newId);

        await insertAuditLogInTx(tx, {
          actor,
          actionType: 'INSERT',
          resourceType: 'detail_pesanan',
          resourceId: newId,
          oldValues: null,
          newValues: {
            order_detail_id: newId,
            reservasi_id: params.reservasiId,
            nama_menu_request: reqItem.nama_menu,
            catatan_request: reqItem.deskripsi,
            jumlah_porsi: reqItem.jumlah_porsi,
            status_item: 'Diajukan',
          },
        });
      }

      // 3. Jika ada menu request, kirim notifikasi ke semua Admin & Manajer aktif
      if (params.requestItems.length > 0) {
        const notifReq = new sql.Request(tx);
        notifReq.input('judul', sql.NVarChar(150), 'Menu Request Baru Diajukan');
        notifReq.input(
          'isi',
          sql.NVarChar(sql.MAX),
          `${params.namaPemesan} mengajukan ${params.requestItems.length} menu request pada reservasi ${params.reservasiId}. Silakan tinjau dan tetapkan harga.`
        );
        await notifReq.query(`
          INSERT INTO dbo.notifikasi (user_id, judul, isi, is_read)
          SELECT u.user_id, @judul, @isi, 0
          FROM dbo.users u
          INNER JOIN dbo.roles r ON r.role_id = u.role_id
          WHERE u.is_active = 1 AND r.role_name IN (N'Admin', N'Manajer')
        `);
      }

      await tx.commit();

      return this.listByReservation(params.reservasiId);
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },

  /**
   * E23 — Ambil daftar pesanan menu untuk satu reservasi
   */
  async listByReservation(reservasiId: string): Promise<OrderDetailRow[]> {
    const pool = await getPool();
    const req = pool.request();
    req.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
    const result = await req.query<OrderDetailRow>(`
      SELECT
        dp.order_detail_id,
        dp.reservasi_id,
        dp.menu_id,
        dp.decided_by,
        COALESCE(m.nama_menu, dp.nama_menu_request) AS nama_menu,
        dp.nama_menu_request,
        dp.catatan_request,
        dp.jumlah_porsi,
        dp.harga_satuan,
        dp.subtotal,
        dp.status_item,
        dp.catatan_admin,
        dp.created_at
      FROM dbo.detail_pesanan dp
      LEFT JOIN dbo.menus m ON m.menu_id = dp.menu_id
      WHERE dp.reservasi_id = @reservasi_id
      ORDER BY dp.created_at ASC
    `);
    return result.recordset;
  },

  /**
   * E55 — Daftar menu request untuk Admin (hanya menu_id IS NULL)
   */
  async listAdminMenuRequests(filter: {
    status?: string;
    offset: number;
    perPage: number;
  }): Promise<{ rows: AdminMenuRequestRow[]; total: number }> {
    const pool = await getPool();
    const conditions: string[] = ['dp.menu_id IS NULL'];
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.status) {
      conditions.push('LOWER(dp.status_item) = LOWER(@status)');
      countReq.input('status', sql.NVarChar(15), filter.status);
      dataReq.input('status', sql.NVarChar(15), filter.status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countRes = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM dbo.detail_pesanan dp ${whereClause}
    `);
    const total = countRes.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataRes = await dataReq.query<AdminMenuRequestRow>(`
      SELECT
        dp.order_detail_id,
        dp.reservasi_id,
        dp.menu_id,
        dp.decided_by,
        dp.nama_menu_request AS nama_menu,
        dp.nama_menu_request,
        dp.catatan_request,
        dp.jumlah_porsi,
        dp.harga_satuan,
        dp.subtotal,
        dp.status_item,
        dp.catatan_admin,
        dp.created_at,
        u.full_name AS nama_pemesan,
        u.phone_number AS no_whatsapp,
        r.jadwal_reservasi,
        r.status_reservasi
      FROM dbo.detail_pesanan dp
      INNER JOIN dbo.reservasi r ON r.reservasi_id = dp.reservasi_id
      INNER JOIN dbo.users u ON u.user_id = r.user_id
      ${whereClause}
      ORDER BY dp.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataRes.recordset, total };
  },

  /**
   * E56 — Admin memutuskan menu request (TERIMA + harga_satuan, atau TOLAK + catatan)
   */
  async decideMenuRequest(params: {
    orderDetailId: string;
    adminId: string;
    keputusan: 'TERIMA' | 'TOLAK';
    hargaSatuan: number | null;
    catatan: string | null;
    actor: AuditActor;
  }): Promise<OrderDetailRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const findReq = new sql.Request(tx);
      findReq.input('order_detail_id', sql.UniqueIdentifier, params.orderDetailId);
      const findRes = await findReq.query<
        OrderDetailRow & { customer_id: string }
      >(`
        SELECT
          dp.order_detail_id,
          dp.reservasi_id,
          dp.menu_id,
          dp.decided_by,
          dp.nama_menu_request AS nama_menu,
          dp.nama_menu_request,
          dp.catatan_request,
          dp.jumlah_porsi,
          dp.harga_satuan,
          dp.subtotal,
          dp.status_item,
          dp.catatan_admin,
          dp.created_at,
          r.user_id AS customer_id
        FROM dbo.detail_pesanan dp WITH (UPDLOCK, HOLDLOCK)
        INNER JOIN dbo.reservasi r ON r.reservasi_id = dp.reservasi_id
        WHERE dp.order_detail_id = @order_detail_id
          AND dp.menu_id IS NULL
      `);

      const existing = findRes.recordset[0];
      if (!existing) {
        throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
      }

      if (existing.status_item !== 'Diajukan') {
        throw new ServiceError(409, 'ERR-MENU-06', 'Menu request sudah diputuskan.');
      }

      const isAccept = params.keputusan === 'TERIMA';
      const newStatus = isAccept ? 'Diterima' : 'Ditolak';
      const hargaSatuan = isAccept ? params.hargaSatuan : null;
      const subtotal =
        isAccept && hargaSatuan !== null ? hargaSatuan * existing.jumlah_porsi : null;

      const updReq = new sql.Request(tx);
      updReq.input('order_detail_id', sql.UniqueIdentifier, params.orderDetailId);
      updReq.input('status_item', sql.NVarChar(15), newStatus);
      updReq.input('harga_satuan', sql.Decimal(12, 2), hargaSatuan);
      updReq.input('subtotal', sql.Decimal(12, 2), subtotal);
      updReq.input('catatan_admin', sql.NVarChar(500), params.catatan);
      updReq.input('decided_by', sql.UniqueIdentifier, params.adminId);

      const updRes = await updReq.query<OrderDetailRow>(`
        UPDATE dbo.detail_pesanan
        SET
          status_item = @status_item,
          harga_satuan = @harga_satuan,
          subtotal = @subtotal,
          catatan_admin = @catatan_admin,
          decided_by = @decided_by
        OUTPUT INSERTED.*
        WHERE order_detail_id = @order_detail_id
      `);

      const updated = updRes.recordset[0];

      // Notifikasi ke Customer
      const notifReq = new sql.Request(tx);
      notifReq.input('user_id', sql.UniqueIdentifier, existing.customer_id);
      notifReq.input(
        'judul',
        sql.NVarChar(150),
        isAccept ? 'Menu Request Diterima' : 'Menu Request Ditolak'
      );
      notifReq.input(
        'isi',
        sql.NVarChar(sql.MAX),
        isAccept
          ? `Menu request '${existing.nama_menu_request}' (${existing.jumlah_porsi} porsi) telah diterima dengan harga Rp ${hargaSatuan}/porsi. Silakan lanjutkan pembayaran pelunasan.`
          : `Menu request '${existing.nama_menu_request}' ditolak oleh Admin. Alasan: ${params.catatan || '-'}`
      );
      await notifReq.query(`
        INSERT INTO dbo.notifikasi (user_id, judul, isi, is_read)
        VALUES (@user_id, @judul, @isi, 0)
      `);

      await insertAuditLogInTx(tx, {
        actor: params.actor,
        actionType: 'UPDATE',
        resourceType: 'detail_pesanan',
        resourceId: params.orderDetailId,
        oldValues: existing,
        newValues: updated,
      });

      await tx.commit();
      return {
        ...updated,
        nama_menu: existing.nama_menu_request || '',
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },
};
