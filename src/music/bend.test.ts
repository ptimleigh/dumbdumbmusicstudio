import { describe, it, expect } from 'vitest';
import { bendAt, cleanBend, clampSemitones, pitchWheelSteps, pitchWheelValue, slideToNext } from './bend';
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
    expect(cleanBend({ semitones: 3, late: true })).toEqual({ semitones: 3, late: true });
    expect(cleanBend({ semitones: 0 })).toBeUndefined();
    expect(cleanBend({ semitones: 'x' })).toBeUndefined();
    expect(cleanBend(null)).toBeUndefined();
    expect(cleanBend({ semitones: 99 })).toEqual({ semitones: 12 });
  });
});
