import { useEffect, useState } from 'react';
import { readPref, writePref } from '../prefs';

/** Like useState, but the value is remembered in this browser and comes back the next time. */
export function usePref<T>(key: string, fallback: T, valid: (v: unknown) => v is T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readPref(key, fallback, valid));
  useEffect(() => { writePref(key, value); }, [key, value]);
  return [value, setValue];
}
