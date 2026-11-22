import { Router } from 'express';
import { authenticateJwt } from '../middleware/v1AuthMiddleware.js';
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from '../controllers/notifikasiController.js';

const router = Router();

// Semua role terautentikasi (E51 + mark read)
router.get('/notifications', authenticateJwt, listNotifications);
router.patch('/notifications/read-all', authenticateJwt, markAllNotificationsRead);
router.patch('/notifications/:id/read', authenticateJwt, markNotificationRead);

export default router;
