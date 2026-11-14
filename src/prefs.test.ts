import { describe, it, expect } from 'vitest';
import { isBool, numberBetween, oneOf, readPref, writePref } from './prefs';

const store = (init: Record<string, string> = {}) => {
  const d = new Map(Object.entries(init));
  return { getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => { d.set(k, v); }, d };
};

describe('remembered settings', () => {
  it('uses the fallback when nothing was saved', () => {
    expect(readPref('lock', true, isBool, store())).toBe(true);
  });
  it('remembers a value, including false', () => {
    const s = store();
    writePref('lock', false, s);
    expect(readPref('lock', true, isBool, s)).toBe(false);   // a saved "off" must not turn back into the default "on"
  });
  it('ignores damaged or wrong-looking values', () => {
    expect(readPref('lock', true, isBool, store({ 'dumbdumb.pref.lock': '{oops' }))).toBe(true);
    expect(readPref('lock', true, isBool, store({ 'dumbdumb.pref.lock': '"yes"' }))).toBe(true);
    expect(readPref('len', 1, oneOf(0.25, 0.5, 1, 2, 4), store({ 'dumbdumb.pref.len': '3' }))).toBe(1);
    expect(readPref('rowH', 20, numberBetween(14, 44), store({ 'dumbdumb.pref.rowH': '500' }))).toBe(20);
  });
  it('accepts valid choices', () => {
    expect(readPref('snap', 'auto', oneOf<'auto' | number>('auto', 0.5, 0.25), store({ 'dumbdumb.pref.snap': '0.5' }))).toBe(0.5);
    expect(readPref('snap', 'auto', oneOf<'auto' | number>('auto', 0.5, 0.25), store({ 'dumbdumb.pref.snap': '"auto"' }))).toBe('auto');
    expect(readPref('rowH', 20, numberBetween(14, 44), store({ 'dumbdumb.pref.rowH': '30' }))).toBe(30);
  });
  it('does not crash when storage is blocked', () => {
    expect(readPref('lock', true, isBool, null)).toBe(true);
    expect(() => writePref('lock', false, null)).not.toThrow();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readPref('lock', true, isBool, broken)).toBe(true);
    expect(() => writePref('lock', false, broken)).not.toThrow();
  });
});
