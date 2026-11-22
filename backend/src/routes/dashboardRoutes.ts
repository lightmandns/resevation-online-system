import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import { getManagerDashboard } from '../controllers/dashboardController.js';

const router = Router();

// Khusus Manajer (E49)
router.get('/manager/dashboard', authenticateJwt, authorizeRoles('Manajer'), getManagerDashboard);

export default router;
