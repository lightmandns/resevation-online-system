import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getPool, sql } from '../config/db.js';
import { AuditActor, insertAuditLogInTx } from '../utils/auditHelper.js';
import { ServiceError } from '../utils/errors.js';

export interface ReservasiRow {
  reservasi_id: string;
  user_id: string;
  dibuat_oleh: string | null;
  jadwal_reservasi: Date;
  jadwal_selesai: Date;
  jenis_layanan: string;
  jenis_acara: string;
  status_reservasi: string;
  jumlah_tamu: number;
  batas_penahanan: Date | null;
  created_at: Date;
  updated_at: Date;
  nama_pemesan?: string;
  no_whatsapp?: string;
  email_pemesan?: string;
}

export interface ReservasiBlokInfo {
  blok_id: string;
  nama_blok: string;
  kapasitas: number;
  nominal_dp: number;
  deskripsi: string | null;
  status_penahanan?: string;
}

export interface ReservasiPaymentInfo {
  payment_id: string;
  jenis_pembayaran: string;
  metode_pembayaran: string;
  bank: string | null;
  nominal: number;
  kode_va: string | null;
  status: string;
  waktu_kadaluarsa: Date;
  paid_at: Date | null;
}

export interface ReservasiOrderInfo {
  order_detail_id: string;
  menu_id: string | null;
  nama_menu: string;
  nama_menu_request: string | null;
  catatan_request: string | null;
  jumlah_porsi: number;
  harga_satuan: number | null;
  subtotal: number | null;
  status_item: string;
  catatan_admin: string | null;
}

export interface ReservasiHistoryInfo {
  history_id: string;
  status_lama: string | null;
  status_baru: string;
  diubah_oleh: string | null;
  created_at: Date;
}

export interface ReservasiListRow extends ReservasiRow {
  blok_list: string | null;
  status_dp: string | null;
  status_pelunasan: string | null;
  has_review: boolean | number;
}

