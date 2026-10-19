import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEbird, CZ_REGIONS } from '../src/lib/ebird.js';

const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('findMine filtruje podle jména a při stropu 200 se ptá po krajích', async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.includes('/lists/CZ/')) return reply(Array.from({ length: 200 }, (_, i) => ({ subId: `S${i}`, userDisplayName: 'Někdo' })));
    if (url.includes('/lists/CZ-JM/')) return reply([{ subId: 'S999', userDisplayName: 'Jan Valach ' }]);
    return reply([]);
  };
  const found = await createEbird('k', fake).findMine('jan valach', 1, new Date('2026-10-18T12:00:00Z'));
  assert.deepEqual(found.map((f) => f.subId), ['S999']);
  assert.equal(calls.length, 1 + CZ_REGIONS.length);
  assert.ok(calls[0].endsWith('/product/lists/CZ/2026/10/18?maxResults=200'));
});

test('špatný klíč dá srozumitelnou chybu', async () => {
  await assert.rejects(createEbird('x', async () => reply({}, 403)).check(), /API klíč/);
});
