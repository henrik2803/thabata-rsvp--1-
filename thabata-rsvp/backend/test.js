import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createApplication, clientIP } from './server.js';

const password = 'senha-sintetica-para-testes';
const payload = (phone, companions = []) => ({ name: 'Responsável de Teste', phone, consent: true, companions });
const companions = [{ name: 'Teste pequeno', ageGroup: '0-4' },
  { name: 'Teste escolar', ageGroup: '5-9' }, { name: 'Teste adulto', ageGroup: '10+' }];

async function runFlow(t, databaseUrl = '') {
  const app = await createApplication({ password, databaseUrl, production: false, trustProxyHops: 0,
    appOrigin: '', dataDir: mkdtempSync(path.join(tmpdir(), 'rsvp-api-')) });
  t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  const request = (url, method = 'GET', data, auth = false, headers = {}) => fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: cookie } : {}), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

  await t.test('health, assets e rotas administrativas protegidas', async () => {
    assert.deepEqual(await (await request('/healthz')).json(), { ok: true });
    for (const url of ['/', '/admin', '/fonts/Fredoka.ttf']) assert.equal((await request(url)).status, 200);
    assert.equal((await request('/api/admin/guests')).status, 401);
    assert.equal((await request('/api/admin/guests/1', 'DELETE')).status, 401);
    for (const url of ['/.env', '/data/rsvp.sqlite', '/backend/server.js']) assert.equal((await request(url)).status, 404);
  });

  await t.test('JSON, consentimento, nome e cada acompanhante validados no servidor sem gravação parcial', async () => {
    for (const data of [null, [], payload('1'), { ...payload('21999990001'), name: 'A' },
      { ...payload('21999990001'), consent: false },
      payload('21999990001', [{ name: '', ageGroup: '10+' }]),
      payload('21999990001', [{ name: '123', ageGroup: '10+' }]),
      payload('21999990001', [{ name: 'Teste válido', ageGroup: 'outro' }]),
      payload('21999990001', [companions[0], { name: 'Teste válido' }]),
      payload('21999990001', [null]), payload('21999990001', {}),
      payload('21999990001', Array(21).fill(companions[0]))]) {
      assert.equal((await request('/api/rsvp', 'POST', data)).status, 400);
    }
    assert.deepEqual(await app.db.listGuests(), []);
  });

  await t.test('responsável sozinho, com um e com três acompanhantes; leitura integral', async () => {
    for (const [index, group] of [[], companions.slice(0, 1), companions].entries()) {
      const response = await request('/api/rsvp', 'POST', payload(`2199999000${index + 2}`, group));
      assert.equal(response.status, 201);
      assert.equal((await response.json()).total, 1 + group.length);
    }
    const groups = await app.db.listGuests();
    assert.equal(groups.length, 3);
    assert.deepEqual(groups[0].companions, companions);
    assert.equal(groups.reduce((sum, g) => sum + 1 + g.companions.length, 0), 7);
  });

  await t.test('duplicidade normalizada e simultânea não sobrescreve família', async () => {
    const duplicate = await request('/api/rsvp', 'POST', payload('+55 (21) 99999-0004', []));
    assert.equal(duplicate.status, 409);
    const repeated = await Promise.all([0, 1].map(() => request('/api/rsvp', 'POST', payload('21999990005', companions))));
    assert.deepEqual(repeated.map(r => r.status).sort(), [201, 409]);
    const groups = await app.db.listGuests();
    assert.deepEqual(groups.find(g => g.phone === '21999990004').companions, companions);
    assert.equal(groups.length, 4);
  });

  await t.test('login, cookie, origem, exclusão integral, logout', async () => {
    assert.equal((await request('/api/login', 'POST', { password: 'errada' })).status, 401);
    const login = await request('/api/login', 'POST', { password });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    cookie = login.headers.get('set-cookie').split(';')[0];
    let response = await request('/api/admin/guests', 'GET', undefined, true);
    const { guests } = await response.json();
    assert.equal(guests.length, 4);
    assert.equal(guests.reduce((sum, g) => sum + 1 + g.companions.length, 0), 11);
    response = await request(`/api/admin/guests/${guests[0].id}`, 'DELETE', undefined, true, { Origin: 'https://evil.example' });
    assert.equal(response.status, 403);
    assert.equal((await app.db.listGuests()).length, 4);
    assert.equal((await request(`/api/admin/guests/${guests[0].id}`, 'DELETE', undefined, true)).status, 200);
    assert.equal((await app.db.listGuests()).length, 3);
    assert.equal((await request('/api/logout', 'POST', {}, true)).status, 200);
    assert.equal((await request('/api/admin/guests', 'GET', undefined, true)).status, 401);
  });

  await t.test('formulário real → JSON → API → banco: três acompanhantes', async () => {
    // Execute the delivered HTML/JS against the real HTTP server and isolated DB.
    const dom = new JSDOM(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'),
      { url: base, runScripts: 'outside-only' });
    try {
      const { window } = dom;
      const $ = selector => window.document.querySelector(selector);
      let complete;
      const done = new Promise(resolve => { complete = resolve; });
      window.fetch = async (url, options) => {
        const response = await fetch(new URL(url, base), { ...options, headers: { ...options.headers, Origin: base } });
        complete(response.status); return response;
      };
      window.eval(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'));
      $('#name').value = 'Família Sintética'; $('#phone').value = '21999990006';
      $('[name=consent]').checked = true; $('[name=bringing][value=yes]').click();
      for (let i = 0; i < 3; i++) {
        if (i) $('#add-companion').click();
        const row = $('#companions').children[i];
        row.querySelector('input').value = companions[i].name;
        row.querySelector('select').value = companions[i].ageGroup;
      }
      $('#rsvp').requestSubmit($('button[type=submit]'));
      assert.equal(await done, 201);
      for (let i = 0; i < 100 && $('#success').hidden; i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal($('#success').hidden, false);
      assert.match($('#success p').textContent, /4 pessoas/);
      const groups = await app.db.listGuests();
      assert.deepEqual(groups.find(g => g.phone === '21999990006').companions, companions);
    } finally { dom.window.close(); }
  });
}

test('API e formulário integrados com SQLite isolado', async t => runFlow(t));

test('API e formulário integrados com PostgreSQL isolado', { skip: !process.env.RSVP_TEST_DATABASE_URL }, async t => {
  const { Client } = await import('pg');
  const schema = `rsvp_api_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^rsvp_api_[a-f0-9]{32}$/);
  const admin = new Client({ connectionString: process.env.RSVP_TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  // Registered before runFlow: Node after hooks execute in registration order.
  // Close pools explicitly with a child test before dropping this random schema.
  try {
    const url = new URL(process.env.RSVP_TEST_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    await t.test('fluxo PostgreSQL', child => runFlow(child, url.href));
  } finally { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});

test('proxy: usa somente hop configurado; cabeçalhos enviados diretamente são ignorados', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '198.51.100.99, 203.0.113.2' } };
  assert.equal(clientIP(req), '127.0.0.1');
  assert.equal(clientIP(req, 1), '203.0.113.2');
  req.headers['x-forwarded-for'] = '198.51.100.99, invalid';
  assert.equal(clientIP(req, 1), '127.0.0.1');
});

test('produção exige PostgreSQL; cookies Secure, origem canônica e limites por IP atrás do proxy', async t => {
  await assert.rejects(createApplication({ password, production: true, appOrigin: 'https://convite.example', databaseUrl: '' }), /DATABASE_URL/);
  const db = { async close() {}, async health() {}, async insertGuest() { return true; } };
  const app = await createApplication({ password, production: true, appOrigin: 'https://convite.example', trustProxyHops: 1, db });
  t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (p, data, origin = 'https://convite.example', ip = '192.0.2.1', extra = {}) => fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'X-Forwarded-For': ip, ...extra }, body: JSON.stringify(data),
  });
  const login = await post('/api/login', { password });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /; Secure/);
  assert.equal((await post('/api/login', { password }, 'https://evil.example', '192.0.2.1', { 'X-Forwarded-Host': 'evil.example' })).status, 403);
  for (let i = 0; i < 20; i++) assert.equal((await post('/api/rsvp', payload('21999990001'))).status, 201);
  // Altering the untrusted prefix cannot evade the limit of the appended address.
  assert.equal((await post('/api/rsvp', payload('21999990001'), undefined, '198.51.100.9, 192.0.2.1')).status, 429);
  assert.equal((await post('/api/rsvp', payload('21999990001'), undefined, '192.0.2.2')).status, 201);
});

test('falha de banco retorna erro compreensível e logs somente técnicos', async t => {
  const logs = [];
  const fail = async () => { throw Object.assign(Error('segredo nome telefone conexão'), { code: '23514' }); };
  const app = await createApplication({ password, production: false, appOrigin: '', trustProxyHops: 0,
    db: { insertGuest: fail, health: fail, async close() {} }, logger: entry => logs.push(entry) });
  t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(base + '/api/rsvp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload('21999990001', companions)) });
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Seus dados continuam/);
  assert.equal((await fetch(base + '/healthz')).status, 503);
  assert.equal(logs.length, 2);
  assert.equal(logs[0].code, '23514');
  assert.doesNotMatch(JSON.stringify(logs), /segredo|21999990001|Responsável|conexão/);
});

test('falha ao escutar porta encerra o processo e fecha o banco sem stack ou segredo', async t => {
  const app = await createApplication({ password, production: false, appOrigin: '', trustProxyHops: 0,
    db: { async close() {} } });
  t.after(() => app.close());
  await new Promise(resolve => app.server.listen(0, '0.0.0.0', resolve));
  await assert.rejects(promisify(execFile)(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    timeout: 10000,
    env: { ...process.env, ADMIN_PASSWORD: password, DATABASE_URL: '', NODE_ENV: 'development',
      APP_ORIGIN: '', RENDER_EXTERNAL_URL: '', TRUST_PROXY_HOPS: '0',
      PORT: String(app.server.address().port), DATA_DIR: mkdtempSync(path.join(tmpdir(), 'rsvp-bind-')) },
  }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Falha ao iniciar/);
    assert.doesNotMatch(error.stderr, /Error:|at |senha-sintetica/);
    return true;
  });
});
