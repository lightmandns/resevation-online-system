import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { sendError } from '../utils/apiResponse.js';
import { getClientIp } from '../utils/errors.js';
import { recordSecurityAudit } from '../utils/auditHelper.js';
import { isTokenBlacklisted } from '../utils/tokenBlacklist.js';

export interface V1UserPayload {
  user_id: string;
  email: string;
  full_name?: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface V1AuthRequest extends Request {
  v1User?: V1UserPayload;
}

/**
 * Middleware autentikasi JWT untuk seluruh endpoint /api/v1/* (AC-04).
 */
export const authenticateJwt = (
  req: V1AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token || isTokenBlacklisted(token)) {
    sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
    return;
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'default_secret_key'
    ) as Record<string, unknown>;

    const userId = String(decoded.user_id ?? decoded.userId ?? '');
    const email = String(decoded.email ?? '');
    const role = String(decoded.role ?? '');

    if (!userId || !role) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    req.v1User = {
      user_id: userId,
      email,
      full_name: decoded.full_name
        ? String(decoded.full_name)
        : decoded.fullName
          ? String(decoded.fullName)
          : undefined,
      role,
      iat: typeof decoded.iat === 'number' ? decoded.iat : undefined,
      exp: typeof decoded.exp === 'number' ? decoded.exp : undefined,
    };

    next();
  } catch {
    sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
  }
};

/**
 * Middleware otorisasi RBAC untuk endpoint /api/v1/* (AC-07).
 * Sesuai TSD v1.2: Manajer berperan sebagai Super Admin (lolos di semua endpoint terautentikasi).
 */
export const authorizeRoles = (...allowedRoles: string[]) => {
  const normalizedAllowed = allowedRoles.map((r) => r.toLowerCase());

  return (req: V1AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.v1User) {
      sendError(res, 401, 'Silakan login untuk melanjutkan.', [{ code: 'ERR-AUTH-01' }]);
      return;
    }

    const userRole = req.v1User.role.toLowerCase();

    // Manajer = Super Admin (TSD 3.1.1 & AC-07)
    if (userRole === 'manajer' || normalizedAllowed.includes(userRole)) {
      next();
      return;
    }

    // Catat ACCESS_DENIED ke audit_log secara async
    void recordSecurityAudit({
      actor: {
        userId: req.v1User.user_id,
        userEmail: req.v1User.email,
        ipAddress: getClientIp(req),
      },
      actionType: 'ACCESS_DENIED',
      resourceType: 'endpoint',
      newValues: {
        method: req.method,
        path: req.originalUrl,
        role: req.v1User.role,
        required_roles: allowedRoles,
      },
    });

    sendError(res, 403, 'Anda tidak memiliki izin untuk mengakses fitur ini', [
      { code: 'ERR-AUTH-03' },
    ]);
  };
};
