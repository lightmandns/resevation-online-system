import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import {
  getServiceOptions,
  createRegularReservation,
  listMyReservations,
  getMyReservationDetail,
  getReservationReceipt,
  listAdminActiveReservations,
  listAdminReservationHistory,
  getAdminReservationDetail,
  createSpecialReservation,
} from '../controllers/reservasiController.js';

const router = Router();

// Customer & Manajer (E09, E11–E14)
router.get(
  '/reservations/service-options',
  authenticateJwt,
  authorizeRoles('Customer'),
  getServiceOptions
);
router.post(
  '/reservations',
  authenticateJwt,
  authorizeRoles('Customer'),
  createRegularReservation
);
router.get(
  '/reservations',
  authenticateJwt,
  authorizeRoles('Customer'),
  listMyReservations
);
router.get(
  '/reservations/:id/receipt',
  authenticateJwt,
  authorizeRoles('Customer'),
  getReservationReceipt
);
router.get(
  '/reservations/:id',
  authenticateJwt,
  authorizeRoles('Customer'),
  getMyReservationDetail
);

// Admin & Manajer (E26–E29)
router.get(
  '/admin/reservations/history',
  authenticateJwt,
  authorizeRoles('Admin'),
  listAdminReservationHistory
);
router.post(
  '/admin/reservations/special',
  authenticateJwt,
  authorizeRoles('Admin'),
  createSpecialReservation
);
router.get(
  '/admin/reservations',
  authenticateJwt,
  authorizeRoles('Admin'),
  listAdminActiveReservations
);
router.get(
  '/admin/reservations/:id',
  authenticateJwt,
  authorizeRoles('Admin'),
  getAdminReservationDetail
);

export default router;
