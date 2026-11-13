import type { ScaleName } from './types';

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES: Record<ScaleName, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const SCALE_LABELS: Record<ScaleName, string> = {
  major: 'Happy (major)',
  minor: 'Sad (minor)',
  pentatonic: 'Safe (pentatonic)',
  chromatic: 'Anything goes',
};

export function noteName(pitch: number): string {
  return NOTE_NAMES[((pitch % 12) + 12) % 12] + (Math.floor(pitch / 12) - 1);
}

export function midiToFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

export function isInScale(pitch: number, key: number, scale: ScaleName): boolean {
  const pc = (((pitch - key) % 12) + 12) % 12;
  return SCALES[scale].includes(pc);
}

export function isBlackKey(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(((pitch % 12) + 12) % 12);
}

/** Chord roots as scale degrees (0-based) -> triad pitches built from the scale. */
export function triadFromDegree(degree: number, key: number, scale: ScaleName, octaveBase = 60): number[] {
  const steps = SCALES[scale];
  const n = steps.length;
  const at = (d: number) => {
    const oct = Math.floor(d / n);
    return octaveBase + key + steps[((d % n) + n) % n] + oct * 12;
  };
  // stack every other scale note (1-3-5); for pentatonic this is still pleasant
  return [at(degree), at(degree + 2), at(degree + 4)];
}

export const snapToScale = (pitch: number, key: number, scale: ScaleName): number => {
  for (let d = 0; d < 12; d++) {
    if (isInScale(pitch + d, key, scale)) return pitch + d;
    if (isInScale(pitch - d, key, scale)) return pitch - d;
  }
  return pitch;
};

export const DURATION_LABELS: { label: string; beats: number }[] = [
  { label: 'Tiny', beats: 0.25 },
  { label: 'Short', beats: 0.5 },
  { label: 'Medium', beats: 1 },
  { label: 'Long', beats: 2 },
  { label: 'Very long', beats: 4 },
];
