import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import {
  createReservationOrders,
  getReservationOrders,
  listAdminMenuRequests,
  decideMenuRequest,
} from '../controllers/pesananController.js';

const router = Router();

// Customer & Manajer (E22, E23)
router.post(
  '/reservations/:id/orders',
  authenticateJwt,
  authorizeRoles('Customer'),
  createReservationOrders
);
router.get(
  '/reservations/:id/orders',
  authenticateJwt,
  authorizeRoles('Customer'),
  getReservationOrders
);

// Admin & Manajer (E55, E56)
router.get(
  '/admin/menu-requests',
  authenticateJwt,
  authorizeRoles('Admin'),
  listAdminMenuRequests
);
router.patch(
  '/admin/menu-requests/:id/decision',
  authenticateJwt,
  authorizeRoles('Admin'),
  decideMenuRequest
);

export default router;
