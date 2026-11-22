import { getPool, sql } from '../config/db.js';
import { insertAuditLogInTx } from '../utils/auditHelper.js';

const SYSTEM_ACTOR = {
  userId: null,
  userEmail: 'system',
  ipAddress: '0.0.0.0',
};

let isExpireRunning = false;
let isCompleteRunning = false;

/**
 * Job 1 — job_expire_reservations (TSD 5.1.10, dijalankan tiap 1 menit):
 * 1. Membatalkan (Kadaluarsa) reservasi MenungguPembayaran yang batas_penahanan-nya lewat & melepas blok.
 * 2. Menandai pembayaran Pelunasan Menunggu yang lewat waktu_kadaluarsa menjadi Kadaluarsa & membatalkan item pesanan (blok tetap sah).
 * 3. Membatalkan menu request Diajukan yang belum diputuskan Admin saat melewati batas H-1.
 */
export const runExpireReservationsJob = async (): Promise<void> => {
  if (isExpireRunning) return;
  isExpireRunning = true;

  try {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      // 1. Reservasi DP yang melewati batas_penahanan (10 menit)
      const expiredRes = await new sql.Request(tx).query<{
        reservasi_id: string;
        user_id: string;
      }>(`
        SELECT reservasi_id, user_id
        FROM dbo.reservasi WITH (UPDLOCK, READPAST)
        WHERE status_reservasi = N'MenungguPembayaran'
          AND batas_penahanan IS NOT NULL
          AND batas_penahanan < SYSDATETIMEOFFSET()
      `);

      for (const r of expiredRes.recordset) {
        const updRes = new sql.Request(tx);
        updRes.input('reservasi_id', sql.UniqueIdentifier, r.reservasi_id);
        await updRes.query(`
          UPDATE dbo.reservasi
          SET status_reservasi = N'Kadaluarsa', updated_at = SYSDATETIMEOFFSET()
          WHERE reservasi_id = @reservasi_id
        `);

        const updPay = new sql.Request(tx);
        updPay.input('reservasi_id', sql.UniqueIdentifier, r.reservasi_id);
        await updPay.query(`
          UPDATE dbo.pembayaran
          SET status = N'Kadaluarsa', updated_at = SYSDATETIMEOFFSET()
          WHERE reservasi_id = @reservasi_id
            AND jenis_pembayaran = N'DP'
            AND status = N'Menunggu'
        `);

        const updRb = new sql.Request(tx);
        updRb.input('reservasi_id', sql.UniqueIdentifier, r.reservasi_id);
        await updRb.query(`
          UPDATE dbo.reservasi_blok
          SET status_penahanan = N'Dilepas'
          WHERE reservasi_id = @reservasi_id
        `);

        const updBm = new sql.Request(tx);
        updBm.input('reservasi_id', sql.UniqueIdentifier, r.reservasi_id);
        await updBm.query(`
          UPDATE b
          SET b.status_ketersediaan = N'Tersedia', b.updated_at = SYSDATETIMEOFFSET()
          FROM dbo.blokmeja b
          INNER JOIN dbo.reservasi_blok rb ON rb.blok_id = b.blok_id
          WHERE rb.reservasi_id = @reservasi_id
        `);

        const histReq = new sql.Request(tx);
        histReq.input('reservasi_id', sql.UniqueIdentifier, r.reservasi_id);
        await histReq.query(`
          INSERT INTO dbo.reservasi_status_history (reservasi_id, status_lama, status_baru, diubah_oleh)
          VALUES (@reservasi_id, N'MenungguPembayaran', N'Kadaluarsa', NULL)
        `);

        const notifReq = new sql.Request(tx);
        notifReq.input('user_id', sql.UniqueIdentifier, r.user_id);
        await notifReq.query(`
          INSERT INTO dbo.notifikasi (user_id, judul, isi, is_read)
          VALUES (
            @user_id,
            N'Reservasi Kadaluarsa',
            N'Batas waktu pembayaran DP telah habis. Reservasi dibatalkan dan blok meja dilepas kembali.',
            0
          )
        `);

        await insertAuditLogInTx(tx, {
          actor: SYSTEM_ACTOR,
          actionType: 'UPDATE',
          resourceType: 'reservasi',
          resourceId: r.reservasi_id,
          oldValues: { status_reservasi: 'MenungguPembayaran' },
          newValues: { status_reservasi: 'Kadaluarsa', reason: 'DP_EXPIRED_JOB' },
        });
      }

      // 2. Pembayaran Pelunasan yang melewati waktu_kadaluarsa
      const expiredPel = await new sql.Request(tx).query<{
        payment_id: string;
        reservasi_id: string;
        user_id: string;
      }>(`
        SELECT p.payment_id, p.reservasi_id, r.user_id
        FROM dbo.pembayaran p WITH (UPDLOCK, READPAST)
        INNER JOIN dbo.reservasi r ON r.reservasi_id = p.reservasi_id
        WHERE p.jenis_pembayaran = N'Pelunasan'
          AND p.status = N'Menunggu'
          AND p.waktu_kadaluarsa < SYSDATETIMEOFFSET()
      `);

      for (const p of expiredPel.recordset) {
        const updPay = new sql.Request(tx);
        updPay.input('payment_id', sql.UniqueIdentifier, p.payment_id);
        await updPay.query(`
          UPDATE dbo.pembayaran
          SET status = N'Kadaluarsa', updated_at = SYSDATETIMEOFFSET()
          WHERE payment_id = @payment_id
        `);

        const cancelItems = new sql.Request(tx);
        cancelItems.input('reservasi_id', sql.UniqueIdentifier, p.reservasi_id);
        await cancelItems.query(`
          UPDATE dbo.detail_pesanan
          SET status_item = N'Dibatalkan'
          WHERE reservasi_id = @reservasi_id AND status_item = N'Diterima'
        `);

        const notifReq = new sql.Request(tx);
        notifReq.input('user_id', sql.UniqueIdentifier, p.user_id);
        await notifReq.query(`
          INSERT INTO dbo.notifikasi (user_id, judul, isi, is_read)
          VALUES (
            @user_id,
            N'Pelunasan Menu Kadaluarsa',
            N'Waktu pelunasan menu telah habis sehingga pesanan menu dibatalkan. Reservasi blok Anda tetap sah.',
            0
          )
        `);

        await insertAuditLogInTx(tx, {
          actor: SYSTEM_ACTOR,
          actionType: 'UPDATE',
          resourceType: 'pembayaran',
          resourceId: p.payment_id,
          oldValues: { status: 'Menunggu' },
          newValues: { status: 'Kadaluarsa', reason: 'PELUNASAN_EXPIRED_JOB' },
        });
      }

      // 3. Menu request Diajukan yang belum diputuskan saat H-1 terlewati
      const settingRes = await new sql.Request(tx).query<{ setting_value: string }>(`
        SELECT setting_value FROM dbo.system_settings WHERE setting_key = N'batas_submit_menu_hari'
      `);
      const batasHari = Number.parseInt(settingRes.recordset[0]?.setting_value || '1', 10) || 1;

      const expReqStmt = new sql.Request(tx);
      expReqStmt.input('batas_hari', sql.Int, batasHari);
      const expiredMenuRequests = await expReqStmt.query<{
        order_detail_id: string;
        nama_menu_request: string;
        user_id: string;
      }>(`
        SELECT dp.order_detail_id, dp.nama_menu_request, r.user_id
        FROM dbo.detail_pesanan dp WITH (UPDLOCK, READPAST)
        INNER JOIN dbo.reservasi r ON r.reservasi_id = dp.reservasi_id
        WHERE dp.menu_id IS NULL
          AND dp.status_item = N'Diajukan'
          AND SYSDATETIMEOFFSET() > DATEADD(DAY, -@batas_hari, r.jadwal_reservasi)
      `);

      for (const mr of expiredMenuRequests.recordset) {
        const updMr = new sql.Request(tx);
        updMr.input('order_detail_id', sql.UniqueIdentifier, mr.order_detail_id);
        await updMr.query(`
          UPDATE dbo.detail_pesanan
          SET
            status_item = N'Dibatalkan',
            catatan_admin = N'Otomatis dibatalkan karena melewati batas H-1 tanpa keputusan Admin.'
          WHERE order_detail_id = @order_detail_id
        `);

        const notifReq = new sql.Request(tx);
        notifReq.input('user_id', sql.UniqueIdentifier, mr.user_id);
        notifReq.input(
          'isi',
          sql.NVarChar(sql.MAX),
          `Menu request '${mr.nama_menu_request}' otomatis dibatalkan karena telah melewati batas H-1.`
        );
        await notifReq.query(`
          INSERT INTO dbo.notifikasi (user_id, judul, isi, is_read)
          VALUES (@user_id, N'Menu Request Dibatalkan Otomatis', @isi, 0)
        `);

        await insertAuditLogInTx(tx, {
          actor: SYSTEM_ACTOR,
          actionType: 'UPDATE',
          resourceType: 'detail_pesanan',
          resourceId: mr.order_detail_id,
          oldValues: { status_item: 'Diajukan' },
          newValues: { status_item: 'Dibatalkan', reason: 'H_MINUS_1_PASSED' },
        });
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (error) {
    console.error('[Job job_expire_reservations Error]', error);
  } finally {
    isExpireRunning = false;
  }
};

/**
 * Job 2 — job_complete_reservations (TSD 5.1.13, dijalankan tiap 5 menit):
 * Menyelesaikan reservasi Terkonfirmasi yang jadwal_selesai-nya telah terlewati & melepas blok.
 */
export const runCompleteReservationsJob = async (): Promise<void> => {
  if (isCompleteRunning) return;
  isCompleteRunning = true;

  try {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const doneRes = await new sql.Request(tx).query<{
        reservasi_id: string;
        user_id: string;
      }>(`
        SELECT reservasi_id, user_id
        FROM dbo.reservasi WITH (UPDLOCK, READPAST)
        WHERE status_reservasi = N'Terkonfirmasi'
          AND jadwal_selesai <= SYSDATETIMEOFFSET()
      `);

      for (const r of doneRes.recordset) {
        const updRes = new sql.Request(tx);
        updRes.input('reservasi_id', sql.UniqueIdentifier, r.reservasi_id);
        await updRes.query(`
          UPDATE dbo.reservasi
          SET status_reservasi = N'Selesai', updated_at = SYSDATETIMEOFFSET()
          WHERE reservasi_id = @reservasi_id
        `);

        const updRb = new sql.Request(tx);
        updRb.input('reservasi_id', sql.UniqueIdentifier, r.reservasi_id);
        await updRb.query(`
          UPDATE dbo.reservasi_blok
          SET status_penahanan = N'Dilepas'
          WHERE reservasi_id = @reservasi_id
        `);

        const updBm = new sql.Request(tx);
        updBm.input('reservasi_id', sql.UniqueIdentifier, r.reservasi_id);
        await updBm.query(`
          UPDATE b
          SET b.status_ketersediaan = N'Tersedia', b.updated_at = SYSDATETIMEOFFSET()
          FROM dbo.blokmeja b
          INNER JOIN dbo.reservasi_blok rb ON rb.blok_id = b.blok_id
          WHERE rb.reservasi_id = @reservasi_id
        `);

        const histReq = new sql.Request(tx);
        histReq.input('reservasi_id', sql.UniqueIdentifier, r.reservasi_id);
        await histReq.query(`
          INSERT INTO dbo.reservasi_status_history (reservasi_id, status_lama, status_baru, diubah_oleh)
          VALUES (@reservasi_id, N'Terkonfirmasi', N'Selesai', NULL)
        `);

        const notifReq = new sql.Request(tx);
        notifReq.input('user_id', sql.UniqueIdentifier, r.user_id);
        await notifReq.query(`
          INSERT INTO dbo.notifikasi (user_id, judul, isi, is_read)
          VALUES (
            @user_id,
            N'Reservasi Selesai',
            N'Terima kasih telah berkunjung ke Restoran Mazaya! Anda kini dapat memberikan rating dan ulasan.',
            0
          )
        `);

        await insertAuditLogInTx(tx, {
          actor: SYSTEM_ACTOR,
          actionType: 'UPDATE',
          resourceType: 'reservasi',
          resourceId: r.reservasi_id,
          oldValues: { status_reservasi: 'Terkonfirmasi' },
          newValues: { status_reservasi: 'Selesai', reason: 'AUTO_COMPLETE_JOB' },
        });
      }

      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (error) {
    console.error('[Job job_complete_reservations Error]', error);
  } finally {
    isCompleteRunning = false;
  }
};

export const startReservationJobs = (): void => {
  // Job 1: tiap 1 menit
  setInterval(() => {
    void runExpireReservationsJob();
  }, 60 * 1000);

  // Job 2: tiap 5 menit
  setInterval(() => {
    void runCompleteReservationsJob();
  }, 5 * 60 * 1000);

  console.log('[Jobs] job_expire_reservations (1m) & job_complete_reservations (5m) aktif.');
};
