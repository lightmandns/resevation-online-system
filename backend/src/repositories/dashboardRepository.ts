import { getPool, sql } from '../config/db.js';

export const dashboardRepository = {
  async getManagerSummary(filter: {
    tanggalMulai?: string;
    tanggalSelesai?: string;
    status?: string;
  }) {
    const pool = await getPool();

    // 1. Ringkasan reservasi per status
    const resConds: string[] = [];
    const resReq = pool.request();
    if (filter.tanggalMulai) {
      resConds.push('CAST(jadwal_reservasi AS DATE) >= @tanggal_mulai');
      resReq.input('tanggal_mulai', sql.Date, filter.tanggalMulai);
    }
    if (filter.tanggalSelesai) {
      resConds.push('CAST(jadwal_reservasi AS DATE) <= @tanggal_selesai');
      resReq.input('tanggal_selesai', sql.Date, filter.tanggalSelesai);
    }
    if (filter.status) {
      resConds.push('LOWER(status_reservasi) = LOWER(@status)');
      resReq.input('status', sql.NVarChar(25), filter.status);
    }
    const resWhere = resConds.length > 0 ? `WHERE ${resConds.join(' AND ')}` : '';

    const reservasiSummaryRes = await resReq.query<{
      status_reservasi: string;
      jumlah: number;
    }>(`
      SELECT status_reservasi, COUNT(*) AS jumlah
      FROM dbo.reservasi
      ${resWhere}
      GROUP BY status_reservasi
    `);

    // 2. Ringkasan pembayaran per jenis & status
    const payConds: string[] = [];
    const payReq = pool.request();
    if (filter.tanggalMulai) {
      payConds.push('CAST(created_at AS DATE) >= @tanggal_mulai');
      payReq.input('tanggal_mulai', sql.Date, filter.tanggalMulai);
    }
    if (filter.tanggalSelesai) {
      payConds.push('CAST(created_at AS DATE) <= @tanggal_selesai');
      payReq.input('tanggal_selesai', sql.Date, filter.tanggalSelesai);
    }
    const payWhere = payConds.length > 0 ? `WHERE ${payConds.join(' AND ')}` : '';

    const paymentSummaryRes = await payReq.query<{
      jenis_pembayaran: string;
      status: string;
      jumlah: number;
      total_nominal: number;
    }>(`
      SELECT
        jenis_pembayaran,
        status,
        COUNT(*) AS jumlah,
        ISNULL(SUM(nominal), 0) AS total_nominal
      FROM dbo.pembayaran
      ${payWhere}
      GROUP BY jenis_pembayaran, status
    `);

    // 3. Rata-rata rating keseluruhan / periode
    const revConds: string[] = [];
    const revReq = pool.request();
    if (filter.tanggalMulai) {
      revConds.push('CAST(created_at AS DATE) >= @tanggal_mulai');
      revReq.input('tanggal_mulai', sql.Date, filter.tanggalMulai);
    }
    if (filter.tanggalSelesai) {
      revConds.push('CAST(created_at AS DATE) <= @tanggal_selesai');
      revReq.input('tanggal_selesai', sql.Date, filter.tanggalSelesai);
    }
    const revWhere = revConds.length > 0 ? `WHERE ${revConds.join(' AND ')}` : '';

    const ratingRes = await revReq.query<{ total_ulasan: number; rata_rata: number | null }>(`
      SELECT COUNT(*) AS total_ulasan, AVG(CAST(rating AS FLOAT)) AS rata_rata
      FROM dbo.ulasan
      ${revWhere}
    `);

    // 4. Top 5 reservasi terdekat (aktif)
    const upcomingRes = await pool.request().query<{
      reservasi_id: string;
      nama_customer: string;
      jadwal_reservasi: Date;
      jenis_layanan: string;
      jenis_acara: string;
      status_reservasi: string;
      blok_list: string | null;
    }>(`
      SELECT TOP 5
        r.reservasi_id,
        u.full_name AS nama_customer,
        r.jadwal_reservasi,
        r.jenis_layanan,
        r.jenis_acara,
        r.status_reservasi,
        (
          SELECT STRING_AGG(b.nama_blok, N', ')
          FROM dbo.reservasi_blok rb
          INNER JOIN dbo.blokmeja b ON b.blok_id = rb.blok_id
          WHERE rb.reservasi_id = r.reservasi_id
        ) AS blok_list
      FROM dbo.reservasi r
      INNER JOIN dbo.users u ON u.user_id = r.user_id
      WHERE r.status_reservasi IN (N'MenungguPembayaran', N'MenungguVerifikasi', N'Terkonfirmasi')
      ORDER BY r.jadwal_reservasi ASC
    `);

    // 5. Jumlah perubahan audit log 7 hari terakhir
    const auditRes = await pool.request().query<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt
      FROM dbo.audit_log
      WHERE action_type IN (N'INSERT', N'UPDATE', N'DELETE')
        AND created_at >= DATEADD(DAY, -7, SYSDATETIMEOFFSET())
    `);

    return {
      reservasiSummary: reservasiSummaryRes.recordset,
      paymentSummary: paymentSummaryRes.recordset,
      totalUlasan: ratingRes.recordset[0]?.total_ulasan ?? 0,
      rataRataRating:
        ratingRes.recordset[0]?.rata_rata !== null &&
        ratingRes.recordset[0]?.rata_rata !== undefined
          ? Number(ratingRes.recordset[0].rata_rata.toFixed(2))
          : 0,
      upcomingReservations: upcomingRes.recordset,
      perubahan7Hari: auditRes.recordset[0]?.cnt ?? 0,
    };
  },
};
