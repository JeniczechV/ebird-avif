// Úložiště rozšíření (chrome.storage.local). Jen v prohlížeči uživatele.

const area = () => chrome.storage.local;

export const getSettings = async () => (await area().get('settings')).settings || {};
export const saveSettings = async (patch) => area().set({ settings: { ...(await getSettings()), ...patch } });

// Přenesené checklisty: eBird subId → AVIF publicId (ochrana proti duplicitám)
export const getTransferred = async () => (await area().get('transferred')).transferred || {};
export async function markTransferred(subId, publicId) {
  const t = await getTransferred();
  t[subId] = { publicId, at: new Date().toISOString() };
  await area().set({ transferred: t });
}

// Seznamy z AVIFu už vyexportované do CSV pro eBird
export const getExported = async () => (await area().get('exported')).exported || {};
export async function markExported(publicIds) {
  const e = await getExported();
  for (const id of publicIds) e[id] = new Date().toISOString();
  await area().set({ exported: e });
}
