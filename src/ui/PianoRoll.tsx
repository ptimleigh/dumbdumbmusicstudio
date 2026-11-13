import { useState } from 'react';
import type { Note, Project, Track } from '../music/types';
import { DURATION_LABELS, isBlackKey, isInScale, noteName, snapToScale, triadFromDegree } from '../music/theory';
import { engine } from '../audio/engine';
import { uid } from '../music/project';

const LOW = 48, HIGH = 84; // C3..C6
const BEAT_W = 48, ROW_H = 18, GRID = 0.25;

export function PianoRoll({ project, track, playhead, onNotes }: {
  project: Project; track: Track; playhead: number; onNotes: (n: Note[]) => void;
}) {
  const [duration, setDuration] = useState(1);
  const [lock, setLock] = useState(true);
  const total = project.bars * project.beatsPerBar;
  const rows: number[] = [];
  for (let p = HIGH; p >= LOW; p--) rows.push(p);

  function onGridDown(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let pitch = HIGH - Math.floor(y / ROW_H);
    const start = Math.floor(x / BEAT_W / GRID) * GRID;
    if (start + GRID > total) return;
    if (lock) pitch = snapToScale(pitch, project.key, project.scaleName);
    const note: Note = { id: uid('n'), pitch, start, duration: Math.min(duration, total - start) };
    onNotes([...track.notes, note]);
    engine.preview(track, pitch);
  }

  function addChord(degree: number) {
    // drop a triad at the first free bar-aligned spot after the last note
    const lastEnd = track.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
    const start = Math.min(Math.ceil(lastEnd / project.beatsPerBar) * project.beatsPerBar, total - project.beatsPerBar);
    const pitches = triadFromDegree(degree, project.key, project.scaleName, 48);
    const notes = pitches.map(pitch => ({ id: uid('n'), pitch, start, duration: project.beatsPerBar }));
    onNotes([...track.notes, ...notes]);
    pitches.forEach(p => engine.preview(track, p, 0.8));
  }

  const rowBg = (p: number) =>
    isInScale(p, project.key, project.scaleName)
      ? ((p - project.key) % 12 === 0 ? 'var(--root)' : 'var(--inscale)')
      : isBlackKey(p) ? 'var(--black)' : 'var(--white)';

  return (
    <section className="roll">
      <div className="roll-tools">
        <span>Note length:</span>
        {DURATION_LABELS.map(d => (
          <button key={d.label} className={d.beats === duration ? 'chip on' : 'chip'} onClick={() => setDuration(d.beats)}>{d.label}</button>
        ))}
        <label className="check"><input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} /> Keep me in key</label>
        <span className="spacer" />
        <span>Add chord:</span>
        {['I', 'ii', 'iii', 'IV', 'V', 'vi'].map((n, i) => (
          <button key={n} className="chip" onClick={() => addChord(i)} title="Adds a chord that fits your key">{n}</button>
        ))}
      </div>
      <div className="roll-scroll">
        <div className="keys">
          {rows.map(p => (
            <div key={p} className="key" style={{ height: ROW_H, background: isBlackKey(p) ? '#222' : '#eee', color: isBlackKey(p) ? '#ddd' : '#333' }}
              onMouseDown={() => engine.preview(track, p)}>
              {p % 12 === 0 || isInScale(p, project.key, project.scaleName) && (p - project.key) % 12 === 0 ? noteName(p) : ''}
            </div>
          ))}
        </div>
        <div className="grid" style={{ width: total * BEAT_W, height: rows.length * ROW_H }} onMouseDown={onGridDown}>
          {rows.map(p => <div key={p} className="row" style={{ height: ROW_H, background: rowBg(p) }} />)}
          {Array.from({ length: total }, (_, b) => (
            <div key={b} className={'beat-line' + (b % project.beatsPerBar === 0 ? ' bar' : '')} style={{ left: b * BEAT_W }} />
          ))}
          {track.notes.map(n => (
            <div key={n.id} className="note" title="Click to remove"
              style={{ left: n.start * BEAT_W, top: (HIGH - n.pitch) * ROW_H, width: n.duration * BEAT_W - 1, height: ROW_H - 1, background: track.color }}
              onMouseDown={e => { e.stopPropagation(); onNotes(track.notes.filter(x => x.id !== n.id)); }}>
              {n.duration >= 1 ? noteName(n.pitch) : ''}
            </div>
          ))}
          <div className="playhead" style={{ left: playhead * BEAT_W, display: playhead > 0 ? 'block' : 'none' }} />
        </div>
      </div>
      <p className="help">Click the grid to add a note · click a note to remove it · Space to play/stop</p>
    </section>
  );
}
