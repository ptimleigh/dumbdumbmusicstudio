import type { Note } from './types';
import type { Clip } from './edit';

/** General MIDI drum notes used by the step grid, in the order they appear on screen. */
export interface DrumRow { pitch: number; name: string }

export const DRUM_ROWS: DrumRow[] = [
  { pitch: 49, name: 'Crash' },
  { pitch: 46, name: 'Open hat' },
  { pitch: 42, name: 'Closed hat' },
  { pitch: 48, name: 'High tom' },
  { pitch: 41, name: 'Low tom' },
  { pitch: 39, name: 'Clap' },
  { pitch: 38, name: 'Snare' },
  { pitch: 36, name: 'Kick' },
];

export const STEPS_PER_BEAT = 4;
export const STEP = 1 / STEPS_PER_BEAT; // beats

export interface DrumPattern { label: string; hint: string; steps: Record<number, number[]> } // pitch -> steps in one 4/4 bar (0..15)

export const DRUM_PATTERNS: DrumPattern[] = [
  { label: 'Rock beat', hint: 'Kick on 1 and 3, snare on 2 and 4, steady hats',
    steps: { 36: [0, 8, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { label: 'Four on the floor', hint: 'Kick on every beat, claps on 2 and 4, open hats between',
    steps: { 36: [0, 4, 8, 12], 39: [4, 12], 46: [2, 6, 10, 14] } },
  { label: 'Hip-hop', hint: 'Laid-back kick and snare with busy hats',
    steps: { 36: [0, 7, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12, 14, 15] } },
];

export function stepsPerBar(beatsPerBar: number) { return beatsPerBar * STEPS_PER_BEAT; }

/* ---------- selecting, moving and copying drum hits ---------- */

/** Which row of the grid a drum sits on (0 = top), or -1 for a note that is not in the kit. */
export const rowIndex = (pitch: number) => DRUM_ROWS.findIndex(r => r.pitch === pitch);

/** Which step of the song a hit is on. */
export const stepOf = (n: Note) => Math.round(n.start / STEP);

/** The hits inside a box of the grid (steps and rows, both ends included, in any order). */
export function hitsInBox(notes: Note[], stepA: number, stepB: number, rowA: number, rowB: number): Note[] {
  const [s0, s1] = [Math.min(stepA, stepB), Math.max(stepA, stepB)];
  const [r0, r1] = [Math.min(rowA, rowB), Math.max(rowA, rowB)];
  return notes.filter(n => { const r = rowIndex(n.pitch), s = stepOf(n); return r >= 0 && s >= s0 && s <= s1 && r >= r0 && r <= r1; });
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Moves the selected hits as a group by whole steps and whole rows. The group stops at the edges of the grid, and a
 * moved hit replaces any other hit already on the square it lands on.
 */
export function moveHits(notes: Note[], ids: ReadonlySet<string>, dSteps: number, dRows: number, totalSteps: number): Note[] {
  const sel = notes.filter(n => ids.has(n.id) && rowIndex(n.pitch) >= 0);
  if (sel.length === 0) return notes;
  const minS = Math.min(...sel.map(stepOf)), maxS = Math.max(...sel.map(stepOf));
  const minR = Math.min(...sel.map(n => rowIndex(n.pitch))), maxR = Math.max(...sel.map(n => rowIndex(n.pitch)));
  const dS = clamp(dSteps, -minS, totalSteps - 1 - maxS);
  const dR = clamp(dRows, -minR, DRUM_ROWS.length - 1 - maxR);
  if (dS === 0 && dR === 0) return notes;
  const moved = notes.map(n => (sel.includes(n) ? { ...n, start: (stepOf(n) + dS) * STEP, pitch: DRUM_ROWS[rowIndex(n.pitch) + dR].pitch } : n));
  const taken = new Set(moved.filter(n => ids.has(n.id)).map(n => `${n.pitch}:${stepOf(n)}`));
  return moved.filter(n => ids.has(n.id) || !taken.has(`${n.pitch}:${stepOf(n)}`));
}

/**
 * Copies the selected hits, measured in whole bars: the copy starts at the bar the selection starts in and is as many
 * bars long as the selection reaches. So repeating a few hits from bar 1 puts them in the same places in bar 2.
 */
export function drumClip(notes: Note[], ids: ReadonlySet<string>, beatsPerBar: number): (Clip & { anchor: number }) | null {
  const sel = notes.filter(n => ids.has(n.id));
  if (sel.length === 0) return null;
  const anchor = Math.floor(Math.min(...sel.map(n => n.start)) / beatsPerBar) * beatsPerBar;
  const end = Math.max(...sel.map(n => n.start + n.duration));
  const length = Math.max(1, Math.ceil((end - anchor) / beatsPerBar - 1e-9)) * beatsPerBar;
  return { anchor, notes: sel.map(n => ({ ...n, start: n.start - anchor })), length };
}

/** Pasted hits are dropped where the same drum already has a hit on the same step, so pasting never doubles a hit. */
export function withoutDuplicates(existing: Note[], added: Note[]): Note[] {
  const taken = new Set(existing.map(n => `${n.pitch}:${stepOf(n)}`));
  return added.filter(n => !taken.has(`${n.pitch}:${stepOf(n)}`));
}
