import { getPool, sql } from '../config/db.js';
import { AuditActor, insertAuditLogInTx } from '../utils/auditHelper.js';
import { ServiceError } from '../utils/errors.js';

export interface PembayaranRow {
  payment_id: string;
  reservasi_id: string;
  verified_by: string | null;
  jenis_pembayaran: 'DP' | 'Pelunasan';
  metode_pembayaran: 'VirtualAccount' | 'ManualTransfer';
  bank: string | null;
  nominal: number;
  kode_va: string | null;
  referensi_transaksi: string | null;
  link_bukti_transfer: string | null;
  status: 'Menunggu' | 'MenungguVerifikasi' | 'Terkonfirmasi' | 'Ditolak' | 'Kadaluarsa';
  waktu_kadaluarsa: Date;
  paid_at: Date | null;
  catatan_verifikasi: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ReservasiForPaymentRow {
  reservasi_id: string;
  user_id: string;
  nama_pemesan: string;
  email_pemesan: string;
  no_whatsapp: string;
  jadwal_reservasi: Date;
  status_reservasi: string;
  batas_penahanan: Date | null;
  total_dp_blok: number;
  pending_request_count: number;
  accepted_order_count: number;
  total_pelunasan_menu: number;
}

export interface AdminPaymentListRow extends PembayaranRow {
  nama_pelanggan: string;
  no_whatsapp: string;
  jadwal_reservasi: Date;
  status_reservasi: string;
}

const insertNotificationInTx = async (
  tx: sql.Transaction,
  userId: string,
  judul: string,
  isi: string
): Promise<void> => {
  const req = new sql.Request(tx);
  req.input('user_id', sql.UniqueIdentifier, userId);
  req.input('judul', sql.NVarChar(150), judul.slice(0, 150));
  req.input('isi', sql.NVarChar(sql.MAX), isi);
  await req.query(`
    INSERT INTO dbo.notifikasi (user_id, judul, isi, is_read)
    VALUES (@user_id, @judul, @isi, 0)
  `);
};

const insertReservationHistoryInTx = async (
  tx: sql.Transaction,
  reservasiId: string,
  statusLama: string | null,
  statusBaru: string,
  diubahOleh: string | null
): Promise<void> => {
  const req = new sql.Request(tx);
  req.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
  req.input('status_lama', sql.NVarChar(25), statusLama);
  req.input('status_baru', sql.NVarChar(25), statusBaru);
  req.input('diubah_oleh', sql.UniqueIdentifier, diubahOleh);
  await req.query(`
    INSERT INTO dbo.reservasi_status_history (reservasi_id, status_lama, status_baru, diubah_oleh)
    VALUES (@reservasi_id, @status_lama, @status_baru, @diubah_oleh)
  `);
};

const releaseBlocksInTx = async (tx: sql.Transaction, reservasiId: string): Promise<void> => {
  const rbReq = new sql.Request(tx);
  rbReq.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
  await rbReq.query(`
    UPDATE dbo.reservasi_blok
    SET status_penahanan = N'Dilepas'
    WHERE reservasi_id = @reservasi_id
  `);

  const bmReq = new sql.Request(tx);
  bmReq.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
  await bmReq.query(`
    UPDATE b
    SET b.status_ketersediaan = N'Tersedia', b.updated_at = SYSDATETIMEOFFSET()
    FROM dbo.blokmeja b
    INNER JOIN dbo.reservasi_blok rb ON rb.blok_id = b.blok_id
    WHERE rb.reservasi_id = @reservasi_id
  `);
};

const occupyBlocksInTx = async (tx: sql.Transaction, reservasiId: string): Promise<void> => {
  const rbReq = new sql.Request(tx);
  rbReq.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
  await rbReq.query(`
    UPDATE dbo.reservasi_blok
    SET status_penahanan = N'Terpakai'
    WHERE reservasi_id = @reservasi_id
  `);

  const bmReq = new sql.Request(tx);
  bmReq.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
  await bmReq.query(`
    UPDATE b
    SET b.status_ketersediaan = N'Terisi', b.updated_at = SYSDATETIMEOFFSET()
    FROM dbo.blokmeja b
    INNER JOIN dbo.reservasi_blok rb ON rb.blok_id = b.blok_id
    WHERE rb.reservasi_id = @reservasi_id
  `);
};

export const pembayaranRepository = {
  async getPaymentSettings(): Promise<{
    batas_waktu_dp_menit: number;
    batas_waktu_pelunasan_menit: number;
    batas_submit_menu_hari: number;
  }> {
    const pool = await getPool();
    const result = await pool.request().query<{ setting_key: string; setting_value: string }>(`
      SELECT setting_key, setting_value
      FROM dbo.system_settings
      WHERE setting_key IN (
        N'batas_waktu_dp_menit', N'batas_waktu_pelunasan_menit', N'batas_submit_menu_hari'
      )
    `);
    const map: Record<string, string> = {};
    for (const r of result.recordset) map[r.setting_key] = r.setting_value;

    const dp = Number.parseInt(map.batas_waktu_dp_menit || '10', 10);
    const pel = Number.parseInt(map.batas_waktu_pelunasan_menit || '10', 10);
    const hari = Number.parseInt(map.batas_submit_menu_hari || '1', 10);

    return {
      batas_waktu_dp_menit: Number.isNaN(dp) || dp <= 0 ? 10 : dp,
      batas_waktu_pelunasan_menit: Number.isNaN(pel) || pel <= 0 ? 10 : pel,
      batas_submit_menu_hari: Number.isNaN(hari) || hari < 0 ? 1 : hari,
    };
  },

  async getReservationContext(reservasiId: string): Promise<ReservasiForPaymentRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('reservasi_id', sql.UniqueIdentifier, reservasiId);

    const result = await req.query<ReservasiForPaymentRow>(`
      SELECT
        r.reservasi_id,
        r.user_id,
        u.full_name AS nama_pemesan,
        u.email AS email_pemesan,
        u.phone_number AS no_whatsapp,
        r.jadwal_reservasi,
        r.status_reservasi,
        r.batas_penahanan,
        ISNULL((
          SELECT SUM(b.nominal_dp)
          FROM dbo.reservasi_blok rb
          INNER JOIN dbo.blokmeja b ON b.blok_id = rb.blok_id
          WHERE rb.reservasi_id = r.reservasi_id
        ), 0) AS total_dp_blok,
        (
          SELECT COUNT(*)
          FROM dbo.detail_pesanan dp
          WHERE dp.reservasi_id = r.reservasi_id AND dp.status_item = N'Diajukan'
        ) AS pending_request_count,
        (
          SELECT COUNT(*)
          FROM dbo.detail_pesanan dp
          WHERE dp.reservasi_id = r.reservasi_id AND dp.status_item = N'Diterima'
        ) AS accepted_order_count,
        ISNULL((
          SELECT SUM(dp.subtotal)
          FROM dbo.detail_pesanan dp
          WHERE dp.reservasi_id = r.reservasi_id AND dp.status_item = N'Diterima'
        ), 0) AS total_pelunasan_menu
      FROM dbo.reservasi r
      INNER JOIN dbo.users u ON u.user_id = r.user_id
      WHERE r.reservasi_id = @reservasi_id
    `);

    return result.recordset[0] ?? null;
  },

