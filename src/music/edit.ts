import type { Note, ScaleName } from './types';
import { isInScale } from './theory';

/** Pure note-editing helpers. Selections are sets of note ids; nothing here mutates its input. */

export interface Bounds { total: number; low: number; high: number }
export type PitchShift = (pitch: number, rows: number) => number;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const EPS = 1e-9;

export function selectionBounds(notes: Note[], ids: ReadonlySet<string>) {
  const sel = notes.filter(n => ids.has(n.id));
  if (sel.length === 0) return null;
  return {
    start: Math.min(...sel.map(n => n.start)),
    end: Math.max(...sel.map(n => n.start + n.duration)),
    low: Math.min(...sel.map(n => n.pitch)),
    high: Math.max(...sel.map(n => n.pitch)),
  };
}

/** Moves the pitch `steps` notes of the scale up or down (or semitones, when the scale is chromatic). */
export function stepInScale(pitch: number, steps: number, key: number, scale: ScaleName): number {
  const dir = Math.sign(steps);
  let p = pitch;
  for (let i = 0; i < Math.abs(steps); i++) {
    p += dir;
    for (let guard = 0; guard < 12 && !isInScale(p, key, scale); guard++) p += dir;
  }
  return p;
}

/**
 * Moves the selected notes as a group: `dBeats` in time and `rows` in pitch.
 * The whole group stops at the edges of the song and the keyboard, so notes keep their positions relative to each other.
 */
export function moveNotes(base: Note[], ids: ReadonlySet<string>, dBeats: number, rows: number, o: Bounds & { shift?: PitchShift }): Note[] {
  const b = selectionBounds(base, ids);
  if (!b) return base;
  const shift = o.shift ?? ((p, r) => p + r);
  const dB = clamp(dBeats, -b.start, o.total - b.end);
  // shrink the pitch move until every selected note is still on the keyboard
  let r = rows;
  const fits = (rr: number) => base.every(n => !ids.has(n.id) || (shift(n.pitch, rr) >= o.low && shift(n.pitch, rr) <= o.high));
  while (r !== 0 && !fits(r)) r -= Math.sign(r);
  if (dB === 0 && r === 0) return base;
  return base.map(n => (ids.has(n.id) ? { ...n, start: n.start + dB, pitch: shift(n.pitch, r) } : n));
}

/** Changes the length of the selected notes by dragging their right edge, or their start by dragging the left edge. */
export function resizeNotes(base: Note[], ids: ReadonlySet<string>, edge: 'left' | 'right', dBeats: number, o: { total: number; grid: number }): Note[] {
  return base.map(n => {
    if (!ids.has(n.id)) return n;
    if (edge === 'right') return { ...n, duration: clamp(n.duration + dBeats, o.grid, o.total - n.start) };
    const end = n.start + n.duration;
    const start = clamp(n.start + dBeats, 0, end - o.grid);
    return { ...n, start, duration: end - start };
  });
}

export interface Clip { notes: Note[]; length: number }

/** Copies the selected notes, with their start times measured from the first one. */
export function makeClip(notes: Note[], ids: ReadonlySet<string>): Clip | null {
  const b = selectionBounds(notes, ids);
  if (!b) return null;
  return { notes: notes.filter(n => ids.has(n.id)).map(n => ({ ...n, start: n.start - b.start })), length: b.end - b.start };
}

/** Adds a clip's notes at `at`. Notes that would start after the end of the song are left out; others are trimmed to fit. */
export function pasteClip(clip: Clip, at: number, total: number, newId: () => string): { added: Note[]; dropped: number } {
  const added: Note[] = [];
  let dropped = 0;
  for (const n of clip.notes) {
    const start = at + n.start;
    if (start >= total - EPS) { dropped++; continue; }
    added.push({ ...n, id: newId(), start, duration: Math.min(n.duration, total - start) });
  }
  return { added, dropped };
}

/** Notes that overlap a rectangle (a time span in beats and a range of pitches), for drag-to-select. */
export function notesInRect(notes: Note[], beatA: number, beatB: number, pitchA: number, pitchB: number): Note[] {
  const [t0, t1] = [Math.min(beatA, beatB), Math.max(beatA, beatB)];
  const [p0, p1] = [Math.min(pitchA, pitchB), Math.max(pitchA, pitchB)];
  return notes.filter(n => n.start < t1 && n.start + n.duration > t0 && n.pitch >= p0 && n.pitch <= p1);
}
