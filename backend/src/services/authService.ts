import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { authRepository, AuthUserRow } from '../repositories/authRepository.js';
import { recordSecurityAudit } from '../utils/auditHelper.js';
import { blacklistToken } from '../utils/tokenBlacklist.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ\s]+$/;
const BCRYPT_COST = 12;

const validatePasswordStrength = (password: string, field = 'password'): void => {
  if (
    typeof password !== 'string' ||
    password.length < 8 ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    throw new ServiceError(
      422,
      'ERR-VAL-02',
      'Password minimal 8 karakter dengan minimal 1 huruf kapital dan 1 angka.',
      field
    );
  }
};

const normalizeWhatsApp = (raw: unknown): string => {
  const cleaned = String(raw ?? '').replace(/[\s\-()]/g, '').trim();
  if (!cleaned) {
    throw new ServiceError(
      422,
      'ERR-VAL-02',
      'Masukkan nomor WhatsApp yang valid.',
      'no_whatsapp'
    );
  }

  let normalized = cleaned;
  if (normalized.startsWith('+')) {
    normalized = normalized.slice(1);
  }
  if (normalized.startsWith('0')) {
    normalized = `62${normalized.slice(1)}`;
  }

  if (!/^62\d{8,13}$/.test(normalized)) {
    throw new ServiceError(
      422,
      'ERR-VAL-02',
      'Masukkan nomor WhatsApp yang valid (10-15 digit, diawali 62).',
      'no_whatsapp'
    );
  }

  return normalized;
};

const getRedirectByRole = (role: string): string => {
  switch (role.toLowerCase()) {
    case 'admin':
      return '/admin/dashboard';
    case 'manajer':
      return '/manajer/dashboard';
    case 'petugas inventaris':
      return '/inventaris/stok';
    default:
      return '/';
  }
};

const formatUser = (user: AuthUserRow) => ({
  id: user.user_id,
  nama: user.full_name,
  email: user.email,
  no_whatsapp: user.phone_number,
  role: user.role_name,
  is_active: Boolean(user.is_active),
  last_login_at: user.last_login_at,
  created_at: user.created_at,
});

