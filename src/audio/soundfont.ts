import { WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import type { SoundFontPreset } from '../music/types';
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
  private constructor(private synth: WorkletSynthesizer, readonly presets: SoundFontPreset[]) {}

  static async create(ctx: AudioContext, output: AudioNode, file: ArrayBuffer): Promise<SoundFontInstrument> {
    await ensureWorklet(ctx);
    const synth = new WorkletSynthesizer(ctx);
    synth.connect(output);
    // the library may take ownership of the buffer, so hand it a copy
    await synth.soundBankManager.addSoundBank(file.slice(0), 'main');
    await synth.isReady;
    // the preset list arrives from the audio thread shortly after the bank loads
    for (let i = 0; i < 40 && synth.presetList.length === 0; i++) await new Promise(r => setTimeout(r, 50));
    const presets = synth.presetList
      .filter(p => !p.isDrum)
      .map(p => ({ name: p.name, bankMSB: p.bankMSB, bankLSB: p.bankLSB, program: p.program }));
    if (presets.length === 0) {
      synth.disconnect(output);
      throw new Error('No playable instruments found in this file.');
    }
    return new SoundFontInstrument(synth, presets);
  }

  selectPreset(preset: SoundFontPreset) {
    this.synth.controllerChange(0, 0, preset.bankMSB);
    this.synth.controllerChange(0, 32, preset.bankLSB);
    this.synth.programChange(0, preset.program);
  }

  playNote(_ctx: BaseAudioContext, _dest: AudioNode, pitch: number, when: number, duration: number, velocity: number) {
    this.synth.noteOn(0, pitch, Math.round(velocity * 127), { time: when });
    this.synth.noteOff(0, pitch, { time: when + duration });
  }

  dispose(output: AudioNode) {
    try { this.synth.disconnect(output); } catch { /* already disconnected */ }
  }
}
