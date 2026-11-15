import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function checkDatabaseConfig({ databaseUrl = '', production = false } = {}) {
  if (!databaseUrl.trim()) {
    if (production) throw new Error('DATABASE_URL é obrigatória em produção.');
    return false;
  }
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error('DATABASE_URL inválida.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL deve apontar para PostgreSQL.');
  return true;
}

// Shared with the migration. Only additive changes: no DROP, DELETE or table rebuild.
export async function initializePostgres(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS guests (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    companions TEXT NOT NULL DEFAULT '[]'
  )`);
  await client.query("ALTER TABLE guests ADD COLUMN IF NOT EXISTS companions TEXT NOT NULL DEFAULT '[]'");
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS guests_phone_unique ON guests(phone)');
}

function decodeGuest(row) {
  const companions = typeof row.companions === 'string' ? JSON.parse(row.companions) : row.companions;
  if (!Array.isArray(companions)) throw new Error('Invalid stored group');
  return { ...row, companions };
}

export async function openDatabase({ databaseUrl = '', dataDir, production = false } = {}) {
  const postgres = checkDatabaseConfig({ databaseUrl, production });
  if (postgres) {
    const { Pool } = await import('pg');
    // The connection string supplies Neon TLS options. Never disable certificate checks.
    const pool = new Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10000 });
    pool.on('error', () => console.error(JSON.stringify({ event: 'database_pool_error' })));
    try { await initializePostgres(pool); } catch (error) { await pool.end(); throw error; }
    return {
      async insertGuest(guest) {
        const result = await pool.query(
          'INSERT INTO guests(name,phone,created_at,companions) VALUES($1,$2,$3,$4) ON CONFLICT(phone) DO NOTHING',
          [guest.name, guest.phone, guest.created_at, JSON.stringify(guest.companions)],
        );
        return result.rowCount === 1;
      },
      async listGuests() { return (await pool.query('SELECT * FROM guests ORDER BY id DESC')).rows.map(decodeGuest); },
      async deleteGuest(id) { return (await pool.query('DELETE FROM guests WHERE id=$1', [id])).rowCount === 1; },
      async health() { await pool.query('SELECT 1'); },
      async close() { await pool.end(); },
    };
  }
  const { DatabaseSync } = await import('node:sqlite');
  if (!dataDir) throw new Error('Defina o diretório do SQLite local.');
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'rsvp.sqlite'));
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    db.exec('CREATE TABLE IF NOT EXISTS guests (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL)');
    if (!db.prepare('PRAGMA table_info(guests)').all().some(column => column.name === 'companions')) {
      db.exec("ALTER TABLE guests ADD COLUMN companions TEXT NOT NULL DEFAULT '[]'");
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS guests_phone_unique ON guests(phone); COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Initialization may fail before BEGIN. */ }
    db.close();
    throw error;
  }
  return {
    async insertGuest(guest) {
      const result = db.prepare('INSERT INTO guests(name,phone,created_at,companions) VALUES(?,?,?,?) ON CONFLICT(phone) DO NOTHING')
        .run(guest.name, guest.phone, guest.created_at, JSON.stringify(guest.companions));
      return result.changes === 1;
    },
    async listGuests() { return db.prepare('SELECT * FROM guests ORDER BY id DESC').all().map(decodeGuest); },
    async deleteGuest(id) { return db.prepare('DELETE FROM guests WHERE id=?').run(id).changes === 1; },
    async health() { db.prepare('SELECT 1').get(); },
    async close() { db.close(); },
  };
}
