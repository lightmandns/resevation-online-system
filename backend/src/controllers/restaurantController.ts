import { Request, Response } from 'express';
import { restaurantService } from '../services/restaurantService.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';

export const getPublicRestaurantInfo = async (
  req: Request,
  res: Response
): Promise<void> => {
  // #swagger.tags = ['Restaurant']
  // #swagger.summary = 'E06: Ambil profil, lokasi, fasilitas, FAQ, kontak, dan jam operasional restoran'
  try {
    const data = await restaurantService.getPublicInfo();
    sendSuccess(res, data, 'Informasi restoran berhasil diambil.');
  } catch (error) {
    console.error('[E06 getPublicRestaurantInfo Error]', error);
    sendError(
      res,
      503,
      'Layanan sedang mengalami gangguan. Silakan coba kembali.',
      [{ code: 'ERR-SYS-01' }]
    );
  }
};
