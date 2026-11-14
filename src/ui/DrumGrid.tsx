import { useRef } from 'react';
import type { Note, Project, Track } from '../music/types';
import { DRUM_PATTERNS, DRUM_ROWS, STEP, STEPS_PER_BEAT, stepsPerBar } from '../music/drums';
import { uid } from '../music/project';
import { engine } from '../audio/engine';
import { Icon, Popover, useElementWidth, ZoomControls } from './kit';
import { useTimeZoom } from './useZoom';
import { Ruler } from './Ruler';
import type { Region } from '../audio/transport';

const ROW_H = 34, LABEL_W = 104, RULER_H = 28;

interface Gesture { gid: string; paint: boolean; cur: Note[]; last: string }

export function DrumGrid({ project, track, playhead, playing, startBeat, loop, loopOn, onSeek, onLoop, onNotes }: {
  project: Project; track: Track; playhead: number; playing: boolean; startBeat: number; loop: Region | null; loopOn: boolean;
  onSeek: (beat: number) => void; onLoop: (r: Region | null) => void; onNotes: (n: Note[], key?: string) => void;
}) {
  const total = project.bars * project.beatsPerBar;
  const steps = total * STEPS_PER_BEAT;
  const [scrollRef, areaWidth] = useElementWidth<HTMLDivElement>();
  // the song always fits the width of the screen; zooming magnifies it
  const tz = useTimeZoom({ scrollRef, areaWidth, total, leftW: LABEL_W, minBeat: 40, maxBeat: 400, playhead: playing ? playhead : 0, follow: true, focusBeat: startBeat });
  const BEAT_W = tz.beatW;
  const STEP_W = BEAT_W / STEPS_PER_BEAT;
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
    <section className="roll" style={{ ['--c' as string]: track.color }}>
      <div className="roll-bar">
        <Popover buttonClass="btn small" title="Fill the whole song with a ready-made beat" trigger={<><Icon name="drum" size={15} />Start from a beat<Icon name="chevron" size={14} /></>}>
          {close => (
            <div role="menu">
              <div className="menu-title">Replaces what is on this track</div>
              {DRUM_PATTERNS.map((p, i) => (
                <button key={p.label} role="menuitem" className="menu-item two-line" onClick={() => { fillPattern(i); close(); }}>
                  <span className="menu-label"><strong>{p.label}</strong><small>{p.hint}</small></span>
                </button>
              ))}
            </div>
          )}
        </Popover>
        <span className="spacer" />
        <span className="muted bar-note">Click or drag across squares to paint hits</span>
        <ZoomControls tz={tz} />
      </div>
      <div className="roll-main">
        <div className="roll-scroll" ref={scrollRef}>
          <div className="roll-inner" style={{ width: LABEL_W + steps * STEP_W }}>
            <Ruler total={total} beatsPerBar={project.beatsPerBar} beatW={BEAT_W} leftW={LABEL_W} height={RULER_H} grid={0.25}
              startBeat={startBeat} playing={playing} playhead={playhead} loop={loop} loopOn={loopOn} onSeek={onSeek} onLoop={onLoop} />
            <div className="roll-body">
              <div className="drum-labels" style={{ width: LABEL_W }}>
                {DRUM_ROWS.map(r => (
                  <button key={r.pitch} className="drum-label" style={{ height: ROW_H }} onMouseDown={() => engine.preview(track, r.pitch, 0.4)} title={`Hear ${r.name}`}>{r.name}</button>
                ))}
              </div>
              <div className="drum-grid" style={{ width: steps * STEP_W, height: DRUM_ROWS.length * ROW_H, ['--step-w' as string]: `${STEP_W}px`, ['--beat-w' as string]: `${BEAT_W}px` }}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                {DRUM_ROWS.map(r => <div key={r.pitch} className="drum-row" style={{ height: ROW_H }} />)}
                {Array.from({ length: Math.ceil(total / project.beatsPerBar) }, (_, b) => (
                  <div key={b} className="beat-line bar" style={{ left: b * project.beatsPerBar * BEAT_W }} />
                ))}
                {track.notes.filter(n => n.start < total).map(n => {
                  const row = DRUM_ROWS.findIndex(r => r.pitch === n.pitch);
                  if (row < 0) return null;
                  return <div key={n.id} className="drum-hit" style={{ left: n.start / STEP * STEP_W + 1.5, top: row * ROW_H + 3, width: STEP_W - 3, height: ROW_H - 6 }} />;
                })}
                {loop && <div className={'loop-wash' + (loopOn ? '' : ' off')} style={{ left: loop.start * BEAT_W, width: (loop.end - loop.start) * BEAT_W }} />}
                {!playing && startBeat > 0 && <div className="start-line" style={{ left: startBeat * BEAT_W }} />}
                {playing && <div className="playhead" style={{ left: playhead * BEAT_W }} />}
              </div>
            </div>
          </div>
        </div>
        {track.notes.length === 0 && (
          <div className="empty-hint" aria-hidden="true">
            <Icon name="drum" size={22} />
            <strong>Click a square to add a drum hit</strong>
            <span>Or pick “Start from a beat” for a ready-made groove.</span>
          </div>
        )}
      </div>
      <div className="roll-foot">
        <span><kbd>Click</kbd> add or remove a hit</span>
        <span><kbd>Drag</kbd> paint a row</span>
        <span>Click a drum name to hear it</span>
        <span><kbd>Space</kbd> play</span>
      </div>
    </section>
  );
}
