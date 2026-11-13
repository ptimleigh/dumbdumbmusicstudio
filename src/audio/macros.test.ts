import { describe, it, expect } from 'vitest';
import { macrosToDsp } from './macros';

describe('macrosToDsp', () => {
  it('is neutral for warmth and punch at 5', () => {
    const d = macrosToDsp({ warmth: 5, punch: 5, space: 5 });
    expect(d.lowShelfDb).toBe(0);
    expect(d.highShelfDb).toBeCloseTo(0);
    expect(d.saturation).toBe(0);
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
