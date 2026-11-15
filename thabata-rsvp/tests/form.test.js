import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(fetchImpl) {
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
  const { window } = dom;
  const requests = [];
  window.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    requests.push({ url, payload });
    return fetchImpl ? fetchImpl(payload) : { ok: true, json: async () => ({ total: 1 + payload.companions.length }) };
  };
  window.eval(script);
  const $ = selector => window.document.querySelector(selector);
  $('#name').value = 'Responsável de Teste';
  $('#phone').value = '21999990001';
  $('[name=consent]').checked = true;
  const choose = value => $(`[name=bringing][value=${value}]`).click();
  const add = () => $('#add-companion').click();
  const fill = (index, name, age) => {
    const row = $('#companions').children[index];
    row.querySelector('input').value = name;
    row.querySelector('select').value = age;
  };
  const submit = () => $('#rsvp').requestSubmit($('[type=submit]'));
  return { dom, window, $, requests, choose, add, fill, submit };
}

for (const count of [0, 1, 3]) {
  test(`formulário envia responsável e ${count} acompanhante(s) sem duplicar responsável`, async t => {
    const page = setup();
    t.after(() => page.dom.window.close());
    const { $, choose, add, fill, submit, requests } = page;
    if (count) choose('yes');
    for (let index = 0; index < count; index++) {
      if (index) add();
      fill(index, `Acompanhante ${index}`, ['0-4', '5-9', '10+'][index]);
    }
    assert.equal($('#rsvp').checkValidity(), true);
    submit();
    assert.equal($('[type=submit]').disabled, true);
    await tick();
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].payload.companions, Array.from({ length: count }, (_, index) => ({ name: `Acompanhante ${index}`, ageGroup: ['0-4', '5-9', '10+'][index] })));
    assert.equal(requests[0].payload.name, 'Responsável de Teste');
    assert.equal($('#success').hidden, false);
    assert.equal($('#rsvp').hidden, true);
    assert.match($('#success p').textContent, count ? new RegExp(`${count + 1} pessoas`) : /Sua presença/);
  });
}

test('remoção do meio mantém os nomes e as faixas corretas; IDs novos são únicos', async t => {
  const page = setup();
  t.after(() => page.dom.window.close());
  const { $, choose, add, fill, submit, requests } = page;
  choose('yes');
  fill(0, 'Primeiro', '0-4');
  add(); fill(1, 'Remover', '5-9');
  add(); fill(2, 'Terceiro', '10+');
  $('#companions').children[1].querySelector('button').click();
  add(); fill(2, 'Quarto', '5-9');
  const ids = [...$('#companions').querySelectorAll('[id]')].map(element => element.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.match($('#group-total').textContent, /4 pessoas/);
  submit(); await tick();
  assert.deepEqual(requests[0].payload.companions, [{ name: 'Primeiro', ageGroup: '0-4' }, { name: 'Terceiro', ageGroup: '10+' }, { name: 'Quarto', ageGroup: '5-9' }]);
});

test('campos ocultos inválidos não bloqueiam nem integram o envio de quem vai sozinho', async t => {
  const page = setup();
  t.after(() => page.dom.window.close());
  const { $, choose, submit, requests } = page;
  choose('yes');
  assert.equal($('#rsvp').checkValidity(), false);
  choose('no');
  assert.equal($('#rsvp').checkValidity(), true);
  assert.equal($('#companions input').disabled, true);
  assert.equal($('#companions select').disabled, true);
  submit(); await tick();
  assert.deepEqual(requests[0].payload.companions, []);
});

test('alternância Sim → Não → Sim restaura valores e valida os acompanhantes visíveis', async t => {
  const page = setup();
  t.after(() => page.dom.window.close());
  const { $, choose, fill, submit, requests } = page;
  choose('yes'); fill(0, 'Acompanhante preservado', '5-9');
  choose('no');
  assert.match($('#group-total').textContent, /1 pessoa\./);
  choose('yes');
  assert.equal($('#companions input').disabled, false);
  assert.equal($('#companions input').value, 'Acompanhante preservado');
  assert.equal($('#companions select').value, '5-9');
  submit(); await tick();
  assert.deepEqual(requests[0].payload.companions, [{ name: 'Acompanhante preservado', ageGroup: '5-9' }]);
});

test('nome vazio e faixa etária ausente/indevida bloqueiam o formulário antes da API', async t => {
  const page = setup();
  t.after(() => page.dom.window.close());
  const { $, choose, fill, submit, requests } = page;
  choose('yes');
  submit(); await tick();
  assert.equal(requests.length, 0);
  fill(0, 'Acompanhante válido', 'inválida');
  submit(); await tick();
  assert.equal(requests.length, 0);
  assert.equal($('#companions select').validity.valueMissing, true);
  fill(0, '', '10+');
  assert.equal($('#companions input').validity.valueMissing, true);
});

test('erro de rede preserva o grupo e reativa o botão de enviar correto', async t => {
  const page = setup(async () => { throw new TypeError('Failed to fetch'); });
  t.after(() => page.dom.window.close());
  const { $, choose, add, fill, submit, requests } = page;
  choose('yes'); fill(0, 'Primeiro preservado', '0-4');
  add(); fill(1, 'Segundo preservado', '10+');
  submit(); await tick();
  assert.equal(requests.length, 1);
  assert.equal($('[type=submit]').disabled, false);
  assert.equal($('#add-companion').disabled, false);
  assert.equal($('#rsvp').hidden, false);
  assert.equal($('#companions').children[1].querySelector('input').value, 'Segundo preservado');
  assert.equal($('#name').value, 'Responsável de Teste');
  assert.match($('#message').textContent, /internet/);
});

test('telefone duplicado informa conflito, preserva preenchimento e permite corrigir', async t => {
  const page = setup(async () => ({ ok: false, json: async () => ({ error: 'Este telefone já tem uma confirmação.' }) }));
  t.after(() => page.dom.window.close());
  page.submit(); await tick();
  assert.match(page.$('#message').textContent, /já tem uma confirmação/);
  assert.equal(page.$('#rsvp').hidden, false);
  assert.equal(page.$('[type=submit]').disabled, false);
  assert.equal(page.$('#phone').value, '21999990001');
});

test('regressão: eventos de envio repetidos enquanto a requisição está em curso fazem um único POST', async t => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const page = setup(() => response);
  t.after(() => page.dom.window.close());
  page.choose('yes'); page.fill(0, 'Acompanhante válido', '10+');
  const form = page.$('#rsvp');
  form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new page.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(page.requests.length, 1);
  release({ ok: true, json: async () => ({ total: 2 }) });
  await tick();
});
