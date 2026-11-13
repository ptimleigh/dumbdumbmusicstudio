export interface Note {
  id: string;
  pitch: number;    // MIDI note number
  start: number;    // in beats
  duration: number; // in beats
}

/** Qualitative controls, each 0..10. 5 is "neutral". */
export interface Macros {
  warmth: number;
  punch: number;
  space: number;
}

export type Role = 'melody' | 'bass' | 'chords' | 'lead' | 'drums';

export interface SoundFontPreset {
  name: string;
  bankMSB: number;
  bankLSB: number;
  program: number;
}

/** Where a track's sound comes from. */
export type TrackSound =
  | { kind: 'synth' }
  | { kind: 'soundfont'; fileName: string; presets: SoundFontPreset[]; selected: number };

export interface Track {
  id: string;
  name: string;
  role: Role;
  color: string;
  notes: Note[];
  macros: Macros;
  sound: TrackSound;
  volume: number; // 0..1
  muted: boolean;
}

export interface Project {
  name: string;
  tempo: number;
  beatsPerBar: number;
  bars: number;
  key: number;       // pitch class 0..11
  scaleName: ScaleName;
  tracks: Track[];
}

export type ScaleName = 'major' | 'minor' | 'pentatonic' | 'chromatic';
