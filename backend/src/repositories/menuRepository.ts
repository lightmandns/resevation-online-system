import { getPool, sql } from '../config/db.js';
import { AuditActor, insertAuditLogInTx } from '../utils/auditHelper.js';

export interface MenuRow {
  menu_id: string;
  nama_menu: string;
  kategori_menu: string;
  harga: number;
  is_available: boolean;
  minimal_porsi: number;
  deskripsi: string | null;
  link_foto_menu: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export const menuRepository = {
  async findReservationStatusForUser(
    reservasiId: string
  ): Promise<{ user_id: string; status_reservasi: string } | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('reservasi_id', sql.UniqueIdentifier, reservasiId);
    const result = await req.query<{ user_id: string; status_reservasi: string }>(`
      SELECT user_id, status_reservasi
      FROM dbo.reservasi
      WHERE reservasi_id = @reservasi_id
    `);
    return result.recordset[0] ?? null;
  },

  async listAllActiveCatalog(filter: {
    kategori?: string;
    search?: string;
  }): Promise<MenuRow[]> {
    const pool = await getPool();
    const conditions: string[] = ['is_active = 1', "kategori_menu <> N'Request'"];
    const req = pool.request();

    if (filter.kategori) {
      conditions.push('LOWER(kategori_menu) = LOWER(@kategori)');
      req.input('kategori', sql.NVarChar(15), filter.kategori);
    }
    if (filter.search) {
      conditions.push('nama_menu LIKE @search');
      req.input('search', sql.NVarChar(105), `%${filter.search}%`);
    }

    const result = await req.query<MenuRow>(`
      SELECT *
      FROM dbo.menus
      WHERE ${conditions.join(' AND ')}
      ORDER BY kategori_menu ASC, nama_menu ASC
    `);
    return result.recordset;
  },

  async listPublic(filter: {
    kategori?: string;
    search?: string;
    offset: number;
    perPage: number;
  }): Promise<{ rows: MenuRow[]; total: number }> {
    const pool = await getPool();
    const conditions: string[] = ['is_active = 1', "kategori_menu <> N'Request'"];
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.kategori) {
      conditions.push('LOWER(kategori_menu) = LOWER(@kategori)');
      countReq.input('kategori', sql.NVarChar(15), filter.kategori);
      dataReq.input('kategori', sql.NVarChar(15), filter.kategori);
    }

