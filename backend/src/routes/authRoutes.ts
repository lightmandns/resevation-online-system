import { Router } from 'express';
import { register, login, logout, getProfile, updateProfile } from '../controllers/authController.js';
import { verifyToken } from '../middleware/authMiddleware.js';

const router = Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);

// Protected routes
router.get('/me', verifyToken, getProfile);
router.put('/profile', verifyToken, updateProfile);

export default router;
