import type { Macros, Project, SoundFontPreset, Track } from '../music/types';
import { triadPitches } from '../music/harmony';
import { SoundFontInstrument } from './soundfont';
import { createRecorderNode } from './recorder';
import { afterStep, nextStep, normalizeRegion, positionAt, type Anchor, type Region } from './transport';
import type { NoteBend } from '../music/bend';
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
  private cursor = 0;        // beat of the next thing to schedule
  private cursorTime = 0;    // clock time at which `cursor` sounds
  private spb = 0.6;         // seconds per beat while scheduling
  private anchors: Anchor[] = [];
  private region: Region | null = null; // the section being looped; null plays the song once
  playing = false;
  private bypassed = new Set<string>();

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
    // while a track is being compared, play it with every effect off (Space at 0 is fully dry)
    const macros: Macros = this.bypassed.has(track.id) ? { warmth: 5, punch: 5, space: 0 } : track.macros;
    applyMacros(ctx, et.chain, macros, track.volume, track.muted, false, track.pan ?? 0);
  }

  /** Turns all of a track's sound effects off or on, for comparing before and after. */
  setBypass(track: Track, on: boolean) {
    if (on) this.bypassed.add(track.id); else this.bypassed.delete(track.id);
    this.applyTrackSettings(track);
  }

  /**
   * Plays the first few beats of a track once, so a change to its sound can be heard without pressing Play.
   * An empty track plays a short example in the song's key instead.
   */
  async audition(project: Project, trackId: string) {
    const track = project.tracks.find(t => t.id === trackId);
    if (!track || this.playing) return;
    const ctx = this.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    this.applyTrackSettings(track);
    const inst = this.chainFor(track);
    const spb = 60 / project.tempo;
    const horizon = Math.min(4, project.bars * project.beatsPerBar);
    let notes = track.notes.filter(n => n.start < horizon);
    if (notes.length === 0) {
      if (track.role === 'drums') {
        notes = [36, 42, 38, 42, 36, 42, 38, 42].map((pitch, i) => ({ id: 'a' + i, pitch, start: i * 0.5, duration: 0.25 }));
      } else {
        const base = track.role === 'bass' ? 48 : 60;
        const [r, t, f] = triadPitches(0, project.key, project.scaleName, base);
        notes = [[r, 0, 0.5], [t, 0.5, 0.5], [f, 1, 0.5], [r + 12, 1.5, 1.5]].map(([pitch, start, duration], i) => ({ id: 'a' + i, pitch, start, duration }));
      }
    }
    const t0 = ctx.currentTime + 0.05;
    for (const n of notes) {
      inst.instrument.playNote(ctx, inst.chain.input, n.pitch, t0 + n.start * spb, Math.min(n.duration, horizon - n.start) * spb, 0.8, n.bend);
    }
  }

  /** Play a single note immediately (for auditioning while editing). */
  preview(track: Track, pitch: number, duration = 0.4, bend?: NoteBend) {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') void ctx.resume();
    this.applyTrackSettings(track);
    this.chainFor(track).instrument.playNote(ctx, this.chainFor(track).chain.input, pitch, ctx.currentTime + 0.01, duration, 0.8, bend);
  }

  /**
   * Starts playing from `from` (in beats). With `loop` set, that section repeats until stopped;
   * with null the song plays once and stops itself at the end.
   */
  async play(o: { from?: number; loop?: Region | null } = {}) {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') await ctx.resume();
    if (this.playing) return;
    const p = this.getProject();
    const total = p.bars * p.beatsPerBar;
    const from = Math.min(Math.max(0, o.from ?? 0), Math.max(0, total - 0.01));
    this.region = normalizeRegion(o.loop, total);
    this.spb = 60 / p.tempo;
    this.cursor = from;
    this.cursorTime = ctx.currentTime + 0.08;
    this.anchors = [{ time: this.cursorTime, beat: from, spb: this.spb }];
    this.playing = true;
    this.timer = window.setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop() {
    this.playing = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Change which section loops (or turn looping off with null) while playing. */
  setLoop(r: Region | null) {
    const p = this.getProject();
    this.region = normalizeRegion(r, p.bars * p.beatsPerBar);
  }

  /** Jump to a spot while playing. */
  seek(beat: number) {
    if (!this.playing || !this.ctx) return;
    const p = this.getProject();
    this.cursor = Math.min(Math.max(0, beat), p.bars * p.beatsPerBar);
    this.cursorTime = this.ctx.currentTime + 0.05;
    this.anchors.push({ time: this.cursorTime, beat: this.cursor, spb: this.spb });
  }

  /** Where playback is now, in beats. 0 when stopped. */
  position(): number {
    if (!this.ctx || !this.playing) return 0;
    const p = this.getProject();
    return Math.min(positionAt(this.anchors, this.ctx.currentTime), p.bars * p.beatsPerBar);
  }

  private tick() {
    const ctx = this.ctx!;
    const p = this.getProject();
    const total = p.bars * p.beatsPerBar;
    const spbNow = 60 / p.tempo;
    if (spbNow !== this.spb) { // a speed change takes effect from the next thing scheduled
      this.spb = spbNow;
      this.anchors.push({ time: this.cursorTime, beat: this.cursor, spb: spbNow });
    }
    const horizon = ctx.currentTime + 0.15;
    for (let guard = 0; this.cursorTime < horizon && guard < 200; guard++) {
      const { to, atEnd } = nextStep(this.cursor, this.region, total);
      if (to > this.cursor) {
        for (const track of p.tracks) {
          this.applyTrackSettings(track);
          const chain = this.chainFor(track);
          for (const n of track.notes) {
            if (n.start >= this.cursor && n.start < to) {
              const when = this.cursorTime + (n.start - this.cursor) * this.spb;
              chain.instrument.playNote(ctx, chain.chain.input, n.pitch, when, n.duration * this.spb, 0.8, n.bend);
            }
          }
        }
        this.cursorTime += (to - this.cursor) * this.spb;
      }
      const next = afterStep(to, atEnd, this.region);
      this.cursor = next.cursor;
      if (next.wrapped) this.anchors.push({ time: this.cursorTime, beat: this.cursor, spb: this.spb });
      if (next.finished) { if (ctx.currentTime >= this.cursorTime - 0.02) this.stop(); break; }
    }
    if (this.anchors.length > 8) this.anchors = this.anchors.slice(-8);
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
    await this.play({ from: 0, loop: null });
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