    if (filter.search) {
      conditions.push('nama_menu LIKE @search');
      const pattern = `%${filter.search}%`;
      countReq.input('search', sql.NVarChar(105), pattern);
      dataReq.input('search', sql.NVarChar(105), pattern);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countResult = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM dbo.menus ${whereClause}
    `);
    const total = countResult.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataResult = await dataReq.query<MenuRow>(`
      SELECT *
      FROM dbo.menus
      ${whereClause}
      ORDER BY kategori_menu ASC, nama_menu ASC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataResult.recordset, total };
  },

  async listAdmin(filter: {
    kategori?: string;
    tersedia?: boolean;
    search?: string;
    includeInactive: boolean;
    offset: number;
    perPage: number;
  }): Promise<{ rows: MenuRow[]; total: number }> {
    const pool = await getPool();
    const conditions: string[] = [];
    const countReq = pool.request();
    const dataReq = pool.request();

    if (!filter.includeInactive) {
      conditions.push('is_active = 1');
    }

    if (filter.kategori) {
      conditions.push('LOWER(kategori_menu) = LOWER(@kategori)');
      countReq.input('kategori', sql.NVarChar(15), filter.kategori);
      dataReq.input('kategori', sql.NVarChar(15), filter.kategori);
    }

    if (filter.tersedia !== undefined) {
      conditions.push('is_available = @tersedia');
      countReq.input('tersedia', sql.Bit, filter.tersedia ? 1 : 0);
      dataReq.input('tersedia', sql.Bit, filter.tersedia ? 1 : 0);
    }

    if (filter.search) {
      conditions.push('nama_menu LIKE @search');
      const pattern = `%${filter.search}%`;
      countReq.input('search', sql.NVarChar(105), pattern);
      dataReq.input('search', sql.NVarChar(105), pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM dbo.menus ${whereClause}
    `);
    const total = countResult.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataResult = await dataReq.query<MenuRow>(`
      SELECT *
      FROM dbo.menus
      ${whereClause}
      ORDER BY kategori_menu ASC, nama_menu ASC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataResult.recordset, total };
  },

  async findById(menuId: string): Promise<MenuRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('menu_id', sql.UniqueIdentifier, menuId);
    const result = await req.query<MenuRow>(`
      SELECT * FROM dbo.menus WHERE menu_id = @menu_id
    `);
    return result.recordset[0] ?? null;
  },

  async findByName(namaMenu: string, excludeId?: string): Promise<MenuRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('nama_menu', sql.NVarChar(100), namaMenu);

    let query = `SELECT * FROM dbo.menus WHERE LOWER(nama_menu) = LOWER(@nama_menu)`;
    if (excludeId) {
      req.input('exclude_id', sql.UniqueIdentifier, excludeId);
      query += ` AND menu_id <> @exclude_id`;
    }
    const result = await req.query<MenuRow>(query);
    return result.recordset[0] ?? null;
  },

  async hasActiveReservation(menuId: string): Promise<boolean> {
    const pool = await getPool();
    const req = pool.request();
    req.input('menu_id', sql.UniqueIdentifier, menuId);
    const result = await req.query<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt
      FROM dbo.detail_pesanan dp
      INNER JOIN dbo.reservasi r ON r.reservasi_id = dp.reservasi_id
      WHERE dp.menu_id = @menu_id
        AND dp.status_item IN (N'Diajukan', N'Diterima')
        AND r.status_reservasi IN (N'MenungguPembayaran', N'MenungguVerifikasi', N'Terkonfirmasi')
    `);
    return (result.recordset[0]?.cnt ?? 0) > 0;
  },

  async create(
    data: {
      nama_menu: string;
      kategori_menu: string;
      harga: number;
      is_available: boolean;
      minimal_porsi: number;
      deskripsi: string | null;
      link_foto_menu: string | null;
    },
    actor: AuditActor
  ): Promise<MenuRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('nama_menu', sql.NVarChar(100), data.nama_menu);
      req.input('kategori_menu', sql.NVarChar(15), data.kategori_menu);
      req.input('harga', sql.Decimal(12, 2), data.harga);
      req.input('is_available', sql.Bit, data.is_available ? 1 : 0);
      req.input('minimal_porsi', sql.Int, data.minimal_porsi);
      req.input('deskripsi', sql.NVarChar(sql.MAX), data.deskripsi);
      req.input('link_foto_menu', sql.NVarChar(255), data.link_foto_menu);

      const inserted = await req.query<MenuRow>(`
        INSERT INTO dbo.menus (
          nama_menu, kategori_menu, harga, is_available, minimal_porsi, deskripsi, link_foto_menu
        )
        OUTPUT INSERTED.*
        VALUES (
          @nama_menu, @kategori_menu, @harga, @is_available, @minimal_porsi, @deskripsi, @link_foto_menu
        )
      `);

      const row = inserted.recordset[0];

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'INSERT',
        resourceType: 'menus',
        resourceId: row.menu_id,
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
    menuId: string,
    oldRow: MenuRow,
    data: {
      nama_menu: string;
      kategori_menu: string;
      harga: number;
      is_available: boolean;
      minimal_porsi: number;
      deskripsi: string | null;
      link_foto_menu: string | null;
    },
    actor: AuditActor
  ): Promise<MenuRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('menu_id', sql.UniqueIdentifier, menuId);
      req.input('nama_menu', sql.NVarChar(100), data.nama_menu);
      req.input('kategori_menu', sql.NVarChar(15), data.kategori_menu);
      req.input('harga', sql.Decimal(12, 2), data.harga);
      req.input('is_available', sql.Bit, data.is_available ? 1 : 0);
      req.input('minimal_porsi', sql.Int, data.minimal_porsi);
      req.input('deskripsi', sql.NVarChar(sql.MAX), data.deskripsi);
      req.input('link_foto_menu', sql.NVarChar(255), data.link_foto_menu);

      const updated = await req.query<MenuRow>(`
        UPDATE dbo.menus
        SET
          nama_menu = @nama_menu,
          kategori_menu = @kategori_menu,
          harga = @harga,
          is_available = @is_available,
          minimal_porsi = @minimal_porsi,
          deskripsi = @deskripsi,
          link_foto_menu = @link_foto_menu,
          updated_at = SYSDATETIMEOFFSET()
        OUTPUT INSERTED.*
        WHERE menu_id = @menu_id
      `);

      const newRow = updated.recordset[0];

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'UPDATE',
        resourceType: 'menus',
        resourceId: menuId,
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

  async softDelete(menuId: string, oldRow: MenuRow, actor: AuditActor): Promise<void> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('menu_id', sql.UniqueIdentifier, menuId);

      const updated = await req.query<MenuRow>(`
        UPDATE dbo.menus
        SET is_active = 0, updated_at = SYSDATETIMEOFFSET()
        OUTPUT INSERTED.*
        WHERE menu_id = @menu_id
      `);

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'DELETE',
        resourceType: 'menus',
        resourceId: menuId,
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