export const authService = {
  /**
   * E01 — POST /api/v1/auth/register
   */
  async register(body: Record<string, unknown>) {
    const nama = String(body.nama ?? body.fullName ?? '').trim();
    if (nama.length < 2 || nama.length > 100 || !NAME_REGEX.test(nama)) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Nama wajib diisi (2-100 karakter, hanya huruf dan spasi).',
        'nama'
      );
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email || email.length > 100 || !EMAIL_REGEX.test(email)) {
      throw new ServiceError(
        422,
        'ERR-VAL-01',
        'Masukkan alamat email yang valid.',
        'email'
      );
    }

    const phoneNumber = normalizeWhatsApp(body.no_whatsapp ?? body.phoneNumber);

    const password = String(body.password ?? '');
    validatePasswordStrength(password, 'password');

    const konfirmasi = body.konfirmasi_password ?? body.confirmPassword;
    if (konfirmasi !== undefined && String(konfirmasi) !== password) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Password tidak cocok.',
        'konfirmasi_password'
      );
    }

    const existing = await authRepository.findUserByEmail(email);
    if (existing) {
      throw new ServiceError(
        409,
        'ERR-REG-01',
        'Registrasi tidak dapat diproses dengan email tersebut.',
        'email'
      );
    }

    const customerRoleId = await authRepository.findRoleIdByName('Customer');
    if (!customerRoleId) {
      throw new Error('Role Customer belum tersedia di tabel dbo.roles.');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const created = await authRepository.createCustomer({
      role_id: customerRoleId,
      full_name: nama,
      email,
      phone_number: phoneNumber,
      password_hash: passwordHash,
    });

    return {
      id: created.user_id,
      nama: created.full_name,
      email: created.email,
      role: created.role_name,
    };
  },

  /**
   * E02 — POST /api/v1/auth/login
   */
  async login(body: Record<string, unknown>, ipAddress: string) {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const rememberMe = Boolean(body.remember_me ?? body.rememberMe ?? false);

    if (!email || email.length > 100 || !EMAIL_REGEX.test(email)) {
      throw new ServiceError(
        422,
        'ERR-VAL-01',
        'Masukkan alamat email yang valid.',
        'email'
      );
    }

    if (!password) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Email dan password wajib diisi.',
        'password'
      );
    }

    // Cek lockout (3x gagal dalam 15 menit)
    const failedCount = await authRepository.countRecentFailedLogins(email, 15);
    if (failedCount >= 3) {
      void recordSecurityAudit({
        actor: { userEmail: email, ipAddress },
        actionType: 'LOGIN_FAILED',
        resourceType: 'users',
        newValues: { reason: 'ACCOUNT_LOCKED_15M' },
      });
      throw new ServiceError(
        423,
        'ERR-LOCK-01',
        'Terlalu banyak percobaan. Coba lagi dalam 15 menit.'
      );
    }

    const user = await authRepository.findUserByEmail(email);
    if (!user) {
      await authRepository.recordFailedLogin(email, ipAddress);
      void recordSecurityAudit({
        actor: { userEmail: email, ipAddress },
        actionType: 'LOGIN_FAILED',
        resourceType: 'users',
      });
      throw new ServiceError(401, 'ERR-AUTH-02', 'Email atau password tidak valid.');
    }

    if (!user.is_active) {
      void recordSecurityAudit({
        actor: { userId: user.user_id, userEmail: user.email, ipAddress },
        actionType: 'LOGIN_FAILED',
        resourceType: 'users',
        resourceId: user.user_id,
        newValues: { reason: 'ACCOUNT_INACTIVE' },
      });
      throw new ServiceError(
        403,
        'ERR-LOCK-01',
        'Akun tidak dapat digunakan. Hubungi admin restoran.'
      );
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await authRepository.recordFailedLogin(email, ipAddress);
      void recordSecurityAudit({
        actor: { userId: user.user_id, userEmail: user.email, ipAddress },
        actionType: 'LOGIN_FAILED',
        resourceType: 'users',
        resourceId: user.user_id,
      });
      throw new ServiceError(401, 'ERR-AUTH-02', 'Email atau password tidak valid.');
    }

    await authRepository.clearFailedLogins(email);
    await authRepository.updateLastLogin(user.user_id);

    const expiresInSeconds = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
    const token = jwt.sign(
      {
        user_id: user.user_id,
        email: user.email,
        full_name: user.full_name,
        role: user.role_name,
      },
      process.env.JWT_SECRET || 'default_secret_key',
      { expiresIn: expiresInSeconds }
    );

    void recordSecurityAudit({
      actor: { userId: user.user_id, userEmail: user.email, ipAddress },
      actionType: 'LOGIN_SUCCESS',
      resourceType: 'users',
      resourceId: user.user_id,
      newValues: { role: user.role_name, remember_me: rememberMe },
    });

    return {
      token,
      expires_in: expiresInSeconds,
      user: {
        id: user.user_id,
        nama: user.full_name,
        email: user.email,
        role: user.role_name,
      },
      redirect: getRedirectByRole(user.role_name),
    };
  },

  /**
   * E03 — POST /api/v1/auth/logout
   */
  async logout(
    token: string,
    actor: { userId: string; userEmail: string; ipAddress: string; exp?: number }
  ) {
    blacklistToken(token, actor.exp);

    void recordSecurityAudit({
      actor: {
        userId: actor.userId,
        userEmail: actor.userEmail,
        ipAddress: actor.ipAddress,
      },
      actionType: 'LOGOUT',
      resourceType: 'users',
      resourceId: actor.userId,
    });
  },

  /**
   * E04 — POST /api/v1/auth/password/forgot
   */
  async forgotPassword(body: Record<string, unknown>) {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email || !EMAIL_REGEX.test(email)) {
      throw new ServiceError(
        422,
        'ERR-VAL-01',
        'Masukkan alamat email yang valid.',
        'email'
      );
    }

    const user = await authRepository.findUserByEmail(email);
    if (user && user.is_active) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await authRepository.createPasswordResetToken(user.user_id, tokenHash, expiresAt);

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Password Reset Dev] Email: ${user.email} | Token: ${rawToken}`);
      }
    }
  },

  /**
   * E05 — POST /api/v1/auth/password/reset
   */
  async resetPassword(body: Record<string, unknown>) {
    const rawToken = String(body.token ?? '').trim();
    if (!rawToken) {
      throw new ServiceError(422, 'ERR-VAL-02', 'Token reset wajib diisi.', 'token');
    }

    const password = String(body.password ?? '');
    validatePasswordStrength(password, 'password');

    const konfirmasi = String(body.konfirmasi_password ?? body.confirmPassword ?? '');
    if (konfirmasi !== password) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Password tidak cocok.',
        'konfirmasi_password'
      );
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenRecord = await authRepository.findValidResetToken(tokenHash);
    if (!tokenRecord) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Token reset tidak valid atau sudah kedaluwarsa.',
        'token'
      );
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await authRepository.consumeResetTokenAndUpdatePassword(
      tokenRecord.token_id,
      tokenRecord.user_id,
      passwordHash
    );
  },

  async getProfile(userId: string) {
    if (!isValidUuid(userId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const user = await authRepository.findUserById(userId);
    if (!user) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    return formatUser(user);
  },

  async updateProfile(userId: string, body: Record<string, unknown>) {
    if (!isValidUuid(userId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const existing = await authRepository.findUserById(userId);
    if (!existing) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    let fullName = existing.full_name;
    if (body.nama !== undefined || body.fullName !== undefined) {
      fullName = String(body.nama ?? body.fullName ?? '').trim();
      if (fullName.length < 2 || fullName.length > 100 || !NAME_REGEX.test(fullName)) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Nama wajib diisi (2-100 karakter, hanya huruf dan spasi).',
          'nama'
        );
      }
    }

    let phoneNumber = existing.phone_number;
    if (body.no_whatsapp !== undefined || body.phoneNumber !== undefined) {
      phoneNumber = normalizeWhatsApp(body.no_whatsapp ?? body.phoneNumber);
    }

    let passwordHash: string | undefined;
    if (body.password !== undefined && String(body.password) !== '') {
      const currentPassword = String(body.current_password ?? body.currentPassword ?? '');
      if (!currentPassword) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Password saat ini wajib diisi untuk mengganti password.',
          'current_password'
        );
      }
      const isMatch = await bcrypt.compare(currentPassword, existing.password_hash);
      if (!isMatch) {
        throw new ServiceError(
          422,
          'ERR-VAL-02',
          'Password saat ini tidak sesuai.',
          'current_password'
        );
      }
      const newPassword = String(body.password);
      validatePasswordStrength(newPassword, 'password');
      passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    }

    const updated = await authRepository.updateProfile(userId, {
      full_name: fullName,
      phone_number: phoneNumber,
      password_hash: passwordHash,
    });

    if (!updated) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    return formatUser(updated);
  },
};
