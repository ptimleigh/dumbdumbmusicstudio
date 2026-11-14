import { describe, it, expect } from 'vitest';
import { DRUM_ROWS, STEP, drumClip, hitsInBox, moveHits, rowIndex, stepOf, withoutDuplicates } from './drums';
import type { Note } from './types';

const hit = (id: string, pitch: number, step: number): Note => ({ id, pitch, start: step * STEP, duration: STEP });
const ids = (...a: string[]) => new Set(a);
// rows from the top: 0 Crash 49, 1 Open hat 46, 2 Closed hat 42, 3 High tom 48, 4 Low tom 41, 5 Clap 39, 6 Snare 38, 7 Kick 36

describe('rows and steps', () => {
  it('finds a drum row, not by pitch order', () => {
    expect(rowIndex(36)).toBe(7);
    expect(rowIndex(49)).toBe(0);
    expect(rowIndex(48)).toBe(3);   // the high tom (48) sits between the hats and the low tom
    expect(rowIndex(99)).toBe(-1);
    expect(stepOf(hit('a', 36, 5))).toBe(5);
  });
});

describe('box selection', () => {
  const hats = [hit('h0', 42, 0), hit('h1', 42, 2), hit('h2', 42, 4)];
  const notes = [...hats, hit('k0', 36, 0), hit('s0', 38, 4), hit('t', 48, 3)];
  it('selects by step and row, in any direction', () => {
    expect(hitsInBox(notes, 0, 2, 2, 2).map(n => n.id)).toEqual(['h0', 'h1']);
    expect(hitsInBox(notes, 2, 0, 2, 2).map(n => n.id)).toEqual(['h0', 'h1']);
  });
  it('uses grid rows, so a box across the middle rows catches the right drums', () => {
    // rows 2..3 are the closed hat and the high tom, even though their pitches (42, 48) are not neighbours in the kit order of pitches
    expect(hitsInBox(notes, 0, 8, 2, 3).map(n => n.id).sort()).toEqual(['h0', 'h1', 'h2', 't']);
    expect(hitsInBox(notes, 0, 8, 6, 7).map(n => n.id).sort()).toEqual(['k0', 's0']);
  });
  it('ignores things outside the box and notes that are not drums', () => {
    expect(hitsInBox(notes, 5, 9, 0, 7)).toEqual([]);
    expect(hitsInBox([hit('x', 99, 0)], 0, 5, 0, 7)).toEqual([]);
  });
});

describe('moveHits', () => {
  const notes = [hit('k', 36, 0), hit('s', 38, 4), hit('c', 42, 8)];
  it('moves the group together by steps and rows', () => {
    const out = moveHits(notes, ids('k', 's'), 2, -1, 32);
    expect(out.find(n => n.id === 'k')).toMatchObject({ pitch: 38, start: 2 * STEP });   // kick row 7 -> snare row 6
    expect(out.find(n => n.id === 's')).toMatchObject({ pitch: 39, start: 6 * STEP });   // snare row 6 -> clap row 5
    expect(out.find(n => n.id === 'c')).toBe(notes[2]);
  });
  it('stops at the edges of the grid without squashing the group', () => {
    const left = moveHits(notes, ids('k', 's'), -9, 0, 32);
    expect(left.find(n => n.id === 'k')!.start).toBe(0);
    expect(left.find(n => n.id === 's')!.start).toBe(4 * STEP);
    const right = moveHits(notes, ids('s', 'c'), 99, 0, 16);
    expect(stepOf(right.find(n => n.id === 'c')!)).toBe(15);
    expect(stepOf(right.find(n => n.id === 's')!)).toBe(11);
    const down = moveHits(notes, ids('k'), 0, 5, 32);
    expect(down.find(n => n.id === 'k')!.pitch).toBe(36);   // already on the bottom row
  });
  it('a moved hit replaces a hit it lands on', () => {
    const out = moveHits([hit('a', 36, 0), hit('b', 36, 2)], ids('a'), 2, 0, 16);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
  });
  it('returns the same list when nothing changes', () => {
    expect(moveHits(notes, ids('k'), 0, 0, 32)).toBe(notes);
    expect(moveHits(notes, ids(), 3, 3, 32)).toBe(notes);
  });
});

describe('copy and paste', () => {
  const bar = [hit('k0', 36, 0), hit('s0', 38, 4), hit('k1', 36, 8), hit('s1', 38, 12), hit('h', 42, 14)];
  it('copies a bar as exactly one bar so the next copy lands on the next bar', () => {
    const clip = drumClip(bar, ids('k0', 's0', 'k1', 's1', 'h'), 4)!;
    expect(clip.length).toBe(4);
    expect(clip.anchor).toBe(0);
    expect(clip.notes.map(stepOf)).toEqual([0, 4, 8, 12, 14]);
  });
  it('a few early hits still repeat a whole bar later', () => {
    const clip = drumClip(bar, ids('k0', 'k1'), 4)!;   // kicks on steps 0 and 8: they end well before the end of the bar
    expect(clip.length).toBe(4);
    expect(clip.notes.map(stepOf)).toEqual([0, 8]);
  });
  it('starts at the beginning of the bar the selection is in', () => {
    const second = [hit('a', 36, 16), hit('b', 38, 20)];                // bar 2
    const clip = drumClip(second, ids('a', 'b'), 4)!;
    expect(clip.anchor).toBe(4);
    expect(clip.notes.map(n => n.start)).toEqual([0, 1]);
    expect(clip.length).toBe(4);
  });
  it('a selection that reaches into the next bar is two bars long', () => {
    const clip = drumClip([hit('a', 36, 14), hit('b', 38, 18)], ids('a', 'b'), 4)!;   // steps 14 (bar 1) and 18 (bar 2)
    expect(clip.length).toBe(8);
    expect(clip.anchor).toBe(0);
  });
  it('returns nothing for an empty selection', () => {
    expect(drumClip(bar, ids(), 4)).toBeNull();
  });
  it('does not double up hits that are already there', () => {
    const added = [hit('n1', 36, 0), hit('n2', 36, 1), hit('n3', 38, 4)];
    expect(withoutDuplicates(bar, added).map(n => n.id)).toEqual(['n2']);
  });
});

it('has eight drums in the kit', () => expect(DRUM_ROWS).toHaveLength(8));
