import type { Project } from './music/types';
import { parseProject, serializeProject } from './music/serialize';

const KEY = 'dumbdumbmusicstudio.autosave';
const DB = 'dumbdumbmusicstudio';
const STORE = 'soundfonts';

/** Browser storage can be missing or blocked; every call fails quietly so the app still works. */
export function loadAutosave(): Project | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? parseProject(text) : null;
  } catch { return null; }
}

export function saveAutosave(p: Project) {
  try { localStorage.setItem(KEY, serializeProject(p)); } catch { /* storage full or blocked */ }
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
