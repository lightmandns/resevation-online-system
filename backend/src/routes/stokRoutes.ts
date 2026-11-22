import { Router } from 'express';
import { authenticateJwt, authorizeRoles } from '../middleware/v1AuthMiddleware.js';
import {
  listIngredientReceipts,
  createIngredientReceipt,
  listInventoryStocks,
  updateInventoryStock,
} from '../controllers/stokController.js';

const router = Router();

// E42–E43: Bahan Masuk (Admin, Petugas Inventaris, dan Manajer otomatis lolos)
router.get(
  '/ingredient-receipts',
  authenticateJwt,
  authorizeRoles('Admin', 'Petugas Inventaris'),
  listIngredientReceipts
);
router.post(
  '/ingredient-receipts',
  authenticateJwt,
  authorizeRoles('Admin', 'Petugas Inventaris'),
  createIngredientReceipt
);

// E44–E45: Stok Gudang (Petugas Inventaris, Admin, dan Manajer otomatis lolos)
router.get(
  '/inventory/stocks',
  authenticateJwt,
  authorizeRoles('Petugas Inventaris', 'Admin'),
  listInventoryStocks
);
router.patch(
  '/inventory/stocks/:id',
  authenticateJwt,
  authorizeRoles('Petugas Inventaris', 'Admin'),
  updateInventoryStock
);

export default router;
