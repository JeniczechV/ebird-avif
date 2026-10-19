// Klient API AVIFu (https://avif.birds.cz/api/v3/docs/). Přihlášení účtem birds.cz.

const LOGIN = 'https://login.birds.cz/api/v1';
const API = 'https://avif.birds.cz/api/v3';
const PROJECTS = 'https://projekty.birds.cz/api/v1';

export class AvifError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function readError(res) {
  try {
    const b = await res.json();
    return b.error?.cs || b.message?.cs || b.errorDetail || JSON.stringify(b);
  } catch {
    return `HTTP ${res.status}`;
  }
}

// Přihlášení jménem a heslem → { access_token, refresh_token }. Heslo se nikam neukládá.
export async function login(username, password, fetchFn = fetch) {
  const res = await fetchFn(`${LOGIN}/token`, json({ username, password }));
  if (!res.ok) throw new AvifError(res.status === 401 ? 'Špatné jméno nebo heslo k birds.cz.' : await readError(res), res.status);
  return res.json();
}

// Obec (část obce) podle souřadnic. Veřejné, bez přihlášení.
export async function reverseGeocode(latitude, longitude, fetchFn = fetch) {
  const res = await fetchFn(`${PROJECTS}/tools/reversegeocode`, json({ language: 'cs', fields: ['territorialUnit'], coordinates: { latitude, longitude } }));
  if (res.status === 400 || res.status === 404) return null; // mimo ČR
  if (!res.ok) throw new AvifError(`Určení obce selhalo (${res.status}).`, res.status);
  const b = await res.json();
  return b.success ? b.territorialUnit : null;
}

/**
 * Klient s tokeny. `tokens` = { access_token, refresh_token }, `onTokens` se zavolá po obnově,
 * aby se nové tokeny uložily.
 */
export function createAvif(tokens, onTokens, fetchFn = fetch) {
  let current = tokens;

  async function refresh() {
    const res = await fetchFn(`${LOGIN}/refresh`, json({ refresh_token: current.refresh_token }));
    if (!res.ok) throw new AvifError('Přihlášení k AVIFu vypršelo. Přihlas se znovu.', 401);
    const b = await res.json();
    current = { access_token: b.access_token, refresh_token: b.refresh_token || current.refresh_token };
    await onTokens?.(current);
  }

  async function call(url, init = {}, retry = true) {
    const res = await fetchFn(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${current.access_token}` } });
    if (res.status === 401 && retry) {
      await refresh();
      return call(url, init, false);
    }
    if (!res.ok) throw new AvifError(await readError(res), res.status);
    return res.json();
  }

  return {
    identity: () => call(`${LOGIN}/identity`),
    createList: async (payload) => {
      const b = await call(`${API}/list`, json(payload));
      return b.data ?? b;
    },
    getList: async (publicId) => {
      const b = await call(`${API}/list/${publicId}`);
      return b.data ?? b;
    },
    // Moje seznamy, nejnovější první
    myLists: (days, page = 1) =>
      call(`${API}/search/lists`, json({ page, pageSize: 100, sort: [{ field: 'date', order: 'desc' }], filter: { tags: ['my'], dateNDays: days } })),
  };
}
