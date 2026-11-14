import type { Project } from './music/types';
import { parseProject, serializeProject } from './music/serialize';

const KEY = 'dumbdumbmusicstudio.autosave';
const DB = 'dumbdumbmusicstudio';
const STORE = 'soundfonts';

/** Browser storage can be missing or blocked; every call fails quietly so the app still works. */
export interface Stored { project: Project; text: string }

/** The autosaved song, with the exact text that was stored (used to notice when another tab changes it). */
export function loadAutosave(): Stored | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? { project: parseProject(text), text } : null;
  } catch { return null; }
}

export const AUTOSAVE_KEY = KEY;
export const readAutosaveText = (): string | null => { try { return localStorage.getItem(KEY); } catch { return null; } };

export type SaveResult = { ok: true; text: string } | { ok: false; reason: 'other-tab' | 'failed' };

/**
 * Saves the song. `lastSeen` is what this tab last wrote or read: if the stored song is different, another tab has
 * changed it since, and this save is refused (unless `force`) so one tab never silently overwrites another's work.
 */
export function saveAutosave(p: Project, lastSeen: string | null, force = false): SaveResult {
  try {
    const stored = localStorage.getItem(KEY);
    if (!force && stored !== null && stored !== lastSeen) return { ok: false, reason: 'other-tab' };
    const text = serializeProject(p);
    localStorage.setItem(KEY, text);
    return { ok: true, text };
  } catch { return { ok: false, reason: 'failed' }; }
}

export function clearAutosave() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putSoundFont(name: string, data: ArrayBuffer): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(data, name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* SoundFont just won't be remembered */ }
}

export async function getSoundFont(name: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    const result = await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(name);
      req.onsuccess = () => resolve((req.result as ArrayBuffer | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch { return null; }
}
