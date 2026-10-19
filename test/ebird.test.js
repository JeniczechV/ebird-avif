import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEbird, CZ_REGIONS } from '../src/lib/ebird.js';

const reply = (body, status = 200, headers = {}) => ({ ok: status < 400, status, json: async () => body, headers: { get: (h) => headers[h] ?? null } });
const noSleep = { sleep: async () => {} };

test('findMine filtruje podle jména a při stropu 200 se ptá po krajích', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.includes('/lists/CZ/')) return reply(Array.from({ length: 200 }, (_, i) => ({ subId: `S${i}`, userDisplayName: 'Někdo' })));
    if (url.includes('/lists/CZ-JM/')) return reply([{ subId: 'S999', userDisplayName: 'Jan Valach ' }]);
    return reply([]);
  };
  const found = await createEbird('k', fake, noSleep).findMine('jan valach', 1, new Date('2026-10-18T12:00:00Z'));
  assert.deepEqual(found.map((f) => f.subId), ['S999']);
  assert.equal(calls.length, 1 + CZ_REGIONS.length);
  assert.ok(calls[0].endsWith('/product/lists/CZ/2026/10/18?maxResults=200'));
});

test('po 429 počká a zkusí znovu, kraje se ptají postupně', async () => {
  let calls = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const waits = [];
  const fake = async (url) => {
    calls++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    if (calls === 1) return reply({}, 429, { 'Retry-After': '3' });
    if (url.includes('/lists/CZ/')) return reply(Array.from({ length: 200 }, (_, i) => ({ subId: `S${i}`, userDisplayName: 'X' })));
    return reply([]);
  };
  const ebird = createEbird('k', fake, { sleep: async (ms) => waits.push(ms) });
  await ebird.findMine('jan', 1, new Date('2026-10-18T12:00:00Z'));
  assert.equal(maxInFlight, 1);
  assert.ok(waits.includes(3000)); // respektuje Retry-After
  // druhé hledání stejného dne jde z paměti
  const before = calls;
  await ebird.findMine('jan', 1, new Date('2026-10-18T12:00:00Z'));
  assert.equal(calls, before);
});

test('opakované 429 skončí srozumitelnou chybou', async () => {
  await assert.rejects(createEbird('k', async () => reply({}, 429), noSleep).checklist('S1'), /příliš mnoho/);
});

test('špatný klíč dá srozumitelnou chybu', async () => {
  await assert.rejects(createEbird('x', async () => reply({}, 403), noSleep).check(), /API klíč/);
});
