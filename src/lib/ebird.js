// Klient eBird API 2.0 (jen čtení). Každý uživatel má vlastní klíč z https://ebird.org/api/keygen.

const BASE = 'https://api.ebird.org/v2';

// Kraje ČR v eBirdu. Když denní přehled za celou ČR narazí na strop 200, ptáme se po krajích.
export const CZ_REGIONS = ['CZ-PR', 'CZ-ST', 'CZ-JC', 'CZ-PL', 'CZ-KA', 'CZ-US', 'CZ-LI', 'CZ-KR', 'CZ-PA', 'CZ-VY', 'CZ-JM', 'CZ-OL', 'CZ-ZL', 'CZ-MO'];
const FEED_LIMIT = 200;

// eBird omezuje počet dotazů (HTTP 429). Dotazy proto posíláme po jednom s pauzou
// a po odmítnutí chvíli počkáme a zkusíme to znovu.
const PAUSE_MS = 250;
const RETRIES = 4;
const FEED_CACHE_MS = 10 * 60 * 1000;

export class EbirdError extends Error {}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function createEbird(apiKey, fetchFn = fetch, { sleep = wait } = {}) {
  let lastCall = 0;

  async function get(path) {
    for (let attempt = 0; ; attempt++) {
      const gap = lastCall + PAUSE_MS - Date.now();
      if (gap > 0) await sleep(gap);
      lastCall = Date.now();
      const res = await fetchFn(BASE + path, { headers: { 'X-eBirdApiToken': apiKey } });
      if (res.status === 401 || res.status === 403) throw new EbirdError('eBird odmítl API klíč. Zkontroluj ho v nastavení.');
      if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
        const retryAfter = Number(res.headers?.get?.('Retry-After'));
        await sleep(retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt); // 2, 4, 8, 16 s
        continue;
      }
      if (res.status === 429) throw new EbirdError('eBird teď odmítá další dotazy (příliš mnoho najednou). Zkus to za pár minut, případně s kratším obdobím.');
      if (!res.ok) throw new EbirdError(`eBird vrátil chybu ${res.status} pro ${path}`);
      return res.json();
    }
  }

  // Checklisty v regionu za jeden den (nejvýš 200). Krátkodobě si je pamatujeme,
  // aby opakované hledání a dohledání lokality neposílaly stejné dotazy znovu.
  const feedCache = new Map();
  async function feed(region, date) {
    const key = `${region}/${date}`;
    const hit = feedCache.get(key);
    if (hit && Date.now() - hit.at < FEED_CACHE_MS) return hit.data;
    const [y, m, d] = date.split('-').map(Number);
    const data = await get(`/product/lists/${region}/${y}/${m}/${d}?maxResults=${FEED_LIMIT}`);
    feedCache.set(key, { at: Date.now(), data });
    return data;
  }

  // Všechny checklisty v ČR za den; při plném výsledku dotaz po krajích (postupně, ne naráz)
  async function czFeed(date) {
    const all = await feed('CZ', date);
    if (all.length < FEED_LIMIT) return all;
    const bySub = new Map(all.map((c) => [c.subId, c]));
    for (const r of CZ_REGIONS) for (const c of await feed(r, date)) bySub.set(c.subId, c);
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
    // `onProgress(i, total, date)` hlásí, který den se právě prochází
    async findMine(displayName, days, today = new Date(), onProgress) {
      const name = displayName.trim().toLowerCase();
      const dates = Array.from({ length: days }, (_, i) => {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      const out = [];
      for (const [i, date] of dates.entries()) {
        onProgress?.(i + 1, dates.length, date);
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
