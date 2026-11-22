import { notifikasiRepository } from '../repositories/notifikasiRepository.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

export const notifikasiService = {
  /**
   * E51 — GET /api/v1/notifications
   */
  async listMyNotifications(
    userId: string,
    query: { belum_dibaca?: unknown; page?: unknown; per_page?: unknown }
  ): Promise<{ items: unknown[]; meta: PaginationMeta }> {
    const unreadOnly =
      String(query.belum_dibaca ?? '').trim().toLowerCase() === 'true' ||
      String(query.belum_dibaca ?? '').trim() === '1';

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total } = await notifikasiRepository.listByUser({
      userId,
      unreadOnly,
      offset,
      perPage,
    });

    const items = rows.map((row) => ({
      id: row.notif_id,
      judul: row.judul,
      pesan: row.isi,
      dibaca: Boolean(row.is_read),
      waktu: row.created_at,
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

  async markAsRead(notifId: string, userId: string) {
    if (!isValidUuid(notifId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const updated = await notifikasiRepository.markAsRead(notifId, userId);
    if (!updated) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    return {
      id: updated.notif_id,
      dibaca: Boolean(updated.is_read),
    };
  },

  async markAllAsRead(userId: string) {
    const updatedCount = await notifikasiRepository.markAllAsRead(userId);
    return { jumlah_diperbarui: updatedCount };
  },
};