export const reservasiRepository = {
  async getReservationSettings(): Promise<{
    jam_buka: string;
    jam_tutup: string;
    durasi_slot_jam: number;
    batas_waktu_dp_menit: number;
    batas_submit_menu_hari: number;
    whatsapp_admin: string;
  }> {
    const pool = await getPool();
    const result = await pool.request().query<{ setting_key: string; setting_value: string }>(`
      SELECT setting_key, setting_value
      FROM dbo.system_settings
      WHERE setting_key IN (
        N'jam_buka', N'jam_tutup', N'durasi_slot_jam',
        N'batas_waktu_dp_menit', N'batas_submit_menu_hari', N'whatsapp_admin'
      )
    `);

    const map: Record<string, string> = {};
    for (const r of result.recordset) {
      map[r.setting_key] = r.setting_value;
    }

    const durasi = Number.parseInt(map.durasi_slot_jam || '3', 10);
    const dpMenit = Number.parseInt(map.batas_waktu_dp_menit || '10', 10);
    const menuHari = Number.parseInt(map.batas_submit_menu_hari || '1', 10);

    return {
      jam_buka: map.jam_buka || '10:00',
      jam_tutup: map.jam_tutup || '22:00',
      durasi_slot_jam: Number.isNaN(durasi) || durasi <= 0 ? 3 : durasi,
      batas_waktu_dp_menit: Number.isNaN(dpMenit) || dpMenit <= 0 ? 10 : dpMenit,
      batas_submit_menu_hari: Number.isNaN(menuHari) || menuHari < 0 ? 1 : menuHari,
      whatsapp_admin: map.whatsapp_admin || '',
    };
  },

  /**
   * E11 — Buat reservasi reguler secara atomik dengan penguncian blok (UPDLOCK, HOLDLOCK).
   */
  async createRegularReservation(
    params: {
      userId: string;
      jadwalReservasi: Date;
      jadwalSelesai: Date;
      jumlahTamu: number;
      blokIds: string[];
      batasPenahanan: Date;
    },
    actor: AuditActor
  ): Promise<{
    reservasi: ReservasiRow;
    blocks: ReservasiBlokInfo[];
    nominalDp: number;
  }> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      // 1. Kunci baris blok yang dipilih secara atomik
      const lockReq = new sql.Request(tx);
      const paramNames = params.blokIds.map((id, idx) => {
        const key = `b${idx}`;
        lockReq.input(key, sql.UniqueIdentifier, id);
        return `@${key}`;
      });

      const blocksResult = await lockReq.query<ReservasiBlokInfo>(`
        SELECT blok_id, nama_blok, kapasitas, nominal_dp, deskripsi
        FROM dbo.blokmeja WITH (UPDLOCK, HOLDLOCK)
        WHERE blok_id IN (${paramNames.join(', ')})
          AND is_active = 1
      `);

      const lockedBlocks = blocksResult.recordset;
      if (lockedBlocks.length !== params.blokIds.length) {
        throw new ServiceError(
          404,
          'ERR-DATA-01',
          'Salah satu blok yang dipilih tidak ditemukan atau tidak aktif.'
        );
      }

      // 2. Validasi total kapasitas blok
      const totalKapasitas = lockedBlocks.reduce((sum, b) => sum + b.kapasitas, 0);
      if (params.jumlahTamu > totalKapasitas) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          `Jumlah tamu (${params.jumlahTamu}) melebihi total kapasitas blok terpilih (${totalKapasitas}).`,
          'jumlah_tamu'
        );
      }

      // 3. Cek ulang bentrok jadwal secara atomik pada slot [jadwalReservasi, jadwalSelesai)
      const conflictReq = new sql.Request(tx);
      conflictReq.input('jadwal_mulai', sql.DateTimeOffset(0), params.jadwalReservasi);
      conflictReq.input('jadwal_selesai', sql.DateTimeOffset(0), params.jadwalSelesai);
      const conflictParams = params.blokIds.map((id, idx) => {
        const key = `cb${idx}`;
        conflictReq.input(key, sql.UniqueIdentifier, id);
        return `@${key}`;
      });

      const conflictResult = await conflictReq.query<{ cnt: number }>(`
        SELECT COUNT(*) AS cnt
        FROM dbo.reservasi_blok rb
        INNER JOIN dbo.reservasi r ON r.reservasi_id = rb.reservasi_id
        WHERE rb.blok_id IN (${conflictParams.join(', ')})
          AND rb.status_penahanan IN (N'Ditahan', N'Terpakai')
          AND r.status_reservasi IN (N'MenungguPembayaran', N'MenungguVerifikasi', N'Terkonfirmasi')
          AND (r.status_reservasi <> N'MenungguPembayaran' OR r.batas_penahanan > SYSDATETIMEOFFSET())
          AND r.jadwal_reservasi < @jadwal_selesai
          AND r.jadwal_selesai > @jadwal_mulai
      `);

      if ((conflictResult.recordset[0]?.cnt ?? 0) > 0) {
        throw new ServiceError(
          409,
          'ERR-RES-02',
          'Blok baru saja dipesan, silakan pilih blok lain.'
        );
      }

      // 4. Insert reservasi baru
      const insertResReq = new sql.Request(tx);
      insertResReq.input('user_id', sql.UniqueIdentifier, params.userId);
      insertResReq.input('jadwal_reservasi', sql.DateTimeOffset(0), params.jadwalReservasi);
      insertResReq.input('jadwal_selesai', sql.DateTimeOffset(0), params.jadwalSelesai);
      insertResReq.input('jumlah_tamu', sql.Int, params.jumlahTamu);
      insertResReq.input('batas_penahanan', sql.DateTimeOffset(0), params.batasPenahanan);

      const resInserted = await insertResReq.query<ReservasiRow>(`
        INSERT INTO dbo.reservasi (
          user_id, jadwal_reservasi, jadwal_selesai, jenis_layanan,
          jenis_acara, status_reservasi, jumlah_tamu, batas_penahanan
        )
        OUTPUT INSERTED.*
        VALUES (
          @user_id, @jadwal_reservasi, @jadwal_selesai, N'Reguler',
          N'Basic', N'MenungguPembayaran', @jumlah_tamu, @batas_penahanan
        )
      `);

      const newReservasi = resInserted.recordset[0];

      // 5. Insert reservasi_blok & update status_ketersediaan blokmeja
      for (const block of lockedBlocks) {
        const rbReq = new sql.Request(tx);
        rbReq.input('reservasi_id', sql.UniqueIdentifier, newReservasi.reservasi_id);
        rbReq.input('blok_id', sql.UniqueIdentifier, block.blok_id);
        await rbReq.query(`
          INSERT INTO dbo.reservasi_blok (reservasi_id, blok_id, status_penahanan)
          VALUES (@reservasi_id, @blok_id, N'Ditahan')
        `);

        const updBlockReq = new sql.Request(tx);
        updBlockReq.input('blok_id', sql.UniqueIdentifier, block.blok_id);
        await updBlockReq.query(`
          UPDATE dbo.blokmeja
          SET status_ketersediaan = N'Waiting', updated_at = SYSDATETIMEOFFSET()
          WHERE blok_id = @blok_id
        `);
      }

      // 6. Catat riwayat status awal
      const histReq = new sql.Request(tx);
      histReq.input('reservasi_id', sql.UniqueIdentifier, newReservasi.reservasi_id);
      histReq.input('diubah_oleh', sql.UniqueIdentifier, params.userId);
      await histReq.query(`
        INSERT INTO dbo.reservasi_status_history (reservasi_id, status_lama, status_baru, diubah_oleh)
        VALUES (@reservasi_id, NULL, N'MenungguPembayaran', @diubah_oleh)
      `);

      // 7. Catat audit log
      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'INSERT',
        resourceType: 'reservasi',
        resourceId: newReservasi.reservasi_id,
        oldValues: null,
        newValues: {
          ...newReservasi,
          blok_ids: params.blokIds,
        },
      });

      await tx.commit();

      const nominalDp = lockedBlocks.reduce((sum, b) => sum + Number(b.nominal_dp), 0);
      return {
        reservasi: newReservasi,
        blocks: lockedBlocks,
        nominalDp,
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },

  /**
   * E12 — Daftar reservasi milik user
   */
  async listByUser(filter: {
    userId: string;
    status?: string;
    offset: number;
    perPage: number;
  }): Promise<{ rows: ReservasiListRow[]; total: number }> {
    const pool = await getPool();
    const conditions: string[] = ['r.user_id = @user_id'];
    const countReq = pool.request();
    const dataReq = pool.request();

    countReq.input('user_id', sql.UniqueIdentifier, filter.userId);
    dataReq.input('user_id', sql.UniqueIdentifier, filter.userId);

    if (filter.status) {
      conditions.push('LOWER(r.status_reservasi) = LOWER(@status)');
      countReq.input('status', sql.NVarChar(25), filter.status);
      dataReq.input('status', sql.NVarChar(25), filter.status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM dbo.reservasi r ${whereClause}
    `);
    const total = countResult.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataResult = await dataReq.query<ReservasiListRow>(`
      SELECT
        r.*,
        (
          SELECT STRING_AGG(b.nama_blok, N', ')
          FROM dbo.reservasi_blok rb
          INNER JOIN dbo.blokmeja b ON b.blok_id = rb.blok_id
          WHERE rb.reservasi_id = r.reservasi_id
        ) AS blok_list,
        (
          SELECT TOP 1 p.status
          FROM dbo.pembayaran p
          WHERE p.reservasi_id = r.reservasi_id AND p.jenis_pembayaran = N'DP'
          ORDER BY p.created_at DESC
        ) AS status_dp,
        (
          SELECT TOP 1 p.status
          FROM dbo.pembayaran p
          WHERE p.reservasi_id = r.reservasi_id AND p.jenis_pembayaran = N'Pelunasan'
          ORDER BY p.created_at DESC
        ) AS status_pelunasan,
        CASE
          WHEN EXISTS (SELECT 1 FROM dbo.ulasan u WHERE u.reservasi_id = r.reservasi_id)
          THEN CAST(1 AS BIT)
          ELSE CAST(0 AS BIT)
        END AS has_review
      FROM dbo.reservasi r
      ${whereClause}
      ORDER BY r.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataResult.recordset, total };
  },

  /**
   * E13 & E14 — Ambil detail lengkap satu reservasi beserta relasinya
   */
  async findDetailById(reservasiId: string): Promise<{
    reservasi: ReservasiRow;
    blocks: ReservasiBlokInfo[];
    payments: ReservasiPaymentInfo[];
    orders: ReservasiOrderInfo[];
    history: ReservasiHistoryInfo[];
    review: { rating: number; komentar: string | null; created_at: Date } | null;
  } | null> {
    const pool = await getPool();

    const resReq = pool.request();
    resReq.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
    const resResult = await resReq.query<ReservasiRow>(`
      SELECT
        r.*,
        u.full_name AS nama_pemesan,
        u.phone_number AS no_whatsapp,
        u.email AS email_pemesan
      FROM dbo.reservasi r
      INNER JOIN dbo.users u ON u.user_id = r.user_id
      WHERE r.reservasi_id = @reservasi_id
    `);

    const reservasi = resResult.recordset[0];
    if (!reservasi) return null;

    const blokReq = pool.request();
    blokReq.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
    const blokResult = await blokReq.query<ReservasiBlokInfo>(`
      SELECT
        b.blok_id, b.nama_blok, b.kapasitas, b.nominal_dp, b.deskripsi,
        rb.status_penahanan
      FROM dbo.reservasi_blok rb
      INNER JOIN dbo.blokmeja b ON b.blok_id = rb.blok_id
      WHERE rb.reservasi_id = @reservasi_id
      ORDER BY b.nama_blok ASC
    `);

    const payReq = pool.request();
    payReq.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
    const payResult = await payReq.query<ReservasiPaymentInfo>(`
      SELECT
        payment_id, jenis_pembayaran, metode_pembayaran, bank,
        nominal, kode_va, status, waktu_kadaluarsa, paid_at
      FROM dbo.pembayaran
      WHERE reservasi_id = @reservasi_id
      ORDER BY created_at DESC
    `);

    const orderReq = pool.request();
    orderReq.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
    const orderResult = await orderReq.query<ReservasiOrderInfo>(`
      SELECT
        dp.order_detail_id,
        dp.menu_id,
        COALESCE(m.nama_menu, dp.nama_menu_request) AS nama_menu,
        dp.nama_menu_request,
        dp.catatan_request,
        dp.jumlah_porsi,
        dp.harga_satuan,
        dp.subtotal,
        dp.status_item,
        dp.catatan_admin
      FROM dbo.detail_pesanan dp
      LEFT JOIN dbo.menus m ON m.menu_id = dp.menu_id
      WHERE dp.reservasi_id = @reservasi_id
      ORDER BY dp.created_at ASC
    `);

    const histReq = pool.request();
    histReq.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
    const histResult = await histReq.query<ReservasiHistoryInfo>(`
      SELECT history_id, status_lama, status_baru, diubah_oleh, created_at
      FROM dbo.reservasi_status_history
      WHERE reservasi_id = @reservasi_id
      ORDER BY created_at ASC
    `);

    const revReq = pool.request();
    revReq.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
    const revResult = await revReq.query<{
      rating: number;
      komentar: string | null;
      created_at: Date;
    }>(`
      SELECT rating, komentar, created_at
      FROM dbo.ulasan
      WHERE reservasi_id = @reservasi_id
    `);

    return {
      reservasi,
      blocks: blokResult.recordset,
      payments: payResult.recordset,
      orders: orderResult.recordset,
      history: histResult.recordset,
      review: revResult.recordset[0] ?? null,
    };
  },

  /**
   * E26 & E27 — Daftar reservasi untuk Admin/Manajer (aktif urut terdekat, riwayat urut terbaru)
   */
  async listAdmin(filter: {
    mode: 'active' | 'history';
    tanggal?: string;
    namaPelanggan?: string;
    status?: string;
    offset: number;
    perPage: number;
  }): Promise<{
    rows: Array<
      ReservasiListRow & {
        nama_customer: string;
        no_whatsapp: string;
        nominal_dp: number;
      }
    >;
    total: number;
  }> {
    const pool = await getPool();
    const conditions: string[] = [];
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.mode === 'active') {
      conditions.push(
        "r.status_reservasi IN (N'MenungguPembayaran', N'MenungguVerifikasi', N'Terkonfirmasi')"
      );
    } else {
      conditions.push(
        "r.status_reservasi IN (N'Selesai', N'Dibatalkan', N'Ditolak', N'Kadaluarsa')"
      );
    }

    if (filter.tanggal) {
      conditions.push('CAST(r.jadwal_reservasi AS DATE) = @tanggal');
      countReq.input('tanggal', sql.Date, filter.tanggal);
      dataReq.input('tanggal', sql.Date, filter.tanggal);
    }

    if (filter.namaPelanggan) {
      conditions.push('u.full_name LIKE @nama_pelanggan');
      const pattern = `%${filter.namaPelanggan}%`;
      countReq.input('nama_pelanggan', sql.NVarChar(105), pattern);
      dataReq.input('nama_pelanggan', sql.NVarChar(105), pattern);
    }

    if (filter.status) {
      conditions.push('LOWER(r.status_reservasi) = LOWER(@status)');
      countReq.input('status', sql.NVarChar(25), filter.status);
      dataReq.input('status', sql.NVarChar(25), filter.status);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;
    const orderClause =
      filter.mode === 'active'
        ? 'ORDER BY r.jadwal_reservasi ASC'
        : 'ORDER BY r.jadwal_reservasi DESC';

    const countRes = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total
      FROM dbo.reservasi r
      INNER JOIN dbo.users u ON u.user_id = r.user_id
      ${whereClause}
    `);
    const total = countRes.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataRes = await dataReq.query<
      ReservasiListRow & {
        nama_customer: string;
        no_whatsapp: string;
        nominal_dp: number;
      }
    >(`
      SELECT
        r.*,
        u.full_name AS nama_customer,
        u.phone_number AS no_whatsapp,
        (
          SELECT STRING_AGG(b.nama_blok, N', ')
          FROM dbo.reservasi_blok rb
          INNER JOIN dbo.blokmeja b ON b.blok_id = rb.blok_id
          WHERE rb.reservasi_id = r.reservasi_id
        ) AS blok_list,
        ISNULL((
          SELECT SUM(b.nominal_dp)
          FROM dbo.reservasi_blok rb
          INNER JOIN dbo.blokmeja b ON b.blok_id = rb.blok_id
          WHERE rb.reservasi_id = r.reservasi_id
        ), 0) AS nominal_dp,
        (
          SELECT TOP 1 p.status
          FROM dbo.pembayaran p
          WHERE p.reservasi_id = r.reservasi_id AND p.jenis_pembayaran = N'DP'
          ORDER BY p.created_at DESC
        ) AS status_dp,
        (
          SELECT TOP 1 p.status
          FROM dbo.pembayaran p
          WHERE p.reservasi_id = r.reservasi_id AND p.jenis_pembayaran = N'Pelunasan'
          ORDER BY p.created_at DESC
        ) AS status_pelunasan,
        CASE
          WHEN EXISTS (SELECT 1 FROM dbo.ulasan ul WHERE ul.reservasi_id = r.reservasi_id)
          THEN CAST(1 AS BIT)
          ELSE CAST(0 AS BIT)
        END AS has_review
      FROM dbo.reservasi r
      INNER JOIN dbo.users u ON u.user_id = r.user_id
      ${whereClause}
      ${orderClause}
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataRes.recordset, total };
  },

  /**
   * E29 — Input reservasi layanan khusus oleh Admin secara atomik.
   */
  async createSpecialReservation(
    params: {
      adminId: string;
      namaPemesan: string;
      nomorWhatsapp: string;
      emailPemesan?: string;
      jenisAcara: string;
      jadwalReservasi: Date;
      jadwalSelesai: Date;
      jumlahTamu: number;
      blokIds: string[];
      batasPenahanan: Date;
      statusPembayaran: 'belum' | 'dp' | 'lunas';
      pesananMenu: Array<{
        menu_id?: string;
        nama_menu?: string;
        jumlah_porsi: number;
        harga_satuan?: number;
        keterangan?: string;
      }>;
    },
    actor: AuditActor
  ): Promise<{ reservasi: ReservasiRow; blocks: ReservasiBlokInfo[] }> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      // 1. Kunci blok yang dipilih
      const lockReq = new sql.Request(tx);
      const paramNames = params.blokIds.map((id, idx) => {
        const key = `sb${idx}`;
        lockReq.input(key, sql.UniqueIdentifier, id);
        return `@${key}`;
      });

      const blocksResult = await lockReq.query<ReservasiBlokInfo>(`
        SELECT blok_id, nama_blok, kapasitas, nominal_dp, deskripsi
        FROM dbo.blokmeja WITH (UPDLOCK, HOLDLOCK)
        WHERE blok_id IN (${paramNames.join(', ')})
          AND is_active = 1
      `);

      const lockedBlocks = blocksResult.recordset;
      if (lockedBlocks.length !== params.blokIds.length) {
        throw new ServiceError(
          404,
          'ERR-DATA-01',
          'Salah satu blok yang dipilih tidak ditemukan atau tidak aktif.'
        );
      }

      const totalKapasitas = lockedBlocks.reduce((sum, b) => sum + b.kapasitas, 0);
      if (params.jumlahTamu > totalKapasitas) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          `Jumlah tamu (${params.jumlahTamu}) melebihi total kapasitas blok terpilih (${totalKapasitas}).`,
          'jumlah_tamu'
        );
      }

      // 2. Cek bentrok jadwal
      const conflictReq = new sql.Request(tx);
      conflictReq.input('jadwal_mulai', sql.DateTimeOffset(0), params.jadwalReservasi);
      conflictReq.input('jadwal_selesai', sql.DateTimeOffset(0), params.jadwalSelesai);
      const conflictParams = params.blokIds.map((id, idx) => {
        const key = `scb${idx}`;
        conflictReq.input(key, sql.UniqueIdentifier, id);
        return `@${key}`;
      });

      const conflictResult = await conflictReq.query<{ cnt: number }>(`
        SELECT COUNT(*) AS cnt
        FROM dbo.reservasi_blok rb
        INNER JOIN dbo.reservasi r ON r.reservasi_id = rb.reservasi_id
        WHERE rb.blok_id IN (${conflictParams.join(', ')})
          AND rb.status_penahanan IN (N'Ditahan', N'Terpakai')
          AND r.status_reservasi IN (N'MenungguPembayaran', N'MenungguVerifikasi', N'Terkonfirmasi')
          AND (r.status_reservasi <> N'MenungguPembayaran' OR r.batas_penahanan > SYSDATETIMEOFFSET())
          AND r.jadwal_reservasi < @jadwal_selesai
          AND r.jadwal_selesai > @jadwal_mulai
      `);

      if ((conflictResult.recordset[0]?.cnt ?? 0) > 0) {
        throw new ServiceError(
          409,
          'ERR-RES-02',
          'Blok tidak tersedia pada jadwal tersebut.'
        );
      }

      // 3. Cari atau buat akun Customer berdasarkan WA / Email
      const userFindReq = new sql.Request(tx);
      userFindReq.input('phone', sql.NVarChar(20), params.nomorWhatsapp);
      let userQuery = `SELECT TOP 1 user_id FROM dbo.users WHERE phone_number = @phone`;
      if (params.emailPemesan) {
        userFindReq.input('email', sql.NVarChar(150), params.emailPemesan.toLowerCase());
        userQuery += ` OR LOWER(email) = @email`;
      }
      const existingUserRes = await userFindReq.query<{ user_id: string }>(userQuery);

      let customerId = existingUserRes.recordset[0]?.user_id;
      if (!customerId) {
        const roleReq = new sql.Request(tx);
        const roleRes = await roleReq.query<{ role_id: number }>(`
          SELECT role_id FROM dbo.roles WHERE LOWER(role_name) = N'customer'
        `);
        const customerRoleId = roleRes.recordset[0]?.role_id;
        if (!customerRoleId) {
          throw new Error('Role Customer tidak ditemukan.');
        }

        const placeholderEmail =
          params.emailPemesan?.toLowerCase() ||
          `khusus-${crypto.randomUUID().slice(0, 8)}@guest.mazaya.local`;
        const randomHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);

        const insUserReq = new sql.Request(tx);
        insUserReq.input('role_id', sql.Int, customerRoleId);
        insUserReq.input('full_name', sql.NVarChar(100), params.namaPemesan);
        insUserReq.input('email', sql.NVarChar(150), placeholderEmail);
        insUserReq.input('phone_number', sql.NVarChar(20), params.nomorWhatsapp);
        insUserReq.input('password_hash', sql.NVarChar(255), randomHash);

        const createdUser = await insUserReq.query<{ user_id: string }>(`
          INSERT INTO dbo.users (role_id, full_name, email, phone_number, password_hash, is_active)
          OUTPUT INSERTED.user_id
          VALUES (@role_id, @full_name, @email, @phone_number, @password_hash, 1)
        `);
        customerId = createdUser.recordset[0].user_id;
      }

      // 4. Simpan reservasi khusus
      const isConfirmed =
        params.statusPembayaran === 'dp' || params.statusPembayaran === 'lunas';
      const statusReservasi = isConfirmed ? 'Terkonfirmasi' : 'MenungguPembayaran';

      const insResReq = new sql.Request(tx);
      insResReq.input('user_id', sql.UniqueIdentifier, customerId);
      insResReq.input('dibuat_oleh', sql.UniqueIdentifier, params.adminId);
      insResReq.input('jadwal_reservasi', sql.DateTimeOffset(0), params.jadwalReservasi);
      insResReq.input('jadwal_selesai', sql.DateTimeOffset(0), params.jadwalSelesai);
      insResReq.input('jenis_acara', sql.NVarChar(100), params.jenisAcara);
      insResReq.input('status_reservasi', sql.NVarChar(25), statusReservasi);
      insResReq.input('jumlah_tamu', sql.Int, params.jumlahTamu);
      insResReq.input(
        'batas_penahanan',
        sql.DateTimeOffset(0),
        isConfirmed ? null : params.batasPenahanan
      );

      const resInserted = await insResReq.query<ReservasiRow>(`
        INSERT INTO dbo.reservasi (
          user_id, dibuat_oleh, jadwal_reservasi, jadwal_selesai,
          jenis_layanan, jenis_acara, status_reservasi, jumlah_tamu, batas_penahanan
        )
        OUTPUT INSERTED.*
        VALUES (
          @user_id, @dibuat_oleh, @jadwal_reservasi, @jadwal_selesai,
          N'Khusus', @jenis_acara, @status_reservasi, @jumlah_tamu, @batas_penahanan
        )
      `);
      const newReservasi = resInserted.recordset[0];

      // 5. Simpan reservasi_blok & update blokmeja
      const penahananStatus = isConfirmed ? 'Terpakai' : 'Ditahan';
      const blokStatus = isConfirmed ? 'Terisi' : 'Waiting';

      for (const block of lockedBlocks) {
        const rbReq = new sql.Request(tx);
        rbReq.input('reservasi_id', sql.UniqueIdentifier, newReservasi.reservasi_id);
        rbReq.input('blok_id', sql.UniqueIdentifier, block.blok_id);
        rbReq.input('status_penahanan', sql.NVarChar(10), penahananStatus);
        await rbReq.query(`
          INSERT INTO dbo.reservasi_blok (reservasi_id, blok_id, status_penahanan)
          VALUES (@reservasi_id, @blok_id, @status_penahanan)
        `);

        const bmReq = new sql.Request(tx);
        bmReq.input('blok_id', sql.UniqueIdentifier, block.blok_id);
        bmReq.input('status', sql.NVarChar(15), blokStatus);
        await bmReq.query(`
          UPDATE dbo.blokmeja
          SET status_ketersediaan = @status, updated_at = SYSDATETIMEOFFSET()
          WHERE blok_id = @blok_id
        `);
      }

      // 6. Simpan pesanan menu (bila diisi Admin)
      let totalMenu = 0;
      for (const item of params.pesananMenu) {
        let hargaSatuan = item.harga_satuan ?? 0;
        let menuId: string | null = null;
        let namaMenuReq: string | null = null;

        if (item.menu_id) {
          const mReq = new sql.Request(tx);
          mReq.input('menu_id', sql.UniqueIdentifier, item.menu_id);
          const mRes = await mReq.query<{ menu_id: string; harga: number }>(`
            SELECT menu_id, harga FROM dbo.menus WHERE menu_id = @menu_id AND is_active = 1
          `);
          const menuRow = mRes.recordset[0];
          if (!menuRow) {
            throw new ServiceError(404, 'ERR-DATA-01', `Menu (${item.menu_id}) tidak ditemukan.`);
          }
          menuId = menuRow.menu_id;
          hargaSatuan = item.harga_satuan ?? Number(menuRow.harga);
        } else {
          namaMenuReq = item.nama_menu || 'Menu Khusus';
        }

        const subtotal = hargaSatuan * item.jumlah_porsi;
        totalMenu += subtotal;

        const odReq = new sql.Request(tx);
        odReq.input('reservasi_id', sql.UniqueIdentifier, newReservasi.reservasi_id);
        odReq.input('menu_id', sql.UniqueIdentifier, menuId);
        odReq.input('decided_by', sql.UniqueIdentifier, menuId ? null : params.adminId);
        odReq.input('nama_menu_request', sql.NVarChar(100), namaMenuReq);
        odReq.input('catatan_request', sql.NVarChar(500), item.keterangan || null);
        odReq.input('jumlah_porsi', sql.Int, item.jumlah_porsi);
        odReq.input('harga_satuan', sql.Decimal(12, 2), hargaSatuan);
        odReq.input('subtotal', sql.Decimal(12, 2), subtotal);

        await odReq.query(`
          INSERT INTO dbo.detail_pesanan (
            reservasi_id, menu_id, decided_by, nama_menu_request, catatan_request,
            jumlah_porsi, harga_satuan, subtotal, status_item
          )
          VALUES (
            @reservasi_id, @menu_id, @decided_by, @nama_menu_request, @catatan_request,
            @jumlah_porsi, @harga_satuan, @subtotal, N'Diterima'
          )
        `);
      }

      // 7. Jika status_pembayaran = dp atau lunas, catat pembayaran terkonfirmasi
      const totalDp = lockedBlocks.reduce((sum, b) => sum + Number(b.nominal_dp), 0);
      if (isConfirmed) {
        const dpReq = new sql.Request(tx);
        dpReq.input('reservasi_id', sql.UniqueIdentifier, newReservasi.reservasi_id);
        dpReq.input('verified_by', sql.UniqueIdentifier, params.adminId);
        dpReq.input('nominal', sql.Decimal(12, 2), totalDp);
        await dpReq.query(`
          INSERT INTO dbo.pembayaran (
            reservasi_id, verified_by, jenis_pembayaran, metode_pembayaran,
            nominal, status, waktu_kadaluarsa, paid_at, catatan_verifikasi
          )
          VALUES (
            @reservasi_id, @verified_by, N'DP', N'ManualTransfer',
            @nominal, N'Terkonfirmasi', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(),
            N'Dicatat langsung oleh Admin (Layanan Khusus)'
          )
        `);
      }

      if (params.statusPembayaran === 'lunas' && totalMenu > 0) {
        const pelReq = new sql.Request(tx);
        pelReq.input('reservasi_id', sql.UniqueIdentifier, newReservasi.reservasi_id);
        pelReq.input('verified_by', sql.UniqueIdentifier, params.adminId);
        pelReq.input('nominal', sql.Decimal(12, 2), totalMenu);
        await pelReq.query(`
          INSERT INTO dbo.pembayaran (
            reservasi_id, verified_by, jenis_pembayaran, metode_pembayaran,
            nominal, status, waktu_kadaluarsa, paid_at, catatan_verifikasi
          )
          VALUES (
            @reservasi_id, @verified_by, N'Pelunasan', N'ManualTransfer',
            @nominal, N'Terkonfirmasi', SYSDATETIMEOFFSET(), SYSDATETIMEOFFSET(),
            N'Dicatat lunas oleh Admin (Layanan Khusus)'
          )
        `);
      }

      // 8. Riwayat status & audit log
      const histReq = new sql.Request(tx);
      histReq.input('reservasi_id', sql.UniqueIdentifier, newReservasi.reservasi_id);
      histReq.input('status_baru', sql.NVarChar(25), statusReservasi);
      histReq.input('diubah_oleh', sql.UniqueIdentifier, params.adminId);
      await histReq.query(`
        INSERT INTO dbo.reservasi_status_history (reservasi_id, status_lama, status_baru, diubah_oleh)
        VALUES (@reservasi_id, NULL, @status_baru, @diubah_oleh)
      `);

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'INSERT',
        resourceType: 'reservasi',
        resourceId: newReservasi.reservasi_id,
        oldValues: null,
        newValues: { ...newReservasi, blok_ids: params.blokIds },
      });

      await tx.commit();
      return { reservasi: newReservasi, blocks: lockedBlocks };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },
};
