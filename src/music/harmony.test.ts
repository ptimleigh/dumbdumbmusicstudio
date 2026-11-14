import { describe, it, expect } from 'vitest';
import { chordScaleOf, detectChord, findClashes, lastChord, ROMAN, suggestNext, triadPitches } from './harmony';
import { exampleProject, newTrack } from './project';

describe('chords', () => {
  it('builds triads from the key', () => {
    expect(triadPitches(0, 0, 'major')).toEqual([48, 52, 55]);   // C E G
    expect(triadPitches(5, 0, 'major')).toEqual([57, 60, 64]);   // A C E
    expect(triadPitches(0, 0, 'minor')).toEqual([48, 51, 55]);   // C Eb G
    expect(triadPitches(0, 2, 'major')).toEqual([50, 54, 57]);   // D F# A
  });
  it('uses major chords for pentatonic and chromatic moods', () => {
    expect(chordScaleOf('pentatonic')).toBe('major');
    expect(chordScaleOf('chromatic')).toBe('major');
    expect(chordScaleOf('minor')).toBe('minor');
    expect(ROMAN.major).toHaveLength(7);
  });
  it('recognizes a chord in any octave and ignores doubled notes', () => {
    expect(detectChord([60, 64, 67], 0, 'major')).toBe(0);
    expect(detectChord([57, 60, 64, 76], 0, 'major')).toBe(5);
    expect(detectChord([55, 59, 62], 0, 'major')).toBe(4);
    expect(detectChord([60, 62], 0, 'major')).toBeNull();
    expect(detectChord([60, 61, 67], 0, 'major')).toBeNull();
  });
  it('finds the last chord of the example song', () => {
    const p = exampleProject();
    expect(lastChord(p.tracks[1].notes, 4, p.key, p.scaleName)).toBe(4); // G major, the V chord
    expect(lastChord([], 4, 0, 'major')).toBeNull();
  });
});

describe('suggestions', () => {
  it('starts on the home chord', () => {
    expect(suggestNext(null, 'major')[0].degree).toBe(0);
  });
  it('resolves V back to I', () => {
    expect(suggestNext(4, 'pentatonic')[0].degree).toBe(0);
    expect(suggestNext(4, 'minor')[0].degree).toBe(0);
  });
  it('never suggests the chord you just played', () => {
    for (const scale of ['major', 'minor'] as const)
      for (let d = 0; d < 7; d++) expect(suggestNext(d, scale).map(s => s.degree)).not.toContain(d);
  });
  it('only suggests chords that exist', () => {
    for (const scale of ['major', 'minor'] as const)
      for (let d = -0; d < 7; d++) for (const s of suggestNext(d, scale)) expect(s.degree).toBeGreaterThanOrEqual(0), expect(s.degree).toBeLessThan(7);
  });
});

describe('clashes', () => {
  const melody = newTrack('melody'); const chords = newTrack('chords');
  chords.notes = [{ id: 'c1', pitch: 60, start: 0, duration: 4 }];
  it('flags a note a semitone away that sounds at the same time', () => {
    melody.notes = [{ id: 'm1', pitch: 61, start: 1, duration: 1 }, { id: 'm2', pitch: 64, start: 1, duration: 1 }];
    const c = findClashes(melody, [chords]);
    expect(c.has('m1')).toBe(true);
    expect(c.get('m1')?.otherPitch).toBe(60);
    expect(c.has('m2')).toBe(false);
  });
  it('flags a major seventh but not a note that is far away', () => {
    melody.notes = [{ id: 'a', pitch: 71, start: 0, duration: 1 }, { id: 'b', pitch: 73, start: 0, duration: 1 }];
    const c = findClashes(melody, [chords]);
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
  });
  it('ignores notes that do not overlap in time and drum tracks', () => {
    melody.notes = [{ id: 'x', pitch: 61, start: 4, duration: 1 }];
    expect(findClashes(melody, [chords]).size).toBe(0);
    const drums = newTrack('drums'); drums.notes = [{ id: 'k', pitch: 61, start: 4, duration: 0.25 }];
    expect(findClashes(melody, [drums]).size).toBe(0);
    expect(findClashes(drums, [chords]).size).toBe(0);
  });
  it('the example song has no clashes', () => {
    const p = exampleProject();
    for (const t of p.tracks) expect([...findClashes(t, p.tracks.filter(o => o.id !== t.id)).keys()]).toEqual([]);
  });
});
