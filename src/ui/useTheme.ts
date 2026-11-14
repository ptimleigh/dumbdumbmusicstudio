import { useEffect, useState } from 'react';

type Pref = 'system' | 'light' | 'dark';
const KEY = 'dumbdumb.theme';

const read = (): Pref => {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
};

/** Dark or light. Follows the computer's setting until the person picks one with the toggle. */
export function useTheme() {
  const [pref, setPref] = useState<Pref>(read);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', pref);
    try { if (pref === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch { /* ignore */ }
  }, [pref]);
  const effective = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
  return { theme: effective, toggle: () => setPref(effective === 'dark' ? 'light' : 'dark') };
}
