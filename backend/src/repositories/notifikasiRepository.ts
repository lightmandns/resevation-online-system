import { getPool, sql } from '../config/db.js';

export interface NotifikasiRow {
  notif_id: string;
  user_id: string;
  judul: string;
  isi: string;
  is_read: boolean;
  created_at: Date;
}

export const notifikasiRepository = {
  async listByUser(filter: {
    userId: string;
    unreadOnly: boolean;
    offset: number;
    perPage: number;
  }): Promise<{ rows: NotifikasiRow[]; total: number }> {
    const pool = await getPool();
    const conditions: string[] = ['user_id = @user_id'];
    const countReq = pool.request();
    const dataReq = pool.request();

    countReq.input('user_id', sql.UniqueIdentifier, filter.userId);
    dataReq.input('user_id', sql.UniqueIdentifier, filter.userId);

    if (filter.unreadOnly) {
      conditions.push('is_read = 0');
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countRes = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM dbo.notifikasi ${whereClause}
    `);
    const total = countRes.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataRes = await dataReq.query<NotifikasiRow>(`
      SELECT notif_id, user_id, judul, isi, is_read, created_at
      FROM dbo.notifikasi
      ${whereClause}
      ORDER BY created_at DESC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataRes.recordset, total };
  },

  async markAsRead(notifId: string, userId: string): Promise<NotifikasiRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('notif_id', sql.UniqueIdentifier, notifId);
    req.input('user_id', sql.UniqueIdentifier, userId);

    const res = await req.query<NotifikasiRow>(`
      UPDATE dbo.notifikasi
      SET is_read = 1
      OUTPUT INSERTED.*
      WHERE notif_id = @notif_id AND user_id = @user_id
    `);
    return res.recordset[0] ?? null;
  },

  async markAllAsRead(userId: string): Promise<number> {
    const pool = await getPool();
    const req = pool.request();
    req.input('user_id', sql.UniqueIdentifier, userId);

    const res = await req.query(`
      UPDATE dbo.notifikasi
      SET is_read = 1
      WHERE user_id = @user_id AND is_read = 0
    `);
    return res.rowsAffected[0] ?? 0;
  },
};
