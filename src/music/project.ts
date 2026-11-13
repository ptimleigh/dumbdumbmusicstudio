import type { Project, Role, Track } from './types';

const COLORS: Record<Role, string> = { melody: '#ff7ab6', bass: '#5aa9ff', chords: '#ffc857', lead: '#7be0a5' };
export const ROLE_LABELS: Record<Role, string> = { melody: 'Melody', bass: 'Bass', chords: 'Chords', lead: 'Lead' };

let counter = 0;
export const uid = (p = 'id') => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export function newTrack(role: Role): Track {
  return {
    id: uid('track'), name: ROLE_LABELS[role], role, color: COLORS[role], notes: [],
    macros: { warmth: 5, punch: 5, space: 5 }, sound: { kind: 'synth' }, volume: 0.8, muted: false,
  };
}

export function newProject(): Project {
  return { tempo: 100, beatsPerBar: 4, bars: 4, key: 0, scaleName: 'pentatonic', tracks: [newTrack('melody')] };
}
