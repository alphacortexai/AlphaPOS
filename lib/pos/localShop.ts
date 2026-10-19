const STORAGE_KEY = 'alphapos.local.v1';

export const LOCAL_OPERATOR_ID = 'local-counter';

export const readLocalShop = (): Record<string, unknown> | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
};

export const writeLocalShop = (data: unknown) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};
