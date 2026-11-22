import { auditLogRepository } from '../repositories/auditLogRepository.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const parseValidDateString = (raw: unknown, field: string): string => {
  const s = String(raw ?? '').trim();
  if (!DATE_ONLY_REGEX.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) {
    throw new ServiceError(
      422,
      'ERR-VAL-02',
      'Format tanggal tidak valid (gunakan YYYY-MM-DD).',
      field
    );
  }
  return s;
};

const safeParseJson = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

export const auditLogService = {
  /**
   * E46 (securityOnly = false) & E54 (securityOnly = true)
   */
  async list(
    securityOnly: boolean,
    query: {
      resource_type?: unknown;
      action_type?: unknown;
      user_id?: unknown;
      tanggal_dari?: unknown;
      tanggal_sampai?: unknown;
      page?: unknown;
      per_page?: unknown;
    }
  ): Promise<{ items: unknown[]; meta: PaginationMeta }> {
    let tanggalDari: string | undefined;
    let tanggalSampai: string | undefined;

    if (query.tanggal_dari !== undefined && String(query.tanggal_dari).trim() !== '') {
      tanggalDari = parseValidDateString(query.tanggal_dari, 'tanggal_dari');
    }
    if (query.tanggal_sampai !== undefined && String(query.tanggal_sampai).trim() !== '') {
      tanggalSampai = parseValidDateString(query.tanggal_sampai, 'tanggal_sampai');
    }
    if (tanggalDari && tanggalSampai && tanggalSampai < tanggalDari) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Rentang tanggal tidak valid.',
        'tanggal_sampai'
      );
    }

    let userId: string | undefined;
    if (query.user_id !== undefined && String(query.user_id).trim() !== '') {
      const uid = String(query.user_id).trim();
      if (!isValidUuid(uid)) {
        throw new ServiceError(422, 'ERR-VAL-02', 'Format user_id tidak valid.', 'user_id');
      }
      userId = uid;
    }

    const resourceType =
      query.resource_type !== undefined && String(query.resource_type).trim() !== ''
        ? String(query.resource_type).trim()
        : undefined;

    const actionType =
      query.action_type !== undefined && String(query.action_type).trim() !== ''
        ? String(query.action_type).trim()
        : undefined;

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total } = await auditLogRepository.list({
      securityOnly,
      resourceType,
      actionType,
      userId,
      tanggalDari,
      tanggalSampai,
      offset,
      perPage,
    });

    const items = rows.map((row) => ({
      log_id: row.log_id,
      user_id: row.user_id,
      user_email: row.user_email,
      role: row.role_name,
      action_type: row.action_type,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      ip_address: row.ip_address,
      created_at: row.created_at,
    }));

    return {
      items,
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  },

  /**
   * E47 — Detail entri audit log (termasuk old_values & new_values JSON)
   */
  async getDetail(logId: string) {
    if (!isValidUuid(logId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const row = await auditLogRepository.findById(logId);
    if (!row) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    return {
      log_id: row.log_id,
      user_id: row.user_id,
      user_email: row.user_email,
      role: row.role_name,
      action_type: row.action_type,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      old_values: safeParseJson(row.old_values),
      new_values: safeParseJson(row.new_values),
      ip_address: row.ip_address,
      created_at: row.created_at,
    };
  },
};
