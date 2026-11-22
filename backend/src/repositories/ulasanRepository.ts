import { getPool, sql } from '../config/db.js';
import { AuditActor, insertAuditLogInTx } from '../utils/auditHelper.js';

export interface ReviewEligibilityContext {
  reservasi_id: string;
  user_id: string;
  jadwal_reservasi: Date;
  status_reservasi: string;
  dp_confirmed: number;
  accepted_order_count: number;
  pelunasan_confirmed: number;
  has_review: number;
}

export interface UlasanRow {
  reservasi_id: string;
  rating: number;
  komentar: string | null;
  created_at: Date;
}

export interface ManagerReviewListRow extends UlasanRow {
  nama_pelanggan: string;
  jadwal_reservasi: Date;
}

export const ulasanRepository = {
  async getEligibilityContext(reservasiId: string): Promise<ReviewEligibilityContext | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('reservasi_id', sql.UniqueIdentifier, reservasiId);

    const result = await req.query<ReviewEligibilityContext>(`
      SELECT
        r.reservasi_id,
        r.user_id,
        r.jadwal_reservasi,
        r.status_reservasi,
        (
          SELECT COUNT(*)
          FROM dbo.pembayaran p
          WHERE p.reservasi_id = r.reservasi_id
            AND p.jenis_pembayaran = N'DP'
            AND p.status = N'Terkonfirmasi'
        ) AS dp_confirmed,
        (
          SELECT COUNT(*)
          FROM dbo.detail_pesanan dp
          WHERE dp.reservasi_id = r.reservasi_id
            AND dp.status_item = N'Diterima'
        ) AS accepted_order_count,
        (
          SELECT COUNT(*)
          FROM dbo.pembayaran p
          WHERE p.reservasi_id = r.reservasi_id
            AND p.jenis_pembayaran = N'Pelunasan'
            AND p.status = N'Terkonfirmasi'
        ) AS pelunasan_confirmed,
        (
          SELECT COUNT(*)
          FROM dbo.ulasan u
          WHERE u.reservasi_id = r.reservasi_id
        ) AS has_review
      FROM dbo.reservasi r
      WHERE r.reservasi_id = @reservasi_id
    `);

    return result.recordset[0] ?? null;
  },

  async create(
    data: { reservasiId: string; rating: number; komentar: string | null },
    actor: AuditActor
  ): Promise<UlasanRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('reservasi_id', sql.UniqueIdentifier, data.reservasiId);
      req.input('rating', sql.TinyInt, data.rating);
      req.input('komentar', sql.NVarChar(1000), data.komentar);

      const inserted = await req.query<UlasanRow>(`
        INSERT INTO dbo.ulasan (reservasi_id, rating, komentar)
        OUTPUT INSERTED.*
        VALUES (@reservasi_id, @rating, @komentar)
      `);

      const row = inserted.recordset[0];

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'INSERT',
        resourceType: 'ulasan',
        resourceId: row.reservasi_id,
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

  async listForManager(filter: {
    skor?: number;
    tanggalDari?: string;
    tanggalSampai?: string;
    offset: number;
    perPage: number;
  }): Promise<{ rows: ManagerReviewListRow[]; total: number; rataRata: number }> {
    const pool = await getPool();
    const conditions: string[] = [];
    const summaryReq = pool.request();
    const dataReq = pool.request();

    if (filter.skor !== undefined) {
      conditions.push('u.rating = @skor');
      summaryReq.input('skor', sql.TinyInt, filter.skor);
      dataReq.input('skor', sql.TinyInt, filter.skor);
    }

    if (filter.tanggalDari) {
      conditions.push('CAST(u.created_at AS DATE) >= @tanggal_dari');
      summaryReq.input('tanggal_dari', sql.Date, filter.tanggalDari);
      dataReq.input('tanggal_dari', sql.Date, filter.tanggalDari);
    }

    if (filter.tanggalSampai) {
      conditions.push('CAST(u.created_at AS DATE) <= @tanggal_sampai');
      summaryReq.input('tanggal_sampai', sql.Date, filter.tanggalSampai);
      dataReq.input('tanggal_sampai', sql.Date, filter.tanggalSampai);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const summaryRes = await summaryReq.query<{ total: number; rata_rata: number | null }>(`
      SELECT
        COUNT(*) AS total,
        AVG(CAST(u.rating AS FLOAT)) AS rata_rata
      FROM dbo.ulasan u
      ${whereClause}
    `);

    const total = summaryRes.recordset[0]?.total ?? 0;
    const rawAvg = summaryRes.recordset[0]?.rata_rata;
    const rataRata = rawAvg !== null && rawAvg !== undefined ? Number(rawAvg.toFixed(2)) : 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataRes = await dataReq.query<ManagerReviewListRow>(`
      SELECT
        u.reservasi_id,
        u.rating,
        u.komentar,
        u.created_at,
        usr.full_name AS nama_pelanggan,
        r.jadwal_reservasi
      FROM dbo.ulasan u
      INNER JOIN dbo.reservasi r ON r.reservasi_id = u.reservasi_id
      INNER JOIN dbo.users usr ON usr.user_id = r.user_id
      ${whereClause}
      ORDER BY u.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return {
      rows: dataRes.recordset,
      total,
      rataRata,
    };
  },
};
