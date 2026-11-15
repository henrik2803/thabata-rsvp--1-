import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database.js';
import { readSource, migrate } from './migrate.js';

const example = {
  name: 'Responsável Teste', phone: '21999990001', created_at: '2026-11-15T18:00:00.000Z',
  companions: [{ name: 'Teste criança', ageGroup: '0-4' }, { name: 'Teste escolar', ageGroup: '5-9' }, { name: 'Teste adulto', ageGroup: '10+' }],
};

function cleanup(directory) {
  assert.equal(path.dirname(directory), path.resolve(tmpdir()));
  assert.match(path.basename(directory), /^rsvp-(?:database-test|upgrade-test|migration-source|migration-legacy)-/);
  rmSync(directory, { recursive: true, force: true });
}

test('SQLite preserves whole groups across restart and rejects duplicate phone atomically', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'rsvp-database-test-'));
  let db;
  try {
    db = await openDatabase({ dataDir });
    assert.equal(await db.insertGuest(example), true);
    assert.equal(await db.insertGuest({ ...example, name: 'Alterado', companions: [] }), false);
    await db.close();
    db = await openDatabase({ dataDir });
    await db.health();
    const groups = await db.listGuests();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, example.name);
    assert.deepEqual(groups[0].companions, example.companions);
    assert.equal(await db.deleteGuest(groups[0].id), true);
    assert.deepEqual(await db.listGuests(), []);
  } finally { if (db) await db.close(); cleanup(dataDir); }
});

test('SQLite additive upgrade keeps legacy records and adds empty companions', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'rsvp-upgrade-test-'));
  let db;
  try {
    const legacy = new DatabaseSync(path.join(dataDir, 'rsvp.sqlite'));
    legacy.exec('CREATE TABLE guests (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL)');
    legacy.prepare('INSERT INTO guests(name,phone,created_at) VALUES(?,?,?)').run(example.name, example.phone, example.created_at);
    legacy.close();
    db = await openDatabase({ dataDir });
    const groups = await db.listGuests();
    assert.equal(groups.length, 1);
    assert.equal(groups[0].name, example.name);
    assert.deepEqual(groups[0].companions, []);
  } finally { if (db) await db.close(); cleanup(dataDir); }
});

test('production cannot create SQLite when DATABASE_URL is empty', async () => {
  const dataDir = path.join(tmpdir(), `rsvp-must-not-exist-${process.pid}-${Date.now()}`);
  await assert.rejects(openDatabase({ dataDir, production: true }), /DATABASE_URL/);
  assert.equal(existsSync(dataDir), false);
  await assert.rejects(openDatabase({ dataDir, databaseUrl: 'sqlite:local' }), /PostgreSQL/);
});

test('migration source reader includes all companions and preserves the original file', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'rsvp-migration-source-'));
  const sourcePath = path.join(dataDir, 'rsvp.sqlite');
  try {
    const db = await openDatabase({ dataDir });
    await db.insertGuest(example);
    await db.close();
    const before = readFileSync(sourcePath);
    assert.deepEqual(readSource(sourcePath), [example]);
    assert.deepEqual(readFileSync(sourcePath), before);
    await assert.rejects(migrate({ sourcePath, apply: true, databaseUrl: 'postgresql://localhost/test' }), /REVIEW_REQUIRED/);
    assert.throws(() => readSource('relative.sqlite'), /SOURCE_ABSOLUTE_PATH_REQUIRED/);
    const corrupt = new DatabaseSync(sourcePath);
    corrupt.prepare('UPDATE guests SET companions=?').run('[{"name":"Teste","ageGroup":"invalid"}]');
    corrupt.close();
    assert.throws(() => readSource(sourcePath), /SOURCE_INVALID_GROUP/);
  } finally { cleanup(dataDir); }
});

test('migration source reader accepts legacy schema without changing it', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'rsvp-migration-legacy-'));
  const sourcePath = path.join(dataDir, 'legacy.sqlite');
  try {
    const db = new DatabaseSync(sourcePath);
    db.exec('CREATE TABLE guests (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL)');
    db.prepare('INSERT INTO guests(name,phone,created_at) VALUES(?,?,?)').run(example.name, example.phone, example.created_at);
    db.close();
    const before = readFileSync(sourcePath);
    assert.deepEqual(readSource(sourcePath), [{ ...example, companions: [] }]);
    assert.deepEqual(readFileSync(sourcePath), before);
  } finally { cleanup(dataDir); }
});
