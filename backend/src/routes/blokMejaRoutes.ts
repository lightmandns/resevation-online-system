import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import {
  getBlocksAvailability,
  listAdminBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
} from '../controllers/blokMejaController.js';

const router = Router();

// Customer & Manajer (E10)
router.get(
  '/blocks/availability',
  authenticateJwt,
  authorizeRoles('Customer', 'Admin'),
  getBlocksAvailability
);

// Admin & Manajer (E30–E33)
router.get('/admin/blocks', authenticateJwt, authorizeRoles('Admin'), listAdminBlocks);
router.post('/admin/blocks', authenticateJwt, authorizeRoles('Admin'), createBlock);
router.patch('/admin/blocks/:id', authenticateJwt, authorizeRoles('Admin'), updateBlock);
router.delete('/admin/blocks/:id', authenticateJwt, authorizeRoles('Admin'), deleteBlock);

export default router;
