import { describe, it, expect } from 'vitest';
import { parseProject, serializeProject, fileNameFor } from './serialize';
import { newProject, newTrack } from './project';

describe('project files', () => {
  it('round-trips a project', () => {
    const p = newProject();
    p.name = 'Sunset Drive';
    p.tracks.push(newTrack('bass'));
    p.tracks[0].notes.push({ id: 'a', pitch: 64, start: 1.5, duration: 0.75 });
    p.tracks[1].sound = { kind: 'soundfont', fileName: 'piano.sf2', presets: [{ name: 'Piano', bankMSB: 0, bankLSB: 0, program: 0 }], selected: 0 };
    expect(parseProject(serializeProject(p))).toEqual(p);
  });
  it('rejects files that are not projects', () => {
    expect(() => parseProject('hello')).toThrow(/not a project/);
    expect(() => parseProject('{"a":1}')).toThrow(/not a Dumb Dumb/);
  });
  it('repairs bad values instead of crashing', () => {
    const text = JSON.stringify({ format: 'dumbdumbmusicstudio', version: 1, project: {
      tempo: 9999, bars: -3, scaleName: 'nope',
      tracks: [{ role: 'lead', macros: { warmth: 99 }, notes: [{ pitch: 60, start: 0, duration: -1 }, { pitch: 60, start: 0, duration: 1 }] }],
    } });
    const p = parseProject(text);
    expect(p.tempo).toBe(240);
    expect(p.bars).toBe(1);
    expect(p.scaleName).toBe('pentatonic');
    expect(p.tracks[0].macros.warmth).toBe(10);
    expect(p.tracks[0].notes).toHaveLength(1);
  });
  it('makes a safe file name', () => {
    const p = newProject(); p.name = 'My / song: v2?';
    expect(fileNameFor(p)).toBe('My-song-v2.dumbdumb.json');
  });
});
