import { describe, it, expect } from 'vitest';
import { afterStep, nextStep, normalizeRegion, positionAt, snapBeat, type Anchor, type Region } from './transport';

/** Plays a whole run through the same two functions the engine uses and returns the beats scheduled, in order. */
function run(from: number, loop: Region | null, total: number, steps: number) {
  let cursor = from; const out: [number, number][] = []; let wraps = 0;
  for (let i = 0; i < steps; i++) {
    const { to, atEnd } = nextStep(cursor, loop, total);
    out.push([cursor, to]);
    const next = afterStep(to, atEnd, loop);
    if (next.wrapped) wraps++;
    cursor = next.cursor;
    if (next.finished) return { out, wraps, finished: true };
  }
  return { out, wraps, finished: false };
}

describe('stepping', () => {
  it('plays a song once from the start and finishes', () => {
    const r = run(0, null, 4, 100);
    expect(r.finished).toBe(true);
    expect(r.out[0]).toEqual([0, 0.5]);
    expect(r.out[r.out.length - 1][1]).toBe(4);
    expect(r.wraps).toBe(0);
  });
  it('starts from the middle', () => {
    const r = run(2.25, null, 4, 100);
    expect(r.out[0][0]).toBe(2.25);
    expect(r.finished).toBe(true);
    expect(r.out.length).toBeLessThan(6);
  });
  it('loops a region forever, never leaving it', () => {
    const r = run(4, { start: 4, end: 6 }, 16, 40);
    expect(r.finished).toBe(false);
    expect(r.wraps).toBeGreaterThanOrEqual(8);
    for (const [a, b] of r.out) { expect(a).toBeGreaterThanOrEqual(4); expect(b).toBeLessThanOrEqual(6); }
  });
  it('plays the whole song then wraps when looping without a region', () => {
    const r = run(0, { start: 0, end: 4 }, 4, 20);
    expect(r.wraps).toBeGreaterThanOrEqual(2);
  });
  it('starting after the loop end jumps back into the loop', () => {
    const r = run(10, { start: 2, end: 4 }, 16, 6);
    expect(r.out[0]).toEqual([10, 10]);   // nothing to play here, wrap
    expect(r.out[1][0]).toBe(2);
    expect(r.wraps).toBeGreaterThanOrEqual(1);
  });
  it('covers every beat in the region exactly once per pass, with no gaps or overlaps', () => {
    const r = run(1, { start: 1, end: 3.25 }, 8, 12);
    let expected = 1;
    for (const [a, b] of r.out) {
      if (b === a) { expect(a).toBeGreaterThanOrEqual(3.25 - 1e-9); expected = 1; continue; }
      expect(a).toBeCloseTo(expected, 9);
      expected = b >= 3.25 - 1e-9 ? 1 : b;
    }
  });
});

describe('regions', () => {
  it('keeps regions inside the song and at least half a beat long', () => {
    expect(normalizeRegion(null, 16)).toBeNull();
    expect(normalizeRegion({ start: 6, end: 2 }, 16)).toEqual({ start: 2, end: 6 });
    expect(normalizeRegion({ start: -3, end: 40 }, 16)).toEqual({ start: 0, end: 16 });
    expect(normalizeRegion({ start: 4, end: 4.1 }, 16)).toEqual({ start: 4, end: 4.5 });
    expect(normalizeRegion({ start: 15.9, end: 16 }, 16)).toEqual({ start: 15.5, end: 16 });
  });
});

describe('position', () => {
  const spb = 0.5;
  it('follows the clock from where playback started', () => {
    const a: Anchor[] = [{ time: 10, beat: 4, spb }];
    expect(positionAt(a, 10)).toBe(4);
    expect(positionAt(a, 11)).toBe(6);
  });
  it('jumps back after a loop wrap', () => {
    const a: Anchor[] = [{ time: 10, beat: 4, spb }, { time: 11, beat: 4, spb }]; // wrapped back to beat 4 after one second
    expect(positionAt(a, 10.5)).toBe(5);
    expect(positionAt(a, 11.5)).toBe(5);
  });
  it('uses the new speed after a tempo change without jumping', () => {
    const a: Anchor[] = [{ time: 0, beat: 0, spb: 0.5 }, { time: 2, beat: 4, spb: 1 }];
    expect(positionAt(a, 2)).toBe(4);
    expect(positionAt(a, 4)).toBe(6);
  });
  it('is at the first anchor before playback begins', () => {
    expect(positionAt([{ time: 10, beat: 3, spb }], 9.9)).toBeCloseTo(3 - 0.2, 6);
    expect(positionAt([], 5)).toBe(0);
  });
});

describe('snapping', () => {
  it('snaps to the grid and stays inside the song', () => {
    expect(snapBeat(2.3, 0.25, 16)).toBe(2.25);
    expect(snapBeat(-4, 0.25, 16)).toBe(0);
    expect(snapBeat(99, 0.5, 16)).toBe(16);
  });
});
