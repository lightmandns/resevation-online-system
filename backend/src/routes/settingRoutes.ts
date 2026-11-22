import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import { getSettings, updateSettings } from '../controllers/settingController.js';

const router = Router();

// Khusus Manajer (E52, E53)
router.get('/settings', authenticateJwt, authorizeRoles('Manajer'), getSettings);
router.patch('/settings', authenticateJwt, authorizeRoles('Manajer'), updateSettings);

export default router;
