/** Undo/redo as pure functions over snapshots. Snapshots are cheap because state updates never mutate. */
export interface History<T> {
  present: T;
  past: T[];
  future: T[];
  lastKey: string | null;
  lastTime: number;
}

export interface ChangeOptions {
  /** Changes with the same key in quick succession (a slider drag, a note drag) merge into one undo step. */
  key?: string;
  /** Update the current state without making an undo step (e.g. a SoundFont finishing loading). */
  silent?: boolean;
  now: number;
  limit?: number;
}

export const MERGE_WINDOW_MS = 1000;

export const initHistory = <T,>(present: T): History<T> => ({ present, past: [], future: [], lastKey: null, lastTime: 0 });

export function change<T>(h: History<T>, next: T, o: ChangeOptions): History<T> {
  if (next === h.present) return h;
  if (o.silent) return { ...h, present: next };
  if (o.key && o.key === h.lastKey && o.now - h.lastTime < MERGE_WINDOW_MS) {
    return { ...h, present: next, future: [], lastTime: o.now };
  }
  const limit = o.limit ?? 100;
  return { present: next, past: [...h.past.slice(-(limit - 1)), h.present], future: [], lastKey: o.key ?? null, lastTime: o.now };
}

/** `adopt` lets the caller carry over parts of the current state that must not be undone. */
export function undo<T>(h: History<T>, adopt: (snapshot: T, current: T) => T = s => s): History<T> {
  if (h.past.length === 0) return h;
  const snapshot = h.past[h.past.length - 1];
  return { present: adopt(snapshot, h.present), past: h.past.slice(0, -1), future: [h.present, ...h.future], lastKey: null, lastTime: 0 };
}

export function redo<T>(h: History<T>, adopt: (snapshot: T, current: T) => T = s => s): History<T> {
  if (h.future.length === 0) return h;
  const [snapshot, ...rest] = h.future;
  return { present: adopt(snapshot, h.present), past: [...h.past, h.present], future: rest, lastKey: null, lastTime: 0 };
}
