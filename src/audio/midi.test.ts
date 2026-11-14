import { describe, it, expect } from 'vitest';
import { buildMidi, keySignature, PPQ, vlq } from './midi';
import { exampleProject, newProject, newTrack } from '../music/project';

/** A small reader, just enough to check what buildMidi wrote. */
function read(bytes: Uint8Array) {
  let p = 0;
  const u = (n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + bytes[p++]; return v; };
  const str = (n: number) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[p++]); return s; };
  const header = { id: str(4), len: u(4), format: u(2), tracks: u(2), division: u(2) };
  const tracks: { events: any[]; name?: string; endTick: number }[] = [];
  for (let t = 0; t < header.tracks; t++) {
    expect(str(4)).toBe('MTrk'); const len = u(4); const end = p + len;
    let tick = 0, running = 0; const events: any[] = []; let name: string | undefined;
    const readVlq = () => { let v = 0, b; do { b = bytes[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
    while (p < end) {
      tick += readVlq();
      let s = bytes[p];
      if (s === 0xff) { p++; const type = bytes[p++]; const l = readVlq(); const data = Array.from(bytes.slice(p, p + l)); p += l; events.push({ tick, meta: type, data }); if (type === 3) name = String.fromCharCode(...data); continue; }
      if (s & 0x80) { running = s; p++; } else s = running;
      const kind = s & 0xf0, ch = s & 0x0f;
      const need = kind === 0xc0 || kind === 0xd0 ? 1 : 2;
      const d = Array.from(bytes.slice(p, p + need)); p += need;
      events.push({ tick, kind, ch, d });
    }
    tracks.push({ events, name, endTick: tick });
  }
  return { header, tracks, size: p };
}

describe('MIDI helpers', () => {
  it('writes variable-length numbers', () => {
    expect(vlq(0)).toEqual([0]);
    expect(vlq(127)).toEqual([0x7f]);
    expect(vlq(128)).toEqual([0x81, 0x00]);
    expect(vlq(480)).toEqual([0x83, 0x60]);
    expect(vlq(0x0fffffff)).toEqual([0xff, 0xff, 0xff, 0x7f]);
  });
  it('works out key signatures', () => {
    expect(keySignature(0, false)).toEqual({ sf: 0, mi: 0 });  // C major
    expect(keySignature(7, false)).toEqual({ sf: 1, mi: 0 });  // G major, one sharp
    expect(keySignature(5, false)).toEqual({ sf: -1, mi: 0 }); // F major, one flat
    expect(keySignature(9, true)).toEqual({ sf: 0, mi: 1 });   // A minor
    expect(keySignature(0, true)).toEqual({ sf: -3, mi: 1 });  // C minor, three flats
  });
});

describe('buildMidi', () => {
  const song = exampleProject();
  const m = read(buildMidi(song));

  it('has a valid header: format 1, one conductor track plus one per track', () => {
    expect(m.header).toMatchObject({ id: 'MThd', len: 6, format: 1, division: PPQ });
    expect(m.header.tracks).toBe(1 + song.tracks.length);
  });
  it('is exactly as long as it says (no stray bytes)', () => {
    expect(m.size).toBe(buildMidi(song).length);
  });
  it('carries tempo, time signature and key on the first track', () => {
    const c = m.tracks[0].events;
    const tempo = c.find(e => e.meta === 0x51)!.data;
    expect((tempo[0] << 16) | (tempo[1] << 8) | tempo[2]).toBe(Math.round(60_000_000 / song.tempo));
    expect(c.find(e => e.meta === 0x58)!.data.slice(0, 2)).toEqual([4, 2]);
    expect(c.find(e => e.meta === 0x59)!.data).toEqual([0, 0]);
    expect(m.tracks[0].name).toBe('Example song');
  });
  it('names every track', () => {
    expect(m.tracks.slice(1).map(t => t.name)).toEqual(song.tracks.map(t => t.name));
  });
  it('puts every note in, with the right pitch, time and length', () => {
    const melody = song.tracks[0];
    const ons = m.tracks[1].events.filter(e => e.kind === 0x90);
    expect(ons).toHaveLength(melody.notes.length);
    const first = melody.notes[0];
    const on = ons.find(e => e.tick === Math.round(first.start * PPQ) && e.d[0] === first.pitch)!;
    const off = m.tracks[1].events.find(e => e.kind === 0x80 && e.d[0] === first.pitch && e.tick === Math.round((first.start + first.duration) * PPQ));
    expect(on).toBeTruthy(); expect(off).toBeTruthy();
  });
  it('plays drums on channel 10 and everything else on its own channel', () => {
    const drums = m.tracks[song.tracks.findIndex(t => t.role === 'drums') + 1];
    expect(new Set(drums.events.filter(e => e.kind === 0x90).map(e => e.ch))).toEqual(new Set([9]));
    const others = m.tracks.slice(1).filter(t => t !== drums);
    const channels = others.map(t => t.events.find(e => e.kind === 0x90)!.ch);
    expect(new Set(channels).size).toBe(others.length);
    expect(channels).not.toContain(9);
  });
  it('sets volume, position and an instrument', () => {
    const t = m.tracks[1].events;
    expect(t.find(e => e.kind === 0xb0 && e.d[0] === 7)!.d[1]).toBe(Math.round(song.tracks[0].volume * 127));
    expect(t.find(e => e.kind === 0xb0 && e.d[0] === 10)!.d[1]).toBe(64);
    expect(t.find(e => e.kind === 0xc0)!.d[0]).toBe(4); // soft keys -> electric piano
  });
  it('ends every track at the end of the song', () => {
    for (const t of m.tracks) expect(t.endTick).toBe(song.bars * song.beatsPerBar * PPQ);
  });
  it('leaves out notes past the end of a shortened song', () => {
    const p = newProject(); p.bars = 1; p.tracks[0].notes = [{ id: 'a', pitch: 60, start: 1, duration: 1 }, { id: 'b', pitch: 62, start: 9, duration: 1 }];
    expect(read(buildMidi(p)).tracks[1].events.filter(e => e.kind === 0x90)).toHaveLength(1);
  });
  it('writes slides as pitch wheel moves, and returns to centre afterwards', () => {
    const p = newProject(); p.tracks[0].notes = [{ id: 'a', pitch: 60, start: 0, duration: 2, bend: { semitones: 12, from: 0.25, to: 0.5 } }];
    const ev = read(buildMidi(p)).tracks[1].events;
    expect(ev.some(e => e.kind === 0xb0 && e.d[0] === 6 && e.d[1] === 12)).toBe(true); // pitch bend range: 12 semitones
    const wheel = ev.filter(e => e.kind === 0xe0).map(e => ({ tick: e.tick, v: e.d[0] | (e.d[1] << 7) }));
    expect(wheel[0].tick).toBeGreaterThanOrEqual(0.25 * 2 * PPQ);          // nothing before the glide starts
    expect(Math.max(...wheel.map(w => w.v))).toBe(16383);                   // reaches the top
    expect(wheel.find(w => w.v === 16383)!.tick).toBeLessThanOrEqual(0.5 * 2 * PPQ + 1); // ...by the end point
    expect(wheel[wheel.length - 1]).toEqual({ tick: 2 * PPQ, v: 8192 });   // centred again at the note's end
    for (let i = 1; i < wheel.length - 1; i++) expect(wheel[i].v).toBeGreaterThanOrEqual(wheel[i - 1].v);
  });
  it('does not add pitch wheel data when there are no slides', () => {
    expect(m.tracks.flatMap(t => t.events).some(e => e.kind === 0xe0)).toBe(false);
  });
  it('handles many tracks without using the drum channel for melodies', () => {
    const p = newProject(); for (let i = 0; i < 12; i++) { const t = newTrack('melody'); t.notes = [{ id: 'n' + i, pitch: 60, start: 0, duration: 1 }]; p.tracks.push(t); }
    const r = read(buildMidi(p));
    for (const t of r.tracks.slice(1)) for (const e of t.events.filter(e => e.kind === 0x90)) expect(e.ch).not.toBe(9);
  });
});
