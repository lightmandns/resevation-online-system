import { Router } from 'express';
import { getPublicRestaurantInfo } from '../controllers/restaurantController.js';

const router = Router();

// E06 — Informasi publik restoran
router.get('/public/restaurant', getPublicRestaurantInfo);

export default router;
