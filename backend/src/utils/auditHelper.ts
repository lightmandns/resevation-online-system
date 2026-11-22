import { getPool, sql } from '../config/db.js';
import { isValidUuid } from './errors.js';

export interface AuditActor {
  userId?: string | null;
  userEmail?: string | null;
  ipAddress?: string | null;
}

export interface AuditLogInput {
  actor: AuditActor;
  actionType:
    | 'INSERT'
    | 'UPDATE'
    | 'DELETE'
    | 'LOGIN_SUCCESS'
    | 'LOGIN_FAILED'
    | 'LOGOUT'
    | 'ACCESS_DENIED'
    | 'PAYMENT_VERIFIED'
    | 'SETTING_UPDATED';
  resourceType?: string | null;
  resourceId?: string | null;
  oldValues?: unknown;
  newValues?: unknown;
}

/**
 * Mencatat audit log di dalam transaksi SQL yang sama (atomik).
 * Jika pencatatan gagal, transaksi pemanggil harus di-rollback (ERR-AUD-01).
 */
export const insertAuditLogInTx = async (
  tx: sql.Transaction,
  input: AuditLogInput
): Promise<void> => {
  const req = new sql.Request(tx);
  const validUserId = isValidUuid(input.actor.userId) ? input.actor.userId : null;
  const validResourceId = isValidUuid(input.resourceId) ? input.resourceId : null;

  req.input('user_id', sql.UniqueIdentifier, validUserId);
  req.input('user_email', sql.NVarChar(150), (input.actor.userEmail || 'system').slice(0, 150));
  req.input('action_type', sql.NVarChar(50), input.actionType);
  req.input('resource_type', sql.NVarChar(50), input.resourceType || null);
  req.input('resource_id', sql.UniqueIdentifier, validResourceId);
  req.input(
    'old_values',
    sql.NVarChar(sql.MAX),
    input.oldValues !== undefined && input.oldValues !== null
      ? JSON.stringify(input.oldValues)
      : null
  );
  req.input(
    'new_values',
    sql.NVarChar(sql.MAX),
    input.newValues !== undefined && input.newValues !== null
      ? JSON.stringify(input.newValues)
      : null
  );
  req.input('ip_address', sql.VarChar(45), (input.actor.ipAddress || '0.0.0.0').slice(0, 45));

  await req.query(`
    INSERT INTO dbo.audit_log (
      user_id, user_email, action_type, resource_type, resource_id,
      old_values, new_values, ip_address
    )
    VALUES (
      @user_id, @user_email, @action_type, @resource_type, @resource_id,
      @old_values, @new_values, @ip_address
    )
  `);
};

/**
 * Mencatat event keamanan (seperti ACCESS_DENIED) secara standalone (best-effort).
 */
export const recordSecurityAudit = async (input: AuditLogInput): Promise<void> => {
  try {
    const pool = await getPool();
    const req = pool.request();
    const validUserId = isValidUuid(input.actor.userId) ? input.actor.userId : null;
    const validResourceId = isValidUuid(input.resourceId) ? input.resourceId : null;

    req.input('user_id', sql.UniqueIdentifier, validUserId);
    req.input('user_email', sql.NVarChar(150), (input.actor.userEmail || 'anonymous').slice(0, 150));
    req.input('action_type', sql.NVarChar(50), input.actionType);
    req.input('resource_type', sql.NVarChar(50), input.resourceType || null);
    req.input('resource_id', sql.UniqueIdentifier, validResourceId);
    req.input(
      'old_values',
      sql.NVarChar(sql.MAX),
      input.oldValues !== undefined && input.oldValues !== null
        ? JSON.stringify(input.oldValues)
        : null
    );
    req.input(
      'new_values',
      sql.NVarChar(sql.MAX),
      input.newValues !== undefined && input.newValues !== null
        ? JSON.stringify(input.newValues)
        : null
    );
    req.input('ip_address', sql.VarChar(45), (input.actor.ipAddress || '0.0.0.0').slice(0, 45));

    await req.query(`
      INSERT INTO dbo.audit_log (
        user_id, user_email, action_type, resource_type, resource_id,
        old_values, new_values, ip_address
      )
      VALUES (
        @user_id, @user_email, @action_type, @resource_type, @resource_id,
        @old_values, @new_values, @ip_address
      )
    `);
  } catch (err) {
    console.error('[Security Audit Error]', err);
  }
};
