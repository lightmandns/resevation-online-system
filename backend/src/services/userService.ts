import bcrypt from 'bcryptjs';
import { userRepository, UserRow } from '../repositories/userRepository.js';
import { AuditActor } from '../utils/auditHelper.js';
import { parsePagination, PaginationMeta } from '../utils/apiResponse.js';
import { isValidUuid, ServiceError } from '../utils/errors.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_COST = 12;

const formatUser = (row: UserRow) => ({
  id: row.user_id,
  user_id: row.user_id,
  nama: row.full_name,
  email: row.email,
  no_whatsapp: row.phone_number,
  role: row.role_name,
  is_active: Boolean(row.is_active),
  last_login_at: row.last_login_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const normalizeWa = (raw: unknown): string => {
  let s = String(raw ?? '').replace(/[\s\-()]/g, '').trim();
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0')) s = `62${s.slice(1)}`;
  if (!/^62\d{8,13}$/.test(s)) {
    throw new ServiceError(
      422,
      'ERR-VAL-02',
      'Masukkan nomor WhatsApp yang valid (10-15 digit, diawali 62).',
      'no_whatsapp'
    );
  }
  return s;
};

const validatePassword = (password: string): void => {
  if (
    password.length < 8 ||
    !/[A-Z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    throw new ServiceError(
      422,
      'ERR-VAL-02',
      'Password minimal 8 karakter dengan minimal 1 huruf kapital dan 1 angka.',
      'password'
    );
  }
};

export const userService = {
  async list(query: {
    role?: unknown;
    search?: unknown;
    include_inactive?: unknown;
    page?: unknown;
    per_page?: unknown;
  }): Promise<{ items: ReturnType<typeof formatUser>[]; meta: PaginationMeta }> {
    const role =
      query.role !== undefined && String(query.role).trim() !== ''
        ? String(query.role).trim()
        : undefined;
    const search =
      query.search !== undefined && String(query.search).trim() !== ''
        ? String(query.search).trim()
        : undefined;
    const includeInactive =
      String(query.include_inactive ?? '').toLowerCase() === 'true' ||
      String(query.include_inactive ?? '') === '1';

    const { page, perPage, offset } = parsePagination(query.page, query.per_page);
    const { rows, total } = await userRepository.list({
      role,
      search,
      includeInactive,
      offset,
      perPage,
    });

    return {
      items: rows.map(formatUser),
      meta: {
        current_page: page,
        per_page: perPage,
        total,
        last_page: Math.max(1, Math.ceil(total / perPage)),
      },
    };
  },

  async getById(userId: string) {
    if (!isValidUuid(userId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }
    const row = await userRepository.findById(userId);
    if (!row) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }
    return formatUser(row);
  },

  async create(body: Record<string, unknown>, actor: AuditActor) {
    const fullName = String(body.nama ?? body.fullName ?? '').trim();
    if (fullName.length < 2 || fullName.length > 100) {
      throw new ServiceError(422, 'ERR-VAL-02', 'Nama wajib diisi (2-100 karakter).', 'nama');
    }

    const email = String(body.email ?? '').trim().toLowerCase();
    if (!email || email.length > 150 || !EMAIL_REGEX.test(email)) {
      throw new ServiceError(422, 'ERR-VAL-01', 'Masukkan alamat email yang valid.', 'email');
    }

    const phoneNumber = normalizeWa(body.no_whatsapp ?? body.phoneNumber);

    const password = String(body.password ?? '');
    validatePassword(password);

    const roleName = String(body.role ?? '').trim();
    const roleObj = await userRepository.findRoleIdByName(roleName);
    if (!roleObj) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Role tidak valid (Customer, Admin, Manajer, Petugas Inventaris).',
        'role'
      );
    }

    const duplicate = await userRepository.findByEmail(email);
    if (duplicate) {
      throw new ServiceError(409, 'ERR-REG-01', 'Email sudah terdaftar.', 'email');
    }

    const isActive =
      body.is_active !== undefined
        ? Boolean(body.is_active)
        : body.isActive !== undefined
          ? Boolean(body.isActive)
          : true;

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const created = await userRepository.create(
      {
        role_id: roleObj.role_id,
        full_name: fullName,
        email,
        phone_number: phoneNumber,
        password_hash: passwordHash,
        is_active: isActive,
      },
      actor
    );

    return formatUser(created);
  },

  async update(userId: string, body: Record<string, unknown>, actor: AuditActor) {
    if (!isValidUuid(userId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    const existing = await userRepository.findById(userId);
    if (!existing) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    let fullName = existing.full_name;
    if (body.nama !== undefined || body.fullName !== undefined) {
      fullName = String(body.nama ?? body.fullName ?? '').trim();
      if (fullName.length < 2 || fullName.length > 100) {
        throw new ServiceError(422, 'ERR-VAL-02', 'Nama tidak valid (2-100 karakter).', 'nama');
      }
    }

    let email = existing.email;
    if (body.email !== undefined) {
      email = String(body.email ?? '').trim().toLowerCase();
      if (!email || email.length > 150 || !EMAIL_REGEX.test(email)) {
        throw new ServiceError(422, 'ERR-VAL-01', 'Masukkan alamat email yang valid.', 'email');
      }
      const dup = await userRepository.findByEmail(email, userId);
      if (dup) {
        throw new ServiceError(409, 'ERR-REG-01', 'Email sudah terdaftar.', 'email');
      }
    }

    let phoneNumber = existing.phone_number;
    if (body.no_whatsapp !== undefined || body.phoneNumber !== undefined) {
      phoneNumber = normalizeWa(body.no_whatsapp ?? body.phoneNumber);
    }

    let roleId = existing.role_id;
    if (body.role !== undefined) {
      const roleObj = await userRepository.findRoleIdByName(String(body.role).trim());
      if (!roleObj) {
        throw new ServiceError(422, 'ERR-VAL-02', 'Role tidak valid.', 'role');
      }
      roleId = roleObj.role_id;
    }

    let isActive = Boolean(existing.is_active);
    if (body.is_active !== undefined || body.isActive !== undefined) {
      isActive = Boolean(body.is_active ?? body.isActive);
    }

    let passwordHash: string | undefined;
    if (body.password !== undefined && String(body.password) !== '') {
      const pwd = String(body.password);
      validatePassword(pwd);
      passwordHash = await bcrypt.hash(pwd, BCRYPT_COST);
    }

    const updated = await userRepository.update(
      userId,
      existing,
      {
        role_id: roleId,
        full_name: fullName,
        email,
        phone_number: phoneNumber,
        is_active: isActive,
        password_hash: passwordHash,
      },
      actor
    );

    return formatUser(updated);
  },

  async remove(userId: string, requesterId: string, actor: AuditActor) {
    if (!isValidUuid(userId)) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    if (userId.toLowerCase() === requesterId.toLowerCase()) {
      throw new ServiceError(
        422,
        'ERR-VAL-02',
        'Anda tidak dapat menonaktifkan akun Anda sendiri.'
      );
    }

    const existing = await userRepository.findById(userId);
    if (!existing) {
      throw new ServiceError(404, 'ERR-DATA-01', 'Data yang dipilih tidak ditemukan.');
    }

    await userRepository.softDelete(userId, existing, actor);
  },
};
