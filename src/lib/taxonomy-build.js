// Párování taxonomie eBird (Clements) ↔ AVIF (ČSO). Používá ho jen tools/build-taxonomy.mjs.

// Ruční výjimky: eBird speciesCode → AVIF taxonId. Tam, kde se latinská jména liší
// nebo AVIF vede jen domácí formu či poddruh.
export const OVERRIDES = {
  rocpig: 603, // Columba livia → holub domácí
  rocpig1: 603, // Columba livia (Feral Pigeon) → holub domácí
  hoocro1: 10005, // Corvus cornix → vrána obecná šedá
  y00743: 844, // Corvus corone/cornix → vrána obecná
  rerswa8: 10048, // Cecropis rufula → vlaštovka skalní
  swagoo1: 10094, // Anser cygnoides → husa čínská
  swagoo2: 10094,
  musduc: 10031, // Cairina moschata → pižmovka domácí
  musduc3: 10031,
  redjun: 10099, // Gallus gallus → kur domácí
  redjun1: 10099,
  whiwag1: 10111, // White Wagtail (White-faced) → konipas bílý evropský
  blueth1: 10035, // Bluethroat (Red-spotted) → slavík modráček tundrový
  blueth2: 10034, // Bluethroat (White-spotted) → slavík modráček středoevropský
  comred3: 10007, // Redpoll (flammea) → čečetka zimní
  y00468: 329, // Anser fabalis/serrirostris → husa polní/tundrová
  taibeg5: 10133, // Taiga Bean-Goose (Western) → husa polní s. s.
  y00696: 10079, // Poecile palustris/montanus → sýkora babka/lužní
  lesred1: 10006, // Redpoll (Lesser) → čečetka tmavá
  y00386: 567, // Larus cachinnans/argentatus/michahellis → racek stříbř./běloh./středom.
  purswa2: 10214, // Porphyrio madagascariensis → slípka africká
  gragoo1: 10158, // Anser anser (Domestic type) → husa domácí
};

// Ruční výjimky pro opačný směr: AVIF taxonId → eBird speciesCode
export const REVERSE_OVERRIDES = {
  869: 'redpol1', // čečetka zimní/tmavá → Redpoll
  10309: 'tunbeg1', // husa tundrová ssp. rossicus → Tundra Bean-Goose
};

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// „Anser fabalis/Anser serrirostris“ i „Anser fabalis/serrirostris“ → „anser fabalis/serrirostris“
function normSlash(s) {
  const parts = norm(s).split('/');
  if (parts.length < 2) return norm(s);
  const genus = parts[0].split(' ')[0];
  return parts.map((p, i) => (i > 0 && p.startsWith(genus + ' ') ? p.slice(genus.length + 1) : p)).join('/');
}

// Kandidátní latinská jména, pod kterými může taxon eBirdu být v AVIFu
function candidates(e) {
  const sci = e.sciName;
  const out = [sci, normSlash(sci)];
  if (e.category === 'spuh') out.push(sci.replace(/ sp\.$/, '')); // „Larus sp.“ → rod „Larus“
  if (e.category === 'domestic') out.push(sci.replace(/ \(.*\)$/, '') + ' f. domestica');
  return out.map(norm);
}

export function buildTaxonomy(ebird, avif) {
  const avifByLa = new Map();
  for (const t of avif) {
    if (!t.id || t.isHybrid) continue;
    avifByLa.set(normSlash(t.name.la), t);
  }
  const avifById = new Map(avif.map((t) => [t.id, t]));
  const ebirdByCode = new Map(ebird.map((e) => [e.speciesCode, e]));

  const e2a = {};
  for (const e of ebird) {
    if (e.category === 'hybrid') continue;
    let id = OVERRIDES[e.speciesCode];
    if (!id) id = candidates(e).map((c) => avifByLa.get(c)?.id).find(Boolean);
    // Poddruh nebo forma bez protějšku → druh, ke kterému patří
    if (!id && e.reportAs) id = OVERRIDES[e.reportAs] || avifByLa.get(norm(ebirdByCode.get(e.reportAs)?.sciName || ''))?.id;
    if (id && avifById.has(id)) e2a[e.speciesCode] = id;
  }

  // Opačný směr: přednost má taxon eBirdu se stejnou úrovní (druh před poddruhem)
  const rank = { species: 0, slash: 1, spuh: 2, domestic: 3, issf: 4, form: 5, intergrade: 6 };
  const a2e = {};
  for (const [code, id] of Object.entries(e2a)) {
    const e = ebirdByCode.get(code);
    const cur = a2e[id] && ebirdByCode.get(a2e[id]);
    const exact = norm(e.sciName) === normSlash(avifById.get(id).name.la);
    const curExact = cur && norm(cur.sciName) === normSlash(avifById.get(id).name.la);
    if (!cur || (exact && !curExact) || (exact === curExact && (rank[e.category] ?? 9) < (rank[cur.category] ?? 9))) a2e[id] = code;
  }

  for (const [id, code] of Object.entries(REVERSE_OVERRIDES)) if (ebirdByCode.has(code)) a2e[id] = code;

  const used = new Set([...Object.keys(e2a), ...Object.values(a2e)]);
  const ebirdNames = {};
  for (const code of used) {
    const e = ebirdByCode.get(code);
    ebirdNames[code] = [e.comName, e.sciName];
  }
  const avifNames = {};
  for (const id of new Set([...Object.values(e2a), ...Object.keys(a2e).map(Number)])) {
    const t = avifById.get(id);
    avifNames[id] = [t.name.cs, t.name.la];
  }

  const unmatched = avif.filter((t) => t.genusId && t.classId === 254 && !t.isHybrid && !a2e[t.id]);
  return { table: { e2a, a2e, ebird: ebirdNames, avif: avifNames }, unmatched };
}
