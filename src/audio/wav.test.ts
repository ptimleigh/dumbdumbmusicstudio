import { describe, it, expect } from 'vitest';
import { encodeWav, gainForPeak, peakOf } from './wav';

const text = (v: DataView, o: number, n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(v.getUint8(o + i))).join('');

describe('encodeWav', () => {
  it('writes a valid stereo 16-bit header', () => {
    const v = new DataView(encodeWav([new Float32Array(100), new Float32Array(100)], 48000, null));
    expect(text(v, 0, 4)).toBe('RIFF');
    expect(text(v, 8, 4)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(400);
    expect(v.byteLength).toBe(444);
    expect(v.getUint32(4, true)).toBe(v.byteLength - 8);
  });
  it('interleaves left and right', () => {
    const v = new DataView(encodeWav([Float32Array.of(0.5, 0), Float32Array.of(-0.5, 0)], 44100, null));
    expect(v.getInt16(44, true)).toBeGreaterThan(16000);
    expect(v.getInt16(46, true)).toBeLessThan(-16000);
  });
  it('normalizes the loudest peak to the target level', () => {
    const v = new DataView(encodeWav([Float32Array.of(0.1, -0.05)], 44100, -1));
    const peak = Math.abs(v.getInt16(44, true)) / 32768;
    expect(20 * Math.log10(peak)).toBeCloseTo(-1, 1);
  });
  it('never clips out-of-range samples', () => {
    const v = new DataView(encodeWav([Float32Array.of(3, -3)], 44100, null));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });
  it('leaves silence alone', () => {
    const v = new DataView(encodeWav([new Float32Array(10)], 44100, -1));
    expect(v.getInt16(44, true)).toBe(0);
  });
  it('applies a fixed gain so several files keep their balance', () => {
    const quiet = new DataView(encodeWav([Float32Array.of(0.1)], 44100, -1, 2));
    expect(quiet.getInt16(44, true)).toBeCloseTo(0.2 * 32767, -1);
  });
  it('finds peaks and the gain to reach a target', () => {
    expect(peakOf([Float32Array.of(0.2, -0.5), Float32Array.of(0.1)])).toBe(0.5);
    expect(20 * Math.log10(gainForPeak(0.5, -1) * 0.5)).toBeCloseTo(-1, 6);
    expect(gainForPeak(0)).toBe(1);
  });
});
