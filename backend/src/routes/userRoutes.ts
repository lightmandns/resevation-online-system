import { Router } from 'express';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
} from '../controllers/userController.js';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';

const router = Router();

// Seluruh pengelolaan akun pengguna hanya untuk Manajer
router.use(authenticateJwt, authorizeRoles('Manajer'));

router.get('/', getAllUsers);
router.get('/:id', getUserById);
router.post('/', createUser);
router.patch('/:id', updateUser);
router.delete('/:id', deleteUser);

export default router;
