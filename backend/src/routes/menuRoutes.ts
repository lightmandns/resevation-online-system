import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import {
  getCustomerMenus,
  getPublicMenus,
  listAdminMenus,
  createMenu,
  updateMenu,
  deleteMenu,
} from '../controllers/menuController.js';

const router = Router();

// Publik (E07)
router.get('/public/menus', getPublicMenus);

// Customer & Manajer (E21)
router.get('/menus', authenticateJwt, authorizeRoles('Customer'), getCustomerMenus);

// Admin & Manajer (E34–E37)
router.get('/admin/menus', authenticateJwt, authorizeRoles('Admin'), listAdminMenus);
router.post('/admin/menus', authenticateJwt, authorizeRoles('Admin'), createMenu);
router.patch('/admin/menus/:id', authenticateJwt, authorizeRoles('Admin'), updateMenu);
router.delete('/admin/menus/:id', authenticateJwt, authorizeRoles('Admin'), deleteMenu);

export default router;
