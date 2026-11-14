import { describe, it, expect } from 'vitest';
import { bendAt, bendEnd, bendStart, cleanBend, clampSemitones, pitchWheelSteps, pitchWheelValue, slideToNext, withSemitones, withTiming } from './bend';
import type { Note } from './types';

const n = (id: string, pitch: number, start: number, duration: number): Note => ({ id, pitch, start, duration });

describe('bend', () => {
  it('slides linearly over the whole note by default', () => {
    expect(bendAt({ semitones: 4 }, 0)).toBe(0);
    expect(bendAt({ semitones: 4 }, 0.5)).toBe(2);
    expect(bendAt({ semitones: 4 }, 1)).toBe(4);
  });
  it('holds first when late', () => {
    expect(bendAt({ semitones: 4, late: true }, 0.5)).toBe(0);
    expect(bendAt({ semitones: 4, late: true }, 0.75)).toBe(2);
    expect(bendAt({ semitones: -2, late: true }, 1)).toBe(-2);
  });
  it('limits slides to an octave either way', () => {
    expect(clampSemitones(40)).toBe(12);
    expect(clampSemitones(-40)).toBe(-12);
    expect(clampSemitones(2.6)).toBe(3);
  });
  it('finds the slide to the next note', () => {
    const notes = [n('a', 60, 0, 1), n('b', 67, 1, 1), n('c', 50, 2, 1)];
    expect(slideToNext(notes[0], notes)).toBe(7);
    expect(slideToNext(notes[1], notes)).toBe(-12 /* clamped from -17 */);
    expect(slideToNext(notes[2], notes)).toBeNull();
  });
  it('skips notes that start before this one ends', () => {
    const notes = [n('a', 60, 0, 2), n('b', 64, 1, 1), n('c', 62, 2, 1)];
    expect(slideToNext(notes[0], notes)).toBe(2);
  });
  it('maps semitones to pitch wheel values', () => {
    expect(pitchWheelValue(0)).toBe(8192);
    expect(pitchWheelValue(12)).toBe(16383);
    expect(pitchWheelValue(-12)).toBe(0);
    expect(pitchWheelValue(6)).toBe(12288);
  });
  it('produces pitch wheel steps from centered to the target', () => {
    const steps = pitchWheelSteps({ semitones: 12 }, 1);
    expect(steps[0]).toEqual({ t: 0, value: 8192 });
    expect(steps[steps.length - 1].value).toBe(16383);
    expect(steps.length).toBeGreaterThan(30);
    for (let i = 1; i < steps.length; i++) expect(steps[i].t).toBeGreaterThan(steps[i - 1].t);
  });
  it('cleans bad data from files', () => {
    expect(cleanBend({ semitones: 3 })).toEqual({ semitones: 3 });
    expect(cleanBend({ semitones: 3, late: true })).toEqual({ semitones: 3, from: 0.5 }); // old files: late means start halfway
    expect(cleanBend({ semitones: 0 })).toBeUndefined();
    expect(cleanBend({ semitones: 'x' })).toBeUndefined();
    expect(cleanBend(null)).toBeUndefined();
    expect(cleanBend({ semitones: 99 })).toEqual({ semitones: 12 });
  });

  describe('start and end points', () => {
    it('glides only between from and to, holding before and after', () => {
      const b = { semitones: 8, from: 0.25, to: 0.75 };
      expect(bendAt(b, 0)).toBe(0);
      expect(bendAt(b, 0.25)).toBe(0);
      expect(bendAt(b, 0.5)).toBe(4);
      expect(bendAt(b, 0.75)).toBe(8);
      expect(bendAt(b, 1)).toBe(8);   // holds the new pitch to the end of the note
    });
    it('defaults to the whole note', () => {
      expect(bendStart({ semitones: 2 })).toBe(0);
      expect(bendEnd({ semitones: 2 })).toBe(1);
    });
    it('never lets the glide get shorter than the minimum', () => {
      expect(bendEnd({ semitones: 2, from: 0.5, to: 0.5 })).toBeCloseTo(0.55, 9);
      expect(bendStart({ semitones: 2, from: 1 })).toBeCloseTo(0.95, 9);
    });
    it('snaps to the very start and end when close', () => {
      expect(withTiming({ semitones: 3 }, 0.02, 0.98)).toEqual({ semitones: 3 });
      expect(withTiming({ semitones: 3 }, 0.3, 0.6)).toEqual({ semitones: 3, from: 0.3, to: 0.6 });
      expect(withTiming({ semitones: 3 }, 0.6, 0.3)).toEqual({ semitones: 3, from: 0.6, to: 0.65 });
    });
    it('keeps the timing when only the size changes', () => {
      expect(withSemitones({ semitones: 2, from: 0.4, to: 0.9 }, 7)).toEqual({ semitones: 7, from: 0.4, to: 0.9 });
      expect(withSemitones(undefined, 5)).toEqual({ semitones: 5 });
    });
    it('reads and cleans timing from files', () => {
      expect(cleanBend({ semitones: 4, from: 0.2, to: 0.7 })).toEqual({ semitones: 4, from: 0.2, to: 0.7 });
      expect(cleanBend({ semitones: 4, from: -5, to: 9 })).toEqual({ semitones: 4 });
      expect(cleanBend({ semitones: 4, from: 'x', to: null })).toEqual({ semitones: 4 });
    });
    it('makes pitch wheel steps that rise only inside the glide', () => {
      const steps = pitchWheelSteps({ semitones: 12, from: 0.5, to: 0.75 }, 1);
      const at = (t: number) => steps.reduce((best, s) => (Math.abs(s.t - t) < Math.abs(best.t - t) ? s : best)).value;
      expect(at(0.25)).toBe(8192);
      expect(at(0.5)).toBe(8192);
      expect(at(0.9)).toBe(16383);
      expect(at(1)).toBe(16383);
    });
  });
});
