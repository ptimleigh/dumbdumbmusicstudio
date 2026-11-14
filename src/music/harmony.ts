import type { Note, ScaleName, Track } from './types';

/**
 * Chords are always built from a seven-note scale. The pentatonic and "anything goes" moods
 * use the major scale for chords, because stacking thirds on a five-note scale doesn't make real chords.
 */
export type ChordScale = 'major' | 'minor';
export const chordScaleOf = (s: ScaleName): ChordScale => (s === 'minor' ? 'minor' : 'major');

const STEPS: Record<ChordScale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export const ROMAN: Record<ChordScale, string[]> = {
  major: ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'],
  minor: ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII'],
};

/** MIDI pitches of the triad built on a scale degree (0 = first chord of the scale). */
export function triadPitches(degree: number, key: number, scale: ScaleName, base = 48): number[] {
  const steps = STEPS[chordScaleOf(scale)];
  const at = (d: number) => base + key + steps[d % 7] + Math.floor(d / 7) * 12;
  return [at(degree), at(degree + 2), at(degree + 4)];
}

const pitchClasses = (pitches: number[]) => new Set(pitches.map(p => ((p % 12) + 12) % 12));

/** Which chord of the key (0-6) these pitches spell exactly, or null if they are not a plain triad of the key. */
export function detectChord(pitches: number[], key: number, scale: ScaleName): number | null {
  const have = pitchClasses(pitches);
  if (have.size !== 3) return null;
  for (let d = 0; d < 7; d++) {
    const want = pitchClasses(triadPitches(d, key, scale));
    if ([...have].every(pc => want.has(pc))) return d;
  }
  return null;
}

/** The chord played in the last bar that has notes, if it is a plain triad of the key. */
export function lastChord(notes: Note[], beatsPerBar: number, key: number, scale: ScaleName): number | null {
  if (notes.length === 0) return null;
  const lastStart = Math.max(...notes.map(n => n.start));
  const barStart = Math.floor(lastStart / beatsPerBar) * beatsPerBar;
  const inBar = notes.filter(n => n.start >= barStart && n.start < barStart + beatsPerBar);
  return detectChord(inBar.map(n => n.pitch), key, scale);
}

export interface Suggestion { degree: number; reason: string }

type Table = Record<number, Suggestion[]>;
const MAJOR: Table = {
  0: [{ degree: 3, reason: 'a gentle lift' }, { degree: 4, reason: 'builds energy' }, { degree: 5, reason: 'a wistful shift' }],
  1: [{ degree: 4, reason: 'sets up the way home' }, { degree: 3, reason: 'a smooth step' }],
  2: [{ degree: 5, reason: 'slides somewhere sadder' }, { degree: 3, reason: 'a warm step forward' }],
  3: [{ degree: 4, reason: 'builds tension' }, { degree: 0, reason: 'settles back home' }, { degree: 1, reason: 'a smooth detour' }],
  4: [{ degree: 0, reason: 'the classic resolution' }, { degree: 5, reason: 'a surprise twist' }],
  5: [{ degree: 3, reason: 'a gentle lift' }, { degree: 1, reason: 'a smooth step toward the tension' }, { degree: 4, reason: 'builds energy' }],
  6: [{ degree: 0, reason: 'resolves home' }],
};
const MINOR: Table = {
  0: [{ degree: 5, reason: 'lifts the mood' }, { degree: 3, reason: 'deepens the mood' }, { degree: 6, reason: 'adds drive' }],
  1: [{ degree: 4, reason: 'sets up the way home' }, { degree: 6, reason: 'pushes forward' }],
  2: [{ degree: 5, reason: 'a soft landing' }, { degree: 3, reason: 'a darker step' }],
  3: [{ degree: 4, reason: 'builds tension' }, { degree: 0, reason: 'settles back home' }, { degree: 6, reason: 'drives forward' }],
  4: [{ degree: 0, reason: 'settles back home' }, { degree: 5, reason: 'a soft surprise' }],
  5: [{ degree: 6, reason: 'builds drive' }, { degree: 3, reason: 'a gentle step down' }, { degree: 2, reason: 'brightens up' }],
  6: [{ degree: 0, reason: 'back home' }, { degree: 2, reason: 'a brighter turn' }],
};
const START: Record<ChordScale, Suggestion[]> = {
  major: [{ degree: 0, reason: 'home base, a safe place to start' }, { degree: 5, reason: 'starts a little sadder' }, { degree: 3, reason: 'starts warm and open' }],
  minor: [{ degree: 0, reason: 'home base, a safe place to start' }, { degree: 5, reason: 'starts with a lift' }, { degree: 3, reason: 'starts deeper' }],
};

/** Chords that sound good after the previous one. Pass null when nothing has been played yet. */
export function suggestNext(prev: number | null, scale: ScaleName): Suggestion[] {
  const cs = chordScaleOf(scale);
  if (prev === null) return START[cs];
  return (cs === 'minor' ? MINOR : MAJOR)[prev] ?? START[cs];
}

export interface Clash { noteId: string; otherPitch: number; otherTrack: string }

/**
 * Notes that sound at the same time as a note one semitone away (or a major seventh away) on another track.
 * Those intervals sound harsh together. Drum tracks are ignored.
 */
export function findClashes(track: Track, others: Track[]): Map<string, Clash> {
  const out = new Map<string, Clash>();
  if (track.role === 'drums') return out;
  for (const n of track.notes) {
    const end = n.start + n.duration;
    search: for (const o of others) {
      if (o.role === 'drums' || o.id === track.id) continue;
      for (const m of o.notes) {
        if (m.start >= end - 0.01 || m.start + m.duration <= n.start + 0.01) continue;
        const d = Math.abs(n.pitch - m.pitch);
        if (d === 1 || d === 11) { out.set(n.id, { noteId: n.id, otherPitch: m.pitch, otherTrack: o.name }); break search; }
      }
    }
  }
  return out;
}
