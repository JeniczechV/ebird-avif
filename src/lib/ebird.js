// Klient eBird API 2.0 (jen čtení). Každý uživatel má vlastní klíč z https://ebird.org/api/keygen.

const BASE = 'https://api.ebird.org/v2';

// Kraje ČR v eBirdu. Když denní přehled za celou ČR narazí na strop 200, ptáme se po krajích.
export const CZ_REGIONS = ['CZ-PR', 'CZ-ST', 'CZ-JC', 'CZ-PL', 'CZ-KA', 'CZ-US', 'CZ-LI', 'CZ-KR', 'CZ-PA', 'CZ-VY', 'CZ-JM', 'CZ-OL', 'CZ-ZL', 'CZ-MO'];
const FEED_LIMIT = 200;

export class EbirdError extends Error {}

export function createEbird(apiKey, fetchFn = fetch) {
  async function get(path) {
    const res = await fetchFn(BASE + path, { headers: { 'X-eBirdApiToken': apiKey } });
    if (res.status === 401 || res.status === 403) throw new EbirdError('eBird odmítl API klíč. Zkontroluj ho v nastavení.');
    if (!res.ok) throw new EbirdError(`eBird vrátil chybu ${res.status} pro ${path}`);
    return res.json();
  }

  // Checklisty v regionu za jeden den (nejvýš 200)
  const feed = (region, date) => {
    const [y, m, d] = date.split('-').map(Number);
    return get(`/product/lists/${region}/${y}/${m}/${d}?maxResults=${FEED_LIMIT}`);
  };

  // Všechny checklisty v ČR za den; při plném výsledku dotaz po krajích
  async function czFeed(date) {
    const all = await feed('CZ', date);
    if (all.length < FEED_LIMIT) return all;
    const parts = await Promise.all(CZ_REGIONS.map((r) => feed(r, date)));
    const bySub = new Map(parts.flat().map((c) => [c.subId, c]));
    return [...bySub.values()];
  }

  return {
    // Ověření klíče: malý dotaz na taxonomii jednoho druhu
    async check() {
      await get('/ref/taxonomy/ebird?fmt=json&species=gretit1');
      return true;
    },

    checklist: (subId) => get(`/product/checklist/view/${subId}`),

    // Moje checklisty v ČR za posledních `days` dní podle zobrazovaného jména v eBirdu
    async findMine(displayName, days, today = new Date()) {
      const name = displayName.trim().toLowerCase();
      const dates = Array.from({ length: days }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      const out = [];
      for (const date of dates) {
        for (const c of await czFeed(date)) if (c.userDisplayName?.trim().toLowerCase() === name) out.push(c);
      }
      return out;
    },

    // Lokalita checklistu. API detailu checklistu souřadnice nevrací, proto je hledáme
    // v denním přehledu kraje (funguje i pro soukromé lokality), u hotspotů záložně v jejich detailu.
    async location(checklist) {
      const date = checklist.obsDt.slice(0, 10);
      const region = checklist.subnational1Code;
      if (region) {
        const found = (await feed(region, date)).find((c) => c.subId === checklist.subId);
        if (found) return { name: found.loc.name, latitude: found.loc.latitude, longitude: found.loc.longitude, countryCode: found.loc.countryCode };
      }
      try {
        const h = await get(`/ref/hotspot/info/${checklist.locId}`);
        return { name: h.name, latitude: h.latitude, longitude: h.longitude, countryCode: h.countryCode };
      } catch {
        throw new EbirdError(`Nepodařilo se zjistit souřadnice lokality checklistu ${checklist.subId}.`);
      }
    },
  };
}
