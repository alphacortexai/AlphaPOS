export const ACTIVITY_KEEP = 2000;

const LOCAL_ACTIVITY_KEY = 'alphapos.local.activity.v1';

export const readLocalActivity = (): unknown[] | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(LOCAL_ACTIVITY_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const writeLocalActivity = (logs: unknown[]) => {
  window.localStorage.setItem(LOCAL_ACTIVITY_KEY, JSON.stringify(logs));
};

export const trimActivity = <T,>(logs: T[]) => logs.slice(0, ACTIVITY_KEEP);
