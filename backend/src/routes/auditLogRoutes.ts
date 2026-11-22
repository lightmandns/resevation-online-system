import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import {
  listAuditLogs,
  getAuditLogDetail,
  listSecurityLogs,
} from '../controllers/auditLogController.js';

const router = Router();

// Khusus Manajer, read-only (E46, E47, E54)
router.get('/audit-logs', authenticateJwt, authorizeRoles('Manajer'), listAuditLogs);
router.get('/audit-logs/:id', authenticateJwt, authorizeRoles('Manajer'), getAuditLogDetail);
router.get('/security-logs', authenticateJwt, authorizeRoles('Manajer'), listSecurityLogs);

export default router;
