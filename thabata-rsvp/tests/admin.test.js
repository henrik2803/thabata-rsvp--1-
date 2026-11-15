import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/admin.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const fixture = [
  { id: 1, name: 'Responsável Primeiro', phone: '21999990001', created_at: '2026-11-15T20:00:00.000Z', companions: [{ name: 'Criança Pequena', ageGroup: '0-4' }, { name: 'Criança Maior', ageGroup: '5-9' }, { name: 'Acompanhante Adulto', ageGroup: '10+' }] },
  { id: 2, name: 'Responsável Sozinho', phone: '21999990002', created_at: '2026-11-15T21:00:00.000Z', companions: [] },
];

async function setup({ authenticated = true } = {}) {
  const dom = new JSDOM(html, { url: 'http://localhost/admin', runScripts: 'outside-only' });
  const { window } = dom;
  let guests = structuredClone(fixture);
  const requests = [];
  const exports = [];
  const confirmations = [];
  let confirmed = true;
  window.setInterval = () => 0;
  window.confirm = message => { confirmations.push(message); return confirmed; };
  window.Blob = Blob;
  window.URL.createObjectURL = blob => { exports.push(blob); return 'blob:test-export'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  window.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    let status = 200, data;
    if (url === '/api/login') {
      authenticated = JSON.parse(options.body).password === 'senha-de-teste';
      status = authenticated ? 200 : 401;
      data = authenticated ? { ok: true } : { error: 'Senha incorreta.' };
    } else if (url === '/api/logout') {
      authenticated = false; data = { ok: true };
    } else if (!authenticated) {
      status = 401; data = { error: 'Faça login para acessar o painel.' };
    } else if (options.method === 'DELETE') {
      guests = guests.filter(guest => guest.id !== Number(url.split('/').pop()));
      data = { ok: true };
    } else {
      data = { guests: structuredClone(guests) };
    }
    return { status, ok: status < 400, json: async () => data };
  };
  window.eval(script);
  await tick();
  return { dom, window, $: selector => window.document.querySelector(selector), requests, exports, confirmations, setConfirmed: value => { confirmed = value; } };
}

test('painel mostra todos os acompanhantes e soma responsáveis apenas uma vez', async t => {
  const page = await setup();
  t.after(() => page.dom.window.close());
  const { $ } = page;
  assert.equal($('#panel').hidden, false);
  assert.equal($('#total').textContent, '5');
  assert.match($('#family-summary').textContent, /2 grupos · 2 responsáveis · 1 crianças de 0 a 4 · 1 crianças de 5 a 9 · 3 pessoas de 10 anos ou mais/);
  assert.equal($('#rows').children.length, 2);
  for (const companion of fixture[0].companions) assert.match($('#rows').textContent, new RegExp(companion.name));
  assert.match($('#rows').textContent, /4 pessoa\(s\)/);
  assert.match($('#rows').textContent, /15\/11\/2026/);
});

test('busca encontra acompanhante ou telefone e mantém os totais gerais', async t => {
  const page = await setup();
  t.after(() => page.dom.window.close());
  const { $, window } = page;
  $('#search').value = 'Criança Maior';
  $('#search').dispatchEvent(new window.Event('input'));
  assert.equal($('#rows').children.length, 1);
  assert.match($('#rows').textContent, /Responsável Primeiro/);
  assert.equal($('#total').textContent, '5');
  $('#search').value = '(21) 99999-0002';
  $('#search').dispatchEvent(new window.Event('input'));
  assert.equal($('#rows').children.length, 1);
  assert.match($('#rows').textContent, /Responsável Sozinho/);
  $('#search').value = 'Inexistente';
  $('#search').dispatchEvent(new window.Event('input'));
  assert.equal($('#rows').children.length, 0);
  assert.equal($('#empty').hidden, false);
});

test('CSV inclui todos os grupos e acompanhantes mesmo com busca ativa', async t => {
  const page = await setup();
  t.after(() => page.dom.window.close());
  page.$('#search').value = 'Sozinho';
  page.$('#search').dispatchEvent(new page.window.Event('input'));
  page.$('#export').click();
  assert.equal(page.exports.length, 1);
  const csv = await page.exports[0].text();
  for (const guest of fixture) {
    assert.equal(csv.split(guest.name).length - 1, 1);
    assert.ok(csv.includes(guest.phone));
    for (const companion of guest.companions) assert.equal(csv.split(companion.name).length - 1, 1);
  }
  for (const label of ['0 a 4 anos', '5 a 9 anos', '10 anos ou mais']) assert.ok(csv.includes(label));
  assert.match(csv, /4 pessoa\(s\)/);
  assert.match(csv, /1 pessoa\(s\)/);
});

test('exclusão exige confirmação e remove todo o grupo dos totais', async t => {
  const page = await setup();
  t.after(() => page.dom.window.close());
  page.setConfirmed(false);
  page.$('#rows button').click();
  await tick();
  assert.equal(page.requests.filter(request => request.options.method === 'DELETE').length, 0);
  assert.equal(page.$('#total').textContent, '5');
  assert.match(page.confirmations[0], /todo o grupo.*incluindo acompanhantes/);
  page.setConfirmed(true);
  page.$('#rows button').click();
  await tick();
  assert.equal(page.requests.filter(request => request.options.method === 'DELETE').length, 1);
  assert.equal(page.$('#total').textContent, '1');
  assert.equal(page.$('#rows').children.length, 1);
  assert.doesNotMatch(page.$('#rows').textContent, /Criança Pequena/);
});

test('interface exige login; senha errada mostra mensagem; login e logout alternam painel', async t => {
  const page = await setup({ authenticated: false });
  t.after(() => page.dom.window.close());
  const { $ } = page;
  assert.equal($('#panel').hidden, true);
  assert.equal($('#login').hidden, false);
  $('#password').value = 'errada';
  $('#login-form').requestSubmit();
  await tick();
  assert.match($('#login-message').textContent, /Senha incorreta/);
  assert.equal($('#panel').hidden, true);
  $('#password').value = 'senha-de-teste';
  $('#login-form').requestSubmit();
  await tick();
  assert.equal($('#panel').hidden, false);
  assert.equal($('#password').value, '');
  $('#logout').click();
  await tick();
  assert.equal($('#panel').hidden, true);
  assert.equal($('#login').hidden, false);
  assert.equal($('#rows').children.length, 0);
});
