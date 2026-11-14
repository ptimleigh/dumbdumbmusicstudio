/**
 * An AudioWorklet that hands raw stereo audio back to the page so it can be saved as a WAV.
 * It waits to be armed with a start frame and a length, so several recorders capture exactly the same stretch of time.
 */
const SOURCE = `
class DdRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true; this.armed = false; this.start = 0; this.remaining = 0;
    this.port.onmessage = e => {
      const m = e.data;
      if (m === 'stop') this.on = false;
      else if (m && m.arm) { this.armed = true; this.start = m.startFrame; this.remaining = m.frames; }
    };
  }
  process(inputs) {
    if (!this.on) return false;
    if (!this.armed) return true;
    const input = inputs[0];
    const n = 128, frame = currentFrame;
    if (frame + n <= this.start) return true;                 // not time yet
    const from = Math.max(0, this.start - frame);
    const take = Math.min(n - from, this.remaining);
    if (take > 0) {
      const l = new Float32Array(take), r = new Float32Array(take);
      if (input && input.length) { l.set(input[0].subarray(from, from + take)); r.set((input[1] || input[0]).subarray(from, from + take)); }
      this.port.postMessage([l, r]);
      this.remaining -= take;
    }
    if (this.remaining <= 0) { this.port.postMessage('done'); return false; }
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
