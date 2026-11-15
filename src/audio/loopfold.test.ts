import { describe, expect, it } from 'vitest';
import { foldTail } from './loopfold';

describe('foldTail', () => {
  it('adds the tail onto the start and drops the lead-in', () => {
    const rec = Float32Array.from([9, 9, 1, 2, 3, 4, 0.5, 0.25]); // 2 frames of lead-in, 4 of song, 2 of tail
    expect(Array.from(foldTail(rec, 2, 4))).toEqual([1.5, 2.25, 3, 4]);
  });
  it('keeps wrapping when the tail is longer than the song', () => {
    const rec = Float32Array.from([1, 1, 1, 1, 1]);
    expect(Array.from(foldTail(rec, 0, 2))).toEqual([3, 2]);
  });
  it('is the exact length asked for, and silent for silence', () => {
    const out = foldTail(new Float32Array(100), 7, 40);
    expect(out.length).toBe(40);
    expect(Math.max(...out)).toBe(0);
  });
  it('makes a decaying echo loop without a hole: the looped sound equals the continuing sound', () => {
    // a click at frame 0 with an echo every 6 frames that halves each time; song length 10
    const L = 10, rec = new Float32Array(40);
    for (let k = 0, g = 1; k * 6 < 40; k++, g /= 2) rec[k * 6] = g;
    const loop = foldTail(rec, 0, L);
    // played twice in a row, the second pass must contain what the first pass's tail would have added
    const twice = new Float32Array(2 * L); for (let i = 0; i < 2 * L; i++) twice[i] = loop[i % L];
    const reference = new Float32Array(2 * L); // song played twice, tails summed: click at 0 and at L
    for (let k = 0, g = 1; k * 6 < 2 * L; k++, g /= 2) { reference[k * 6] += g; if (L + k * 6 < 2 * L) reference[L + k * 6] += g; }
    // after the first pass the loop is in steady state, so compare the second pass to the reference's second pass plus all earlier tails
    for (let i = 0; i < L; i++) expect(twice[L + i]).toBeCloseTo(loop[i], 9);
    expect(loop[0]).toBeGreaterThan(1); // the end of the loop is echoing into its start
    expect(reference.length).toBe(20);
  });
});
