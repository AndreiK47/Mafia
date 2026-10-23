import mysql from 'mysql2/promise';

let pool;
export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
    const url = new URL(process.env.DATABASE_URL);
    if (!['mysql:', 'mysql2:'].includes(url.protocol)) throw new Error('DATABASE_URL must use the mysql protocol.');
    const sslCa = process.env.DB_SSL_CA?.replace(/\\n/g, '\n');
    pool = mysql.createPool({
      host: url.hostname,
      port: Number(url.port) || 3306,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.slice(1)),
      connectionLimit: Math.min(10, Math.max(1, Number(process.env.DB_CONNECTION_LIMIT) || 5)),
      waitForConnections: true,
      queueLimit: 20,
      enableKeepAlive: true,
      timezone: 'Z',
      namedPlaceholders: false,
      decimalNumbers: true,
      ssl: process.env.DB_SSL === 'true' ? { ...(sslCa ? { ca: sslCa } : {}), rejectUnauthorized: true } : undefined,
    });
  }
  return pool;
}

export async function transaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* connection may already be gone */ }
    throw error;
  } finally {
    conn.release();
  }
}
