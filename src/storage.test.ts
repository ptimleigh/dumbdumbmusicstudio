import { describe, it, expect, beforeEach } from 'vitest';
import { AUTOSAVE_KEY, clearAutosave, loadAutosave, saveAutosave } from './storage';
import { newProject } from './music/project';
import { serializeProject } from './music/serialize';

/** A stand-in for the browser's localStorage. */
function fakeStorage(opts: { failWrites?: boolean } = {}) {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { if (opts.failWrites) throw new Error('full'); data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    _data: data,
  };
}
const install = (s: ReturnType<typeof fakeStorage>) => { (globalThis as any).localStorage = s; };

describe('autosave', () => {
  beforeEach(() => install(fakeStorage()));

  it('saves a song and loads the same song back', () => {
    const p = newProject(); p.name = 'Round trip';
    const r = saveAutosave(p, null);
    expect(r.ok).toBe(true);
    const back = loadAutosave()!;
    expect(back.project.name).toBe('Round trip');
    expect(back.text).toBe(serializeProject(p));
  });

  it('keeps saving over its own earlier save', () => {
    const p = newProject();
    const first = saveAutosave(p, null);
    expect(first.ok).toBe(true);
    p.name = 'Changed';
    const second = saveAutosave(p, first.ok ? first.text : null);
    expect(second.ok).toBe(true);
    expect(loadAutosave()!.project.name).toBe('Changed');
  });

  it('refuses to overwrite a song another tab saved in the meantime', () => {
    const mine = newProject(); mine.name = 'Mine';
    const first = saveAutosave(mine, null);
    // another tab writes its own version
    const theirs = newProject(); theirs.name = 'Theirs';
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(theirs));
    mine.name = 'Mine, edited';
    const r = saveAutosave(mine, first.ok ? first.text : null);
    expect(r).toEqual({ ok: false, reason: 'other-tab' });
    expect(loadAutosave()!.project.name).toBe('Theirs');           // their work is untouched
  });

  it('can overwrite on purpose when told to', () => {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(newProject()));
    const p = newProject(); p.name = 'Forced';
    expect(saveAutosave(p, null, true).ok).toBe(true);
    expect(loadAutosave()!.project.name).toBe('Forced');
  });

  it('a brand new tab will not overwrite a song that already exists', () => {
    localStorage.setItem(AUTOSAVE_KEY, serializeProject(newProject()));
    expect(saveAutosave(newProject(), null)).toEqual({ ok: false, reason: 'other-tab' });
  });

  it('reports when the browser will not store anything', () => {
    install(fakeStorage({ failWrites: true }));
    expect(saveAutosave(newProject(), null)).toEqual({ ok: false, reason: 'failed' });
  });

  it('starting over clears the saved song, so the next save is allowed', () => {
    saveAutosave(newProject(), null);
    clearAutosave();
    expect(loadAutosave()).toBeNull();
    expect(saveAutosave(newProject(), null).ok).toBe(true);
  });

  it('ignores a damaged saved song instead of crashing', () => {
    localStorage.setItem(AUTOSAVE_KEY, '{not json');
    expect(loadAutosave()).toBeNull();
  });
});
