import { getPool, sql } from '../config/db.js';

export interface AuthUserRow {
  user_id: string;
  role_id: number;
  role_name: string;
  full_name: string;
  email: string;
  password_hash: string;
  phone_number: string;
  is_active: boolean;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PasswordResetTokenRow {
  token_id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
}

export const authRepository = {
  async findUserByEmail(email: string): Promise<AuthUserRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('email', sql.NVarChar(150), email.trim().toLowerCase());
    const result = await req.query<AuthUserRow>(`
      SELECT
        u.user_id,
        u.role_id,
        r.role_name,
        u.full_name,
        u.email,
        u.password_hash,
        u.phone_number,
        u.is_active,
        u.last_login_at,
        u.created_at,
        u.updated_at
      FROM dbo.users u
      INNER JOIN dbo.roles r ON r.role_id = u.role_id
      WHERE LOWER(u.email) = @email
    `);
    return result.recordset[0] ?? null;
  },

  async findUserById(userId: string): Promise<AuthUserRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('user_id', sql.UniqueIdentifier, userId);
    const result = await req.query<AuthUserRow>(`
      SELECT
        u.user_id,
        u.role_id,
        r.role_name,
        u.full_name,
        u.email,
        u.password_hash,
        u.phone_number,
        u.is_active,
        u.last_login_at,
        u.created_at,
        u.updated_at
      FROM dbo.users u
      INNER JOIN dbo.roles r ON r.role_id = u.role_id
      WHERE u.user_id = @user_id
    `);
    return result.recordset[0] ?? null;
  },

  async findRoleIdByName(roleName: string): Promise<number | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('role_name', sql.NVarChar(30), roleName);
    const result = await req.query<{ role_id: number }>(`
      SELECT role_id FROM dbo.roles WHERE LOWER(role_name) = LOWER(@role_name)
    `);
    return result.recordset[0]?.role_id ?? null;
  },

  async createCustomer(data: {
    role_id: number;
    full_name: string;
    email: string;
    phone_number: string;
    password_hash: string;
  }): Promise<AuthUserRow> {
    const pool = await getPool();
    const req = pool.request();
    req.input('role_id', sql.Int, data.role_id);
    req.input('full_name', sql.NVarChar(100), data.full_name);
    req.input('email', sql.NVarChar(150), data.email);
    req.input('phone_number', sql.NVarChar(20), data.phone_number);
    req.input('password_hash', sql.NVarChar(255), data.password_hash);

    const inserted = await req.query<{ user_id: string }>(`
      INSERT INTO dbo.users (role_id, full_name, email, phone_number, password_hash, is_active)
      OUTPUT INSERTED.user_id
      VALUES (@role_id, @full_name, @email, @phone_number, @password_hash, 1)
    `);

    const createdId = inserted.recordset[0].user_id;
    const created = await this.findUserById(createdId);
    if (!created) {
      throw new Error('Gagal membaca data akun yang baru dibuat.');
    }
    return created;
  },

  async updateLastLogin(userId: string): Promise<void> {
    const pool = await getPool();
    const req = pool.request();
    req.input('user_id', sql.UniqueIdentifier, userId);
    await req.query(`
      UPDATE dbo.users
      SET last_login_at = SYSDATETIMEOFFSET()
      WHERE user_id = @user_id
    `);
  },

  async updateProfile(
    userId: string,
    data: { full_name: string; phone_number: string; password_hash?: string }
  ): Promise<AuthUserRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('user_id', sql.UniqueIdentifier, userId);
    req.input('full_name', sql.NVarChar(100), data.full_name);
    req.input('phone_number', sql.NVarChar(20), data.phone_number);

    if (data.password_hash) {
      req.input('password_hash', sql.NVarChar(255), data.password_hash);
      await req.query(`
        UPDATE dbo.users
        SET full_name = @full_name, phone_number = @phone_number, password_hash = @password_hash
        WHERE user_id = @user_id
      `);
    } else {
      await req.query(`
        UPDATE dbo.users
        SET full_name = @full_name, phone_number = @phone_number
        WHERE user_id = @user_id
      `);
    }

    return this.findUserById(userId);
  },

  // ==========================================================================
  // FAILED LOGIN ATTEMPTS (Lockout 3x gagal / 15 menit)
  // ==========================================================================
  async countRecentFailedLogins(email: string, windowMinutes = 15): Promise<number> {
    const pool = await getPool();
    const req = pool.request();
    req.input('email', sql.NVarChar(150), email.trim().toLowerCase());
    req.input('window_minutes', sql.Int, windowMinutes);
    const result = await req.query<{ cnt: number }>(`
      SELECT COUNT(*) AS cnt
      FROM dbo.failed_login_attempts
      WHERE LOWER(email) = @email
        AND created_at >= DATEADD(MINUTE, -@window_minutes, SYSDATETIMEOFFSET())
    `);
    return result.recordset[0]?.cnt ?? 0;
  },

  async recordFailedLogin(email: string, ipAddress: string): Promise<void> {
    const pool = await getPool();
    const req = pool.request();
    req.input('email', sql.NVarChar(150), email.trim().toLowerCase());
    req.input('ip_address', sql.VarChar(45), ipAddress.slice(0, 45));
    await req.query(`
      INSERT INTO dbo.failed_login_attempts (email, ip_address)
      VALUES (@email, @ip_address)
    `);
  },

  async clearFailedLogins(email: string): Promise<void> {
    const pool = await getPool();
    const req = pool.request();
    req.input('email', sql.NVarChar(150), email.trim().toLowerCase());
    await req.query(`
      DELETE FROM dbo.failed_login_attempts WHERE LOWER(email) = @email
    `);
  },

  // ==========================================================================
  // PASSWORD RESET TOKENS (E04–E05)
  // ==========================================================================
  async createPasswordResetToken(
    userId: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void> {
    const pool = await getPool();
    const req = pool.request();
    req.input('user_id', sql.UniqueIdentifier, userId);
    req.input('token_hash', sql.NVarChar(255), tokenHash);
    req.input('expires_at', sql.DateTimeOffset(0), expiresAt);
    await req.query(`
      INSERT INTO dbo.password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (@user_id, @token_hash, @expires_at)
    `);
  },

  async findValidResetToken(tokenHash: string): Promise<PasswordResetTokenRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('token_hash', sql.NVarChar(255), tokenHash);
    const result = await req.query<PasswordResetTokenRow>(`
      SELECT token_id, user_id, token_hash, expires_at, used_at
      FROM dbo.password_reset_tokens
      WHERE token_hash = @token_hash
        AND used_at IS NULL
        AND expires_at > SYSDATETIMEOFFSET()
    `);
    return result.recordset[0] ?? null;
  },

  async consumeResetTokenAndUpdatePassword(
    tokenId: string,
    userId: string,
    passwordHash: string
  ): Promise<void> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      const tokenReq = new sql.Request(tx);
      tokenReq.input('token_id', sql.UniqueIdentifier, tokenId);
      await tokenReq.query(`
        UPDATE dbo.password_reset_tokens
        SET used_at = SYSDATETIMEOFFSET()
        WHERE token_id = @token_id
      `);

      const userReq = new sql.Request(tx);
      userReq.input('user_id', sql.UniqueIdentifier, userId);
      userReq.input('password_hash', sql.NVarChar(255), passwordHash);
      await userReq.query(`
        UPDATE dbo.users
        SET password_hash = @password_hash
        WHERE user_id = @user_id
      `);

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },
};
