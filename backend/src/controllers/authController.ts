import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { userRepository } from '../repositories/userRepository.js';
import { AuthRequest } from '../types/index.js';

const generateToken = (user: { userId: number; email: string; fullName: string; role: string }) => {
  return jwt.sign(
    {
      userId: user.userId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    },
    process.env.JWT_SECRET || 'default_secret_key',
    {
      expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    } as jwt.SignOptions
  );
};

export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { fullName, email, phoneNumber, password, role } = req.body;

    if (!fullName || !email || !password) {
      res.status(400).json({
        success: false,
        message: 'Nama lengkap (fullName), email, dan password wajib diisi.',
      });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password minimal harus 6 karakter.',
      });
      return;
    }

    // Menggunakan Drizzle ORM Repository
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      res.status(409).json({
        success: false,
        message: 'Email sudah terdaftar. Silakan gunakan email lain atau login.',
      });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const assignedRole = role || 'Customer';

    const newUser = await userRepository.create({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phoneNumber: phoneNumber ? phoneNumber.trim() : null,
      passwordHash,
      role: assignedRole,
      isActive: true,
    });

    if (!newUser) {
      res.status(500).json({
        success: false,
        message: 'Gagal membuat user baru.',
      });
      return;
    }

    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      message: 'Registrasi berhasil!',
      data: {
        user: newUser,
        token,
      },
    });
  } catch (error: any) {
    console.error('Error saat registrasi (Drizzle):', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server saat registrasi: ' + error.message,
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: 'Email dan password wajib diisi.',
      });
      return;
    }

    // Menggunakan Drizzle ORM Repository
    const user = await userRepository.findByEmail(email);
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Email atau password salah.',
      });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({
        success: false,
        message: 'Akun Anda dinonaktifkan. Silakan hubungi administrator.',
      });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      res.status(401).json({
        success: false,
        message: 'Email atau password salah.',
      });
      return;
    }

    // Update LastLogin dengan Drizzle
    await userRepository.updateLastLogin(user.userId);

    const token = generateToken(user);
    const { passwordHash: _, ...userData } = user;

    res.json({
      success: true,
      message: 'Login berhasil!',
      data: {
        user: userData,
        token,
      },
    });
  } catch (error: any) {
    console.error('Error saat login (Drizzle):', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server saat login: ' + error.message,
    });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({
      success: true,
      message: 'Logout berhasil. Sesi telah diakhiri.',
    });
  } catch (error: any) {
    console.error('Error logout:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal melakukan logout: ' + error.message,
    });
  }
};

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
      return;
    }

    // Menggunakan Drizzle ORM Repository
    const user = await userRepository.findById(req.user.userId);
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan.',
      });
      return;
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error: any) {
    console.error('Error getProfile (Drizzle):', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil profil: ' + error.message,
    });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Autentikasi diperlukan.' });
      return;
    }

    const { fullName, phoneNumber, password, currentPassword } = req.body;

    const user = await userRepository.findByIdWithPassword(req.user.userId);
    if (!user) {
      res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan.',
      });
      return;
    }

    const updatePayload: {
      fullName?: string;
      phoneNumber?: string | null;
      passwordHash?: string;
    } = {
      fullName: fullName || user.fullName,
      phoneNumber: phoneNumber !== undefined ? phoneNumber : user.phoneNumber,
    };

    if (password) {
      if (!currentPassword) {
        res.status(400).json({
          success: false,
          message: 'Password saat ini diperlukan untuk mengganti password baru.',
        });
        return;
      }

      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        res.status(400).json({
          success: false,
          message: 'Password saat ini salah.',
        });
        return;
      }

      const salt = await bcrypt.genSalt(10);
      updatePayload.passwordHash = await bcrypt.hash(password, salt);
    }

    // Menggunakan Drizzle ORM Repository
    const updatedUser = await userRepository.update(req.user.userId, updatePayload);

    res.json({
      success: true,
      message: 'Profil berhasil diperbarui.',
      data: updatedUser,
    });
  } catch (error: any) {
    console.error('Error updateProfile (Drizzle):', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui profil: ' + error.message,
    });
  }
};
