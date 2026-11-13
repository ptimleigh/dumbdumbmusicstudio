import type { Macros } from '../music/types';
import { macrosToDsp, type DspParams } from './macros';

/** The effect chain every track's sound passes through. Works on live and offline contexts. */
export interface TrackChain {
  input: GainNode;
  low: BiquadFilterNode;
  high: BiquadFilterNode;
  presence: BiquadFilterNode;
  shaper: WaveShaperNode;
  comp: DynamicsCompressorNode;
  makeup: GainNode;
  dry: GainNode;
  reverbSend: GainNode;
  out: GainNode;
}

export function makeImpulse(ctx: BaseAudioContext, seconds = 2.8, decay = 1.8): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  // deterministic noise so tests and renders are repeatable
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

/** Soft clipper with unity gain for quiet signals, so adding warmth doesn't make things louder. */
function saturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const g = 1 + amount * 12;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(g * x) / g;
  }
  return curve;
}

export function createTrackChain(ctx: BaseAudioContext, master: AudioNode, reverb: AudioNode): TrackChain {
  const input = ctx.createGain();
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4000;
  const presence = ctx.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 2800; presence.Q.value = 0.8;
  const shaper = ctx.createWaveShaper(); shaper.oversample = '2x';
  const comp = ctx.createDynamicsCompressor(); comp.knee.value = 6; comp.release.value = 0.15;
  const makeup = ctx.createGain();
  const dry = ctx.createGain();
  const out = ctx.createGain();
  const reverbSend = ctx.createGain();
  input.connect(low); low.connect(high); high.connect(presence); presence.connect(shaper);
  shaper.connect(comp); comp.connect(makeup);
  makeup.connect(dry); dry.connect(out); out.connect(master);
  makeup.connect(reverbSend); reverbSend.connect(reverb);
  return { input, low, high, presence, shaper, comp, makeup, dry, reverbSend, out };
}

const db = (x: number) => Math.pow(10, x / 20);

export function applyDsp(ctx: BaseAudioContext, c: TrackChain, d: DspParams, volume: number, muted: boolean, immediate = false) {
  const t = ctx.currentTime;
  const set = (p: AudioParam, v: number) => immediate ? (p.value = v) : p.setTargetAtTime(v, t, 0.02);
  set(c.low.gain, d.lowShelfDb);
  set(c.high.gain, d.highShelfDb);
  set(c.presence.gain, d.presenceDb);
  c.shaper.curve = d.saturation > 0 ? saturationCurve(d.saturation) : null;
  set(c.comp.threshold, d.compThreshold);
  set(c.comp.ratio, d.compRatio);
  set(c.comp.attack, d.compAttack);
  set(c.makeup.gain, db(d.makeupDb));
  set(c.dry.gain, d.dryLevel);
  set(c.reverbSend.gain, d.reverbMix);
  set(c.out.gain, muted ? 0 : volume);
}

export const applyMacros = (ctx: BaseAudioContext, c: TrackChain, m: Macros, volume = 1, muted = false, immediate = false) =>
  applyDsp(ctx, c, macrosToDsp(m), volume, muted, immediate);
