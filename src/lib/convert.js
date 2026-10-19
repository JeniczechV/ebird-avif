// Převody dat mezi eBirdem a AVIFem. Čisté funkce bez sítě, testované v test/convert.test.js.

export const SOURCE = 'ebird-avif';

// eBird protokoly: P20 příležitostné, P21 stacionární, P22 vycházka, P23 plocha, P62 historické
const STATIONARY = 'P21';
const INCIDENTAL = 'P20';

export const checklistUrl = (subId) => `https://ebird.org/checklist/${subId}`;

// „S403294570“ z ID nebo odkazu na checklist; víc ID oddělených čímkoli
export function parseChecklistIds(text) {
  return [...new Set((text.match(/S\d{5,}/g) || []))];
}

function addMinutes(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + Math.round(minutes);
  if (total >= 24 * 60) return null; // přes půlnoc AVIF neumí, konec vynecháme
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// eBird „howManyStr“ → AVIF count. „X“ (přítomen, bez počtu) → „min 1“.
export const PRESENT_COUNT = 'min 1';

export function convertCount(howManyStr) {
  const s = String(howManyStr ?? '').trim();
  if (/^\d{1,7}$/.test(s)) return s;
  return s.toUpperCase() === 'X' ? PRESENT_COUNT : null;
}

/**
 * eBird checklist → tělo požadavku POST /list v AVIFu.
 * @param checklist odpověď /product/checklist/view/{subId}
 * @param loc lokalita {name, latitude, longitude}
 * @param municipalityPartId z reversegeocode
 * @param taxonomy data/taxonomy.json
 * @returns {{payload, unmatched: string[], skippedCount: number}}
 */
export function checklistToAvif(checklist, loc, municipalityPartId, taxonomy, version = '') {
  const [date, time] = checklist.obsDt.split(' ');
  const hasTime = checklist.obsTimeValid !== false && /^\d\d:\d\d$/.test(time || '');
  const timeStart = hasTime ? time : null;
  const timeEnd = hasTime && checklist.durationHrs ? addMinutes(time, checklist.durationHrs * 60) : null;

  const items = [];
  const unmatched = [];
  let skippedCount = 0;
  for (const o of checklist.obs || []) {
    const taxonId = taxonomy.e2a[o.speciesCode];
    if (!taxonId) {
      unmatched.push(o.speciesCode);
      skippedCount++;
      continue;
    }
    const item = { taxonId };
    const count = convertCount(o.howManyStr);
    if (count) item.count = count;
    items.push(item);
  }

  const complete = checklist.allObsReported && checklist.protocolId !== INCIDENTAL && unmatched.length === 0;
  const distanceKm = checklist.effortDistanceKm;
  const payload = {
    type: complete ? 'complete' : 'partial',
    observationMode: checklist.protocolId === STATIONARY ? 'point' : 'area',
    date,
    ...(timeStart && { timeStart }),
    ...(timeEnd && { timeEnd }),
    municipalityPartId,
    coordinates: { latitude: loc.latitude, longitude: loc.longitude },
    siteName: loc.name?.slice(0, 255) || undefined,
    ...(checklist.numObservers && { observersNumber: checklist.numObservers }),
    ...(distanceKm && { distanceCovered: Math.round(distanceKm * 1000) }),
    note: `Převedeno z eBirdu: ${checklistUrl(checklist.subId)}`,
    items,
    source: SOURCE,
    sourceVersion: version,
  };
  return { payload, unmatched, skippedCount };
}

// ---------- AVIF → eBird (CSV ve formátu eBird Record Format) ----------

// Kraje ČR: název z reversegeocode → kód státu/provincie v eBirdu
export const REGION_CODES = {
  'Hlavní město Praha': 'PR', 'Středočeský kraj': 'ST', 'Jihočeský kraj': 'JC', 'Plzeňský kraj': 'PL',
  'Karlovarský kraj': 'KA', 'Ústecký kraj': 'US', 'Liberecký kraj': 'LI', 'Královéhradecký kraj': 'KR',
  'Pardubický kraj': 'PA', 'Kraj Vysočina': 'VY', 'Jihomoravský kraj': 'JM', 'Olomoucký kraj': 'OL',
  'Zlínský kraj': 'ZL', 'Moravskoslezský kraj': 'MO',
};

function regionCode(name) {
  if (!name) return '';
  return REGION_CODES[name.replace(/ \(kraj\)$/, '')] || '';
}

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function minutesBetween(a, b) {
  if (!a || !b) return '';
  const [h1, m1] = a.split(':').map(Number);
  const [h2, m2] = b.split(':').map(Number);
  const d = h2 * 60 + m2 - (h1 * 60 + m1);
  return d > 0 ? d : '';
}

// AVIF count → eBird Number. Jen přesné číslo, jinak „X“ (přítomen).
// „min 1“ je v AVIFu náš zápis eBirdího „X“, takže se vrací zpět jako „X“.
function ebirdNumber(count) {
  const s = String(count ?? '').trim();
  if (/^\d+$/.test(s)) return s;
  if (/^min\.?\s?1$/.test(s)) return 'X';
  const m = s.match(/^(?:cca|min\.?|>)\s?(\d+)$/);
  return m ? m[1] : 'X';
}

/**
 * Seznam z AVIFu → řádky CSV pro import do eBirdu (19 sloupců, bez hlavičky).
 * @param list odpověď GET /list/{publicId} (data)
 * @param regionName název kraje z reversegeocode
 * @returns {{rows: string[][], unmatched: number[]}}
 */
export function avifListToEbirdRows(list, regionName, taxonomy) {
  const d = new Date(list.date);
  const date = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  const coords = list.location?.coordinates || {};
  const protocol = list.observationMode === 'point' ? 'Stationary' : list.distanceCovered ? 'Traveling' : 'Stationary';
  const hasEffort = Boolean(list.timeStart && list.timeEnd);
  const complete = list.type === 'complete' && hasEffort ? 'Y' : 'N';
  const miles = list.distanceCovered ? (list.distanceCovered / 1609.344).toFixed(2) : '';
  const comments = [list.note, `Převedeno z AVIFu: https://avif.birds.cz/list/${list.publicId}`].filter(Boolean).join(' | ');

  const rows = [];
  const unmatched = [];
  for (const it of list.items || []) {
    const code = taxonomy.a2e[it.taxonId];
    if (!code) {
      unmatched.push(it.taxonId);
      continue;
    }
    const [comName, sciName] = taxonomy.ebird[code];
    const [genus, ...rest] = sciName.split(' ');
    rows.push([
      comName, genus, rest.join(' '), ebirdNumber(it.count), it.note || '',
      list.siteName || `AVIF ${list.publicId}`, coords.latitude ?? '', coords.longitude ?? '',
      date, list.timeStart || '', regionCode(regionName), 'CZ',
      hasEffort ? protocol : 'Incidental', list.observersNumber || 1,
      hasEffort ? minutesBetween(list.timeStart, list.timeEnd) : '', complete,
      hasEffort && protocol === 'Traveling' ? miles : '', '', comments,
    ]);
  }
  return { rows, unmatched };
}

export const rowsToCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
