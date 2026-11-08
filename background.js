import { STORAGE_KEY, STATUS_KEY, loadState, buildRules, activeProfile, countActiveHeaders } from './shared.js';

const dnr = chrome.declarativeNetRequest;

// Serializa las sincronizaciones para que no se pisen.
let queue = Promise.resolve();
function scheduleSync() {
  queue = queue.then(sync).catch((e) => console.error('[ReqHeader] sync', e));
  return queue;
}

async function replaceRules(rules) {
  const existing = await dnr.getDynamicRules();
  await dnr.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules });
}

async function sync() {
  const state = await loadState();
  const { rules, errors } = buildRules(state);
  let installed = rules;

  try {
    await replaceRules(rules);
  } catch (e) {
    // updateDynamicRules es atómico: si una regla falla, ninguna se aplica.
    // Reintentamos una a una para aislar la(s) que fallan.
    await replaceRules([]);
    installed = [];
    const before = errors.length;
    for (const rule of rules) {
      try {
        await dnr.updateDynamicRules({ addRules: [rule] });
        installed.push(rule);
      } catch (err) {
        const c = rule.condition;
        const what = c.regexFilter ?? c.urlFilter ?? c.requestDomains?.join(', ') ?? 'regla';
        errors.push(`Filtro "${what}": ${err.message}`);
      }
    }
    if (errors.length === before) errors.push(e.message);
  }

  await chrome.storage.local.set({
    [STATUS_KEY]: { errors, ruleCount: installed.length, updatedAt: Date.now() },
  });
  await updateBadge(state, installed.length);
}

async function updateBadge(state, ruleCount) {
  const profile = activeProfile(state);
  if (state.paused) {
    await chrome.action.setBadgeBackgroundColor({ color: '#8e8c99' });
    await chrome.action.setBadgeText({ text: 'off' });
    return;
  }
  const count = ruleCount > 0 ? countActiveHeaders(profile) : 0;
  await chrome.action.setBadgeBackgroundColor({ color: profile?.color ?? '#6d5efc' });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
}

chrome.runtime.onInstalled.addListener(scheduleSync);
chrome.runtime.onStartup.addListener(scheduleSync);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && STORAGE_KEY in changes) scheduleSync();
});
