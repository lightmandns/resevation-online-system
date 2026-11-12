import { eq, or, like, and, desc, sql } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import { users } from '../db/schema.js';

export class UserRepository {
  async findByEmail(email: string) {
    const db = await getDb();
    const result = await db
      .select()
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${email.trim()})`);
    return result[0] || null;
  }

  async findById(userId: number) {
    const db = await getDb();
    const result = await db
      .select({
        userId: users.userId,
        fullName: users.fullName,
        email: users.email,
        phoneNumber: users.phoneNumber,
        role: users.role,
        isActive: users.isActive,
        lastLogin: users.lastLogin,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.userId, userId));
    return result[0] || null;
  }

  async findByIdWithPassword(userId: number) {
    const db = await getDb();
    const result = await db
      .select()
      .from(users)
      .where(eq(users.userId, userId));
    return result[0] || null;
  }

  async findAll(options?: { search?: string; role?: string; isActive?: boolean }) {
    const db = await getDb();
    const conditions = [];

    if (options?.search) {
      const searchPattern = `%${options.search}%`;
      conditions.push(
        or(
          like(users.fullName, searchPattern),
          like(users.email, searchPattern),
          like(users.phoneNumber, searchPattern)
        )
      );
    }

    if (options?.role && options.role !== 'all') {
      conditions.push(eq(users.role, options.role));
    }

    if (options?.isActive !== undefined) {
      conditions.push(eq(users.isActive, options.isActive));
    }

    const query = db
      .select({
        userId: users.userId,
        fullName: users.fullName,
        email: users.email,
        phoneNumber: users.phoneNumber,
        role: users.role,
        isActive: users.isActive,
        lastLogin: users.lastLogin,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users);

    if (conditions.length > 0) {
      return query.where(and(...conditions)).orderBy(desc(users.createdAt));
    }

    return query.orderBy(desc(users.createdAt));
  }

  async create(data: {
    fullName: string;
    email: string;
    phoneNumber?: string | null;
    passwordHash: string;
    role: string;
    isActive?: boolean;
  }) {
    const db = await getDb();
    const inserted = await db
      .insert(users)
      .output()
      .values({
        fullName: data.fullName,
        email: data.email,
        phoneNumber: data.phoneNumber || null,
        passwordHash: data.passwordHash,
        role: data.role,
        isActive: data.isActive !== undefined ? data.isActive : true,
      });

    const user = inserted[0];
    if (!user) return null;
    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  }

  async update(
    userId: number,
    data: {
      fullName?: string;
      email?: string;
      phoneNumber?: string | null;
      passwordHash?: string;
      role?: string;
      isActive?: boolean;
    }
  ) {
    const db = await getDb();
    const updateValues: Record<string, any> = {
      updatedAt: sql`CURRENT_TIMESTAMP`,
    };

    if (data.fullName !== undefined) updateValues.fullName = data.fullName;
    if (data.email !== undefined) updateValues.email = data.email;
    if (data.phoneNumber !== undefined) updateValues.phoneNumber = data.phoneNumber;
    if (data.passwordHash !== undefined) updateValues.passwordHash = data.passwordHash;
    if (data.role !== undefined) updateValues.role = data.role;
    if (data.isActive !== undefined) updateValues.isActive = data.isActive;

    const updated = await db
      .update(users)
      .set(updateValues)
      .output()
      .where(eq(users.userId, userId));

    const user = updated[0];
    if (!user) return null;
    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  }

  async updateLastLogin(userId: number) {
    const db = await getDb();
    await db
      .update(users)
      .set({ lastLogin: sql`CURRENT_TIMESTAMP` })
      .where(eq(users.userId, userId));
  }

  async delete(userId: number) {
    const db = await getDb();
    const deleted = await db
      .delete(users)
      .output()
      .where(eq(users.userId, userId));
    return deleted[0] || null;
  }
}

export const userRepository = new UserRepository();
