import { Request } from 'express';

export interface User {
  userId: number;
  fullName: string;
  email: string;
  phoneNumber?: string | null;
  passwordHash?: string;
  role: string;
  isActive: boolean;
  lastLogin?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface UserPayload {
  userId: number;
  email: string;
  fullName: string;
  role: string;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  user?: UserPayload;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  count?: number;
}
