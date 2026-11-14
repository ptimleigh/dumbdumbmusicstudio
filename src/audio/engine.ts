import type { Project, SoundFontPreset, Track } from '../music/types';
import { SoundFontInstrument } from './soundfont';
import { createRecorderNode } from './recorder';
import { BuiltInSynth, DEFAULT_VOICE, builtInFor, type Instrument } from './instrument';
import { applyMacros, createTrackChain, makeImpulse, type TrackChain } from './chain';

interface EngineTrack {
  chain: TrackChain;
  instrument: Instrument;
  soundfontFile?: ArrayBuffer;
}

export class Engine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private reverb!: ConvolverNode;
  private chains = new Map<string, EngineTrack>();
  private timer: number | null = null;
  private startedAt = 0;      // ctx time corresponding to beat 0 of the current pass
  private scheduledUpTo = 0;  // beats
  playing = false;
  private loop = true;

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

  private chainFor(track: Track): EngineTrack {
    const ctx = this.ensure();
    let c = this.chains.get(track.id);
    if (!c) {
      c = { chain: createTrackChain(ctx, this.master, this.reverb), instrument: builtInFor(track.role, track.voice) };
      this.chains.set(track.id, c);
    }
    return c;
  }

  /** Push the current macro/volume settings into the audio graph (safe to call often). */
  applyTrackSettings(track: Track) {
    const ctx = this.ensure();
    const et = this.chainFor(track);
    if (et.instrument instanceof BuiltInSynth && track.role !== 'drums') et.instrument.setVoice(track.voice ?? DEFAULT_VOICE[track.role]);
    applyMacros(ctx, et.chain, track.macros, track.volume, track.muted);
  }

  /** Play a single note immediately (for auditioning while editing). */
  preview(track: Track, pitch: number, duration = 0.4) {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
    this.applyTrackSettings(track);
    this.chainFor(track).instrument.playNote(ctx, this.chainFor(track).chain.input, pitch, ctx.currentTime + 0.01, duration, 0.8);
  }

  async play(opts: { loop?: boolean } = {}) {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    if (this.playing) return;
    this.loop = opts.loop ?? true;
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
      if (!this.loop && from >= total) break;
      const to = Math.min(horizon, from + 0.5, this.loop ? Infinity : total);
      for (const track of p.tracks) {
        this.applyTrackSettings(track);
        const chain = this.chainFor(track);
        for (const n of track.notes) {
          // loop: note start repeats every `total` beats
          const loopIdx = Math.floor(from / total);
          for (const k of this.loop ? [loopIdx, loopIdx + 1] : [0]) {
            const absStart = n.start + k * total;
            if (absStart >= from && absStart < to) {
              const when = this.startedAt + absStart * secPerBeat;
              chain.instrument.playNote(ctx, chain.chain.input, n.pitch, when, n.duration * secPerBeat, 0.8);
            }
          }
        }
      }
      this.scheduledUpTo = to;
    }
  }

  /**
   * Plays the song once from the start and records everything that comes out, in real time.
   * Returns null if cancelled.
   */
  async record(o: { tailSeconds: number; onProgress: (fraction: number) => void; signal: { cancelled: boolean } }):
    Promise<{ channels: Float32Array[]; sampleRate: number } | null> {
    this.stop();
    const ctx = this.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    const node = await createRecorderNode(ctx);
    const sink = ctx.createGain(); sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    const left: Float32Array[] = [], right: Float32Array[] = [];
    node.port.onmessage = e => { left.push(e.data[0]); right.push(e.data[1]); };
    this.master.connect(node);

    const p = this.getProject();
    const seconds = (p.bars * p.beatsPerBar * 60) / p.tempo + o.tailSeconds + 0.15;
    await this.play({ loop: false });
    const t0 = ctx.currentTime;
    try {
      while (!o.signal.cancelled && ctx.currentTime - t0 < seconds) {
        o.onProgress(Math.min(1, (ctx.currentTime - t0) / seconds));
        await new Promise(r => setTimeout(r, 100));
      }
    } finally {
      this.stop();
      this.master.disconnect(node);
      node.port.postMessage('stop');
      node.disconnect(); sink.disconnect();
    }
    if (o.signal.cancelled) return null;
    const join = (parts: Float32Array[]) => {
      const out = new Float32Array(parts.reduce((n, a) => n + a.length, 0));
      let off = 0; for (const a of parts) { out.set(a, off); off += a.length; }
      return out;
    };
    return { channels: [join(left), join(right)], sampleRate: ctx.sampleRate };
  }

  /** Load a SoundFont file for a track and return the instruments inside it. */
  async loadSoundFont(track: Track, file: ArrayBuffer): Promise<SoundFontPreset[]> {
    const ctx = this.ensure();
    const chain = this.chainFor(track);
    const sf = await SoundFontInstrument.create(ctx, chain.chain.input, file, track.role === 'drums');
    this.releaseInstrument(chain);
    chain.instrument = sf;
    chain.soundfontFile = file;
    sf.selectPreset(sf.presets[0]);
    return sf.presets;
  }

  selectPreset(track: Track, preset: SoundFontPreset) {
    const inst = this.chainFor(track).instrument;
    if (inst instanceof SoundFontInstrument) inst.selectPreset(preset);
  }

  /** Go back to the built-in synth sound. */
  useBuiltInSound(track: Track) {
    const chain = this.chainFor(track);
    this.releaseInstrument(chain);
    chain.instrument = builtInFor(track.role, track.voice);
    chain.soundfontFile = undefined;
  }

  private releaseInstrument(chain: EngineTrack) {
    if (chain.instrument instanceof SoundFontInstrument) chain.instrument.dispose(chain.chain.input);
  }

  /** Drop every track's audio chain (used when a different project is opened). */
  resetAll() {
    for (const id of [...this.chains.keys()]) this.dispose(id);
  }

  dispose(trackId: string) {
    const chain = this.chains.get(trackId);
    if (chain) this.releaseInstrument(chain);
    this.chains.delete(trackId);
  }
}

export const engine = new Engine();
