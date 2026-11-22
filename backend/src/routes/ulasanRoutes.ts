import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import {
  checkReviewEligibility,
  submitReview,
  listManagerReviews,
} from '../controllers/ulasanController.js';

const router = Router();

// Customer & Manajer (E24, E25)
router.get(
  '/reservations/:id/review-eligibility',
  authenticateJwt,
  authorizeRoles('Customer'),
  checkReviewEligibility
);
router.post(
  '/reservations/:id/reviews',
  authenticateJwt,
  authorizeRoles('Customer'),
  submitReview
);

// Khusus Manajer (E50)
router.get(
  '/manager/reviews',
  authenticateJwt,
  authorizeRoles('Manajer'),
  listManagerReviews
);

export default router;
