import { getPool, sql } from '../config/db.js';

export interface AuditLogRow {
  log_id: string;
  user_id: string | null;
  user_email: string;
  role_name: string | null;
  action_type: string;
  resource_type: string | null;
  resource_id: string | null;
  old_values: string | null;
  new_values: string | null;
  ip_address: string;
  created_at: Date;
}

const SECURITY_ACTION_TYPES = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILED',
  'LOGOUT',
  'ACCESS_DENIED',
  'PAYMENT_VERIFIED',
  'SETTING_UPDATED',
];

export const auditLogRepository = {
  async list(filter: {
    securityOnly: boolean;
    resourceType?: string;
    actionType?: string;
    userId?: string;
    tanggalDari?: string;
    tanggalSampai?: string;
    offset: number;
    perPage: number;
  }): Promise<{ rows: AuditLogRow[]; total: number }> {
    const pool = await getPool();
    const conditions: string[] = [];
    const countReq = pool.request();
    const dataReq = pool.request();

    if (filter.securityOnly) {
      const inList = SECURITY_ACTION_TYPES.map((t) => `N'${t}'`).join(', ');
      conditions.push(`a.action_type IN (${inList})`);
    } else {
      conditions.push("a.action_type IN (N'INSERT', N'UPDATE', N'DELETE', N'PAYMENT_VERIFIED', N'SETTING_UPDATED')");
    }

    if (filter.resourceType) {
      conditions.push('LOWER(a.resource_type) = LOWER(@resource_type)');
      countReq.input('resource_type', sql.NVarChar(50), filter.resourceType);
      dataReq.input('resource_type', sql.NVarChar(50), filter.resourceType);
    }

    if (filter.actionType) {
      conditions.push('UPPER(a.action_type) = UPPER(@action_type)');
      countReq.input('action_type', sql.NVarChar(50), filter.actionType);
      dataReq.input('action_type', sql.NVarChar(50), filter.actionType);
    }

    if (filter.userId) {
      conditions.push('a.user_id = @user_id');
      countReq.input('user_id', sql.UniqueIdentifier, filter.userId);
      dataReq.input('user_id', sql.UniqueIdentifier, filter.userId);
    }

    if (filter.tanggalDari) {
      conditions.push('CAST(a.created_at AS DATE) >= @tanggal_dari');
      countReq.input('tanggal_dari', sql.Date, filter.tanggalDari);
      dataReq.input('tanggal_dari', sql.Date, filter.tanggalDari);
    }

    if (filter.tanggalSampai) {
      conditions.push('CAST(a.created_at AS DATE) <= @tanggal_sampai');
      countReq.input('tanggal_sampai', sql.Date, filter.tanggalSampai);
      dataReq.input('tanggal_sampai', sql.Date, filter.tanggalSampai);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const countRes = await countReq.query<{ total: number }>(`
      SELECT COUNT(*) AS total FROM dbo.audit_log a ${whereClause}
    `);
    const total = countRes.recordset[0]?.total ?? 0;

    dataReq.input('offset', sql.Int, filter.offset);
    dataReq.input('perPage', sql.Int, filter.perPage);

    const dataRes = await dataReq.query<AuditLogRow>(`
      SELECT
        a.log_id,
        a.user_id,
        a.user_email,
        r.role_name,
        a.action_type,
        a.resource_type,
        a.resource_id,
        a.ip_address,
        a.created_at
      FROM dbo.audit_log a
      LEFT JOIN dbo.users u ON u.user_id = a.user_id
      LEFT JOIN dbo.roles r ON r.role_id = u.role_id
      ${whereClause}
      ORDER BY a.created_at DESC
      OFFSET @offset ROWS FETCH NEXT @perPage ROWS ONLY
    `);

    return { rows: dataRes.recordset, total };
  },

  async findById(logId: string): Promise<AuditLogRow | null> {
    const pool = await getPool();
    const req = pool.request();
    req.input('log_id', sql.UniqueIdentifier, logId);
    const res = await req.query<AuditLogRow>(`
      SELECT
        a.log_id,
        a.user_id,
        a.user_email,
        r.role_name,
        a.action_type,
        a.resource_type,
        a.resource_id,
        a.old_values,
        a.new_values,
        a.ip_address,
        a.created_at
      FROM dbo.audit_log a
      LEFT JOIN dbo.users u ON u.user_id = a.user_id
      LEFT JOIN dbo.roles r ON r.role_id = u.role_id
      WHERE a.log_id = @log_id
    `);
    return res.recordset[0] ?? null;
  },
};
