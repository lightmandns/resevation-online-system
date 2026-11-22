import { Router } from 'express';
import {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
} from '../controllers/authController.js';
import { authenticateJwt } from '../middleware/v1AuthMiddleware.js';

const router = Router();

// Public auth routes (E01, E02, E04, E05)
router.post('/register', register);
router.post('/login', login);
router.post('/password/forgot', forgotPassword);
router.post('/password/reset', resetPassword);

// Protected auth routes (E03 + profil sendiri)
router.post('/logout', authenticateJwt, logout);
router.get('/me', authenticateJwt, getProfile);
router.put('/profile', authenticateJwt, updateProfile);

export default router;
