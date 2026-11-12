import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { userRepository } from '../repositories/userRepository.js';
import { AuthRequest, User } from '../types/index.js';

export const getAllUsers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, role, status } = req.query;

    let isActive: boolean | undefined = undefined;
    if (status === 'active') isActive = true;
    if (status === 'inactive') isActive = false;

    // Menggunakan Drizzle ORM Repository
    const userList = await userRepository.findAll({
      search: search as string,
      role: role as string,
      isActive,
    });

    res.json({
      success: true,
      count: userList.length,
      data: userList as User[],
    });
  } catch (error: any) {
    console.error('Error getAllUsers (Drizzle):', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data user: ' + error.message,
    });
  }
};

export const getUserById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      res.status(400).json({ success: false, message: 'ID pengguna tidak valid.' });
      return;
    }

    // Menggunakan Drizzle ORM Repository
    const user = await userRepository.findById(userId);

    if (!user) {
      res.status(404).json({
        success: false,
        message: `Pengguna dengan ID ${id} tidak ditemukan.`,
      });
      return;
    }

    res.json({
      success: true,
      data: user as User,
    });
  } catch (error: any) {
    console.error('Error getUserById (Drizzle):', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data user: ' + error.message,
    });
  }
};

export const createUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { fullName, email, phoneNumber, password, role, isActive } = req.body;

    if (!fullName || !email || !password) {
      res.status(400).json({
        success: false,
        message: 'FullName, email, dan password wajib diisi.',
      });
      return;
    }

    // Cek duplikasi email via Drizzle
    const existingUser = await userRepository.findByEmail(email);
    if (existingUser) {
      res.status(409).json({
        success: false,
        message: 'Email sudah terdaftar.',
      });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create via Drizzle
    const newUser = await userRepository.create({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phoneNumber: phoneNumber ? phoneNumber.trim() : null,
      passwordHash,
      role: role || 'Customer',
      isActive: isActive !== undefined ? isActive : true,
    });

    res.status(201).json({
      success: true,
      message: 'User berhasil dibuat.',
      data: newUser as User,
    });
  } catch (error: any) {
    console.error('Error createUser (Drizzle):', error);
    res.status(500).json({
      success: false,
      message: 'Gagal membuat user: ' + error.message,
    });
  }
};

export const updateUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = parseInt(id, 10);
    const { fullName, email, phoneNumber, password, role, isActive } = req.body;

    if (isNaN(userId)) {
      res.status(400).json({ success: false, message: 'ID pengguna tidak valid.' });
      return;
    }

    const existingUser = await userRepository.findById(userId);
    if (!existingUser) {
      res.status(404).json({
        success: false,
        message: `Pengguna dengan ID ${id} tidak ditemukan.`,
      });
      return;
    }

    if (email && email.toLowerCase() !== existingUser.email.toLowerCase()) {
      const emailConflict = await userRepository.findByEmail(email);
      if (emailConflict && emailConflict.userId !== userId) {
        res.status(409).json({
          success: false,
          message: 'Email sudah digunakan oleh akun lain.',
        });
        return;
      }
    }

    const updatePayload: {
      fullName?: string;
      email?: string;
      phoneNumber?: string | null;
      passwordHash?: string;
      role?: string;
      isActive?: boolean;
    } = {};

    if (fullName) updatePayload.fullName = fullName.trim();
    if (email) updatePayload.email = email.trim().toLowerCase();
    if (phoneNumber !== undefined) updatePayload.phoneNumber = phoneNumber ? phoneNumber.trim() : null;
    if (role) updatePayload.role = role;
    if (isActive !== undefined) updatePayload.isActive = isActive;

    if (password) {
      const salt = await bcrypt.genSalt(10);
      updatePayload.passwordHash = await bcrypt.hash(password, salt);
    }

    // Update via Drizzle
    const updatedUser = await userRepository.update(userId, updatePayload);

    res.json({
      success: true,
      message: 'User berhasil diperbarui.',
      data: updatedUser as User,
    });
  } catch (error: any) {
    console.error('Error updateUser (Drizzle):', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui user: ' + error.message,
    });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const userId = parseInt(id, 10);

    if (isNaN(userId)) {
      res.status(400).json({ success: false, message: 'ID pengguna tidak valid.' });
      return;
    }

    // Delete via Drizzle
    const deletedUser = await userRepository.delete(userId);

    if (!deletedUser) {
      res.status(404).json({
        success: false,
        message: `Pengguna dengan ID ${id} tidak ditemukan.`,
      });
      return;
    }

    res.json({
      success: true,
      message: `User '${deletedUser.fullName}' berhasil dihapus.`,
    });
  } catch (error: any) {
    console.error('Error deleteUser (Drizzle):', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menghapus user: ' + error.message,
    });
  }
};
