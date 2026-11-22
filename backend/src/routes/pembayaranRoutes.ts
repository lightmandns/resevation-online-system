import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import {
  createPayment,
  getReservationPayments,
  handleMidtransCallback,
  uploadTransferProof,
  listAdminPayments,
  verifyManualPayment,
} from '../controllers/pembayaranController.js';

const router = Router();

// Customer & Manajer (E15, E16, E18)
router.post(
  '/reservations/:id/payments',
  authenticateJwt,
  authorizeRoles('Customer'),
  createPayment
);
router.get(
  '/reservations/:id/payments',
  authenticateJwt,
  authorizeRoles('Customer'),
  getReservationPayments
);
router.post(
  '/reservations/:id/payments/proof',
  authenticateJwt,
  authorizeRoles('Customer'),
  uploadTransferProof
);

// Gateway Midtrans — tanpa JWT, diverifikasi via signature_key SHA-512 (E17)
router.post('/payments/gateway/callback', handleMidtransCallback);

// Admin & Manajer (E19, E20)
router.get(
  '/admin/payments',
  authenticateJwt,
  authorizeRoles('Admin'),
  listAdminPayments
);
router.post(
  '/admin/payments/:id/verification',
  authenticateJwt,
  authorizeRoles('Admin'),
  verifyManualPayment
);

export default router;