  async findActivePayment(
    reservasiId: string,
    jenis: 'DP' | 'Pelunasan'
  ): Promise<PembayaranRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
    req.input('jenis', sql.NVarChar(15), jenis);

    const result = await req.query<PembayaranRow>(`
      SELECT TOP 1 *
      FROM dbo.pembayaran
      WHERE reservasi_id = @reservasi_id
        AND jenis_pembayaran = @jenis
        AND status IN (N'Menunggu', N'MenungguVerifikasi', N'Terkonfirmasi')
      ORDER BY created_at DESC
    `);
    return result.recordset[0] ?? null;
  },

  async listByReservation(
    reservasiId: string,
    jenis?: 'DP' | 'Pelunasan'
  ): Promise<PembayaranRow[]> {
    const pool = await getPool();
    const req = pool.request();
    req.input('reservasi_id', sql.UniqueIdentifier, reservasiId);

    let query = `SELECT * FROM dbo.pembayaran WHERE reservasi_id = @reservasi_id`;
    if (jenis) {
      req.input('jenis', sql.NVarChar(15), jenis);
      query += ` AND jenis_pembayaran = @jenis`;
    }
    query += ` ORDER BY created_at DESC`;

    const result = await req.query<PembayaranRow>(query);
    return result.recordset;
  },

  async findById(paymentId: string): Promise<PembayaranRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('payment_id', sql.UniqueIdentifier, paymentId);
    const result = await req.query<PembayaranRow>(`
      SELECT * FROM dbo.pembayaran WHERE payment_id = @payment_id
    `);
    return result.recordset[0] ?? null;
  },

  async createPendingVaPayment(data: {
    reservasiId: string;
    jenis: 'DP' | 'Pelunasan';
    bank: string;
    nominal: number;
    waktuKadaluarsa: Date;
  }): Promise<PembayaranRow> {
    const pool = await getPool();
    const req = pool.request();
    req.input('reservasi_id', sql.UniqueIdentifier, data.reservasiId);
    req.input('jenis_pembayaran', sql.NVarChar(15), data.jenis);
    req.input('bank', sql.NVarChar(20), data.bank);
    req.input('nominal', sql.Decimal(12, 2), data.nominal);
    req.input('waktu_kadaluarsa', sql.DateTimeOffset(0), data.waktuKadaluarsa);

    const inserted = await req.query<PembayaranRow>(`
      INSERT INTO dbo.pembayaran (
        reservasi_id, jenis_pembayaran, metode_pembayaran, bank,
        nominal, status, waktu_kadaluarsa
      )
      OUTPUT INSERTED.*
      VALUES (
        @reservasi_id, @jenis_pembayaran, N'VirtualAccount', @bank,
        @nominal, N'Menunggu', @waktu_kadaluarsa
      )
    `);
    return inserted.recordset[0];
  },

  async attachGatewayVaDetails(
    paymentId: string,
    kodeVa: string,
    referensiTransaksi: string,
    actor: AuditActor
  ): Promise<PembayaranRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('payment_id', sql.UniqueIdentifier, paymentId);
      req.input('kode_va', sql.NVarChar(30), kodeVa);
      req.input('referensi_transaksi', sql.NVarChar(100), referensiTransaksi);

      const updated = await req.query<PembayaranRow>(`
        UPDATE dbo.pembayaran
        SET
          kode_va = @kode_va,
          referensi_transaksi = @referensi_transaksi,
          updated_at = SYSDATETIMEOFFSET()
        OUTPUT INSERTED.*
        WHERE payment_id = @payment_id
      `);

      const row = updated.recordset[0];
      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'INSERT',
        resourceType: 'pembayaran',
        resourceId: row.payment_id,
        oldValues: null,
        newValues: row,
      });

      await tx.commit();
      return row;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },

  async abortFailedChargeRow(paymentId: string): Promise<void> {
    const pool = await getPool();
    const req = pool.request();
    req.input('payment_id', sql.UniqueIdentifier, paymentId);
    await req.query(`DELETE FROM dbo.pembayaran WHERE payment_id = @payment_id AND kode_va IS NULL`);
  },

  /**
   * E17 — Proses callback Midtrans secara atomik & idempoten.
   */
  async processGatewayCallback(params: {
    paymentId: string;
    referensiTransaksi: string;
    outcome: 'PAID' | 'FAILED' | 'EXPIRED' | 'AMOUNT_MISMATCH';
    catatan?: string;
    actor: AuditActor;
  }): Promise<'diproses' | 'duplikat'> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const lockReq = new sql.Request(tx);
      lockReq.input('payment_id', sql.UniqueIdentifier, params.paymentId);
      const payResult = await lockReq.query<PembayaranRow>(`
        SELECT * FROM dbo.pembayaran WITH (UPDLOCK, HOLDLOCK)
        WHERE payment_id = @payment_id
      `);

      const payment = payResult.recordset[0];
      if (!payment || payment.status !== 'Menunggu') {
        await tx.commit();
        return 'duplikat';
      }

      const resReq = new sql.Request(tx);
      resReq.input('reservasi_id', sql.UniqueIdentifier, payment.reservasi_id);
      const resResult = await resReq.query<{
        reservasi_id: string;
        user_id: string;
        status_reservasi: string;
      }>(`
        SELECT reservasi_id, user_id, status_reservasi
        FROM dbo.reservasi WITH (UPDLOCK, HOLDLOCK)
        WHERE reservasi_id = @reservasi_id
      `);
      const reservasi = resResult.recordset[0];

      if (params.outcome === 'AMOUNT_MISMATCH') {
        const updReq = new sql.Request(tx);
        updReq.input('payment_id', sql.UniqueIdentifier, payment.payment_id);
        updReq.input('catatan', sql.NVarChar(500), params.catatan || 'Nominal tidak sesuai');
        const upd = await updReq.query<PembayaranRow>(`
          UPDATE dbo.pembayaran
          SET status = N'MenungguVerifikasi', catatan_verifikasi = @catatan, updated_at = SYSDATETIMEOFFSET()
          OUTPUT INSERTED.*
          WHERE payment_id = @payment_id
        `);
        await insertAuditLogInTx(tx, {
          actor: params.actor,
          actionType: 'UPDATE',
          resourceType: 'pembayaran',
          resourceId: payment.payment_id,
          oldValues: payment,
          newValues: upd.recordset[0],
        });
        await tx.commit();
        return 'diproses';
      }

      if (params.outcome === 'PAID') {
        const updPay = new sql.Request(tx);
        updPay.input('payment_id', sql.UniqueIdentifier, payment.payment_id);
        updPay.input('ref', sql.NVarChar(100), params.referensiTransaksi);
        const payUpd = await updPay.query<PembayaranRow>(`
          UPDATE dbo.pembayaran
          SET
            status = N'Terkonfirmasi',
            referensi_transaksi = COALESCE(referensi_transaksi, @ref),
            paid_at = SYSDATETIMEOFFSET(),
            updated_at = SYSDATETIMEOFFSET()
          OUTPUT INSERTED.*
          WHERE payment_id = @payment_id
        `);

        if (payment.jenis_pembayaran === 'DP' && reservasi) {
          const updRes = new sql.Request(tx);
          updRes.input('reservasi_id', sql.UniqueIdentifier, reservasi.reservasi_id);
          await updRes.query(`
            UPDATE dbo.reservasi
            SET status_reservasi = N'Terkonfirmasi', updated_at = SYSDATETIMEOFFSET()
            WHERE reservasi_id = @reservasi_id
          `);
          await occupyBlocksInTx(tx, reservasi.reservasi_id);
          await insertReservationHistoryInTx(
            tx,
            reservasi.reservasi_id,
            reservasi.status_reservasi,
            'Terkonfirmasi',
            null
          );
          await insertNotificationInTx(
            tx,
            reservasi.user_id,
            'Pembayaran DP Terkonfirmasi',
            'Pembayaran DP Anda telah diverifikasi otomatis oleh sistem. Anda kini dapat memesan menu pre-order dan melihat E-Receipt.'
          );
        } else if (payment.jenis_pembayaran === 'Pelunasan' && reservasi) {
          await insertNotificationInTx(
            tx,
            reservasi.user_id,
            'Pelunasan Menu Terkonfirmasi',
            'Pembayaran pelunasan menu pre-order Anda telah berhasil terverifikasi.'
          );
        }

        await insertAuditLogInTx(tx, {
          actor: params.actor,
          actionType: 'UPDATE',
          resourceType: 'pembayaran',
          resourceId: payment.payment_id,
          oldValues: payment,
          newValues: payUpd.recordset[0],
        });
      } else {
        // FAILED atau EXPIRED
        const newPayStatus = params.outcome === 'EXPIRED' ? 'Kadaluarsa' : 'Ditolak';
        const newResStatus = params.outcome === 'EXPIRED' ? 'Kadaluarsa' : 'Ditolak';

        const updPay = new sql.Request(tx);
        updPay.input('payment_id', sql.UniqueIdentifier, payment.payment_id);
        updPay.input('status', sql.NVarChar(20), newPayStatus);
        const payUpd = await updPay.query<PembayaranRow>(`
          UPDATE dbo.pembayaran
          SET status = @status, updated_at = SYSDATETIMEOFFSET()
          OUTPUT INSERTED.*
          WHERE payment_id = @payment_id
        `);

        if (payment.jenis_pembayaran === 'DP' && reservasi) {
          const updRes = new sql.Request(tx);
          updRes.input('reservasi_id', sql.UniqueIdentifier, reservasi.reservasi_id);
          updRes.input('status', sql.NVarChar(25), newResStatus);
          await updRes.query(`
            UPDATE dbo.reservasi
            SET status_reservasi = @status, updated_at = SYSDATETIMEOFFSET()
            WHERE reservasi_id = @reservasi_id
          `);
          await releaseBlocksInTx(tx, reservasi.reservasi_id);
          await insertReservationHistoryInTx(
            tx,
            reservasi.reservasi_id,
            reservasi.status_reservasi,
            newResStatus,
            null
          );
          await insertNotificationInTx(
            tx,
            reservasi.user_id,
            `Pembayaran DP ${newPayStatus}`,
            'Pembayaran DP tidak berhasil atau melewati batas waktu. Reservasi dibatalkan dan blok telah dilepas.'
          );
        } else if (payment.jenis_pembayaran === 'Pelunasan' && reservasi) {
          const cancelOrderReq = new sql.Request(tx);
          cancelOrderReq.input('reservasi_id', sql.UniqueIdentifier, reservasi.reservasi_id);
          await cancelOrderReq.query(`
            UPDATE dbo.detail_pesanan
            SET status_item = N'Dibatalkan'
            WHERE reservasi_id = @reservasi_id AND status_item = N'Diterima'
          `);
          await insertNotificationInTx(
            tx,
            reservasi.user_id,
            `Pelunasan Menu ${newPayStatus}`,
            'Pelunasan menu gagal/kedaluwarsa sehingga item pesanan dibatalkan. Reservasi blok Anda tetap sah.'
          );
        }

        await insertAuditLogInTx(tx, {
          actor: params.actor,
          actionType: 'UPDATE',
          resourceType: 'pembayaran',
          resourceId: payment.payment_id,
          oldValues: payment,
          newValues: payUpd.recordset[0],
        });
      }

      await tx.commit();
      return 'diproses';
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },

  /**
   * E18 — Simpan bukti transfer manual (jalur cadangan) secara atomik.
   */
  async submitTransferProof(params: {
    reservasiId: string;
    jenis: 'DP' | 'Pelunasan';
    nominal: number;
    waktuKadaluarsa: Date;
    buktiPath: string;
    existingPending: PembayaranRow | null;
    oldReservasiStatus: string;
    userId: string;
    actor: AuditActor;
  }): Promise<PembayaranRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      let paymentRow: PembayaranRow;

      if (params.existingPending) {
        const updReq = new sql.Request(tx);
        updReq.input('payment_id', sql.UniqueIdentifier, params.existingPending.payment_id);
        updReq.input('bukti', sql.NVarChar(255), params.buktiPath);
        const upd = await updReq.query<PembayaranRow>(`
          UPDATE dbo.pembayaran
          SET
            metode_pembayaran = N'ManualTransfer',
            link_bukti_transfer = @bukti,
            status = N'MenungguVerifikasi',
            updated_at = SYSDATETIMEOFFSET()
          OUTPUT INSERTED.*
          WHERE payment_id = @payment_id
        `);
        paymentRow = upd.recordset[0];
      } else {
        const insReq = new sql.Request(tx);
        insReq.input('reservasi_id', sql.UniqueIdentifier, params.reservasiId);
        insReq.input('jenis', sql.NVarChar(15), params.jenis);
        insReq.input('nominal', sql.Decimal(12, 2), params.nominal);
        insReq.input('bukti', sql.NVarChar(255), params.buktiPath);
        insReq.input('waktu_kadaluarsa', sql.DateTimeOffset(0), params.waktuKadaluarsa);
        const ins = await insReq.query<PembayaranRow>(`
          INSERT INTO dbo.pembayaran (
            reservasi_id, jenis_pembayaran, metode_pembayaran,
            nominal, link_bukti_transfer, status, waktu_kadaluarsa
          )
          OUTPUT INSERTED.*
          VALUES (
            @reservasi_id, @jenis, N'ManualTransfer',
            @nominal, @bukti, N'MenungguVerifikasi', @waktu_kadaluarsa
          )
        `);
        paymentRow = ins.recordset[0];
      }

      if (params.jenis === 'DP') {
        const resReq = new sql.Request(tx);
        resReq.input('reservasi_id', sql.UniqueIdentifier, params.reservasiId);
        await resReq.query(`
          UPDATE dbo.reservasi
          SET status_reservasi = N'MenungguVerifikasi', updated_at = SYSDATETIMEOFFSET()
          WHERE reservasi_id = @reservasi_id
        `);
        await insertReservationHistoryInTx(
          tx,
          params.reservasiId,
          params.oldReservasiStatus,
          'MenungguVerifikasi',
          params.userId
        );
      }

      await insertAuditLogInTx(tx, {
        actor: params.actor,
        actionType: params.existingPending ? 'UPDATE' : 'INSERT',
        resourceType: 'pembayaran',
        resourceId: paymentRow.payment_id,
        oldValues: params.existingPending,
        newValues: paymentRow,
      });

      await tx.commit();
      return paymentRow;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },

  /**
   * E19 — Daftar pembayaran untuk Admin (default status MenungguVerifikasi)
   */
  async listAdminPayments(filter: {
    status?: string;
    offset: number;
    perPage: number;
  }): Promise<{ rows: AdminPaymentListRow[]; total: number }> {
    const pool = await getPool();
    const countReq = pool.request();
    const dataReq = pool.request();
    let whereClause = '';

    if (filter.status) {
      whereClause = 'WHERE LOWER(p.status) = LOWER(@status)';
      countReq.input('status', sql.NVarChar(20), filter.status);
      dataReq.input('status', sql.NVarChar(20), filter.status);
    }

    const countResult = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM dbo.pembayaran p ${whereClause}
    `);
    const total = countResult.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataResult = await dataReq.query<AdminPaymentListRow>(`
      SELECT
        p.*,
        u.full_name AS nama_pelanggan,
        u.phone_number AS no_whatsapp,
        r.jadwal_reservasi,
        r.status_reservasi
      FROM dbo.pembayaran p
      INNER JOIN dbo.reservasi r ON r.reservasi_id = p.reservasi_id
      INNER JOIN dbo.users u ON u.user_id = r.user_id
      ${whereClause}
      ORDER BY p.updated_at DESC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataResult.recordset, total };
  },

  /**
   * E20 — Verifikasi bukti transfer manual oleh Admin/Manajer secara atomik.
   */
  async verifyManualPayment(params: {
    paymentId: string;
    adminId: string;
    keputusan: 'setuju' | 'tolak';
    catatan: string | null;
    actor: AuditActor;
  }): Promise<{ status_pembayaran: string; status_reservasi: string }> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const payReq = new sql.Request(tx);
      payReq.input('payment_id', sql.UniqueIdentifier, params.paymentId);
      const payRes = await payReq.query<PembayaranRow>(`
        SELECT * FROM dbo.pembayaran WITH (UPDLOCK, HOLDLOCK)
        WHERE payment_id = @payment_id
      `);
      const payment = payRes.recordset[0];
      if (!payment) {
        throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
      }
      if (payment.status !== 'MenungguVerifikasi') {
        throw new ServiceError(
          409,
          'ERR-PAY-06',
          'Reservasi sudah tidak menunggu verifikasi.'
        );
      }

      const resReq = new sql.Request(tx);
      resReq.input('reservasi_id', sql.UniqueIdentifier, payment.reservasi_id);
      const resRes = await resReq.query<{
        reservasi_id: string;
        user_id: string;
        status_reservasi: string;
      }>(`
        SELECT reservasi_id, user_id, status_reservasi
        FROM dbo.reservasi WITH (UPDLOCK, HOLDLOCK)
        WHERE reservasi_id = @reservasi_id
      `);
      const reservasi = resRes.recordset[0];

      const isApprove = params.keputusan === 'setuju';
      const newPayStatus = isApprove ? 'Terkonfirmasi' : 'Ditolak';
      let newResStatus = reservasi.status_reservasi;

      const updPayReq = new sql.Request(tx);
      updPayReq.input('payment_id', sql.UniqueIdentifier, payment.payment_id);
      updPayReq.input('status', sql.NVarChar(20), newPayStatus);
      updPayReq.input('verified_by', sql.UniqueIdentifier, params.adminId);
      updPayReq.input('catatan', sql.NVarChar(500), params.catatan);

      const payUpdated = await updPayReq.query<PembayaranRow>(`
        UPDATE dbo.pembayaran
        SET
          status = @status,
          verified_by = @verified_by,
          catatan_verifikasi = @catatan,
          paid_at = CASE WHEN @status = N'Terkonfirmasi' THEN SYSDATETIMEOFFSET() ELSE paid_at END,
          updated_at = SYSDATETIMEOFFSET()
        OUTPUT INSERTED.*
        WHERE payment_id = @payment_id
      `);

      if (payment.jenis_pembayaran === 'DP') {
        newResStatus = isApprove ? 'Terkonfirmasi' : 'Ditolak';
        const updRes = new sql.Request(tx);
        updRes.input('reservasi_id', sql.UniqueIdentifier, reservasi.reservasi_id);
        updRes.input('status', sql.NVarChar(25), newResStatus);
        await updRes.query(`
          UPDATE dbo.reservasi
          SET status_reservasi = @status, updated_at = SYSDATETIMEOFFSET()
          WHERE reservasi_id = @reservasi_id
        `);

        if (isApprove) {
          await occupyBlocksInTx(tx, reservasi.reservasi_id);
          await insertNotificationInTx(
            tx,
            reservasi.user_id,
            'Pembayaran DP Disetujui',
            'Bukti transfer DP Anda telah diverifikasi oleh Admin. Reservasi Anda terkonfirmasi.'
          );
        } else {
          await releaseBlocksInTx(tx, reservasi.reservasi_id);
          await insertNotificationInTx(
            tx,
            reservasi.user_id,
            'Pembayaran DP Ditolak',
            `Bukti transfer DP ditolak oleh Admin. Alasan: ${params.catatan || '-'}`
          );
        }

        await insertReservationHistoryInTx(
          tx,
          reservasi.reservasi_id,
          reservasi.status_reservasi,
          newResStatus,
          params.adminId
        );
      } else {
        if (isApprove) {
          await insertNotificationInTx(
            tx,
            reservasi.user_id,
            'Pelunasan Menu Disetujui',
            'Bukti transfer pelunasan menu Anda telah diverifikasi oleh Admin.'
          );
        } else {
          await insertNotificationInTx(
            tx,
            reservasi.user_id,
            'Pelunasan Menu Ditolak',
            `Bukti transfer pelunasan ditolak oleh Admin. Alasan: ${params.catatan || '-'}`
          );
        }
      }

      await insertAuditLogInTx(tx, {
        actor: params.actor,
        actionType: 'PAYMENT_VERIFIED',
        resourceType: 'pembayaran',
        resourceId: payment.payment_id,
        oldValues: payment,
        newValues: payUpdated.recordset[0],
      });

      await tx.commit();
      return {
        status_pembayaran: newPayStatus,
        status_reservasi: newResStatus,
      };
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },
};
