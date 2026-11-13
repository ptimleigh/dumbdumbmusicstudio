import { describe, it, expect } from 'vitest';
import { macrosToDsp } from './macros';

describe('macrosToDsp', () => {
  it('is neutral for warmth and punch at 5', () => {
    const d = macrosToDsp({ warmth: 5, punch: 5, space: 5 });
    expect(d.lowShelfDb).toBe(0);
    expect(d.highShelfDb).toBeCloseTo(0);
    expect(d.saturation).toBe(0);
    expect(d.presenceDb).toBe(0);
    expect(d.compRatio).toBe(1);
  });
  it('warmth boosts lows and cuts highs', () => {
    const d = macrosToDsp({ warmth: 10, punch: 5, space: 5 });
    expect(d.lowShelfDb).toBeGreaterThan(0);
    expect(d.highShelfDb).toBeLessThan(0);
  });
  it('space 0 is fully dry, more space is wetter', () => {
    expect(macrosToDsp({ warmth: 5, punch: 5, space: 0 }).reverbMix).toBe(0);
    expect(macrosToDsp({ warmth: 5, punch: 5, space: 10 }).reverbMix)
      .toBeGreaterThan(macrosToDsp({ warmth: 5, punch: 5, space: 3 }).reverbMix);
  });
});

describe('loudness compensation', () => {
  it('adds makeup gain when warmth is high so the tone change is not a volume change', () => {
    expect(macrosToDsp({ warmth: 10, punch: 5, space: 0 }).makeupDb).toBeGreaterThan(3);
  });
  it('trims level as punch and space increase', () => {
    expect(macrosToDsp({ warmth: 5, punch: 10, space: 0 }).makeupDb).toBeLessThan(0);
    expect(macrosToDsp({ warmth: 5, punch: 5, space: 10 }).makeupDb).toBeLessThan(0);
  });
  it('punch softens the tone below 5 and sharpens it above 5', () => {
    expect(macrosToDsp({ warmth: 5, punch: 0, space: 5 }).presenceDb).toBeLessThan(0);
    expect(macrosToDsp({ warmth: 5, punch: 10, space: 5 }).presenceDb).toBeGreaterThan(0);
  });
});
