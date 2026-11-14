import { describe, it, expect } from 'vitest';
import { parseProject, serializeProject, fileNameFor } from './serialize';
import { exampleProject, newProject, newTrack } from './project';
import { SCALES } from './theory';

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
  it('ships an example song that saves and loads cleanly', () => {
    const p = exampleProject();
    expect(p.tracks.map(t => t.role)).toEqual(['melody', 'chords', 'bass', 'drums']);
    expect(parseProject(serializeProject(p))).toEqual(p);
  });
  it('keeps the example melody in its key', () => {
    const p = exampleProject();
    for (const n of p.tracks[0].notes) expect(SCALES[p.scaleName]).toContain(((n.pitch - p.key) % 12 + 12) % 12);
  });
  it('remembers a track\'s built-in sound and ignores unknown ones', () => {
    const p = newProject();
    p.tracks[0].voice = 'pluck';
    expect(parseProject(serializeProject(p)).tracks[0].voice).toBe('pluck');
    const bad = JSON.parse(serializeProject(p)); bad.project.tracks[0].voice = 'nope';
    expect(parseProject(JSON.stringify(bad)).tracks[0].voice).toBeUndefined();
  });
  it('remembers a track\'s position and ignores bad values', () => {
    const p = newProject();
    p.tracks[0].pan = -0.4;
    expect(parseProject(serializeProject(p)).tracks[0].pan).toBe(-0.4);
    const bad = JSON.parse(serializeProject(p)); bad.project.tracks[0].pan = 9;
    expect(parseProject(JSON.stringify(bad)).tracks[0].pan).toBe(1);
    bad.project.tracks[0].pan = 0;
    expect(parseProject(JSON.stringify(bad)).tracks[0].pan).toBeUndefined();
  });
  it('remembers slides on notes', () => {
    const p = newProject();
    p.tracks[0].notes.push({ id: 'n1', pitch: 60, start: 0, duration: 2, bend: { semitones: 5, late: true } });
    p.tracks[0].notes.push({ id: 'n2', pitch: 62, start: 2, duration: 1, bend: { semitones: 0 } });
    const back = parseProject(serializeProject(p)).tracks[0].notes;
    expect(back[0].bend).toEqual({ semitones: 5, late: true });
    expect(back[1].bend).toBeUndefined();
  });
});
