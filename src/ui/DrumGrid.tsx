import { useRef } from 'react';
import type { Note, Project, Track } from '../music/types';
import { DRUM_PATTERNS, DRUM_ROWS, STEP, STEPS_PER_BEAT, stepsPerBar } from '../music/drums';
import { uid } from '../music/project';
import { engine } from '../audio/engine';

const STEP_W = 24, ROW_H = 32, LABEL_W = 96;
const BEAT_W = STEP_W * STEPS_PER_BEAT;

interface Gesture { gid: string; paint: boolean; cur: Note[]; last: string }

export function DrumGrid({ project, track, playhead, onNotes }: {
  project: Project; track: Track; playhead: number; onNotes: (n: Note[], key?: string) => void;
}) {
  const total = project.bars * project.beatsPerBar;
  const steps = total * STEPS_PER_BEAT;
  const gesture = useRef<Gesture | null>(null);
  const at = (n: Note) => `${n.pitch}:${Math.round(n.start / STEP)}`;
  const active = new Set(track.notes.map(at));

  function cellFor(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left) / STEP_W), row = Math.floor((e.clientY - r.top) / ROW_H);
    if (col < 0 || col >= steps || row < 0 || row >= DRUM_ROWS.length) return null;
    return { pitch: DRUM_ROWS[row].pitch, step: col };
  }

  function apply(g: Gesture, pitch: number, step: number) {
    const id = `${pitch}:${step}`;
    if (id === g.last) return;
    g.last = id;
    const exists = g.cur.some(n => at(n) === id);
    if (g.paint && !exists) {
      g.cur = [...g.cur, { id: uid('n'), pitch, start: step * STEP, duration: STEP }];
      engine.preview(track, pitch, 0.4);
    } else if (!g.paint && exists) {
      g.cur = g.cur.filter(n => at(n) !== id);
    } else return;
    onNotes(g.cur, g.gid);
  }

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const c = cellFor(e);
    if (!c) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // starting on an empty cell paints; starting on a filled cell erases as you drag
    const g: Gesture = { gid: uid('paint'), paint: !active.has(`${c.pitch}:${c.step}`), cur: track.notes, last: '' };
    gesture.current = g;
    apply(g, c.pitch, c.step);
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current; if (!g) return;
    const c = cellFor(e); if (c) apply(g, c.pitch, c.step);
  }
  function up(e: React.PointerEvent<HTMLDivElement>) {
    gesture.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function fillPattern(index: number) {
    const pattern = DRUM_PATTERNS[index];
    const perBar = stepsPerBar(project.beatsPerBar);
    const notes: Note[] = [];
    for (let bar = 0; bar < project.bars; bar++)
      for (const [pitch, list] of Object.entries(pattern.steps))
        for (const s of list) if (s < perBar) notes.push({ id: uid('n'), pitch: +pitch, start: (bar * perBar + s) * STEP, duration: STEP });
    onNotes(notes);
  }

  return (
    <section className="roll">
      <div className="roll-tools">
        <span>Start from a beat:</span>
        {DRUM_PATTERNS.map((p, i) => (
          <button key={p.label} className="chip" title={p.hint} onClick={() => fillPattern(i)}>{p.label}</button>
        ))}
        <span className="help-inline">(replaces what is on this track)</span>
      </div>
      <div className="roll-scroll">
        <div className="drum-labels" style={{ width: LABEL_W }}>
          {DRUM_ROWS.map(r => (
            <button key={r.pitch} className="drum-label" style={{ height: ROW_H }} onMouseDown={() => engine.preview(track, r.pitch, 0.4)}>{r.name}</button>
          ))}
        </div>
        <div className="drum-grid" style={{ width: steps * STEP_W, height: DRUM_ROWS.length * ROW_H, ['--step-w' as string]: `${STEP_W}px`, ['--beat-w' as string]: `${BEAT_W}px` }}
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {DRUM_ROWS.map(r => <div key={r.pitch} className="drum-row" style={{ height: ROW_H }} />)}
          {Array.from({ length: Math.ceil(total / project.beatsPerBar) }, (_, b) => (
            <div key={b} className="beat-line bar" style={{ left: b * project.beatsPerBar * BEAT_W }} />
          ))}
          {track.notes.map(n => {
            const row = DRUM_ROWS.findIndex(r => r.pitch === n.pitch);
            if (row < 0) return null;
            return <div key={n.id} className="drum-hit" style={{ left: n.start / STEP * STEP_W + 1, top: row * ROW_H + 3, width: STEP_W - 2, height: ROW_H - 6, background: track.color }} />;
          })}
          <div className="playhead" style={{ left: playhead * BEAT_W, display: playhead > 0 ? 'block' : 'none' }} />
        </div>
      </div>
      <p className="help">Click a square to add a drum hit · drag across to paint or erase · click a drum name to hear it · Space to play/stop</p>
    </section>
  );
}
