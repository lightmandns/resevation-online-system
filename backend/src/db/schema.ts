import {
  mssqlTable,
  int,
  nvarchar,
  datetime,
  bit,
} from 'drizzle-orm/mssql-core';
import { sql } from 'drizzle-orm';

/**
 * Skema Model Tabel [USER] Drizzle ORM
 * Menyesuaikan file 02. Define Table (DDL).sql di MazayaDB:
 * - UserId: INT IDENTITY(1,1) PRIMARY KEY
 * - FullName: NVARCHAR(255) NOT NULL
 * - Email: NVARCHAR(255) NOT NULL UNIQUE
 * - PhoneNumber: NVARCHAR(20)
 * - PasswordHash: NVARCHAR(255) NOT NULL
 * - Role: NVARCHAR(100) NOT NULL
 * - IsActive: BIT DEFAULT 1
 * - LastLogin: DATETIME NULL
 * - CreatedAt: DATETIME DEFAULT CURRENT_TIMESTAMP
 * - UpdatedAt: DATETIME DEFAULT CURRENT_TIMESTAMP
 */
export const users = mssqlTable('USER', {
  userId: int('UserId').primaryKey().identity(),
  fullName: nvarchar('FullName', { length: 255 }).notNull(),
  email: nvarchar('Email', { length: 255 }).notNull().unique(),
  phoneNumber: nvarchar('PhoneNumber', { length: 20 }),
  passwordHash: nvarchar('PasswordHash', { length: 255 }).notNull(),
  role: nvarchar('Role', { length: 100 }).notNull(),
  isActive: bit('IsActive').default(true),
  lastLogin: datetime('LastLogin'),
  createdAt: datetime('CreatedAt').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('UpdatedAt').default(sql`CURRENT_TIMESTAMP`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
