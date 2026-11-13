import { midiToFreq } from '../music/theory';
import type { Role } from '../music/types';

/**
 * A sound source turns notes into audio. The built-in synth is the first
 * implementation; SoundFont (SF2) and plugin sources will implement the same interface.
 */
export interface Instrument {
  playNote(ctx: BaseAudioContext, dest: AudioNode, pitch: number, when: number, duration: number, velocity: number): void;
}

interface SynthPatch {
  type: OscillatorType;
  detune: number; // cents, second oscillator for thickness
  attack: number;
  release: number;
  cutoff: number;
}

const PATCHES: Record<Role, SynthPatch> = {
  melody: { type: 'triangle', detune: 6, attack: 0.01, release: 0.25, cutoff: 5000 },
  lead: { type: 'sawtooth', detune: 8, attack: 0.01, release: 0.2, cutoff: 3500 },
  chords: { type: 'sine', detune: 4, attack: 0.04, release: 0.5, cutoff: 3000 },
  bass: { type: 'square', detune: 0, attack: 0.005, release: 0.12, cutoff: 700 },
};

export class BuiltInSynth implements Instrument {
  constructor(private role: Role) {}

  playNote(ctx: BaseAudioContext, dest: AudioNode, pitch: number, when: number, duration: number, velocity: number) {
    const p = PATCHES[this.role];
    const freq = midiToFreq(pitch);
    const end = when + duration;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = p.cutoff;
    const peak = 0.25 * velocity;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + p.attack);
    gain.gain.setValueAtTime(peak, Math.max(when + p.attack, end));
    gain.gain.exponentialRampToValueAtTime(0.0001, end + p.release);
    filter.connect(gain).connect(dest);

    const oscs = [0, p.detune].map(d => {
      const o = ctx.createOscillator();
      o.type = p.type;
      o.frequency.value = freq;
      o.detune.value = d;
      o.connect(filter);
      o.start(when);
      o.stop(end + p.release + 0.05);
      return o;
    });
    oscs[0].onended = () => { gain.disconnect(); filter.disconnect(); };
  }
}
