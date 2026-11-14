/** Playback position and looping, as plain functions so they can be tested without any audio. */

export interface Region { start: number; end: number } // in beats
export interface Anchor { time: number; beat: number; spb: number } // at `time` (seconds) the music is at `beat`; one beat lasts `spb` seconds

export const MIN_REGION = 0.5;

/** Keeps a loop region inside the song and at least half a beat long. Returns null if there is none. */
export function normalizeRegion(r: Region | null | undefined, total: number): Region | null {
  if (!r) return null;
  let start = Math.max(0, Math.min(r.start, r.end));
  let end = Math.min(total, Math.max(r.start, r.end));
  if (end - start < MIN_REGION) {
    if (start + MIN_REGION <= total) end = start + MIN_REGION; else { end = total; start = Math.max(0, total - MIN_REGION); }
  }
  return { start, end };
}

/** One scheduling step: from `cursor` forward by up to `step` beats, never past the end of what is playing. */
export function nextStep(cursor: number, loop: Region | null, total: number, step = 0.5): { to: number; atEnd: boolean } {
  const end = loop ? Math.min(loop.end, total) : total;
  if (cursor >= end - 1e-9) return { to: cursor, atEnd: true };
  const to = Math.min(cursor + step, end);
  return { to, atEnd: to >= end - 1e-9 };
}

/** Where the cursor goes after a step: on at the end it wraps to the loop start, or the song is finished. */
export function afterStep(to: number, atEnd: boolean, loop: Region | null): { cursor: number; wrapped: boolean; finished: boolean } {
  if (!atEnd) return { cursor: to, wrapped: false, finished: false };
  if (loop) return { cursor: loop.start, wrapped: true, finished: false };
  return { cursor: to, wrapped: false, finished: true };
}

/** The musical position, in beats, at clock time `now`, given the points where the position jumped or the speed changed. */
export function positionAt(anchors: Anchor[], now: number): number {
  if (anchors.length === 0) return 0;
  let a = anchors[0];
  for (const x of anchors) if (x.time <= now) a = x; else break;
  return Math.max(0, a.beat + (now - a.time) / a.spb);
}

/** Snaps a position to a grid step and keeps it inside the song. */
export function snapBeat(beat: number, grid: number, total: number): number {
  return Math.min(total, Math.max(0, Math.round(beat / grid) * grid));
}
