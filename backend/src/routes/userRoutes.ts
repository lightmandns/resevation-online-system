import { Router } from 'express';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser
} from '../controllers/userController.js';
import { verifyToken, requireRole } from '../middleware/authMiddleware.js';

const router = Router();

// Semua rute pengelolaan pengguna mewajibkan token autentikasi
router.use(verifyToken);

/**
 * Hak Akses Khusus:
 * - GET /api/users & GET /api/users/:id: Hanya dapat dilihat oleh Manajer (data sensitif user)
 * - POST /api/users (Buat user/staff): Eksklusif Manajer
 * - PUT /api/users/:id (Update data/role/status user): Eksklusif Manajer
 * - DELETE /api/users/:id (Hapus user): Eksklusif Manajer
 */
router.get('/', requireRole('Manajer'), getAllUsers);
router.get('/:id', requireRole('Manajer'), getUserById);
router.post('/', requireRole('Manajer'), createUser);
router.put('/:id', requireRole('Manajer'), updateUser);
router.delete('/:id', requireRole('Manajer'), deleteUser);

export default router;
