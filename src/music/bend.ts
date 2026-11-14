import type { Note } from './types';

/**
 * A slide: the note starts at its own pitch and glides by `semitones` (up is positive).
 * `from` and `to` say where in the note (0 = its start, 1 = its end) the glide begins and finishes.
 * Before `from` the pitch holds; after `to` it holds at the new pitch. They default to the whole note.
 * `late` is the older way to say "start halfway" and is still read from old files.
 */
export interface NoteBend { semitones: number; from?: number; to?: number; late?: boolean }

/** The shortest a glide may be, as a fraction of the note. */
export const MIN_SLIDE = 0.05;

export const MAX_BEND = 12;

export const clampSemitones = (s: number) => Math.max(-MAX_BEND, Math.min(MAX_BEND, Math.round(s)));

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Where in the note (0 to 1) the glide begins. */
export const bendStart = (b: NoteBend) => clamp(b.from ?? (b.late ? 0.5 : 0), 0, 1 - MIN_SLIDE);

/** Where in the note (0 to 1) the glide reaches its new pitch. */
export const bendEnd = (b: NoteBend) => clamp(b.to ?? 1, bendStart(b) + MIN_SLIDE, 1);

/** How many semitones above the note's own pitch it is, a fraction `f` (0 to 1) of the way through. */
export function bendAt(b: NoteBend, f: number): number {
  const s = bendStart(b), e = bendEnd(b);
  if (f <= s) return 0;
  if (f >= e) return b.semitones;
  return b.semitones * ((f - s) / (e - s));
}

/** A copy of the slide with a new size and the same start and end points. */
export const withSemitones = (b: NoteBend | undefined, semitones: number): NoteBend => {
  const { from, to } = b ?? {};
  return { semitones, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
};

/**
 * Sets where the glide starts and ends (fractions of the note), snapping to the very start or end when close.
 * The answer is stable: running it on its own output changes nothing, so a saved song reloads exactly as it was.
 */
export function withTiming(b: NoteBend, from: number, to: number): NoteBend {
  let f = clamp(from, 0, 1 - MIN_SLIDE), t = clamp(to, MIN_SLIDE, 1);
  for (let i = 0; i < 4; i++) {
    f = +f.toFixed(3); t = +t.toFixed(3);
    if (f < 0.03) f = 0;
    if (t > 0.97) t = 1;
    if (t - f < MIN_SLIDE - 1e-9) { if (f + MIN_SLIDE <= 1) t = f + MIN_SLIDE; else { t = 1; f = 1 - MIN_SLIDE; } }
  }
  const { semitones } = b;
  return { semitones, ...(f > 0 ? { from: f } : {}), ...(t < 1 ? { to: t } : {}) };
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

/** Keeps only valid slides: a whole number of semitones from -12 to 12, not zero, with sensible start and end points. */
export function cleanBend(raw: unknown): NoteBend | undefined {
  const r = raw as { semitones?: unknown; from?: unknown; to?: unknown; late?: unknown } | null | undefined;
  if (!r || typeof r.semitones !== 'number' || !Number.isFinite(r.semitones)) return undefined;
  const semitones = clampSemitones(r.semitones);
  if (semitones === 0) return undefined;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const from = num(r.from) ?? (r.late === true ? 0.5 : 0);
  return withTiming({ semitones }, from, num(r.to) ?? 1);
}
