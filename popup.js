import {
  STATUS_KEY, OPS, loadState, saveState, newProfile, newHeader, newFilter,
  activeProfile, countActiveHeaders, headerError, parseImport, defaultState,
} from './shared.js';

const $ = (sel) => document.querySelector(sel);

const OP_LABELS = { set: 'Establecer', append: 'Añadir', remove: 'Eliminar' };
const FILTER_LABELS = { url: 'Patrón URL', regex: 'Regex', domain: 'Dominios' };
const FILTER_PLACEHOLDERS = {
  url: '||example.com/api/*',
  regex: '^https://.*\\.example\\.com/',
  domain: 'example.com, api.example.com',
};

let state;
let status = { errors: [], ruleCount: 0 };
let saveTimer;

// ---------- Persistencia ----------

function save({ now = false } = {}) {
  clearTimeout(saveTimer);
  if (now) return saveState(state);
  saveTimer = setTimeout(() => saveState(state), 250);
}
function flush() {
  if (saveTimer) save({ now: true });
}
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => document.hidden && flush());

// ---------- DOM helper (nunca usa innerHTML con datos del usuario) ----------

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') n[k] = v;
    else n.setAttribute(k, v);
  }
  n.append(...children);
  return n;
}

const trashIcon = () => {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M4 4l8 8M12 4l-8 8');
  svg.append(path);
  return svg;
};

// ---------- Render ----------

function render() {
  renderRail();
  renderTop();
  renderSection('requestHeaders');
  renderSection('responseHeaders');
  renderSection('filters');
  renderStatus();
}

function renderRail() {
  const current = activeProfile(state);
  const dots = state.profiles.map((p) =>
    el('button', {
      class: 'profile-dot' + (p.id === current.id ? ' active' : ''),
      style: `--c:${p.color}`,
      title: p.name,
      'aria-label': `Perfil ${p.name}`,
      onclick: () => {
        state.activeProfileId = p.id;
        save({ now: true });
        render();
      },
    }, (p.name.trim()[0] || '?').toUpperCase()),
  );
  $('#profiles').replaceChildren(...dots);
}

function renderTop() {
  const p = activeProfile(state);
  $('#profileName').value = p.name;
  $('#profileColor').value = p.color;
  $('.swatch').style.background = p.color;
  $('#pause').setAttribute('aria-pressed', String(state.paused));
  $('#pause').title = state.paused ? 'Reanudar' : 'Pausar';
  $('#paused').hidden = !state.paused;
  document.body.classList.toggle('paused', state.paused);
  document.documentElement.style.setProperty('--accent', p.color);
}

function renderSection(kind) {
  const p = activeProfile(state);
  const list = p[kind];
  const container = document.querySelector(`section[data-kind="${kind}"] .rows`);
  if (list.length === 0) {
    container.replaceChildren(el('div', { class: 'empty' }, kind === 'filters' ? 'Sin filtros.' : 'Sin cabeceras.'));
    return;
  }
  const rows = list.map((item) => (kind === 'filters' ? filterRow(list, item) : headerRow(list, item, kind)));
  container.replaceChildren(...rows);
}

function headerRow(list, h, kind) {
  const headerKind = kind === 'requestHeaders' ? 'request' : 'response';
  const row = el('div', { class: 'row' + (h.enabled ? '' : ' off') });

  const validate = () => {
    const err = headerError(h, headerKind);
    nameInput.classList.toggle('invalid', !!err);
    nameInput.title = err ?? '';
  };

  const nameInput = el('input', {
    type: 'text', value: h.name, placeholder: 'Nombre', list: 'common-headers',
    spellcheck: 'false', 'aria-label': 'Nombre de la cabecera',
    oninput: (e) => { h.name = e.target.value; validate(); save(); },
  });
  const valueInput = el('input', {
    type: 'text', value: h.value, placeholder: 'Valor', spellcheck: 'false',
    disabled: h.op === 'remove', 'aria-label': 'Valor de la cabecera',
    oninput: (e) => { h.value = e.target.value; validate(); save(); },
  });
  const opSelect = el('select', {
    'aria-label': 'Operación',
    onchange: (e) => {
      h.op = e.target.value;
      valueInput.disabled = h.op === 'remove';
      validate();
      save();
    },
  }, ...OPS.map((op) => el('option', { value: op }, OP_LABELS[op])));
  opSelect.value = h.op;

  row.append(
    el('input', {
      type: 'checkbox', checked: h.enabled, 'aria-label': 'Activar cabecera',
      onchange: (e) => { h.enabled = e.target.checked; row.classList.toggle('off', !h.enabled); save(); },
    }),
    nameInput,
    valueInput,
    opSelect,
    el('button', {
      class: 'del', title: 'Quitar', 'aria-label': 'Quitar cabecera',
      onclick: () => { list.splice(list.indexOf(h), 1); save({ now: true }); renderSection(kind); },
    }, trashIcon()),
  );
  validate();
  return row;
}

