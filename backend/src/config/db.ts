import sql from 'mssql';
import dotenv from 'dotenv';

dotenv.config();

const portValue = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 1433;

export const dbConfig: sql.config = {
  user: process.env.DB_USER || 'dev_mazaya',
  password: process.env.DB_PASSWORD || 'Mazaya2026',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_DATABASE || 'MazayaDB',
  port: isNaN(portValue) ? 1433 : portValue,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool: sql.ConnectionPool | null = null;

export const getPool = async (): Promise<sql.ConnectionPool> => {
  if (pool && pool.connected) {
    return pool;
  }
  try {
    pool = await new sql.ConnectionPool(dbConfig).connect();
    console.log(`[Database] Terhubung ke SQL Server: ${dbConfig.server} / Database: ${dbConfig.database}`);
    return pool;
  } catch (error: any) {
    console.error('[Database Error] Gagal terhubung ke SQL Server:');
    console.error(`- Server: ${dbConfig.server}`);
    console.error(`- Database: ${dbConfig.database}`);
    console.error(`- User: ${dbConfig.user}`);
    console.error(`- Pesan Error: ${error.message}`);
    throw error;
  }
};

export { sql };
