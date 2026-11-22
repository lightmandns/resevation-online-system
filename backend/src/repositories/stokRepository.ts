import { getPool, sql } from '../config/db.js';
import { AuditActor, insertAuditLogInTx } from '../utils/auditHelper.js';
import { isValidUuid } from '../utils/errors.js';

export interface StokRow {
  bahan_id: string;
  nama_bahan: string;
  jumlah_stok: number;
  satuan: string;
  harga_satuan: number;
  tanggal_masuk: Date;
  created_at: Date;
  updated_at: Date;
}

export const stokRepository = {
  async list(filter: {
    namaBahan?: string;
    tanggalDari?: string;
    tanggalSampai?: string;
    offset: number;
    perPage: number;
  }): Promise<{ rows: StokRow[]; total: number }> {
    const pool = await getPool();
    const conditions: string[] = [];
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.namaBahan) {
      conditions.push('nama_bahan LIKE @nama_bahan');
      const pattern = `%${filter.namaBahan}%`;
      countReq.input('nama_bahan', sql.NVarChar(105), pattern);
      dataReq.input('nama_bahan', sql.NVarChar(105), pattern);
    }

    if (filter.tanggalDari) {
      conditions.push('tanggal_masuk >= @tanggal_dari');
      countReq.input('tanggal_dari', sql.Date, filter.tanggalDari);
      dataReq.input('tanggal_dari', sql.Date, filter.tanggalDari);
    }

    if (filter.tanggalSampai) {
      conditions.push('tanggal_masuk <= @tanggal_sampai');
      countReq.input('tanggal_sampai', sql.Date, filter.tanggalSampai);
      dataReq.input('tanggal_sampai', sql.Date, filter.tanggalSampai);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM dbo.stok ${whereClause}
    `);
    const total = countResult.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataResult = await dataReq.query<StokRow>(`
      SELECT *
      FROM dbo.stok
      ${whereClause}
      ORDER BY tanggal_masuk DESC, nama_bahan ASC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataResult.recordset, total };
  },

  async findById(bahanId: string): Promise<StokRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('bahan_id', sql.UniqueIdentifier, bahanId);
    const result = await req.query<StokRow>(`
      SELECT * FROM dbo.stok WHERE bahan_id = @bahan_id
    `);
    return result.recordset[0] ?? null;
  },

  async findByName(namaBahan: string): Promise<StokRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('nama_bahan', sql.NVarChar(100), namaBahan);
    const result = await req.query<StokRow>(`
      SELECT * FROM dbo.stok WHERE LOWER(nama_bahan) = LOWER(@nama_bahan)
    `);
    return result.recordset[0] ?? null;
  },

  /**
   * E43 — Catat bahan masuk (tambah ke stok yang ada jika nama sama, atau insert baru).
   * Sekaligus mencatat relasi di dbo.user_stok dan audit log secara atomik.
   */
  async recordStockIn(
    data: {
      nama_bahan: string;
      satuan: string;
      jumlah: number;
      harga_satuan: number;
      tanggal_masuk: string;
    },
    existing: StokRow | null,
    actor: AuditActor
  ): Promise<StokRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      let resultRow: StokRow;

      if (existing) {
        const updateReq = new sql.Request(tx);
        updateReq.input('bahan_id', sql.UniqueIdentifier, existing.bahan_id);
        updateReq.input('jumlah', sql.Decimal(12, 3), data.jumlah);
        updateReq.input('satuan', sql.NVarChar(20), data.satuan);
        updateReq.input('harga_satuan', sql.Decimal(12, 2), data.harga_satuan);
        updateReq.input('tanggal_masuk', sql.Date, data.tanggal_masuk);

        const updated = await updateReq.query<StokRow>(`
          UPDATE dbo.stok
          SET
            jumlah_stok = jumlah_stok + @jumlah,
            satuan = @satuan,
            harga_satuan = @harga_satuan,
            tanggal_masuk = @tanggal_masuk,
            updated_at = SYSDATETIMEOFFSET()
          OUTPUT INSERTED.*
          WHERE bahan_id = @bahan_id
        `);
        resultRow = updated.recordset[0];

        await insertAuditLogInTx(tx, {
          actor,
          actionType: 'UPDATE',
          resourceType: 'stok',
          resourceId: resultRow.bahan_id,
          oldValues: existing,
          newValues: resultRow,
        });
      } else {
        const insertReq = new sql.Request(tx);
        insertReq.input('nama_bahan', sql.NVarChar(100), data.nama_bahan);
        insertReq.input('jumlah_stok', sql.Decimal(12, 3), data.jumlah);
        insertReq.input('satuan', sql.NVarChar(20), data.satuan);
        insertReq.input('harga_satuan', sql.Decimal(12, 2), data.harga_satuan);
        insertReq.input('tanggal_masuk', sql.Date, data.tanggal_masuk);

        const inserted = await insertReq.query<StokRow>(`
          INSERT INTO dbo.stok (nama_bahan, jumlah_stok, satuan, harga_satuan, tanggal_masuk)
          OUTPUT INSERTED.*
          VALUES (@nama_bahan, @jumlah_stok, @satuan, @harga_satuan, @tanggal_masuk)
        `);
        resultRow = inserted.recordset[0];

        await insertAuditLogInTx(tx, {
          actor,
          actionType: 'INSERT',
          resourceType: 'stok',
          resourceId: resultRow.bahan_id,
          oldValues: null,
          newValues: resultRow,
        });
      }

      if (isValidUuid(actor.userId)) {
        const linkReq = new sql.Request(tx);
        linkReq.input('user_id', sql.UniqueIdentifier, actor.userId);
        linkReq.input('bahan_id', sql.UniqueIdentifier, resultRow.bahan_id);
        await linkReq.query(`
          IF NOT EXISTS (
            SELECT 1 FROM dbo.user_stok WHERE user_id = @user_id AND bahan_id = @bahan_id
          )
          INSERT INTO dbo.user_stok (user_id, bahan_id) VALUES (@user_id, @bahan_id)
        `);
      }

      await tx.commit();
      return resultRow;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },

  /**
   * E45 — Perbarui jumlah stok gudang secara atomik + catat audit log.
   */
  async updateQuantity(
    bahanId: string,
    oldRow: StokRow,
    jumlahBaru: number,
    actor: AuditActor
  ): Promise<StokRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('bahan_id', sql.UniqueIdentifier, bahanId);
      req.input('jumlah_stok', sql.Decimal(12, 3), jumlahBaru);

      const updated = await req.query<StokRow>(`
        UPDATE dbo.stok
        SET
          jumlah_stok = @jumlah_stok,
          updated_at = SYSDATETIMEOFFSET()
        OUTPUT INSERTED.*
        WHERE bahan_id = @bahan_id
      `);

      const newRow = updated.recordset[0];

      if (isValidUuid(actor.userId)) {
        const linkReq = new sql.Request(tx);
        linkReq.input('user_id', sql.UniqueIdentifier, actor.userId);
        linkReq.input('bahan_id', sql.UniqueIdentifier, bahanId);
        await linkReq.query(`
          IF NOT EXISTS (
            SELECT 1 FROM dbo.user_stok WHERE user_id = @user_id AND bahan_id = @bahan_id
          )
          INSERT INTO dbo.user_stok (user_id, bahan_id) VALUES (@user_id, @bahan_id)
        `);
      }

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'UPDATE',
        resourceType: 'stok',
        resourceId: bahanId,
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
};
