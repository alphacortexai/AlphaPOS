const STORAGE_KEY = 'alphapos.catalogKey.v1';

const readMap = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).flatMap(([id, value]) => (
      typeof value === 'string' && value.trim() ? [[id, value.trim()]] : []
    )));
  } catch {
    return {};
  }
};

export const readOwnerCatalogKey = (ownerUid: string) => readMap()[ownerUid] || '';

export const writeOwnerCatalogKey = (ownerUid: string, value: string) => {
  const map = readMap();
  const next = value.trim();
  if (next) map[ownerUid] = next;
  else delete map[ownerUid];
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
};

export const catalogKeyError = (value: string) => {
  const next = value.trim();
  if (!next) return '';
  if (next.length < 20 || next.length > 200 || /\s/.test(next)) return 'Paste the Gemini API key from Google AI Studio.';
  return '';
};