function filterRow(list, f) {
  const row = el('div', { class: 'row filter' + (f.enabled ? '' : ' off') });
  const valueInput = el('input', {
    type: 'text', value: f.value, placeholder: FILTER_PLACEHOLDERS[f.type], spellcheck: 'false',
    'aria-label': 'Valor del filtro',
    oninput: (e) => { f.value = e.target.value; save(); },
  });
  const typeSelect = el('select', {
    'aria-label': 'Tipo de filtro',
    onchange: (e) => { f.type = e.target.value; valueInput.placeholder = FILTER_PLACEHOLDERS[f.type]; save(); },
  }, ...Object.entries(FILTER_LABELS).map(([v, label]) => el('option', { value: v }, label)));
  typeSelect.value = f.type;

  row.append(
    el('input', {
      type: 'checkbox', checked: f.enabled, 'aria-label': 'Activar filtro',
      onchange: (e) => { f.enabled = e.target.checked; row.classList.toggle('off', !f.enabled); save(); },
    }),
    typeSelect,
    valueInput,
    el('button', {
      class: 'del', title: 'Quitar', 'aria-label': 'Quitar filtro',
      onclick: () => { list.splice(list.indexOf(f), 1); save({ now: true }); renderSection('filters'); },
    }, trashIcon()),
  );
  return row;
}

function renderStatus() {
  const box = $('#errors');
  const errors = status?.errors ?? [];
  box.hidden = errors.length === 0;
  box.replaceChildren(el('ul', {}, ...errors.map((e) => el('li', {}, e))));

  const p = activeProfile(state);
  const active = !state.paused && (status?.ruleCount ?? 0) > 0;
  const n = countActiveHeaders(p);
  const text = state.paused
    ? 'En pausa'
    : active
      ? `Activo · ${n} cabecera${n === 1 ? '' : 's'} · ${status.ruleCount} regla${status.ruleCount === 1 ? '' : 's'}`
      : 'Sin cabeceras activas';
  $('#footer').replaceChildren(el('span', { class: 'dot' + (active ? ' on' : '') }), el('span', {}, text));
}

// ---------- Acciones ----------

function addItem(kind) {
  const p = activeProfile(state);
  p[kind].push(kind === 'filters' ? newFilter() : newHeader());
  save({ now: true });
  renderSection(kind);
  const inputs = document.querySelectorAll(`section[data-kind="${kind}"] .row input[type="text"]`);
  inputs[kind === 'filters' ? inputs.length - 1 : inputs.length - 2]?.focus();
}

function addProfile() {
  const p = newProfile(state.profiles.length);
  state.profiles.push(p);
  state.activeProfileId = p.id;
  save({ now: true });
  render();
  $('#profileName').select();
}

function duplicateProfile() {
  const src = activeProfile(state);
  const [copy] = parseImport(structuredClone(src), state.profiles.length);
  copy.name = `${src.name} (copia)`.slice(0, 64);
  copy.color = src.color;
  state.profiles.push(copy);
  state.activeProfileId = copy.id;
  save({ now: true });
  render();
}

function deleteProfile() {
  const p = activeProfile(state);
  if (!confirm(`¿Eliminar el perfil "${p.name}"?`)) return;
  state.profiles = state.profiles.filter((x) => x.id !== p.id);
  if (state.profiles.length === 0) {
    const fresh = defaultState();
    state.profiles = fresh.profiles;
  }
  state.activeProfileId = state.profiles[0].id;
  save({ now: true });
  render();
}

function exportProfiles() {
  const data = JSON.stringify({ app: 'reqheader', version: 1, profiles: state.profiles }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = el('a', { href: url, download: 'reqheader-perfiles.json' });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importProfiles(file) {
  try {
    const raw = JSON.parse(await file.text());
    const imported = parseImport(raw, state.profiles.length);
    if (imported.length === 0) throw new Error('No hay perfiles en el archivo');
    state.profiles.push(...imported);
    state.activeProfileId = imported[0].id;
    save({ now: true });
    render();
    $('#importBanner').hidden = true;
  } catch (e) {
    alert(`No se pudo importar: ${e.message}`);
  }
}

// El selector de archivos cierra el popup de la extensión, así que la importación
// se hace desde una pestaña normal con la misma interfaz.
const IN_TAB = location.hash === '#tab' || location.hash === '#import';

function startImport() {
  if (IN_TAB) {
    $('#importFile').click();
    return;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL('popup.html#import') });
  window.close();
}

// ---------- Menú ----------

function setMenu(open) {
  $('#menu').hidden = !open;
  $('#menuBtn').setAttribute('aria-expanded', String(open));
}

function wire() {
  $('#addProfile').addEventListener('click', addProfile);

  $('#profileName').addEventListener('input', (e) => {
    activeProfile(state).name = e.target.value;
    renderRail();
    save();
  });
  $('#profileColor').addEventListener('input', (e) => {
    activeProfile(state).color = e.target.value;
    renderTop();
    renderRail();
    save();
  });

  $('#pause').addEventListener('click', () => {
    state.paused = !state.paused;
    save({ now: true });
    renderTop();
    renderStatus();
  });

  document.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => addItem(b.dataset.add)),
  );

  $('#menuBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    setMenu($('#menu').hidden);
  });
  document.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setMenu(false));

  $('#menu').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    setMenu(false);
    if (action === 'duplicate') duplicateProfile();
    else if (action === 'export') exportProfiles();
    else if (action === 'import') startImport();
    else if (action === 'delete') deleteProfile();
  });

  $('#importFile').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) importProfiles(file);
    e.target.value = '';
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && STATUS_KEY in changes) {
      status = changes[STATUS_KEY].newValue ?? status;
      renderStatus();
    }
  });
}

// ---------- Init ----------

state = await loadState();
({ [STATUS_KEY]: status = status } = await chrome.storage.local.get(STATUS_KEY));
if (IN_TAB) document.documentElement.classList.add('tab');
wire();
render();
if (location.hash === '#import') {
  const box = $('#importBanner');
  box.hidden = false;
  box.querySelector('button').addEventListener('click', () => $('#importFile').click());
}
// Persistimos el estado saneado (crea el perfil por defecto en la primera ejecución).
save({ now: true });
