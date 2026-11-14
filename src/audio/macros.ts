import type { Macros } from '../music/types';

/**
 * Maps friendly 0..10 sliders to real DSP parameters.
 * 5 is neutral (no audible change); the extremes are clearly audible but tasteful.
 * Pure functions, so the mapping can be tested and tuned without audio hardware.
 */
const centered = (v: number) => (clamp(v, 0, 10) - 5) / 5; // -1..1
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface DspParams {
  lowShelfDb: number;
  highShelfDb: number;
  presenceDb: number;     // boost/cut around 2.8 kHz
  saturation: number;     // 0..1 waveshaper drive
  compThreshold: number;  // dB
  compRatio: number;
  compAttack: number;     // seconds
  makeupDb: number;       // keeps loudness steady while tone changes
  dryLevel: number;       // 0..1 level of the unprocessed-by-reverb signal
  reverbMix: number;      // wet send level
}

export function macrosToDsp(m: Macros): DspParams {
  const warm = centered(m.warmth);
  const punch = centered(m.punch);
  const space = clamp(m.space, 0, 10) / 10;
  const punchUp = Math.max(0, punch);
  const reverbMix = space * space * 6; // 0 = bone dry, 5 = a little room, 10 = big hall
  return {
    // warm = more low end, softer top, a touch of saturation; bright = the opposite
    lowShelfDb: warm * 5,
    highShelfDb: -warm * 6,
    presenceDb: punch * (punch > 0 ? 5 : 4),
    saturation: Math.max(0, warm) * 0.5,
    // punch = squash the tails so the start of each note stands out
    compThreshold: -18 - punchUp * 18,
    compRatio: 1 + punchUp * 9,
    compAttack: 0.005 + punchUp * 0.03,
    // measured against the built-in synth so tone changes don't also change loudness
    makeupDb: Math.max(0, warm) * 4.4 + Math.max(0, -warm) * 0.5 - punchUp * 1.9 - 6.5 * Math.pow(space, 3),
    dryLevel: 1 - 0.35 * space,
    reverbMix,
  };
}

export const MACRO_INFO: Record<keyof Macros, { label: string; low: string; high: string; hint: string }> = {
  warmth: { label: 'Warmth', low: 'Bright & crisp', high: 'Warm & cozy', hint: 'Shifts the tone from sparkly to mellow.' },
  punch: { label: 'Punch', low: 'Soft & smooth', high: 'Tight & punchy', hint: 'Makes notes hit harder and sound more present.' },
  space: { label: 'Space', low: 'Close & dry', high: 'Big room', hint: 'How far away and roomy the sound feels.' },
};

/** One-click starting points for the three sliders. */
export interface Vibe { id: string; label: string; hint: string; macros: Macros }

export const VIBES: Vibe[] = [
  { id: 'plain', label: 'Plain', hint: 'No coloring, just the sound as it is', macros: { warmth: 5, punch: 5, space: 5 } },
  { id: 'warm', label: 'Warm & cozy', hint: 'Mellow and rounded, with a little room', macros: { warmth: 8, punch: 4, space: 5 } },
  { id: 'bright', label: 'Bright & clear', hint: 'Crisp and right up front', macros: { warmth: 2, punch: 6, space: 3 } },
  { id: 'punchy', label: 'Tight & punchy', hint: 'Short, hard-hitting and dry', macros: { warmth: 5, punch: 9, space: 2 } },
  { id: 'dreamy', label: 'Dreamy', hint: 'Soft and floating in a big space', macros: { warmth: 7, punch: 2, space: 9 } },
  { id: 'lofi', label: 'Lo-fi', hint: 'Dark, soft and a little smoky', macros: { warmth: 10, punch: 3, space: 4 } },
  { id: 'airy', label: 'Big & airy', hint: 'Wide open, like a hall', macros: { warmth: 4, punch: 5, space: 10 } },
];

/** The vibe the sliders are currently set to, if any. */
export function matchingVibe(m: Macros): Vibe | null {
  return VIBES.find(v => v.macros.warmth === m.warmth && v.macros.punch === m.punch && v.macros.space === m.space) ?? null;
}
