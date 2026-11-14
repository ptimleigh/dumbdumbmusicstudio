import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { SoundFontPreset } from '../music/types';
import { MAX_BEND, pitchWheelSteps, type NoteBend } from '../music/bend';
import type { Instrument } from './instrument';

const loadedContexts = new WeakSet<BaseAudioContext>();

async function ensureWorklet(ctx: AudioContext) {
  if (loadedContexts.has(ctx)) return;
  await ctx.audioWorklet.addModule(processorUrl);
  loadedContexts.add(ctx);
}

/**
 * Plays notes through a SoundFont (SF2/SF3/DLS) using SpessaSynth.
 * Each track owns one synthesizer so its audio can run through the track's own effect chain.
 */
export class SoundFontInstrument implements Instrument {
  /** True while the channel's pitch wheel may be off-center from an earlier slide. */
  private bentDirty = false;

  private constructor(private synth: WorkletSynthesizer, readonly presets: SoundFontPreset[], private channel: number, private drums: boolean) {}

  /** `drums` picks drum kits (played on the General MIDI drum channel) instead of melodic instruments. */
  static async create(ctx: AudioContext, output: AudioNode, file: ArrayBuffer, drums = false): Promise<SoundFontInstrument> {
    await ensureWorklet(ctx);
    const synth = new WorkletSynthesizer(ctx);
    synth.connect(output);
    // the library may take ownership of the buffer, so hand it a copy
    await synth.soundBankManager.addSoundBank(file.slice(0), 'main');
    await synth.isReady;
    // the preset list arrives from the audio thread shortly after the bank loads
    for (let i = 0; i < 40 && synth.presetList.length === 0; i++) await new Promise(r => setTimeout(r, 50));
    const presets = synth.presetList
      .filter(p => p.isDrum === drums)
      .map(p => ({ name: p.name, bankMSB: p.bankMSB, bankLSB: p.bankLSB, program: p.program }));
    if (presets.length === 0) {
      synth.disconnect(output);
      throw new Error(drums ? 'This SoundFont has no drum kit. Pick one that includes drums.' : 'No playable instruments found in this file.');
    }
    return new SoundFontInstrument(synth, presets, drums ? 9 : 0, drums);
  }

  selectPreset(preset: SoundFontPreset) {
    const ch = this.channel;
    if (!this.drums) {
      this.synth.controllerChange(ch, 0, preset.bankMSB);
      this.synth.controllerChange(ch, 32, preset.bankLSB);
    }
    this.synth.programChange(ch, preset.program);
    if (!this.drums) this.synth.pitchWheelRange(ch, MAX_BEND);
    // the app's own Space slider controls reverb, so silence the SoundFont synth's built-in reverb and chorus
    this.synth.controllerChange(ch, 91, 0);
    this.synth.controllerChange(ch, 93, 0);
  }

  playNote(_ctx: BaseAudioContext, _dest: AudioNode, pitch: number, when: number, duration: number, velocity: number, bend?: NoteBend) {
    if (!this.drums) {
      // The pitch wheel belongs to the whole channel, so slides on overlapping notes bend each other.
      if (bend && bend.semitones !== 0) {
        // set the bend range right before the slide, so nothing earlier on the channel can leave it at the default
        this.synth.pitchWheelRange(this.channel, MAX_BEND, { time: when });
        for (const s of pitchWheelSteps(bend, duration)) this.synth.pitchWheel(this.channel, s.value, { time: when + s.t });
        this.bentDirty = true;
      } else if (this.bentDirty) {
        this.synth.pitchWheel(this.channel, 8192, { time: when });
        this.bentDirty = false;
      }
    }
    this.synth.noteOn(this.channel, pitch, Math.round(velocity * 127), { time: when });
    this.synth.noteOff(this.channel, pitch, { time: when + duration });
  }

  dispose(output: AudioNode) {
    try { this.synth.disconnect(output); } catch { /* already disconnected */ }
  }
}
