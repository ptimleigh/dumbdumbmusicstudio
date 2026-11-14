import { describe, it, expect } from 'vitest';
import { parseProject, serializeProject } from './serialize';
import { newProject, newTrack } from './project';
import { withTiming, clampSemitones } from './bend';
import type { Note, Project, Role } from './types';

/** A tiny repeatable random number generator, so a failure can be reproduced. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Makes a song the way the editors can: notes on any grid step, drum hits, slides, odd lengths, notes past the end. */
function randomProject(seed: number): Project {
  const r = rng(seed); const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const p = newProject();
  p.bars = pick([1, 2, 4, 8, 16, 32]); p.tempo = Math.round(40 + r() * 200); p.key = Math.floor(r() * 12);
  p.scaleName = pick(['major', 'minor', 'pentatonic', 'chromatic'] as const);
  p.name = pick(['My song', 'Song #2', 'Ünïcode ♪', '']) || 'x';
  p.tracks = [];
  const roles: Role[] = ['melody', 'bass', 'chords', 'lead', 'drums'];
  for (let t = 0; t < 1 + Math.floor(r() * 5); t++) {
    const track = newTrack(pick(roles)); track.volume = Math.round(r() * 20) / 20; track.muted = r() < 0.2;
    if (r() < 0.4) track.pan = Math.round((r() * 2 - 1) * 10) / 10 || undefined;
    track.macros = { warmth: Math.round(r() * 20) / 2, punch: Math.round(r() * 20) / 2, space: Math.round(r() * 20) / 2 };
    const total = p.bars * p.beatsPerBar;
    const notes: Note[] = [];
    for (let i = 0; i < Math.floor(r() * 80); i++) {
      const grid = pick([1, 0.5, 0.25, 0.125, 0.0625]);
      const start = Math.floor((r() * (total + 6)) / grid) * grid;                    // some past the end of the song
      const duration = Math.max(grid, Math.round((r() * 8) / grid) * grid);
      const n: Note = track.role === 'drums'
        ? { id: 'n' + t + '-' + i, pitch: pick([36, 38, 39, 41, 42, 46, 48, 49]), start: Math.floor(start * 4) / 4, duration: 0.25 }
        : { id: 'n' + t + '-' + i, pitch: 48 + Math.floor(r() * 37), start, duration };
      if (track.role !== 'drums' && r() < 0.3) {
        const semis = clampSemitones((r() * 24) - 12);
        if (semis !== 0) { const b = withTiming({ semitones: semis }, r() < 0.5 ? 0 : r(), r() < 0.5 ? 1 : r()); n.bend = b; }
      }
      notes.push(n);
    }
    track.notes = notes;
    p.tracks.push(track);
  }
  return p;
}

describe('saving and reloading a song', () => {
  it('never changes a single note, for 3000 random songs', () => {
    for (let seed = 1; seed <= 3000; seed++) {
      const p = randomProject(seed);
      const back = parseProject(serializeProject(p));
      // compare note by note so a failure says exactly what changed
      expect(back.tracks.length, `seed ${seed}: track count`).toBe(p.tracks.length);
      p.tracks.forEach((t, i) => {
        expect(back.tracks[i].notes.length, `seed ${seed}, track ${i} (${t.role}): note count`).toBe(t.notes.length);
        t.notes.forEach((n, k) => expect(back.tracks[i].notes[k], `seed ${seed}, track ${i}, note ${k}`).toEqual(n));
      });
      expect(back, `seed ${seed}: whole project`).toEqual(p);
    }
  });
  it('saving twice gives the same file (nothing keeps changing)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const once = serializeProject(parseProject(serializeProject(randomProject(seed))));
      expect(serializeProject(parseProject(once))).toBe(once);
    }
  });
});
