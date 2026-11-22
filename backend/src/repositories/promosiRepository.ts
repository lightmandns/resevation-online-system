import { getPool, sql } from '../config/db.js';
import { AuditActor, insertAuditLogInTx } from '../utils/auditHelper.js';

export interface PromosiRow {
  promosi_id: string;
  judul: string;
  deskripsi: string;
  link_foto: string | null;
  periode_mulai: Date;
  periode_selesai: Date | null;
  is_active: boolean;
  created_at: Date;
}

export const promosiRepository = {
  async listPublicActive(): Promise<PromosiRow[]> {
    const pool = await getPool();
    const result = await pool.request().query<PromosiRow>(`
      SELECT *
      FROM dbo.promosi
      WHERE is_active = 1
        AND periode_mulai <= SYSDATETIMEOFFSET()
        AND (periode_selesai IS NULL OR periode_selesai >= SYSDATETIMEOFFSET())
      ORDER BY periode_mulai DESC
    `);
    return result.recordset;
  },

  async listAdmin(filter: {
    aktif?: boolean;
    offset: number;
    perPage: number;
  }): Promise<{ rows: PromosiRow[]; total: number }> {
    const pool = await getPool();
    const countReq = pool.request();
    const dataReq = pool.request();
    let whereClause = '';

    if (filter.aktif !== undefined) {
      whereClause = 'WHERE is_active = @aktif';
      countReq.input('aktif', sql.Bit, filter.aktif ? 1 : 0);
      dataReq.input('aktif', sql.Bit, filter.aktif ? 1 : 0);
    }

    const countResult = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM dbo.promosi ${whereClause}
    `);
    const total = countResult.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataResult = await dataReq.query<PromosiRow>(`
      SELECT *
      FROM dbo.promosi
      ${whereClause}
      ORDER BY created_at DESC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataResult.recordset, total };
  },

  async findById(promosiId: string): Promise<PromosiRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('promosi_id', sql.UniqueIdentifier, promosiId);
    const result = await req.query<PromosiRow>(`
      SELECT * FROM dbo.promosi WHERE promosi_id = @promosi_id
    `);
    return result.recordset[0] ?? null;
  },

  async create(
    data: {
      judul: string;
      deskripsi: string;
      link_foto: string | null;
      periode_mulai: Date;
      periode_selesai: Date | null;
      is_active: boolean;
    },
    actor: AuditActor
  ): Promise<PromosiRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('judul', sql.NVarChar(150), data.judul);
      req.input('deskripsi', sql.NVarChar(1000), data.deskripsi);
      req.input('link_foto', sql.NVarChar(255), data.link_foto);
      req.input('periode_mulai', sql.DateTimeOffset(0), data.periode_mulai);
      req.input('periode_selesai', sql.DateTimeOffset(0), data.periode_selesai);
      req.input('is_active', sql.Bit, data.is_active ? 1 : 0);

      const inserted = await req.query<PromosiRow>(`
        INSERT INTO dbo.promosi (
          judul, deskripsi, link_foto, periode_mulai, periode_selesai, is_active
        )
        OUTPUT INSERTED.*
        VALUES (
          @judul, @deskripsi, @link_foto, @periode_mulai, @periode_selesai, @is_active
        )
      `);

      const row = inserted.recordset[0];

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'INSERT',
        resourceType: 'promosi',
        resourceId: row.promosi_id,
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

  async update(
    promosiId: string,
    oldRow: PromosiRow,
    data: {
      judul: string;
      deskripsi: string;
      link_foto: string | null;
      periode_mulai: Date;
      periode_selesai: Date | null;
      is_active: boolean;
    },
    actor: AuditActor
  ): Promise<PromosiRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('promosi_id', sql.UniqueIdentifier, promosiId);
      req.input('judul', sql.NVarChar(150), data.judul);
      req.input('deskripsi', sql.NVarChar(1000), data.deskripsi);
      req.input('link_foto', sql.NVarChar(255), data.link_foto);
      req.input('periode_mulai', sql.DateTimeOffset(0), data.periode_mulai);
      req.input('periode_selesai', sql.DateTimeOffset(0), data.periode_selesai);
      req.input('is_active', sql.Bit, data.is_active ? 1 : 0);

      const updated = await req.query<PromosiRow>(`
        UPDATE dbo.promosi
        SET
          judul = @judul,
          deskripsi = @deskripsi,
          link_foto = @link_foto,
          periode_mulai = @periode_mulai,
          periode_selesai = @periode_selesai,
          is_active = @is_active
        OUTPUT INSERTED.*
        WHERE promosi_id = @promosi_id
      `);

      const newRow = updated.recordset[0];

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'UPDATE',
        resourceType: 'promosi',
        resourceId: promosiId,
        oldValues: oldRow,
        newValues: newRow,
      });

      await tx.commit();
      return newRow;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },

  async remove(promosiId: string, oldRow: PromosiRow, actor: AuditActor): Promise<void> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('promosi_id', sql.UniqueIdentifier, promosiId);

      await req.query(`DELETE FROM dbo.promosi WHERE promosi_id = @promosi_id`);

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'DELETE',
        resourceType: 'promosi',
        resourceId: promosiId,
        oldValues: oldRow,
        newValues: null,
      });

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },
};
