// Estado, saneado y construcción de reglas declarativeNetRequest.
// Lo usan tanto el service worker como el popup.

export const STORAGE_KEY = 'state';
export const STATUS_KEY = 'status';

export const COLORS = ['#6d5efc', '#e5484d', '#12a594', '#f76b15', '#0090ff', '#d6409f', '#8e8c99', '#ffb224'];

export const OPS = ['set', 'append', 'remove'];
export const FILTER_TYPES = ['url', 'regex', 'domain'];

// Todos los tipos de recurso (si no se indican, Chrome excluye main_frame).
export const RESOURCE_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'other',
];

// Cabeceras de petición a las que Chrome permite la operación "append".
export const REQUEST_APPEND_ALLOWED = new Set([
  'accept', 'accept-encoding', 'accept-language', 'access-control-request-headers',
  'cache-control', 'connection', 'content-language', 'cookie', 'forwarded', 'if-match',
  'if-none-match', 'keep-alive', 'range', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  'user-agent', 'via', 'want-digest', 'x-forwarded-for',
]);

// RFC 7230 token
export const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const MAX_ITEMS = 200;

export const newId = () => crypto.randomUUID();

export function newHeader(partial = {}) {
  return { id: newId(), enabled: true, name: '', value: '', op: 'set', ...partial };
}

export function newFilter(partial = {}) {
  return { id: newId(), enabled: true, type: 'url', value: '', ...partial };
}

export function newProfile(index = 0, partial = {}) {
  return {
    id: newId(),
    name: `Perfil ${index + 1}`,
    color: COLORS[index % COLORS.length],
    requestHeaders: [newHeader()],
    responseHeaders: [],
    filters: [],
    ...partial,
  };
}

export function defaultState() {
  const profile = newProfile(0);
  return { paused: false, activeProfileId: profile.id, profiles: [profile] };
}

// ---------- Saneado (datos guardados o importados = no fiables) ----------

const str = (v, max = 8192) => (typeof v === 'string' ? v.slice(0, max) : '');
const arr = (v) => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);
const pickId = (v, keepIds) => (keepIds && typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : newId());

function sanitizeHeader(h, keepIds) {
  return {
    id: pickId(h?.id, keepIds),
    enabled: h?.enabled !== false,
    name: str(h?.name, 256),
    value: str(h?.value),
    op: OPS.includes(h?.op) ? h.op : 'set',
  };
}

function sanitizeFilter(f, keepIds) {
  return {
    id: pickId(f?.id, keepIds),
    enabled: f?.enabled !== false,
    type: FILTER_TYPES.includes(f?.type) ? f.type : 'url',
    value: str(f?.value, 2048),
  };
}

function sanitizeProfile(p, index, keepIds) {
  return {
    id: pickId(p?.id, keepIds),
    name: str(p?.name, 64) || `Perfil ${index + 1}`,
    color: /^#[0-9a-f]{6}$/i.test(p?.color) ? p.color : COLORS[index % COLORS.length],
    requestHeaders: arr(p?.requestHeaders).map((h) => sanitizeHeader(h, keepIds)),
    responseHeaders: arr(p?.responseHeaders).map((h) => sanitizeHeader(h, keepIds)),
    filters: arr(p?.filters).map((f) => sanitizeFilter(f, keepIds)),
  };
}

export function sanitizeState(raw) {
  const profiles = arr(raw?.profiles).map((p, i) => sanitizeProfile(p, i, true));
  if (profiles.length === 0) return defaultState();
  const activeProfileId = profiles.some((p) => p.id === raw.activeProfileId) ? raw.activeProfileId : profiles[0].id;
  return { paused: raw?.paused === true, activeProfileId, profiles };
}

