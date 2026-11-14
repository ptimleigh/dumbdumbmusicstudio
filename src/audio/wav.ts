/** The loudest sample in the audio, from 0 to 1 (or more if it clips). */
export function peakOf(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
  return peak;
}

/** The gain that brings a peak to a target level in dB, or 1 for silence. */
export const gainForPeak = (peak: number, targetDb = -1) => (peak > 1e-4 ? Math.pow(10, targetDb / 20) / peak : 1);

/**
 * Encodes audio as a 16-bit PCM WAV file.
 * Pass `fixedGain` to apply a gain you chose yourself, for example so several files keep their levels relative to each other.
 * With `normalizeDb` set, the loudest peak is scaled to that level (default -1 dBFS) so the file is
 * as loud as possible without clipping. Silence is left alone.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number, normalizeDb: number | null = -1, fixedGain?: number): ArrayBuffer {
  const numCh = channels.length;
  const frames = numCh ? channels[0].length : 0;
  let gain = fixedGain ?? 1;
  if (fixedGain === undefined && normalizeDb !== null) {
    let peak = 0;
    for (const ch of channels) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
    if (peak > 1e-4) gain = Math.pow(10, normalizeDb / 20) / peak;
  }
  const dataBytes = frames * numCh * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * numCh * 2, true); v.setUint16(32, numCh * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i] * gain));
      v.setInt16(o, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
      o += 2;
    }
  }
  return buf;
}
