import type { Project, Role, Track } from './types';

const COLORS: Record<Role, string> = { melody: '#ff7eb6', bass: '#62a8ff', chords: '#ffcb57', lead: '#5ce1e6', drums: '#b79cff' };
export const ROLE_LABELS: Record<Role, string> = { melody: 'Melody', bass: 'Bass', chords: 'Chords', lead: 'Lead', drums: 'Drums' };

let counter = 0;
export const uid = (p = 'id') => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function newTrack(role: Role): Track {
  return {
    id: uid('track'), name: ROLE_LABELS[role], role, color: COLORS[role], notes: [],
    macros: { warmth: 5, punch: 5, space: 5 }, sound: { kind: 'synth' }, volume: 0.8, muted: false,
  };
}

export function newProject(): Project {
  return { name: 'My song', tempo: 100, beatsPerBar: 4, bars: 4, key: 0, scaleName: 'pentatonic', tracks: [newTrack('melody')] };
}

/** A small finished-sounding song so a first-time user can hear something right away. */
export function exampleProject(): Project {
  const note = (pitch: number, start: number, duration: number) => ({ id: uid('n'), pitch, start, duration });
  const melody = newTrack('melody');
  melody.name = 'Melody';
  melody.notes = [
    [72, 0, 1], [74, 1, 0.5], [76, 1.5, 0.5], [79, 2, 1.5], [76, 4, 1], [74, 5, 1], [72, 6, 2],
    [69, 8, 1], [72, 9, 1], [74, 10, 1], [72, 11, 1], [79, 12, 2], [76, 14, 2],
  ].map(([p, s, d]) => note(p, s, d));
  melody.macros = { warmth: 6, punch: 5, space: 6 };
  const chords = newTrack('chords');
  chords.notes = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]
    .flatMap((triad, bar) => triad.map(p => note(p, bar * 4, 4)));
  chords.macros = { warmth: 7, punch: 5, space: 7 };
  chords.volume = 0.5;
  const bass = newTrack('bass');
  bass.notes = [48, 57, 53, 55].flatMap((p, bar) => [note(p, bar * 4, 1.5), note(p, bar * 4 + 2, 1.5)]);
  bass.macros = { warmth: 6, punch: 6, space: 2 };
  bass.volume = 0.7;
  const drums = newTrack('drums');
  const rock: Record<number, number[]> = { 36: [0, 8, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12, 14] };
  drums.notes = [0, 1, 2, 3].flatMap(bar => Object.entries(rock).flatMap(([pitch, steps]) =>
    steps.map(s => note(+pitch, (bar * 16 + s) / 4, 0.25))));
  drums.volume = 0.6;
  return { name: 'Example song', tempo: 96, beatsPerBar: 4, bars: 4, key: 0, scaleName: 'pentatonic', tracks: [melody, chords, bass, drums] };
}
