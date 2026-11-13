/** General MIDI drum notes used by the step grid, in the order they appear on screen. */
export interface DrumRow { pitch: number; name: string }

export const DRUM_ROWS: DrumRow[] = [
  { pitch: 49, name: 'Crash' },
  { pitch: 46, name: 'Open hat' },
  { pitch: 42, name: 'Closed hat' },
  { pitch: 48, name: 'High tom' },
  { pitch: 41, name: 'Low tom' },
  { pitch: 39, name: 'Clap' },
  { pitch: 38, name: 'Snare' },
  { pitch: 36, name: 'Kick' },
];

export const STEPS_PER_BEAT = 4;
export const STEP = 1 / STEPS_PER_BEAT; // beats

export interface DrumPattern { label: string; hint: string; steps: Record<number, number[]> } // pitch -> steps in one 4/4 bar (0..15)

export const DRUM_PATTERNS: DrumPattern[] = [
  { label: 'Rock beat', hint: 'Kick on 1 and 3, snare on 2 and 4, steady hats',
    steps: { 36: [0, 8, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12, 14] } },
  { label: 'Four on the floor', hint: 'Kick on every beat, claps on 2 and 4, open hats between',
    steps: { 36: [0, 4, 8, 12], 39: [4, 12], 46: [2, 6, 10, 14] } },
  { label: 'Hip-hop', hint: 'Laid-back kick and snare with busy hats',
    steps: { 36: [0, 7, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12, 14, 15] } },
];

export function stepsPerBar(beatsPerBar: number) { return beatsPerBar * STEPS_PER_BEAT; }
