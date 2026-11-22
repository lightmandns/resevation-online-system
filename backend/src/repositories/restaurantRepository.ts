import { getPool } from '../config/db.js';

export const restaurantRepository = {
  async getPublicSettings(): Promise<Record<string, string>> {
    const pool = await getPool();
    const result = await pool.request().query<{
      setting_key: string;
      setting_value: string;
    }>(`
      SELECT setting_key, setting_value
      FROM dbo.system_settings
      WHERE setting_key IN (N'jam_buka', N'jam_tutup', N'whatsapp_admin')
    `);

    const settings: Record<string, string> = {};
    for (const row of result.recordset) {
      settings[row.setting_key] = row.setting_value;
    }
    return settings;
  },
};
