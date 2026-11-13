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
  saturation: number;     // 0..1 waveshaper drive
  compThreshold: number;  // dB
  compRatio: number;
  compAttack: number;     // seconds
  reverbMix: number;      // 0..1 wet send
}

export function macrosToDsp(m: Macros): DspParams {
  const warm = centered(m.warmth);
  const punch = centered(m.punch);
  const space = centered(m.space);
  return {
    // warm = more low end, softer top, a touch of saturation
    lowShelfDb: warm * 6,
    highShelfDb: -warm * 7,
    saturation: Math.max(0, warm) * 0.6,
    // punch = tighter dynamics; slower attack lets the transient through
    compThreshold: -12 - Math.max(0, punch) * 14,
    compRatio: 1 + Math.max(0, punch) * 7,
    compAttack: 0.003 + Math.max(0, punch) * 0.027,
    // space = reverb amount; "dry" end pulls it down to nothing
    reverbMix: clamp(0.15 + space * 0.35, 0, 0.5) * (m.space <= 0 ? 0 : 1),
  };
}

export const MACRO_INFO: Record<keyof Macros, { label: string; low: string; high: string; hint: string }> = {
  warmth: { label: 'Warmth', low: 'Bright & crisp', high: 'Warm & cozy', hint: 'Shifts the tone from sparkly to mellow.' },
  punch: { label: 'Punch', low: 'Soft & smooth', high: 'Tight & punchy', hint: 'Makes notes hit harder and sound more present.' },
  space: { label: 'Space', low: 'Close & dry', high: 'Big room', hint: 'How far away and roomy the sound feels.' },
};
