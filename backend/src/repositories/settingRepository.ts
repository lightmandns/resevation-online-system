import { getPool, sql } from '../config/db.js';
import { AuditActor, insertAuditLogInTx } from '../utils/auditHelper.js';

export interface SystemSettingRow {
  setting_key: string;
  setting_value: string;
  updated_by: string | null;
  updated_at: Date;
}

export const settingRepository = {
  async getAll(): Promise<Record<string, string>> {
    const pool = await getPool();
    const res = await pool.request().query<SystemSettingRow>(`
      SELECT setting_key, setting_value
      FROM dbo.system_settings
    `);
    const map: Record<string, string> = {};
    for (const row of res.recordset) {
      map[row.setting_key] = row.setting_value;
    }
    return map;
  },

  async updateMany(
    updates: Record<string, string>,
    oldSettings: Record<string, string>,
    userId: string,
    actor: AuditActor
  ): Promise<Record<string, string>> {
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();

    try {
      for (const [key, value] of Object.entries(updates)) {
        const req = new sql.Request(tx);
        req.input('key', sql.NVarChar(50), key);
        req.input('val', sql.NVarChar(sql.MAX), value);
        req.input('uid', sql.UniqueIdentifier, userId);

        await req.query(`
          IF EXISTS (SELECT 1 FROM dbo.system_settings WHERE setting_key = @key)
            UPDATE dbo.system_settings
            SET setting_value = @val, updated_by = @uid, updated_at = SYSDATETIMEOFFSET()
            WHERE setting_key = @key
          ELSE
            INSERT INTO dbo.system_settings (setting_key, setting_value, updated_by)
            VALUES (@key, @val, @uid)
        `);
      }

      const newSettings = { ...oldSettings, ...updates };
      await insertAuditLogInTx(tx, {
        actor,
        actionType: 'SETTING_UPDATED',
        resourceType: 'system_settings',
        resourceId: null,
        oldValues: oldSettings,
        newValues: newSettings,
      });

      await tx.commit();
      return newSettings;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  },
};
