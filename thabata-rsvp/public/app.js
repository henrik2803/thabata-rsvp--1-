const form = document.querySelector('#rsvp');
const message = document.querySelector('#message');
const fields = document.querySelector('#family-fields');
const list = document.querySelector('#companions');
const submitButton = form.querySelector('button[type="submit"]');
const addButton = document.querySelector('#add-companion');
let nextId = 0;
let submitting = false;

function count() {
  const total = 1 + (fields.hidden ? 0 : list.children.length);
  document.querySelector('#group-total').textContent = `Sua confirmação: ${total} ${total === 1 ? 'pessoa' : 'pessoas'}.`;
  addButton.disabled = list.children.length >= 20;
}

function add() {
  if (list.children.length >= 20) return;
  const id = ++nextId;
  const row = document.createElement('div');
  row.className = 'companion';
  row.innerHTML = `<label for="companion-${id}">Nome do acompanhante</label><input id="companion-${id}" class="companion-name" minlength="2" maxlength="100" required placeholder="Nome de quem vai com você"><label for="age-${id}">Faixa etária</label><select id="age-${id}" required><option value="">Selecione</option><option value="0-4">0 a 4 anos</option><option value="5-9">5 a 9 anos</option><option value="10+">10 anos ou mais</option></select><button type="button" class="remove">Remover acompanhante</button>`;
  row.querySelector('button').onclick = () => { row.remove(); count(); };
  list.append(row);
  count();
}

function syncCompanions() {
  fields.hidden = form.elements.namedItem('bringing').value !== 'yes';
  if (!fields.hidden && !list.children.length) add();
  // Hidden required fields must neither block native validation nor enter the payload.
  list.querySelectorAll('input,select').forEach(element => { element.disabled = fields.hidden; });
  count();
}

form.querySelectorAll('[name=bringing]').forEach(radio => { radio.onchange = syncCompanions; });
addButton.onclick = add;
syncCompanions();

form.addEventListener('submit', async event => {
  event.preventDefault();
  // Disabling the button alone does not block another submit event in flight.
  if (submitting || form.hidden) return;
  if (!form.reportValidity()) return;
  submitting = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Confirmando…';
  message.textContent = '';

  try {
    const companions = fields.hidden ? [] : [...list.children].map(row => ({
      name: row.querySelector('input').value,
      ageGroup: row.querySelector('select').value,
    }));
    const response = await fetch('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.elements.namedItem('name').value,
        phone: form.elements.namedItem('phone').value,
        consent: form.elements.namedItem('consent').checked,
        companions,
      }),
    });
    const data = await response.json().catch(() => { throw Error('O servidor não respondeu como esperado. Tente novamente em instantes.'); });
    if (!response.ok) throw Error(typeof data?.error === 'string' ? data.error : 'Não foi possível confirmar. Tente novamente em instantes.');
    if (!Number.isInteger(data?.total) || data.total < 1) throw Error('Não foi possível verificar a confirmação. Tente novamente em instantes.');
    form.hidden = true;
    document.querySelector('#success').hidden = false;
    document.querySelector('#success p').textContent = `${data.total === 1 ? 'Sua presença está confirmada' : `Seu grupo de ${data.total} pessoas está confirmado`}. Nos vemos dia 23/11, às 19h!`;
  } catch (error) {
    message.textContent = error?.name === 'TypeError'
      ? 'Não foi possível conectar. Verifique sua internet e tente novamente.'
      : error.message;
  } finally {
    submitting = false;
    submitButton.disabled = false;
    submitButton.textContent = 'Confirmar minha presença ↗';
  }
});
