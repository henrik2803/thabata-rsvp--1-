import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './database.js';
import { migrate } from './migrate.js';

// Opt in only with a dedicated, disposable PostgreSQL server, never DATABASE_URL.
const testUrl = process.env.RSVP_TEST_DATABASE_URL;

test('PostgreSQL: persistence, atomic duplicates and safe idempotent migration', { skip: !testUrl }, async () => {
  const { Client } = await import('pg');
  const schema = `rsvp_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^rsvp_test_[a-f0-9]{32}$/);
  const admin = new Client({ connectionString: testUrl });
  await admin.connect();
  const url = new URL(testUrl);
  url.searchParams.set('options', `-c search_path=${schema}`);
  const databaseUrl = url.href;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'rsvp-postgres-source-'));
  const sourcePath = path.join(dataDir, 'rsvp.sqlite');
  let db;
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const original = {
      name: 'Grupo Sintético', phone: '21999990101', created_at: '2026-11-15T18:00:00.000Z',
      companions: [{ name: 'Teste pequeno', ageGroup: '0-4' }, { name: 'Teste escolar', ageGroup: '5-9' }, { name: 'Teste adulto', ageGroup: '10+' }],
    };
    const source = await openDatabase({ dataDir });
    await source.insertGuest(original);
    await source.close();

    const emptyPreview = await migrate({ sourcePath, databaseUrl });
    assert.equal(emptyPreview.destinationInitialized, false);
    assert.equal(emptyPreview.newGroups, 1);
    assert.equal((await admin.query('SELECT to_regclass($1) AS relation', [`${schema}.guests`])).rows[0].relation, null);

    db = await openDatabase({ databaseUrl });
    await db.health();
    assert.equal(await db.insertGuest(original), true);
    assert.equal(await db.insertGuest({ ...original, name: 'Não substituir', companions: [] }), false);
    await db.close();
    db = await openDatabase({ databaseUrl });
    let guests = await db.listGuests();
    assert.equal(guests.length, 1);
    assert.equal(guests[0].name, original.name);
    assert.deepEqual(guests[0].companions, original.companions);
    assert.equal(await db.deleteGuest(guests[0].id), true);
    assert.deepEqual(await db.listGuests(), []);

    assert.equal((await migrate({ sourcePath, databaseUrl })).newGroups, 1);
    assert.deepEqual(await db.listGuests(), []);
    assert.equal((await migrate({ sourcePath, databaseUrl, apply: true, reviewed: true })).appliedGroups, 1);
    const repeat = await migrate({ sourcePath, databaseUrl, apply: true, reviewed: true });
    assert.equal(repeat.appliedGroups, 0);
    assert.equal(repeat.identicalGroups, 1);
    assert.deepEqual((await db.listGuests())[0].companions, original.companions);

    // A conflicting family aborts the entire batch, including otherwise new groups.
    const editor = new DatabaseSync(sourcePath);
    editor.prepare('UPDATE guests SET name=?').run('Conflito sintético');
    editor.prepare('INSERT INTO guests(name,phone,created_at,companions) VALUES(?,?,?,?)')
      .run('Novo grupo teste', '21999990102', original.created_at, '[]');
    editor.close();
    const conflict = await migrate({ sourcePath, databaseUrl, apply: true, reviewed: true });
    assert.equal(conflict.ready, false);
    assert.equal(conflict.conflictingGroups, 1);
    assert.equal(conflict.newGroups, 1);
    guests = await db.listGuests();
    assert.equal(guests.length, 1);
    assert.equal(guests[0].name, original.name);
    await db.deleteGuest(guests[0].id);

    // A failure on the second INSERT must roll back the first INSERT too.
    await admin.query(`CREATE FUNCTION ${schema}.reject_test_group() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.phone = '21999990102' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await admin.query(`CREATE TRIGGER reject_test BEFORE INSERT ON ${schema}.guests FOR EACH ROW EXECUTE FUNCTION ${schema}.reject_test_group()`);
    await assert.rejects(migrate({ sourcePath, databaseUrl, apply: true, reviewed: true }), /synthetic failure/);
    assert.deepEqual(await db.listGuests(), []);
  } finally {
    if (db) await db.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    assert.equal(path.dirname(dataDir), path.resolve(tmpdir()));
    assert.match(path.basename(dataDir), /^rsvp-postgres-source-/);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
