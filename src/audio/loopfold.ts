/**
 * Makes a recording loop seamlessly. The recording holds the song followed by its tail (reverb and releases still
 * ringing after the last note). When the song starts over, that tail would still be ringing under the first notes, so
 * it is added onto the start instead of being left hanging off the end. The result is exactly `length` frames long and
 * its last sample flows straight into its first.
 *
 * `start` is the frame where the song really begins in the recording. If the tail is longer than the song, it keeps wrapping around.
 */
export function foldTail(rec: Float32Array, start: number, length: number): Float32Array {
  const out = new Float32Array(length);
  if (length <= 0) return out;
  for (let i = start; i < rec.length; i++) out[(i - start) % length] += rec[i];
  return out;
}
