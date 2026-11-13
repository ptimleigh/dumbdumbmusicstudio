import type { Project, Track } from '../music/types';
import { BuiltInSynth, type Instrument } from './instrument';
import { macrosToDsp } from './macros';

interface TrackChain {
  input: GainNode;
  low: BiquadFilterNode;
  high: BiquadFilterNode;
  shaper: WaveShaperNode;
  comp: DynamicsCompressorNode;
  reverbSend: GainNode;
  out: GainNode;
  instrument: Instrument;
}

function makeImpulse(ctx: BaseAudioContext, seconds = 2.2, decay = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function saturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = amount * 40;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = k === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

export class Engine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private chains = new Map<string, TrackChain>();
  private timer: number | null = null;
  private startedAt = 0;      // ctx time corresponding to beat 0 of the current pass
  private scheduledUpTo = 0;  // beats
  playing = false;

  getProject: () => Project = () => { throw new Error('getProject not set'); };

  private ensure() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    this.reverb.connect(this.master);
    return ctx;
  }

  private chainFor(track: Track): TrackChain {
    const ctx = this.ensure();
    let c = this.chains.get(track.id);
    if (!c) {
      const input = ctx.createGain();
      const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200;
      const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4000;
      const shaper = ctx.createWaveShaper(); shaper.oversample = '2x';
      const comp = ctx.createDynamicsCompressor(); comp.knee.value = 12; comp.release.value = 0.2;
      const out = ctx.createGain();
      const reverbSend = ctx.createGain();
      input.connect(low); low.connect(high); high.connect(shaper); shaper.connect(comp); comp.connect(out);
      out.connect(this.master);
      comp.connect(reverbSend); reverbSend.connect(this.reverb);
      c = { input, low, high, shaper, comp, reverbSend, out, instrument: new BuiltInSynth(track.role) };
      this.chains.set(track.id, c);
    }
    return c;
  }

  /** Push the current macro/volume settings into the audio graph (safe to call often). */
  applyTrackSettings(track: Track) {
    const ctx = this.ensure();
    const c = this.chainFor(track);
    const d = macrosToDsp(track.macros);
    const t = ctx.currentTime;
    const ramp = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.02);
    ramp(c.low.gain, d.lowShelfDb);
    ramp(c.high.gain, d.highShelfDb);
    c.shaper.curve = d.saturation > 0 ? saturationCurve(d.saturation) : null;
    ramp(c.comp.threshold, d.compThreshold);
    ramp(c.comp.ratio, d.compRatio);
    ramp(c.comp.attack, d.compAttack);
    ramp(c.reverbSend.gain, d.reverbMix);
    ramp(c.out.gain, track.muted ? 0 : track.volume);
  }

  /** Play a single note immediately (for auditioning while editing). */
  preview(track: Track, pitch: number, duration = 0.4) {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
    this.applyTrackSettings(track);
    this.chainFor(track).instrument.playNote(ctx, this.chainFor(track).input, pitch, ctx.currentTime + 0.01, duration, 0.8);
  }

  async play() {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    if (this.playing) return;
    this.playing = true;
    this.startedAt = ctx.currentTime + 0.08;
    this.scheduledUpTo = 0;
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop() {
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Current playhead in beats, looped over the project length. */
  position(): number {
    if (!this.ctx || !this.playing) return 0;
    const p = this.getProject();
    const total = p.bars * p.beatsPerBar;
    const beats = ((this.ctx.currentTime - this.startedAt) * p.tempo) / 60;
    return beats < 0 ? 0 : beats % total;
  }

  private tick() {
    const ctx = this.ctx!;
    const p = this.getProject();
    const total = p.bars * p.beatsPerBar;
    const secPerBeat = 60 / p.tempo;
    const horizon = ((ctx.currentTime - this.startedAt) + 0.15) / secPerBeat; // beats
    while (this.scheduledUpTo < horizon) {
      const from = this.scheduledUpTo;
      const to = Math.min(horizon, from + 0.5);
      for (const track of p.tracks) {
        this.applyTrackSettings(track);
        const chain = this.chainFor(track);
        for (const n of track.notes) {
          // loop: note start repeats every `total` beats
          const loopIdx = Math.floor(from / total);
          for (const k of [loopIdx, loopIdx + 1]) {
            const absStart = n.start + k * total;
            if (absStart >= from && absStart < to) {
              const when = this.startedAt + absStart * secPerBeat;
              chain.instrument.playNote(ctx, chain.input, n.pitch, when, n.duration * secPerBeat, 0.8);
            }
          }
        }
      }
      this.scheduledUpTo = to;
    }
  }

  dispose(trackId: string) { this.chains.delete(trackId); }
}

export const engine = new Engine();
