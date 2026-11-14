import type { Note } from './types';

/**
 * A slide: the note starts at its own pitch and glides by `semitones` (up is positive) by the time it ends.
 * With `late`, it holds its pitch for the first half of the note and slides during the second half.
 */
export interface NoteBend { semitones: number; late?: boolean }

export const MAX_BEND = 12;

export const clampSemitones = (s: number) => Math.max(-MAX_BEND, Math.min(MAX_BEND, Math.round(s)));

/** Where in the note (0 to 1) the slide begins. */
export const bendStart = (b: NoteBend) => (b.late ? 0.5 : 0);

/** How many semitones above the note's own pitch it is, a fraction `f` (0 to 1) of the way through. */
export function bendAt(b: NoteBend, f: number): number {
  const s = bendStart(b);
  if (f <= s) return 0;
  return b.semitones * Math.min(1, (f - s) / (1 - s));
}

/** The slide that ends exactly on the next note's pitch, or null if this is the last note. */
export function slideToNext(note: Note, notes: Note[]): number | null {
  const end = note.start + note.duration;
  let next: Note | null = null;
  for (const n of notes) {
    if (n.id === note.id || n.start < end - 0.01) continue;
    if (!next || n.start < next.start) next = n;
  }
  return next ? clampSemitones(next.pitch - note.pitch) : null;
}

/** MIDI pitch wheel value (0..16383, 8192 = no bend) for a bend in semitones. */
export const pitchWheelValue = (semitones: number, range = MAX_BEND) =>
  Math.max(0, Math.min(16383, Math.round(8192 + (semitones / range) * 8192)));

/** Pitch wheel events for a note of the given length in seconds, about 60 per second. */
export function pitchWheelSteps(b: NoteBend, seconds: number): { t: number; value: number }[] {
  const n = Math.max(2, Math.ceil(seconds * 60));
  return Array.from({ length: n + 1 }, (_, i) => ({ t: (i / n) * seconds, value: pitchWheelValue(bendAt(b, i / n)) }));
}

/** Keeps only valid slides: a whole number of semitones from -12 to 12, not zero. */
export function cleanBend(raw: unknown): NoteBend | undefined {
  const r = raw as { semitones?: unknown; late?: unknown } | null | undefined;
  if (!r || typeof r.semitones !== 'number' || !Number.isFinite(r.semitones)) return undefined;
  const semitones = clampSemitones(r.semitones);
  if (semitones === 0) return undefined;
  return r.late === true ? { semitones, late: true } : { semitones };
}
