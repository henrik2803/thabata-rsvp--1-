import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkDatabaseConfig, initializePostgres } from './database.js';

const validName = (name, min) => typeof name === 'string' && name.length >= min && name.length <= 100 && /\p{L}/u.test(name);

function normalizeGroup(row) {
  let companions;
  try { companions = typeof row.companions === 'string' ? JSON.parse(row.companions) : row.companions === undefined ? [] : row.companions; }
  catch { throw new Error('SOURCE_INVALID_GROUP'); }
  if (!validName(row.name, 3) || !/^[1-9]{2}[2-9]\d{7,8}$/.test(row.phone) ||
      typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) ||
      !Array.isArray(companions) || companions.length > 20 ||
      companions.some(c => !c || !validName(c.name, 2) || !['0-4', '5-9', '10+'].includes(c.ageGroup))) {
    throw new Error('SOURCE_INVALID_GROUP');
  }
  return {
    name: row.name,
    phone: row.phone,
    created_at: row.created_at,
    companions: companions.map(c => ({ name: c.name, ageGroup: c.ageGroup })),
  };
}

export function readSource(sourcePath) {
  if (!sourcePath || !path.isAbsolute(sourcePath)) throw new Error('SOURCE_ABSOLUTE_PATH_REQUIRED');
  // SQLite opens an existing source read-only; it cannot create, alter or delete it.
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    source.exec('BEGIN'); // A consistent snapshot, including committed WAL records.
    const columns = source.prepare('PRAGMA table_info(guests)').all().map(c => c.name);
    if (!['id', 'name', 'phone', 'created_at'].every(c => columns.includes(c))) throw new Error('SOURCE_SCHEMA_INVALID');
    const query = columns.includes('companions') ? 'SELECT * FROM guests ORDER BY id' : "SELECT *, '[]' AS companions FROM guests ORDER BY id";
    const rows = source.prepare(query).all().map(normalizeGroup);
    if (new Set(rows.map(row => row.phone)).size !== rows.length) throw new Error('SOURCE_DUPLICATE_PHONE');
    source.exec('COMMIT');
    return rows;
  } finally { source.close(); }
}

function sameGroup(source, target) {
  try {
    const group = normalizeGroup(target);
    return group.name === source.name && group.phone === source.phone && group.created_at === source.created_at &&
      JSON.stringify(group.companions) === JSON.stringify(source.companions);
  } catch { return false; }
}

export async function migrate({ sourcePath, databaseUrl, apply = false, reviewed = false }) {
  if (apply && !reviewed) throw new Error('REVIEW_REQUIRED');
  checkDatabaseConfig({ databaseUrl, production: true });
  const groups = readSource(sourcePath);
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    if (apply) {
      // Serialize imports from this tool, then protect against concurrent RSVP inserts.
      await client.query('SELECT pg_advisory_xact_lock(741852963)');
      await initializePostgres(client);
      await client.query('LOCK TABLE guests IN SHARE ROW EXCLUSIVE MODE');
    }
    const exists = (await client.query("SELECT to_regclass('guests') IS NOT NULL AS exists")).rows[0].exists;
    let identical = 0;
    let conflicts = 0;
    const missing = [];
    for (const group of groups) {
      const target = exists ? (await client.query('SELECT * FROM guests WHERE phone=$1', [group.phone])).rows[0] : null;
      if (!target) missing.push(group);
      else if (sameGroup(group, target)) identical++;
      else conflicts++;
    }
    const summary = {
      mode: apply ? 'apply' : 'preview',
      sourceGroups: groups.length,
      sourcePeople: groups.reduce((count, group) => count + 1 + group.companions.length, 0),
      destinationInitialized: exists,
      identicalGroups: identical,
      newGroups: missing.length,
      conflictingGroups: conflicts,
    };
    if (conflicts) {
      await client.query('ROLLBACK');
      return { ...summary, appliedGroups: 0, ready: false };
    }
    if (apply) {
      for (const group of missing) {
        await client.query('INSERT INTO guests(name,phone,created_at,companions) VALUES($1,$2,$3,$4)',
          [group.name, group.phone, group.created_at, JSON.stringify(group.companions)]);
      }
      await client.query('COMMIT');
    } else await client.query('ROLLBACK');
    return { ...summary, appliedGroups: apply ? missing.length : 0, ready: true };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* The connection may already be closed. */ }
    throw error;
  } finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => !['--apply', '--reviewed'].includes(arg))) {
    console.error('Use sem argumentos para simular; --apply --reviewed somente após revisar origem e destino.');
    process.exitCode = 1;
  } else {
    try {
      const result = await migrate({
        sourcePath: process.env.MIGRATION_SQLITE_PATH,
        databaseUrl: process.env.DATABASE_URL,
        apply: args.includes('--apply'),
        reviewed: args.includes('--reviewed'),
      });
      console.log(JSON.stringify(result));
      if (!result.ready) process.exitCode = 1;
    } catch (error) {
      // Driver messages can contain connection strings or row values: never print them.
      const codes = new Set(['SOURCE_INVALID_GROUP', 'SOURCE_ABSOLUTE_PATH_REQUIRED', 'SOURCE_SCHEMA_INVALID', 'SOURCE_DUPLICATE_PHONE', 'REVIEW_REQUIRED']);
      console.error(JSON.stringify({ event: 'migration_failed', code: codes.has(error.message) ? error.message : 'MIGRATION_ERROR' }));
      process.exitCode = 1;
    }
  }
}
