import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest, UserPayload } from '../types/index.js';

export const verifyToken = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      message: 'Akses ditolak. Token tidak disediakan atau format salah (Bearer <token>).'
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key') as UserPayload;
    req.user = decoded;
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      res.status(401).json({
        success: false,
        message: 'Sesi anda telah berakhir (Token expired). Silakan login kembali.'
      });
      return;
    }
    res.status(403).json({
      success: false,
      message: 'Token tidak valid atau telah dimodifikasi.'
    });
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Autentikasi diperlukan.'
      });
      return;
    }

    const userRole = (req.user.role || '').toLowerCase();
    const allowedRoles = roles.map(r => r.toLowerCase());

    if (!allowedRoles.includes(userRole)) {
      res.status(403).json({
        success: false,
        message: `Akses ditolak. Peran '${req.user.role}' tidak memiliki izin untuk tindakan ini.`
      });
      return;
    }

    next();
  };
};
