import 'dotenv/config';
import mssql from 'mssql';
import { drizzle } from 'drizzle-orm/node-mssql';
import { dbConfig } from '../config/db.js';

let poolPromise: Promise<mssql.ConnectionPool> | null = null;
let dbPromise: ReturnType<typeof buildDb> | null = null;

async function buildDb() {
  poolPromise ??= mssql.connect(dbConfig);
  const pool = await poolPromise;
  return drizzle({ client: pool });
}

export function getDb() {
  if (!dbPromise) {
    dbPromise = buildDb().catch((error) => {
      dbPromise = null;
      poolPromise = null;
      throw error;
    });
  }
  return dbPromise;
}
