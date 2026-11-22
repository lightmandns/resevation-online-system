import { settingRepository } from '../repositories/settingRepository.js';
import { AuditActor } from '../utils/auditHelper.js';
import { ServiceError } from '../utils/errors.js';

const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

const formatSettings = (map: Record<string, string>) => ({
  min_porsi_request: Number.parseInt(map.min_porsi_request || '20', 10),
  batas_waktu_dp_menit: Number.parseInt(map.batas_waktu_dp_menit || '10', 10),
  batas_waktu_pelunasan_menit: Number.parseInt(map.batas_waktu_pelunasan_menit || '10', 10),
  durasi_slot_jam: Number.parseInt(map.durasi_slot_jam || '3', 10),
  batas_submit_menu_hari: Number.parseInt(map.batas_submit_menu_hari || '1', 10),
  jam_operasional: {
    buka: map.jam_buka || '10:00',
    tutup: map.jam_tutup || '22:00',
  },
  whatsapp_admin: map.whatsapp_admin || '6281234567890',
});

export const settingService = {
  /**
   * E52 — GET /api/v1/settings
   */
  async getSettings() {
    const map = await settingRepository.getAll();
    return formatSettings(map);
  },

  /**
   * E53 — PATCH /api/v1/settings
   */
  async updateSettings(
    body: Record<string, unknown>,
    userId: string,
    actor: AuditActor
  ) {
    const current = await settingRepository.getAll();
    const updates: Record<string, string> = {};

    const parsePositiveInt = (val: unknown, field: string, min = 1): string => {
      const n = Number(val);
      if (!Number.isInteger(n) || n < min) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          `Nilai ${field} harus bilangan bulat minimal ${min}.`,
          field
        );
      }
      return String(n);
    };

    if (body.min_porsi_request !== undefined) {
      updates.min_porsi_request = parsePositiveInt(body.min_porsi_request, 'min_porsi_request', 1);
    }
    if (body.batas_waktu_dp_menit !== undefined) {
      updates.batas_waktu_dp_menit = parsePositiveInt(
        body.batas_waktu_dp_menit,
        'batas_waktu_dp_menit',
        1
      );
    }
    if (body.batas_waktu_pelunasan_menit !== undefined) {
      updates.batas_waktu_pelunasan_menit = parsePositiveInt(
        body.batas_waktu_pelunasan_menit,
        'batas_waktu_pelunasan_menit',
        1
      );
    }
    if (body.durasi_slot_jam !== undefined) {
      updates.durasi_slot_jam = parsePositiveInt(body.durasi_slot_jam, 'durasi_slot_jam', 1);
    }
    if (body.batas_submit_menu_hari !== undefined) {
      updates.batas_submit_menu_hari = parsePositiveInt(
        body.batas_submit_menu_hari,
        'batas_submit_menu_hari',
        0
      );
    }

    const jamOp = body.jam_operasional as Record<string, unknown> | undefined;
    const rawBuka = body.jam_buka ?? jamOp?.buka;
    const rawTutup = body.jam_tutup ?? jamOp?.tutup;

    if (rawBuka !== undefined) {
      const s = String(rawBuka).trim();
      if (!HHMM_REGEX.test(s)) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Format jam buka harus HH:MM (00:00 - 23:59).',
          'jam_buka'
        );
      }
      updates.jam_buka = s;
    }

    if (rawTutup !== undefined) {
      const s = String(rawTutup).trim();
      if (!HHMM_REGEX.test(s)) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Format jam tutup harus HH:MM (00:00 - 23:59).',
          'jam_tutup'
        );
      }
      updates.jam_tutup = s;
    }

    const finalBuka = updates.jam_buka ?? current.jam_buka ?? '10:00';
    const finalTutup = updates.jam_tutup ?? current.jam_tutup ?? '22:00';
    if (finalTutup <= finalBuka) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Jam tutup harus lebih besar dari jam buka.',
        'jam_tutup'
      );
    }

    if (body.whatsapp_admin !== undefined) {
      let wa = String(body.whatsapp_admin).replace(/[\s\-()]/g, '').trim();
      if (wa.startsWith('+')) wa = wa.slice(1);
      if (wa.startsWith('0')) wa = `62${wa.slice(1)}`;
      if (!/^62\d{8,13}$/.test(wa)) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Format nomor WhatsApp Admin tidak valid (10-15 digit, diawali 62).',
          'whatsapp_admin'
        );
      }
      updates.whatsapp_admin = wa;
    }

    if (Object.keys(updates).length === 0) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Tidak ada pengaturan yang dikirim untuk diperbarui.'
      );
    }

    const updatedMap = await settingRepository.updateMany(updates, current, userId, actor);
    return formatSettings(updatedMap);
  },
};
