import { createEbird } from './lib/ebird.js';
import { login, createAvif, reverseGeocode } from './lib/avif.js';
import { checklistToAvif, avifListToEbirdRows, rowsToCsv, parseChecklistIds, checklistUrl } from './lib/convert.js';
import { getSettings, saveSettings, getTransferred, markTransferred, unmarkTransferred, getExported, markExported } from './lib/storage.js';

const $ = (sel) => document.querySelector(sel);
const VERSION = chrome.runtime.getManifest().version;
const avifListUrl = (id) => `https://avif.birds.cz/list/${id}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (iso) => new Date(iso.slice(0, 10) + 'T12:00:00').toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' });

let taxonomy;
let settings = {};

function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.className = `status ${kind}`;
}

// ---------- záložky ----------

function showTab(name) {
  for (const s of document.querySelectorAll('main > section')) s.hidden = s.id !== name;
  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === name);
  location.hash = name;
}
for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => showTab(b.dataset.tab));

// ---------- účty ----------

const ebirdClient = () => {
  if (!settings.ebirdKey) throw new Error('Nejdřív vlož eBird API klíč v záložce Účty.');
  return createEbird(settings.ebirdKey);
};

const avifClient = () => {
  if (!settings.avifTokens) throw new Error('Nejdřív se přihlas k AVIFu v záložce Účty.');
  return createAvif(settings.avifTokens, (avifTokens) => {
    settings.avifTokens = avifTokens;
    return saveSettings({ avifTokens });
  });
};

$('#ebird-save').addEventListener('click', async () => {
  const status = $('#ebird-status');
  const ebirdKey = $('#ebird-key').value.trim();
  const ebirdName = $('#ebird-name').value.trim();
  if (!ebirdKey || !ebirdName) return setStatus(status, 'Vyplň klíč i jméno.', 'error');
  setStatus(status, 'Ověřuji…');
  try {
    await createEbird(ebirdKey).check();
    await saveSettings({ ebirdKey, ebirdName });
    Object.assign(settings, { ebirdKey, ebirdName });
    setStatus(status, 'Uloženo, klíč funguje.', 'ok');
  } catch (e) {
    setStatus(status, e.message, 'error');
  }
});

function renderAvifAccount() {
  const logged = Boolean(settings.avifTokens);
  $('#avif-logged').hidden = !logged;
  $('#avif-login').hidden = logged;
  $('#avif-user').textContent = settings.avifName || '';
}

$('#avif-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const status = $('#avif-status');
  setStatus(status, 'Přihlašuji…');
  try {
    const t = await login($('#avif-username').value.trim(), $('#avif-password').value);
    const avifTokens = { access_token: t.access_token, refresh_token: t.refresh_token };
    settings.avifTokens = avifTokens;
    const me = await avifClient().identity();
    settings.avifName = me.name || me.username;
    await saveSettings({ avifTokens: settings.avifTokens, avifName: settings.avifName });
    $('#avif-password').value = '';
    setStatus(status, 'Přihlášeno.', 'ok');
    renderAvifAccount();
  } catch (e) {
    delete settings.avifTokens;
    setStatus(status, e.message, 'error');
  }
});

$('#avif-logout').addEventListener('click', async () => {
  delete settings.avifTokens;
  delete settings.avifName;
  await saveSettings({ avifTokens: null, avifName: null });
  renderAvifAccount();
});

// ---------- eBird → AVIF ----------

// Připravené checklisty: subId → { checklist, loc, unit, conversion, error }
let prepared = new Map();

async function prepare(ebird, subId, loc) {
  const checklist = await ebird.checklist(subId);
  loc = loc || (await ebird.location(checklist));
  if (loc.countryCode && loc.countryCode !== 'CZ') return { checklist, loc, error: 'Mimo Česko, AVIF bere jen pozorování z ČR.' };
  const unit = await reverseGeocode(loc.latitude, loc.longitude);
  if (!unit) return { checklist, loc, error: 'Souřadnice neodpovídají žádné obci v ČR.' };
  const conversion = checklistToAvif(checklist, loc, unit.municipalityPart.id, taxonomy, VERSION);
  return { checklist, loc, unit, conversion };
}

async function loadChecklists(entries) {
  const status = $('#to-avif-status');
  const ebird = ebirdClient();
  prepared = new Map();
  $('#checklists').innerHTML = '';
  $('#send-bar').hidden = true;
  let i = 0;
  for (const { subId, loc } of entries) {
    setStatus(status, `Načítám checklist ${++i} z ${entries.length}…`);
    try {
      prepared.set(subId, await prepare(ebird, subId, loc));
    } catch (e) {
      prepared.set(subId, { error: e.message });
    }
  }
  await renderChecklists();
  setStatus(status, entries.length ? `Načteno ${entries.length} checklistů.` : 'Žádné checklisty nenalezeny.', entries.length ? 'ok' : 'warn');
}

async function renderChecklists() {
  const transferred = await getTransferred();
  const html = [...prepared].map(([subId, p]) => {
    const done = transferred[subId];
    const c = p.conversion;
    const sendable = c && !p.error && !done;
    let badge = '';
    if (done) badge = `<a class="badge done" href="${avifListUrl(done.publicId)}" target="_blank" rel="noopener">V AVIFu</a>
      <button class="link resend" title="Použij, když jsi seznam v AVIFu smazal(a)">Přenést znovu</button>`;
    else if (p.error) badge = `<span class="badge error">Nelze přenést</span>`;
    else if (c.unmatched.length) badge = `<span class="badge warn">${c.unmatched.length} druhů nespárováno</span>`;
    const when = p.checklist ? `${fmtDate(p.checklist.obsDt)}${c?.payload.timeStart ? ' ' + c.payload.timeStart : ''}` : subId;
    const where = p.loc ? `${esc(p.loc.name)}${p.unit ? ' · ' + esc(p.unit.municipalityPart.name) : ''}` : '';
    const species = c
      ? c.payload.items.map((it) => `<li>${esc(taxonomy.avif[it.taxonId]?.[0])}${it.count ? ' – ' + esc(it.count) : ''}</li>`).join('') +
        c.unmatched.map((code) => `<li class="unmatched">${esc(code)} – nemá protějšek v AVIFu, doplň ručně</li>`).join('')
      : '';
    return `<div class="card" data-sub="${esc(subId)}">
      <header>
        <input type="checkbox" ${sendable ? 'checked' : 'disabled'} aria-label="Vybrat ${esc(subId)}">
        <div class="meta">
          <div class="title">${esc(when)}</div>
          <div class="sub">${where}</div>
          <div class="sub">${p.error ? esc(p.error) : `${c.payload.items.length} druhů · ${c.payload.type === 'complete' ? 'kompletní seznam' : 'částečný seznam'}`}
            · <a href="${checklistUrl(subId)}" target="_blank" rel="noopener">${esc(subId)}</a></div>
        </div>
        ${badge}
      </header>
      ${species ? `<details><summary>Náhled druhů</summary><ul class="species">${species}</ul></details>` : ''}
    </div>`;
  });
  $('#checklists').innerHTML = html.join('');
  $('#send-bar').hidden = ![...prepared.values()].some((p) => p.conversion && !p.error);
}

$('#checklists').addEventListener('click', async (ev) => {
  if (!ev.target.classList.contains('resend')) return;
  const subId = ev.target.closest('.card').dataset.sub;
  if (!confirm('Opravdu přenést znovu? Pokud seznam v AVIFu pořád existuje, vznikne duplicita.')) return;
  await unmarkTransferred(subId);
  await renderChecklists();
});

$('#find').addEventListener('click', async () => {
  const status = $('#to-avif-status');
  try {
    if (!settings.ebirdName) throw new Error('Nejdřív vyplň své jméno v eBirdu v záložce Účty.');
    const ebird = ebirdClient();
    setStatus(status, 'Hledám checklisty…');
    const found = await ebird.findMine(settings.ebirdName, Number($('#days').value));
    await loadChecklists(found.map((f) => ({ subId: f.subId, loc: { name: f.loc.name, latitude: f.loc.latitude, longitude: f.loc.longitude, countryCode: f.loc.countryCode } })));
  } catch (e) {
    setStatus(status, e.message, 'error');
  }
});

$('#load-ids').addEventListener('click', async () => {
  const ids = parseChecklistIds($('#ids').value);
  if (!ids.length) return setStatus($('#to-avif-status'), 'Nenašel jsem žádné ID checklistu (tvar S123456789).', 'error');
  try {
    await loadChecklists(ids.map((subId) => ({ subId })));
  } catch (e) {
    setStatus($('#to-avif-status'), e.message, 'error');
  }
});

$('#send').addEventListener('click', async () => {
  const status = $('#to-avif-status');
  const selected = [...document.querySelectorAll('#checklists .card')].filter((c) => c.querySelector('input:checked')).map((c) => c.dataset.sub);
  if (!selected.length) return setStatus(status, 'Nic není vybráno.', 'warn');
  if (!confirm(`Odeslat ${selected.length} seznam(ů) do AVIFu? Budou veřejně viditelné podle nastavení tvého účtu.`)) return;
  const btn = $('#send');
  btn.disabled = true;
  let ok = 0;
  try {
    const avif = avifClient();
    const transferred = await getTransferred();
    for (const subId of selected) {
      if (transferred[subId]) continue; // pojistka proti duplicitě
      setStatus(status, `Odesílám ${ok + 1} z ${selected.length}…`);
      const list = await avif.createList(prepared.get(subId).conversion.payload);
      await markTransferred(subId, list.publicId);
      ok++;
    }
    setStatus(status, `Hotovo: ${ok} seznamů je v AVIFu.`, 'ok');
  } catch (e) {
    setStatus(status, `Odesláno ${ok}, pak chyba: ${e.message}`, 'error');
  } finally {
    btn.disabled = false;
    await renderChecklists();
  }
});

// ---------- AVIF → eBird ----------

let avifLists = [];
const FROM_EBIRD = 'Převedeno z eBirdu';

async function renderAvifLists() {
  const exported = await getExported();
  $('#avif-lists').innerHTML = avifLists.map((l) => {
    const fromEbird = (l.note || '').includes(FROM_EBIRD);
    const done = exported[l.publicId];
    const badge = fromEbird ? '<span class="badge">Pochází z eBirdu</span>' : done ? '<span class="badge done">Exportováno</span>' : '';
    return `<div class="card" data-id="${esc(l.publicId)}">
      <header>
        <input type="checkbox" ${fromEbird ? 'disabled' : done ? '' : 'checked'} aria-label="Vybrat ${esc(l.publicId)}">
        <div class="meta">
          <div class="title">${esc(fmtDate(l.date))}${l.timeStart ? ' ' + esc(l.timeStart) : ''}</div>
          <div class="sub">${esc(l.siteName || 'bez názvu lokality')} · ${l.speciesCount ?? '?'} druhů ·
            <a href="${avifListUrl(l.publicId)}" target="_blank" rel="noopener">${esc(l.publicId)}</a></div>
        </div>
        ${badge}
      </header>
    </div>`;
  }).join('');
  $('#export-bar').hidden = !avifLists.length;
}

$('#avif-find').addEventListener('click', async () => {
  const status = $('#to-ebird-status');
  try {
    const avif = avifClient();
    setStatus(status, 'Načítám seznamy…');
    const days = Number($('#avif-days').value);
    avifLists = [];
    for (let page = 1; ; page++) {
      const r = await avif.myLists(days, page);
      avifLists.push(...r.items);
      if (page >= r.pageCount) break;
    }
    await renderAvifLists();
    setStatus(status, avifLists.length ? `Načteno ${avifLists.length} seznamů.` : 'Žádné seznamy za zvolené období.', avifLists.length ? 'ok' : 'warn');
  } catch (e) {
    setStatus(status, e.message, 'error');
  }
});

$('#export').addEventListener('click', async () => {
  const status = $('#to-ebird-status');
  const selected = [...document.querySelectorAll('#avif-lists .card')].filter((c) => c.querySelector('input:checked')).map((c) => c.dataset.id);
  if (!selected.length) return setStatus(status, 'Nic není vybráno.', 'warn');
  try {
    const avif = avifClient();
    const rows = [];
    const unmatched = new Set();
    let i = 0;
    for (const id of selected) {
      setStatus(status, `Připravuji seznam ${++i} z ${selected.length}…`);
      const list = await avif.getList(id);
      const c = list.location?.coordinates;
      const unit = c ? await reverseGeocode(c.latitude, c.longitude) : null;
      const r = avifListToEbirdRows(list, unit?.region?.name, taxonomy);
      rows.push(...r.rows);
      r.unmatched.forEach((t) => unmatched.add(t));
    }
    const blob = new Blob([rowsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `avif-pro-ebird-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click();
    URL.revokeObjectURL(a.href);
    await markExported(selected);
    await renderAvifLists();
    const warn = unmatched.size ? ` ${unmatched.size} taxonů nemá protějšek v eBirdu a v souboru chybí.` : '';
    setStatus(status, `Staženo ${rows.length} pozorování z ${selected.length} seznamů. Nahraj soubor na ebird.org/import.${warn}`, warn ? 'warn' : 'ok');
  } catch (e) {
    setStatus(status, e.message, 'error');
  }
});

// ---------- start ----------

(async () => {
  taxonomy = await fetch(chrome.runtime.getURL('data/taxonomy.json')).then((r) => r.json());
  settings = await getSettings();
  $('#ebird-key').value = settings.ebirdKey || '';
  $('#ebird-name').value = settings.ebirdName || '';
  renderAvifAccount();
  const ready = settings.ebirdKey && settings.avifTokens;
  showTab(location.hash.slice(1) || (ready ? 'to-avif' : 'settings'));
})();
