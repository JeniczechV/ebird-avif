// Vygeneruje data/taxonomy.json: párování druhů mezi eBirdem a AVIFem.
// Spuštění: node tools/build-taxonomy.mjs  (nepotřebuje klíč, obě taxonomie jsou veřejné)
// Volitelně z uložených souborů: node tools/build-taxonomy.mjs ebird.json avif.json
import { readFile, writeFile } from 'node:fs/promises';
import { buildTaxonomy } from '../src/lib/taxonomy-build.js';

const load = (file, url) =>
  file ? readFile(file, 'utf8').then(JSON.parse) : fetch(url).then((r) => r.json());

const [ebird, avif] = await Promise.all([
  load(process.argv[2], 'https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json'),
  load(process.argv[3], 'https://avif.birds.cz/api/v3/codebook/taxons'),
]);

const { table, unmatched } = buildTaxonomy(ebird, avif);
await writeFile(new URL('../data/taxonomy.json', import.meta.url), JSON.stringify(table));
console.log(`eBird → AVIF: ${Object.keys(table.e2a).length} taxonů, AVIF → eBird: ${Object.keys(table.a2e).length} taxonů`);
console.log(`AVIF taxony bez protějšku v eBirdu: ${unmatched.length}`);
for (const t of unmatched) console.log(`  ${t.id}  ${t.name.la} (${t.name.cs})`);
