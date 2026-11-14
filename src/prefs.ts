/** Editor preferences (like "Stay in key") that belong to the person, not to a song, and are remembered between visits. */

const PREFIX = 'dumbdumb.pref.';

type Reader = Pick<Storage, 'getItem'>;
type Writer = Pick<Storage, 'setItem'>;

const browserStorage = (): Storage | null => { try { return localStorage; } catch { return null; } };

/** The saved value, or the fallback if there is none, it is damaged, or it is not a valid value for this setting. */
export function readPref<T>(key: string, fallback: T, valid: (v: unknown) => v is T, storage: Reader | null = browserStorage()): T {
  try {
    const raw = storage?.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const v: unknown = JSON.parse(raw);
    return valid(v) ? v : fallback;
  } catch { return fallback; }
}

export function writePref<T>(key: string, value: T, storage: Writer | null = browserStorage()) {
  try { storage?.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage blocked or full: the setting just won't be remembered */ }
}

export const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
export const oneOf = <T extends string | number>(...options: T[]) => (v: unknown): v is T => options.includes(v as T);
export const numberBetween = (lo: number, hi: number) => (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
