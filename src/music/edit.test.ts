import { describe, it, expect } from 'vitest';
import { makeClip, moveNotes, notesInRect, pasteClip, resizeNotes, selectionBounds, stepInScale } from './edit';
import type { Note } from './types';

const n = (id: string, pitch: number, start: number, duration: number): Note => ({ id, pitch, start, duration });
const B = { total: 16, low: 48, high: 84 };
const ids = (...a: string[]) => new Set(a);

describe('moveNotes', () => {
  const notes = [n('a', 60, 0, 1), n('b', 64, 2, 1), n('c', 70, 4, 1)];
  it('moves only the selected notes, keeping their spacing', () => {
    const out = moveNotes(notes, ids('a', 'b'), 1, 2, B);
    expect(out[0]).toMatchObject({ start: 1, pitch: 62 });
    expect(out[1]).toMatchObject({ start: 3, pitch: 66 });
    expect(out[2]).toBe(notes[2]);
  });
  it('stops the whole group at the start and end of the song', () => {
    expect(moveNotes(notes, ids('a', 'b'), -5, 0, B)[0].start).toBe(0);
    expect(moveNotes(notes, ids('a', 'b'), -5, 0, B)[1].start).toBe(2);
    const end = moveNotes(notes, ids('b', 'c'), 99, 0, B);
    expect(end[2].start + end[2].duration).toBe(16);
    expect(end[2].start - end[1].start).toBe(2);
  });
  it('stops the whole group at the top and bottom of the keyboard', () => {
    const up = moveNotes(notes, ids('a', 'c'), 0, 50, B);
    expect(up[2].pitch).toBe(84);
    expect(up[2].pitch - up[0].pitch).toBe(10);
    expect(moveNotes(notes, ids('a'), 0, -50, B)[0].pitch).toBe(48);
  });
  it('returns the same array when nothing changes', () => {
    expect(moveNotes(notes, ids('a'), 0, 0, B)).toBe(notes);
    expect(moveNotes(notes, ids(), 3, 3, B)).toBe(notes);
  });
  it('can move by steps of a scale', () => {
    const shift = (p: number, r: number) => stepInScale(p, r, 0, 'major');
    expect(moveNotes([n('a', 60, 0, 1)], ids('a'), 0, 1, { ...B, shift })[0].pitch).toBe(62);   // C -> D
    expect(moveNotes([n('a', 64, 0, 1)], ids('a'), 0, 1, { ...B, shift })[0].pitch).toBe(65);   // E -> F
    expect(moveNotes([n('a', 65, 0, 1)], ids('a'), 0, -1, { ...B, shift })[0].pitch).toBe(64);  // F -> E
  });
});

describe('stepInScale', () => {
  it('skips notes outside the scale', () => {
    expect(stepInScale(60, 1, 0, 'pentatonic')).toBe(62);
    expect(stepInScale(64, 1, 0, 'pentatonic')).toBe(67);
    expect(stepInScale(60, 5, 0, 'pentatonic')).toBe(72);
    expect(stepInScale(60, -1, 0, 'pentatonic')).toBe(57);
    expect(stepInScale(61, 1, 0, 'chromatic')).toBe(62);
  });
});

describe('resizeNotes', () => {
  const notes = [n('a', 60, 2, 2), n('b', 62, 6, 1)];
  it('lengthens and shortens together, never below one grid step', () => {
    const out = resizeNotes(notes, ids('a', 'b'), 'right', 1, { total: 16, grid: 0.25 });
    expect(out.map(x => x.duration)).toEqual([3, 2]);
    expect(resizeNotes(notes, ids('a', 'b'), 'right', -9, { total: 16, grid: 0.25 }).map(x => x.duration)).toEqual([0.25, 0.25]);
  });
  it('stops at the end of the song', () => {
    expect(resizeNotes(notes, ids('b'), 'right', 99, { total: 8, grid: 0.25 })[1].duration).toBe(2);
  });
  it('moves the start with the left edge while the end stays put', () => {
    const out = resizeNotes(notes, ids('a'), 'left', -1, { total: 16, grid: 0.25 });
    expect(out[0]).toMatchObject({ start: 1, duration: 3 });
    const squeezed = resizeNotes(notes, ids('a'), 'left', 9, { total: 16, grid: 0.25 });
    expect(squeezed[0].start + squeezed[0].duration).toBe(4);
    expect(squeezed[0].duration).toBe(0.25);
  });
});

describe('copy and paste', () => {
  const notes = [n('a', 60, 4, 1), n('b', 64, 5, 2), n('c', 67, 9, 1)];
  it('copies relative to the first selected note', () => {
    const clip = makeClip(notes, ids('a', 'b'))!;
    expect(clip.notes.map(x => x.start)).toEqual([0, 1]);
    expect(clip.length).toBe(3);
    expect(makeClip(notes, ids())).toBeNull();
  });
  it('pastes with fresh ids and keeps the shape', () => {
    const clip = makeClip(notes, ids('a', 'b'))!;
    let i = 0;
    const { added, dropped } = pasteClip(clip, 8, 16, () => 'new' + i++);
    expect(dropped).toBe(0);
    expect(added.map(x => [x.id, x.start, x.pitch])).toEqual([['new0', 8, 60], ['new1', 9, 64]]);
  });
  it('drops notes past the end and trims the rest', () => {
    const clip = makeClip(notes, ids('a', 'b'))!;
    const { added, dropped } = pasteClip(clip, 15.5, 16, () => 'x');
    expect(added).toHaveLength(1);
    expect(added[0].duration).toBe(0.5);
    expect(dropped).toBe(1);
  });
});

describe('selection', () => {
  const notes = [n('a', 60, 0, 1), n('b', 64, 2, 1), n('c', 70, 4, 1)];
  it('selects what a rectangle touches', () => {
    expect(notesInRect(notes, 0.5, 2.5, 58, 66).map(x => x.id)).toEqual(['a', 'b']);
    expect(notesInRect(notes, 2.5, 0.5, 66, 58).map(x => x.id)).toEqual(['a', 'b']);
    expect(notesInRect(notes, 1.2, 1.8, 0, 127)).toEqual([]);
    expect(notesInRect(notes, 0, 10, 65, 71).map(x => x.id)).toEqual(['c']);
  });
  it('finds the bounds of a selection', () => {
    expect(selectionBounds(notes, ids('a', 'c'))).toEqual({ start: 0, end: 5, low: 60, high: 70 });
    expect(selectionBounds(notes, ids())).toBeNull();
  });
});
