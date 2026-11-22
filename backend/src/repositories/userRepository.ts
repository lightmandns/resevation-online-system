import { getPool, sql } from '../config/db.js';
import { AuditActor, insertAuditLogInTx } from '../utils/auditHelper.js';

export interface UserRow {
  user_id: string;
  role_id: number;
  role_name: string;
  full_name: string;
  email: string;
  phone_number: string;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export const userRepository = {
  async list(filter: {
    role?: string;
    search?: string;
    includeInactive: boolean;
    offset: number;
    perPage: number;
  }): Promise<{ rows: UserRow[]; total: number }> {
    const pool = await getPool();
    const conditions: string[] = [];
    const countReq = pool.request();
    const dataReq = pool.request();

    if (!filter.includeInactive) {
      conditions.push('u.is_active = 1');
    }

    if (filter.role) {
      conditions.push('LOWER(r.role_name) = LOWER(@role)');
      countReq.input('role', sql.NVarChar(30), filter.role);
      dataReq.input('role', sql.NVarChar(30), filter.role);
    }

    if (filter.search) {
      conditions.push('(u.full_name LIKE @search OR u.email LIKE @search)');
      const pattern = `%${filter.search}%`;
      countReq.input('search', sql.NVarChar(155), pattern);
      dataReq.input('search', sql.NVarChar(155), pattern);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total
      FROM dbo.users u
      INNER JOIN dbo.roles r ON r.role_id = u.role_id
      ${whereClause}
    `);
    const total = countRes.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataRes = await dataReq.query<UserRow>(`
      SELECT
        u.user_id,
        u.role_id,
        r.role_name,
        u.full_name,
        u.email,
        u.phone_number,
        u.is_active,
        u.last_login_at,
        u.created_at,
        u.updated_at
      FROM dbo.users u
      INNER JOIN dbo.roles r ON r.role_id = u.role_id
      ${whereClause}
      ORDER BY u.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataRes.recordset, total };
  },

  async findById(userId: string): Promise<UserRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('user_id', sql.UniqueIdentifier, userId);
    const res = await req.query<UserRow>(`
      SELECT
        u.user_id,
        u.role_id,
        r.role_name,
        u.full_name,
        u.email,
        u.phone_number,
        u.is_active,
        u.last_login_at,
        u.created_at,
        u.updated_at
      FROM dbo.users u
      INNER JOIN dbo.roles r ON r.role_id = u.role_id
      WHERE u.user_id = @user_id
    `);
    return res.recordset[0] ?? null;
  },

  async findByEmail(email: string, excludeUserId?: string): Promise<UserRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('email', sql.NVarChar(150), email.trim().toLowerCase());
    let query = `
      SELECT
        u.user_id, u.role_id, r.role_name, u.full_name, u.email,
        u.phone_number, u.is_active, u.last_login_at, u.created_at, u.updated_at
      FROM dbo.users u
      INNER JOIN dbo.roles r ON r.role_id = u.role_id
      WHERE LOWER(u.email) = @email
    `;
    if (excludeUserId) {
      req.input('exclude_id', sql.UniqueIdentifier, excludeUserId);
      query += ` AND u.user_id <> @exclude_id`;
    }
    const res = await req.query<UserRow>(query);
    return res.recordset[0] ?? null;
  },

  async findRoleIdByName(roleName: string): Promise<{ role_id: number; role_name: string } | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('role_name', sql.NVarChar(30), roleName);
    const res = await req.query<{ role_id: number; role_name: string }>(`
      SELECT role_id, role_name FROM dbo.roles WHERE LOWER(role_name) = LOWER(@role_name)
    `);
    return res.recordset[0] ?? null;
  },

  async create(
    data: {
      role_id: number;
      full_name: string;
      email: string;
      phone_number: string;
      password_hash: string;
      is_active: boolean;
    },
    actor: AuditActor
  ): Promise<UserRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('role_id', sql.Int, data.role_id);
      req.input('full_name', sql.NVarChar(100), data.full_name);
      req.input('email', sql.NVarChar(150), data.email);
      req.input('phone_number', sql.NVarChar(20), data.phone_number);
      req.input('password_hash', sql.NVarChar(255), data.password_hash);
      req.input('is_active', sql.Bit, data.is_active ? 1 : 0);

      const ins = await req.query<{ user_id: string }>(`
        INSERT INTO dbo.users (role_id, full_name, email, phone_number, password_hash, is_active)
        OUTPUT INSERTED.user_id
        VALUES (@role_id, @full_name, @email, @phone_number, @password_hash, @is_active)
      `);

      const newId = ins.recordset[0].user_id;

      // Jangan catat password_hash di audit log (BR-62)
      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'INSERT',
        resourceType: 'users',
        resourceId: newId,
        oldValues: null,
        newValues: {
          user_id: newId,
          role_id: data.role_id,
          full_name: data.full_name,
          email: data.email,
          phone_number: data.phone_number,
          is_active: data.is_active,
        },
      });

      await tx.commit();
      const created = await this.findById(newId);
      if (!created) throw new Error('Gagal membaca user baru.');
      return created;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },

  async update(
    userId: string,
    oldRow: UserRow,
    data: {
      role_id: number;
      full_name: string;
      email: string;
      phone_number: string;
      is_active: boolean;
      password_hash?: string;
    },
    actor: AuditActor
  ): Promise<UserRow> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('user_id', sql.UniqueIdentifier, userId);
      req.input('role_id', sql.Int, data.role_id);
      req.input('full_name', sql.NVarChar(100), data.full_name);
      req.input('email', sql.NVarChar(150), data.email);
      req.input('phone_number', sql.NVarChar(20), data.phone_number);
      req.input('is_active', sql.Bit, data.is_active ? 1 : 0);

      if (data.password_hash) {
        req.input('password_hash', sql.NVarChar(255), data.password_hash);
        await req.query(`
          UPDATE dbo.users
          SET
            role_id = @role_id,
            full_name = @full_name,
            email = @email,
            phone_number = @phone_number,
            is_active = @is_active,
            password_hash = @password_hash
          WHERE user_id = @user_id
        `);
      } else {
        await req.query(`
          UPDATE dbo.users
          SET
            role_id = @role_id,
            full_name = @full_name,
            email = @email,
            phone_number = @phone_number,
            is_active = @is_active
          WHERE user_id = @user_id
        `);
      }

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'UPDATE',
        resourceType: 'users',
        resourceId: userId,
        oldValues: {
          role_id: oldRow.role_id,
          role_name: oldRow.role_name,
          full_name: oldRow.full_name,
          email: oldRow.email,
          phone_number: oldRow.phone_number,
          is_active: oldRow.is_active,
        },
        newValues: {
          role_id: data.role_id,
          full_name: data.full_name,
          email: data.email,
          phone_number: data.phone_number,
          is_active: data.is_active,
          password_changed: Boolean(data.password_hash),
        },
      });

      await tx.commit();
      const updated = await this.findById(userId);
      if (!updated) throw new Error('Gagal membaca user setelah diperbarui.');
      return updated;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },

  async softDelete(userId: string, oldRow: UserRow, actor: AuditActor): Promise<void> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const req = new sql.Request(tx);
      req.input('user_id', sql.UniqueIdentifier, userId);
      await req.query(`
        UPDATE dbo.users SET is_active = 0 WHERE user_id = @user_id
      `);

      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'DELETE',
        resourceType: 'users',
        resourceId: userId,
        oldValues: {
          user_id: oldRow.user_id,
          email: oldRow.email,
          role_name: oldRow.role_name,
          is_active: oldRow.is_active,
        },
        newValues: { is_active: false },
      });

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },
};
