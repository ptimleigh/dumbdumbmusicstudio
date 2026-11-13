import { describe, it, expect } from 'vitest';
import { change, initHistory, redo, undo } from './history';

const at = (now: number, key?: string) => ({ now, key });

describe('history', () => {
  it('undoes and redoes separate changes', () => {
    let h = initHistory(1);
    h = change(h, 2, at(0)); h = change(h, 3, at(10));
    h = undo(h); expect(h.present).toBe(2);
    h = undo(h); expect(h.present).toBe(1);
    h = undo(h); expect(h.present).toBe(1);
    h = redo(h); h = redo(h); expect(h.present).toBe(3);
    expect(redo(h).present).toBe(3);
  });
  it('merges a drag with the same key into one step', () => {
    let h = initHistory(0);
    for (let i = 1; i <= 20; i++) h = change(h, i, at(i * 20, 'drag'));
    expect(h.past).toHaveLength(1);
    expect(undo(h).present).toBe(0);
  });
  it('starts a new step after a pause or a different key', () => {
    let h = initHistory(0);
    h = change(h, 1, at(0, 'a')); h = change(h, 2, at(2000, 'a')); h = change(h, 3, at(2100, 'b'));
    expect(h.past).toHaveLength(3);
  });
  it('a new change clears the redo list', () => {
    let h = initHistory(1);
    h = change(h, 2, at(0)); h = undo(h); h = change(h, 5, at(10));
    expect(h.future).toHaveLength(0);
  });
  it('silent changes do not create undo steps', () => {
    let h = initHistory(1);
    h = change(h, 2, { now: 0, silent: true });
    expect(h.past).toHaveLength(0);
    expect(h.present).toBe(2);
  });
  it('limits how far back it remembers', () => {
    let h = initHistory(0);
    for (let i = 1; i <= 10; i++) h = change(h, i, { now: i * 5000, limit: 3 });
    expect(h.past).toHaveLength(3);
  });
  it('lets the caller keep parts of the current state', () => {
    let h = initHistory({ n: 1, keep: 'a' });
    h = change(h, { n: 2, keep: 'b' }, at(0));
    h = undo(h, (snap, cur) => ({ ...snap, keep: cur.keep }));
    expect(h.present).toEqual({ n: 1, keep: 'b' });
  });
});
