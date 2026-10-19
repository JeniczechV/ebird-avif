import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checklistToAvif, avifListToEbirdRows, rowsToCsv, parseChecklistIds, convertCount } from '../src/lib/convert.js';

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const taxonomy = json('../data/taxonomy.json');
const checklist = json('./fixtures/ebird-checklist.json');
const feed = json('./fixtures/ebird-feed.json');
const avifList = json('./fixtures/avif-list.json');

test('ID checklistů z textu i odkazů', () => {
  assert.deepEqual(parseChecklistIds('https://ebird.org/checklist/S403294570, S1234567 S403294570'), ['S403294570', 'S1234567']);
});

test('počty', () => {
  assert.equal(convertCount('12'), '12');
  assert.equal(convertCount('X'), null);
});

test('eBird checklist → AVIF seznam', () => {
  const loc = feed.find((f) => f.subId === checklist.subId).loc;
  const { payload, unmatched } = checklistToAvif(checklist, loc, 6046370, taxonomy, '0.1.0');
  assert.deepEqual(unmatched, []);
  assert.equal(payload.date, '2026-10-18');
  assert.equal(payload.timeStart, '09:35');
  assert.equal(payload.timeEnd, '10:31'); // 0,933 h = 56 min
  assert.equal(payload.type, 'complete');
  assert.equal(payload.observationMode, 'area');
  assert.equal(payload.distanceCovered, 3459);
  assert.equal(payload.observersNumber, 2);
  assert.equal(payload.municipalityPartId, 6046370);
  assert.equal(payload.items.length, checklist.obs.length);
  // „X“ se posílá bez počtu, číslo s počtem
  const swan = payload.items.find((i) => i.taxonId === taxonomy.e2a.mutswa);
  assert.equal(swan.count, '1');
  assert.equal(payload.items.find((i) => i.taxonId === taxonomy.e2a.gragoo).count, undefined);
  assert.match(payload.note, /S403294570/);
});

test('nespárovaný druh udělá seznam neúplným', () => {
  const cl = { ...checklist, obs: [...checklist.obs, { speciesCode: 'x00992', howManyStr: '1' }] };
  const { payload, unmatched } = checklistToAvif(cl, { latitude: 49, longitude: 16, name: 'x' }, 1, taxonomy);
  assert.deepEqual(unmatched, ['x00992']);
  assert.equal(payload.type, 'partial');
});

test('AVIF seznam → CSV pro eBird', () => {
  const { rows, unmatched } = avifListToEbirdRows(avifList, 'Ústecký kraj', taxonomy);
  assert.deepEqual(unmatched, []);
  assert.equal(rows.length, avifList.items.length);
  for (const r of rows) assert.equal(r.length, 19);
  assert.equal(rows[0][8], '10/19/2026');
  assert.equal(rows[0][10], 'US');
  assert.equal(rows[0][12], 'Stationary');
  assert.equal(rows[0][14], 26);
  assert.equal(rows[0][15], 'Y');
  assert.ok(rowsToCsv(rows).endsWith('\r\n'));
});

test('párování běžných druhů oběma směry', () => {
  assert.equal(taxonomy.avif[taxonomy.e2a.gretit1][0], 'sýkora koňadra');
  assert.equal(taxonomy.avif[taxonomy.e2a.y00696][0], 'sýkora babka/lužní');
  assert.equal(taxonomy.ebird[taxonomy.a2e[807]][0], 'Great Tit');
});