// Acepta el formato propio ({profiles:[...]}), un array de perfiles o un perfil suelto,
// y también el formato de exportación de ModHeader (title/headers/respHeaders/urlFilters).
export function parseImport(raw, startIndex = 0) {
  let list;
  if (Array.isArray(raw)) list = raw;
  else if (Array.isArray(raw?.profiles)) list = raw.profiles;
  else if (raw && typeof raw === 'object') list = [raw];
  else throw new Error('Formato no reconocido');

  return list.slice(0, 50).map((p, i) => {
    const isModHeader = p && (p.title !== undefined || Array.isArray(p.headers) || Array.isArray(p.respHeaders));
    const src = isModHeader
      ? {
          name: p.title,
          color: p.backgroundColor,
          requestHeaders: arr(p.headers),
          responseHeaders: arr(p.respHeaders),
          filters: arr(p.urlFilters).map((f) => ({ enabled: f?.enabled, type: 'regex', value: f?.urlRegex })),
        }
      : p;
    return sanitizeProfile(src, startIndex + i, false);
  });
}

export async function loadState() {
  const { [STORAGE_KEY]: raw } = await chrome.storage.local.get(STORAGE_KEY);
  return sanitizeState(raw);
}

export function saveState(state) {
  return chrome.storage.local.set({ [STORAGE_KEY]: state });
}

export function activeProfile(state) {
  return state.profiles.find((p) => p.id === state.activeProfileId) ?? state.profiles[0];
}

export function countActiveHeaders(profile) {
  const n = (list) => list.filter((h) => h.enabled && h.name.trim()).length;
  return n(profile.requestHeaders) + n(profile.responseHeaders);
}

// ---------- Validación y reglas ----------

export function headerError(h, kind) {
  const name = h.name.trim();
  if (!name) return null;
  if (!HEADER_NAME_RE.test(name)) return `Nombre de cabecera inválido: "${name}"`;
  if (/[\r\n\0]/.test(h.value)) return `El valor de "${name}" contiene saltos de línea`;
  if (kind === 'request' && h.op === 'append' && !REQUEST_APPEND_ALLOWED.has(name.toLowerCase())) {
    return `Chrome no permite "añadir" en la cabecera de petición "${name}"; usa "establecer"`;
  }
  return null;
}

function headerInfos(list, kind, errors) {
  const out = [];
  for (const h of list) {
    if (!h.enabled || !h.name.trim()) continue;
    const err = headerError(h, kind);
    if (err) {
      errors.push(err);
      continue;
    }
    const info = { header: h.name.trim(), operation: h.op };
    if (h.op !== 'remove') info.value = h.value;
    out.push(info);
  }
  return out;
}

function filterConditions(filters, errors) {
  const conds = [];
  for (const f of filters) {
    const value = f.value.trim();
    if (!f.enabled || !value) continue;
    if (f.type === 'regex') {
      conds.push({ regexFilter: value, isUrlFilterCaseSensitive: false });
    } else if (f.type === 'domain') {
      const domains = value.toLowerCase().split(/[\s,]+/).filter(Boolean);
      const bad = domains.find((d) => !/^[a-z0-9.-]+$/.test(d));
      if (bad) {
        errors.push(`Dominio inválido: "${bad}" (usa punycode para dominios no ASCII)`);
        continue;
      }
      conds.push({ requestDomains: domains });
    } else {
      conds.push({ urlFilter: value, isUrlFilterCaseSensitive: false });
    }
  }
  return conds;
}

// Devuelve las reglas a instalar para el perfil activo.
export function buildRules(state) {
  const errors = [];
  if (state.paused) return { rules: [], errors };
  const profile = activeProfile(state);
  if (!profile) return { rules: [], errors };

  const requestHeaders = headerInfos(profile.requestHeaders, 'request', errors);
  const responseHeaders = headerInfos(profile.responseHeaders, 'response', errors);
  if (requestHeaders.length === 0 && responseHeaders.length === 0) return { rules: [], errors };

  const action = { type: 'modifyHeaders' };
  if (requestHeaders.length) action.requestHeaders = requestHeaders;
  if (responseHeaders.length) action.responseHeaders = responseHeaders;

  const hasFilters = profile.filters.some((f) => f.enabled && f.value.trim());
  const conds = hasFilters ? filterConditions(profile.filters, errors) : [{}];
  // Si había filtros pero todos eran inválidos, no aplicamos nada (mejor que aplicarlo a todo).

  const rules = conds.map((c, i) => ({
    id: i + 1,
    priority: 1,
    action,
    condition: { ...c, resourceTypes: RESOURCE_TYPES },
  }));
  return { rules, errors };
}
