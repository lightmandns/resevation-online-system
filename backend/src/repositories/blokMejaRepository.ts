import { getPool, sql } from '../config/db.js';
import { AuditActor, insertAuditLogInTx } from '../utils/auditHelper.js';

export interface BlokMejaRow {
  blok_id: string;
  nama_blok: string;
  kapasitas: number;
  nominal_dp: number;
  deskripsi: string | null;
  link_foto: string | null;
  status_ketersediaan: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  terkunci?: boolean | number;
}

export interface BlokAvailabilityRow {
  blok_id: string;
  nama_blok: string;
  kapasitas: number;
  nominal_dp: number;
  deskripsi: string | null;
  link_foto: string | null;
  availability_status: 'kosong' | 'terisi' | 'ditahan';
}

export const blokMejaRepository = {
  async getScheduleSettings(): Promise<{
    jam_buka: string;
    jam_tutup: string;
    durasi_slot_jam: number;
  }> {
    const pool = await getPool();
    const result = await pool.request().query<{ setting_key: string; setting_value: string }>(`
      SELECT setting_key, setting_value
      FROM dbo.system_settings
      WHERE setting_key IN (N'jam_buka', N'jam_tutup', N'durasi_slot_jam')
    `);

    const map: Record<string, string> = {};
    for (const r of result.recordset) {
      map[r.setting_key] = r.setting_value;
    }

    const durasi = Number.parseInt(map.durasi_slot_jam || '3', 10);
    return {
      jam_buka: map.jam_buka || '10:00',
      jam_tutup: map.jam_tutup || '22:00',
      durasi_slot_jam: Number.isNaN(durasi) || durasi <= 0 ? 3 : durasi,
    };
  },

  /**
   * E10 — Cek ketersediaan seluruh blok aktif pada slot [jadwalMulai, jadwalSelesai)
   */
  async listAvailability(
    jadwalMulai: Date,
    jadwalSelesai: Date
  ): Promise<BlokAvailabilityRow[]> {
    const pool = await getPool();
    const req = pool.request();
    req.input('jadwal_mulai', sql.DateTimeOffset(0), jadwalMulai);
    req.input('jadwal_selesai', sql.DateTimeOffset(0), jadwalSelesai);

    const result = await req.query<BlokAvailabilityRow>(`
      SELECT
        b.blok_id,
        b.nama_blok,
        b.kapasitas,
        b.nominal_dp,
        b.deskripsi,
        b.link_foto,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM dbo.reservasi_blok rb
            INNER JOIN dbo.reservasi r ON r.reservasi_id = rb.reservasi_id
            WHERE rb.blok_id = b.blok_id
              AND rb.status_penahanan IN (N'Ditahan', N'Terpakai')
              AND r.status_reservasi IN (N'Terkonfirmasi', N'MenungguVerifikasi')
              AND r.jadwal_reservasi < @jadwal_selesai
              AND r.jadwal_selesai > @jadwal_mulai
          ) THEN N'terisi'
          WHEN EXISTS (
            SELECT 1
            FROM dbo.reservasi_blok rb
            INNER JOIN dbo.reservasi r ON r.reservasi_id = rb.reservasi_id
            WHERE rb.blok_id = b.blok_id
              AND rb.status_penahanan = N'Ditahan'
              AND r.status_reservasi = N'MenungguPembayaran'
              AND r.batas_penahanan > SYSDATETIMEOFFSET()
              AND r.jadwal_reservasi < @jadwal_selesai
              AND r.jadwal_selesai > @jadwal_mulai
          ) THEN N'ditahan'
          ELSE N'kosong'
        END AS availability_status
      FROM dbo.blokmeja b
      WHERE b.is_active = 1
      ORDER BY b.nama_blok ASC
    `);

    return result.recordset;
  },
  async listAdmin(filter: {
    includeInactive: boolean;
    offset: number;
    perPage: number;
  }): Promise<{ rows: BlokMejaRow[]; total: number }> {
    const pool = await getPool();
    const whereClause = filter.includeInactive ? '' : 'WHERE b.is_active = 1';

    const countResult = await pool.request().query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM dbo.blokmeja b ${whereClause}
    `);
    const total = countResult.recordset[0]?.total ?? 0;

    const dataReq = pool.request();
    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataResult = await dataReq.query<BlokMejaRow>(`
      SELECT
        b.blok_id,
        b.nama_blok,
        b.kapasitas,
        b.nominal_dp,
        b.deskripsi,
        b.link_foto,
        b.status_ketersediaan,
        b.is_active,
        b.created_at,
        b.updated_at,
        CASE
          WHEN EXISTS (
            SELECT 1
            FROM dbo.reservasi_blok rb
            INNER JOIN dbo.reservasi r ON r.reservasi_id = rb.reservasi_id
            WHERE rb.blok_id = b.blok_id
              AND rb.status_penahanan IN (N'Ditahan', N'Terpakai')
              AND r.status_reservasi IN (N'MenungguPembayaran', N'MenungguVerifikasi', N'Terkonfirmasi')
              AND (r.status_reservasi <> N'MenungguPembayaran' OR r.batas_penahanan > SYSDATETIMEOFFSET())
          ) THEN CAST(1 AS BIT)
          ELSE CAST(0 AS BIT)
        END AS terkunci
      FROM dbo.blokmeja b
      ${whereClause}
      ORDER BY b.nama_blok ASC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataResult.recordset, total };
  },

  async findById(blokId: string): Promise<BlokMejaRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('blok_id', sql.UniqueIdentifier, blokId);
    const result = await req.query<BlokMejaRow>(`
      SELECT * FROM dbo.blokmeja WHERE blok_id = @blok_id
    `);
    return result.recordset[0] ?? null;
  },

  async findByName(namaBlok: string, excludeId?: string): Promise<BlokMejaRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('nama_blok', sql.NVarChar(100), namaBlok);

    let query = `SELECT * FROM dbo.blokmeja WHERE LOWER(nama_blok) = LOWER(@nama_blok)`;
    if (excludeId) {
      req.input('exclude_id', sql.UniqueIdentifier, excludeId);
      query += ` AND blok_id <> @exclude_id`;
    }
    const result = await req.query<BlokMejaRow>(query);
    return result.recordset[0] ?? null;
  },

  async hasActiveReservation(blokId: string): Promise<boolean> {
    const pool = await getPool();
    const req = pool.request();
    req.input('blok_id', sql.UniqueIdentifier, blokId);
    const result = await req.query<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt
      FROM dbo.reservasi_blok rb
      INNER JOIN dbo.reservasi r ON r.reservasi_id = rb.reservasi_id
      WHERE rb.blok_id = @blok_id
        AND rb.status_penahanan IN (N'Ditahan', N'Terpakai')
        AND r.status_reservasi IN (N'MenungguPembayaran', N'MenungguVerifikasi', N'Terkonfirmasi')
        AND (r.status_reservasi <> N'MenungguPembayaran' OR r.batas_penahanan > SYSDATETIMEOFFSET())
    `);
    return (result.recordset[0]?.cnt ?? 0) > 0;
  },

  async create(
    data: {
      nama_blok: string;
      kapasitas: number;
      nominal_dp: number;
      deskripsi: string | null;
      link_foto: string | null;
    },
    actor: AuditActor
  ): Promise<BlokMejaRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('nama_blok', sql.NVarChar(100), data.nama_blok);
      req.input('kapasitas', sql.Int, data.kapasitas);
      req.input('nominal_dp', sql.Decimal(12, 2), data.nominal_dp);
      req.input('deskripsi', sql.NVarChar(sql.MAX), data.deskripsi);
      req.input('link_foto', sql.NVarChar(255), data.link_foto);

      const inserted = await req.query<BlokMejaRow>(`
        INSERT INTO dbo.blokmeja (nama_blok, kapasitas, nominal_dp, deskripsi, link_foto)
        OUTPUT INSERTED.*
        VALUES (@nama_blok, @kapasitas, @nominal_dp, @deskripsi, @link_foto)
      `);

      const row = inserted.recordset[0];

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'INSERT',
        resourceType: 'blokmeja',
        resourceId: row.blok_id,
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
    blokId: string,
    oldRow: BlokMejaRow,
    data: {
      nama_blok: string;
      kapasitas: number;
      nominal_dp: number;
      deskripsi: string | null;
      link_foto: string | null;
      status_ketersediaan: string;
    },
    actor: AuditActor
  ): Promise<BlokMejaRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('blok_id', sql.UniqueIdentifier, blokId);
      req.input('nama_blok', sql.NVarChar(100), data.nama_blok);
      req.input('kapasitas', sql.Int, data.kapasitas);
      req.input('nominal_dp', sql.Decimal(12, 2), data.nominal_dp);
      req.input('deskripsi', sql.NVarChar(sql.MAX), data.deskripsi);
      req.input('link_foto', sql.NVarChar(255), data.link_foto);
      req.input('status_ketersediaan', sql.NVarChar(15), data.status_ketersediaan);

      const updated = await req.query<BlokMejaRow>(`
        UPDATE dbo.blokmeja
        SET
          nama_blok = @nama_blok,
          kapasitas = @kapasitas,
          nominal_dp = @nominal_dp,
          deskripsi = @deskripsi,
          link_foto = @link_foto,
          status_ketersediaan = @status_ketersediaan,
          updated_at = SYSDATETIMEOFFSET()
        OUTPUT INSERTED.*
        WHERE blok_id = @blok_id
      `);

      const newRow = updated.recordset[0];

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'UPDATE',
        resourceType: 'blokmeja',
        resourceId: blokId,
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

  async softDelete(blokId: string, oldRow: BlokMejaRow, actor: AuditActor): Promise<void> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('blok_id', sql.UniqueIdentifier, blokId);

      const updated = await req.query<BlokMejaRow>(`
        UPDATE dbo.blokmeja
        SET is_active = 0, updated_at = SYSDATETIMEOFFSET()
        OUTPUT INSERTED.*
        WHERE blok_id = @blok_id
      `);

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'DELETE',
        resourceType: 'blokmeja',
        resourceId: blokId,
        oldValues: oldRow,
        newValues: updated.recordset[0] ?? null,
      });

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },
};
