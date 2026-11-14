import type { Project, Track } from '../music/types';
import { bendAt, bendEnd, bendStart, MAX_BEND, pitchWheelValue } from '../music/bend';
import { DEFAULT_VOICE, type VoiceId } from './instrument';

/** Standard MIDI File (format 1) export, so a song can be opened in FL Studio, Ableton, Logic and the like. */

export const PPQ = 480;          // ticks per quarter note (a beat)
const VELOCITY = 100;
const DRUM_CHANNEL = 9;

/** The General MIDI instrument that sounds closest to each built-in voice. */
const GM_PROGRAM: Record<VoiceId, number> = { softKeys: 4, brightLead: 81, warmPad: 89, pluck: 24, deepBass: 38, buzzBass: 39 };

/** Key signature as MIDI wants it: number of sharps (positive) or flats (negative), and whether the key is minor. */
const MAJOR_SHARPS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]; // C Db D Eb E F F# G Ab A Bb B
export function keySignature(key: number, minor: boolean): { sf: number; mi: number } {
  const relativeMajor = minor ? (key + 3) % 12 : key;
  return { sf: MAJOR_SHARPS[relativeMajor], mi: minor ? 1 : 0 };
}

/** A number as a MIDI variable-length quantity (7 bits per byte, the last byte has the high bit clear). */
export function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const out = [v & 0x7f];
  while ((v >>= 7) > 0) out.unshift((v & 0x7f) | 0x80);
  return out;
}

const be = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => (n >> (8 * (bytes - 1 - i))) & 0xff);
const text = (s: string) => Array.from(new TextEncoder().encode(s));

interface Ev { tick: number; order: number; bytes: number[] } // order breaks ties at the same tick: note off, then controllers, then note on

function chunk(id: string, data: number[]): number[] {
  return [...text(id), ...be(data.length, 4), ...data];
}

/** Turns timed events into the track's bytes, with delta times. */
function encodeTrack(events: Ev[], endTick: number): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out: number[] = [];
  let last = 0;
  for (const e of sorted) { out.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
  out.push(...vlq(Math.max(0, endTick - last)), 0xff, 0x2f, 0x00);
  return chunk('MTrk', out);
}

const meta = (type: number, data: number[]) => [0xff, type, ...vlq(data.length), ...data];

function trackEvents(track: Track, channel: number, total: number): Ev[] {
  const ev: Ev[] = [];
  const push = (tick: number, order: number, ...bytes: number[]) => ev.push({ tick, order, bytes });
  const status = (hi: number) => hi | channel;
  push(0, 0, ...meta(0x03, text(track.name)));
  // volume and position
  push(0, 1, status(0xb0), 7, Math.round(Math.max(0, Math.min(1, track.volume)) * 127));
  push(0, 1, status(0xb0), 10, Math.round(64 + Math.max(-1, Math.min(1, track.pan ?? 0)) * 63));
  if (track.role !== 'drums') {
    const program = track.sound.kind === 'soundfont' ? track.sound.presets[track.sound.selected]?.program ?? 0 : GM_PROGRAM[track.voice ?? DEFAULT_VOICE[track.role]];
    push(0, 1, status(0xc0), Math.max(0, Math.min(127, program)));
  }
  const notes = track.notes.filter(n => n.start < total && n.pitch >= 0 && n.pitch <= 127);
  // slides use the pitch wheel; tell the receiver the wheel covers a full octave either way
  if (track.role !== 'drums' && notes.some(n => n.bend)) {
    push(0, 1, status(0xb0), 101, 0); push(0, 1, status(0xb0), 100, 0);
    push(0, 1, status(0xb0), 6, MAX_BEND); push(0, 1, status(0xb0), 38, 0);
    push(0, 1, status(0xb0), 101, 127); push(0, 1, status(0xb0), 100, 127);
  }
  for (const n of notes) {
    const start = Math.round(n.start * PPQ);
    const end = Math.max(start + 1, Math.round(Math.min(n.start + n.duration, total) * PPQ));
    push(start, 3, status(0x90), n.pitch, VELOCITY);
    push(end, 0, status(0x80), n.pitch, 0);
    if (n.bend && n.bend.semitones !== 0 && track.role !== 'drums') {
      const len = end - start;
      const a = Math.round(start + bendStart(n.bend) * len), z = Math.round(start + bendEnd(n.bend) * len);
      let lastValue = 8192;
      const wheel = (tick: number, value: number) => {
        if (value === lastValue) return;
        lastValue = value;
        push(tick, 2, status(0xe0), value & 0x7f, (value >> 7) & 0x7f);
      };
      for (let t = a; t < z; t += 20) wheel(t, pitchWheelValue(bendAt(n.bend, (t - start) / len)));
      wheel(z, pitchWheelValue(n.bend.semitones));
      if (lastValue !== 8192) push(end, 1, status(0xe0), 0x00, 0x40); // back to centre once the note is over
    }
  }
  return ev;
}

/** Builds a Standard MIDI File of the whole song: one track per track, tempo and key on a first track. */
export function buildMidi(project: Project): Uint8Array {
  const total = project.bars * project.beatsPerBar;
  const endTick = Math.round(total * PPQ);
  const { sf, mi } = keySignature(project.key, project.scaleName === 'minor');

  const conductor: Ev[] = [
    { tick: 0, order: 0, bytes: meta(0x03, text(project.name || 'Song')) },
    { tick: 0, order: 1, bytes: meta(0x58, [project.beatsPerBar, 2, 24, 8]) },
    { tick: 0, order: 1, bytes: meta(0x51, be(Math.round(60_000_000 / project.tempo), 3)) },
    { tick: 0, order: 1, bytes: meta(0x59, [sf & 0xff, mi]) },
  ];

  const chunks = [encodeTrack(conductor, endTick)];
  let next = 0; // melodic tracks take channels 0-15 in turn, skipping the drum channel
  for (const t of project.tracks) {
    let channel = DRUM_CHANNEL;
    if (t.role !== 'drums') { if (next === DRUM_CHANNEL) next++; channel = next % 16; next = (next + 1) % 16; }
    chunks.push(encodeTrack(trackEvents(t, channel, total), endTick));
  }
  const header = chunk('MThd', [...be(1, 2), ...be(chunks.length, 2), ...be(PPQ, 2)]);
  return Uint8Array.from([...header, ...chunks.flat()]);
}
