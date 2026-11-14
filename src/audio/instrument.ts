import { midiToFreq } from '../music/theory';
import type { Role } from '../music/types';
import { bendStart, type NoteBend } from '../music/bend';

/**
 * A sound source turns notes into audio. The built-in synth is the first
 * implementation; SoundFont (SF2) and plugin sources will implement the same interface.
 */
export interface Instrument {
  playNote(ctx: BaseAudioContext, dest: AudioNode, pitch: number, when: number, duration: number, velocity: number, bend?: NoteBend): void;
}

interface SynthPatch {
  type: OscillatorType;
  detune: number; // cents, second oscillator for thickness
  attack: number;
  release: number;
  cutoff: number;
  /** Optional fade after the attack, for plucked sounds: reaches `level` of the peak after `time` seconds. */
  decay?: { time: number; level: number };
}

export type MelodicRole = Exclude<Role, 'drums'>;

export type VoiceId = 'softKeys' | 'brightLead' | 'warmPad' | 'pluck' | 'deepBass' | 'buzzBass';

/** The built-in sounds, described in plain words. */
export const VOICES: Record<VoiceId, { label: string; patch: SynthPatch }> = {
  softKeys: { label: 'Soft keys', patch: { type: 'triangle', detune: 6, attack: 0.01, release: 0.25, cutoff: 5000 } },
  brightLead: { label: 'Bright lead', patch: { type: 'sawtooth', detune: 8, attack: 0.01, release: 0.2, cutoff: 3500 } },
  warmPad: { label: 'Warm pad', patch: { type: 'sine', detune: 10, attack: 0.04, release: 0.5, cutoff: 3000 } },
  pluck: { label: 'Pluck', patch: { type: 'sawtooth', detune: 3, attack: 0.003, release: 0.15, cutoff: 2600, decay: { time: 0.35, level: 0.25 } } },
  deepBass: { label: 'Deep bass', patch: { type: 'square', detune: 0, attack: 0.005, release: 0.12, cutoff: 700 } },
  buzzBass: { label: 'Buzzy bass', patch: { type: 'sawtooth', detune: 0, attack: 0.005, release: 0.1, cutoff: 1000 } },
};

export const VOICE_IDS = Object.keys(VOICES) as VoiceId[];

export const DEFAULT_VOICE: Record<MelodicRole, VoiceId> = { melody: 'softKeys', lead: 'brightLead', chords: 'warmPad', bass: 'deepBass' };

export class BuiltInSynth implements Instrument {
  constructor(private voice: VoiceId) {}

  setVoice(v: VoiceId) { this.voice = v; }

  playNote(ctx: BaseAudioContext, dest: AudioNode, pitch: number, when: number, duration: number, velocity: number, bend?: NoteBend) {
    const p = VOICES[this.voice].patch;
    const freq = midiToFreq(pitch);
    const end = when + duration;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = p.cutoff;
    const peak = 0.25 * 1.25 * velocity; // the second oscillator is quieter, so lift the total back up
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(peak, when + p.attack);
    let hold = peak;
    if (p.decay) {
      const dEnd = Math.min(when + p.attack + p.decay.time, end);
      hold = peak * Math.pow(p.decay.level, (dEnd - when - p.attack) / p.decay.time);
      gain.gain.exponentialRampToValueAtTime(Math.max(hold, 0.0001), Math.max(dEnd, when + p.attack + 0.001));
    }
    gain.gain.setValueAtTime(Math.max(hold, 0.0001), Math.max(when + p.attack + 0.001, end));
    gain.gain.exponentialRampToValueAtTime(0.0001, end + p.release);
    filter.connect(gain).connect(dest);

    const oscs = [0, p.detune].map((d, i) => {
      const o = ctx.createOscillator();
      o.type = p.type;
      o.frequency.setValueAtTime(freq, when);
      if (bend && bend.semitones !== 0) {
        // hold the pitch until the slide starts, then glide to the target by the end of the note
        const slideFrom = when + duration * bendStart(bend);
        o.frequency.setValueAtTime(freq, slideFrom);
        o.frequency.exponentialRampToValueAtTime(freq * Math.pow(2, bend.semitones / 12), Math.max(end, slideFrom + 0.01));
      }
      o.detune.value = d;
      // the detuned copy is quieter so the two never cancel each other out completely
      const g = ctx.createGain();
      g.gain.value = i === 0 ? 1 : 0.6;
      o.connect(g).connect(filter);
      o.start(when);
      o.stop(end + p.release + 0.05);
      return o;
    });
    oscs[0].onended = () => { gain.disconnect(); filter.disconnect(); };
  }
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}

/** A small synthesized drum kit, played by General MIDI drum note numbers. */
export class BuiltInDrums implements Instrument {
  playNote(ctx: BaseAudioContext, dest: AudioNode, pitch: number, when: number, _duration: number, velocity: number) {
    const out = ctx.createGain();
    out.gain.value = velocity;
    out.connect(dest);
    const stop = (n: AudioScheduledSourceNode, t: number) => { n.stop(t); n.onended = () => n.disconnect(); };

    const tone = (f0: number, f1: number, drop: number, decay: number, peak: number, type: OscillatorType = 'sine') => {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, when);
      o.frequency.exponentialRampToValueAtTime(f1, when + drop);
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      o.connect(g).connect(out); o.start(when); stop(o, when + decay + 0.05);
    };
    const hiss = (type: BiquadFilterType, freq: number, decay: number, peak: number, at = when, q = 1) => {
      const n = ctx.createBufferSource(); n.buffer = noise(ctx);
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(peak, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
      n.connect(f).connect(g).connect(out); n.start(at, Math.random() * 0.5); stop(n, at + decay + 0.05);
    };

    switch (pitch) {
      case 35: case 36: tone(160, 42, 0.12, 0.38, 0.62); tone(60, 40, 0.05, 0.12, 0.2, 'triangle'); break;
      case 37: case 38: case 40: tone(190, 120, 0.06, 0.12, 0.35, 'triangle'); hiss('bandpass', 2200, 0.18, 0.5, when, 0.7); break;
      case 39: for (const t of [0, 0.011, 0.024]) hiss('bandpass', 1300, 0.05, 0.95, when + t, 1.2); hiss('bandpass', 1300, 0.16, 0.7, when + 0.03, 1.2); break;
      case 41: case 43: case 45: tone(130, 80, 0.15, 0.4, 0.7); break;
      case 47: case 48: case 50: tone(210, 130, 0.12, 0.34, 0.65); break;
      case 42: case 44: hiss('highpass', 7500, 0.05, 0.5); break;
      case 46: hiss('highpass', 7000, 0.32, 0.3); break;
      case 49: case 51: case 52: case 55: case 57: hiss('highpass', 5200, 1.1, 0.35); break;
      default: hiss('bandpass', 1000, 0.05, 0.3);
    }
    // free the output node once the longest sound has faded
    const cleanup = ctx.createConstantSource(); cleanup.start(when); cleanup.stop(when + 1.4);
    cleanup.onended = () => out.disconnect();
  }
}

export const builtInFor = (role: Role, voice?: VoiceId): Instrument =>
  role === 'drums' ? new BuiltInDrums() : new BuiltInSynth(voice ?? DEFAULT_VOICE[role]);
