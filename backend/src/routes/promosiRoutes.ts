import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import {
  getPublicPromotions,
  listAdminPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
} from '../controllers/promosiController.js';

const router = Router();

// Publik (E08)
router.get('/public/promotions', getPublicPromotions);

// Admin & Manajer (E38–E41)
router.get('/admin/promotions', authenticateJwt, authorizeRoles('Admin'), listAdminPromotions);
router.post('/admin/promotions', authenticateJwt, authorizeRoles('Admin'), createPromotion);
router.patch('/admin/promotions/:id', authenticateJwt, authorizeRoles('Admin'), updatePromotion);
router.delete('/admin/promotions/:id', authenticateJwt, authorizeRoles('Admin'), deletePromotion);

export default router;
