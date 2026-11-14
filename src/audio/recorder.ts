/** An AudioWorklet that hands raw stereo audio back to the page so it can be saved as a WAV. */
const SOURCE = `
class DdRecorder extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.port.onmessage = e => { if (e.data === 'stop') this.on = false; }; }
  process(inputs) {
    if (!this.on) return false;
    const i = inputs[0];
    if (i && i.length) this.port.postMessage([i[0].slice(), (i[1] || i[0]).slice()]);
    return true;
  }
}
registerProcessor('dd-recorder', DdRecorder);
`;

const ready = new WeakSet<BaseAudioContext>();

export async function createRecorderNode(ctx: AudioContext): Promise<AudioWorkletNode> {
  if (!ready.has(ctx)) {
    const url = URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    ready.add(ctx);
  }
  return new AudioWorkletNode(ctx, 'dd-recorder', {
    numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
  });
}
